import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { codeScrollDestination } from "./CodeScrollRegion.js";

describe("inline source scroll partition", () => {
  it("routes the left three quarters to the conversation", () => {
    assert.equal(codeScrollDestination(100, 100, 800), "thread");
    assert.equal(codeScrollDestination(699.99, 100, 800), "thread");
  });

  it("reserves the right quarter for the code result", () => {
    assert.equal(codeScrollDestination(700, 100, 800), "internal");
    assert.equal(codeScrollDestination(900, 100, 800), "internal");
  });
});
