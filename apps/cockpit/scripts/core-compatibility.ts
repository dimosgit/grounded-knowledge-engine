import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CORE_API_VERSION = 1;

/** UI copies require a compatible installed core; they do not silently copy it. */
export async function assertCoreCompatibility(repoRoot: string): Promise<void> {
  let version: unknown;
  try {
    version = JSON.parse(
      await fs.readFile(path.join(repoRoot, "tools/core-api.json"), "utf8"),
    ).cockpitApiVersion;
  } catch {
    /* Missing legacy marker is an incompatible installation. */
  }
  if (version !== REQUIRED_CORE_API_VERSION) {
    throw new Error(
      `Cockpit requires core API ${REQUIRED_CORE_API_VERSION}; found ${version ?? "an unversioned core"}. Update the core scope before applying this UI update.`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await assertCoreCompatibility(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
  console.log(`Cockpit core API ${REQUIRED_CORE_API_VERSION} compatibility passed.`);
}
