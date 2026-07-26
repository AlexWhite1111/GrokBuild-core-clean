import assert from "node:assert/strict";
import test from "node:test";
import { WeightedLruCache } from "./WeightedLruCache.js";

test("weighted LRU promotes reads and obeys entry and weight limits", () => {
  const cache = new WeightedLruCache<string, string>(2, 6);
  cache.set("a", "A", 2);
  cache.set("b", "B", 2);
  assert.equal(cache.get("a"), "A");
  cache.set("c", "C", 2);

  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), "A");
  assert.equal(cache.get("c"), "C");
  assert.equal(cache.size, 2);
  assert.equal(cache.weight, 4);

  cache.set("d", "D", 5);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("c"), undefined);
  assert.equal(cache.get("d"), "D");
  assert.equal(cache.weight, 5);
});

test("an oversized value is returned by its caller but never retained", () => {
  const cache = new WeightedLruCache<string, string>(2, 4);
  cache.set("large", "value", 5);
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.size, 0);
  assert.equal(cache.weight, 0);
});
