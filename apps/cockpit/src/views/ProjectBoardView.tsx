import { useState } from "react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";
import { ProjectCard } from "../components/ProjectCard";

const columns = [
  { key: "next", label: "Next Up", dot: "bg-status-waiting" },
  { key: "active", label: "Active Now", dot: "bg-primary" },
  { key: "blocked", label: "Blocked", dot: "bg-status-blocked" },
  { key: "done", label: "Completed", dot: "bg-status-done" },
];

export function ProjectBoardView({
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  projectColumns,
  onOpenProject,
  onMoveProject,
}) {
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const canMove = typeof onMoveProject === "function";
  return (
    <OperatorFrame
      activeView="projects"
      title="Project Board"
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
      <div className="px-4 pt-8 md:px-8">
        <h1 className="font-display text-display-lg text-on-surface">Project Board</h1>
        <p className="mt-2 max-w-2xl text-body-md text-on-surface-variant">
          Track active work, upcoming moves, and blocked project contexts across the knowledge base.
        </p>
        {import.meta.env.PROD && (
          <p className="mt-3 inline-flex max-w-2xl items-start gap-2 rounded-md border border-border-subtle bg-surface-container-low/65 px-3 py-2 text-body-md text-on-surface-variant">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-status-waiting" />
            <span>
              Demo mode — drag a card to explore the board, but lane changes stay in this browser
              session only. Run the cockpit locally to persist moves back to the project Markdown.
            </span>
          </p>
        )}
      </div>
      <div className="overflow-x-auto px-4 py-8 md:px-8">
        <div className="mx-auto grid min-w-[1180px] max-w-[1840px] grid-cols-4 gap-5">
          {columns.map((column) => (
            <section
              key={column.key}
              className={`min-w-0 rounded-lg border bg-surface-container-low/65 p-4 transition-colors ${
                dragOverKey === column.key ? "border-primary bg-primary/5" : "border-border-subtle"
              }`}
              onDragOver={(event) => {
                if (!canMove) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                if (dragOverKey !== column.key) setDragOverKey(column.key);
              }}
              onDragLeave={(event) => {
                if (!canMove) return;
                if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                setDragOverKey((current) => (current === column.key ? null : current));
              }}
              onDrop={(event) => {
                if (!canMove) return;
                event.preventDefault();
                setDragOverKey(null);
                const projectId = event.dataTransfer.getData("text/plain");
                if (projectId) onMoveProject(projectId, column.key);
              }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-label-caps uppercase text-on-surface">
                  <span className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
                  {column.label}
                </h2>
                <span className="rounded bg-surface-container px-2 py-1 font-mono text-code-sm text-on-surface-variant">
                  {projectColumns[column.key].length}
                </span>
              </div>
              <div className="space-y-4">
                {projectColumns[column.key].map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={onOpenProject}
                    onMove={onMoveProject}
                  />
                ))}
                {!projectColumns[column.key].length && (
                  <div className="rounded border border-dashed border-border-subtle p-5 text-body-md text-on-surface-variant">
                    No items in this lane.
                  </div>
                )}
              </div>
            </section>
          ))}
        </div>
      </div>
    </OperatorFrame>
  );
}
