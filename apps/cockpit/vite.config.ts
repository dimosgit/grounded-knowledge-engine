import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptureReviewPlugin } from "./scripts/capture-review-plugin";
import { createGroundedAskPlugin } from "./scripts/grounded-ask-plugin";
import { createLifecycleWritebackPlugin } from "./scripts/lifecycle-writeback-plugin";
import { createProjectTaskWritebackPlugin } from "./scripts/project-task-writeback-plugin";
import { createWorkspaceReviewPlugin } from "./scripts/workspace-review-plugin";
import { createDecisionReviewPlugin } from "./scripts/decision-review-plugin";
import { createWorkspaceContextPlugin } from "./scripts/workspace-context-plugin";
import { loadWorkspaceContext } from "../../tools/workspaces/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workspace = await loadWorkspaceContext({ repoRoot });

export default defineConfig({
  define: {
    __KB_DEFAULT_ACTIVE_TRACK__: JSON.stringify(workspace.ui.defaultActiveTrack ?? "all"),
  },
  plugins: [
    react(),
    createLifecycleWritebackPlugin({ repoRoot, workspace }),
    createProjectTaskWritebackPlugin({ repoRoot, workspace }),
    createGroundedAskPlugin({ repoRoot, workspace }),
    createCaptureReviewPlugin({ repoRoot, workspace }),
    createWorkspaceReviewPlugin({ repoRoot, workspace }),
    createDecisionReviewPlugin({ repoRoot, workspace }),
    createWorkspaceContextPlugin({ workspace }),
  ],
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
  build: {
    manifest: true,
    // Mermaid is large (~620 KB) but only loaded on demand via the dynamic
    // import in MarkdownArticle, so it lands in its own chunk that the initial
    // library and project views never fetch. Raise the size-warning ceiling
    // above that intentional lazy chunk so the production build stays
    // warning-free; a genuinely new oversized chunk will still trip the warning.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
} as any);
