/**
 * Headers required by resources consumed from opaque-origin preview sandboxes.
 * These routes never use cookies; authorization is handled independently.
 */
export const SANDBOX_RESOURCE_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
});
