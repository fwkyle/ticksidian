/**
 * useVaultImageFiles — 볼트 단위 이미지 파일 색인 훅 (2026-08-19 이미지 임베드 보기).
 *
 * 볼트가 바뀔 때 1회 스캔한다. v1 한계: 앱 실행 중 외부에서 이미지를 추가하면
 * 다음 스캔(재시작/붙여넣기 직후 갱신)까지 반영되지 않는다.
 * 설계: docs/waterfall/03-상세설계/이미지-임베드-보기.md 3절.
 */

import { useCallback, useEffect, useState } from "react";
import { scanVaultImageFiles } from "../lib/local-fs/image-scan";

export interface VaultImageFilesState {
  imageFiles: string[];
  reloadImageFiles: () => Promise<void>;
}

export function useVaultImageFiles(vaultPath: string | null): VaultImageFilesState {
  const [imageFiles, setImageFiles] = useState<string[]>([]);

  const reloadImageFiles = useCallback(async () => {
    // 상태 갱신은 항상 await 뒤(비동기)에서만 일어난다.
    const files = await scanVaultImageFiles().catch(() => []);
    setImageFiles(files);
  }, []);

  useEffect(() => {
    // 타이머 콜백 안에서 스캔을 시작한다(useRagSearch와 같은 패턴 —
    // effect 본문의 동기 setState 경로를 만들지 않는다).
    const timer = window.setTimeout(() => {
      void scanVaultImageFiles()
        .then((files) => setImageFiles(files))
        .catch(() => setImageFiles([]));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [vaultPath]);

  return { imageFiles, reloadImageFiles };
}
