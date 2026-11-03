import { useEffect, useState } from "react";

export type SystemTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function getCurrentTheme(): SystemTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * OS 다크모드 설정(prefers-color-scheme)을 추적하는 hook.
 *
 * Tailwind 4 기본 `dark:` variant(media 전략)와 같은 기준을 쓰므로,
 * 이 hook이 돌려주는 값과 CSS 다크 분기가 항상 일치한다.
 * BlockNote처럼 JS prop으로 테마를 받는 라이브러리에 전달하는 용도.
 *
 * 설계: docs/design-rules.md "다크모드 토큰" (TICK-P1-005)
 */
export function useSystemTheme(): SystemTheme {
  const [theme, setTheme] = useState<SystemTheme>(getCurrentTheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DARK_QUERY);
    const handleChange = (event: MediaQueryListEvent) => {
      setTheme(event.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return theme;
}
