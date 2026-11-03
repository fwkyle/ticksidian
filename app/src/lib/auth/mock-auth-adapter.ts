import type { AuthAdapter, SignInResult } from "./auth-adapter";
import type { AuthSession } from "./auth-types";

/**
 * M3-1c 임시 인증 어댑터. 실제 서버 API/토큰 저장 없음.
 *
 * 목적은 "로그인 상태가 바뀌어도 로컬 볼트 편집은 계속된다"는 구조를
 * UI 레이어에서 먼저 굳히는 것이다.
 *
 * 안전 약속:
 *  - 비밀번호를 어디에도 저장하지 않는다.
 *  - 비밀번호를 로그에 남기지 않는다.
 *  - access/refresh token을 만들지 않는다(또는 더미를 메모리에만 둔다).
 *  - 페이지 새로고침/앱 재시작 후에는 항상 signed_out으로 시작한다
 *    (`getCurrentSession()`이 null을 돌려준다).
 */
const FAKE_LATENCY_MS = 250;

let currentSession: AuthSession | null = null;
/** 가입한 이메일만 추적해 동일 이메일 재가입을 `email_already_exists`로 거른다. */
const registeredEmails = new Set<string>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimEmail(email: string): string {
  return email.trim();
}

export const mockAuthAdapter: AuthAdapter = {
  async getCurrentSession(): Promise<AuthSession | null> {
    // 메모리 only — 새 탭/리로드 후에는 null이 정상 동작이다.
    return currentSession;
  },

  async signIn(email: string, password: string): Promise<SignInResult> {
    await delay(FAKE_LATENCY_MS);

    const trimmedEmail = trimEmail(email);
    if (!trimmedEmail) {
      return {
        ok: false,
        code: "invalid_credentials",
        message: "이메일을 입력해 주세요.",
      };
    }
    // 비밀번호 길이만 보고, 실제 값은 어디에도 저장/로그하지 않는다.
    if (password.length < 1) {
      return {
        ok: false,
        code: "invalid_credentials",
        message: "비밀번호를 입력해 주세요.",
      };
    }

    const session: AuthSession = {
      accountId: `mock:${trimmedEmail.toLowerCase()}`,
      email: trimmedEmail,
    };
    currentSession = session;
    return { ok: true, session };
  },

  async signUp(email: string, password: string): Promise<SignInResult> {
    await delay(FAKE_LATENCY_MS);

    const trimmedEmail = trimEmail(email);
    if (!trimmedEmail) {
      return {
        ok: false,
        code: "invalid_credentials",
        message: "이메일을 입력해 주세요.",
      };
    }
    if (password.length < 1) {
      return {
        ok: false,
        code: "invalid_credentials",
        message: "비밀번호를 입력해 주세요.",
      };
    }
    const lower = trimmedEmail.toLowerCase();
    if (registeredEmails.has(lower)) {
      return {
        ok: false,
        code: "email_already_exists",
        message: "이미 가입된 이메일입니다.",
      };
    }
    registeredEmails.add(lower);

    const session: AuthSession = {
      accountId: `mock:${lower}`,
      email: trimmedEmail,
    };
    currentSession = session;
    return { ok: true, session };
  },

  async signOut(): Promise<void> {
    await delay(FAKE_LATENCY_MS);
    currentSession = null;
  },

  async refreshSession(): Promise<AuthSession | null> {
    await delay(FAKE_LATENCY_MS);
    // mock에서는 메모리에 세션이 살아 있으면 그대로 갱신 성공으로 본다.
    return currentSession;
  },
};

/** 테스트용. 어떤 production 코드에서도 호출하지 말 것. */
export function __resetMockAuthAdapter(): void {
  currentSession = null;
  registeredEmails.clear();
}
