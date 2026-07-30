#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyCaptureProposal } from "../capture/capture-service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isTypeScriptRuntime = __filename.endsWith(".ts");
const serverPath = path.join(__dirname, isTypeScriptRuntime ? "server.ts" : "server.js");
const serverArgs = isTypeScriptRuntime ? ["--import", "tsx", serverPath] : [serverPath];
const sourceRepoRoot = path.resolve(__dirname, "..", "..");
const smokeRepoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gke-mcp-smoke-"));
await fs.cp(path.join(sourceRepoRoot, "demo-kb"), path.join(smokeRepoRoot, "demo-kb"), {
  recursive: true,
});
// The capture-review flow asserts against one pre-existing canonical note.
// Seed it synthetically so the smoke test never depends on the checkout's
// live kb/ content (which differs per workspace).
await fs.mkdir(path.join(smokeRepoRoot, "kb", "topics"), { recursive: true });
await fs.writeFile(
  path.join(smokeRepoRoot, "kb", "topics", "mcp-primitive-decision.md"),
  `---
module: knowledge-ops
track: demo
status: canonical
type: concept
owner: mcp-smoke
updated: 2026-06-22
tags: demo, capture, decision-log
---
# MCP Primitive Decision

## Decision

- Grounded search and capture are exposed as MCP tools for v0.1.
- This fits MCP's model-controlled tool primitive because the agent can decide when to search, answer, and capture during a task.
- Resources remain useful for application-selected context, but they are not the primary primitive for automatic capture actions.

## Evidence

- The MCP source notes distinguish model-controlled tools from application-controlled resources.
- This note is written by the MCP smoke test to prove retain-and-reuse behavior.
`,
  "utf8",
);

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

interface ListedResource {
  uri?: string;
  uriTemplate?: string;
}

const child = spawn(process.execPath, serverArgs, {
  env: {
    ...process.env,
    KB_MCP_REPO_ROOT: smokeRepoRoot,
    KB_MCP_SCAN_ROOTS: "demo-kb,kb",
    KB_MCP_ENABLE_WRITES: "true",
    KB_MCP_PROFILE: "full",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuffer = Buffer.alloc(0);
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (result: any) => void; reject: (error: Error) => void }
>();

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
    if (typeof message.id === "number") {
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
  assert.ok(names.has("kb.get_record"));
  assert.ok(names.has("kb.get_topic"));
  assert.ok(names.has("kb.get_term"));
  assert.ok(names.has("kb.list_modules"));
  assert.ok(names.has("kb.answer_grounded"));
  assert.ok(names.has("kb.upsert_note"));
  assert.ok(names.has("kb.add_open_question"));
  assert.ok(names.has("kb.answer_and_capture"));
  assert.ok(names.has("kb.resume_project"));
  assert.ok(names.has("kb.record_decision"));
  assert.ok(names.has("kb.get_decision"));
  assert.ok(names.has("kb.list_decisions"));
  assert.ok(names.has("kb.review_decision"));
  assert.ok(names.has("kb.supersede_decision"));

  const resources = await request("resources/list", {});
  assert.ok(
    resources.resources.some((resource: ListedResource) => resource.uri === "gke://workspace/info"),
  );
  assert.ok(
    resources.resources.some(
      (resource: ListedResource) => resource.uri === "gke://workspace/review",
    ),
  );
  assert.ok(
    resources.resources.some(
      (resource: ListedResource) => resource.uri === "gke://workspace/decisions",
    ),
  );

  const resourceTemplates = await request("resources/templates/list", {});
  assert.ok(
    resourceTemplates.resourceTemplates.some(
      (resource: ListedResource) => resource.uriTemplate === "gke://record/{path}",
    ),
  );
  assert.ok(
    resourceTemplates.resourceTemplates.some(
      (resource: ListedResource) => resource.uriTemplate === "gke://project/{projectId}/context",
    ),
  );
  assert.ok(
    resourceTemplates.resourceTemplates.some(
      (resource: ListedResource) => resource.uriTemplate === "gke://decision/{decisionId}",
    ),
  );

  const workspaceResource = await request("resources/read", { uri: "gke://workspace/info" });
  assert.equal(workspaceResource.contents?.[0]?.mimeType, "application/json");

  const reviewResource = await request("resources/read", { uri: "gke://workspace/review" });
  assert.equal(reviewResource.contents?.[0]?.mimeType, "text/markdown");
  assert.match(reviewResource.contents?.[0]?.text || "", /workspace review/i);

  const initialDecisionLedger = await request("resources/read", {
    uri: "gke://workspace/decisions",
  });
  assert.equal(initialDecisionLedger.contents?.[0]?.mimeType, "text/markdown");
  assert.match(initialDecisionLedger.contents?.[0]?.text || "", /Decision Ledger/);
  assert.match(initialDecisionLedger.contents?.[0]?.text || "", /pilot-location/);

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

  const record = await request("tools/call", {
    name: "kb.get_record",
    arguments: { query: "mcp-source-tools", kind: "topic" },
  });
  assert.equal(record.isError, undefined);
  assert.ok(record.structuredContent?.match?.path);
  const recordUri = `gke://record/${encodeURIComponent(record.structuredContent.match.path)}`;
  const recordResource = await request("resources/read", { uri: recordUri });
  assert.equal(recordResource.contents?.[0]?.mimeType, "text/markdown");
  assert.match(recordResource.contents?.[0]?.text || "", /MCP/i);
  await assert.rejects(
    () => request("resources/read", { uri: "gke://record/..%2Fpackage.json" }),
    /Path traversal is not allowed/,
  );
  await assert.rejects(
    () =>
      request("resources/read", {
        uri: "gke://record/.gke%2Fcapture-proposals%2Fpending.json",
      }),
    /Operational state is not exposed as a knowledge resource/,
  );
  await assert.rejects(
    () => request("resources/read", { uri: "gke://unsupported/value" }),
    /Unsupported resource URI/,
  );

  const resumed = await request("tools/call", {
    name: "kb.resume_project",
    arguments: { projectId: "project-tracking" },
  });
  assert.equal(resumed.isError, undefined);
  assert.equal(resumed.structuredContent?.projectId, "project-tracking");
  assert.match(resumed.structuredContent?.currentFocus || "", /router demo/i);
  assert.equal(
    resumed.structuredContent?.recommendedNextAction,
    "Prove local retrieval against the tiny KB slice.",
  );
  assert.equal(resumed.structuredContent?.nextThreeActions?.length, 3);
  assert.ok(
    resumed.structuredContent?.citations?.every(
      (citation: any) => citation.path && citation.line > 0,
    ),
  );

  const projectResource = await request("resources/read", {
    uri: "gke://project/project-tracking/context",
  });
  assert.equal(projectResource.contents?.[0]?.mimeType, "text/markdown");
  assert.match(projectResource.contents?.[0]?.text || "", /Router Project Board/);

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
  assert.equal(upsertDryRun.structuredContent?.routing?.status, "resolved");
  assert.equal(upsertDryRun.structuredContent?.routing?.fields?.track?.source, "explicit");

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

  const decisionV1 = await request("tools/call", {
    name: "kb.record_decision",
    arguments: {
      decisionId: "mcp-tool-primitive-v1",
      title: "MCP Tool Primitive",
      status: "active",
      owner: "mcp-smoke",
      decidedAt: "2026-06-21",
      evidenceCheckedAt: "2026-06-21",
      reviewAfter: "2026-07-01",
      confidence: "high",
      tags: ["mcp", "decision-replay"],
      question: "Which MCP primitive should expose model-driven knowledge operations?",
      recommendation: "Use model-controlled MCP tools with addressable read resources.",
      alternatives: ["Expose resources only"],
      rationale: "The connected agent chooses when to invoke grounded operations.",
      assumptions: ["The MCP client supports tool calls."],
      risks: ["Clients may surface different discovery affordances."],
      evidence: [{ path: "kb/topics/mcp-primitive-decision.md", line: 20 }],
    },
  });
  assert.equal(decisionV1.isError, undefined);
  assert.equal(decisionV1.structuredContent?.decisionId, "mcp-tool-primitive-v1");
  assert.equal(decisionV1.structuredContent?.dryRun, false);
  assert.match(decisionV1.structuredContent?.path || "", /^kb\/decisions\//);

  const overdueDecision = await request("tools/call", {
    name: "kb.get_decision",
    arguments: {
      query: "mcp-tool-primitive-v1",
      asOf: "2026-07-29",
      responseFormat: "full",
    },
  });
  assert.equal(overdueDecision.structuredContent?.reviewState, "overdue");
  assert.match(overdueDecision.structuredContent?.staleWarning || "", /^STALE:/);
  assert.match(overdueDecision.content?.[0]?.text || "", /STALE:/);
  assert.equal(overdueDecision.structuredContent?.evidence?.[0]?.line, 20);

  const overdueLedger = await request("tools/call", {
    name: "kb.list_decisions",
    arguments: { reviewState: "overdue", owner: "mcp-smoke", asOf: "2026-07-29" },
  });
  assert.equal(overdueLedger.structuredContent?.decisionCount, 1);
  assert.equal(
    overdueLedger.structuredContent?.decisions?.[0]?.decisionId,
    "mcp-tool-primitive-v1",
  );
  assert.match(overdueLedger.structuredContent?.warnings?.[0] || "", /^STALE:/);

  const reviewedDecision = await request("tools/call", {
    name: "kb.review_decision",
    arguments: {
      decisionId: "mcp-tool-primitive-v1",
      reviewedAt: "2026-07-29",
      reviewAfter: "2026-12-31",
      reviewer: "mcp-smoke",
      recommendationSupported: "yes",
      assumptionsNeedingValidation: ["Confirm support in each target client."],
      evidence: [
        {
          path: "kb/topics/mcp-primitive-decision.md",
          line: 20,
          classification: "unchanged",
          note: "The local evidence still supports the primitive choice.",
        },
      ],
      notes: "Review completed through the MCP decision lifecycle.",
    },
  });
  assert.equal(reviewedDecision.structuredContent?.recommendationSupported, true);
  assert.equal(reviewedDecision.structuredContent?.changes?.[0]?.classification, "unchanged");
  assert.equal(reviewedDecision.structuredContent?.dryRun, false);

  const currentDecision = await request("tools/call", {
    name: "kb.get_decision",
    arguments: { query: "mcp-tool-primitive-v1", asOf: "2026-07-29", responseFormat: "full" },
  });
  assert.equal(currentDecision.structuredContent?.reviewState, "current");
  assert.match(currentDecision.structuredContent?.reviewHistory?.join("\n") || "", /2026-07-29/);
  assert.equal(currentDecision.structuredContent?.evidence?.length, 1);

  const decisionV2 = await request("tools/call", {
    name: "kb.record_decision",
    arguments: {
      decisionId: "mcp-tool-primitive-v2",
      title: "MCP Tool Primitive",
      status: "proposed",
      owner: "mcp-smoke",
      decidedAt: "2026-07-29",
      evidenceCheckedAt: "2026-07-29",
      reviewAfter: "2027-01-31",
      confidence: "high",
      tags: ["mcp", "decision-replay"],
      question: "Which MCP primitive should expose model-driven knowledge operations?",
      recommendation: "Use semantic tools plus explicit decision resources.",
      alternatives: ["Keep decision records reachable only through generic record reads"],
      rationale: "Dedicated decision reads expose freshness and lifecycle state.",
      assumptions: ["Full-profile clients opt into advanced decision operations."],
      risks: ["The larger full catalog must remain within its explicit budget."],
      evidence: [{ path: "kb/topics/mcp-primitive-decision.md", line: 21 }],
    },
  });
  assert.equal(decisionV2.structuredContent?.status, "proposed");

  const supersededDecision = await request("tools/call", {
    name: "kb.supersede_decision",
    arguments: {
      decisionId: "mcp-tool-primitive-v1",
      replacementId: "mcp-tool-primitive-v2",
      supersededAt: "2026-07-30",
      reason: "The replacement makes decision freshness explicit across tools and resources.",
    },
  });
  assert.equal(supersededDecision.structuredContent?.decisionId, "mcp-tool-primitive-v1");
  assert.equal(supersededDecision.structuredContent?.replacementId, "mcp-tool-primitive-v2");
  assert.equal(supersededDecision.structuredContent?.dryRun, false);

  const preferredDecision = await request("tools/call", {
    name: "kb.get_decision",
    arguments: { query: "MCP Tool Primitive", asOf: "2026-07-30", responseFormat: "full" },
  });
  assert.equal(preferredDecision.structuredContent?.decisionId, "mcp-tool-primitive-v2");
  assert.equal(preferredDecision.structuredContent?.status, "active");

  const decisionResources = await request("resources/list", {});
  assert.ok(
    decisionResources.resources.some(
      (resource: ListedResource) => resource.uri === "gke://decision/mcp-tool-primitive-v1",
    ),
  );
  assert.ok(
    decisionResources.resources.some(
      (resource: ListedResource) => resource.uri === "gke://decision/mcp-tool-primitive-v2",
    ),
  );
  const decisionResource = await request("resources/read", {
    uri: "gke://decision/mcp-tool-primitive-v1",
  });
  assert.equal(decisionResource.contents?.[0]?.mimeType, "text/markdown");
  assert.match(decisionResource.contents?.[0]?.text || "", /Status: superseded/);
  assert.match(decisionResource.contents?.[0]?.text || "", /Superseded by/);
  const decisionLedger = await request("resources/read", { uri: "gke://workspace/decisions" });
  assert.match(decisionLedger.contents?.[0]?.text || "", /mcp-tool-primitive-v2/);

  const sharedQuestion = "zzzzzzzzzzzzzzzzzzzz shared open-question smoke test";
  const openQuestionCreated = await request("tools/call", {
    name: "kb.add_open_question",
    arguments: {
      question: sharedQuestion,
      whyOpen: "No grounded evidence is available for this synthetic question.",
      whatWouldResolve: "Add a synthetic grounded source for this exact question.",
      owner: "mcp-smoke",
      source: "smoke-test",
    },
  });
  assert.ok(["created", "appended"].includes(openQuestionCreated.structuredContent?.action));
  assert.match(
    openQuestionCreated.structuredContent?.entryId || "",
    /^open-question-[a-f0-9]{16}$/,
  );

  const automaticNoCapture = await request("tools/call", {
    name: "kb.answer_and_capture",
    arguments: {
      question: sharedQuestion,
      mode: "generic",
      track: "__no_such_track__",
      strict: true,
    },
  });
  assert.equal(automaticNoCapture.structuredContent?.answer?.abstained, true);
  assert.equal(automaticNoCapture.structuredContent?.strategy, "none");
  assert.equal(automaticNoCapture.structuredContent?.capture?.action, "skipped");
  assert.match(
    automaticNoCapture.structuredContent?.capture?.reason || "",
    /automatic retention is read-only/i,
  );

  const abstainedDuplicate = await request("tools/call", {
    name: "kb.answer_and_capture",
    arguments: {
      question: sharedQuestion,
      mode: "generic",
      track: "__no_such_track__",
      strict: true,
      captureStrategy: "open_question",
    },
  });
  assert.equal(abstainedDuplicate.structuredContent?.answer?.abstained, true);
  assert.equal(abstainedDuplicate.structuredContent?.strategy, "open_question");
  assert.equal(abstainedDuplicate.structuredContent?.capture?.action, "unchanged");
  assert.equal(
    abstainedDuplicate.structuredContent?.capture?.entryId,
    openQuestionCreated.structuredContent?.entryId,
  );
  const openQuestionRaw = await fs.readFile(
    path.join(smokeRepoRoot, "kb/open_questions.md"),
    "utf8",
  );
  assert.equal(openQuestionRaw.split(`- question: ${sharedQuestion}`).length - 1, 1);

  const reviewTarget = "kb/topics/mcp-primitive-decision.md";
  const beforeReview = await fs.readFile(path.join(smokeRepoRoot, reviewTarget), "utf8");
  const captureToken = "MCP_CAPTURE_REVIEW_QUEUE_SMOKE";
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
      noteType: "concept",
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
        `- Verification token: ${captureToken}.`,
      ].join("\n"),
    },
  });
  assert.equal(answerAndCaptureNote.structuredContent?.dryRun, false);
  assert.equal(answerAndCaptureNote.structuredContent?.strategy, "note");
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.dryRun, false);
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.kind, "topic");
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.path, reviewTarget);
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.action, "proposed");
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.routing?.status, "resolved");
  assert.equal(
    answerAndCaptureNote.structuredContent?.capture?.routing?.fields?.module?.source,
    "explicit",
  );
  assert.equal(answerAndCaptureNote.structuredContent?.capture?.proposal?.requiresReview, true);
  assert.match(
    answerAndCaptureNote.structuredContent?.capture?.proposal?.path || "",
    /^\.gke\/capture-proposals\/capture-[a-z0-9-]+\.json$/,
  );
  assert.doesNotMatch(
    JSON.stringify(answerAndCaptureNote.structuredContent?.capture?.proposal),
    new RegExp(smokeRepoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(await fs.readFile(path.join(smokeRepoRoot, reviewTarget), "utf8"), beforeReview);
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.retrievalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.synthesisMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.captureMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.timings?.totalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.thresholdMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.totalMs, "number");
  assert.equal(typeof answerAndCaptureNote.structuredContent?.slo?.breached, "boolean");
  assert.ok(Array.isArray(answerAndCaptureNote.structuredContent?.warnings));

  await applyCaptureProposal({
    repoRoot: smokeRepoRoot,
    proposalId: answerAndCaptureNote.structuredContent.capture.proposal.proposalId,
    action: "replace",
  });
  assert.match(
    await fs.readFile(path.join(smokeRepoRoot, reviewTarget), "utf8"),
    new RegExp(captureToken),
  );

  await request("tools/call", {
    name: "kb.refresh",
    arguments: {},
  });

  const retained = await request("tools/call", {
    name: "kb.answer_grounded",
    arguments: {
      question: `What is recorded under ${captureToken}?`,
      mode: "generic",
      strict: false,
      responseMode: "curate",
      limit: 4,
      allowDirect: true,
    },
  });
  const retainedCitationPaths =
    retained.structuredContent?.citations?.map((citation: any) => citation.path) || [];
  assert.ok(retainedCitationPaths.includes(reviewTarget));

  const answerAndCaptureOpen = await request("tools/call", {
    name: "kb.answer_and_capture",
    arguments: {
      question: "zzzzzzzzzzzzzzzzzzzz unknown smoke test",
      mode: "generic",
      track: "__no_such_track__",
      strict: true,
      captureStrategy: "open_question",
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
  await fs.rm(smokeRepoRoot, { recursive: true, force: true });
}
