// MCP JSON-RPC (Streamable HTTP). 상태를 들고 있지 않다: 요청 하나 = 응답 하나.
// 세션(Mcp-Session-Id)도, 서버가 먼저 보내는 스트림도 쓰지 않으므로 Durable Object가 필요 없다.

import { TOOLS, TOOL_BY_NAME, ToolError } from "./tools.js";

const LATEST = "2025-06-18";
const SUPPORTED = [LATEST, "2025-03-26", "2024-11-05"];

const SERVER_INFO = { name: "invest-note", title: "투자 노트", version: "1.0.0" };

const INSTRUCTIONS =
  "형진의 개인 투자 기록이다. 읽기 전용이고, 답은 한국어로 한다.\n" +
  "- 수치는 이미 계산돼 있다. 비중·수익률·PER 같은 값을 직접 다시 계산하지 말고 준 값을 쓴다.\n" +
  "- 시세는 저장된 일별 종가(지연)다. 답할 때 기준일을 같이 말한다.\n" +
  "- 투자의견(get_investment_views)은 덮어쓰지 않는 기록이다. 같은 종목의 여러 행은 생각의 변화다.\n" +
  "- 기술적 판정(get_tech_calls)은 투자의견·성과평가와 섞지 않는다. 여기서 예측형 조언을 만들지 않는다.\n" +
  "- 금액은 원화 기준이고 축약하지 않는다.";

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
const rpcOk = (id, result) => ({ jsonrpc: "2.0", id, result });

const toolList = () => ({
  tools: TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema })),
});

async function callTool(env, params) {
  const tool = TOOL_BY_NAME.get(params?.name);
  if (!tool) throw new ToolError("그런 툴이 없습니다: " + params?.name);
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
  const data = await tool.run(env, args);
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 1) }],
    structuredContent: data,
  };
}

/** 메시지 하나 처리. 알림(id 없음)이면 null을 돌려준다(응답 없음). */
export async function handleMessage(msg, env) {
  const id = msg?.id ?? null;
  const isNotification = msg?.id === undefined;
  const method = msg?.method;

  try {
    switch (method) {
      case "initialize": {
        const want = msg.params?.protocolVersion;
        return rpcOk(id, {
          protocolVersion: SUPPORTED.includes(want) ? want : LATEST,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return rpcOk(id, {});
      case "tools/list":
        return rpcOk(id, toolList());
      case "tools/call":
        return rpcOk(id, await callTool(env, msg.params));
      case "resources/list":
        return rpcOk(id, { resources: [] });
      case "prompts/list":
        return rpcOk(id, { prompts: [] });
      default:
        if (isNotification || String(method || "").startsWith("notifications/")) return null;
        return rpcError(id, -32601, "지원하지 않는 메서드입니다: " + method);
    }
  } catch (e) {
    if (isNotification) return null;
    // 툴 실행 실패는 프로토콜 오류가 아니라 '오류 결과'로 돌려준다(모델이 읽고 고쳐 부를 수 있게).
    if (method === "tools/call") {
      return rpcOk(id, { content: [{ type: "text", text: String(e.message || e) }], isError: true });
    }
    return rpcError(id, -32603, String(e.message || e));
  }
}

/** POST /mcp 본문(단일 객체 또는 배열) 처리 → 응답 본문 또는 null(전부 알림). */
export async function handleRpc(body, env) {
  if (Array.isArray(body)) {
    const out = [];
    for (const m of body) {
      const r = await handleMessage(m, env);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return handleMessage(body, env);
}

export { SERVER_INFO, INSTRUCTIONS, LATEST };
