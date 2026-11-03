/**
 * 인증 토큰 저장 wrapper.
 *
 * 책임 분담 (M3-1f 갱신):
 *  - access token : 항상 메모리 only. 새로고침/재시작 = 사라짐 → refresh로 재발급.
 *  - access expiry: 메모리 only(초 단위 절대 시각 ms). proactive timer는 두지
 *    않고 401 reactive refresh를 기본 안전망으로 쓴다 (만료 사전 추적 §4 참고).
 *  - refresh token: 가능하면 OS-level secure storage(keyring 기반 Tauri command)
 *    에 저장한다. Tauri 환경이 아니거나 backend가 막혀 있으면 메모리 fallback.
 *
 * 절대 금지:
 *  - localStorage / sessionStorage 사용
 *  - 평문 JSON 파일 저장
 *  - 토큰 값을 console.log
 *
 * 보안 trade-off:
 *  - secure backend가 실패해 메모리로 fallback하더라도, 토큰은 디스크에는 절대
 *    남지 않는다(메모리만). 사용자 입장에서 "재시작 후 자동 로그인 안 됨"이
 *    drawback. 안전성은 유지.
 *
 * 인터페이스 형태:
 *  - 핵심 동작 3개(getRefreshToken/setTokens/clear)는 sync getter 한 번 + async
 *    persist 한 번이다. async persist는 fire-and-forget 또는 await 둘 다 가능.
 *  - hydrate()는 앱 시작 시 1회 호출하면 메모리 캐시에 secure backend의 값을
 *    채운다. 그 뒤로는 sync getter가 즉시 동작한다.
 */

import {
  secureClearRefreshToken,
  secureGetRefreshToken,
  secureSetRefreshToken,
} from "../tauri-commands";

export interface AuthTokenStore {
  /** 메모리 캐시에서 access token을 읽는다. 없으면 null. */
  getAccessToken(): string | null;
  /**
   * access token의 만료 예상 시각(epoch ms). 발급 시 `expiresInSec`을
   * 더해 저장한다. 없으면 null. 401 response가 1차 진실이지만, UI에서
   * "거의 만료" 표시가 필요하면 이 값을 같이 본다.
   */
  getAccessTokenExpiresAt(): number | null;
  /** 메모리 캐시에서 refresh token을 읽는다. 없으면 null. */
  getRefreshToken(): string | null;
  /**
   * 토큰 두 개와 만료(s)를 한 번에 저장한다. 메모리는 즉시 반영되고,
   * refresh token은 secure backend에 비동기로 persist된다.
   * persist 실패는 memory-only fallback으로 처리하고 reject하지 않는다.
   */
  setTokens(
    accessToken: string,
    refreshToken: string,
    expiresInSec: number,
  ): Promise<void>;
  /** 둘 다 비우고 secure backend도 정리한다. */
  clear(): Promise<void>;
  /**
   * 앱 시작 시 1회 호출. secure backend에서 refresh token을 읽어 메모리 캐시에
   * 채운다. access token은 채우지 않는다(메모리 only 정책).
   * 실패하면 조용히 무시하고 빈 상태로 둔다.
   */
  hydrate(): Promise<void>;
}

/**
 * 메모리 캐시 한 곳을 두고, refresh token만 plug-in 가능한 SecureBackend로
 * persist한다. 둘이 분리돼 있어 backend가 실패해도 메모리는 정상 동작한다.
 */
export interface SecureRefreshBackend {
  /** persisted refresh token을 읽는다. 없으면 null. 실패 시 throw. */
  load(): Promise<string | null>;
  /** persist. 실패 시 throw. */
  save(token: string): Promise<void>;
  /** 폐기. 실패 시 throw. 이미 없으면 throw하지 않고 조용히 성공. */
  clear(): Promise<void>;
}

class TokenStoreImpl implements AuthTokenStore {
  private accessToken: string | null = null;
  private accessTokenExpiresAtMs: number | null = null;
  private refreshToken: string | null = null;
  private hydrated = false;
  private backend: SecureRefreshBackend | null;

  constructor(backend: SecureRefreshBackend | null) {
    this.backend = backend;
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getAccessTokenExpiresAt(): number | null {
    return this.accessTokenExpiresAtMs;
  }

  getRefreshToken(): string | null {
    return this.refreshToken;
  }

  async setTokens(
    accessToken: string,
    refreshToken: string,
    expiresInSec: number,
  ): Promise<void> {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.accessTokenExpiresAtMs = Number.isFinite(expiresInSec)
      ? Date.now() + expiresInSec * 1000
      : null;
    if (this.backend) {
      try {
        await this.backend.save(refreshToken);
      } catch (err) {
        // memory-only fallback. 토큰 값은 절대 로그에 남기지 않는다.
        console.error(
          "[authTokenStore] secure backend save failed; memory only:",
          err,
        );
      }
    }
  }

  async clear(): Promise<void> {
    this.accessToken = null;
    this.accessTokenExpiresAtMs = null;
    this.refreshToken = null;
    if (this.backend) {
      try {
        await this.backend.clear();
      } catch (err) {
        console.error("[authTokenStore] secure backend clear failed:", err);
      }
    }
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!this.backend) return;
    try {
      const stored = await this.backend.load();
      if (stored && this.refreshToken === null) {
        this.refreshToken = stored;
      }
    } catch (err) {
      console.error("[authTokenStore] secure backend load failed:", err);
    }
  }
}

/**
 * Tauri invoke 기반 secure backend.
 *
 * 비-Tauri 환경(브라우저 단독 vite dev)에서는 `__TAURI_INTERNALS__` global이
 * 없어 invoke가 throw한다. 그 경우 backend를 빼고 memory-only로 돈다.
 */
const tauriSecureBackend: SecureRefreshBackend = {
  async load(): Promise<string | null> {
    return secureGetRefreshToken();
  },
  async save(token: string): Promise<void> {
    return secureSetRefreshToken(token);
  },
  async clear(): Promise<void> {
    return secureClearRefreshToken();
  },
};

function detectTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  // Tauri 2가 노출하는 internals. 없으면 브라우저 단독 환경.
  return Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}

function pickBackend(): SecureRefreshBackend | null {
  return detectTauriRuntime() ? tauriSecureBackend : null;
}

/**
 * 앱 전체에서 공유되는 단일 인스턴스. realAuthAdapter와 useAuthState가
 * 같은 store를 보게 하기 위해 module-level singleton.
 *
 * Tauri runtime이면 secure backend를 끼우고, 아니면 메모리 only.
 */
export const authTokenStore: AuthTokenStore = new TokenStoreImpl(pickBackend());

/** 테스트 전용. */
export function __createMemoryAuthTokenStoreForTests(): AuthTokenStore {
  return new TokenStoreImpl(null);
}
