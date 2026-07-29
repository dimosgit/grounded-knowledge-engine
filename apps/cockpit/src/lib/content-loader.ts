import { normalizePath } from "../domain/docs";

type MarkdownModuleLoader = () => Promise<unknown>;

export interface MarkdownContentLoader {
  has(path: string): boolean;
  load(path: string): Promise<string>;
  clear(): void;
}

export function createMarkdownContentLoader(
  markdownModules: Record<string, MarkdownModuleLoader>,
): MarkdownContentLoader {
  const loaders = new Map<string, MarkdownModuleLoader>();
  const cache = new Map<string, string>();
  const pending = new Map<string, Promise<string>>();

  for (const [rawPath, loader] of Object.entries(markdownModules)) {
    loaders.set(normalizePath(rawPath), loader);
  }

  return {
    has(path) {
      return loaders.has(path);
    },
    load(path) {
      const cached = cache.get(path);
      if (cached !== undefined) return Promise.resolve(cached);

      const inFlight = pending.get(path);
      if (inFlight) return inFlight;

      const moduleLoader = loaders.get(path);
      if (!moduleLoader) {
        return Promise.reject(new Error("The requested Markdown document is unavailable."));
      }

      const request = moduleLoader()
        .then((loadedModule) => {
          const raw =
            typeof loadedModule === "string"
              ? loadedModule
              : typeof (loadedModule as { default?: unknown })?.default === "string"
                ? (loadedModule as { default: string }).default
                : null;
          if (raw === null) throw new Error("The Markdown document returned invalid content.");
          const body = stripFrontmatter(raw);
          cache.set(path, body);
          return body;
        })
        .finally(() => pending.delete(path));

      pending.set(path, request);
      return request;
    },
    clear() {
      cache.clear();
      pending.clear();
    },
  };
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---\n", 4);
  return end === -1 ? raw : raw.slice(end + 5);
}
