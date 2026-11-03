import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthApiErrorResponse, AuthErrorCode } from "../types/api.js";

/**
 * 응답 helper. `{ ok: true, data }` / `{ ok: false, error }` envelope를
 * 프론트의 `AuthSuccess<T>`와 동일하게 직렬화한다.
 */

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(json).toString());
  res.end(json);
}

export function sendSuccess<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { ok: true, data });
}

export function sendCreated<T>(res: ServerResponse, data: T): void {
  sendJson(res, 201, { ok: true, data });
}

export function sendError(
  res: ServerResponse,
  status: number,
  code: AuthErrorCode,
  message: string,
): void {
  const body: { ok: false; error: AuthApiErrorResponse } = {
    ok: false,
    error: { code, message },
  };
  sendJson(res, status, body);
}

export function sendRateLimitError(res: ServerResponse, retryAfterSec: number): void {
  res.setHeader("Retry-After", String(retryAfterSec));
  sendError(res, 429, "rate_limited", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
}

const MAX_BODY_BYTES = 1 << 14; // 16 KiB. 인증 요청은 작다.

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      const text = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("invalid json"));
      }
    });
    req.on("error", reject);
  });
}

/** 안전한 string field 추출. trim 후 빈 문자열이면 null. */
export function pickStringField(input: unknown, key: string): string | null {
  if (typeof input !== "object" || input === null) return null;
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Authorization: Bearer 토큰 추출. 없거나 잘못된 형식이면 null. */
export function readBearerToken(req: IncomingMessage): string | null {
  const header = req.headers["authorization"];
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/.exec(header);
  return match ? match[1]! : null;
}
