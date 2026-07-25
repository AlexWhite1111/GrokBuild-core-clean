import fs from "node:fs";

for (const directory of [
  "release",
  "release-html-components",
  "release-html-preview",
  "release-html-widgets",
  "release-theme-toggle",
]) {
  fs.rmSync(new URL(`../${directory}`, import.meta.url), {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 120,
  });
}
