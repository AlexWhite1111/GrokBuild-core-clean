import assert from "node:assert/strict";
import test from "node:test";
import {
  createThreadScrollAnchor,
  resolveThreadScrollAnchorIndex,
  threadAtBottom,
  threadLatestControl,
  threadRowResizeAdjustsScroll,
  wheelPixels,
} from "./threadScroll.js";

test("bottom means the real edge rather than a near-bottom zone", () => {
  assert.equal(threadAtBottom({ scrollHeight: 1000, scrollTop: 899, clientHeight: 100 }), true);
  assert.equal(threadAtBottom({ scrollHeight: 1000, scrollTop: 898.9, clientHeight: 100 }), false);
});

test("dynamic measurement preserves the row currently being read", () => {
  assert.equal(threadRowResizeAdjustsScroll({ end: 400 }, 500), true);
  assert.equal(threadRowResizeAdjustsScroll({ end: 700 }, 500), false);
  assert.equal(threadRowResizeAdjustsScroll({ end: 900 }, 500), false);
});

test("wheel deltas use the browser wheel modes", () => {
  assert.equal(wheelPixels(3, 0, 900), 3);
  assert.equal(wheelPixels(3, 1, 900), 48);
  assert.equal(wheelPixels(3, 2, 900), 2700);
});

test("reading position restores by stable item identity before using the fallback index", () => {
  const anchor = createThreadScrollAnchor([{ id: "a" }, { id: "b" }], 1, 465.125, 400, false);
  assert.deepEqual(anchor, {
    itemId: "b",
    fallbackIndex: 1,
    offset: 65.13,
    followLatest: false,
  });
  assert.equal(resolveThreadScrollAnchorIndex([{ id: "new" }, { id: "a" }, { id: "b" }], anchor), 2);
  assert.equal(resolveThreadScrollAnchorIndex([{ id: "a" }], { ...anchor, itemId: "missing" }), 0);
});

test("the latest control becomes activity dots only while Grok is generating away from bottom", () => {
  assert.equal(threadLatestControl(true, true), "hidden");
  assert.equal(threadLatestControl(false, true), "activity");
  assert.equal(threadLatestControl(false, false), "latest");
});
