#!/usr/bin/env node
import assert from "node:assert/strict";
import { buildToolCatalog, CATALOG_BUDGETS, type McpProfile } from "./catalog.js";
import { spawnKbServer } from "./mcp-client.js";
import { DEFAULT_PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS } from "./protocol.js";

function build(profile: McpProfile, writesEnabled: boolean) {
  return buildToolCatalog({
    profile,
    writesEnabled,
    defaultLimit: 8,
    maxLimit: 30,
    maxContext: 3,
    defaultSloMs: 3000,
  });
}

function assertCatalog(profile: McpProfile, writesEnabled: boolean): void {
  const tools = build(profile, writesEnabled);
  const budget = CATALOG_BUDGETS[profile];
  const serialized = JSON.stringify(tools);
  assert.ok(
    tools.length <= budget.maxTools,
    `${profile} tool count ${tools.length} exceeds ${budget.maxTools}`,
  );
  assert.ok(
    serialized.length <= budget.maxCharacters,
    `${profile} catalog ${serialized.length} chars exceeds ${budget.maxCharacters}`,
  );

  const names = tools.map((tool) => tool.name);
  const proposalCrudNames = [
    "kb.list_capture_proposals",
    "kb.get_capture_proposal",
    "kb.apply_capture_proposal",
    "kb.reject_capture_proposal",
  ];
  assert.equal(new Set(names).size, names.length, `${profile} contains duplicate tool names`);
  for (const name of proposalCrudNames) {
    assert.ok(!names.includes(name), `${profile} must not advertise proposal CRUD tool ${name}`);
  }
  for (const tool of tools) {
    assert.ok(tool.title, `${tool.name} is missing title`);
    assert.ok(tool.inputSchema, `${tool.name} is missing inputSchema`);
    assert.ok(tool.outputSchema, `${tool.name} is missing outputSchema`);
    assert.ok(tool.annotations, `${tool.name} is missing annotations`);
  }

  if (!writesEnabled) {
    assert.ok(!names.includes("kb.upsert_note"));
    assert.ok(!names.includes("kb.add_open_question"));
    assert.ok(!names.includes("kb.checkpoint_project"));
  }
  if (profile === "core") {
    assert.equal(tools.length, 4, "core must remain fixed at four semantic tools");
    assert.deepEqual(names, [
      "kb.search",
      "kb.get_record",
      "kb.answer_and_capture",
      "kb.resume_project",
    ]);

    const answerAndCapture = tools.find((tool) => tool.name === "kb.answer_and_capture") as any;
    assert.equal(answerAndCapture.inputSchema?.properties?.projectId?.type, "string");
    const outputProperties = answerAndCapture.outputSchema?.properties;
    assert.equal(outputProperties?.capture?.type, "object");
    assert.ok(
      answerAndCapture.outputSchema?.required?.includes("capture"),
      "kb.answer_and_capture must require its proposal-compatible capture envelope",
    );
  }
  if (profile === "full") {
    assert.ok(names.includes("kb.get_topic"));
    assert.ok(names.includes("kb.get_term"));
    if (writesEnabled) {
      const upsert = tools.find((tool) => tool.name === "kb.upsert_note") as any;
      const properties = upsert.inputSchema?.properties;
      assert.equal(properties?.projectId?.type, "string");
      assert.deepEqual(properties?.conflictPolicy?.enum, ["error", "append", "replace"]);
      assert.equal(properties?.baseContentHash?.pattern, "^[a-f0-9]{64}$");
      assert.deepEqual(properties?.sourceOperation?.enum, ["answer", "ingest", "upsert"]);
    }
  }
}

async function assertProtocolVersion(version: string): Promise<void> {
  const { child, client } = spawnKbServer({
    KB_MCP_PROFILE: "core",
    KB_MCP_ENABLE_WRITES: "false",
  });
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: version,
      capabilities: {},
      clientInfo: { name: "catalog-contract-test", version: "0.1.0" },
    });
    assert.equal(initialized.protocolVersion, version);
    assert.ok(initialized.capabilities?.tools);
    assert.ok(initialized.capabilities?.resources);
    client.notify("notifications/initialized", {});

    const listed = await client.request("tools/list", {});
    assert.deepEqual(
      listed.tools.map((tool: { name: string }) => tool.name),
      ["kb.search", "kb.get_record", "kb.answer_and_capture", "kb.resume_project"],
    );
    const answerTool = listed.tools.find(
      (tool: { name: string }) => tool.name === "kb.answer_and_capture",
    );
    assert.equal(answerTool.annotations?.readOnlyHint, true);

    const answered = await client.callTool("kb.answer_and_capture", {
      question: "Which MCP primitive is model controlled?",
      mode: "generic",
      strict: false,
      captureStrategy: "auto",
    });
    assert.equal(answered.isError, undefined);
    assert.equal(answered.structuredContent?.strategy, "none");
    assert.match(answered.structuredContent?.capture?.reason || "", /writes are disabled/i);

    const hiddenWrite = await client.callTool("kb.upsert_note", {
      kind: "topic",
      title: "Hidden Write",
      body: "Must not be callable in the core read-only profile.",
      dryRun: true,
    });
    assert.equal(hiddenWrite.isError, true);
  } finally {
    child.kill("SIGTERM");
  }
}

assertCatalog("core", false);
assertCatalog("core", true);
assertCatalog("full", false);
assertCatalog("full", true);
await assertProtocolVersion("2024-11-05");
await assertProtocolVersion("2025-06-18");

{
  const { child, client } = spawnKbServer({
    KB_MCP_PROFILE: "core",
    KB_MCP_ENABLE_WRITES: "false",
  });
  try {
    const initialized = await client.request("initialize", {
      protocolVersion: "2099-01-01",
      capabilities: {},
      clientInfo: { name: "unsupported-version-test", version: "0.1.0" },
    });
    assert.equal(initialized.protocolVersion, DEFAULT_PROTOCOL_VERSION);
    assert.ok(
      (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(initialized.protocolVersion),
    );
  } finally {
    child.kill("SIGTERM");
  }
}

const coreSize = JSON.stringify(build("core", false)).length;
const fullSize = JSON.stringify(build("full", true)).length;
console.log(`MCP catalog contract passed: core=${coreSize} chars, full=${fullSize} chars.`);
