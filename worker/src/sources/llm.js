// 스크린샷 → 보유 종목 rows. 공급자는 미정(SPEC §10)이라 어댑터로 분리한다.
// 공급자를 추가하려면 PROVIDERS에 함수 하나를 넣고 wrangler.toml의 IMPORT_LLM_PROVIDER/MODEL을 바꾼다.
// 프롬프트와 rows 형식은 기존 worker.js 그대로다. 앱은 공급자를 모른다.

export const EXTRACT_PROMPT =
`이미지는 증권사 앱이나 웹의 보유 종목 목록 화면이다. 표의 각 행을 읽어 JSON만 출력한다.

{"rows":[{"name":"","ticker":"","currency":"KRW","qty":null,"avgPrice":null,"currentPrice":null,"marketValue":null,"profit":null}]}

규칙:
- name 은 화면에 보이는 종목명 그대로.
- ticker 는 티커나 6자리 종목코드. 안 보이면 빈 문자열.
- currency 는 금액이 원으로 표시되면 "KRW", 달러면 "USD".
- qty(수량), avgPrice(평균단가), currentPrice(현재가), marketValue(평가금액), profit(평가손익)
  은 화면에 실제로 보이는 값만 숫자로 넣고, 없으면 null 로 둔다. 추측하지 않는다.
- 숫자에서 쉼표, 원, 달러, %, 화살표는 빼고 값만. 손실이나 하락은 음수.
- 합계 행, 현금 행, 요약 카드는 제외하고 개별 종목만.
- 설명이나 코드블록 없이 JSON 객체 하나만 출력한다.`;

async function anthropic({ env, model, mediaType, b64 }) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: EXTRACT_PROMPT },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error("Claude API " + res.status + ": " + (await res.text()).slice(0, 300));
  const out = await res.json();
  const text = (out.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, usage: out.usage || null };
}

// 로컬 개발·테스트용: 이미지를 보지 않고 정해진 가짜 행을 돌려준다. .dev.vars에서만 켠다.
// 이미 있는 종목(수량 변화), 새 종목, 읽기 실패 행을 섞어 미리보기·변화 감지를 확인할 수 있게 했다.
async function mock() {
  const rows = [
    { name: "삼성전자", ticker: "005930", currency: "KRW", qty: 8, avgPrice: 71000, currentPrice: null, marketValue: null, profit: null },
    { name: "애플", ticker: "AAPL", currency: "USD", qty: 2, avgPrice: 190.5, currentPrice: 228.1, marketValue: null, profit: null },
    { name: "", ticker: "", currency: "KRW", qty: null, avgPrice: null, currentPrice: null, marketValue: null, profit: null },
  ];
  return { text: "```json\n" + JSON.stringify({ rows }) + "\n```", usage: null };
}

const PROVIDERS = {
  anthropic: { keyName: "ANTHROPIC_API_KEY", defaultModel: "claude-sonnet-5", call: anthropic },
  mock: { keyName: null, defaultModel: "mock", call: mock },
};

export function importProvider(env) {
  const name = env.IMPORT_LLM_PROVIDER || "anthropic";
  const p = PROVIDERS[name];
  if (!p) return { error: "알 수 없는 IMPORT_LLM_PROVIDER: " + name };
  if (p.keyName && !env[p.keyName]) return { error: "워커에 " + p.keyName + " 시크릿이 없습니다 (스크린샷 가져오기 꺼짐)" };
  return { name, model: env.IMPORT_LLM_MODEL || p.defaultModel, call: p.call };
}

/** 모델이 코드블록으로 감싸도 JSON만 꺼낸다. */
export function parseRows(text) {
  const cleaned = String(text).replace(/```json/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed.rows) ? parsed.rows : [];
}
