import { Client, Hash, Mode, Srp, util } from "@foxt/js-srp";
import { getPreferenceValues, LocalStorage } from "@raycast/api";
import crypto from "crypto";

/**
 * Apple ID (SRP) authentication for iCloud, ported from foxt/icloud.js and
 * mandarons/icloudpy (including icloudpy's early-2026 fix that requires a PUT to
 * trigger the 2FA push before the code can be submitted).
 *
 * Flow per command run (fresh Node process):
 *   1. signin/init + signin/complete  (SRP-6a, GSA mode)  ─ uses a stored trust
 *      token so 2FA is skipped for ~30 days
 *   2. if 409 → 2FA: trigger push (PUT) → user enters code → verify → trust
 *   3. accountLogin → fresh iCloud cookies + webservices (incl. premiummailsettings)
 *
 * Because we re-auth each run from the trust token, the iCloud session cookies
 * are always freshly minted — no more cookie expiry to manage by hand.
 */

interface ExtensionPreferences {
  appleId: string;
  password: string;
  region: "global" | "china";
}

const prefs = getPreferenceValues<ExtensionPreferences>();
const CHINA = prefs.region === "china";

const CLIENT_ID =
  "d39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d";
const AUTH_ENDPOINT = CHINA
  ? "https://idmsa.apple.com.cn/appleauth/auth/"
  : "https://idmsa.apple.com/appleauth/auth/";
const SETUP_ENDPOINT = CHINA
  ? "https://setup.icloud.com.cn/setup/ws/1/accountLogin"
  : "https://setup.icloud.com/setup/ws/1/accountLogin";
const ICLOUD_ORIGIN = CHINA
  ? "https://www.icloud.com.cn"
  : "https://www.icloud.com";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:103.0) Gecko/20100101 Firefox/103.0";

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: ICLOUD_ORIGIN,
};

const AUTH_HEADERS: Record<string, string> = {
  ...DEFAULT_HEADERS,
  Origin: AUTH_ENDPOINT.replace("/appleauth/auth/", ""),
  Referer: AUTH_ENDPOINT.replace("/appleauth/auth/", "/"),
  "X-Apple-Widget-Key": CLIENT_ID,
  "X-Apple-OAuth-Client-Id": CLIENT_ID,
  "X-Apple-I-FD-Client-Info": JSON.stringify({
    U: USER_AGENT,
    L: "en-GB",
    Z: "GMT+01:00",
    V: "1.1",
    F: "",
  }),
  "X-Apple-OAuth-Response-Type": "code",
  "X-Apple-OAuth-Response-Mode": "web_message",
  "X-Apple-OAuth-Client-Type": "firstPartyAuth",
};

export class ICloudError extends Error {}
export class InvalidCredentialsError extends ICloudError {}
export class InvalidMfaCodeError extends ICloudError {}

// --- SRP-6a (GSA variant) — vendored from foxt/icloud.js iCSRPAuthenticator ---

const srp = new Srp(Mode.GSA, Hash.SHA256, 2048);
const enc = (s: string) => new TextEncoder().encode(s);
const b64ToBytes = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

interface SrpInitResponse {
  iteration: number;
  salt: string;
  protocol: "s2k" | "s2k_fo";
  b: string;
  c: string;
}

class GSASRPAuthenticator {
  private client?: Client;
  constructor(private username: string) {}

  private async derivePassword(
    protocol: "s2k" | "s2k_fo",
    password: string,
    salt: Uint8Array,
    iterations: number,
  ): Promise<Uint8Array> {
    let passHash: Uint8Array = new Uint8Array(
      await util.hash(srp.h, enc(password).buffer as ArrayBuffer),
    );
    if (protocol === "s2k_fo") passHash = enc(util.toHex(passHash));

    const imported = await crypto.subtle.importKey(
      "raw",
      passHash,
      { name: "PBKDF2" },
      false,
      ["deriveBits"],
    );
    const derived = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: { name: "SHA-256" }, iterations, salt },
      imported,
      256,
    );
    return new Uint8Array(derived);
  }

  async getInit(): Promise<{
    a: string;
    accountName: string;
    protocols: string[];
  }> {
    this.client = await srp.newClient(enc(this.username), new Uint8Array());
    const a = Buffer.from(util.bytesFromBigint(this.client.A)).toString(
      "base64",
    );
    return { a, protocols: ["s2k", "s2k_fo"], accountName: this.username };
  }

  async getComplete(
    password: string,
    server: SrpInitResponse,
  ): Promise<{ accountName: string; m1: string; m2: string; c: string }> {
    if (!this.client) throw new Error("SRP not initialized");
    if (server.protocol !== "s2k" && server.protocol !== "s2k_fo")
      throw new ICloudError(`Unsupported SRP protocol ${server.protocol}`);
    const salt = b64ToBytes(server.salt);
    const serverPub = b64ToBytes(server.b);
    this.client.p = await this.derivePassword(
      server.protocol,
      password,
      salt,
      server.iteration,
    );
    await this.client.generate(salt, serverPub);
    const m1 = Buffer.from(this.client._M).toString("base64");
    const m2 = Buffer.from(await this.client.generateM2()).toString("base64");
    return { accountName: this.username, m1, m2, c: server.c };
  }
}

// --- Session state (per process) ---

type Phase = "idle" | "ready" | "mfa";

interface Session {
  phase: Phase;
  sessionId?: string;
  sessionToken?: string;
  scnt?: string;
  aasp?: string;
  trustToken?: string;
  cookies: string[];
  webservices?: Record<string, { url: string; status: string }>;
}

const session: Session = { phase: "idle", cookies: [] };
const trustKey = `trust-token:${prefs.appleId.toLowerCase()}`;

function setCookiesFrom(res: Response) {
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) session.cookies = set;
  return set;
}

function captureSecrets(res: Response) {
  const sessionToken = res.headers.get("X-Apple-Session-Token");
  if (sessionToken) {
    session.sessionId = sessionToken;
    session.sessionToken = sessionToken;
  }
  const scnt = res.headers.get("scnt");
  if (scnt) session.scnt = scnt;
  const aaspCookie = (res.headers.getSetCookie?.() ?? []).find((c) =>
    c.includes("aasp="),
  );
  if (aaspCookie) session.aasp = aaspCookie.split("aasp=")[1].split(";")[0];
}

function mfaHeaders(): Record<string, string> {
  return {
    ...AUTH_HEADERS,
    scnt: session.scnt ?? "",
    "X-Apple-ID-Session-Id": session.sessionId ?? "",
    Cookie: `aasp=${session.aasp ?? ""}`,
  };
}

async function accountLogin(): Promise<void> {
  const res = await fetch(SETUP_ENDPOINT, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({
      dsWebAuthToken: session.sessionToken,
      trustToken: session.trustToken ?? "",
      extended_login: true,
    }),
  });
  if (!res.ok)
    throw new ICloudError(`iCloud accountLogin failed (${res.status}).`);
  setCookiesFrom(res);
  const data = (await res.json()) as { webservices?: Session["webservices"] };
  if (!data.webservices?.premiummailsettings?.url) {
    throw new ICloudError(
      "Signed in, but this account has no Hide My Email service (an active iCloud+ subscription is required).",
    );
  }
  session.webservices = data.webservices;
  session.phase = "ready";
}

/** Asks Apple to push a 2FA code to trusted devices (required since early 2026). */
async function triggerMfaPush(): Promise<void> {
  try {
    await fetch(`${AUTH_ENDPOINT}verify/trusteddevice/securitycode`, {
      method: "PUT",
      headers: mfaHeaders(),
    });
  } catch {
    // Non-fatal: a code may still arrive via SMS / another path.
  }
}

let signInInFlight: Promise<"ready" | "mfa"> | null = null;

/**
 * Performs SRP sign-in. Returns "ready" if trusted, or "mfa" if a code is needed.
 *
 * De-duplicates concurrent calls: Raycast/React can fire the auth effect twice
 * on mount (StrictMode), and two parallel SRP flows would clobber each other's
 * shared session secrets (scnt/aasp/sessionId) — making the first attempt fail
 * and also invalidating the 2FA push. Sharing one in-flight promise prevents that.
 */
export function signIn(): Promise<"ready" | "mfa"> {
  if (session.phase === "ready") return Promise.resolve("ready");
  if (!signInInFlight) {
    signInInFlight = doSignIn().finally(() => {
      signInInFlight = null;
    });
  }
  return signInInFlight;
}

async function doSignIn(): Promise<"ready" | "mfa"> {
  if (session.phase === "ready") return "ready";
  if (!prefs.appleId || !prefs.password) {
    throw new InvalidCredentialsError(
      "Add your Apple ID and password in the extension preferences.",
    );
  }

  session.trustToken =
    (await LocalStorage.getItem<string>(trustKey)) ?? undefined;

  const auth = new GSASRPAuthenticator(prefs.appleId);
  const init = await auth.getInit();
  const initRes = await fetch(`${AUTH_ENDPOINT}signin/init`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(init),
  });
  if (!initRes.ok)
    throw new InvalidCredentialsError(
      `Sign-in failed to start (${initRes.status}).`,
    );
  const complete = await auth.getComplete(
    prefs.password,
    (await initRes.json()) as SrpInitResponse,
  );

  const res = await fetch(
    `${AUTH_ENDPOINT}signin/complete?isRememberMeEnabled=true`,
    {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        ...complete,
        rememberMe: true,
        trustTokens: session.trustToken ? [session.trustToken] : [],
      }),
    },
  );

  captureSecrets(res);

  if (res.status === 200) {
    await accountLogin();
    return "ready";
  }
  if (res.status === 409) {
    session.phase = "mfa";
    await triggerMfaPush();
    return "mfa";
  }
  if (res.status === 401) {
    throw new InvalidCredentialsError("Incorrect Apple ID or password.");
  }
  throw new ICloudError(`Sign-in failed (${res.status}).`);
}

/** Submits the 6-digit 2FA code, trusts the device, and completes sign-in. */
export async function submitMfa(code: string): Promise<void> {
  const res = await fetch(`${AUTH_ENDPOINT}verify/trusteddevice/securitycode`, {
    method: "POST",
    headers: mfaHeaders(),
    body: JSON.stringify({ securityCode: { code } }),
  });
  if (res.status !== 204 && res.status !== 200) {
    throw new InvalidMfaCodeError("That code was not accepted. Try again.");
  }

  // Trust this "device" so future runs skip 2FA (~30 days).
  const trustRes = await fetch(`${AUTH_ENDPOINT}2sv/trust`, {
    headers: mfaHeaders(),
  });
  const newSession = trustRes.headers.get("x-apple-session-token");
  const newTrust = trustRes.headers.get("x-apple-twosv-trust-token");
  if (newSession) session.sessionToken = newSession;
  if (newTrust) {
    session.trustToken = newTrust;
    await LocalStorage.setItem(trustKey, newTrust);
  }

  await accountLogin();
}

/** Forgets the stored trust token (forces 2FA on next sign-in). */
export async function signOut(): Promise<void> {
  await LocalStorage.removeItem(trustKey);
  session.phase = "idle";
  session.cookies = [];
  session.trustToken = undefined;
}

export interface RequestContext {
  baseUrl: string;
  headers: Record<string, string>;
}

/** Returns the authenticated context for premiummailsettings calls. */
export async function getContext(): Promise<RequestContext> {
  if (session.phase !== "ready" || !session.webservices) {
    const result = await signIn();
    if (result !== "ready") {
      throw new ICloudError("Two-factor authentication is required.");
    }
  }
  return {
    baseUrl: session.webservices!.premiummailsettings.url,
    headers: { ...DEFAULT_HEADERS, Cookie: session.cookies.join("; ") },
  };
}
