#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isTypeScriptRuntime = __filename.endsWith(".ts");
const serverPath = path.join(__dirname, isTypeScriptRuntime ? "server.ts" : "server.js");
const serverArgs = isTypeScriptRuntime ? ["--import", "tsx", serverPath] : [serverPath];

interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: {
    message?: string;
  };
}

interface JsonRpcRequestPayload {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params: Record<string, unknown>;
}

interface ListedTool {
  name: string;
}

const child = spawn(process.execPath, serverArgs, {
  env: {
    ...process.env,
    KB_MCP_ENABLE_WRITES: "true",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>();

child.stdout.on("data", (chunk) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
  parseFrames();
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code) => {
  if (code !== 0 && pending.size > 0) {
    for (const [, request] of pending.entries()) {
      request.reject(new Error(`Server exited early with code ${code}`));
    }
  }
});

function parseFrames() {
  // Newline-delimited JSON: one message per line, matching the MCP stdio transport.
  while (true) {
    const newlineIdx = stdoutBuffer.indexOf("\n");
    if (newlineIdx === -1) return;
    const lineBuf = stdoutBuffer.slice(0, newlineIdx);
    stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
    const line = lineBuf.toString("utf8").trim();
    if (line.length === 0) continue;

    const message = JSON.parse(line) as JsonRpcResponse;
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.error) {
        request.reject(new Error(`RPC error: ${message.error.message}`));
      } else {
        request.resolve(message.result);
      }
    }
  }
}

function sendFrame(payload: JsonRpcRequestPayload): void {
  const body = JSON.stringify(payload);
  child.stdin.write(body + "\n");
}

function request(method: string, params: Record<string, unknown>): Promise<any> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 10000);

    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    sendFrame({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });
  });
}

function notify(method: string, params: Record<string, unknown>): void {
  sendFrame({
    jsonrpc: "2.0",
    method,
    params,
  });
}

try {
  const init = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "kb-mcp-smoke", version: "0.1.0" },
  });
  assert.equal(init.serverInfo?.name, "kb-mcp-server");
  assert.ok(init.capabilities?.tools);
  notify("notifications/initialized", {});

  const listed = await request("tools/list", {});
  const names = new Set((listed.tools || []).map((tool: ListedTool) => tool.name));
  assert.ok(names.has("kb.search"));
  assert.ok(names.has("kb.get_topic"));
  assert.ok(names.has("kb.get_term"));
  assert.ok(names.has("kb.list_modules"));
  assert.ok(names.has("kb.answer_grounded"));
  assert.ok(names.has("kb.upsert_note"));
  assert.ok(names.has("kb.add_open_question"));
  assert.ok(names.has("kb.answer_and_capture"));

  const resources = await request("resources/list", {});
  assert.ok(Array.isArray(resources.resources));

  const resourceTemplates = await request("resources/templates/list", {});
  assert.ok(Array.isArray(resourceTemplates.resourceTemplates));

  const prompts = await request("prompts/list", {});
  assert.ok(Array.isArray(prompts.prompts));

  const searched = await request("tools/call", {
    name: "kb.search",
    arguments: { query: "model controlled tools application controlled resources", limit: 3 },
  });
  assert.ok(Array.isArray(searched.content));
  assert.ok(searched.structuredContent?.query);
  assert.ok(Array.isArray(searched.structuredContent?.hits));
  assert.ok(searched.structuredContent.hits.length > 0);

  const groundedBlocked = await request("tools/call", {
    name: "kb.answer_grounded",
    arguments: {
      question: "Which MCP primitive should expose model-driven search and capture actions?",
      limit: 4,
      mode: "generic",
    },
  });
  assert.equal(groundedBlocked.isError, true);
  assert.match(groundedBlocked.content?.[0]?.text || "", /kb\.answer_and_capture/i);

  const grounded = await request("tools/call", {
    name: "kb.answer_grounded",
    arguments: {
      question: "Which MCP primitive should expose model-driven search and capture actions?",
      limit: 4,
      mode: "generic",
      strict: false,
      responseMode: "curate",
      allowDirect: true,
    },
  });
  assert.ok(grounded.structuredContent?.question);
  assert.ok(typeof grounded.structuredContent?.answer === "string");
  assert.ok(grounded.structuredContent?.confidence?.label);
  assert.equal(typeof grounded.structuredContent?.strict, "boolean");
  assert.equal(typeof grounded.structuredContent?.abstained, "boolean");
  assert.equal(typeof grounded.structuredContent?.gate?.pass, "boolean");
  assert.ok(Array.isArray(grounded.structuredContent?.citations));
  assert.match(grounded.content?.[0]?.text || "", /Timings \(ms\):/);
  assert.match(grounded.content?.[0]?.text || "", /SLO guard:/);
  assert.equal(typeof grounded.structuredContent?.timings?.retrievalMs, "number");
  assert.equal(typeof grounded.structuredContent?.timings?.synthesisMs, "number");
  assert.equal(typeof grounded.structuredContent?.timings?.totalMs, "number");
  assert.equal(typeof grounded.structuredContent?.slo?.thresholdMs, "number");
  assert.equal(typeof grounded.structuredContent?.slo?.totalMs, "number");
  assert.equal(typeof grounded.structuredContent?.slo?.breached, "boolean");
  assert.ok(
    grounded.structuredContent?.slo?.status === "ok" ||
      grounded.structuredContent?.slo?.status === "breach",
  );
  assert.ok(Array.isArray(grounded.structuredContent?.warnings));

  const upsertDryRun = await request("tools/call", {
    name: "kb.upsert_note",
    arguments: {
      kind: "topic",
      title: "Smoke Test Topic",
      body: "## Test\n\nDry-run write validation.",
      module: "knowledge-ops",
      track: "demo",
      type: "concept",
      status: "draft",
      dryRun: true,
    },
  });
  assert.equal(upsertDryRun.structuredContent?.dryRun, true);
  assert.equal(upsertDryRun.structuredContent?.kind, "topic");
  assert.equal(typeof upsertDryRun.structuredContent?.path, "string");

  const openQuestionDryRun = await request("tools/call", {
    name: "kb.add_open_question",
    arguments: {
      question: "Smoke test question?",
      whyOpen: "Dry-run validation for MCP write path.",
      whatWouldResolve: "A successful dry-run tool response.",
      dryRun: true,
    },
  });
  assert.equal(openQuestionDryRun.structuredContent?.dryRun, true);
  assert.equal(openQuestionDryRun.structuredContent?.status, "open");

  const answerAndCaptureNote = await request("tools/call", {
    name: "kb.answer_and_capture",
    arguments: {
      question: "What decision did we make for exposing grounded search and capture in MCP?",
      mode: "generic",
      strict: false,
      responseMode: "curate",
      captureStrategy: "note",
      notePath: "kb/topics/mcp-primitive-decision.md",
      noteTitle: "MCP Primitive Decision",
      module: "knowledge-ops",
      track: "demo",
      noteType: "project",
      noteStatus: "canonical",
      noteTags: "demo, capture, decision-log",
      noteOwner: "mcp-smoke",
      noteBody: [
        "## Decision",
        "",
        "- Grounded search and capture are exposed as MCP tools for v0.1.",
        "- This fits MCP's model-controlled tool primitive because the agent can decide when to search, answer, and capture during a task.",
        "- Resources remain useful for application-selected context, but they are not the primary primitive for automatic capture actions.",
        "",
        "## Evidence",
        "",
        "- The MCP source notes distinguish model-controlled tools from application-controlled resources.",
        "- This note is written by the MCP smoke test to prove retain-and-reuse behavior.",
      ].join("\n"),
    },
  });
  assert.equal(answerAndCaptureNote.structuredContent?.dryRun, false);
  assert.equal(answerAndCaptureNote.structuredContent?.strategy, "note");
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.dryRun, false);
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.kind, "topic");
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.path, "kb/topics/mcp-primitive-decision.md");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.retrievalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.synthesisMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.captureMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.totalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.thresholdMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.totalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.breached, "boolean");
  assert.ok(Array.isArray(answerAndCaptureNote.structuredContent?.warnings));

  await request("tools/call", {
    name: "kb.refresh",
    arguments: {},
  });

  const retained = await request("tools/call", {
    name: "kb.answer_grounded",
    arguments: {
      question: "For v0.1, are grounded search and capture exposed as MCP tools or resources?",
      mode: "generic",
      strict: false,
      responseMode: "curate",
      limit: 4,
      allowDirect: true,
    },
  });
  const retainedCitationPaths = retained.structuredContent?.citations?.map((citation: any) => citation.path) || [];
  assert.ok(retainedCitationPaths.includes("kb/topics/mcp-primitive-decision.md"));

  const answerAndCaptureOpen = await request("tools/call", {
    name: "kb.answer_and_capture",
    arguments: {
      question: "zzzzzzzzzzzzzzzzzzzz unknown smoke test",
      mode: "generic",
      track: "__no_such_track__",
      strict: true,
      dryRun: true,
    },
  });
  assert.equal(answerAndCaptureOpen.structuredContent?.dryRun, true);
  assert.equal(answerAndCaptureOpen.structuredContent?.answer?.abstained, true);
  assert.equal(answerAndCaptureOpen.structuredContent?.strategy, "open_question");
  assert.equal(answerAndCaptureOpen.structuredContent?.capture?.path, "kb/open_questions.md");

  await assert.rejects(
    request("method/does_not_exist", {}),
    /Method not found: method\/does_not_exist/,
  );

  console.log("KB MCP smoke test passed.");
} finally {
  child.kill("SIGTERM");
}
