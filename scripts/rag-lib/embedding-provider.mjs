// Gemini 임베딩 프로바이더 — API 클라이언트(재시도/정규화/동시성 제한).
// 원래 scripts/rag-index-lib.mjs(898줄)의 API 클라이언트 책임 분리(2026-08-15 리팩토링).
//
// (2026-08-16 F2) API 키는 URL 쿼리(`?key=`)가 아니라 `x-goog-api-key` 헤더로 보낸다.
// URL에 키가 있으면 fetch 실패 로그, 프록시 로그, 오류 문자열로 키가 새어나갈 수 있다.
// Rust 쪽(src-tauri/src/rag/gemini_http.rs)과 같은 방식으로 맞췄다. 2026-08-16 실측 HTTP 200.

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const GEMINI_EMBEDDING_DIMENSIONS = 768;
// 호환 별칭: 기본 임베딩 차원(Gemini). 과거 로컬 E5(384)는 제거됐다.
export const EMBEDDING_DIMENSIONS = GEMINI_EMBEDDING_DIMENSIONS;
const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MAX_RETRIES = 5;
const GEMINI_CONCURRENCY = Number(process.env.GEMINI_EMBED_CONCURRENCY) || 8;

export class GeminiEmbeddingProvider {
  constructor({ model = GEMINI_EMBEDDING_MODEL, apiKey = process.env.GEMINI_API_KEY, dimensions = GEMINI_EMBEDDING_DIMENSIONS, maxTextLength = 8000 } = {}) {
    this.model = model;
    this.apiKey = apiKey;
    this.dimensions = dimensions;
    this.maxTextLength = maxTextLength;
    this._validate();
  }

  _validate() {
    if (!this.apiKey) throw new Error('GeminiEmbeddingProvider: GEMINI_API_KEY env 누락. 키가 든 env 파일을 source/eval 하거나 GEMINI_API_KEY 를 export 하세요.');
    if (!Number.isInteger(this.dimensions) || this.dimensions < 1) throw new Error('GeminiEmbeddingProvider: dimensions 는 양의 정수');
  }

  /** 모델 액션 URL. **API 키를 포함하지 않는다**(키는 헤더로만 보낸다). */
  static endpoint(model) {
    return `${GEMINI_ENDPOINT}/${model}:embedContent`;
  }

  static normalize(values) {
    let norm = 0;
    for (const x of values) norm += x * x;
    norm = Math.sqrt(norm) || 1;
    return values.map((x) => x / norm);
  }

  async embedSingle(text, taskType) {
    const body = JSON.stringify({
      content: { parts: [{ text: text.slice(0, this.maxTextLength) }] },
      taskType,
      outputDimensionality: this.dimensions,
    });
    let lastError;
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
      let res;
      try {
        res = await fetch(GeminiEmbeddingProvider.endpoint(this.model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body,
        });
      } catch (error) { lastError = error; }
      if (res && res.ok) {
        const json = await res.json();
        const values = json.embedding?.values;
        if (!values || !Array.isArray(values) || values.length !== this.dimensions) {
          throw new Error('GeminiEmbeddingProvider: 응답 벡터 차원 불일치');
        }
        return new Float32Array(GeminiEmbeddingProvider.normalize(values));
      }
      const status = res?.status;
      const retryable = !res || status === 429 || status === 503 || (status >= 500 && status < 600);
      if (!retryable) {
        const detail = res ? await res.text() : 'no response';
        throw new Error(`GeminiEmbeddingProvider: 실패 ${status} — ${detail.slice(0, 200)}`);
      }
      lastError = new Error(`GeminiEmbeddingProvider: 재시도 ${status ?? '네트워크'} (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES + 1})`);
      const retryAfter = res?.headers.get('Retry-After');
      const waitMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 30000) : Math.min(1000 * 2 ** attempt, 30000);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    throw lastError ?? new Error('GeminiEmbeddingProvider: 재시도 전부 실패');
  }

  async embed(texts, kind = 'passage', batchSize = GEMINI_CONCURRENCY) {
    if (texts.length === 0) return [];
    const taskType = kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
    // 동시성 제한 병렬: 한 번에 batchSize 개씩 API 호출 (429/503 은 embedSingle 이 지수 백오프).
    const concurrency = Math.max(1, batchSize);
    const results = new Array(texts.length);
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const index = cursor++;
        if (index >= texts.length) return;
        results[index] = await this.embedSingle(texts[index], taskType);
      }
    };
    const workers = Array.from({ length: Math.min(concurrency, texts.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
