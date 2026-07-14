import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CalendarClock,
  FileText,
  HelpCircle,
  Target,
} from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { LocalProjectDelta } from "../components/LocalProjectDelta";
import { OperatorFrame } from "../components/OperatorFrame";

export function HubView({
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
  activeModule,
  openQuestionsCount,
  projectCount,
  openQuestionItems,
  tracks,
  selectedTrack,
  selectedTrackKey,
  onTrackChange,
  learningItemOrder,
  learningItemLabels,
  learningItemDescriptions,
  onEnterLibrary,
  recentDocs,
  onOpenDoc,
  getDocBadge,
  attentionCounts,
  attentionProjects,
  onAttentionFilter,
  onOpenProject,
}) {
  return (
    <OperatorFrame
      activeView="hub"
      title="Knowledge Base"
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
      <div className="mx-auto flex max-w-cockpit flex-col gap-8 px-4 py-8 md:px-8">
        <section className="flex flex-col justify-between gap-4 border-b border-border-subtle pb-6 md:flex-row md:items-center">
          <div>
            <h1 className="font-display text-display-lg text-on-surface">Mission Control</h1>
            <p className="mt-2 text-body-md text-on-surface-variant">
              System operations running normally. {openQuestionsCount} unresolved items and{" "}
              {projectCount} project contexts indexed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onEnterLibrary({ trackKey: selectedTrackKey, itemType: "all" })}
            className="flex items-center gap-2 rounded border border-outline-variant bg-surface-container px-4 py-3 text-label-caps font-semibold uppercase text-on-surface hover:border-primary hover:text-primary"
          >
            <BookOpen size={17} />
            Open learning library
          </button>
        </section>

        <section aria-labelledby="daily-attention-title">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 id="daily-attention-title" className="font-display text-headline-sm">
                Daily attention
              </h2>
              <p className="mt-1 text-body-md text-on-surface-variant">
                Reviews, blockers, and project questions derived from canonical Markdown.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAttentionFilter("needs-attention")}
              className="text-label-caps uppercase text-primary"
            >
              View attention queue
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <button
              type="button"
              aria-label={`Reviews due: ${attentionCounts.dueOrOverdue}; ${attentionCounts.overdue} overdue and ${attentionCounts.due} due today`}
              onClick={() =>
                onAttentionFilter(attentionCounts.overdue ? "overdue" : "needs-attention")
              }
              className="rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-primary"
            >
              <span className="flex items-center gap-2 text-label-caps uppercase text-on-surface-variant">
                <CalendarClock size={16} /> Reviews due
              </span>
              <span className="mt-2 block font-display text-headline-md text-on-surface">
                {attentionCounts.dueOrOverdue}
              </span>
              <span className="text-metadata text-on-surface-variant">
                {attentionCounts.overdue} overdue · {attentionCounts.due} due today
              </span>
            </button>
            <button
              type="button"
              aria-label={`Blocked: ${attentionCounts.blocked} project contexts`}
              onClick={() => onAttentionFilter("blocked")}
              className="rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-status-blocked"
            >
              <span className="flex items-center gap-2 text-label-caps uppercase text-on-surface-variant">
                <AlertTriangle size={16} /> Blocked
              </span>
              <span className="mt-2 block font-display text-headline-md text-on-surface">
                {attentionCounts.blocked}
              </span>
              <span className="text-metadata text-on-surface-variant">project contexts</span>
            </button>
            <button
              type="button"
              aria-label={`Open questions: ${attentionCounts.openQuestions} project contexts`}
              onClick={() => onAttentionFilter("open-questions")}
              className="rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-status-waiting"
            >
              <span className="flex items-center gap-2 text-label-caps uppercase text-on-surface-variant">
                <HelpCircle size={16} /> Open questions
              </span>
              <span className="mt-2 block font-display text-headline-md text-on-surface">
                {attentionCounts.openQuestions}
              </span>
              <span className="text-metadata text-on-surface-variant">project contexts</span>
            </button>
          </div>
          {attentionProjects.length > 0 && (
            <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
              {attentionProjects.slice(0, 3).map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenProject(project.id)}
                  className="rounded border border-border-subtle bg-surface px-4 py-3 text-left hover:border-primary"
                >
                  <span className="block text-body-md font-semibold text-on-surface">
                    {project.title}
                  </span>
                  <span className="mt-1 block text-metadata text-on-surface-variant">
                    {project.attentionReasons.join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {import.meta.env.DEV && <LocalProjectDelta onOpenDoc={onOpenDoc} />}

        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <article className="relative overflow-hidden rounded-lg border border-border-subtle bg-surface-container-low p-6 lg:col-span-2">
            <div className="absolute inset-0 bg-gradient-to-br from-primary-container/10 to-transparent" />
            <div className="relative">
              <div className="mb-6 flex items-start justify-between gap-4">
                <div>
                  <span className="mb-3 inline-flex items-center gap-2 rounded bg-track-demo/15 px-2 py-1 font-mono text-code-sm text-track-demo">
                    <span className="h-2 w-2 rounded-full bg-track-demo" />
                    {activeProject?.trackLabel || "Knowledge Base"}
                  </span>
                  <h2 className="font-display text-headline-md text-on-surface">
                    {activeProject?.title || activeModule?.title || "Learning OS"}
                  </h2>
                </div>
                <div className="font-mono text-code-sm uppercase text-on-surface-variant">
                  <div>
                    {activeProject?.updated ? `Updated ${activeProject.updated}` : "Live KB"}
                  </div>
                  <div
                    className={
                      activeProject?.blockers?.length ? "text-status-blocked" : "text-status-done"
                    }
                  >
                    {activeProject?.blockers?.length ? "Needs attention" : "Operational"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-border-subtle bg-surface p-4">
                  <h3 className="mb-2 flex items-center gap-2 text-label-caps uppercase text-on-surface-variant">
                    <Target size={16} />
                    Next Task
                  </h3>
                  <p className="text-body-md text-on-surface">
                    {activeProject?.nextActions?.[0] ||
                      activeModule?.actions?.[0] ||
                      "Open a project context to continue."}
                  </p>
                </div>
                <div className="rounded border border-status-blocked/30 bg-status-blocked/10 p-4">
                  <h3 className="mb-2 flex items-center gap-2 text-label-caps uppercase text-status-blocked">
                    <AlertTriangle size={16} />
                    Active Blocker
                  </h3>
                  <p className="text-body-md text-on-surface">
                    {activeProject?.blockers?.[0] || "No active blocker detected."}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-border-subtle pt-4">
                <span className="text-metadata text-on-surface-variant">
                  {docs.length} documents indexed
                </span>
                <button
                  className="flex items-center gap-2 text-label-caps uppercase text-primary"
                  type="button"
                  onClick={onProjects}
                >
                  Open Board
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </article>

          <article className="rounded-lg border border-border-subtle bg-surface-container-low p-5">
            <h2 className="mb-4 flex items-center gap-2 font-display text-headline-sm">
              <HelpCircle className="text-status-waiting" size={20} />
              Unresolved
            </h2>
            <div className="space-y-3">
              {openQuestionItems.slice(0, 4).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="block w-full rounded border border-border-subtle bg-surface p-3 text-left text-body-md text-on-surface-variant hover:border-primary hover:text-on-surface"
                  onClick={() => onOpenDoc(item.path)}
                >
                  {item.label}
                </button>
              ))}
              {!openQuestionItems.length && (
                <p className="text-body-md text-on-surface-variant">No open questions found.</p>
              )}
            </div>
          </article>
        </section>

        <section aria-label="Learning tracks">
          <h2 className="mb-4 font-display text-headline-sm">Domain Tracks</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {tracks.map((track) => {
              const isActive = selectedTrackKey === track.key;
              return (
                <button
                  key={track.key}
                  type="button"
                  className={`rounded-lg border p-4 text-left transition ${isActive ? "border-primary bg-primary/10" : "border-border-subtle bg-surface-container hover:border-primary"}`}
                  onClick={() => onTrackChange(track.key)}
                  aria-pressed={isActive}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-headline-sm text-on-surface">{track.label}</h3>
                    <span className="rounded bg-surface-container-high px-2 py-1 font-mono text-code-sm text-primary">
                      {track.count}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-body-md text-on-surface-variant">
                    {track.description}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <section aria-label="Learning item types">
          <h2 className="mb-4 font-display text-headline-sm">Deep Dive by Category</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {learningItemOrder
              .filter((itemType) => itemType !== "all")
              .map((itemType) => {
                const count = selectedTrack?.learningItemCounts[itemType] || 0;
                const isDisabled = count === 0;
                return (
                  <button
                    key={itemType}
                    className={`rounded-lg border p-4 text-left ${isDisabled ? "cursor-not-allowed border-border-subtle bg-surface opacity-45" : "border-border-subtle bg-surface-container hover:border-primary"}`}
                    onClick={() => onEnterLibrary({ trackKey: selectedTrackKey, itemType })}
                    type="button"
                    disabled={isDisabled}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="font-display text-headline-sm text-on-surface">
                        {learningItemLabels[itemType]}
                      </h3>
                      <span className="font-mono text-code-sm text-primary">{count}</span>
                    </div>
                    <p className="line-clamp-2 text-metadata text-on-surface-variant">
                      {learningItemDescriptions[itemType]}
                    </p>
                  </button>
                );
              })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 font-display text-headline-sm">Recent Context</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {recentDocs.map((doc) => (
              <button
                key={doc.path}
                type="button"
                className="rounded-lg border border-border-subtle bg-surface-container p-4 text-left hover:border-primary"
                onClick={() => onOpenDoc(doc.path)}
              >
                <div className="mb-3 flex items-center gap-2 text-metadata uppercase text-on-surface-variant">
                  <FileText size={14} />
                  {getDocBadge(doc.docType)}
                </div>
                <h3 className="mb-3 line-clamp-2 text-body-md font-semibold text-on-surface">
                  {doc.title}
                </h3>
                <p className="truncate font-mono text-code-sm text-on-surface-variant">
                  {doc.path}
                </p>
              </button>
            ))}
            {!recentDocs.length && (
              <p className="text-body-md text-on-surface-variant">No recent activity yet.</p>
            )}
          </div>
        </section>
      </div>
    </OperatorFrame>
  );
}
