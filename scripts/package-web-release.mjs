import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const bundleName = `OpenOS-${version}-web`;
const releaseDir = join(root, "release");
const stageRoot = join(releaseDir, ".web-stage");
const bundleRoot = join(stageRoot, bundleName);
const archivePath = join(releaseDir, `${bundleName}.7z`);

for (const required of [
  join(root, "web", "dist", "index.html"),
  join(root, "desktop", "dist", "bridge.cjs"),
  join(root, "scripts", "web-release-server.mjs"),
  join(root, "docs", "web-deployment.md"),
]) {
  if (!existsSync(required)) {
    throw new Error(`Required build input is missing: ${required}`);
  }
}

mkdirSync(releaseDir, { recursive: true });
rmSync(stageRoot, { recursive: true, force: true });
rmSync(archivePath, { force: true });
mkdirSync(join(bundleRoot, "server"), { recursive: true });

cpSync(join(root, "web", "dist"), join(bundleRoot, "public"), { recursive: true });
copyFileSync(join(root, "desktop", "dist", "bridge.cjs"), join(bundleRoot, "server", "bridge.cjs"));
copyFileSync(join(root, "scripts", "web-release-server.mjs"), join(bundleRoot, "start.mjs"));
copyFileSync(join(root, "docs", "web-deployment.md"), join(bundleRoot, "README.md"));
copyFileSync(join(root, ".env.example"), join(bundleRoot, ".env.example"));
copyFileSync(join(root, "LICENSE"), join(bundleRoot, "LICENSE"));
copyFileSync(join(root, "NOTICE"), join(bundleRoot, "NOTICE"));
copyFileSync(
  join(root, "docs", "third-party-licenses.md"),
  join(bundleRoot, "THIRD_PARTY_LICENSES.md"),
);

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceDirty = execFileSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
}).trim().length > 0;

writeFileSync(
  join(bundleRoot, "package.json"),
  `${JSON.stringify({
    name: "openos-web-release",
    version,
    private: true,
    type: "module",
    scripts: { start: "node start.mjs" },
    engines: { node: ">=22" },
  }, null, 2)}\n`,
);
writeFileSync(
  join(bundleRoot, "RELEASE.json"),
  `${JSON.stringify({
    name: "OpenOS Web",
    version,
    commit,
    sourceDirty,
    format: 1,
  }, null, 2)}\n`,
);

const sevenZip = findSevenZip();
const result = spawnSync(
  sevenZip,
  ["a", "-t7z", "-mx=9", archivePath, bundleName],
  { cwd: stageRoot, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(`7-Zip exited with status ${result.status ?? "unknown"}.`);
}

const testResult = spawnSync(sevenZip, ["t", archivePath], { stdio: "inherit" });
if (testResult.error) throw testResult.error;
if (testResult.status !== 0) {
  throw new Error(`7-Zip archive validation failed with status ${testResult.status ?? "unknown"}.`);
}

rmSync(stageRoot, { recursive: true, force: true });
console.log(`[openos] web release -> ${archivePath} (${statSync(archivePath).size} bytes)`);

function findSevenZip() {
  const candidates = [
    process.env.SEVEN_ZIP_BIN?.trim(),
    "7zz",
    "7z",
    "7za",
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["i"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error(
    "7-Zip was not found. Install 7z/7zz/7za or set SEVEN_ZIP_BIN.",
  );
}
