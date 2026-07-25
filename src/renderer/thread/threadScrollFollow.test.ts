import assert from "node:assert/strict";
import test from "node:test";
import { nextThreadScrollFollow, threadAtBottom, threadLatestControl } from "./threadScrollFollow.js";

test("manual scrolling releases follow until the reader reaches bottom again", () => {
  assert.equal(nextThreadScrollFollow(true, "release", true), false);
  assert.equal(nextThreadScrollFollow(false, "scroll", false, true), false);
  assert.equal(nextThreadScrollFollow(false, "scroll", true, false), false);
  assert.equal(nextThreadScrollFollow(false, "scroll", true, true), true);
  assert.equal(nextThreadScrollFollow(true, "scroll", false, false), true);
});

test("bottom means the real edge rather than a near-bottom zone", () => {
  assert.equal(threadAtBottom({ scrollHeight: 1000, scrollTop: 899, clientHeight: 100 }), true);
  assert.equal(threadAtBottom({ scrollHeight: 1000, scrollTop: 898.9, clientHeight: 100 }), false);
});

test("the latest control becomes activity dots only while Grok is generating away from bottom", () => {
  assert.equal(threadLatestControl(true, true), "hidden");
  assert.equal(threadLatestControl(false, true), "activity");
  assert.equal(threadLatestControl(false, false), "latest");
});
