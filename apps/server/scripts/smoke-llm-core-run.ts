import { createServer, type ServerResponse } from "node:http";
import { coreGenerate, isRetryableCoreError, CoreProtocolError } from "../src/llm-core/index.js";

/**
 * llm-core 冒烟：本地 mock 上游验证流式客户端九路径。
 * 1 chat SSE 流式成功        2 responses SSE 流式成功
 * 3 503 后重试成功           4 504 HTML 分类为可重试并最终抛 http_error
 * 5 responses 404 → 降级 chat 6 断流 idle 超时
 * 7 外部 abort               8 400 拒绝 stream → 非流式兜底
 * 9 网关无视 stream 回 JSON  → 按非流式解析
 */

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
}

type Behavior = (res: ServerResponse, path: string) => void;
let behavior: Behavior = () => undefined;

function sse(res: ServerResponse, events: string[], opts: { end?: boolean } = {}) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of events) res.write(e);
  if (opts.end !== false) res.end();
}

const chatChunks = (texts: string[]) => [
  ...texts.map(
    (t) =>
      `data: ${JSON.stringify({ id: "c1", model: "m", choices: [{ delta: { content: t } }] })}\n\n`,
  ),
  `data: ${JSON.stringify({ id: "c1", model: "m", choices: [{ delta: {} }], usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 } })}\n\n`,
  "data: [DONE]\n\n",
];

const responsesChunks = (texts: string[]) => [
  `event: response.created\ndata: ${JSON.stringify({ type: "response.created" })}\n\n`,
  ...texts.map(
    (t) =>
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: t })}\n\n`,
  ),
  `data: ${JSON.stringify({ type: "response.completed", response: { id: "r1", model: "m", output: [{ type: "message", content: [{ type: "output_text", text: texts.join("") }] }], usage: { input_tokens: 3, output_tokens: 5, total_tokens: 8 } } })}\n\n`,
];

async function main() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => behavior(res, req.url ?? ""));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const target = { baseUrl: base, apiKey: "k", authStyle: "bearer" as const };
  const request = {
    model: "m",
    messages: [{ role: "user" as const, content: "hi" }],
  };

  // 1 chat SSE
  behavior = (res) => sse(res, chatChunks(["Hel", "lo"]));
  {
    const deltas: string[] = [];
    const out = await coreGenerate(
      { protocol: "openai-chat", target, onDelta: (t) => deltas.push(t) },
      request,
    );
    assert(out.text === "Hello", "1 chat text");
    assert(out.usage.totalTokens === 8, "1 chat usage");
    assert(deltas.join("") === "Hello", "1 chat deltas");
  }

  // 2 responses SSE
  behavior = (res) => sse(res, responsesChunks(["Wor", "ld"]));
  {
    const out = await coreGenerate({ protocol: "openai-responses", target }, request);
    assert(out.text === "World", "2 responses text");
    assert(out.usage.promptTokens === 3, "2 responses usage");
  }

  // 3 503 一次后成功（验证退避重试）
  {
    let calls = 0;
    behavior = (res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(503, { "content-type": "application/json", "retry-after-ms": "50" });
        res.end(JSON.stringify({ error: { message: "overloaded" } }));
        return;
      }
      sse(res, chatChunks(["ok"]));
    };
    const out = await coreGenerate({ protocol: "openai-chat", target }, request);
    assert(out.text === "ok" && calls === 2, "3 retry after 503");
  }

  // 4 504 HTML：分类为可重试 http_error（maxAttempts=1 直接抛出验证分类）
  behavior = (res) => {
    res.writeHead(504, { "content-type": "text/html" });
    res.end("<html><body><h1>504 Gateway Time-out</h1></body></html>");
  };
  {
    let caught: unknown;
    try {
      await coreGenerate({ protocol: "openai-chat", target, maxAttempts: 1 }, request);
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof CoreProtocolError, "4 threw CoreProtocolError");
    assert((caught as CoreProtocolError).status === 504, "4 status 504");
    assert(isRetryableCoreError(caught), "4 classified retryable");
    assert(!(caught as CoreProtocolError).message.includes("<html>"), "4 html stripped");
  }

  // 5 responses 404 → 降级 chat
  behavior = (res, path) => {
    if (path.includes("/responses")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "unknown path" } }));
      return;
    }
    sse(res, chatChunks(["fallback"]));
  };
  {
    const out = await coreGenerate({ protocol: "openai-responses", target }, request);
    assert(out.text === "fallback", "5 protocol fallback");
  }

  // 6 断流 idle 超时
  behavior = (res) => sse(res, chatChunks(["never-ends"]).slice(0, 1), { end: false });
  {
    let caught: unknown;
    try {
      await coreGenerate(
        { protocol: "openai-chat", target, idleTimeoutMs: 300, maxAttempts: 1 },
        request,
      );
    } catch (e) {
      caught = e;
    }
    assert(
      caught instanceof CoreProtocolError && caught.kind === "timeout",
      "6 idle timeout",
    );
  }

  // 7 外部 abort
  behavior = (res) => sse(res, chatChunks(["x"]).slice(0, 1), { end: false });
  {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    let caught: unknown;
    try {
      await coreGenerate(
        { protocol: "openai-chat", target, signal: controller.signal, maxAttempts: 1 },
        request,
      );
    } catch (e) {
      caught = e;
    }
    assert(caught instanceof CoreProtocolError, "7 abort threw");
  }

  // 8 400 拒绝 stream → 非流式兜底
  behavior = (res, path) => {
    void path;
    res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "stream is not supported" } }));
    behavior = (res2) => {
      res2.writeHead(200, { "content-type": "application/json" });
      res2.end(
        JSON.stringify({ id: "n1", model: "m", choices: [{ message: { content: "nostream" } }] }),
      );
    };
  };
  {
    const out = await coreGenerate(
      { protocol: "openai-chat", target, fallbackProtocols: [] },
      request,
    );
    assert(out.text === "nostream", "8 non-stream fallback");
  }

  // 9 网关无视 stream 直接回 JSON
  behavior = (res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({ id: "j1", model: "m", choices: [{ message: { content: "plain" } }] }),
    );
  };
  {
    const out = await coreGenerate({ protocol: "openai-chat", target }, request);
    assert(out.text === "plain", "9 json passthrough");
  }

  server.close();
  console.log("llm-core smoke: ALL PASS (9/9)");
}

void main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
