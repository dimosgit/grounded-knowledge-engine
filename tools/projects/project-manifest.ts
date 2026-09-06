// Compatibility surface for existing engine imports. The canonical,
// browser-safe project record contract lives in packages/contracts.
export {
  PROJECT_CONTRACT_VERSION,
  isPlaceholderSectionItem,
  meaningfulSectionItems,
  normalizeProjectId,
  parseProjectData,
  parseProjectDocument,
  parseProjectFrontmatter,
  sectionItems,
  sectionSummary,
} from "../../packages/contracts/src/projects.js";

export type {
  ParsedProjectDocument,
  ProjectManifest,
  ProjectSection,
} from "../../packages/contracts/src/projects.js";
