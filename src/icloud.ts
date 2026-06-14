import { getPreferenceValues } from "@raycast/api";

/**
 * Minimal client for iCloud's private "Hide My Email" (premiummailsettings) API.
 *
 * There is no official Apple API. These are the same undocumented endpoints the
 * iCloud.com Mail settings page calls. Auth works by replaying the cookies from
 * an already-authenticated icloud.com browser session (see README), since we
 * cannot perform Apple's SRP login + 2FA flow reliably from a headless context.
 *
 * Endpoint shapes are ported from the dedoussis/icloud-hide-my-email-browser-extension
 * reference implementation.
 */

interface ExtensionPreferences {
  cookie: string;
  region: "global" | "china";
}

export interface HmeEmail {
  origin: "ON_DEMAND" | "SAFARI";
  anonymousId: string;
  domain: string;
  forwardToEmail: string;
  hme: string;
  isActive: boolean;
  label: string;
  note: string;
  createTimestamp: number;
  recipientMailId: string;
}

export interface ListHmeResult {
  hmeEmails: HmeEmail[];
  selectedForwardTo: string;
  forwardToEmails: string[];
}

interface PremiumMailSettingsResponse<T> {
  success: boolean;
  result: T;
  error?: { errorMessage: string };
}

interface Webservices {
  premiummailsettings?: { url: string; status: string };
}

const prefs = getPreferenceValues<ExtensionPreferences>();

const SETUP_URL =
  prefs.region === "china"
    ? "https://setup.icloud.com.cn/setup/ws/1"
    : "https://setup.icloud.com/setup/ws/1";

const ORIGIN =
  prefs.region === "china"
    ? "https://www.icloud.com.cn"
    : "https://www.icloud.com";

// A realistic desktop Safari UA — Apple's web endpoints can reject the default
// Node/undici user agent.
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15";

/** Generic failure talking to iCloud. */
export class ICloudError extends Error {}
/** The session cookie is missing, invalid, or expired. */
export class NotAuthenticatedError extends ICloudError {}

function baseHeaders(): Record<string, string> {
  const cookie = (prefs.cookie ?? "").trim();
  if (!cookie) {
    throw new NotAuthenticatedError(
      "No iCloud cookie configured. Add it in the extension preferences.",
    );
  }
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Origin: ORIGIN,
    Referer: `${ORIGIN}/`,
    "User-Agent": USER_AGENT,
    Cookie: cookie,
  };
}

async function rawRequest<T>(
  method: "GET" | "POST",
  url: string,
  data?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: baseHeaders(),
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  } catch (err) {
    throw new ICloudError(
      `Network error talking to iCloud: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Apple uses 421 ("Misdirected Request") and 401 to signal a dead session.
  if (
    response.status === 401 ||
    response.status === 421 ||
    response.status === 450
  ) {
    throw new NotAuthenticatedError(
      "Your iCloud session is invalid or expired. Re-copy your cookie into the extension preferences.",
    );
  }
  if (!response.ok) {
    throw new ICloudError(
      `Request to ${method} ${url} failed with status ${response.status}.`,
    );
  }

  return (await response.json()) as T;
}

let cachedBaseUrl: string | undefined;

/**
 * Validates the session and discovers the per-account premiummailsettings host.
 * Returns the base URL (e.g. https://p68-maildomains.icloud.com).
 */
async function getBaseUrl(force = false): Promise<string> {
  if (cachedBaseUrl && !force) return cachedBaseUrl;

  const data = await rawRequest<{ webservices?: Webservices }>(
    "POST",
    `${SETUP_URL}/validate`,
  );
  const url = data.webservices?.premiummailsettings?.url;
  if (!url) {
    throw new NotAuthenticatedError(
      "iCloud did not return a Hide My Email service URL. The session is likely expired, or this account has no active iCloud+ subscription.",
    );
  }
  cachedBaseUrl = url;
  return url;
}

async function pms<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const root = await getBaseUrl();
  const res = await rawRequest<PremiumMailSettingsResponse<T>>(
    method,
    `${root}${path}`,
    data,
  );
  if (!res.success) {
    throw new ICloudError(
      res.error?.errorMessage ?? "iCloud rejected the request.",
    );
  }
  return res.result;
}

/** Lists all Hide My Email addresses on the account, plus forwarding config. */
export async function listHme(): Promise<ListHmeResult> {
  // Note: list lives under /v2, every other operation under /v1.
  return pms<ListHmeResult>("GET", "/v2/hme/list");
}

/** Generates (but does not yet reserve) a candidate address. */
export async function generateHme(): Promise<string> {
  const result = await pms<{ hme: string }>("POST", "/v1/hme/generate");
  return result.hme;
}

/** Reserves a previously generated address with a label and optional note. */
export async function reserveHme(
  hme: string,
  label: string,
  note?: string,
): Promise<HmeEmail> {
  const result = await pms<{ hme: HmeEmail }>("POST", "/v1/hme/reserve", {
    hme,
    label,
    note: note ?? "Created with the Hide My Email Raycast extension",
  });
  return result.hme;
}

/** Updates the label / note of an existing address. */
export async function updateHmeMetadata(
  anonymousId: string,
  label: string,
  note?: string,
): Promise<void> {
  await pms("POST", "/v1/hme/updateMetaData", { anonymousId, label, note });
}

export async function deactivateHme(anonymousId: string): Promise<void> {
  await pms("POST", "/v1/hme/deactivate", { anonymousId });
}

export async function reactivateHme(anonymousId: string): Promise<void> {
  await pms("POST", "/v1/hme/reactivate", { anonymousId });
}

/** Permanently deletes an address (only possible once it has been deactivated). */
export async function deleteHme(anonymousId: string): Promise<void> {
  await pms("POST", "/v1/hme/delete", { anonymousId });
}
