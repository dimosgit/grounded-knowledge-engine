#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Configure before importing the server module: server.ts reads env at load.
// Generated per run (48 hex chars) so no key literal lives in source.
const API_KEY = randomBytes(24).toString("hex");
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
  await testBatchLimit();
  await testShortKeyRefusesToStart();
  await testTimeoutStopsBatch();
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

async function testBatchLimit(): Promise<void> {
  const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });
  const atLimit = await rpc(Array.from({ length: 20 }, (_, i) => ping(i)));
  assert.equal(atLimit.status, 200, "a batch of 20 is accepted");
  assert.equal(atLimit.json.length, 20);

  const over = await rpc(Array.from({ length: 21 }, (_, i) => ping(i)));
  assert.equal(over.status, 400, "a batch of 21 is rejected");
  assert.equal(over.json.error.code, -32600);
  assert.ok(!Array.isArray(over.json), "an oversized batch yields one error, nothing processed");

  const empty = await rpc([]);
  assert.equal(empty.status, 400);
  assert.equal(empty.json.error.code, -32600);
}

async function testShortKeyRefusesToStart(): Promise<void> {
  const previous = process.env.KB_MCP_HTTP_API_KEY;
  try {
    process.env.KB_MCP_HTTP_API_KEY = randomBytes(15).toString("hex"); // 30 chars
    await assert.rejects(createMcpHttpServer({ log: () => {} }), /at least 32 characters/);
    delete process.env.KB_MCP_HTTP_API_KEY;
    await assert.rejects(createMcpHttpServer({ log: () => {} }), /KB_MCP_HTTP_API_KEY is unset/);
  } finally {
    process.env.KB_MCP_HTTP_API_KEY = previous;
  }
}

async function testTimeoutStopsBatch(): Promise<void> {
  let pings = 0;
  const slow = await createMcpHttpServer({
    log: () => {},
    requestTimeoutMs: 150,
    maxConcurrent: 1,
    dispatch: {
      handleRequest: async (method: string) => {
        if (method === "tools/list") return { tools: [] };
        pings += 1;
        await new Promise((resolve) => setTimeout(resolve, 60));
        return {};
      },
      handleNotification: async () => {},
    },
  });
  await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
  const slowBase = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
  const post = (body: unknown) =>
    fetch(`${slowBase}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify(body),
    });
  try {
    const batch = Array.from({ length: 20 }, (_, i) => ({ jsonrpc: "2.0", id: i, method: "ping" }));
    const timedOut = await post(batch);
    assert.equal(timedOut.status, 504, "slow batch times out");
    await timedOut.text();
    // Let the in-flight item finish; the loop must not start the rest.
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.ok(pings < 20, `timed-out batch kept processing (${pings} of 20 items ran)`);
    assert.ok(pings <= 4, `expected processing to stop near the timeout, got ${pings}`);

    // inFlight returned to zero: with maxConcurrent 1 a new request is served.
    const after = await post({ jsonrpc: "2.0", id: 99, method: "ping" });
    assert.equal(after.status, 200, "slot released after the timed-out batch stopped");
    await after.text();
  } finally {
    await new Promise<void>((resolve) => slow.close(() => resolve()));
  }
}
