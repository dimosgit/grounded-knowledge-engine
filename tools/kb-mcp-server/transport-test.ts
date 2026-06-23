#!/usr/bin/env node
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import {
  JsonRpcFrameParser,
  startJsonRpcStdioTransport,
} from "./transport.js";

await testFrameParser();
await testTransportDispatch();
console.log("MCP stdio transport tests passed.");

async function testFrameParser(): Promise<void> {
  const messages: unknown[] = [];
  const errors: Array<{ code: number; message: string }> = [];
  const parser = new JsonRpcFrameParser(
    (message) => messages.push(message),
    (code, message) => errors.push({ code, message }),
  );

  parser.push('{"jsonrpc":"2.0","id":1,');
  parser.push('"method":"ping"}\n\n');

  const legacyPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "ping",
  });
  const legacyFrame = `Content-Length: ${Buffer.byteLength(legacyPayload)}\r\n\r\n${legacyPayload}`;
  parser.push(legacyFrame.slice(0, 20));
  parser.push(legacyFrame.slice(20));

  parser.push("{not-json}\n");

  assert.deepEqual(
    messages.map((message) => (message as { id?: number }).id),
    [1, 2],
  );
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, -32700);
  assert.match(errors[0].message, /Invalid JSON payload/);
}

async function testTransportDispatch(): Promise<void> {
  const input = new PassThrough();
  const output = new PassThrough();
  const notifications: string[] = [];
  const outputLines: Array<Record<string, unknown>> = [];
  let outputBuffer = "";

  output.setEncoding("utf8");
  output.on("data", (chunk: string) => {
    outputBuffer += chunk;
    while (outputBuffer.includes("\n")) {
      const newline = outputBuffer.indexOf("\n");
      const line = outputBuffer.slice(0, newline).trim();
      outputBuffer = outputBuffer.slice(newline + 1);
      if (line) outputLines.push(JSON.parse(line) as Record<string, unknown>);
    }
  });

  const transport = startJsonRpcStdioTransport({
    input,
    output,
    handleRequest: async (method, params) => {
      if (method === "echo") return { value: params.value };
      if (method === "fail") {
        const error = new Error("expected failure");
        (error as Error & { code?: number }).code = -32001;
        throw error;
      }
      return {};
    },
    handleNotification: async (method) => {
      notifications.push(method);
    },
    errorCode: (error) =>
      error && typeof error === "object" && "code" in error
        ? Number((error as { code: unknown }).code)
        : -32603,
    errorMessage: (error) => (error instanceof Error ? error.message : String(error)),
  });

  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "echo", params: { value: "ok" } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "ready", params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "fail", params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, params: {} })}\n`);
  input.write("{bad-json}\n");

  await waitFor(() => outputLines.length === 4 && notifications.length === 1);

  const byId = new Map(outputLines.map((line) => [line.id, line]));
  assert.deepEqual(byId.get(1), {
    jsonrpc: "2.0",
    id: 1,
    result: { value: "ok" },
  });
  assert.deepEqual(byId.get(3), {
    jsonrpc: "2.0",
    id: 3,
    error: { code: -32600, message: "Invalid Request: missing method" },
  });
  const parseError = byId.get(null);
  assert.equal(parseError?.jsonrpc, "2.0");
  assert.equal((parseError?.error as { code: number }).code, -32700);
  assert.match(
    ((parseError?.error as { message: string }) || {}).message,
    /Invalid JSON payload/,
  );
  assert.deepEqual(byId.get(2), {
    jsonrpc: "2.0",
    id: 2,
    error: { code: -32001, message: "expected failure" },
  });
  assert.deepEqual(notifications, ["ready"]);

  transport.close();
  input.end();
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for transport output.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
