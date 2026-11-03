// 머리말(frontmatter) 한 줄 직렬화 규칙 — 편집기 저장과 닫힌 노트 메타 변경이 함께 쓴다.
// 설계: docs/waterfall/03-상세설계/옵시디언-원본-최소-frontmatter.md

export function formatYamlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

/** 문자열·배열·객체는 JSON 호환 YAML로 쓴다. 직렬화할 수 없는 값은 `null`로 쓴다(편집기 저장 호환). */
export function formatYamlValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  const json = JSON.stringify(value);
  return json === undefined ? "null" : json;
}

/** `formatYamlValue`와 같은 결과지만, 직렬화할 수 없으면 `null`로 바꾸지 않고 오류를 던진다. */
export function formatYamlValueStrict(key: string, value: unknown): string {
  if (typeof value !== "string" && JSON.stringify(value) === undefined) {
    throw new Error(`머리말 값 '${key}'을 저장 형식으로 바꿀 수 없어 변경을 멈췄습니다.`);
  }
  return formatYamlValue(value);
}
