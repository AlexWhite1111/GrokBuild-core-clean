import assert from "node:assert/strict";
import test from "node:test";
import { isExactOrigin, isTokenGatedPreviewOrigin, tokenMatches } from "./apiSecurity.js";
import { SANDBOX_RESOURCE_HEADERS } from "./sandboxResourceHeaders.js";

const ORIGIN = "http://127.0.0.1:43123";

test("API origin matching accepts only the active loopback origin", () => {
  assert.equal(isExactOrigin(ORIGIN, ORIGIN), true);
  assert.equal(isExactOrigin(`${ORIGIN}/path`, ORIGIN), true);
  assert.equal(isExactOrigin("http://localhost:43123", ORIGIN), false);
  assert.equal(isExactOrigin("http://127.0.0.1:43124", ORIGIN), false);
  assert.equal(isExactOrigin("https://127.0.0.1:43123", ORIGIN), false);
  assert.equal(isExactOrigin(undefined, ORIGIN), false);
});

test("token-gated preview origins additionally accept an opaque sandbox origin", () => {
  assert.equal(isTokenGatedPreviewOrigin("null", ORIGIN), true);
  assert.equal(isTokenGatedPreviewOrigin(ORIGIN, ORIGIN), true);
  assert.equal(isTokenGatedPreviewOrigin("https://example.com", ORIGIN), false);
  assert.equal(isTokenGatedPreviewOrigin(undefined, ORIGIN), false);
});

test("token matching rejects empty, truncated and changed values", () => {
  const token = "A".repeat(43);
  assert.equal(tokenMatches(token, token), true);
  assert.equal(tokenMatches(undefined, token), false);
  assert.equal(tokenMatches(token.slice(1), token), false);
  assert.equal(tokenMatches(`${token.slice(0, -1)}B`, token), false);
});

test("sandbox resources opt into opaque-origin loading without credentials", () => {
  assert.deepEqual(SANDBOX_RESOURCE_HEADERS, {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
});
