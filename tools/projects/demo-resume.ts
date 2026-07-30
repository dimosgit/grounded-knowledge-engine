#!/usr/bin/env node
import process from "node:process";
import { resumeProject } from "./index.js";

const projectId = `${process.argv.slice(2).find((arg) => arg !== "--") || "router-rollout"}`.trim();
const { structured } = await resumeProject({ projectId }, process.cwd(), ["demo-kb", "kb"]);
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

console.log(`Project: ${structured.title} (${structured.projectId})`);
console.log(`Status: ${structured.status}`);
console.log(`Do next: ${oneLine(structured.recommendedNextAction)}`);
console.log(`Changed: ${oneLine(structured.recentChanges)}`);
console.log(`Focus: ${oneLine(structured.currentFocus)}`);
for (const item of structured.completedSinceCheckpoint.slice(0, 2)) {
  console.log(`Completed: ${oneLine(item)}`);
}
for (const blocker of structured.blockers.slice(0, 2)) {
  console.log(`Blocked: ${oneLine(blocker)}`);
}
for (const decision of structured.activeDecisions.slice(0, 2)) {
  console.log(`Decided: ${oneLine(decision)}`);
}
for (const question of structured.openQuestions.slice(0, 2)) {
  console.log(`Question: ${oneLine(question)}`);
}
structured.nextThreeActions.slice(1).forEach((action, index) => {
  console.log(`Then ${index + 1}: ${oneLine(action)}`);
});
const firstCitation = structured.citations[0];
if (firstCitation) {
  console.log(`Evidence: ${firstCitation.path}:${firstCitation.line}`);
}
