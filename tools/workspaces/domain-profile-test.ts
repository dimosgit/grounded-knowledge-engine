#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspaceContext } from "./config.js";
import {
  DEFAULT_DOMAIN_PROFILE,
  advertisedModeNames,
  applyDomainScoringRules,
  domainFingerprint,
  resolveDomainProfile,
  resolveModeAlias,
} from "./domain-profile.js";
import type { WorkspaceDomainConfig } from "./types.js";

// A domain block shaped like a real specialized workspace (SAP-style values).
const SPECIALIZED: WorkspaceDomainConfig = {
  label: "SAP",
  modeAliases: { sap: "domain", vorwerk: "project" },
  queryExpansions: {
    merge: "replace",
    entries: { rap: ["restful", "abap"], eml: ["entity", "manipulation", "language"] },
  },
  textNormalizations: [
    { pattern: "s\\s*\\/\\s*4\\s*h?ana", replacement: " s4hana " },
    { pattern: "\\bmy\\s*inbox\\b", replacement: " myinbox " },
  ],
  pathMappings: [
    { prefix: "SAP-resources/", sourceKind: "reference-source", track: "sap" },
    { prefix: "vorwerk/", sourceKind: "project", track: "sap" },
    { prefix: "kb/", track: "sap" },
  ],
  defaultTrack: "sap",
  inferMode: {
    project: ["\\bvorwerk\\b|\\btask\\s*\\d+\\b"],
    domain: ["\\brap\\b|\\babap\\b|\\beml\\b"],
  },
  projectQueryPattern: "\\bvorwerk\\b",
  scoringRules: [
    {
      id: "book_priority",
      backend: "sqlite",
      mode: "domain",
      sourceKind: "reference-source",
      queryRegex: "\\b(rap|eml)\\b",
      boost: 720,
    },
    { id: "ops_penalty", backend: "sqlite", mode: "domain", module: "knowledge-ops", boost: -360 },
    { id: "module_pref", mode: "project", module: "vorwerk-cr-so", boost: 2.1 },
  ],
  captureDefaults: {
    track: "sap",
    module: "rap-core",
    tags: ["sap", "kb-captured"],
    moduleTagRules: [{ tag: "rap", moduleRegex: "rap" }],
  },
  primaryModuleRules: [
    { module: "workflow-approvals", queryRegex: "\\bworkflow\\b|\\bapproval\\b" },
  ],
  projectModeModule: "vorwerk-cr-so",
  defaultModule: "rap-core",
};

function testDefaultProfileReproducesHistoricalBehavior(): void {
  const profile = DEFAULT_DOMAIN_PROFILE;
  assert.equal(profile.label, "Domain");
  assert.deepEqual(profile.queryExpansions, {
    mcp: ["model", "context", "protocol"],
    kb: ["knowledge", "base"],
  });
  assert.equal(profile.textNormalizations.length, 0);
  assert.equal(profile.defaultTrack, "domain");
  assert.equal(profile.projectQueryPattern.test("about the project"), true);
  assert.equal(profile.projectQueryPattern.test("about vorwerk"), false);
  assert.deepEqual(advertisedModeNames(profile), ["auto", "domain", "project", "generic"]);
  assert.equal(resolveModeAlias(profile, "domain"), "domain");
  assert.equal(resolveModeAlias(profile, "unknown"), "unknown");
  // Historical term fast-path patterns.
  assert.match("what is MCP in domain?", profile.termQuestionPatterns[0]);
  assert.match("define MCP in domain", profile.termQuestionPatterns[1]);
  // Historical path classification.
  assert.deepEqual(profile.pathMappings, [
    { prefix: "source-docs/", sourceKind: "reference-source", track: "domain" },
    { prefix: "project/", sourceKind: "project", track: "domain" },
    { prefix: "kb/", track: "domain" },
  ]);
  // Historical module routing.
  assert.equal(profile.projectModeModule, "project-tracking");
  assert.equal(profile.defaultModule, "general");
  assert.equal(profile.scoringRules.length, 0);
}

function testSpecializedProfile(): void {
  const profile = resolveDomainProfile(SPECIALIZED);
  assert.equal(resolveModeAlias(profile, "sap"), "domain");
  assert.equal(resolveModeAlias(profile, "VORWERK"), "project");
  assert.deepEqual(advertisedModeNames(profile), ["auto", "sap", "vorwerk", "generic"]);

  // replace-merge drops the built-in dictionary
  assert.equal(profile.queryExpansions.mcp, undefined);
  assert.deepEqual(profile.queryExpansions.rap, ["restful", "abap"]);

  // extra normalizations compile with global flags
  let normalized = "S/4HANA my inbox".toLowerCase();
  for (const rule of profile.textNormalizations) {
    normalized = normalized.replace(rule.pattern, rule.replacement);
  }
  assert.match(normalized, /s4hana/);
  assert.match(normalized, /myinbox/);

  // glossary-question patterns adopt the label token
  assert.match("what is EML in sap?", profile.termQuestionPatterns[0]);
  assert.doesNotMatch("what is EML in domain?", profile.termQuestionPatterns[0]);

  assert.equal(profile.projectQueryPattern.test("vorwerk approval flow"), true);
  assert.equal(profile.projectQueryPattern.test("generic project"), false);
}

function testScoringRuleGates(): void {
  const profile = resolveDomainProfile(SPECIALIZED);
  const bookHit = applyDomainScoringRules(profile, {
    backend: "sqlite",
    mode: "domain",
    query: "rap determination in local mode",
    sourceKind: "reference-source",
    module: "rap-core",
    track: "sap",
  });
  assert.deepEqual(
    bookHit.map((rule) => rule.id),
    ["book_priority"],
  );

  // backend gate: the same candidate on bm25 gets nothing
  assert.equal(
    applyDomainScoringRules(profile, {
      backend: "bm25",
      mode: "domain",
      query: "rap determination",
      sourceKind: "reference-source",
    }).length,
    0,
  );

  // unconditional module penalty in domain mode
  const penalty = applyDomainScoringRules(profile, {
    backend: "sqlite",
    mode: "domain",
    query: "anything at all",
    sourceKind: "kb-topic",
    module: "knowledge-ops",
  });
  assert.deepEqual(
    penalty.map((rule) => rule.id),
    ["ops_penalty"],
  );

  // both-backend module preference in project mode
  for (const backend of ["bm25", "sqlite"] as const) {
    const pref = applyDomainScoringRules(profile, {
      backend,
      mode: "project",
      query: "task 4",
      module: "vorwerk-cr-so",
    });
    assert.deepEqual(
      pref.map((rule) => rule.id),
      ["module_pref"],
    );
  }
}

function testFingerprintTracksVocabulary(): void {
  const base = domainFingerprint(DEFAULT_DOMAIN_PROFILE);
  assert.equal(base, domainFingerprint(resolveDomainProfile()));
  assert.notEqual(base, domainFingerprint(resolveDomainProfile(SPECIALIZED)));
}

async function testWorkspaceConfigCarriesDomainAndUi(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-domain-config-"));
  try {
    await fs.mkdir(path.join(root, "kb"), { recursive: true });
    await fs.mkdir(path.join(root, ".gke"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".gke", "workspace.json"),
      JSON.stringify({
        id: "domain-test",
        scanRoots: ["kb"],
        domain: SPECIALIZED,
        ui: {
          sourceFolders: [{ from: "kb" }, { from: "notes", to: "kb" }],
          rootFiles: ["readme.md"],
          defaultActiveTrack: "sap",
        },
      }),
    );
    const workspace = await loadWorkspaceContext({ repoRoot: root });
    assert.equal(workspace.domain.label, "SAP");
    assert.equal(resolveModeAlias(workspace.domain, "sap"), "domain");
    assert.equal(workspace.domain.captureDefaults.module, "rap-core");
    assert.deepEqual(workspace.ui.sourceFolders, [
      { from: "kb", to: "kb" },
      { from: "notes", to: "kb" },
    ]);
    assert.deepEqual(workspace.ui.rootFiles, ["readme.md"]);
    assert.equal(workspace.ui.defaultActiveTrack, "sap");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testWorkspaceWithoutDomainUsesDefaults(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gke-domain-default-"));
  try {
    await fs.mkdir(path.join(root, "kb"), { recursive: true });
    await fs.mkdir(path.join(root, ".gke"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".gke", "workspace.json"),
      JSON.stringify({ id: "plain", scanRoots: ["kb"] }),
    );
    const workspace = await loadWorkspaceContext({ repoRoot: root });
    assert.equal(domainFingerprint(workspace.domain), domainFingerprint(DEFAULT_DOMAIN_PROFILE));
    assert.deepEqual(workspace.ui, {});
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

testDefaultProfileReproducesHistoricalBehavior();
testSpecializedProfile();
testScoringRuleGates();
testFingerprintTracksVocabulary();
await testWorkspaceConfigCarriesDomainAndUi();
await testWorkspaceWithoutDomainUsesDefaults();
console.log("Domain profile tests passed.");
