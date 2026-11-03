export interface FetchOutcome {
  status: number;
  /** 파싱 가능했을 때만 set. 실패하면 null. */
  payload: unknown;
  /** fetch 자체 실패(네트워크/타임아웃)면 set. */
  networkError?: Error;
  retryAfterSec?: number;
}

export type AuthFetchInit = {
  method: "GET" | "POST";
  body?: unknown;
  accessToken?: string;
};

export type AuthFetch = (
  path: string,
  init: AuthFetchInit,
) => Promise<FetchOutcome>;

const DEFAULT_AUTH_FETCH_TIMEOUT_MS = 10_000;

function toNetworkError(err: unknown): Error {
  if (err instanceof Error) return err;
  return new Error("network");
}

function parseRetryAfterSec(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export function createFetchAuth(
  fetchImpl: typeof fetch,
  baseUrl: string,
  timeoutMs = DEFAULT_AUTH_FETCH_TIMEOUT_MS,
): AuthFetch {
  return async function fetchAuth(path, init): Promise<FetchOutcome> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.accessToken) headers["Authorization"] = `Bearer ${init.accessToken}`;

    const controller = new AbortController();
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(() => {
      controller.abort(new Error("auth_fetch_timeout"));
    }, timeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      return {
        status: 0,
        payload: null,
        networkError: toNetworkError(err),
      };
    } finally {
      clearTimeout(timeoutId);
    }

    let payload: unknown = null;
    try {
      const text = await res.text();
      if (text.length > 0) payload = JSON.parse(text);
    } catch {
      payload = null;
    }
    const retryAfterSec = parseRetryAfterSec(res.headers.get("Retry-After"));
    if (retryAfterSec !== null) {
      return { status: res.status, payload, retryAfterSec };
    }
    return { status: res.status, payload };
  };
}

export function createRefreshDeduper(
  runRefresh: () => Promise<boolean>,
): () => Promise<boolean> {
  let refreshInFlight: Promise<boolean> | null = null;

  return function dedupedRefresh(): Promise<boolean> {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };
}
