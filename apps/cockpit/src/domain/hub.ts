import { getMarkdownSection, getSectionBullets } from "./docs";

export function buildHubModuleSummary(docs) {
  // Surface whichever note is acting as the live project board: prefer a doc
  // flagged `type: project`, falling back to the first note that exposes a
  // "Next 3 actions" section. No client-specific path is hard-coded.
  const hasActions = (doc) => getMarkdownSection(doc.content, "Next 3 actions").trim().length > 0;
  const isProject = (doc) => (doc.frontmatter?.type || "").trim() === "project";
  const projectDoc =
    docs.find((doc) => isProject(doc) && hasActions(doc)) || docs.find((doc) => hasActions(doc));
  if (!projectDoc) return null;

  return {
    title: projectDoc.title,
    path: projectDoc.path,
    actions: getSectionBullets(getMarkdownSection(projectDoc.content, "Next 3 actions")),
    blockers: getSectionBullets(getMarkdownSection(projectDoc.content, "Blockers")),
  };
}

export function countOpenQuestions(docs) {
  const openQuestionsDoc = docs.find((doc) => doc.path === "kb/open_questions.md");
  if (!openQuestionsDoc) return 0;
  return getSectionBullets(openQuestionsDoc.content).length;
}
