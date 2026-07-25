GrokGUI Rebuild — Chinese Minimal Final Source Snapshot
========================================================
Date: 2026-07-21
Contents: source code, scripts, configuration, documentation, and six-theme visual showcase.

The six built-in themes are organized into three day/night pairs:
- 素墨：素笺 · 昼 / 松烟 · 夜
- 天青：天青 · 昼 / 黛青 · 夜
- 丹漆：白瓷 · 昼 / 玄漆 · 夜

Not included by design:
- node_modules/
- dist/, dist-server/, dist-shell/
- release/ packaged applications
- .git history
- local .env files, secrets, caches, and runtime data

Restore and verify:
  npm install
  npm run typecheck
  npm run test:segmentation
  npm run test:task-runtime
  npm run architecture
  npm run build

See CHINESE_MINIMAL_REBUILD_REPORT.md for the full change and verification report.
