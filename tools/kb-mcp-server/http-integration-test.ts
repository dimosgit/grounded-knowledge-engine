#!/usr/bin/env node
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Configure before importing the server module: server.ts reads env at load.
const API_KEY = "test-key-please-rotate";
process.env.KB_MCP_HTTP_API_KEY = API_KEY;
process.env.KB_MCP_SCAN_ROOTS = "demo-kb";
process.env.KB_MCP_PROFILE = process.env.KB_MCP_PROFILE || "full"; // exercise refresh denial

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(path.join(__dirname, "..", ".."));

const { createMcpHttpServer } = await import("./server-http.js");

const server = await createMcpHttpServer({ maxBodyBytes: 2048, log: () => {} });
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;
const base = `http://127.0.0.1:${port}`;

try {
  await testHealthz();
  await testAuthRejections();
  await testInitializeAndToolsList();
  await testGroundedSearchAndSanitization();
  await testWriteDenial();
  await testBodyLimit();
  console.log("MCP HTTP bridge tests passed.");
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function rpc(body: unknown, headers: Record<string, string> = authHeaders()) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined, text };
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` };
}

async function testHealthz(): Promise<void> {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "ok" });
}

async function testAuthRejections(): Promise<void> {
  const noKey = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, {});
  assert.equal(noKey.status, 401, "missing key must be 401");

  const badKey = await rpc(
    { jsonrpc: "2.0", id: 1, method: "ping" },
    { Authorization: "Bearer wrong" },
  );
  assert.equal(badKey.status, 401, "bad key must be 401");

  // Valid key still works (x-api-key form).
  const ok = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { "x-api-key": API_KEY });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.result, {});
}

async function testInitializeAndToolsList(): Promise<void> {
  const init = await rpc({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(init.status, 200);
  assert.ok(init.json.result.protocolVersion, "initialize returns a protocol version");
  assert.equal(init.json.result.serverInfo.name, "kb-mcp-server");

  const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools: Array<{ name: string; annotations?: { readOnlyHint?: boolean } }> =
    list.json.result.tools;
  assert.ok(tools.length > 0, "tools/list returns tools");
  assert.ok(
    tools.every((t) => t.annotations?.readOnlyHint === true),
    "every advertised tool is read-only",
  );
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("kb.search"), "kb.search is advertised");
  assert.ok(!names.includes("kb.upsert_note"), "write tools are not advertised");
  assert.ok(!names.includes("kb.refresh"), "non-read tools (refresh) are filtered out");
}

async function testGroundedSearchAndSanitization(): Promise<void> {
  const res = await rpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "kb.search", arguments: { query: "transport" } },
  });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.json.result.content), "search returns content blocks");
  // No absolute host path may leak to a remote client.
  assert.ok(!res.text.includes(repoRoot), "response must not contain the absolute repo root path");
}

async function testWriteDenial(): Promise<void> {
  // A mutation tool: refused without executing, returned as a tool error.
  const upsert = await rpc({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "kb.upsert_note", arguments: { kind: "topic", title: "x", body: "y" } },
  });
  assert.equal(upsert.status, 200);
  assert.equal(upsert.json.result.isError, true, "write tool call is an error result");
  assert.match(upsert.json.result.content[0].text, /not available/i);

  // kb.refresh is a non-read tool and must also be refused at tools/call.
  const refresh = await rpc({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "kb.refresh", arguments: {} },
  });
  assert.equal(refresh.json.result.isError, true, "refresh is refused over remote");

  // Unknown JSON-RPC methods fall through to "method not available".
  const bogus = await rpc({ jsonrpc: "2.0", id: 6, method: "kb/secretAdmin" });
  assert.equal(bogus.json.error.code, -32601);
}

async function testBodyLimit(): Promise<void> {
  const huge = "x".repeat(4096);
  const res = await rpc({ jsonrpc: "2.0", id: 7, method: "ping", params: { pad: huge } });
  assert.equal(res.status, 413, "oversized body rejected with 413");
}
