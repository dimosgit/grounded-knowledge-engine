import { useEffect, useRef, useState } from "react";
import {
  Download,
  AlertTriangle,
  ArrowDown,
  BarChart3,
  CheckCircle2,
  CircleHelp,
  ClipboardCopy,
  FileText,
  History,
  Target,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import { ProjectContextMap } from "../components/ProjectContextMap";
import { useWorkspaceDisplayValue } from "../hooks/useWorkspaceDisplay";
import { downloadTextFile, writeTextToClipboard } from "../utils/clipboard";

const PROGRESS_PHASE = {
  active: { label: "In Progress" },
  blocked: { label: "Blocked" },
  next: { label: "Queued" },
  done: { label: "Completed" },
  reference: { label: "Reference" },
};

const STATUS_PILL = {
  active: {
    label: "Active",
    className: "border-status-done/30 bg-status-done/10 text-status-done",
  },
  blocked: {
    label: "Blocked",
    className: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked",
  },
  next: {
    label: "Queued",
    className: "border-status-waiting/30 bg-status-waiting/10 text-status-waiting",
  },
  done: {
    label: "Completed",
    className: "border-status-done/30 bg-status-done/10 text-status-done",
  },
  reference: {
    label: "Reference",
    className: "border-outline-variant bg-surface-container-high text-on-surface-variant",
  },
};

// Task board groups, in display order. The checkbox in the source checklist is
// the status; 🟡/🔴 circles refine open items into in-progress and gated.
const TASK_GROUPS = [
  { status: "inProgress", label: "In progress", dotClassName: "bg-status-waiting" },
  { status: "todo", label: "Up next", dotClassName: "bg-outline-variant" },
  { status: "gated", label: "Gated / waiting", dotClassName: "bg-status-blocked" },
];

function TaskRow({
  task,
  dotClassName,
  muted = false,
  canComplete = false,
  onRequestComplete = undefined,
}) {
  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      {canComplete ? (
        <button
          type="button"
          className="group -m-2 shrink-0 rounded-full p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={`Finish task: ${task.text}`}
          title="Finish task"
          onClick={() => onRequestComplete?.(task)}
        >
          <span
            className={`block h-2.5 w-2.5 rounded-full transition-transform group-hover:scale-125 ${dotClassName}`}
            aria-hidden="true"
          />
        </button>
      ) : (
        <span
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClassName}`}
          aria-hidden="true"
        />
      )}
      <span
        className={`min-w-0 flex-1 text-body-md ${
          muted
            ? "text-on-surface-variant line-through decoration-on-surface-variant/40"
            : "text-on-surface"
        }`}
      >
        {task.text}
      </span>
      {task.weight && (
        <span className="mt-0.5 shrink-0 rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-code-sm uppercase text-on-surface-variant">
          {task.weight}
        </span>
      )}
    </li>
  );
}

export function ProjectDetailView({
  palette,
  onCommand,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  activeProject,
  contextMap,
  focusSection,
  onOpenDoc,
  onOpenDecision,
  bodyStatus,
  bodyError,
  onRetryBody,
  onCompleteTask,
}) {
  const [handoffCopyState, setHandoffCopyState] = useState("idle");
  const [pendingTask, setPendingTask] = useState<{ text: string } | null>(null);
  const [taskCompletionState, setTaskCompletionState] = useState<"idle" | "saving" | "error">(
    "idle",
  );
  const [taskCompletionError, setTaskCompletionError] = useState("");
  const [completedTaskLabel, setCompletedTaskLabel] = useState("");
  const deliveryChecklistRef = useRef<HTMLElement | null>(null);
  const cancelCompletionRef = useRef<HTMLButtonElement | null>(null);
  const finishDialogRef = useRef<HTMLDivElement | null>(null);
  const completionTriggerRef = useRef<HTMLElement | null>(null);
  const workspace = useWorkspaceDisplayValue();
  const tasks = activeProject?.tasks || [];
  const taskCounts = activeProject?.taskCounts || {
    done: 0,
    inProgress: 0,
    gated: 0,
    todo: 0,
    total: 0,
  };
  const openTaskCount = taskCounts.total - taskCounts.done;
  const hasBlocker = Boolean(activeProject?.glance?.blocker);
  const recommendedNextAction =
    activeProject?.glance?.recommendedNextAction ||
    activeProject?.recommendedNextAction ||
    (activeProject?.statusBucket === "done"
      ? "Project completed; no next action required."
      : "Review project source doc.");
  const latestDecision =
    activeProject?.glance?.activeDecisions?.[0] || "No active decision recorded.";
  const latestQuestion = activeProject?.glance?.openQuestions?.[0] || "No open question recorded.";
  const progressPhase = PROGRESS_PHASE[activeProject?.statusBucket] || PROGRESS_PHASE.reference;
  const progressPercent =
    activeProject?.statusBucket === "done" ? 100 : activeProject?.progressPercent;
  const canCompleteTasks = import.meta.env.DEV && workspace.canWrite && Boolean(onCompleteTask);

  function jumpToDeliveryChecklist() {
    if (!tasks.length) {
      if (activeProject?.sourceDocPath) onOpenDoc(activeProject.sourceDocPath);
      return;
    }
    // Instant jump: reliable under rAF throttling and for reduced-motion users.
    deliveryChecklistRef.current?.scrollIntoView?.({ block: "start" });
  }

  useEffect(() => {
    if (focusSection !== "delivery-checklist" || !tasks.length) return;
    const frame = window.requestAnimationFrame(() => {
      deliveryChecklistRef.current?.scrollIntoView?.({ block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeProject?.id, focusSection, tasks.length]);

  useEffect(() => {
    if (!pendingTask) return;
    cancelCompletionRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && taskCompletionState !== "saving") {
        setPendingTask(null);
        setTaskCompletionState("idle");
        setTaskCompletionError("");
        window.requestAnimationFrame(() => completionTriggerRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const controls = finishDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingTask, taskCompletionState]);

  function requestTaskCompletion(task: { text: string }) {
    completionTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingTask(task);
    setTaskCompletionState("idle");
    setTaskCompletionError("");
  }

  function cancelTaskCompletion() {
    if (taskCompletionState === "saving") return;
    setPendingTask(null);
    setTaskCompletionState("idle");
    setTaskCompletionError("");
    window.requestAnimationFrame(() => completionTriggerRef.current?.focus());
  }

  async function confirmTaskCompletion() {
    if (!pendingTask || !onCompleteTask) return;
    setTaskCompletionState("saving");
    setTaskCompletionError("");
    try {
      await onCompleteTask(pendingTask.text);
      setCompletedTaskLabel(pendingTask.text);
      setPendingTask(null);
      setTaskCompletionState("idle");
      window.requestAnimationFrame(() => deliveryChecklistRef.current?.focus());
    } catch (error) {
      setTaskCompletionState("error");
      setTaskCompletionError(
        error instanceof Error ? error.message : "Could not finish the task. Try again.",
      );
    }
  }

  function downloadMarkdown() {
    if (!activeProject) return;
    const markdown = activeProject.resumeMarkdown || activeProject.handoffMarkdown;
    if (!markdown) return;
    downloadTextFile(`${activeProject.id || "project"}-resume.md`, markdown);
  }

  async function copyHandoff() {
    if (!activeProject?.handoffMarkdown) return;
    const copied = await writeTextToClipboard(activeProject.handoffMarkdown);
    setHandoffCopyState(copied ? "copied" : "failed");
    window.setTimeout(() => setHandoffCopyState("idle"), 1600);
  }

  return (
    <OperatorFrame
      activeView="projects"
      title={activeProject?.title || "Project Context"}
      commandBar={<CommandBar {...palette} />}
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
      askProjectId={activeProject?.id}
      askProjectTitle={activeProject?.title}
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 py-8 md:px-8">
        {completedTaskLabel && (
          <div
            role="status"
            className="rounded border border-status-done/30 bg-status-done/10 px-4 py-3 text-body-md text-on-surface"
          >
            Finished “{completedTaskLabel}”.
          </div>
        )}
        {bodyStatus === "loading" && (
          <div
            role="status"
            aria-live="polite"
            className="rounded border border-border-subtle bg-surface-container px-4 py-3 text-body-md text-on-surface-variant"
          >
            Loading the full project record…
          </div>
        )}
        {bodyStatus === "error" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-status-blocked/40 bg-status-blocked/10 px-4 py-3 text-body-md"
          >
            <span>Could not load the full project record. {bodyError}</span>
            <button
              type="button"
              className="rounded border border-border-subtle px-3 py-1.5 font-semibold"
              onClick={onRetryBody}
            >
              Retry
            </button>
          </div>
        )}
        <section className="flex flex-col justify-between gap-4 border-b border-border-subtle pb-6 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-3">
              {(() => {
                const pill = STATUS_PILL[activeProject?.statusBucket] || STATUS_PILL.reference;
                return (
                  <span
                    className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-label-caps uppercase ${pill.className}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {pill.label}
                  </span>
                );
              })()}
              <span className="text-metadata text-on-surface-variant">
                {activeProject?.updated
                  ? `Last updated ${activeProject.updated}`
                  : "Live project context"}
              </span>
            </div>
            <h1 className="font-display text-display-lg text-on-surface">
              {activeProject?.title || "Project Context"}
            </h1>
          </div>
          {activeProject && (
            <div className="flex flex-wrap gap-2">
              <button
                className="flex items-center gap-2 rounded border border-border-subtle bg-surface-container px-4 py-2 text-label-caps font-semibold uppercase text-on-surface hover:border-primary"
                type="button"
                onClick={copyHandoff}
              >
                <ClipboardCopy size={16} />
                {handoffCopyState === "copied"
                  ? "Copied"
                  : handoffCopyState === "failed"
                    ? "Retry Copy"
                    : "Copy Handoff"}
              </button>
              <button
                className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary"
                type="button"
                onClick={downloadMarkdown}
              >
                <Download size={16} />
                Download Markdown
              </button>
              <button
                className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary"
                type="button"
                onClick={() => onOpenDoc(activeProject.sourceDocPath)}
              >
                <FileText size={16} />
                Open Source Doc
              </button>
            </div>
          )}
        </section>

        <ProjectContextMap
          activeProject={activeProject}
          contextMap={contextMap}
          onOpenDoc={onOpenDoc}
          onOpenDecision={onOpenDecision}
          onOpenDeliveryChecklist={jumpToDeliveryChecklist}
        />

        <section
          aria-labelledby="continue-here-heading"
          className="overflow-hidden rounded-xl border border-primary/30 bg-surface-container-low shadow-sm"
        >
          <div className="grid gap-6 border-b border-border-subtle bg-primary/5 p-5 md:grid-cols-[minmax(0,1fr)_240px] md:p-6">
            <div>
              <div className="mb-3 flex items-center gap-2 text-label-caps font-semibold uppercase text-primary">
                <Target size={17} />
                Action-first resume
              </div>
              <h2
                id="continue-here-heading"
                className="font-display text-headline-sm text-on-surface"
              >
                Continue here
              </h2>
              <p className="mt-3 max-w-3xl font-display text-headline-md leading-snug text-on-surface">
                {recommendedNextAction}
              </p>
              <p className="mt-3 max-w-3xl text-body-md text-on-surface-variant">
                <span className="font-semibold text-on-surface">Current focus:</span>{" "}
                {activeProject?.glance?.currentFocus || "No current focus found."}
              </p>
              <button
                className="mt-4 inline-flex items-center gap-1.5 text-label-caps font-semibold uppercase text-primary hover:underline"
                type="button"
                onClick={jumpToDeliveryChecklist}
              >
                {tasks.length
                  ? `Open Delivery checklist (${openTaskCount} open)`
                  : "Open source doc"}
                <ArrowDown size={14} />
              </button>
            </div>
            <div className="rounded-lg border border-border-subtle bg-surface-container p-4">
              <div className="flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Progress
                <BarChart3 size={18} className="text-track-ai" />
              </div>
              <div className="mt-3 font-display text-headline-md text-on-surface">
                {progressPhase.label}
              </div>
              {typeof progressPercent === "number" ? (
                <>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                    <div
                      className="h-full rounded-full bg-track-ai"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="mt-2 text-metadata text-on-surface-variant">
                    {progressPercent}% complete
                    {taskCounts.total > 0 ? ` · ${taskCounts.done}/${taskCounts.total} tasks` : ""}
                  </div>
                </>
              ) : (
                <div className="mt-3 text-metadata text-on-surface-variant">
                  Not measured — add a weighted task checklist.
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border-subtle md:grid-cols-2 md:divide-x md:divide-y-0 xl:grid-cols-4">
            <article className="p-4">
              <div className="mb-2 flex items-center gap-2 text-metadata uppercase text-on-surface-variant">
                <History size={16} className="text-primary" />
                What changed
              </div>
              <p className="line-clamp-3 text-body-md text-on-surface">
                {activeProject?.glance?.recentChanges || "No recent change recorded."}
              </p>
            </article>
            <article className="p-4">
              <div
                className={`mb-2 flex items-center gap-2 text-metadata uppercase ${
                  hasBlocker ? "text-status-blocked" : "text-status-done"
                }`}
              >
                {hasBlocker ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
                What is blocked
              </div>
              <p className="line-clamp-3 text-body-md text-on-surface">
                {activeProject?.glance?.blocker || "No active blockers."}
              </p>
            </article>
            <article className="p-4">
              <div className="mb-2 flex items-center gap-2 text-metadata uppercase text-on-surface-variant">
                <CheckCircle2 size={16} className="text-primary" />
                What was decided
              </div>
              <p className="line-clamp-3 text-body-md text-on-surface">{latestDecision}</p>
            </article>
            <article className="p-4">
              <div className="mb-2 flex items-center gap-2 text-metadata uppercase text-on-surface-variant">
                <CircleHelp size={16} className="text-primary" />
                Open question
              </div>
              <p className="line-clamp-3 text-body-md text-on-surface">{latestQuestion}</p>
            </article>
          </div>
        </section>

        {tasks.length > 0 && (
          <section
            id="delivery-checklist"
            ref={deliveryChecklistRef}
            className="scroll-mt-6"
            tabIndex={-1}
          >
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-headline-sm text-on-surface">
                  Delivery checklist
                </h2>
                <p className="mt-1 text-metadata text-on-surface-variant">
                  {openTaskCount} open · {taskCounts.done} done — parsed live from the checklist in
                  the source doc
                </p>
              </div>
              <button
                className="inline-flex items-center gap-2 rounded border border-border-subtle bg-surface-container px-3 py-1.5 text-label-caps font-semibold uppercase text-on-surface hover:border-primary"
                type="button"
                onClick={() => onOpenDoc(activeProject.sourceDocPath)}
              >
                <FileText size={15} />
                Edit in source doc
              </button>
            </div>
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low">
              {TASK_GROUPS.map((group) => {
                const groupTasks = tasks.filter((task) => task.status === group.status);
                if (!groupTasks.length) return null;
                return (
                  <div key={group.status} className="border-b border-border-subtle last:border-b-0">
                    <div className="flex items-center gap-2 bg-surface-container px-5 py-2 text-metadata uppercase text-on-surface-variant">
                      <span
                        className={`h-2 w-2 rounded-full ${group.dotClassName}`}
                        aria-hidden="true"
                      />
                      {group.label}
                      <span className="ml-auto font-mono text-code-sm">{groupTasks.length}</span>
                    </div>
                    <ul className="divide-y divide-border-subtle/60">
                      {groupTasks.map((task, index) => (
                        <TaskRow
                          key={`${group.status}-${index}`}
                          task={task}
                          dotClassName={group.dotClassName}
                          canComplete={canCompleteTasks}
                          onRequestComplete={requestTaskCompletion}
                        />
                      ))}
                    </ul>
                  </div>
                );
              })}
              {taskCounts.done > 0 && (
                <details className="group/done">
                  <summary className="flex cursor-pointer list-none items-center gap-2 bg-surface-container px-5 py-2 text-metadata uppercase text-on-surface-variant hover:text-on-surface">
                    <span className="h-2 w-2 rounded-full bg-status-done" aria-hidden="true" />
                    Completed
                    <span className="text-code-sm font-normal normal-case group-open/done:hidden">
                      — show
                    </span>
                    <span className="hidden text-code-sm font-normal normal-case group-open/done:inline">
                      — hide
                    </span>
                    <span className="ml-auto font-mono text-code-sm">{taskCounts.done}</span>
                  </summary>
                  <ul className="divide-y divide-border-subtle/60">
                    {tasks
                      .filter((task) => task.status === "done")
                      .map((task, index) => (
                        <TaskRow
                          key={`done-${index}`}
                          task={task}
                          dotClassName="bg-status-done"
                          muted
                        />
                      ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        )}
      </div>
      {pendingTask && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancelTaskCompletion();
          }}
        >
          <div
            ref={finishDialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="finish-task-title"
            aria-describedby="finish-task-description"
            className="w-full max-w-lg rounded-xl border border-border-subtle bg-surface-container-high p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 shrink-0 text-status-done" size={22} />
              <div>
                <h2
                  id="finish-task-title"
                  className="font-display text-headline-sm text-on-surface"
                >
                  Finish this task?
                </h2>
                <p
                  id="finish-task-description"
                  className="mt-2 text-body-md text-on-surface-variant"
                >
                  This marks the checkbox complete in the project’s Markdown source.
                </p>
              </div>
            </div>
            <p className="mt-5 rounded border border-border-subtle bg-surface-container px-4 py-3 text-body-md text-on-surface">
              {pendingTask.text}
            </p>
            {taskCompletionState === "error" && (
              <p role="alert" className="mt-3 text-body-md text-status-blocked">
                {taskCompletionError}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                ref={cancelCompletionRef}
                type="button"
                className="rounded border border-border-subtle px-4 py-2 text-label-caps font-semibold uppercase text-on-surface hover:border-primary disabled:opacity-50"
                disabled={taskCompletionState === "saving"}
                onClick={cancelTaskCompletion}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded bg-status-done px-4 py-2 text-label-caps font-semibold uppercase text-surface-main disabled:opacity-60"
                disabled={taskCompletionState === "saving"}
                onClick={() => void confirmTaskCompletion()}
              >
                {taskCompletionState === "saving" ? "Finishing…" : "Finish task"}
              </button>
            </div>
          </div>
        </div>
      )}
    </OperatorFrame>
  );
}
