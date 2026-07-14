import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  authorizeWorkspaceOperationalRead,
  authorizeWorkspaceRuntimePath,
  authorizeWorkspaceWrite,
} from "../workspaces/path-policy.js";
import type { WorkspaceContext } from "../workspaces/types.js";

export const OPEN_QUESTIONS_PATH = "kb/open_questions.md" as const;
const LOCK_PATH = ".gke/locks/open-questions.lock";
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

export interface OpenQuestionDocument {
  exists: boolean;
  content: string;
}

export class OpenQuestionRepository {
  readonly targetPath: string;
  private readonly lockPath: string;

  constructor(
    private readonly repoRoot: string,
    private readonly workspace: WorkspaceContext,
  ) {
    this.targetPath = path.join(repoRoot, OPEN_QUESTIONS_PATH);
    this.lockPath = path.join(repoRoot, LOCK_PATH);
  }

  async read(): Promise<OpenQuestionDocument> {
    try {
      await authorizeWorkspaceOperationalRead(this.workspace, this.targetPath);
      return { exists: true, content: await fs.readFile(this.targetPath, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await authorizeWorkspaceRuntimePath(this.workspace, this.targetPath);
        return { exists: false, content: "# Open Questions\n" };
      }
      throw error;
    }
  }

  async writeAtomic(content: string): Promise<void> {
    await authorizeWorkspaceWrite(this.workspace, this.targetPath);
    await fs.mkdir(path.dirname(this.targetPath), { recursive: true, mode: 0o700 });
    await authorizeWorkspaceWrite(this.workspace, this.targetPath);
    const temporary = `${this.targetPath}.gke-tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
    await authorizeWorkspaceWrite(this.workspace, temporary);
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, this.targetPath);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async withMutationLock<T>(work: () => Promise<T>): Promise<T> {
    const lock = await this.acquireLock();
    try {
      return await work();
    } finally {
      await lock.close().catch(() => undefined);
      await fs.rm(this.lockPath, { force: true });
    }
  }

  private async acquireLock(): Promise<Awaited<ReturnType<typeof fs.open>>> {
    await authorizeWorkspaceWrite(this.workspace, this.lockPath);
    await fs.mkdir(path.dirname(this.lockPath), { recursive: true, mode: 0o700 });
    await authorizeWorkspaceWrite(this.workspace, this.lockPath);
    const startedAt = Date.now();
    while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
      try {
        const handle = await fs.open(this.lockPath, "wx", 0o600);
        try {
          await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`, "utf8");
          return handle;
        } catch (error) {
          await handle.close().catch(() => undefined);
          await fs.rm(this.lockPath, { force: true });
          throw error;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await this.removeStaleLock();
        await delay(LOCK_RETRY_MS);
      }
    }
    throw new Error("Open-question mutation lock timed out.");
  }

  private async removeStaleLock(): Promise<void> {
    try {
      const stat = await fs.stat(this.lockPath);
      if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
        await authorizeWorkspaceWrite(this.workspace, this.lockPath);
        await fs.rm(this.lockPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
