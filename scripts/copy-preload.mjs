import fs from "node:fs";

const source = new URL("../src/shell/preload.cjs", import.meta.url);
const destination = new URL("../dist-shell/shell/preload.cjs", import.meta.url);
fs.mkdirSync(new URL("../dist-shell/shell/", import.meta.url), { recursive: true });
fs.copyFileSync(source, destination);
