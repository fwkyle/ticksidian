import { SideMenuController, type FloatingUIOptions } from "@blocknote/react";

/**
 * 본문 옆 도구(＋·⋮⋮, BlockNote 사이드 메뉴)의 배치 옵션.
 *
 * 위치 계산 라이브러리(Floating UI)의 기본값은 `left:0; top:0` + `transform: translate(x, y)`다.
 * 실제 앱의 WebKit은 transform으로 옮긴 편집 영역 밖 요소 위로 드래그하면 선택 끝점을
 * 편집 영역 위쪽(제목·화면 위쪽 줄)으로 튀게 한다. 같은 좌표를 `left/top`으로 적용하면
 * 선택이 마우스 높이의 줄을 따른다. 버튼 모양·자리·동작은 그대로다.
 * 근거: docs/waterfall/03-상세설계/본문-드래그-선택과-옆-도구.md
 *
 * SideMenuController가 이 객체를 useMemo 의존성으로 쓰므로 모듈 상수로 고정한다.
 */
const SIDE_MENU_FLOATING_OPTIONS: FloatingUIOptions = {
  useFloatingOptions: { transform: false },
};

/** BlockNoteView의 기본 사이드 메뉴(`sideMenu={false}`로 끔)를 대신한다. */
export function EditorSideMenu() {
  return <SideMenuController floatingUIOptions={SIDE_MENU_FLOATING_OPTIONS} />;
}
