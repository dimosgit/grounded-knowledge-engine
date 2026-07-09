import { useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  BarChart3,
  CheckCircle2,
  ClipboardCopy,
  FileText,
  History,
  ListChecks,
  Sparkles,
  Square,
  Target,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import { writeTextToClipboard } from "../utils/clipboard";

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

function TaskRow({ task, dotClassName, muted = false }) {
  return (
    <li className="flex items-start gap-3 px-5 py-2.5">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClassName}`} aria-hidden="true" />
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
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  activeProject,
  linkedDocs,
  onOpenDoc,
}) {
  const [handoffCopyState, setHandoffCopyState] = useState("idle");
  const taskBoardRef = useRef(null);
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
  const nextItems = activeProject?.glance?.nextActions?.length
    ? activeProject.glance.nextActions
    : [activeProject?.statusBucket === "done" ? "None — delivered." : "Review project source doc"];
  const progressPhase = PROGRESS_PHASE[activeProject?.statusBucket] || PROGRESS_PHASE.reference;
  const progressPercent =
    activeProject?.statusBucket === "done" ? 100 : activeProject?.progressPercent;

  function jumpToTaskBoard() {
    if (!tasks.length) {
      if (activeProject?.sourceDocPath) onOpenDoc(activeProject.sourceDocPath);
      return;
    }
    // Instant jump: reliable under rAF throttling and for reduced-motion users.
    taskBoardRef.current?.scrollIntoView({ block: "start" });
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
      commandBar={
        <CommandBar
          items={docs}
          isOpen={commandBarOpen}
          onOpenChange={onCommandBarOpenChange}
          onSelect={onCommandSelect}
        />
      }
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className="mx-auto flex max-w-[1200px] flex-col gap-10 px-4 py-8 md:px-8">
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
                onClick={() => onOpenDoc(activeProject.sourceDocPath)}
              >
                <FileText size={16} />
                Open Source Doc
              </button>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-headline-sm text-on-surface">At a glance</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Now
                <Target size={18} className="text-primary" />
              </div>
              <p className="line-clamp-4 text-body-md text-on-surface">
                {activeProject?.glance?.currentFocus || "No current focus found."}
              </p>
            </article>
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Next
                <ListChecks size={18} />
              </div>
              <ul className="space-y-2 text-body-md text-on-surface">
                {nextItems.map((item, index) => (
                  <li className="flex items-start gap-2" key={`${item}-${index}`}>
                    <Square size={16} className="mt-0.5 shrink-0 text-on-surface-variant" />
                    <span className="line-clamp-2">{item}</span>
                  </li>
                ))}
              </ul>
              <button
                className="mt-3 inline-flex items-center gap-1.5 text-label-caps font-semibold uppercase text-primary hover:underline"
                type="button"
                onClick={jumpToTaskBoard}
              >
                {tasks.length ? `Full task board (${openTaskCount} open)` : "Open source doc"}
                <ArrowDown size={14} />
              </button>
            </article>
            <article
              className={`rounded-lg border p-5 ${
                hasBlocker
                  ? "border-status-blocked/30 bg-status-blocked/10"
                  : "border-status-done/30 bg-status-done/5"
              }`}
            >
              <div
                className={`mb-3 flex items-center justify-between text-metadata uppercase ${
                  hasBlocker ? "text-status-blocked" : "text-status-done"
                }`}
              >
                Risk
                {hasBlocker ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
              </div>
              <p className="line-clamp-4 text-body-md text-on-surface">
                {activeProject?.glance?.blocker || "No active blockers."}
              </p>
            </article>
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Progress Phase
                <BarChart3 size={18} className="text-track-ai" />
              </div>
              <>
                <div className="font-display text-headline-md text-on-surface">
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
              </>
            </article>
          </div>
        </section>

        {tasks.length > 0 && (
          <section ref={taskBoardRef} className="scroll-mt-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-headline-sm text-on-surface">Task board</h2>
                <p className="mt-1 text-metadata text-on-surface-variant">
                  {openTaskCount} open · {taskCounts.done} done — parsed live from the checklist
                  in the source doc
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
                      <span className={`h-2 w-2 rounded-full ${group.dotClassName}`} aria-hidden="true" />
                      {group.label}
                      <span className="ml-auto font-mono text-code-sm">{groupTasks.length}</span>
                    </div>
                    <ul className="divide-y divide-border-subtle/60">
                      {groupTasks.map((task, index) => (
                        <TaskRow
                          key={`${group.status}-${index}`}
                          task={task}
                          dotClassName={group.dotClassName}
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
                        <TaskRow key={`done-${index}`} task={task} dotClassName="bg-status-done" muted />
                      ))}
                  </ul>
                </details>
              )}
            </div>
          </section>
        )}

        <details className="group rounded-lg border border-border-subtle bg-surface-container-low">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-body-md font-semibold text-on-surface">
            <span className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              Project context
            </span>
            <span className="text-metadata font-normal text-on-surface-variant group-open:hidden">
              Show more
            </span>
            <span className="hidden text-metadata font-normal text-on-surface-variant group-open:inline">
              Show less
            </span>
          </summary>
          <div className="grid gap-4 border-t border-border-subtle p-5 lg:grid-cols-2">
            <article>
              <div className="mb-2 text-metadata uppercase text-primary">Start here</div>
              <p className="text-body-md text-on-surface">
                {activeProject?.startHereBrief || "No start-here brief recorded."}
              </p>
            </article>
            <article>
              <div className="mb-2 flex items-center gap-2 text-metadata uppercase text-on-surface-variant">
                <History size={17} className="text-primary" />
                Last meaningful change
              </div>
              <p className="text-body-md text-on-surface">
                {activeProject?.recentChanges || "No recent change recorded."}
              </p>
            </article>
            <article>
              <div className="mb-2 text-metadata uppercase text-on-surface-variant">
                Active decisions
              </div>
              <ul className="space-y-2 text-body-md text-on-surface">
                {(activeProject?.activeDecisions?.length
                  ? activeProject.activeDecisions
                  : ["None recorded."]
                ).map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </article>
            <article>
              <div className="mb-2 text-metadata uppercase text-on-surface-variant">
                Open questions
              </div>
              <ul className="space-y-2 text-body-md text-on-surface">
                {(activeProject?.openQuestions?.length
                  ? activeProject.openQuestions
                  : ["None recorded."]
                ).map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </article>
          </div>
        </details>

        <section>
          <h2 className="mb-4 font-display text-headline-sm text-on-surface">Linked Resources</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {linkedDocs.map((doc) => (
              <button
                key={doc.path}
                className="flex items-center gap-4 rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-primary"
                type="button"
                onClick={() => onOpenDoc(doc.path)}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary">
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-body-md font-semibold text-on-surface">
                    {doc.title}
                  </div>
                  <div className="truncate font-mono text-code-sm text-on-surface-variant">
                    {doc.path}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </OperatorFrame>
  );
}
