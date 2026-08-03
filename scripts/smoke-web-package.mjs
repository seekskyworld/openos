import { createServer } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const bundleName = `OpenOS-${packageJson.version}-web`;
const archivePath = join(root, "release", `${bundleName}.7z`);
const extractionRoot = join(root, "release", ".web-smoke");
const bundleRoot = join(extractionRoot, bundleName);

if (!existsSync(archivePath)) {
  throw new Error(`Web release archive is missing: ${archivePath}. Run npm run web:dist first.`);
}

const sevenZip = findSevenZip();
run(sevenZip, ["t", archivePath]);
rmSync(extractionRoot, { recursive: true, force: true });
run(sevenZip, ["x", "-y", `-o${extractionRoot}`, archivePath]);

for (const required of [
  "public/index.html",
  "server/bridge.cjs",
  "start.mjs",
  "README.md",
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_LICENSES.md",
  "RELEASE.json",
]) {
  if (!existsSync(join(bundleRoot, required))) {
    throw new Error(`Archive entry is missing: ${required}`);
  }
}

const entries = walk(bundleRoot).map((path) => relative(bundleRoot, path));
const forbidden = entries.find((entry) =>
  /(^|\/)(?:\.env|data|\.openos)(?:$|\/)|\.(?:map|log)$/u.test(entry) &&
  entry !== ".env.example"
);
if (forbidden) throw new Error(`Archive contains forbidden runtime data: ${forbidden}`);

const [webPort, bridgePort] = await Promise.all([reservePort(), reservePort()]);
const child = spawn(process.execPath, [join(bundleRoot, "start.mjs")], {
  cwd: bundleRoot,
  env: {
    ...process.env,
    OPENOS_WEB_HOST: "127.0.0.1",
    OPENOS_WEB_PORT: String(webPort),
    OPENOS_BRIDGE_PORT: String(bridgePort),
    OPENOS_DATA_DIR: join(extractionRoot, "data"),
    OPENOS_GENAPPS_FAKE: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString("utf8");
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString("utf8");
});

try {
  try {
    await waitForReady(child, () => output.includes('"type":"openos.web.ready"'));
    const baseUrl = `http://127.0.0.1:${webPort}`;
    const indexResponse = await fetch(baseUrl);
    const index = await indexResponse.text();
    assert(indexResponse.ok && index.includes('<div id="root"></div>'), "Web index did not render.");
    assert(indexResponse.headers.get("x-content-type-options") === "nosniff", "Security header missing.");

    const assetPath = index.match(/(?:src|href)="(\.\/assets\/[^"]+)"/u)?.[1];
    assert(assetPath, "Built asset reference is missing from index.html.");
    const assetResponse = await fetch(new URL(assetPath, `${baseUrl}/`));
    assert(assetResponse.ok, "Built asset could not be loaded.");

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    const health = await healthResponse.json();
    assert(healthResponse.ok && health?.ok === true, "Proxied Bridge health check failed.");

    const fallbackResponse = await fetch(`${baseUrl}/launchpad`);
    const fallback = await fallbackResponse.text();
    assert(fallbackResponse.ok && fallback.includes('<div id="root"></div>'), "SPA fallback failed.");

    const traversalResponse = await fetch(`${baseUrl}/%2e%2e%2fLICENSE`);
    assert(traversalResponse.status === 403, "Encoded path traversal was not rejected.");
    const methodResponse = await fetch(baseUrl, { method: "POST" });
    assert(methodResponse.status === 405, "Static host accepted an unsupported method.");
  } finally {
    await stop(child);
  }
  assertRemoteBindingBlocked();
} finally {
  rmSync(extractionRoot, { recursive: true, force: true });
}

console.log(`[openos] web package smoke PASS (${entries.length} files)`);

function findSevenZip() {
  for (const candidate of [process.env.SEVEN_ZIP_BIN?.trim(), "7zz", "7z", "7za"].filter(Boolean)) {
    const probe = spawnSync(candidate, ["i"], { stdio: "ignore" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error("7-Zip was not found.");
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "ignore" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with status ${result.status ?? "unknown"}.`);
  }
}

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

function reservePort() {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer();
    server.once("error", rejectPort);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => error ? rejectPort(error) : resolvePort(port));
    });
  });
}

function waitForReady(processHandle, predicate) {
  return new Promise((resolveReady, rejectReady) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      processHandle.stdout.off("data", check);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const timeout = setTimeout(() => {
      finish(new Error(`Web package timed out.\n${output}`));
    }, 30_000);
    const check = () => {
      if (!predicate()) return;
      finish();
    };
    processHandle.stdout.on("data", check);
    processHandle.once("exit", (code) => {
      finish(new Error(`Web package exited before ready (code=${code ?? "?"}).\n${output}`));
    });
    check();
  });
}

function assertRemoteBindingBlocked() {
  const result = spawnSync(process.execPath, [join(bundleRoot, "start.mjs")], {
    cwd: bundleRoot,
    env: {
      ...process.env,
      OPENOS_WEB_HOST: "0.0.0.0",
      OPENOS_WEB_ALLOW_REMOTE: "",
    },
    encoding: "utf8",
  });
  const blockedOutput = `${result.stdout || ""}\n${result.stderr || ""}`;
  assert(result.status !== 0, "Remote binding unexpectedly started without explicit authorization.");
  assert(
    blockedOutput.includes("Remote binding is disabled"),
    `Remote binding failed for the wrong reason.\n${blockedOutput}`,
  );
}

async function stop(processHandle) {
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  processHandle.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => processHandle.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (processHandle.exitCode === null && processHandle.signalCode === null) {
    processHandle.kill("SIGKILL");
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
