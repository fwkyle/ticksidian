import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVaultBinding,
  upsertVaultBinding,
} from "../lib/tauri-commands";
import type { VaultAuthState, VaultBinding } from "../types/note";
import { toErrorMessage } from "../lib/error-utils";

interface UseVaultBindingResult {
  binding: VaultBinding | null;
  loading: boolean;
  error: string | null;
  /**
   * 영구 인증 상태(`signed_in` / `signed_out` / `reauth_required`)를 binding에 반영한다.
   * 일시 상태(signing_in/refreshing/signing_out)는 호출하지 않는다.
   *
   * 의도적으로 syncMode는 건드리지 않는다. M3 원칙: 로그인과 sync 활성화는 별도 액션이다.
   * 호출이 실패해도 throw하지 않는다 — 로컬 편집 흐름을 막지 않기 위함.
   */
  setAuthState: (next: VaultAuthState) => Promise<void>;
}

/**
 * 현재 로컬 볼트의 `vault_binding` 행을 SQLite에서 읽어오고, 처음 보는
 * 볼트라면 기본 `local_only` / `signed_out` 행을 한 번만 생성한다.
 *
 * M3-1c 추가:
 *  - `setAuthState`로 영구 인증 상태만 binding에 반영할 수 있게 한다.
 *    syncMode는 건드리지 않는다 (로그인과 동기화 활성화는 분리).
 *
 * 설계 근거:
 *  - `docs/waterfall/03-상세설계/M3-서버-동기화-인증-개요.md` §7.1, §7.2, §7.8
 *  - `docs/waterfall/03-상세설계/M3-인증-설계.md` §5, §6
 *  - `docs/waterfall/03-상세설계/tauri-볼트-동기화-메타데이터-스키마.md` §5.1
 */
export function useVaultBinding(
  vaultPath: string | null,
): UseVaultBindingResult {
  const [binding, setBinding] = useState<VaultBinding | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // setAuthState가 항상 최신 binding을 보도록 ref로도 추적.
  const bindingRef = useRef<VaultBinding | null>(null);
  useEffect(() => {
    bindingRef.current = binding;
  }, [binding]);

  useEffect(() => {
    if (!vaultPath) {
      setBinding(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setBinding(null);
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const existing = await getVaultBinding(vaultPath);
        if (cancelled) return;
        if (existing) {
          setBinding(existing);
          return;
        }

        // 처음 보는 볼트: 기본 local_only binding을 한 번 저장한다.
        // 로그인 UI/실제 인증은 아직 없으므로 auth_state는 signed_out 고정.
        const now = Date.now();
        const fresh: VaultBinding = {
          localVaultId: vaultPath,
          localVaultPath: vaultPath,
          syncMode: "local_only",
          accountId: null,
          remoteVaultId: null,
          authState: "signed_out",
          lastSyncCursor: null,
          lastSyncSummaryJson: null,
          todosMigrationDone: 0,
          createdAt: now,
          updatedAt: now,
        };
        await upsertVaultBinding(fresh);
        if (cancelled) return;
        setBinding(fresh);
      } catch (e) {
        if (cancelled) return;
        // 저장 자체가 실패해도 로컬 편집 흐름은 유지되어야 하므로 throw하지 않는다.
        // §7.1 "로컬 전용 모드는 계속 1급 기능이다"를 따른다.
        console.error("[useVaultBinding] failed:", e);
        setBinding(null);
        setError(toErrorMessage(e, "볼트 연결 정보를 불러오지 못했습니다"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [vaultPath]);

  const setAuthState = useCallback(
    async (next: VaultAuthState) => {
      const current = bindingRef.current;
      if (!current) return; // binding 아직 로드 전 → 조용히 무시
      if (current.authState === next) return;
      const updated: VaultBinding = {
        ...current,
        authState: next,
        updatedAt: Date.now(),
      };
      // 낙관적 업데이트: UI는 즉시 반영, 저장 실패해도 다음 mount 때 SQLite로 복원된다.
      setBinding(updated);
      try {
        await upsertVaultBinding(updated);
      } catch (e) {
        console.error("[useVaultBinding] setAuthState upsert failed:", e);
        // 저장 실패는 로컬 편집을 막지 않는다. 사용자에게는 따로 알리지 않는다
        // (인증 액션 자체의 실패는 useAuthState의 error 상태로 노출됨).
      }
    },
    [],
  );

  return { binding, loading, error, setAuthState };
}
