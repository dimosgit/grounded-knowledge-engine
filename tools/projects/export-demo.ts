#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runProjectCli } from "./cli.js";
import {
  parseProjectDocument,
  parseProjectFrontmatter,
  sectionItems,
} from "./project-manifest.js";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDirectory, "../..");
const destination = path.resolve(
  repoRoot,
  process.argv[2] || "examples/demo-project-workspace",
);
const relativeDestination = path.relative(repoRoot, destination).replaceAll(path.sep, "/");

if (
  !relativeDestination ||
  relativeDestination === ".." ||
  relativeDestination.startsWith("../")
) {
  throw new Error("Demo export destination must stay inside the repository.");
}

const sourceRoot = path.join(repoRoot, "demo-kb");
const destinationParent = path.dirname(destination);
await fs.mkdir(destinationParent, { recursive: true });
const stagingRoot = await fs.mkdtemp(
  path.join(destinationParent, `.${path.basename(destination)}-staging-`),
);

try {
  await copyDemoKnowledge(sourceRoot, path.join(stagingRoot, "kb"));
  const projects = await fs.readdir(path.join(sourceRoot, "projects"), {
    withFileTypes: true,
  });

  for (const entry of projects.filter((item) => item.isDirectory())) {
    const sourceProjectPath = path.join(sourceRoot, "projects", entry.name, "project.md");
    const raw = await fs.readFile(sourceProjectPath, "utf8");
    const relativeSourcePath = `demo-kb/projects/${entry.name}/project.md`;
    const parsed = parseProjectDocument(raw, relativeSourcePath, entry.name);
    const { frontmatter } = parseProjectFrontmatter(raw);
    const manifest = parsed.manifest;

    await run([
      "create",
      manifest.projectId,
      "--repo-root",
      stagingRoot,
      "--title",
      manifest.title,
      "--workspace",
      manifest.workspaceId,
      "--status",
      manifest.status,
      "--lifecycle",
      frontmatter.lifecycle || manifest.status,
      "--owner",
      manifest.owner,
      "--track",
      manifest.track,
      "--started-at",
      manifest.startedAt,
      "--updated",
      manifest.updated,
      "--review-after",
      manifest.reviewAfter,
      ...repeatOption("--tag", manifest.tags),
      ...repeatOption("--source-root", manifest.sourceRoots.map(toPortablePath)),
    ]);

    await run([
      "update",
      manifest.projectId,
      "--repo-root",
      stagingRoot,
      "--outcome",
      sectionContent(parsed, "outcome"),
      "--current-focus",
      sectionContent(parsed, "current-focus"),
      "--last-change",
      sectionContent(parsed, "last-meaningful-change"),
      ...repeatOption("--decision", sectionItems(parsed.sections.get("active-decisions"))),
      ...repeatOption("--blocker", sectionItems(parsed.sections.get("blockers"))),
      ...repeatOption("--open-question", sectionItems(parsed.sections.get("open-questions"))),
      ...repeatOption("--next-action", sectionItems(parsed.sections.get("next-actions"))),
    ]);

    await preserveCustomSection(
      path.join(stagingRoot, "kb", "projects", entry.name, "project.md"),
      "Delivery checklist",
      sectionContent(parsed, "delivery-checklist"),
      "Active decisions",
    );

    for (const link of projectLinks(sectionContent(parsed, "key-documents"))) {
      const portableTarget = resolvePortableLink(relativeSourcePath, link.target);
      await run([
        "link",
        manifest.projectId,
        portableTarget,
        "--repo-root",
        stagingRoot,
        "--label",
        link.label,
      ]);
    }
  }

  await run(["validate", "--repo-root", stagingRoot]);
  await fs.writeFile(
    path.join(stagingRoot, "README.md"),
    `# Portable GKE demo workspace

This folder is generated from \`demo-kb\` by the real project CLI:

\`\`\`bash
npm run export:demo-projects
npm run project -- list --repo-root ${relativeDestination}
npm run project -- validate --repo-root ${relativeDestination}
\`\`\`

It uses the canonical portable layout:

\`\`\`text
kb/
├── projects/<project-id>/project.md
├── sources/<project-id>/
└── topics/
\`\`\`

Point the MCP server or another local GKE checkout at this directory to use the
same demo without creating duplicate project IDs in the main repository.
`,
    "utf8",
  );
  await fs.writeFile(path.join(stagingRoot, ".gke-demo-export"), "generated\n", "utf8");

  if (await exists(destination)) {
    if (!(await exists(path.join(destination, ".gke-demo-export")))) {
      throw new Error(
        `Refusing to replace non-generated destination: ${relativeDestination}`,
      );
    }
    await fs.rm(destination, { recursive: true });
  }
  await fs.rename(stagingRoot, destination);
  console.log(`Exported portable demo workspace to ${relativeDestination}`);
} finally {
  if (await exists(stagingRoot)) {
    await fs.rm(stagingRoot, { recursive: true, force: true });
  }
}

async function run(args: string[]): Promise<void> {
  const code = await runProjectCli(args, repoRoot);
  if (code !== 0) throw new Error(`Project CLI failed: ${args.join(" ")}`);
}

async function copyDemoKnowledge(source: string, target: string): Promise<void> {
  await fs.cp(source, target, {
    recursive: true,
    filter: (candidate) => {
      const relative = path.relative(source, candidate).replaceAll(path.sep, "/");
      return (
        path.basename(candidate) !== ".DS_Store" &&
        relative !== "projects" &&
        !relative.startsWith("projects/")
      );
    },
  });
  await normalizeMarkdownFiles(target);
}

async function normalizeMarkdownFiles(directory: string): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await normalizeMarkdownFiles(target);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
    const content = await fs.readFile(target, "utf8");
    await fs.writeFile(target, `${content.trimEnd()}\n`, "utf8");
  }
}

async function preserveCustomSection(
  projectPath: string,
  heading: string,
  content: string,
  beforeHeading: string,
): Promise<void> {
  if (!content.trim()) return;
  const raw = await fs.readFile(projectPath, "utf8");
  const marker = `\n## ${beforeHeading}\n`;
  const insertion = `\n## ${heading}\n\n${content.trim()}\n`;
  if (!raw.includes(marker)) {
    throw new Error(`Cannot insert '${heading}' before missing section '${beforeHeading}'.`);
  }
  await fs.writeFile(projectPath, raw.replace(marker, `${insertion}${marker}`), "utf8");
}

function repeatOption(option: string, values: string[]): string[] {
  return values.flatMap((value) => [option, value]);
}

function sectionContent(
  parsed: ReturnType<typeof parseProjectDocument>,
  key: string,
): string {
  return parsed.sections.get(key)?.content || "";
}

function projectLinks(content: string): Array<{ label: string; target: string }> {
  return [...content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((match) => ({
    label: match[1].trim(),
    target: match[2].split("#")[0].trim(),
  }));
}

function resolvePortableLink(projectPath: string, target: string): string {
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(projectPath), target));
  return toPortablePath(resolved);
}

function toPortablePath(value: string): string {
  return value.startsWith("demo-kb/") ? `kb/${value.slice("demo-kb/".length)}` : value;
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
