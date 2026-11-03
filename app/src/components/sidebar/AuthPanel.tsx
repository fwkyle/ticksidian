import { useState, type FormEvent } from "react";
import type {
  AuthError,
  AuthRuntimeState,
  AuthSession,
} from "../../lib/auth/auth-types";

type EntryMode = "signin" | "signup";

interface AuthPanelProps {
  runtime: AuthRuntimeState;
  session: AuthSession | null;
  error: AuthError | null;
  onSignIn: (email: string, password: string) => Promise<void>;
  /**
   * 새 계정 생성 후 자동 로그인. 성공 시 runtime이 signed_in으로 전이된다.
   * mock에서도 같은 인터페이스를 만족하므로 mock/real 둘 다 같은 버튼 흐름.
   */
  onSignUp: (email: string, password: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  /**
   * 현재 인증 모드. "real"이면 사용자에게 "dev 인증 서버 사용 중" 한 줄을
   * 보여 mock과 헷갈리지 않게 한다. "mock"이면 폼 안내 메시지만 노출.
   */
  mode: "mock" | "real";
  /**
   * Real 모드에서 사용자가 수동으로 access token 갱신을 시도하는 dev-only
   * 액션. 미제공이면 버튼을 노출하지 않는다.
   */
  onTriggerRefresh?: () => Promise<void>;
}

/**
 * 인증 상태 UI 껍데기.
 *
 * 의도:
 *  - "지금 어떤 상태인지" + "로그인/가입/로그아웃 액션"만 노출.
 *  - "동기화 시작/업로드/다운로드" 같은 표현은 절대 쓰지 않는다.
 *  - 로그인/가입 성공 후에도 자동으로 무엇이 더 일어나는 것처럼 보이게 하지 않는다.
 *
 * 일시 상태(signing_in/signing_out/refreshing)는 버튼 비활성화 + 라벨만 바꾼다.
 *
 * 가입 흐름 (M3-1e Codex 검수 후속):
 *  - 폼 위에 "로그인" / "가입" 작은 토글.
 *  - mock에서도 가입 가능 (서버 없이 메모리 set으로 중복 거름).
 *  - real에서는 POST /auth/signup → 토큰 저장 → signed_in.
 */
export function AuthPanel({
  runtime,
  session,
  error,
  onSignIn,
  onSignUp,
  onSignOut,
  mode,
  onTriggerRefresh,
}: AuthPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [entryMode, setEntryMode] = useState<EntryMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const isBusy =
    runtime === "signing_in" ||
    runtime === "signing_out" ||
    runtime === "refreshing";

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isBusy) return;
    const emailValue = email;
    const passwordValue = password;
    // 폼 입력값 비우기는 호출 후. 비밀번호는 메모리에서 빨리 떠나는 편이 안전.
    setPassword("");
    if (entryMode === "signup") {
      await onSignUp(emailValue, passwordValue);
    } else {
      await onSignIn(emailValue, passwordValue);
    }
  };

  const handleSignOut = async () => {
    if (isBusy) return;
    await onSignOut();
    setExpanded(false);
    setEntryMode("signin");
  };

  // 로그인된 상태: 이메일 + (real 모드면) dev 갱신 버튼 + 로그아웃
  if (runtime === "signed_in" && session) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-zinc-300">
        <span className="min-w-0 flex-1 truncate" title={session.email}>
          {session.email}
        </span>
        {mode === "real" && onTriggerRefresh && (
          <button
            type="button"
            onClick={() => void onTriggerRefresh()}
            disabled={isBusy}
            className="shrink-0 rounded px-1.5 py-0.5 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            title="access token 만료 시 수동 갱신 (dev-only)"
          >
            갱신
          </button>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isBusy}
          className="shrink-0 rounded px-1.5 py-0.5 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          title="로그아웃"
        >
          로그아웃
        </button>
      </div>
    );
  }

  // 일시 상태(서명 중): 폼은 닫고 라벨만 노출
  if (runtime === "signing_out" || runtime === "refreshing") {
    const label =
      runtime === "signing_out" ? "로그아웃 중…" : "세션 갱신 중…";
    return (
      <div className="text-[11px] text-gray-500 dark:text-zinc-400" aria-live="polite">
        {label}
      </div>
    );
  }

  // signed_out / signing_in / reauth_required → 로그인/가입 액션 노출
  const submitLabel =
    runtime === "signing_in"
      ? "확인 중…"
      : entryMode === "signup"
        ? "가입"
        : runtime === "reauth_required"
          ? "다시 로그인"
          : "로그인";

  if (!expanded) {
    return (
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => {
            setEntryMode("signin");
            setExpanded(true);
          }}
          className="rounded px-1.5 py-0.5 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          title={
            mode === "real"
              ? "이메일/비밀번호로 로그인 (dev 인증 서버)"
              : "이메일/비밀번호로 로그인 (현재는 mock)"
          }
        >
          {runtime === "reauth_required" ? "다시 로그인" : "로그인"}
        </button>
        <button
          type="button"
          onClick={() => {
            setEntryMode("signup");
            setExpanded(true);
          }}
          className="rounded px-1.5 py-0.5 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          title={
            mode === "real"
              ? "이메일/비밀번호로 가입 (dev 인증 서버)"
              : "이메일/비밀번호로 가입 (현재는 mock)"
          }
        >
          가입
        </button>
        {error && (
          <span
            className="truncate text-red-600 dark:text-red-400"
            title={error.message}
            aria-live="polite"
          >
            {error.message}
          </span>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5 text-[11px]">
      <div className="flex items-center gap-1 text-gray-500 dark:text-zinc-400" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={entryMode === "signin"}
          onClick={() => setEntryMode("signin")}
          disabled={isBusy}
          className={`rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            entryMode === "signin"
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
              : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700"
          } disabled:opacity-60`}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={entryMode === "signup"}
          onClick={() => setEntryMode("signup")}
          disabled={isBusy}
          className={`rounded px-1.5 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            entryMode === "signup"
              ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
              : "text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-700"
          } disabled:opacity-60`}
        >
          가입
        </button>
      </div>
      <input
        type="email"
        autoComplete="email"
        autoFocus
        placeholder="이메일"
        aria-label="이메일"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isBusy}
        className="w-full rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-gray-800 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 outline-none focus:border-blue-400 disabled:bg-gray-50 dark:disabled:bg-zinc-700"
      />
      <input
        type="password"
        autoComplete={entryMode === "signup" ? "new-password" : "current-password"}
        placeholder={
          entryMode === "signup" ? "비밀번호 (최소 8자)" : "비밀번호"
        }
        aria-label={entryMode === "signup" ? "비밀번호 (최소 8자)" : "비밀번호"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={isBusy}
        className="w-full rounded border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2 py-1 text-gray-800 dark:text-zinc-100 placeholder:text-gray-400 dark:placeholder:text-zinc-500 outline-none focus:border-blue-400 disabled:bg-gray-50 dark:disabled:bg-zinc-700"
      />
      <div className="flex items-center justify-between gap-1">
        <button
          type="submit"
          disabled={isBusy}
          className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {submitLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            setExpanded(false);
            setPassword("");
          }}
          disabled={isBusy}
          className="rounded px-2 py-1 text-gray-500 dark:text-zinc-400 hover:bg-gray-200 dark:hover:bg-zinc-700 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          취소
        </button>
      </div>
      {error && (
        <p className="text-red-600 dark:text-red-400" aria-live="polite">
          {error.message}
        </p>
      )}
      <p className="text-gray-400 dark:text-zinc-500">
        {mode === "real"
          ? "dev 인증 서버를 사용 중입니다. 토큰은 메모리에만 보관되어 앱을 다시 켜면 다시 로그인해야 합니다."
          : "현재는 mock 인증입니다. 실제 서버 연결은 VITE_TICKSIDIAN_AUTH_MODE=real 로 전환합니다."}
      </p>
    </form>
  );
}
