import assert from "node:assert/strict";
import {
  buildTermIndex,
  foldText,
  textHasWordOrFamily,
  umlautAlternates,
  wordStem,
} from "./word-match.js";

// Umlauts and accents
assert.equal(foldText("Prüfung der Lieferscheine"), "pruefung der lieferscheine");
assert.equal(foldText("Straße"), "strasse");
assert.equal(foldText("Café résumé"), "cafe resume");
assert.equal(foldText("PRÜFUNG"), "pruefung");

// Word families share a stem
const family = (words: string[]) => new Set(words.map(wordStem)).size === 1;
assert.ok(
  family(["approve", "approves", "approved", "approver", "approval", "approvals"]),
  "approve family",
);
assert.ok(family(["quote", "quotes", "quoted", "quotation"]), "quote family");
assert.ok(family(["warehouse", "warehouses"]), "warehouse family");
assert.ok(family(["plan", "plans", "planning", "planned"]), "plan family");
assert.ok(family(["carrier", "carriers"]), "carrier family");
assert.ok(family(["Prüfung", "Prüfungen", "Pruefung"]), "Prüfung family");
assert.ok(family(["Lieferschein", "Lieferscheine", "Lieferscheinen"]), "Lieferschein family");
assert.ok(family(["process", "processes"]), "process family");
assert.ok(family(["note", "notes"]), "note family");
assert.ok(family(["category", "categories"]), "category family");
assert.ok(family(["order", "orders"]), "order family");

// Short words, numbers and unrelated words stay apart
assert.equal(wordStem("api"), "api");
assert.equal(wordStem("s4hana"), "s4hana");
assert.notEqual(wordStem("planet"), wordStem("plan"));
assert.notEqual(wordStem("status"), wordStem("stat"));
assert.notEqual(wordStem("user"), wordStem("us"));

// Variants from an index vocabulary
const index = buildTermIndex([
  "approver",
  "approval",
  "approve",
  "quote",
  "quotation",
  "lieferschein",
  "lieferscheinen",
  "warehouse",
  "warehouses",
  "planet",
  "planning",
  "plan",
  "approximate",
  "pruefung",
  "s4hana",
]);
const terms = (word: string) => index.variantsFor(word).map((variant) => variant.term);
assert.deepEqual(terms("approves").slice(0, 3).sort(), ["approval", "approve", "approver"]);
assert.ok(!terms("approves").includes("approximate"), "approximate is not an approval");
assert.ok(terms("quotes").includes("quote") && terms("quotes").includes("quotation"));
assert.ok(terms("warehou").includes("warehouse"), "a typed fragment finds the word");
assert.ok(terms("schein").includes("lieferschein"), "a compound part finds the compound");
assert.ok(!terms("plan").includes("planet"), "plan does not find planet");
assert.ok(terms("plan").includes("planning"));
assert.ok(terms("Prüfungen").includes("pruefung"), "umlaut query finds the folded word");
assert.deepEqual(terms("api"), [], "short words get no variants");
assert.ok(!terms("approver").includes("approver"), "never returns the word itself");
assert.equal(index.variantsFor("approves")[0]?.kind, "family");
assert.ok(index.variantsFor("approves").every((variant) => variant.factor < 1));

// Text checks used by rerankers
assert.equal(
  textHasWordOrFamily("quotes above 50,000 need a second approver", "approves"),
  "family",
);
assert.equal(textHasWordOrFamily("quotes above 50,000", "quotes"), "exact");
assert.equal(textHasWordOrFamily("nothing here", "approves"), null);

// SQLite stores umlauts without the e
assert.deepEqual(umlautAlternates("pruefung"), ["prufung"]);
assert.deepEqual(umlautAlternates("approval"), []);

console.log("word-match tests passed");
