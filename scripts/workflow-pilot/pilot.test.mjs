import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { prepare } from "./prepare.mjs";
import { evaluate } from "./evaluate.mjs";
import { summarize } from "./summarize.mjs";
import { here, repo } from "./common.mjs";

test("workflow stays explicit-only and within its context budget", () => {
  const source = path.join(here, "../../skills/complex-task-workflow");
  const discovered = path.join(here, "../../.agents/skills/complex-task-workflow");
  assert.equal(fs.realpathSync(discovered), fs.realpathSync(source));
  const skill = fs.readFileSync(path.join(source, "SKILL.md"));
  assert.ok(skill.byteLength <= 3600, `skill entrypoint is ${skill.byteLength} bytes`);
  const metadata = fs.readFileSync(path.join(source, "agents/openai.yaml"), "utf8");
  assert.match(metadata, /^\s*allow_implicit_invocation:\s*false\s*$/m);
});

function temp(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "gke-pilot-test-"));
  // Only this exact test-owned temporary directory is cleaned up.
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function runFixture(t, workload) {
  return prepare(workload, path.join(temp(t), "run"));
}
function write(root, name, content) {
  fs.writeFileSync(path.join(root, "work", name), content);
}

// Test-only known-correct solutions; never copied into worker fixtures.
function normalize(rows) {
  if (!Array.isArray(rows)) throw new TypeError();
  const seen = new Set();
  return rows.map((row) => {
    if (!row || typeof row.id !== "string" || typeof row.title !== "string") throw new TypeError();
    const id = row.id.trim(),
      title = row.title.trim();
    if (!id || !title || seen.has(id)) throw new TypeError();
    seen.add(id);
    return { id, title };
  });
}
function parseJson(text) {
  if (typeof text !== "string") throw new TypeError();
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new TypeError();
  }
  return normalize(rows);
}
function parseCsv(text) {
  if (typeof text !== "string") throw new TypeError();
  const rows = [];
  let row = [],
    field = "",
    quoted = false,
    closed = false,
    touched = false;
  function cell() {
    row.push(field);
    field = "";
    closed = false;
  }
  function line() {
    if (touched || row.length || field) {
      cell();
      rows.push(row);
    }
    row = [];
    field = "";
    closed = false;
    touched = false;
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += ch;
    } else if (ch === "," || ch === "\n" || ch === "\r") {
      if (ch === ",") {
        cell();
        touched = true;
      } else {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        line();
      }
    } else if (closed) throw new TypeError();
    else if (ch === '"') {
      if (field) throw new TypeError();
      quoted = true;
      touched = true;
    } else {
      field += ch;
      touched = true;
    }
  }
  if (quoted) throw new TypeError();
  line();
  if (!rows.length || rows[0].length !== 2 || rows[0][0] !== "id" || rows[0][1] !== "title")
    throw new TypeError();
  return normalize(
    rows.slice(1).map((r) => {
      if (r.length !== 2) throw new TypeError();
      return { id: r[0], title: r[1] };
    }),
  );
}
function solve(root, workload) {
  if (workload === "typo")
    write(
      root,
      "README.md",
      fs
        .readFileSync(path.join(root, "work/README.md"), "utf8")
        .replace("Save chagnes", "Save changes"),
    );
  if (workload === "adapters") {
    write(root, "json.mjs", `${normalize}\nexport ${parseJson}`);
    write(root, "csv.mjs", `${normalize}\nexport ${parseCsv}`);
    write(
      root,
      "summary.mjs",
      `import {parseJson} from './json.mjs';import {parseCsv} from './csv.mjs';export function summarize(format,text){if(!['json','csv'].includes(format))throw new TypeError();const rows=(format==='json'?parseJson:parseCsv)(text);return {count:rows.length,titles:rows.map(r=>r.title).sort()};}`,
    );
  }
  if (workload === "ingestion") {
    write(
      root,
      "store.mjs",
      `export function createStore(){return new Map();}export function upsert(store,record){const key=JSON.stringify([record.projectId,record.sourceId]);if(store.get(key)?.content===record.content)return false;store.set(key,{...record});return true;}`,
    );
    write(
      root,
      "ingest.mjs",
      `import {upsert} from './store.mjs';export function ingest(store,projectId,sourceId,content){if(!(store instanceof Map)||typeof projectId!=='string'||!projectId||typeof sourceId!=='string'||!sourceId||typeof content!=='string')throw new TypeError();return upsert(store,{projectId,sourceId,content});}`,
    );
    write(
      root,
      "search.mjs",
      `export function search(store,projectId,query){if(!(store instanceof Map)||typeof projectId!=='string'||!projectId||typeof query!=='string')throw new TypeError();return [...store.values()].filter(r=>r.projectId===projectId&&r.content.includes(query)).sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0).map(r=>({...r}));}`,
    );
  }
}

test("prepare refuses nonempty targets and preserves sentinel", (t) => {
  const dir = temp(t);
  fs.writeFileSync(path.join(dir, "sentinel"), "keep");
  assert.throws(() => prepare("typo", dir), /empty/);
  assert.equal(fs.readFileSync(path.join(dir, "sentinel"), "utf8"), "keep");
});
test("prepare rejects repository paths and symlinked parents", (t) => {
  const dir = temp(t);
  fs.symlinkSync(repo, path.join(dir, "alias"), "dir");
  for (const target of [
    repo,
    path.dirname(repo),
    path.join(repo, "output"),
    path.join(dir, "alias/output"),
    path.join(here, "fixtures/output"),
  ])
    assert.throws(() => prepare("typo", target), /overlap/);
  assert.throws(() => prepare("unknown", path.join(dir, "other")), /workload/);
});
test("arms start with identical checksums and isolated files", (t) => {
  const dir = temp(t);
  const a = prepare("adapters", path.join(dir, "A"));
  const b = prepare("adapters", path.join(dir, "B"));
  assert.deepEqual(a.manifest, b.manifest);
  write(a.root, "json.mjs", "changed");
  assert.notEqual(fs.readFileSync(path.join(b.work, "json.mjs"), "utf8"), "changed");
});
for (const workload of ["typo", "adapters", "ingestion"])
  test(`grades broken and correct ${workload}`, (t) => {
    const { root, work } = runFixture(t, workload);
    const broken = evaluate(root);
    assert.ok(broken.passed < broken.total);
    solve(root, workload);
    const good = evaluate(root);
    assert.equal(good.passed, good.total, JSON.stringify(good));
    assert.equal(good.scopeViolations, 0);
    if (workload !== "typo") execFileSync(process.execPath, ["visible.test.mjs"], { cwd: work });
  });
test("detects extra files and changed read-only tests", (t) => {
  const { root } = runFixture(t, "adapters");
  solve(root, "adapters");
  write(root, "extra.txt", "extra");
  assert.ok(evaluate(root).scopeViolations > 0);
  fs.unlinkSync(path.join(root, "work/extra.txt"));
  write(root, "visible.test.mjs", "changed");
  assert.ok(evaluate(root).scopeViolations > 0);
});
test("rejects changed evaluator checksum and changed manifest baseline", (t) => {
  for (const field of ["evaluator", "files"]) {
    const { root } = runFixture(t, "typo");
    solve(root, "typo");
    const p = path.join(root, "manifest.json"),
      m = JSON.parse(fs.readFileSync(p));
    m[field] = {};
    fs.writeFileSync(p, JSON.stringify(m));
    assert.ok(evaluate(root).scopeViolations > 0);
  }
});
test("detects mutation during acceptance execution", (t) => {
  const { root } = runFixture(t, "adapters");
  solve(root, "adapters");
  fs.appendFileSync(
    path.join(root, "work/json.mjs"),
    "\nimport fs from 'node:fs';fs.writeFileSync('visible.test.mjs','changed');\n",
  );
  const result = evaluate(root);
  assert.equal(result.checks.find((c) => c.name === "scope after").passed, false);
});
test("does not follow symlinked worker files", (t) => {
  const { root } = runFixture(t, "typo");
  fs.unlinkSync(path.join(root, "work/README.md"));
  fs.symlinkSync(path.join(repo, "README.md"), path.join(root, "work/README.md"));
  assert.ok(evaluate(root).scopeViolations > 0);
});
test("worker hangs and syntax errors fail acceptance", (t) => {
  const { root } = runFixture(t, "adapters");
  for (const code of ["while(true){}", "not valid syntax !"]) {
    write(root, "json.mjs", code);
    const r = evaluate(root, { timeoutMs: 250 });
    assert.ok(r.passed < r.total);
  }
});

function metric(arm = "A", rep = 1, seconds = 10) {
  const id = `session-${arm}-${rep}`;
  return {
    arm,
    workload: "adapters",
    repetition: rep,
    fixtureId: "a".repeat(64),
    startedAt: "2026-09-14T00:00:00.000Z",
    endedAt: new Date(Date.parse("2026-09-14T00:00:00.000Z") + seconds * 1000).toISOString(),
    coordinatorId: id,
    treeComplete: true,
    expectedSessionIds: [id],
    sessions: [
      {
        id,
        model: arm === "A" ? "strong-example" : "worker-example",
        reasoning: "medium",
        usage: { inputTokens: 100, cachedInputTokens: 80, outputTokens: 10 },
      },
    ],
    quality: { passed: 10, total: 10, scopeViolations: 0 },
  };
}
const summary = (...runs) => summarize({ schemaVersion: 1, runs });
test("sums coordinator and child final counters once; wall time is run span", () => {
  const run = metric("D");
  run.expectedSessionIds.push("child");
  run.sessions.push({
    id: "child",
    model: "worker-example",
    reasoning: "low",
    usage: { inputTokens: 40, cachedInputTokens: 20, outputTokens: 5 },
  });
  const r = summary(run).runs[0];
  assert.equal(r.seconds, 10);
  assert.equal(r.totalTokens, 155);
  assert.equal(r.uncachedInputTokens, 40);
  assert.equal(r.observedPerModel.length, 1);
});
test("missing descendant or counters never become zero", () => {
  const a = metric();
  a.expectedSessionIds.push("missing");
  const r = summary(a).runs[0];
  assert.equal(r.usageStatus, "partial");
  assert.equal(r.totalTokens, null);
  const b = metric();
  b.sessions[0].usage.cachedInputTokens = null;
  assert.equal(summary(b).runs[0].cachedInputTokens, null);
  const c = metric();
  c.sessions = [];
  assert.equal(summary(c).runs[0].inputTokens, null);
  const d = metric();
  d.treeComplete = false;
  assert.equal(summary(d).runs[0].usageStatus, "partial");
});
test("rejects duplicates, invalid counters, schema, and timestamps", () => {
  assert.throws(() => summarize({ schemaVersion: 2, runs: [metric()] }), /version/);
  assert.throws(() => summary(metric(), metric()), /Duplicate/);
  const a = metric();
  a.sessions.push({ ...a.sessions[0] });
  assert.throws(() => summary(a), /Duplicate/);
  for (const [field, value] of [
    ["inputTokens", -1],
    ["inputTokens", 1.5],
    ["cachedInputTokens", 101],
    ["outputTokens", Infinity],
  ]) {
    const r = metric();
    r.sessions[0].usage[field] = value;
    assert.throws(() => summary(r));
  }
  for (const end of ["invalid", "2026-09-13T00:00:00.000Z", "2026-02-30T00:00:00.000Z"]) {
    const r = metric();
    r.endedAt = end;
    assert.throws(() => summary(r));
  }
});
test("rejects raw log fields and unsanitized identifiers", () => {
  const a = metric();
  a.transcript = "should not export";
  assert.throws(() => summary(a), /fields/);
  const b = metric();
  b.sessions[0].model = "/local/path";
  assert.throws(() => summary(b), /identifiers/);
});
test("failed runs remain in groups and prevent a positive finding", () => {
  const runs = [];
  for (let i = 1; i <= 3; i++) runs.push(metric("A", i, 10), metric("B", i, 5));
  runs[1].quality.passed = 9;
  const r = summary(...runs);
  assert.equal(r.runs.length, 6);
  assert.equal(r.groups[1].runs, 3);
  assert.equal(r.comparisons[0].qualityPreserved, false);
  assert.equal(r.comparisons[0].provisionalTimeFinding, false);
});
test("paired reductions are provisional; cost is never invented", () => {
  const runs = [];
  for (let i = 1; i <= 3; i++) runs.push(metric("B", i, 10), metric("C", i, 7));
  const r = summary(...runs);
  assert.ok(Math.abs(r.comparisons[0].timeReductionPercent - 30) < 0.001);
  assert.equal(r.comparisons[0].provisionalTimeFinding, true);
  assert.equal(r.comparisons[0].efficiencyWin, false);
  assert.equal(r.runs[0].costEstimate, null);
});
test("mismatched settings, fixtures, or incomplete pairs cannot claim improvement", () => {
  for (const field of ["model", "fixture", "pairs"]) {
    const a = metric("B"),
      b = metric("C", 1, 5);
    if (field === "model") b.sessions[0].model = "different";
    if (field === "fixture") b.fixtureId = "b".repeat(64);
    const r = summary(a, b, ...(field === "pairs" ? [metric("C", 2)] : []));
    assert.equal(r.comparisons[0].comparable, false);
  }
});
test("CLI returns nonzero for wrong output and invalid metrics", (t) => {
  const { root } = runFixture(t, "typo");
  assert.throws(() =>
    execFileSync(process.execPath, [path.join(here, "evaluate.mjs"), root], { stdio: "pipe" }),
  );
  const metrics = path.join(temp(t), "metrics.json");
  fs.writeFileSync(metrics, '{"schemaVersion":2,"runs":[]}');
  assert.throws(() =>
    execFileSync(process.execPath, [path.join(here, "summarize.mjs"), metrics], { stdio: "pipe" }),
  );
});
