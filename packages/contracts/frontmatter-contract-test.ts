#!/usr/bin/env node
import assert from "node:assert/strict";
import { frontmatterList, parseFrontmatter, setFrontmatterValues } from "./src/frontmatter.js";

const vaultNote = `---
title: "Router rollout: phase 2"
aliases:
  - Rollout
  - "Phase two"
tags: [network, 'ops team']
related: "[[Change window]]"
cssclasses:
summary: |
  First line
  Second line
nested:
  child: ignored
lifecycle: active
---

# Router rollout

Body line.
`;

{
  const parsed = parseFrontmatter(vaultNote);
  assert.equal(parsed.found, true);
  assert.equal(parsed.frontmatter.title, "Router rollout: phase 2");
  assert.equal(parsed.frontmatter.aliases, "Rollout, Phase two");
  assert.equal(parsed.frontmatter.tags, "network, ops team");
  assert.equal(parsed.frontmatter.related, "[[Change window]]");
  assert.equal(parsed.frontmatter.cssclasses, "");
  assert.equal(parsed.frontmatter.summary, "First line\nSecond line");
  assert.equal(parsed.frontmatter.nested, "");
  assert.equal(parsed.frontmatter.child, undefined, "nested keys stay nested");
  assert.equal(parsed.frontmatter.lifecycle, "active");
  assert.equal(parsed.body, "\n# Router rollout\n\nBody line.\n");
  assert.equal(parsed.bodyStartLine, 16);
  assert.equal(vaultNote.split("\n")[parsed.bodyStartLine], "# Router rollout");
}

{
  const crlf = "---\r\ntags:\r\n  - a\r\n  - b\r\ntitle: CRLF\r\n---\r\nBody\r\n";
  const parsed = parseFrontmatter(crlf);
  assert.equal(parsed.found, true);
  assert.equal(parsed.frontmatter.tags, "a, b");
  assert.equal(parsed.frontmatter.title, "CRLF");
  assert.equal(parsed.body, "Body\r\n");
  assert.equal(parsed.bodyStartLine, 7);
}

{
  assert.equal(parseFrontmatter("# No frontmatter\n").found, false);
  assert.equal(parseFrontmatter("---\ntitle: open\nno close\n").found, false);
  assert.equal(parseFrontmatter("---\nkey:value\n---\n").frontmatter.key, "value");
  assert.equal(
    parseFrontmatter("---\nurl: https://example.com/a\n---\n").frontmatter.url,
    "https://example.com/a",
  );
}

{
  assert.deepEqual(frontmatterList("a, b , c"), ["a", "b", "c"]);
  assert.deepEqual(frontmatterList("[a, 'b']"), ["a", "b"]);
  assert.deepEqual(frontmatterList(""), []);
}

{
  // Updating one key leaves every other line byte-for-byte, including lists.
  const next = setFrontmatterValues(vaultNote, { lifecycle: "blocked" });
  assert.equal(next, vaultNote.replace("lifecycle: active", "lifecycle: blocked"));
}

{
  // A block list stays a block list in the same indentation; no stale items.
  const next = setFrontmatterValues(vaultNote, { aliases: "Rollout, Cutover" });
  assert.match(next, /\naliases:\n {2}- Rollout\n {2}- Cutover\ntags:/);
  assert.equal(parseFrontmatter(next).frontmatter.aliases, "Rollout, Cutover");
  assert.equal(
    next.replace(/aliases:[\s\S]*?tags:/, ""),
    vaultNote.replace(/aliases:[\s\S]*?tags:/, ""),
  );
}

{
  // An inline list stays inline; removal and insertion work.
  const next = setFrontmatterValues(vaultNote, {
    tags: "network, edge",
    cssclasses: null,
    owner: "ops",
  });
  assert.match(next, /\ntags: \[network, edge\]\n/);
  assert.doesNotMatch(next, /cssclasses/);
  assert.match(next, /\nlifecycle: active\nowner: ops\n---\n/);
}

{
  const crlf = "---\r\ntags:\r\n  - a\r\nstatus: open\r\n---\r\nBody\r\n";
  const next = setFrontmatterValues(crlf, { status: "done" });
  assert.equal(next, "---\r\ntags:\r\n  - a\r\nstatus: done\r\n---\r\nBody\r\n");
}

{
  assert.equal(
    setFrontmatterValues("Body\n", { status: "open" }),
    "---\nstatus: open\n---\n\nBody\n",
  );
  assert.equal(setFrontmatterValues("Body\n", { status: null }), "Body\n");
}

console.log("Frontmatter contract passed.");
