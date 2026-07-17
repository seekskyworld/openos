import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 轻量 .env 加载：不覆盖已存在的 process.env。
 * 仅服务端启动时使用，避免把密钥打进前端。
 */
export function loadDotEnv(cwd = process.cwd()) {
  const candidates = [resolve(cwd, ".env"), resolve(cwd, ".env.local")];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}
