import { startBridgeServer } from "./create-server.js";
import { loadServerEnv } from "./env.js";
import { loadDotEnv } from "./load-dotenv.js";

loadDotEnv();
const env = loadServerEnv();

const server = startBridgeServer({
  env,
  onListening(info) {
    // 桌面 supervisor 可解析该 JSON 行作为 ready 信号
    console.log(
      JSON.stringify({
        type: "openos.desktop.bridge.ready",
        ...info,
      }),
    );
    console.error(
      `[openos-bridge] listening ${info.url} channel=${info.channel} auth=${info.authMode}`,
    );
  },
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
