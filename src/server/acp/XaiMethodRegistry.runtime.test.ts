import assert from "node:assert/strict";
import test from "node:test";
import type { InitializeResponse } from "@agentclientprotocol/sdk";
import { XAI_METHODS, XaiMethodRegistry } from "./XaiMethodRegistry.js";

const historyMethods = [
  XAI_METHODS.rewindPoints,
  XAI_METHODS.rewindExecute,
  XAI_METHODS.sessionFork,
];

test("Grok 0.2 patch releases retain the verified Fork and Rewind contract", () => {
  const registry = new XaiMethodRegistry();
  registry.applyInitialize(initialize("0.2.112"));

  const availability = new Map(registry.snapshot().map((item) => [item.method, item.availability]));
  for (const method of historyMethods) assert.equal(availability.get(method), "probed");
});

test("an unverified Grok protocol line does not expose Fork or Rewind", () => {
  for (const version of ["0.2.102", "0.3.0", "invalid"]) {
    const registry = new XaiMethodRegistry();
    registry.applyInitialize(initialize(version));
    const availability = new Map(registry.snapshot().map((item) => [item.method, item.availability]));
    for (const method of historyMethods) assert.equal(availability.get(method), "unavailable");
  }
});

function initialize(agentVersion: string): InitializeResponse {
  return {
    protocolVersion: 1,
    agentCapabilities: {},
    authMethods: [],
    _meta: { grokShell: true, agentVersion },
  } as InitializeResponse;
}
