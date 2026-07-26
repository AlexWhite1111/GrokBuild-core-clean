import assert from "node:assert/strict";
import test from "node:test";
import { visibleRemoteUserText } from "./taskVisibleUserText.js";

test("hidden system reminders do not become conversation messages", () => {
  assert.equal(
    visibleRemoteUserText("<system-reminder>Background task completed.</system-reminder>"),
    null,
  );
  assert.equal(visibleRemoteUserText("internal wake input", true), null);
});

test("an official interjection keeps only the user's visible text", () => {
  assert.equal(
    visibleRemoteUserText(
      "The user sent a message while you were working:\n"
      + "<user_query>\n这个是不是会有权限锁？\n</user_query>",
    ),
    "这个是不是会有权限锁？",
  );
});

test("ordinary remote user text is preserved exactly", () => {
  assert.equal(visibleRemoteUserText("  ordinary user text  "), "  ordinary user text  ");
});
