/**
 * 인증 모드 / base URL 설정.
 *
 * 공개 env(`VITE_*`)에는 절대 secret을 넣지 않는다. 여기서 읽는 두 값은
 * 모두 공개돼도 안전한 정보다:
 *  - mode: "mock" | "real"
 *  - base URL: dev 백엔드 주소. 운영 배포 시에는 build-time에 바꾼다.
 *
 * 둘 다 명시 안 하면 mock + 기본 dev URL을 쓴다 (개발 안정성 우선).
 */

export type AuthMode = "mock" | "real";

const ENV = (import.meta as ImportMeta & {
  env?: Record<string, string | undefined>;
}).env ?? {};

const RAW_MODE = ENV["VITE_TICKSIDIAN_AUTH_MODE"];
const RAW_BASE_URL = ENV["VITE_TICKSIDIAN_AUTH_BASE_URL"];

function parseMode(raw: unknown): AuthMode {
  if (raw === "real") return "real";
  // 명시 안 함 / "mock" / 잘못된 값 모두 mock으로 안전 fallback.
  return "mock";
}

function parseBaseUrl(raw: unknown): string {
  if (typeof raw === "string" && raw.trim().length > 0) {
    // 끝의 슬래시 제거해서 fetch 시 path 결합이 깨지지 않게.
    return raw.trim().replace(/\/+$/, "");
  }
  // M3-1e dev-only auth server 기본 포트.
  return "http://127.0.0.1:8787";
}

export const AUTH_MODE: AuthMode = parseMode(RAW_MODE);
export const AUTH_BASE_URL: string = parseBaseUrl(RAW_BASE_URL);
