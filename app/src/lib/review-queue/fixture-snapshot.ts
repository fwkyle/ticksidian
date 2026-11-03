/**
 * 검토 큐 fixture 스냅샷 (TICK-P0-007 검토 큐 UI 1차)
 *
 * 합성 예시 데이터다. 실제 TickTick 메모를 읽거나 각색하지 않고 새로 지어 낸 항목 50개를 담는다
 * (2026-11-02, 오픈소스 공개 준비). 제목·본문·이유는 모두 가짜이며 개인 내용이 없다.
 *
 * 형태 계약(시험이 의존한다):
 * - 항목 50개, sourceId 유일, 분류 7종 분포 아이디어 8·참고 10·실행 5·중복 의심 2·정리 후보 12·일반 메모 4·수동 검토 9
 * - 앞 3개의 제안 분류는 아이디어·참고·실행(모두 변환 가능)
 * - 수동 검토 항목은 safetyAction이 manual-review-only, 나머지는 agent-review-allowed
 * - confidence는 분류별 fixture 값이다 (실제 AI 제안 연결 시 대체).
 * - 이 파일은 손으로 관리한다. scripts/generate-review-queue-fixture.mjs는 개인 추출물이 있는
 *   비공개 환경 전용이며 이 파일을 덮어쓴다 — 공개용 데이터를 지키려면 실행하지 않는다.
 */

import type { ReviewSnapshotItem } from "./types.ts";

export const REVIEW_SNAPSHOT_FIXTURE_META = {
  sourceExport: "synthetic-example",
  exportedAt: "2026-11-02T00:00:00.000Z",
  itemCount: 50,
} as const;

export const REVIEW_SNAPSHOT_FIXTURE: readonly ReviewSnapshotItem[] = [
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-001",
    "title": "샘플 앱 아이디어: 주간 회고 카드",
    "safeContent": "매주 일요일에 한 주를 세 줄로 돌아보는 카드가 있으면 좋겠다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "구체 행동이 없는 짧은 가능성 메모다. 목적과 방식을 먼저 정한다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-002",
    "title": "예시 가이드 - 작업 흐름 정리법",
    "safeContent": "예시용 가이드입니다. 일을 처리하는 흐름을 이렇게 정리해 봅니다.\n\n1. 먼저 지금 하는 일을 단계로 나눈다.\n1-1. 단계마다 기준을 한 줄로 적는다.\n2. 일단 한 번 해 본다. 작은 실수가 나온다.\n2-1. 실수의 원인을 찾아 기준에 반영한다.\n3. 만족할 때까지 반복한다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-003",
    "title": "예시 할 일: 월간 보고서 초안 작성",
    "safeContent": "목요일까지 초안을 쓰고 금요일에 검토를 받는다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "실행",
      "reason": "해야 할 일이 분명한 항목이다. 할 일로 바꾸면 된다.",
      "confidence": 0.8
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-004",
    "title": "샘플: 읽기 목록 자동 정리",
    "safeContent": "읽고 싶은 글을 모아 두면 주제별로 묶어 주는 기능이 있으면 어떨까.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-005",
    "title": "예시 체크리스트 (초안 A)",
    "safeContent": "1. 점검 항목에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 점검 항목에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 점검 항목에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 점검 항목에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 점검 항목에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 점검 항목에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 점검 항목에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 점검 항목에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 점검 항목에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 점검 항목에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 점검 항목에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 점검 항목에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "중복 의심",
      "reason": "비슷한 제목의 다른 항목이 있다. 합칠지 먼저 확인한다.",
      "confidence": 0.45
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-006",
    "title": "예시: 프린터 용지 주문",
    "safeContent": "A4 용지 두 박스.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "실행",
      "reason": "동사로 끝나는 구체적인 행동이다. 기한만 정하면 된다.",
      "confidence": 0.8
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-007",
    "title": "샘플 정리 - 도구 비교 메모",
    "safeContent": "1. 도구 비교에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 도구 비교에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 도구 비교에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 도구 비교에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 도구 비교에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 도구 비교에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 도구 비교에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 도구 비교에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 도구 비교에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 도구 비교에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 도구 비교에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 도구 비교에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 도구 비교에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 도구 비교에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n15. 도구 비교에 대한 15번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n16. 도구 비교에 대한 16번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n17. 도구 비교에 대한 17번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n18. 도구 비교에 대한 18번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n19. 도구 비교에 대한 19번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n20. 도구 비교에 대한 20번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n21. 도구 비교에 대한 21번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n22. 도구 비교에 대한 22번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n23. 도구 비교에 대한 23번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n24. 도구 비교에 대한 24번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n25. 도구 비교에 대한 25번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n26. 도구 비교에 대한 26번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n27. 도구 비교에 대한 27번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n28. 도구 비교에 대한 28번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n29. 도구 비교에 대한 29번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n30. 도구 비교에 대한 30번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n31. 도구 비교에 대한 31번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n32. 도구 비교에 대한 32번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n33. 도구 비교에 대한 33번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n34. 도구 비교에 대한 34번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n35. 도구 비교에 대한 35번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n36. 도구 비교에 대한 36번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n37. 도구 비교에 대한 37번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n38. 도구 비교에 대한 38번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n39. 도구 비교에 대한 39번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n40. 도구 비교에 대한 40번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "나중에 다시 찾아볼 설명·링크 모음이다. 노트로 보관하면 좋다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-008",
    "title": "임시: 회의 시간 메모",
    "safeContent": "화요일 오후 3시 가능, 수요일은 어려움.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "이미 끝난 일의 흔적으로 보인다. 지워도 되는지 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-009",
    "title": "tmp 샘플 2",
    "safeContent": "x",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-010",
    "title": "예시 링크 모음 - 디자인 자료",
    "safeContent": "색상 팔레트, 글꼴 조합, 아이콘 세트 링크를 모아 둔 예시 메모.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-011",
    "title": "임시 메모 모음 (예시)",
    "safeContent": "1. 임시에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 임시에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 임시에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 임시에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 임시에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 임시에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 임시에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 임시에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 임시에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 임시에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 임시에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 임시에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 임시에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 임시에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n15. 임시에 대한 15번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n16. 임시에 대한 16번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n17. 임시에 대한 17번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n18. 임시에 대한 18번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n19. 임시에 대한 19번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n20. 임시에 대한 20번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n21. 임시에 대한 21번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n22. 임시에 대한 22번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-012",
    "title": "지난 행사 준비물 (예시)",
    "safeContent": "1. 준비물에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 준비물에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 준비물에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 준비물에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 준비물에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 준비물에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 준비물에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 준비물에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 준비물에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 준비물에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 준비물에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 준비물에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 준비물에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 준비물에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n15. 준비물에 대한 15번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n16. 준비물에 대한 16번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n17. 준비물에 대한 17번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n18. 준비물에 대한 18번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n19. 준비물에 대한 19번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n20. 준비물에 대한 20번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n21. 준비물에 대한 21번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n22. 준비물에 대한 22번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n23. 준비물에 대한 23번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n24. 준비물에 대한 24번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "이미 끝난 일의 흔적으로 보인다. 지워도 되는지 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-013",
    "title": "샘플 한 줄 메모",
    "safeContent": "오늘은 날씨가 좋았다. 산책을 길게 했다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "일반 메모",
      "reason": "분류하기 애매한 짧은 기록이다. 일반 메모로 둔다.",
      "confidence": 0.5
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-014",
    "title": "예시: 계정 정보 정리 필요",
    "safeContent": "계정 목록을 정리해야 한다는 짧은 예시 메모. 실제 값은 없다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "자동 판단이 어려운 내용이다. 직접 읽고 분류한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-015",
    "title": "샘플 쇼핑 목록 (지난달)",
    "safeContent": "우유, 빵, 건전지, 노트.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-016",
    "title": "예시 요약 - 책 읽기 노트",
    "safeContent": "1. 책 요약에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 책 요약에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 책 요약에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 책 요약에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 책 요약에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 책 요약에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 책 요약에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 책 요약에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 책 요약에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 책 요약에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 책 요약에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 책 요약에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 책 요약에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 책 요약에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n15. 책 요약에 대한 15번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n16. 책 요약에 대한 16번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n17. 책 요약에 대한 17번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n18. 책 요약에 대한 18번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-017",
    "title": "예시: 연락처 메모",
    "safeContent": "가상의 이름과 번호 자리 표시자만 적힌 예시 메모.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "민감한 정보가 섞였을 수 있어 사람이 직접 확인해야 한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-018",
    "title": "샘플 기능 구상: 빠른 캡처 위젯",
    "safeContent": "1. 기능 구상에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 기능 구상에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 기능 구상에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 기능 구상에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 기능 구상에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 기능 구상에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 기능 구상에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 기능 구상에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 기능 구상에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 기능 구상에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 기능 구상에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 기능 구상에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 기능 구상에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 기능 구상에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-019",
    "title": "예시: 운동 시간 예약",
    "safeContent": "이번 주 토요일 오전.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "실행",
      "reason": "해야 할 일이 분명한 항목이다. 할 일로 바꾸면 된다.",
      "confidence": 0.8
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-020",
    "title": "샘플: 사진 정리 규칙",
    "safeContent": "날짜별 폴더에 자동으로 넣고 중복 사진은 따로 모은다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-021",
    "title": "예시 제목만 있는 메모",
    "safeContent": "",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "구체 행동이 없는 짧은 가능성 메모다. 목적과 방식을 먼저 정한다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-022",
    "title": "빈 본문 예시 1",
    "safeContent": "",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "일반 메모",
      "reason": "특별한 행동이나 참고 가치가 없는 단순 기록이다.",
      "confidence": 0.5
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-023",
    "title": "샘플 임시 노트 (오래됨)",
    "safeContent": "예시용 오래된 노트.\n더 이상 쓰지 않는 계획이 적혀 있다.\n정리 여부를 확인할 것.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-024",
    "title": "예시 사용 설명서 요약",
    "safeContent": "1. 사용법에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 사용법에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 사용법에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 사용법에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 사용법에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 사용법에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 사용법에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 사용법에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 사용법에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-025",
    "title": "샘플 레시피 메모",
    "safeContent": "재료: 감자 두 개, 양파 하나, 소금 약간.\n순서: 썰고, 볶고, 끓인다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "나중에 다시 찾아볼 설명·링크 모음이다. 노트로 보관하면 좋다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-026",
    "title": "예시 링크 - 단축키 정리",
    "safeContent": "자주 쓰는 단축키를 표로 정리한 예시 메모.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-027",
    "title": "예시: 비밀번호 힌트 메모",
    "safeContent": "실제 값이 없는 예시. 민감 정보로 의심되는 제목 형태만 흉내 냈다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "민감한 정보가 섞였을 수 있어 사람이 직접 확인해야 한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-028",
    "title": "샘플 메모: 오늘 생각",
    "safeContent": "특별한 결론 없이 적어 둔 생각 한 줄.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "일반 메모",
      "reason": "특별한 행동이나 참고 가치가 없는 단순 기록이다.",
      "confidence": 0.5
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-029",
    "title": "예시: 주소 메모",
    "safeContent": "1. 가상 주소에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 가상 주소에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 가상 주소에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 가상 주소에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 가상 주소에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 가상 주소에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "민감한 정보가 섞였을 수 있어 사람이 직접 확인해야 한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-030",
    "title": "예시: 결제 관련 메모",
    "safeContent": "가상의 결제 내역을 정리해야 한다는 예시. 숫자는 없다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "자동 판단이 어려운 내용이다. 직접 읽고 분류한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-031",
    "title": "샘플 할 일 (끝난 것 같음)",
    "safeContent": "이미 처리한 것으로 보이는 예시 항목.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-032",
    "title": "예시 영상 시청 목록",
    "safeContent": "1. 시청 목록에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 시청 목록에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 시청 목록에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 시청 목록에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 시청 목록에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 시청 목록에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 시청 목록에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 시청 목록에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 시청 목록에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 시청 목록에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 시청 목록에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "정리된 참고 자료다. 행동 항목은 들어 있지 않다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-033",
    "title": "임시 링크 (예시)",
    "safeContent": "https://example.com/sample",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-034",
    "title": "예시 체크리스트 (초안 B)",
    "safeContent": "1. 점검 항목에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 점검 항목에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 점검 항목에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 점검 항목에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 점검 항목에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 점검 항목에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 점검 항목에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 점검 항목에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 점검 항목에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 점검 항목에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "중복 의심",
      "reason": "같은 내용이 반복된 것으로 보인다. 하나만 남길지 정한다.",
      "confidence": 0.45
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-035",
    "title": "샘플 쪽지",
    "safeContent": "내일 확인.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-036",
    "title": "예시: 서버 설정 메모",
    "safeContent": "가상의 설정 이름과 자리 표시자만 있는 예시.\nKEY=<placeholder>\n실제 비밀 값은 없다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "자동 판단이 어려운 내용이다. 직접 읽고 분류한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-037",
    "title": "임시 초안 모음 (예시)",
    "safeContent": "1. 초안에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 초안에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 초안에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 초안에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 초안에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 초안에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 초안에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 초안에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 초안에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 초안에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n11. 초안에 대한 11번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n12. 초안에 대한 12번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n13. 초안에 대한 13번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n14. 초안에 대한 14번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n15. 초안에 대한 15번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n16. 초안에 대한 16번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "오래되어 지금은 쓸모가 줄어든 임시 기록이다. 정리 여부를 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-038",
    "title": "샘플 지난 계획 메모",
    "safeContent": "1. 지난 계획에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 지난 계획에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 지난 계획에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 지난 계획에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 지난 계획에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 지난 계획에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 지난 계획에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "이미 끝난 일의 흔적으로 보인다. 지워도 되는지 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-039",
    "title": "예시 용어 정리",
    "safeContent": "자주 헷갈리는 용어를 짧게 풀어 쓴 예시 목록.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "나중에 다시 찾아볼 설명·링크 모음이다. 노트로 보관하면 좋다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-040",
    "title": "샘플 아이디어: 오프라인 지도 메모",
    "safeContent": "자주 가는 장소를 지도에 붙여 두는 메모장.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-041",
    "title": "예시 참고 - 글쓰기 규칙",
    "safeContent": "문장은 짧게.\n주어와 서술어를 가깝게.\n한 문단에 한 생각.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "참고",
      "reason": "나중에 다시 찾아볼 설명·링크 모음이다. 노트로 보관하면 좋다.",
      "confidence": 0.85
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-042",
    "title": "샘플: 음성 메모 요약",
    "safeContent": "음성 메모를 받아쓰고 세 줄로 줄여 주는 기능.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-043",
    "title": "예시: 이력서 초안",
    "safeContent": "1. 경력 항목에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 경력 항목에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 경력 항목에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 경력 항목에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 경력 항목에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 경력 항목에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n7. 경력 항목에 대한 7번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n8. 경력 항목에 대한 8번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n9. 경력 항목에 대한 9번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n10. 경력 항목에 대한 10번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "민감한 정보가 섞였을 수 있어 사람이 직접 확인해야 한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-044",
    "title": "예시: 계약 메모",
    "safeContent": "가상의 계약 조건을 정리한 예시 메모. 실제 계약과 무관하다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "자동 판단이 어려운 내용이다. 직접 읽고 분류한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-045",
    "title": "예시 할 일: 정기 점검 일정 잡기",
    "safeContent": "다음 주 중에 가능한 시간을 세 개 정한다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "실행",
      "reason": "해야 할 일이 분명한 항목이다. 할 일로 바꾸면 된다.",
      "confidence": 0.8
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-046",
    "title": "샘플 오래된 알림 메모",
    "safeContent": "지금은 필요 없는 예시 알림.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "정리 후보",
      "reason": "이미 끝난 일의 흔적으로 보인다. 지워도 되는지 확인한다.",
      "confidence": 0.55
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-047",
    "title": "예시: 서류 스캔해서 보관",
    "safeContent": "종이 서류 세 장을 스캔해 폴더에 넣는다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "실행",
      "reason": "해야 할 일이 분명한 항목이다. 할 일로 바꾸면 된다.",
      "confidence": 0.8
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-048",
    "title": "예시: 병원 예약 메모",
    "safeContent": "가상의 날짜와 시간만 적힌 예시. 개인 정보는 없다.",
    "projectName": "기본함",
    "safetyAction": "manual-review-only",
    "suggestion": {
      "classification": "수동 검토",
      "reason": "자동 판단이 어려운 내용이다. 직접 읽고 분류한다.",
      "confidence": 0.3
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-049",
    "title": "빈 본문 예시 2",
    "safeContent": "",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "일반 메모",
      "reason": "분류하기 애매한 짧은 기록이다. 일반 메모로 둔다.",
      "confidence": 0.5
    }
  },
  {
    "source": "ticktick-local-snapshot",
    "sourceId": "example-050",
    "title": "샘플: 취미 기록 앱",
    "safeContent": "1. 취미 기록에 대한 1번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n2. 취미 기록에 대한 2번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n3. 취미 기록에 대한 3번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n4. 취미 기록에 대한 4번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n5. 취미 기록에 대한 5번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.\n6. 취미 기록에 대한 6번째 메모: 예시 문장이며 실제 기록이 아니다. 항목마다 짧은 설명을 붙여 두었다.",
    "projectName": "기본함",
    "safetyAction": "agent-review-allowed",
    "suggestion": {
      "classification": "아이디어",
      "reason": "나중에 시도해 볼 만한 생각이다. 실행 계획은 아직 없다.",
      "confidence": 0.7
    }
  }
];
