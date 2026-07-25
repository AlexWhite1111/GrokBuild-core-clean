import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "sc1_";

/** Issues process-local opaque receipts for repository state fingerprints. */
export class SourceControlStateTokenAuthority {
  readonly #key = randomBytes(32);

  issue(fingerprint: string): string {
    const digest = createHmac("sha256", this.#key)
      .update("grok-build/source-control-state/v1\0")
      .update(fingerprint)
      .digest("base64url");
    return `${TOKEN_PREFIX}${digest}`;
  }

  unavailable(projectId: string): string {
    return this.issue(`unavailable\0${projectId}`);
  }

  matches(token: string, fingerprint: string): boolean {
    const expected = Buffer.from(this.issue(fingerprint));
    const actual = Buffer.from(token);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
