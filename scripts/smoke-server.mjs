import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const root = new URL("..", import.meta.url).pathname;
const port = 47821;
const base = `http://127.0.0.1:${port}/api`;

const child = spawn("node", ["server/dist/cli.js"], {
  cwd: root,
  env: {
    ...process.env,
    OPENOS_CHANNEL: "dev",
    OPENOS_BRIDGE_PORT: String(port),
    OPENOS_BRIDGE_ALLOW_UNAUTHENTICATED: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let ready = false;
const onData = (buf) => {
  const text = buf.toString("utf8");
  process.stderr.write(text);
  if (text.includes("openos.desktop.bridge.ready")) ready = true;
};
child.stdout.on("data", onData);
child.stderr.on("data", onData);

const deadline = Date.now() + 10_000;
while (!ready && Date.now() < deadline) {
  await sleep(100);
}
if (!ready) {
  child.kill("SIGKILL");
  console.error("smoke failed: server not ready");
  process.exit(1);
}

try {
  const health = await fetch(`${base}/health`).then((r) => r.json());
  const boot = await fetch(`${base}/bootstrap`).then((r) => r.json());
  const chat = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "ping from smoke" }],
    }),
  }).then((r) => r.json());

  console.log(
    JSON.stringify(
      {
        health,
        bootstrap: {
          channel: boot.channel,
          model: boot.llm?.model,
          configured: boot.llm?.configured,
        },
        chatPreview: String(chat.content || chat.error?.message || "").slice(0, 120),
      },
      null,
      2,
    ),
  );
  if (!health.ok || !chat.content) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
}
