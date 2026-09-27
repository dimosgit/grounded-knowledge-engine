import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { catalog } from "./fixtures/catalog.mjs";
import { external, snapshot, evaluatorHashes, hash, here, isMain, cli } from "./common.mjs";

export function evaluate(target, { timeoutMs = 10000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    throw new Error("Invalid evaluation timeout");
  const root = external(target);
  const manifestFile = path.join(root, "manifest.json");
  const manifestText = fs.readFileSync(manifestFile, "utf8");
  const manifest = JSON.parse(manifestText);
  if (manifest.schemaVersion !== 1 || !Object.hasOwn(catalog, manifest.workload))
    throw new Error("Unsupported pilot manifest");
  const fixture = catalog[manifest.workload];
  const expected = Object.fromEntries(
    Object.entries(fixture.files).map(([name, content]) => [name, hash(content)]),
  );
  const same = (a, b) =>
    JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  const checks = [];
  function check(name, run) {
    let passed = false;
    try {
      passed = !!run();
    } catch {
      /* An unreadable or changed artifact fails closed. */
    }
    checks.push({ name, passed });
  }
  const work = path.join(root, "work");
  function intact() {
    const files = snapshot(work);
    return (
      Object.keys(files).length === Object.keys(expected).length &&
      Object.entries(expected).every(
        ([name, digest]) =>
          Object.hasOwn(files, name) && (fixture.allowed.includes(name) || files[name] === digest),
      )
    );
  }
  check("manifest integrity", () => same(manifest.files, expected));
  check("evaluator integrity before", () => same(manifest.evaluator, evaluatorHashes()));
  check("scope before", () => intact());
  if (checks.every((c) => c.passed)) {
    try {
      const output = execFileSync(
        process.execPath,
        [path.join(here, "cases.mjs"), manifest.workload, work],
        {
          cwd: work,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const cases = JSON.parse(output);
      if (
        !Array.isArray(cases) ||
        !cases.length ||
        cases.some((c) => typeof c.name !== "string" || typeof c.passed !== "boolean")
      )
        throw new Error("Invalid case results");
      checks.push(...cases);
    } catch {
      checks.push({ name: "acceptance execution", passed: false });
    }
  } else checks.push({ name: "acceptance blocked by integrity", passed: false });
  check("scope after", () => intact());
  check("evaluator integrity after", () => same(manifest.evaluator, evaluatorHashes()));
  check("manifest unchanged", () => fs.readFileSync(manifestFile, "utf8") === manifestText);
  const scopeViolations = checks.filter(
    (c) => !c.passed && /scope|integrity|manifest/.test(c.name),
  ).length;
  return {
    schemaVersion: 1,
    workload: manifest.workload,
    fixtureId: hash(JSON.stringify({ files: expected, evaluator: manifest.evaluator })),
    checks,
    passed: checks.filter((c) => c.passed).length,
    total: checks.length,
    scopeViolations,
  };
}
if (isMain(import.meta.url))
  cli(() => {
    if (process.argv.length !== 3) throw new Error("Usage: node evaluate.mjs <pilot-directory>");
    const result = evaluate(process.argv[2]);
    console.log(JSON.stringify(result, null, 2));
    if (result.passed !== result.total) process.exitCode = 1;
  });
