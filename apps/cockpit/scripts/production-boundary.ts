import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const forbiddenLocalEndpointMarkers = [
  "/__gke/ask",
  "/__gke/capture",
  "/__gke/review",
  "/__board/lifecycle",
] as const;

export interface ProductionBoundaryViolation {
  marker: string;
  relativeArtifactPath: string;
}

async function listArtifacts(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const artifacts: string[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const artifactPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await listArtifacts(artifactPath)));
    } else if (entry.isFile()) {
      artifacts.push(artifactPath);
    }
  }

  return artifacts;
}

export async function findProductionBoundaryViolations(
  distDirectory: string,
): Promise<ProductionBoundaryViolation[]> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(distDirectory);
  } catch {
    throw new Error("Production build directory is missing.");
  }

  if (!stat.isDirectory()) {
    throw new Error("Production build directory is missing.");
  }

  const violations: ProductionBoundaryViolation[] = [];
  for (const artifactPath of await listArtifacts(distDirectory)) {
    const artifact = await fs.readFile(artifactPath, "utf8");
    const relativeArtifactPath = path
      .relative(distDirectory, artifactPath)
      .split(path.sep)
      .join("/");

    for (const marker of forbiddenLocalEndpointMarkers) {
      if (artifact.includes(marker)) {
        violations.push({ marker, relativeArtifactPath });
      }
    }
  }

  return violations;
}

export async function assertProductionBoundary(distDirectory: string): Promise<void> {
  const violations = await findProductionBoundaryViolations(distDirectory);
  if (violations.length === 0) return;

  const report = violations
    .map(({ marker, relativeArtifactPath }) => `${marker} ${relativeArtifactPath}`)
    .join("\n");
  throw new Error(report);
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultDistDirectory = path.resolve(scriptDirectory, "..", "dist");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertProductionBoundary(process.argv[2] ?? defaultDistDirectory).catch((error) => {
    console.error(error instanceof Error ? error.message : "Production boundary check failed.");
    process.exitCode = 1;
  });
}
