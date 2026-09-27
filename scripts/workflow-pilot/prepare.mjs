import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { catalog } from "./fixtures/catalog.mjs";
import { external, snapshot, evaluatorHashes, isMain, cli } from "./common.mjs";

export function prepare(workload, target) {
  const fixture = catalog[workload];
  if (!Object.hasOwn(catalog, workload)) throw new Error("Unknown workload");
  const root = target
    ? external(target)
    : external(fs.mkdtempSync(external(path.join(tmpdir(), "gke-pilot-"))));
  if (fs.existsSync(root) && fs.readdirSync(root).length)
    throw new Error("Output directory must be empty");
  fs.mkdirSync(path.join(root, "work"), { recursive: true });
  for (const [name, content] of Object.entries(fixture.files)) {
    const file = path.join(root, "work", name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, { flag: "wx" });
  }
  const manifest = {
    schemaVersion: 1,
    workload,
    files: snapshot(path.join(root, "work")),
    evaluator: evaluatorHashes(),
  };
  fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  return { root, workload, work: path.join(root, "work"), manifest };
}

if (isMain(import.meta.url))
  cli(() => {
    if (process.argv.length < 3 || process.argv.length > 4)
      throw new Error("Usage: node prepare.mjs <typo|adapters|ingestion> [empty-output-directory]");
    console.log(JSON.stringify(prepare(process.argv[2], process.argv[3]), null, 2));
  });
