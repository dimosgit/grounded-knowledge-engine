import type { Readable, Writable } from "node:stream";

export type JsonObject = Record<string, unknown>;
export type JsonRpcId = string | number | null;

export interface JsonRpcMessage {
  id?: JsonRpcId;
  method?: string;
  params?: JsonObject;
}

export interface JsonRpcTransportOptions {
  input: Readable;
  output: Writable;
  handleRequest: (method: string, params: JsonObject) => Promise<unknown>;
  handleNotification?: (method: string, params: JsonObject) => Promise<void>;
  errorCode?: (error: unknown) => number;
  errorMessage?: (error: unknown) => string;
  log?: (message: string) => void;
  onEnd?: () => void;
}

export interface JsonRpcTransport {
  close: () => void;
}

type MessageListener = (message: unknown) => void;
type ParseErrorListener = (code: number, message: string) => void;

export class JsonRpcFrameParser {
  private buffer = Buffer.alloc(0);
  private readonly onMessage: MessageListener;
  private readonly onError: ParseErrorListener;

  constructor(onMessage: MessageListener, onError: ParseErrorListener) {
    this.onMessage = onMessage;
    this.onError = onError;
  }

  push(chunk: Buffer | string): void {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.buffer = Buffer.concat([this.buffer, bytes]);
    this.parse();
  }

  private parse(): void {
    while (true) {
      const prefix = this.buffer.slice(0, 16).toString("utf8");
      if (/^\s*content-length:/i.test(prefix)) {
        if (!this.parseContentLengthFrame()) return;
        continue;
      }

      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = this.buffer.slice(0, newlineIndex).toString("utf8").trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!line) continue;
      this.parseJson(line);
    }
  }

  private parseContentLengthFrame(): boolean {
    const headerEnd = this.buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return false;
    const header = this.buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/content-length:\s*(\d+)/i);
    if (!lengthMatch) {
      this.onError(-32700, "Missing Content-Length header");
      this.buffer = Buffer.alloc(0);
      return false;
    }

    const contentLength = Number.parseInt(lengthMatch[1], 10);
    const frameEnd = headerEnd + 4 + contentLength;
    if (this.buffer.length < frameEnd) return false;
    const payload = this.buffer.slice(headerEnd + 4, frameEnd).toString("utf8");
    this.buffer = this.buffer.slice(frameEnd);
    this.parseJson(payload);
    return true;
  }

  private parseJson(payload: string): void {
    try {
      this.onMessage(JSON.parse(payload));
    } catch (error) {
      this.onError(-32700, `Invalid JSON payload: ${defaultErrorMessage(error)}`);
    }
  }
}

export function startJsonRpcStdioTransport(options: JsonRpcTransportOptions): JsonRpcTransport {
  const errorMessage = options.errorMessage || defaultErrorMessage;
  const errorCode = options.errorCode || (() => -32603);
  const parser = new JsonRpcFrameParser(
    (message) => {
      void dispatchJsonRpcMessage(message, options, errorCode, errorMessage);
    },
    (code, message) => writeError(options.output, null, code, message),
  );

  const onData = (chunk: Buffer | string) => parser.push(chunk);
  const onEnd = () => {
    options.log?.("stdin ended, shutting down");
    options.onEnd?.();
  };
  options.input.on("data", onData);
  options.input.on("end", onEnd);
  options.input.resume();

  return {
    close: () => {
      options.input.off("data", onData);
      options.input.off("end", onEnd);
      options.input.pause();
    },
  };
}

async function dispatchJsonRpcMessage(
  rawMessage: unknown,
  options: JsonRpcTransportOptions,
  errorCode: (error: unknown) => number,
  errorMessage: (error: unknown) => string,
): Promise<void> {
  if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) return;
  const message = rawMessage as JsonRpcMessage;
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : undefined;
  const method = typeof message.method === "string" ? message.method : "";
  const params =
    message.params && typeof message.params === "object" && !Array.isArray(message.params)
      ? message.params
      : {};

  if (!method) {
    if (id !== undefined) writeError(options.output, id, -32600, "Invalid Request: missing method");
    return;
  }
  options.log?.(`request: ${method}`);

  if (id === undefined) {
    try {
      await options.handleNotification?.(method, params);
    } catch (error) {
      options.log?.(`notification failed: ${errorMessage(error)}`);
    }
    return;
  }

  try {
    const result = await options.handleRequest(method, params);
    writeResult(options.output, id, result);
  } catch (error) {
    writeError(options.output, id, errorCode(error), errorMessage(error));
  }
}

export function writeResult(output: Writable, id: JsonRpcId, result: unknown): void {
  writeMessage(output, { jsonrpc: "2.0", id, result });
}

export function writeError(
  output: Writable,
  id: JsonRpcId,
  code: number,
  message: string,
): void {
  writeMessage(output, { jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(output: Writable, payload: JsonObject): void {
  output.write(`${JSON.stringify(payload)}\n`);
}

function defaultErrorMessage(error: unknown): string {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}
