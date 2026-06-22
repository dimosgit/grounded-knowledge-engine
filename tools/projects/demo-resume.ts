#!/usr/bin/env node
import process from "node:process";
import { resumeProject } from "./index.js";

const projectId = `${process.argv.slice(2).find((arg) => arg !== "--") || "router-rollout"}`.trim();
const { structured } = await resumeProject(
  { projectId },
  process.cwd(),
  ["demo-kb", "kb"],
);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

console.log(`Project: ${structured.title} (${structured.projectId})`);
console.log(`Focus: ${oneLine(structured.currentFocus)}`);
console.log(`Recent: ${oneLine(structured.recentChanges)}`);
for (const decision of structured.activeDecisions.slice(0, 2)) {
  console.log(`Decision: ${oneLine(decision)}`);
}
for (const item of structured.blockersAndQuestions.slice(0, 2)) {
  console.log(`Risk/question: ${oneLine(item)}`);
}
structured.nextThreeActions.forEach((action, index) => {
  console.log(`Next ${index + 1}: ${oneLine(action)}`);
});
const firstCitation = structured.citations[0];
if (firstCitation) {
  console.log(`Evidence: ${firstCitation.path}:${firstCitation.line}`);
}
