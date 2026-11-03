import { lazy } from "react";

// 코드 스플리팅(TICK-P1-015): react-datasheet-grid + react-select가 에디터 청크에
// 통째로 묶이지 않게, DB 테이블 블록이 실제로 렌더될 때만 로드한다.
// DatabaseBlock.tsx는 비컴포넌트 export(블록 spec/슬래시 메뉴 팩토리)와 섞여 있어
// react-refresh 규칙상 lazy 컴포넌트 선언을 이 파일로 분리했다.
export const DatabaseBlockRendererLazy = lazy(() =>
  import("./DatabaseBlockRenderer").then((m) => ({ default: m.DatabaseBlockRenderer }))
);
