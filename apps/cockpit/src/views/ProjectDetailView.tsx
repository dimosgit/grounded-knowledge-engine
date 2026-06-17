import { AlertTriangle, BarChart3, CheckCircle2, FileText, Square, Target } from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";

const PROGRESS_PHASE = {
  active: { label: "In Progress", percent: 60 },
  blocked: { label: "Blocked", percent: 40 },
  next: { label: "Queued", percent: 20 },
  reference: { label: "Reference", percent: 100 },
};

const STATUS_PILL = {
  active: { label: "Active", className: "border-status-done/30 bg-status-done/10 text-status-done" },
  blocked: { label: "Blocked", className: "border-status-blocked/30 bg-status-blocked/10 text-status-blocked" },
  next: { label: "Queued", className: "border-status-waiting/30 bg-status-waiting/10 text-status-waiting" },
  reference: { label: "Reference", className: "border-outline-variant bg-surface-container-high text-on-surface-variant" },
};

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
  return (
    <OperatorFrame
      activeView="projects"
      title={activeProject?.title || "Project Context"}
      commandBar={<CommandBar items={docs} isOpen={commandBarOpen} onOpenChange={onCommandBarOpenChange} onSelect={onCommandSelect} />}
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
                  <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-label-caps uppercase ${pill.className}`}>
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {pill.label}
                  </span>
                );
              })()}
              <span className="text-metadata text-on-surface-variant">{activeProject?.updated ? `Last updated ${activeProject.updated}` : "Live project context"}</span>
            </div>
            <h1 className="font-display text-display-lg text-on-surface">{activeProject?.title || "Project Context"}</h1>
          </div>
          {activeProject && (
            <button className="flex items-center gap-2 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary" type="button" onClick={() => onOpenDoc(activeProject.sourceDocPath)}>
              <FileText size={16} />
              Open Source Doc
            </button>
          )}
        </section>

        <section>
          <h2 className="mb-4 font-display text-headline-sm text-on-surface">Project Dashboard</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Current Focus
                <Target size={18} className="text-primary" />
              </div>
              <p className="text-body-md text-on-surface">{activeProject?.currentFocus || "No current focus found."}</p>
            </article>
            <article className="rounded-lg border border-status-blocked/30 bg-status-blocked/10 p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-status-blocked">
                Critical Blocker
                <AlertTriangle size={18} />
              </div>
              <p className="text-body-md text-on-surface">{activeProject?.blockers?.[0] || "No critical blocker found."}</p>
            </article>
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Next Actions
                <CheckCircle2 size={18} />
              </div>
              <ul className="space-y-2 text-body-md text-on-surface">
                {(activeProject?.nextActions?.length ? activeProject.nextActions : ["Review project source doc"]).slice(0, 3).map((item, index) => (
                  <li className="flex items-start gap-2" key={`${item}-${index}`}>
                    <Square size={16} className="mt-0.5 shrink-0 text-on-surface-variant" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </article>
            <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
              <div className="mb-3 flex items-center justify-between text-metadata uppercase text-on-surface-variant">
                Progress Phase
                <BarChart3 size={18} className="text-track-ai" />
              </div>
              {(() => {
                const phase = PROGRESS_PHASE[activeProject?.statusBucket] || PROGRESS_PHASE.reference;
                const percent = activeProject?.progressPercent !== null && activeProject?.progressPercent !== undefined 
                  ? activeProject.progressPercent 
                  : phase.percent;
                  
                return (
                  <>
                    <div className="font-display text-headline-md text-on-surface">{phase.label}</div>
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                      <div className="h-full rounded-full bg-track-ai" style={{ width: `${percent}%` }} />
                    </div>
                    <div className="mt-2 text-metadata text-on-surface-variant">{percent}% complete</div>
                  </>
                );
              })()}
            </article>
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-display text-headline-sm text-on-surface">Linked Resources</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {linkedDocs.map((doc) => (
              <button key={doc.path} className="flex items-center gap-4 rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-primary" type="button" onClick={() => onOpenDoc(doc.path)}>
                <div className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary">
                  <FileText size={20} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-body-md font-semibold text-on-surface">{doc.title}</div>
                  <div className="truncate font-mono text-code-sm text-on-surface-variant">{doc.path}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </OperatorFrame>
  );
}
