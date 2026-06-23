/**
 * Minimal newline-delimited JSON-RPC client for the KB MCP server's stdio
 * transport, plus a helper that spawns the server with a given environment.
 *
 * Shared by the ingestion CLI and the loop/ingestion integration tests so the
 * "talk to the real server" plumbing lives in exactly one place. The contract
 * smoke test (smoke-test.ts) keeps its own inline client on purpose — it is the
 * canonical, dependency-free protocol probe.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface JsonRpcResponse {
  id?: number;
  result?: any;
  error?: { message?: string };
}

export class McpClient {
  private child: ChildProcessWithoutNullStreams;
  private stdoutBuffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();

  constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.on("data", (chunk) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);
      this.parseFrames();
    });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => {
      if (code !== 0 && this.pending.size > 0) {
        for (const [, request] of this.pending.entries()) {
          request.reject(new Error(`KB MCP server exited early with code ${code}`));
        }
      }
    });
  }

  private parseFrames(): void {
    while (true) {
      const newlineIdx = this.stdoutBuffer.indexOf("\n");
      if (newlineIdx === -1) return;
      const lineBuf = this.stdoutBuffer.slice(0, newlineIdx);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
      const line = lineBuf.toString("utf8").trim();
      if (line.length === 0) continue;
      const message = JSON.parse(line) as JsonRpcResponse;
      if (Object.prototype.hasOwnProperty.call(message, "id")) {
        const request = this.pending.get(message.id!);
        if (!request) continue;
        this.pending.delete(message.id!);
        if (message.error) request.reject(new Error(`RPC error: ${message.error.message}`));
        else request.resolve(message.result);
      }
    }
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = 20000): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timeout);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timeout);
          reject(e);
        },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  callTool(name: string, args: Record<string, unknown>): Promise<any> {
    return this.request("tools/call", { name, arguments: args });
  }

  /** Run the MCP initialize handshake and return the init result. */
  async initialize(clientName: string): Promise<any> {
    const init = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: clientName, version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
    return init;
  }
}

export interface KbServerHandle {
  child: ChildProcessWithoutNullStreams;
  client: McpClient;
}

/**
 * Spawn the KB MCP server (via tsx when running from .ts, or node from built
 * .js) with the provided environment overrides layered on top of process.env.
 */
export function spawnKbServer(env: Record<string, string> = {}): KbServerHandle {
  const isTypeScriptRuntime = __filename.endsWith(".ts");
  const serverPath = path.join(__dirname, isTypeScriptRuntime ? "server.ts" : "server.js");
  const serverArgs = isTypeScriptRuntime ? ["--import", "tsx", serverPath] : [serverPath];
  const child = spawn(process.execPath, serverArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...env },
  }) as ChildProcessWithoutNullStreams;
  return { child, client: new McpClient(child) };
}
