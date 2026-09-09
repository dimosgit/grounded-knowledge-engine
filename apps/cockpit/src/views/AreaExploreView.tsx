import { ArrowLeft, ArrowRight, CircleDot, FileText, FolderOpen } from "lucide-react";
import { AreaIcon } from "../components/AreaIcon";
import { FocusShell } from "../components/FocusShell";
import type { CommandPaletteBinding } from "../domain/command-palette";
import type { AreaRecord, AreaScope, FocusAreaDefinition } from "../domain/areas";

interface AreaExploreViewProps {
  area: FocusAreaDefinition;
  scope: AreaScope;
  palette: CommandPaletteBinding;
  onCommand: () => void;
  onChooseArea: () => void;
  onBackToFocus: () => void;
  onOpenWorkspace: () => void;
  onOpenRecord: (record: AreaRecord) => void;
}

export function AreaExploreView({
  area,
  scope,
  palette,
  onCommand,
  onChooseArea,
  onBackToFocus,
  onOpenWorkspace,
  onOpenRecord,
}: AreaExploreViewProps) {
  return (
    <FocusShell
      title={area.label}
      palette={palette}
      onCommand={onCommand}
      onChooseArea={onChooseArea}
      onOpenWorkspace={onOpenWorkspace}
    >
      <main className="mx-auto max-w-[72rem] px-4 py-10 md:px-8 md:py-14">
        <button
          type="button"
          onClick={onBackToFocus}
          className="inline-flex items-center gap-2 text-body-md font-medium text-on-surface-variant hover:text-on-surface"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to focus
        </button>
        <header className="mt-7 border-b border-border-subtle pb-7">
          <span className="inline-flex items-center gap-2 font-mono text-code-sm uppercase tracking-wide text-primary">
            <AreaIcon icon={area.icon} size={15} />
            Linked records
          </span>
          <h1 className="mt-3 font-display text-display-lg text-on-surface">
            Explore {area.label}
          </h1>
          <p className="mt-3 max-w-2xl text-body-md leading-6 text-on-surface-variant">
            Supporting detail stays here until you deliberately need it.
          </p>
        </header>

        {scope.records.length ? (
          <div className="mt-9 grid gap-8 lg:grid-cols-2">
            <ExploreGroup label="Projects" records={scope.projects} onOpenRecord={onOpenRecord} />
            <ExploreGroup
              label="Notes and plans"
              records={scope.documents}
              onOpenRecord={onOpenRecord}
            />
          </div>
        ) : (
          <section className="mt-9 rounded-xl border border-dashed border-border-subtle bg-surface-container-low px-6 py-10 text-center">
            <FolderOpen className="mx-auto text-primary" size={26} aria-hidden="true" />
            <h2 className="mt-4 font-display text-headline-md text-on-surface">
              Nothing linked yet
            </h2>
            <p className="mx-auto mt-2 max-w-lg text-body-md leading-6 text-on-surface-variant">
              This area is intentionally empty until a project or document is explicitly linked to
              it.
            </p>
          </section>
        )}
      </main>
    </FocusShell>
  );
}

function ExploreGroup({
  label,
  records,
  onOpenRecord,
}: {
  label: string;
  records: AreaRecord[];
  onOpenRecord: (record: AreaRecord) => void;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-headline-sm text-on-surface">{label}</h2>
        <span className="font-mono text-code-sm text-on-surface-variant">{records.length}</span>
      </div>
      <div className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
        {records.length ? (
          records.map((record) => (
            <ExploreRow key={record.id} record={record} onOpen={onOpenRecord} />
          ))
        ) : (
          <p className="px-5 py-6 text-body-md text-on-surface-variant">No linked records.</p>
        )}
      </div>
    </section>
  );
}

function ExploreRow({
  record,
  onOpen,
}: {
  record: AreaRecord;
  onOpen: (record: AreaRecord) => void;
}) {
  const Icon = record.kind === "project" ? CircleDot : FileText;
  return (
    <button
      type="button"
      onClick={() => onOpen(record)}
      className="group flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-surface-container-low"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-surface-container text-on-surface-variant group-hover:text-primary">
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-semibold text-on-surface">{record.title}</span>
        <span className="mt-1 block truncate text-metadata text-on-surface-variant">
          {record.summary}
        </span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-on-surface-variant group-hover:text-primary" />
    </button>
  );
}
