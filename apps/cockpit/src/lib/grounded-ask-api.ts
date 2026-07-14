const GROUNDED_ASK_ROOT = "/__gke/ask";

export interface GroundedConfidence {
  label: "low" | "medium" | "high" | string;
  score: number;
  rationale?: string;
}

export interface GroundedGate {
  pass: boolean;
  reasons: string[];
  measured?: Record<string, number>;
  thresholds?: Record<string, number>;
}

export interface GroundedCitation {
  path: string;
  line: number;
  score?: number;
}

export interface GroundedEvidence {
  path: string;
  lineNumber: number;
  endLine?: number;
  score: number;
  title?: string;
  snippet?: string;
  track?: string;
  module?: string;
  sourceKind?: string;
}

export interface GroundedAnswer {
  question?: string;
  answer: string;
  abstained: boolean;
  confidence: GroundedConfidence;
  gate: GroundedGate;
  citations: GroundedCitation[];
  evidence: GroundedEvidence[];
  tokenUsage?: {
    kind: "estimate" | "provider";
    scope: string;
    requestTokens: number;
    evidenceTokens: number;
    answerTokens: number;
    totalTokens: number;
  };
  timings?: Record<string, number | null>;
}

export interface GroundedCaptureResult {
  action: "created" | "proposed";
  path: string;
  proposal?: {
    proposalId: string;
    requiresReview?: boolean;
    reasons?: string[];
  };
}

export interface CaptureGroundedAnswerInput {
  question: string;
  title: string;
  kind?: "topic" | "term";
  projectId?: string;
}

export interface AskGroundedOptions {
  projectId?: string;
}

export class GroundedAskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "GroundedAskApiError";
  }
}

export async function askGrounded(
  question: string,
  options: AskGroundedOptions = {},
): Promise<GroundedAnswer> {
  const payload = await request<{ answer: GroundedAnswer }>(GROUNDED_ASK_ROOT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, strict: true, ...options }),
  });
  return payload.answer;
}

export async function captureGroundedAnswer(
  input: CaptureGroundedAnswerInput,
): Promise<GroundedCaptureResult> {
  const payload = await request<{ capture: GroundedCaptureResult }>(
    `${GROUNDED_ASK_ROOT}/capture`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  return payload.capture;
}

async function request<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      ...init.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new GroundedAskApiError(
      payload.error || `Grounded Ask request failed (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload as T;
}
