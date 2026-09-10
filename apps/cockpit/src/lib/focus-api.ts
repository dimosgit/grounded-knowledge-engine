const FOCUS_WRITE_PATH = "/__gke/focus";

export type FocusMutation =
  | { action: "add-record"; areaId: string; recordId: string }
  | { action: "add-task"; areaId: string; title: string }
  | { action: "make-current"; areaId: string; recordId: string }
  | { action: "move"; areaId: string; recordId: string; direction: "up" | "down" }
  | { action: "remove"; areaId: string; recordId: string };

export class FocusApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "FocusApiError";
  }
}

export async function updateFocus(mutation: FocusMutation): Promise<unknown[]> {
  const response = await fetch(FOCUS_WRITE_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(mutation),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    focusAreas?: unknown;
    error?: string;
    code?: string;
  };
  if (!response.ok || !Array.isArray(payload.focusAreas)) {
    throw new FocusApiError(
      payload.error || `Focus update failed (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload.focusAreas;
}

export async function getFocusAreas(): Promise<unknown[]> {
  const response = await fetch(FOCUS_WRITE_PATH, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    focusAreas?: unknown;
    error?: string;
    code?: string;
  };
  if (!response.ok || !Array.isArray(payload.focusAreas)) {
    throw new FocusApiError(
      payload.error || `Could not load Focus (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload.focusAreas;
}
