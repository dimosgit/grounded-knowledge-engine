import type { IncomingMessage, ServerResponse } from "node:http";

export interface LocalRequestIdentity {
  remoteAddress?: string;
  host?: string;
  origin?: string;
  protocol?: "http:" | "https:";
}

export interface ReadJsonObjectOptions {
  maxBytes: number;
  resourceLabel: string;
}

export class LocalApiRequestError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LocalApiRequestError";
  }
}

/**
 * Restricts a dev-server API to a loopback connection and Host header. Mutating
 * requests additionally require a same-origin Origin header.
 */
export function assertLocalRequest(identity: LocalRequestIdentity, requireOrigin: boolean): void {
  if (!isLoopbackAddress(identity.remoteAddress || "")) {
    throw new LocalApiRequestError(403, "local_only", "This API is available on loopback only.");
  }

  const host = parseAuthority(identity.host || "");
  if (!host || !isLoopbackHostname(host.hostname)) {
    throw new LocalApiRequestError(403, "local_only", "This API requires a loopback host.");
  }

  if (!identity.origin) {
    if (requireOrigin) {
      throw new LocalApiRequestError(
        403,
        "invalid_origin",
        "Mutating requests require a local origin.",
      );
    }
    return;
  }

  let origin: URL;
  try {
    origin = new URL(identity.origin);
  } catch {
    throw new LocalApiRequestError(403, "invalid_origin", "Request origin is invalid.");
  }
  const requestProtocol = identity.protocol || "http:";
  if (
    origin.protocol !== requestProtocol ||
    !isLoopbackHostname(origin.hostname) ||
    origin.host.toLowerCase() !== host.authority
  ) {
    throw new LocalApiRequestError(
      403,
      "invalid_origin",
      "This API requires a same-origin request.",
    );
  }
}

export function getLocalRequestIdentity(req: IncomingMessage): LocalRequestIdentity {
  return {
    remoteAddress: req.socket.remoteAddress,
    host: firstHeaderValue(req.headers.host),
    origin: firstHeaderValue(req.headers.origin),
    protocol: "encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:",
  };
}

export async function readJsonObject(
  req: IncomingMessage,
  options: ReadJsonObjectOptions,
): Promise<Record<string, unknown>> {
  const contentType = firstHeaderValue(req.headers["content-type"])?.toLowerCase() || "";
  if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new LocalApiRequestError(
      415,
      "invalid_content_type",
      "Content-Type must be application/json.",
    );
  }

  const contentLength = firstHeaderValue(req.headers["content-length"]);
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      req.resume();
      throw new LocalApiRequestError(400, "invalid_content_length", "Content-Length is invalid.");
    }
    if (declaredLength > options.maxBytes) {
      req.resume();
      throw new LocalApiRequestError(
        413,
        "body_too_large",
        `${options.resourceLabel} request body is too large.`,
      );
    }
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunkValue of req) {
    const chunk = Buffer.isBuffer(chunkValue) ? chunkValue : Buffer.from(chunkValue);
    received += chunk.byteLength;
    if (received > options.maxBytes) {
      throw new LocalApiRequestError(
        413,
        "body_too_large",
        `${options.resourceLabel} request body is too large.`,
      );
    }
    chunks.push(chunk);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new LocalApiRequestError(400, "invalid_json", "Request body is invalid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LocalApiRequestError(400, "invalid_body", "Request body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

export function assertOnlyKeys(body: Record<string, unknown>, allowedKeys: string[]): void {
  const allowed = new Set(allowedKeys);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new LocalApiRequestError(400, "invalid_body", "Request has unknown fields.");
  }
}

export function methodNotAllowed(allow: string): LocalApiRequestError {
  return new LocalApiRequestError(405, "method_not_allowed", `Method not allowed; use ${allow}.`);
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  if (res.headersSent) return;
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("x-content-type-options", "nosniff");
  res.end(`${JSON.stringify(body)}\n`);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseAuthority(value: string): { authority: string; hostname: string } | null {
  try {
    const parsed = new URL(`http://${value.trim().toLowerCase()}`);
    return { authority: parsed.host, hostname: parsed.hostname };
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    normalized === "localhost" || normalized === "::1" || /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized) ||
    /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}
