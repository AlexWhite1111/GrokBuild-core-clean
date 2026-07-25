import assert from "node:assert/strict";
import test from "node:test";
import {
  isAllowedRendererPermission,
  isTrustedAppUrl,
  isTrustedRendererFrame,
} from "./policy.js";

const PORT = 43123;

test("desktop trust is limited to the active loopback application URL", () => {
  assert.equal(isTrustedAppUrl(`http://127.0.0.1:${PORT}/tasks/fixture`, PORT), true);
  assert.equal(isTrustedAppUrl(`http://localhost:${PORT}/tasks/fixture`, PORT), false);
  assert.equal(isTrustedAppUrl(`http://127.0.0.1:${PORT + 1}`, PORT), false);
  assert.equal(isTrustedAppUrl(`https://127.0.0.1:${PORT}`, PORT), false);
  assert.equal(isTrustedAppUrl("not-a-url", PORT), false);
});

test("privileged renderer access additionally requires the main frame", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  assert.equal(isTrustedRendererFrame(url, true, PORT), true);
  assert.equal(isTrustedRendererFrame(url, false, PORT), false);
  assert.equal(isTrustedRendererFrame("https://example.com", true, PORT), false);
});

test("personal-app clipboard conveniences remain limited to the trusted renderer", () => {
  const origin = `http://127.0.0.1:${PORT}`;
  assert.equal(isAllowedRendererPermission("clipboard-read", origin, PORT), true);
  assert.equal(isAllowedRendererPermission("clipboard-write", origin, PORT), true);
  assert.equal(
    isAllowedRendererPermission("clipboard-read", "https://example.com", PORT),
    false,
  );
  assert.equal(isAllowedRendererPermission("camera", origin, PORT), false);
});
