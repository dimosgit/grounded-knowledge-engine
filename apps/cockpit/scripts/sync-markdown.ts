import path from "node:path";
import { getPaths, syncContent } from "./sync-lib.js";

const { appRoot, repoRoot } = getPaths();

syncContent()
  .then((stats) => {
    console.log(
      `Synced ${stats.total} files (${stats.markdown} Markdown, ${stats.assets} image assets) into ${path.relative(repoRoot, path.join(appRoot, "content"))}`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
