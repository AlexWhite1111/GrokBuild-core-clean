import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceApp = path.join(root, "release", "mac-arm64", "Grok Build.app");
const installedApp = "/Applications/Grok Build.app";
const stagingApp = `/Applications/.Grok Build.installing-${process.pid}.app`;
const backupApp = `/Applications/.Grok Build.previous-${process.pid}.app`;
const startedAt = performance.now();

let installedMoved = false;
let replacementMoved = false;
let rollbackNeeded = false;
let wasRunning = false;
let applicationStopped = false;

try {
  requireApplication(sourceApp, "packaged application");
  verifyBundleIdentifier(sourceApp);
  const sourceHash = appArchiveHash(sourceApp);
  wasRunning = isInstalledApplicationRunning();

  removeIfPresent(stagingApp);
  removeIfPresent(backupApp);
  run("/usr/bin/ditto", [sourceApp, stagingApp]);
  verifyBundleIdentifier(stagingApp);
  requireMatchingHash(sourceHash, stagingApp, "staged application");

  if (wasRunning) {
    quitInstalledApplication();
    applicationStopped = true;
  }

  rollbackNeeded = true;
  if (fs.existsSync(installedApp)) {
    fs.renameSync(installedApp, backupApp);
    installedMoved = true;
  }
  fs.renameSync(stagingApp, installedApp);
  replacementMoved = true;

  verifyBundleIdentifier(installedApp);
  requireMatchingHash(sourceHash, installedApp, "installed application");
  rollbackNeeded = false;
  removeIfPresent(backupApp);
  installedMoved = false;
  replacementMoved = false;

  if (wasRunning) {
    relaunchInstalledApplication();
    applicationStopped = false;
  }

  const elapsedSeconds = ((performance.now() - startedAt) / 1_000).toFixed(2);
  process.stdout.write([
    "Replaced /Applications/Grok Build.app",
    `- app.asar SHA-256: ${sourceHash}`,
    `- previous instance running: ${wasRunning ? "yes" : "no"}`,
    `- relaunched: ${wasRunning ? "yes" : "no"}`,
    `- replacement time: ${elapsedSeconds}s`,
    "",
  ].join("\n"));
} catch (cause) {
  if (rollbackNeeded) {
    if (replacementMoved) removeIfPresent(installedApp);
    if (installedMoved && fs.existsSync(backupApp)) fs.renameSync(backupApp, installedApp);
  }
  removeIfPresent(stagingApp);
  if (wasRunning && applicationStopped && fs.existsSync(installedApp)) {
    try { run("/usr/bin/open", [installedApp]); }
    catch { /* retain the original replacement error below */ }
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`macOS application replacement failed: ${message}\n`);
  process.exitCode = 1;
}

function requireApplication(appPath, label) {
  const info = fs.statSync(appPath, { throwIfNoEntry: false });
  if (!info?.isDirectory()) throw new Error(`${label} is missing: ${appPath}`);
  const archive = path.join(appPath, "Contents", "Resources", "app.asar");
  if (!fs.statSync(archive, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`${label} has no app.asar: ${archive}`);
  }
}

function verifyBundleIdentifier(appPath) {
  requireApplication(appPath, "application");
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", appPath]);
  const plist = path.join(appPath, "Contents", "Info.plist");
  const identifier = run("/usr/bin/plutil", [
    "-extract", "CFBundleIdentifier", "raw", "-o", "-", plist,
  ]).trim();
  if (identifier !== "com.alexwhite.grokbuild") {
    throw new Error(`unexpected bundle identifier ${JSON.stringify(identifier)} in ${appPath}`);
  }
}

function appArchiveHash(appPath) {
  const archive = path.join(appPath, "Contents", "Resources", "app.asar");
  return crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex");
}

function requireMatchingHash(expected, appPath, label) {
  const actual = appArchiveHash(appPath);
  if (actual !== expected) {
    throw new Error(`${label} hash mismatch: expected ${expected}, received ${actual}`);
  }
}

function isInstalledApplicationRunning() {
  return spawnSync("/usr/bin/pgrep", ["-f", installedExecutablePattern()], {
    stdio: "ignore",
  }).status === 0;
}

function installedExecutablePattern() {
  return "^/Applications/Grok Build\\.app/Contents/MacOS/Grok Build$";
}

function quitInstalledApplication() {
  spawnSync("/usr/bin/osascript", [
    "-e", 'tell application id "com.alexwhite.grokbuild" to quit',
  ], { stdio: "ignore", timeout: 10_000 });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!isInstalledApplicationRunning()) return;
    sleep(200);
  }
  throw new Error("the running Grok Build application did not quit within 15 seconds");
}

function relaunchInstalledApplication() {
  run("/usr/bin/open", [installedApp]);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (isInstalledApplicationRunning()) return;
    sleep(200);
  }
  throw new Error("the replaced Grok Build application did not relaunch within 15 seconds");
}

function removeIfPresent(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
