import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptureReviewPlugin } from "./scripts/capture-review-plugin";
import { createGroundedAskPlugin } from "./scripts/grounded-ask-plugin";
import { createLifecycleWritebackPlugin } from "./scripts/lifecycle-writeback-plugin";
import { createWorkspaceReviewPlugin } from "./scripts/workspace-review-plugin";
import { loadWorkspaceContext } from "../../tools/workspaces/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const workspace = await loadWorkspaceContext({ repoRoot });

export default defineConfig({
  plugins: [
    react(),
    createLifecycleWritebackPlugin({ repoRoot, workspace }),
    createGroundedAskPlugin({ repoRoot, workspace }),
    createCaptureReviewPlugin({ repoRoot, workspace }),
    createWorkspaceReviewPlugin({ repoRoot, workspace }),
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
    // Mermaid is large (~620 KB) but only loaded on demand via the dynamic
    // import in MarkdownArticle, so it lands in its own chunk that the initial
    // library and project views never fetch. Raise the size-warning ceiling
    // above that intentional lazy chunk so the production build stays
    // warning-free; a genuinely new oversized chunk will still trip the warning.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("react-markdown") || id.includes("remark-gfm")) {
            return "markdown";
          }
          return undefined;
        },
      },
    },
  },
} as any);
