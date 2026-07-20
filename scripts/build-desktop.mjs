import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = join(root, "apps/desktop/dist");
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    main: join(root, "apps/desktop/src/main.ts"),
    preload: join(root, "apps/desktop/src/preload.ts"),
    bridge: join(root, "apps/server/src/cli.ts"),
  },
  outdir,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outExtension: { ".js": ".cjs" },
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});

console.log("[openos] desktop build -> apps/desktop/dist");
