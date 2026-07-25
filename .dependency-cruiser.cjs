module.exports = {
  forbidden: [
    { name: "no-circular", severity: "error", from: {}, to: { circular: true } },
    { name: "renderer-does-not-reach-backend", severity: "error", from: { path: "^src/renderer" }, to: { path: "^src/(?:server|shell)" } },
    { name: "backend-does-not-reach-ui", severity: "error", from: { path: "^src/server" }, to: { path: "^src/(?:renderer|shell|ui)" } },
    { name: "shell-does-not-reach-implementation", severity: "error", from: { path: "^src/shell" }, to: { path: "^src/(?:renderer|server|ui)" } },
    { name: "shared-is-dependency-free", severity: "error", from: { path: "^src/shared" }, to: { path: "^src/(?:renderer|server|shell|ui)" } },
    { name: "acp-adapter-stays-extractable", severity: "error", from: { path: "^src/server/acp" }, to: { path: "^src/(?:shared|renderer|shell|ui|server/(?!acp(?:/|$)))" } },
    { name: "ui-does-not-reach-runtime", severity: "error", from: { path: "^src/ui" }, to: { path: "^src/(?:renderer|server|shell)" } },
    { name: "ui-core-stays-foundational", severity: "error", from: { path: "^src/ui/core" }, to: { path: "^src/ui/(?:primitives|components|patterns|layouts|theme)" } },
    { name: "ui-primitives-only-depend-down", severity: "error", from: { path: "^src/ui/primitives" }, to: { path: "^src/ui/(?:components|patterns|layouts)" } },
    { name: "ui-components-do-not-reach-patterns", severity: "error", from: { path: "^src/ui/components" }, to: { path: "^src/ui/(?:patterns|layouts)" } },
    { name: "ui-patterns-do-not-reach-layouts", severity: "error", from: { path: "^src/ui/patterns" }, to: { path: "^src/ui/layouts" } },
    { name: "theme-is-horizontal", severity: "error", from: { path: "^src/ui/theme" }, to: { path: "^src/ui/(?:core|primitives|components|patterns|layouts)" } },
    { name: "no-orphans", severity: "warn", from: { orphan: true, path: "^src", pathNot: "(?:main\.tsx|index\.ts|preload\.cjs|\.d\.ts)$" }, to: {} },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    includeOnly: "^src",
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".tsx", ".js", ".cjs", ".json"] },
    reporterOptions: { dot: { collapsePattern: "node_modules/[^/]+" } },
  },
};
