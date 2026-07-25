/** Installs APIs that secure localhost exposes but plain trusted-LAN HTTP does not. */
export function installBrowserCompatibility(): void {
  const browserCrypto = globalThis.crypto;
  if (!browserCrypto || typeof browserCrypto.randomUUID === "function") return;
  Object.defineProperty(browserCrypto, "randomUUID", {
    configurable: true,
    value: () => uuidV4(browserCrypto),
  });
}

function uuidV4(source: Pick<Crypto, "getRandomValues">): `${string}-${string}-${string}-${string}-${string}` {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
