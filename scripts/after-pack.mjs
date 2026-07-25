import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const UNUSED_PRIVACY_KEYS = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  const plistPath = path.join(appPath, "Contents", "Info.plist");

  for (const key of UNUSED_PRIVACY_KEYS) {
    try {
      execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plistPath], { stdio: "ignore" });
    } catch {
      // Electron versions differ in which unused descriptions they pre-populate.
    }
  }

  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    "Set :NSAppTransportSecurity:NSAllowsArbitraryLoads false",
    plistPath,
  ], { stdio: "ignore" });

  const ptyPrebuilds = path.join(appPath, "Contents", "Resources", "app.asar.unpacked", "node_modules", "node-pty", "prebuilds");
  if (fs.existsSync(ptyPrebuilds)) {
    for (const platform of fs.readdirSync(ptyPrebuilds)) {
      const helper = path.join(ptyPrebuilds, platform, "spawn-helper");
      if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
    }
  }

  // Local builds have no Developer ID identity. A deep ad-hoc signature still
  // seals the complete bundle after the privacy manifest has been tightened.
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
}
