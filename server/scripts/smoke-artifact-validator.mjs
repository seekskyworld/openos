/**
 * 阶段一冒烟：ArtifactValidator V1–V9 关键路径
 * 运行：node server/scripts/smoke-artifact-validator.mjs
 * （需先 tsc 或用 tsx 直接跑 ts 版；此处用动态 import dist）
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// 用 tsx 直接加载 ts
const runner = join(root, "scripts", "smoke-artifact-validator-run.ts");
const r = spawnSync(
  "npx",
  ["tsx", runner],
  { cwd: root, stdio: "inherit", shell: true },
);
process.exit(r.status ?? 1);
