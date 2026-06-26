import { timingSafeEqual } from "node:crypto";

/**
 * API-key authentication for the loopback Streamable HTTP bridge (v1).
 *
 * The secret is loaded from KB_MCP_HTTP_API_KEY. Comparison is constant-time
 * to avoid leaking key length/content through timing. This is the minimum
 * gate for the short-lived tunnel proof of concept; OAuth/OIDC is a documented
 * production follow-up and is intentionally not implemented here.
 */

export type AuthResult = { ok: true } | { ok: false; status: number; reason: string };

const BEARER_PREFIX = /^Bearer\s+/i;

/** Read the configured API key, trimmed. Empty string means "not configured". */
export function getConfiguredApiKey(env: NodeJS.ProcessEnv = process.env): string {
  return (env.KB_MCP_HTTP_API_KEY ?? "").trim();
}

/**
 * Extract the presented credential from request headers. Accepts either an
 * `Authorization: Bearer <key>` header or an `x-api-key: <key>` header.
 */
export function extractPresentedKey(
  headers: Record<string, string | string[] | undefined>,
): string {
  const auth = headerValue(headers, "authorization");
  if (auth && BEARER_PREFIX.test(auth)) {
    return auth.replace(BEARER_PREFIX, "").trim();
  }
  const apiKey = headerValue(headers, "x-api-key");
  if (apiKey) return apiKey.trim();
  return "";
}

/**
 * Validate the presented credential against the configured key.
 *
 * Fails closed: if no key is configured the endpoint refuses all requests
 * rather than running open. A configured-but-mismatched or missing credential
 * yields 401.
 */
export function authenticate(
  headers: Record<string, string | string[] | undefined>,
  env: NodeJS.ProcessEnv = process.env,
): AuthResult {
  const configured = getConfiguredApiKey(env);
  if (!configured) {
    return {
      ok: false,
      status: 503,
      reason: "Server not configured: KB_MCP_HTTP_API_KEY is unset.",
    };
  }
  const presented = extractPresentedKey(headers);
  if (!presented) {
    return { ok: false, status: 401, reason: "Missing API key." };
  }
  if (!constantTimeEqual(presented, configured)) {
    return { ok: false, status: 401, reason: "Invalid API key." };
  }
  return { ok: true };
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  // timingSafeEqual requires equal-length buffers; compare against a fixed
  // length first so a length mismatch does not short-circuit early.
  if (aBuf.length !== bBuf.length) {
    // Still run a comparison of equal length to keep timing uniform.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string {
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}
