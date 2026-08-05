const COMPLETE_PROJECT_TASK_PATH = "/__gke/projects/tasks/complete";

export interface CompleteProjectTaskResult {
  projectId: string;
  path: string;
  content: string;
  changed: boolean;
  task: {
    text: string;
    status: "done";
  };
}

export class ProjectTaskApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ProjectTaskApiError";
  }
}

export async function finishProjectTask(
  projectId: string,
  taskText: string,
): Promise<CompleteProjectTaskResult> {
  const response = await fetch(COMPLETE_PROJECT_TASK_PATH, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ projectId, taskText }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    result?: CompleteProjectTaskResult;
    error?: string;
    code?: string;
  };
  if (!response.ok || !payload.result) {
    throw new ProjectTaskApiError(
      payload.error || `Task completion failed (${response.status}).`,
      response.status,
      payload.code || null,
    );
  }
  return payload.result;
}
