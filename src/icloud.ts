import { getContext, ICloudError } from "./auth";

/**
 * Client for iCloud's private "Hide My Email" (premiummailsettings) API.
 * Authentication (Apple ID + SRP + trust token) is handled in ./auth; this
 * module just talks to the endpoints with the authenticated context.
 *
 * Endpoint shapes ported from dedoussis/icloud-hide-my-email-browser-extension.
 */

export {
  ICloudError,
  InvalidCredentialsError,
  InvalidMfaCodeError,
} from "./auth";

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

async function pms<T>(
  method: "GET" | "POST",
  path: string,
  data?: Record<string, unknown>,
): Promise<T> {
  const ctx = await getContext();
  let res: Response;
  try {
    res = await fetch(`${ctx.baseUrl}${path}`, {
      method,
      headers: ctx.headers,
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
  } catch (err) {
    throw new ICloudError(
      `Network error talking to iCloud: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new ICloudError(
      `Request to ${method} ${path} failed with status ${res.status}.`,
    );
  }
  const body = (await res.json()) as PremiumMailSettingsResponse<T>;
  if (!body.success) {
    throw new ICloudError(
      body.error?.errorMessage ?? "iCloud rejected the request.",
    );
  }
  return body.result;
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
