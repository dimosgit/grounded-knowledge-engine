import fs from "node:fs";
import { isMain, cli } from "./common.mjs";

function requireCondition(ok, message) {
  if (!ok) throw new Error(message);
}
function object(value, fields) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    "Expected metrics object",
  );
  requireCondition(
    Object.keys(value).every((k) => fields.includes(k)) &&
      fields.every((k) => Object.hasOwn(value, k)),
    "Unexpected or missing metrics fields",
  );
}
function count(n) {
  requireCondition(Number.isSafeInteger(n) && n >= 0, "Invalid token or quality counter");
}
function label(s) {
  requireCondition(
    typeof s === "string" && /^[a-zA-Z0-9_.-]{1,100}$/.test(s),
    "Use sanitized metric identifiers",
  );
}
function timestamp(s) {
  requireCondition(
    typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s),
    "Use ISO UTC timestamps with milliseconds",
  );
  const time = Date.parse(s);
  requireCondition(
    Number.isFinite(time) && new Date(time).toISOString() === s,
    "Invalid timestamp",
  );
  return time;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(data) {
  object(data, ["schemaVersion", "runs"]);
  requireCondition(data.schemaVersion === 1, "Unsupported metrics schema version");
  requireCondition(Array.isArray(data.runs) && data.runs.length > 0, "No runs provided");
  const runKeys = new Set();
  const sessionIds = new Set();
  const runs = data.runs.map((run) => {
    object(run, [
      "arm",
      "workload",
      "repetition",
      "fixtureId",
      "startedAt",
      "endedAt",
      "coordinatorId",
      "treeComplete",
      "expectedSessionIds",
      "sessions",
      "quality",
    ]);
    requireCondition(["A", "B", "C", "D"].includes(run.arm), "Unknown arm");
    requireCondition(["typo", "adapters", "ingestion"].includes(run.workload), "Unknown workload");
    requireCondition(
      run.arm !== "D" || run.workload === "adapters",
      "Arm D applies only to adapters",
    );
    count(run.repetition);
    requireCondition(run.repetition > 0, "Repetition must be positive");
    requireCondition(
      typeof run.fixtureId === "string" && /^[a-f0-9]{64}$/.test(run.fixtureId),
      "Invalid fixture checksum",
    );
    const key = `${run.arm}/${run.workload}/${run.repetition}`;
    requireCondition(!runKeys.has(key), "Duplicate arm/workload/repetition");
    runKeys.add(key);
    const started = timestamp(run.startedAt),
      ended = timestamp(run.endedAt);
    requireCondition(ended > started, "Invalid run time range");
    label(run.coordinatorId);
    requireCondition(
      typeof run.treeComplete === "boolean",
      "Missing tree completeness declaration",
    );
    requireCondition(
      Array.isArray(run.expectedSessionIds) && run.expectedSessionIds.length > 0,
      "Expected session inventory required",
    );
    run.expectedSessionIds.forEach(label);
    requireCondition(
      new Set(run.expectedSessionIds).size === run.expectedSessionIds.length,
      "Duplicate expected session ID",
    );
    requireCondition(
      run.expectedSessionIds.includes(run.coordinatorId),
      "Coordinator missing from inventory",
    );
    requireCondition(Array.isArray(run.sessions), "Expected session records");
    const byModel = new Map();
    const observed = new Set();
    let complete = run.treeComplete;
    for (const session of run.sessions) {
      object(session, ["id", "model", "reasoning", "usage"]);
      label(session.id);
      requireCondition(
        !sessionIds.has(session.id),
        "Duplicate session ID; supply final counters once",
      );
      sessionIds.add(session.id);
      observed.add(session.id);
      requireCondition(
        run.expectedSessionIds.includes(session.id),
        "Session absent from inventory",
      );
      if (session.model !== null) label(session.model);
      else complete = false;
      if (session.reasoning !== null) label(session.reasoning);
      if (session.usage !== null) {
        object(session.usage, ["inputTokens", "cachedInputTokens", "outputTokens"]);
        for (const n of Object.values(session.usage)) if (n !== null) count(n);
        if (session.usage.inputTokens !== null && session.usage.cachedInputTokens !== null)
          requireCondition(
            session.usage.cachedInputTokens <= session.usage.inputTokens,
            "Cached input exceeds input tokens",
          );
      }
      const bucket = byModel.get(session.model) || {
        model: session.model,
        sessions: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
      };
      bucket.sessions++;
      for (const field of ["inputTokens", "cachedInputTokens", "outputTokens"]) {
        const n = session.usage?.[field] ?? null;
        if (n === null) {
          bucket[field] = null;
          complete = false;
        } else if (bucket[field] !== null) {
          bucket[field] += n;
          count(bucket[field]);
        }
      }
      byModel.set(session.model, bucket);
    }
    if (run.expectedSessionIds.some((id) => !observed.has(id))) complete = false;
    const perModel = [...byModel.values()];
    function total(field) {
      const values = perModel.map((b) => b[field]);
      return complete && values.every((v) => v !== null) ? values.reduce((a, b) => a + b, 0) : null;
    }
    object(run.quality, ["passed", "total", "scopeViolations"]);
    Object.values(run.quality).forEach(count);
    requireCondition(
      run.quality.total > 0 && run.quality.passed <= run.quality.total,
      "Invalid quality result",
    );
    const inputTokens = total("inputTokens"),
      outputTokens = total("outputTokens");
    const cachedInputTokens = total("cachedInputTokens");
    for (const n of [inputTokens, outputTokens, cachedInputTokens]) if (n !== null) count(n);
    const totalTokens =
      inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens;
    if (totalTokens !== null) count(totalTokens);
    const coordinator = run.sessions.find((s) => s.id === run.coordinatorId);
    return {
      arm: run.arm,
      workload: run.workload,
      repetition: run.repetition,
      fixtureId: run.fixtureId,
      seconds: (ended - started) / 1000,
      quality: { ...run.quality },
      accepted: run.quality.passed === run.quality.total && run.quality.scopeViolations === 0,
      coordinatorModel: coordinator?.model ?? null,
      coordinatorReasoning: coordinator?.reasoning ?? null,
      usageStatus: complete ? "complete" : "partial",
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      uncachedInputTokens: inputTokens === null ? null : inputTokens - cachedInputTokens,
      observedPerModel: perModel,
      costEstimate: null,
    };
  });
  const groups = [];
  for (const workload of ["typo", "adapters", "ingestion"])
    for (const arm of ["A", "B", "C", "D"]) {
      const members = runs.filter((r) => r.workload === workload && r.arm === arm);
      if (!members.length) continue;
      const times = members.map((r) => r.seconds);
      groups.push({
        workload,
        arm,
        runs: members.length,
        accepted: members.filter((r) => r.accepted).length,
        medianSeconds: median(times),
        minSeconds: Math.min(...times),
        maxSeconds: Math.max(...times),
      });
    }
  const comparisons = [];
  for (const workload of ["typo", "adapters", "ingestion"])
    for (const [baseline, variant] of [
      ["A", "B"],
      ["B", "C"],
      ["C", "D"],
    ]) {
      const left = runs.filter((r) => r.workload === workload && r.arm === baseline);
      const right = runs.filter((r) => r.workload === workload && r.arm === variant);
      if (!left.length || !right.length) continue;
      const pairs = left
        .map((a) => [a, right.find((b) => b.repetition === a.repetition)])
        .filter(([, b]) => b);
      const matched = pairs.length === left.length && pairs.length === right.length;
      const sameFixtures = pairs.every(
        ([a, b]) => a.fixtureId === b.fixtureId && a.quality.total === b.quality.total,
      );
      const sameSettings =
        baseline === "A" ||
        pairs.every(
          ([a, b]) =>
            a.coordinatorModel !== null &&
            a.coordinatorReasoning !== null &&
            a.coordinatorModel === b.coordinatorModel &&
            a.coordinatorReasoning === b.coordinatorReasoning,
        );
      const distinctModels =
        baseline !== "A" ||
        pairs.every(
          ([a, b]) =>
            a.coordinatorModel !== null &&
            b.coordinatorModel !== null &&
            a.coordinatorModel !== b.coordinatorModel,
        );
      const qualityPreserved = pairs.length > 0 && [...left, ...right].every((r) => r.accepted);
      const comparable =
        matched && sameFixtures && sameSettings && distinctModels && pairs.length > 0;
      const reduction = comparable
        ? 100 * (1 - median(right.map((r) => r.seconds)) / median(left.map((r) => r.seconds)))
        : null;
      comparisons.push({
        workload,
        baseline,
        variant,
        pairedRuns: pairs.length,
        comparable,
        qualityPreserved,
        timeReductionPercent: reduction,
        provisionalTimeFinding:
          comparable && qualityPreserved && pairs.length >= 3 && reduction >= 20,
        efficiencyWin: false,
        note: "Cost unavailable; no overall efficiency claim. Cache balance, authority compliance, and model eligibility require operator review.",
      });
    }
  return { schemaVersion: 1, runs, groups, comparisons };
}

if (isMain(import.meta.url))
  cli(() => {
    if (process.argv.length !== 3)
      throw new Error("Usage: node summarize.mjs <normalized-metrics.json>");
    let input;
    try {
      input = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    } catch {
      throw new Error("Cannot read normalized metrics JSON");
    }
    console.log(JSON.stringify(summarize(input), null, 2));
  });
