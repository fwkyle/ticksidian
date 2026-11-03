import type { SignInResult } from "./auth-adapter";
import type { AuthErrorCode } from "./auth-types";
import type { FetchOutcome } from "./auth-fetch.ts";
import { isAuthApiErrorResponse } from "./auth-api-validation";

function extractErrorCode(payload: unknown): AuthErrorCode | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    isAuthApiErrorResponse((payload as { error: unknown }).error)
  ) {
    return (payload as { error: { code: AuthErrorCode } }).error.code;
  }
  return null;
}

export function isAccessExpired(outcome: FetchOutcome): boolean {
  if (outcome.status !== 401 && outcome.status !== 403) return false;
  return extractErrorCode(outcome.payload) === "session_expired";
}

function mapErrorCode(
  status: number,
  payloadCode: AuthErrorCode | null,
): { code: AuthErrorCode; message: string } {
  if (payloadCode) return { code: payloadCode, message: "" };
  if (status === 0) return { code: "network", message: "" };
  if (status === 401 || status === 403) {
    return { code: "session_expired", message: "" };
  }
  if (status >= 500) return { code: "server", message: "" };
  return { code: "unknown", message: "" };
}

function attachRetryAfter(
  failure: { ok: false; code: AuthErrorCode; message: string },
  outcome: FetchOutcome,
): SignInResult {
  if (outcome.retryAfterSec === undefined) return failure;
  return { ...failure, retryAfterSec: outcome.retryAfterSec };
}

export function buildSignInFailure(outcome: FetchOutcome): SignInResult {
  if (outcome.networkError) {
    return {
      ok: false,
      code: "network",
      message: "서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }
  if (
    typeof outcome.payload === "object" &&
    outcome.payload !== null &&
    "error" in outcome.payload &&
    isAuthApiErrorResponse((outcome.payload as { error: unknown }).error)
  ) {
    const env = outcome.payload as {
      error: { code: AuthErrorCode; message: string };
    };
    return attachRetryAfter(
      { ok: false, code: env.error.code, message: env.error.message },
      outcome,
    );
  }
  const mapped = mapErrorCode(outcome.status, null);
  return attachRetryAfter(
    {
      ok: false,
      code: mapped.code,
      message:
        mapped.code === "network"
          ? "서버에 연결하지 못했습니다."
          : mapped.code === "server"
            ? "서버 오류가 발생했습니다."
            : mapped.code === "session_expired"
              ? "세션이 만료되었습니다. 다시 로그인해 주세요."
              : "알 수 없는 오류가 발생했습니다.",
    },
    outcome,
  );
}
