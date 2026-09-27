import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { catalog } from "./fixtures/catalog.mjs";

// Run only in an operator-controlled sandbox: a subprocess is not an OS sandbox.
const [workload, root] = process.argv.slice(2);
const checks = [];
function check(name, run) {
  try {
    run();
    checks.push({ name, passed: true });
  } catch {
    checks.push({ name, passed: false });
  }
}
const load = (name) => import(pathToFileURL(path.join(root, name)).href);
try {
  if (workload === "typo") {
    check("exact correction", () =>
      assert.equal(
        fs.readFileSync(path.join(root, "README.md"), "utf8"),
        catalog.typo.files["README.md"].replace("Save chagnes", "Save changes"),
      ),
    );
  } else if (workload === "adapters") {
    const { parseJson } = await load("json.mjs");
    const { parseCsv } = await load("csv.mjs");
    const { summarize } = await load("summary.mjs");
    for (const [name, input, expected] of [
      ["json trim", '[{"id":" a ","title":" A ","other":true}]', [{ id: "a", title: "A" }]],
      ["json empty", "[]", []],
      [
        "json prototype id",
        '[{"id":"__proto__","title":"ok"}]',
        [{ id: "__proto__", title: "ok" }],
      ],
    ])
      check(name, () => assert.deepEqual(parseJson(input), expected));
    for (const [index, input] of [
      null,
      [],
      "{",
      "{}",
      "[null]",
      '[{"id":"a","title":2}]',
      '[{"id":" ","title":"ok"}]',
      '[{"id":"x","title":" "}]',
      '[{"id":"a","title":"A"},{"id":" a ","title":"B"}]',
    ].entries()) {
      check(`json rejection ${index}`, () => assert.throws(() => parseJson(input), TypeError));
    }
    for (const [name, input, expected] of [
      ["csv header", "id,title", []],
      ["csv quoted header", '"id","title"\na,A', [{ id: "a", title: "A" }]],
      [
        "csv trim and crlf",
        "id,title\r\na, A \r\n\r\nb,B\r\n",
        [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      ],
      ["csv quoted comma", 'id,title\na,"A,B"', [{ id: "a", title: "A,B" }]],
      ["csv escaped quote", 'id,title\na,"A ""quote"""', [{ id: "a", title: 'A "quote"' }]],
      ["csv multiline", 'id,title\na,"A\nB"', [{ id: "a", title: "A\nB" }]],
    ])
      check(name, () => assert.deepEqual(parseCsv(input), expected));
    for (const [index, input] of [
      null,
      "",
      "title,id\na,A",
      "id,title\na",
      "id,title\na,A,extra",
      'id,title\na,"open',
      'id,title\na,A"B',
      'id,title\na,"A" trailing',
      "id,title\na,A\na,B",
      "id,title\n ,A",
      "id,title\na, ",
    ].entries()) {
      check(`csv rejection ${index}`, () => assert.throws(() => parseCsv(input), TypeError));
    }
    check("summary json", () =>
      assert.deepEqual(summarize("json", '[{"id":"b","title":"Z"},{"id":"a","title":"A"}]'), {
        count: 2,
        titles: ["A", "Z"],
      }),
    );
    check("summary csv", () =>
      assert.deepEqual(summarize("csv", "id,title\nb,Z\na,A"), { count: 2, titles: ["A", "Z"] }),
    );
    check("summary empty", () =>
      assert.deepEqual(summarize("json", "[]"), { count: 0, titles: [] }),
    );
    check("summary invalid format", () => assert.throws(() => summarize("xml", ""), TypeError));
  } else if (workload === "ingestion") {
    const { createStore } = await load("store.mjs");
    const { ingest } = await load("ingest.mjs");
    const { search } = await load("search.mjs");
    check("create Map", () => assert.ok(createStore() instanceof Map));
    check("unchanged ingestion", () => {
      const s = createStore();
      assert.equal(ingest(s, "a", "d", "hello"), true);
      assert.equal(ingest(s, "a", "d", "hello"), false);
      assert.equal(s.size, 1);
    });
    check("changed content", () => {
      const s = createStore();
      ingest(s, "a", "d", "old");
      assert.equal(ingest(s, "a", "d", "new"), true);
      assert.equal(search(s, "a", "old").length, 0);
      assert.deepEqual(search(s, "a", "new"), [{ projectId: "a", sourceId: "d", content: "new" }]);
    });
    check("project isolation", () => {
      const s = createStore();
      ingest(s, "a", "d", "one");
      ingest(s, "b", "d", "two");
      assert.equal(s.size, 2);
      assert.equal(search(s, "a", "two").length, 0);
      assert.equal(search(s, "b", "two").length, 1);
    });
    check("separator identities", () => {
      const s = createStore();
      ingest(s, "a:b", "c", "first");
      ingest(s, "a", "b:c", "second");
      assert.equal(s.size, 2);
      assert.equal(search(s, "a:b", "")[0].content, "first");
    });
    check("lexical order", () => {
      const s = createStore();
      for (const id of ["z", "B", "a"]) ingest(s, "p", id, "same");
      assert.deepEqual(
        search(s, "p", "").map((r) => r.sourceId),
        ["B", "a", "z"],
      );
    });
    check("detached results", () => {
      const s = createStore();
      ingest(s, "p", "d", "same");
      search(s, "p", "")[0].content = "mutated";
      assert.equal(search(s, "p", "")[0].content, "same");
    });
    check("empty and case", () => {
      const s = createStore();
      ingest(s, "p", "d", "");
      assert.equal(search(s, "p", "").length, 1);
      ingest(s, "p", "d", "Hello");
      assert.equal(search(s, "p", "hello").length, 0);
    });
    for (const [index, args] of [
      [{}, "p", "s", "c"],
      [new Map(), "", "s", "c"],
      [new Map(), "p", null, "c"],
      [new Map(), "p", "s", 2],
    ].entries())
      check(`ingest rejection ${index}`, () => assert.throws(() => ingest(...args), TypeError));
    for (const [index, args] of [
      [{}, "p", ""],
      [new Map(), "", ""],
      [new Map(), "p", null],
    ].entries())
      check(`search rejection ${index}`, () => assert.throws(() => search(...args), TypeError));
  } else throw new Error("Unknown workload");
} catch {
  checks.push({ name: "module loading", passed: false });
}
console.log(JSON.stringify(checks));
