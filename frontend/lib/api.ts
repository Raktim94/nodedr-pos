// Same-origin: requests go to the Next.js server, which proxies /api/* to
// the backend (see next.config.ts). No host/port is baked into the browser
// bundle, so the app works from any device that can reach the frontend.
const API_URL = "/api";

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData bodies must NOT get a manual Content-Type — the browser needs
  // to set it itself, multipart boundary included, or the server can't
  // parse the body at all.
  const isFormData = init?.body instanceof FormData;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      credentials: "include",
      // Without this, a stalled network or a slow backend request leaves
      // the caller `await`-ing forever — the button just stays on
      // "Processing…" indefinitely, which reads as the app having frozen.
      // 20s is generous for anything this app does (checkout, reports).
      signal: AbortSignal.timeout(20_000),
      headers: isFormData
        ? { ...(init?.headers || {}) }
        : { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError("Request timed out — check your connection and try again", 0);
    }
    throw new ApiError("Network error — check your connection and try again", 0);
  }

  if (res.status === 204) return undefined as T;

  const contentType = res.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    throw new ApiError(body?.error || res.statusText, res.status, body?.details);
  }

  return body as T;
}

// Zod's `.flatten()` shape from the backend's `{ error, details }` 400s.
// Turns "Invalid input" (which tells no one anything) into e.g.
// "Invalid input — creditApplied: Expected number, received null" so the
// actual bad field is visible in the toast instead of only in devtools.
export function describeApiError(err: unknown, fallback = "Something went wrong"): string {
  if (!(err instanceof ApiError)) return fallback;
  const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[]> } | undefined;
  const parts = [...(details?.formErrors ?? [])];
  for (const [field, msgs] of Object.entries(details?.fieldErrors ?? {})) {
    for (const m of msgs ?? []) parts.push(`${field}: ${m}`);
  }
  return parts.length > 0 ? `${err.message} — ${parts.join("; ")}` : err.message;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data !== undefined ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  upload: <T>(path: string, formData: FormData) => request<T>(path, { method: "POST", body: formData }),
};
