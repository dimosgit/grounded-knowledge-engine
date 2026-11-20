#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  createWikiLinkIndex,
  extractInlineTags,
  extractWikiLinks,
  relativeWorkspacePath,
  wikiLinksToMarkdown,
} from "./src/wikilinks.js";

const note = [
  "See [[Change window]] and [[runbooks/Rollback plan|the rollback]].",
  "Jump to [[Change window#Freeze dates]] or [[#Local heading]].",
  "![[topology.png|300]] ![[Change window]]",
  "Inline `[[Not a link]]` stays code. #network #ops/oncall #2026 issue#5",
  "```",
  "[[Fenced link]] #fenced",
  "```",
  "## Heading is not a tag",
].join("\n");

{
  const links = extractWikiLinks(note);
  assert.deepEqual(
    links.map((link) => [link.target, link.fragment, link.label, link.embed]),
    [
      ["Change window", "", "Change window", false],
      ["runbooks/Rollback plan", "", "the rollback", false],
      ["Change window", "Freeze dates", "Change window", false],
      ["", "Local heading", "Local heading", false],
      ["topology.png", "", "300", true],
      ["Change window", "", "Change window", true],
    ],
  );
  assert.equal(note.slice(links[1].index, links[1].index + links[1].raw.length), links[1].raw);
}

{
  assert.deepEqual(extractInlineTags(note), ["network", "ops/oncall"]);
}

const index = createWikiLinkIndex([
  "kb/projects/router/Change window.md",
  "kb/runbooks/Rollback plan.md",
  "kb/archive/runbooks/Rollback plan.md",
  "kb/assets/topology.png",
  "kb/Notes.md",
  "kb/projects/router/Notes.md",
  "kb/a/Deep/Notes.md",
]);

{
  assert.equal(index.resolve("change WINDOW"), "kb/projects/router/Change window.md");
  assert.equal(index.resolve("Change window.md"), "kb/projects/router/Change window.md");
  assert.equal(index.resolve("runbooks/Rollback plan"), "kb/runbooks/Rollback plan.md");
  assert.equal(
    index.resolve("archive/runbooks/Rollback plan"),
    "kb/archive/runbooks/Rollback plan.md",
  );
  assert.equal(index.resolve("topology.png"), "kb/assets/topology.png");
  assert.equal(index.resolve("topology"), null, "non-Markdown targets need their extension");
  assert.equal(index.resolve("Missing"), null);
  // Ambiguous names prefer the linking note's folder, then the shortest path.
  assert.equal(
    index.resolve("Notes", "kb/projects/router/project.md"),
    "kb/projects/router/Notes.md",
  );
  assert.equal(index.resolve("Notes", "kb/other/x.md"), "kb/Notes.md");
  assert.equal(index.resolve("", "kb/x.md"), "kb/x.md");
}

{
  assert.equal(
    relativeWorkspacePath("kb/projects/router/project.md", "kb/runbooks/Rollback plan.md"),
    "../../runbooks/Rollback plan.md",
  );
  assert.equal(
    relativeWorkspacePath("kb/projects/router/project.md", "kb/projects/router/Notes.md"),
    "Notes.md",
  );
  assert.equal(relativeWorkspacePath("project.md", "kb/x.md"), "kb/x.md");
}

{
  const rendered = wikiLinksToMarkdown(
    note,
    index,
    "kb/projects/router/project.md",
    (resolved, fragment) => `/${resolved}${fragment ? `#${fragment}` : ""}`,
  );
  assert.match(rendered, /See \[Change window\]\(<\/kb\/projects\/router\/Change window\.md>\)/);
  assert.match(rendered, /\[the rollback\]\(<\/kb\/runbooks\/Rollback plan\.md>\)/);
  assert.match(
    rendered,
    /\[Change window\]\(<\/kb\/projects\/router\/Change window\.md#Freeze dates>\)/,
  );
  assert.match(rendered, /!\[\]\(<\/kb\/assets\/topology\.png>\)/);
  assert.match(rendered, /`\[\[Not a link\]\]`/);
  assert.match(rendered, /\[\[Fenced link\]\]/);
  assert.equal(
    wikiLinksToMarkdown("[[Missing|shown label]]", index, "kb/x.md", (path) => path),
    "shown label",
  );
  assert.equal(
    wikiLinksToMarkdown("![[missing.png]]", index, "kb/x.md", (path) => path),
    "![](<missing.png>)",
  );
}

console.log("Wiki-link contract passed.");
