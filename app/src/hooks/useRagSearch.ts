/**
 * useRagSearch
 *
 * 사이드바 "전체 검색" 모드용 RAG 하이브리드 검색 훅.
 * - 볼트 진입 시 rag_index_status 1회 조회 (인덱스 없음/미완료 안내).
 * - 400ms 디바운스 후 rag_search invoke 호출 (쿼리 임베딩 = Gemini API).
 * - 마지막 요청만 반영하는 race 가드, 볼트 전환 시 상태 초기화.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRagIndexStatus,
  ragSearch,
  type RagIndexStatus,
  type RagSearchHit,
} from '../lib/tauri-commands';
import { toErrorMessage } from '../lib/error-utils';

export type { RagIndexStatus, RagSearchHit } from '../lib/tauri-commands';

export type RagSearchMode = 'title' | 'rag';

export type RagSearchStatus =
  | 'idle'
  | 'checking-index'
  | 'ready'
  | 'searching'
  | 'done'
  | 'error';

export interface UseRagSearchResult {
  mode: RagSearchMode;
  setMode: (mode: RagSearchMode) => void;
  query: string;
  setQuery: (q: string) => void;
  activeQuery: string;
  hits: RagSearchHit[];
  status: RagSearchStatus;
  error: string | null;
  indexStatus: RagIndexStatus | null;
  search: (q: string) => Promise<void>;
}

const DEBOUNCE_MS = 400;

export function useRagSearch(vaultPath: string | null): UseRagSearchResult {
  const [mode, setMode] = useState<RagSearchMode>('title');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [hits, setHits] = useState<RagSearchHit[]>([]);
  const [status, setStatus] = useState<RagSearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<RagIndexStatus | null>(null);
  const requestIdRef = useRef(0);

  // 볼트 진입 시 인덱스 상태 조회 + 볼트 전환 시 상태 초기화
  useEffect(() => {
    requestIdRef.current += 1; // 이전 요청 무효화
    const timer = window.setTimeout(() => {
      setQuery('');
      setActiveQuery('');
      setHits([]);
      setError(null);
      setIndexStatus(null);
      if (!vaultPath) {
        setStatus('idle');
        return;
      }
      // 인덱스 조회는 타이머 콜백 안에서 시작해 상태 전이 순서를 보장한다
      // (lint: set-state-in-effect 회피 + 'checking-index'가 응답을 덮어쓰지 않게)
      const requestId = requestIdRef.current;
      setStatus('checking-index');
      void getRagIndexStatus(vaultPath)
        .then((info) => {
          if (requestId !== requestIdRef.current) return; // 볼트 전환 등으로 무효화
          setIndexStatus(info);
          setStatus(info.exists && info.indexComplete ? 'ready' : 'idle');
        })
        .catch((e) => {
          if (requestId !== requestIdRef.current) return;
          setStatus('error');
          setError(toErrorMessage(e, '검색 인덱스 상태를 확인하지 못했습니다.'));
        });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [vaultPath]);

  // 쿼리 임베딩 + 하이브리드 검색 실행
  const search = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      const requestId = ++requestIdRef.current;
      if (!vaultPath || !trimmed) {
        setHits([]);
        setActiveQuery('');
        setStatus('idle');
        return;
      }
      setStatus('searching');
      setError(null);
      try {
        const result = await ragSearch(vaultPath, trimmed, 10);
        if (requestId !== requestIdRef.current) return; // stale 응답 무시
        setHits(result);
        setActiveQuery(trimmed);
        setStatus('done');
      } catch (e) {
        if (requestId !== requestIdRef.current) return;
        setHits([]);
        setStatus('error');
        setError(toErrorMessage(e, '전체 검색에 실패했습니다.'));
      }
    },
    [vaultPath],
  );

  // 디바운스: 쿼리 변경 후 400ms 뒤 search 실행
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      requestIdRef.current += 1;
      const timer = window.setTimeout(() => {
        setHits([]);
        setActiveQuery('');
        setStatus('idle');
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      void search(query);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  return {
    mode,
    setMode,
    query,
    setQuery,
    activeQuery,
    hits,
    status,
    error,
    indexStatus,
    search,
  };
}
