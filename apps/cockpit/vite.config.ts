import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { setLifecycle, VALID_LIFECYCLES } from "./scripts/lifecycle-frontmatter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dev-only write-back: lets the Project Board persist a lane move by editing the
// `lifecycle:` frontmatter of the source markdown. The content watcher re-syncs
// and HMR reloads the card into its new lane. Never registered in the build.
function boardLifecycleWriteback() {
  // The cockpit lives at `apps/cockpit`; the source markdown it writes lane moves
  // back into lives at the repository root, two levels up.
  const repoRoot = path.resolve(__dirname, "../..");
  const allowedRoots = ["demo-kb/", "kb/"];

  return {
    name: "board-lifecycle-writeback",
    apply: "serve" as const,
    configureServer(server: any) {
      server.middlewares.use("/__board/lifecycle", (req: any, res: any) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end();
          return;
        }
        let raw = "";
        req.on("data", (chunk: Buffer) => (raw += chunk));
        req.on("end", async () => {
          const fail = (code: number, error: string) => {
            res.statusCode = code;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error }));
          };
          try {
            const { path: relPath, lifecycle } = JSON.parse(raw || "{}");
            const value = (lifecycle ?? "").toString().trim().toLowerCase();
            const normalizedPath = typeof relPath === "string" ? relPath.replace(/\\/g, "/") : "";
            const pathOk =
              normalizedPath.endsWith(".md") &&
              !normalizedPath.includes("..") &&
              allowedRoots.some((root) => normalizedPath.startsWith(root));
            const valueOk = value === "" || (VALID_LIFECYCLES as readonly string[]).includes(value);
            if (!pathOk || !valueOk) return fail(400, "invalid path or lifecycle");

            // The viewer funnels every note under a logical `kb/` namespace, but
            // the physical source may live under `demo-kb/`. Resolve the logical
            // path back to whichever real source folder actually holds the file.
            const candidates = normalizedPath.startsWith("kb/")
              ? [normalizedPath, `demo-kb/${normalizedPath.slice("kb/".length)}`]
              : [normalizedPath];
            let abs = path.join(repoRoot, candidates[0]);
            for (const candidate of candidates) {
              const candidateAbs = path.join(repoRoot, candidate);
              try {
                await fs.access(candidateAbs);
                abs = candidateAbs;
                break;
              } catch {
                // Try the next candidate root.
              }
            }
            const original = await fs.readFile(abs, "utf8");
            const updated = setLifecycle(original, value);
            if (updated !== original) await fs.writeFile(abs, updated);

            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, path: normalizedPath, lifecycle: value }));
          } catch (err) {
            fail(500, String(err));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), boardLifecycleWriteback()],
  server: process.env.PORT
    ? { port: Number(process.env.PORT), strictPort: true }
    : undefined,
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
    rollupOptions: {
      output: {
        manualChunks: {
          markdown: ["react-markdown", "remark-gfm"],
        },
      },
    },
  },
} as any);
