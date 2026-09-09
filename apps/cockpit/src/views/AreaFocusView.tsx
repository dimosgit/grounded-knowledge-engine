import { ArrowRight, CircleDot, FileText, ListFilter, Target } from "lucide-react";
import { AreaIcon } from "../components/AreaIcon";
import { FocusShell } from "../components/FocusShell";
import type { CommandPaletteBinding } from "../domain/command-palette";
import type { AreaFocus, AreaRecord, FocusAreaDefinition } from "../domain/areas";

interface AreaFocusViewProps {
  area: FocusAreaDefinition;
  focus: AreaFocus;
  palette: CommandPaletteBinding;
  onCommand: () => void;
  onChooseArea: () => void;
  onExplore: () => void;
  onOpenWorkspace: () => void;
  onOpenRecord: (record: AreaRecord) => void;
}

export function AreaFocusView({
  area,
  focus,
  palette,
  onCommand,
  onChooseArea,
  onExplore,
  onOpenWorkspace,
  onOpenRecord,
}: AreaFocusViewProps) {
  return (
    <FocusShell
      title={area.label}
      palette={palette}
      onCommand={onCommand}
      onChooseArea={onChooseArea}
      onOpenWorkspace={onOpenWorkspace}
    >
      <main className="mx-auto max-w-[72rem] px-4 py-10 md:px-8 md:py-14">
        <header className="flex flex-col gap-5 border-b border-border-subtle pb-7 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-2 font-mono text-code-sm uppercase tracking-wide text-primary">
              <AreaIcon icon={area.icon} size={15} />
              Focused area
            </span>
            <h1 className="mt-3 font-display text-display-lg text-on-surface">{area.label}</h1>
            {area.description ? (
              <p className="mt-3 text-body-md leading-6 text-on-surface-variant">
                {area.description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onExplore}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded border border-outline-variant bg-surface-container px-4 text-body-md font-semibold text-on-surface hover:border-primary hover:text-primary"
          >
            <ListFilter size={16} aria-hidden="true" />
            Explore this area
          </button>
        </header>

        {focus.current ? (
          <section className="mt-9" aria-labelledby="current-focus-title">
            <span className="flex items-center gap-2 text-label-caps uppercase text-on-surface-variant">
              <Target size={15} aria-hidden="true" />
              Current focus
            </span>
            <FocusRecordCard
              record={focus.current}
              primary
              onOpen={() => onOpenRecord(focus.current!)}
            />
          </section>
        ) : (
          <section className="mt-9 rounded-xl border border-dashed border-border-subtle bg-surface-container-low px-6 py-8">
            <span className="flex h-10 w-10 items-center justify-center rounded bg-primary/10 text-primary">
              <Target size={19} aria-hidden="true" />
            </span>
            <h2 className="mt-4 font-display text-headline-md text-on-surface">
              Focus is not set yet
            </h2>
            <p className="mt-2 max-w-xl text-body-md leading-6 text-on-surface-variant">
              {focus.records.length
                ? "This area has linked records, but no ordered focus items yet. Explore the area to find the detail."
                : "No records are linked to this area yet. Keep the scope explicit, then add records when they belong here."}
            </p>
            <button
              type="button"
              onClick={onExplore}
              className="mt-5 inline-flex items-center gap-2 text-body-md font-semibold text-primary hover:text-on-surface"
            >
              Explore linked records
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          </section>
        )}

        {focus.next.length ? (
          <section className="mt-10" aria-labelledby="next-focus-title">
            <div className="flex items-center justify-between gap-4">
              <div>
                <span className="text-label-caps uppercase text-on-surface-variant">Up next</span>
                <h2
                  id="next-focus-title"
                  className="mt-1 font-display text-headline-md text-on-surface"
                >
                  When you are ready
                </h2>
              </div>
              <span className="font-mono text-code-sm text-on-surface-variant">
                {focus.next.length} item{focus.next.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-4 divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
              {focus.next.map((record) => (
                <FocusRow key={record.id} record={record} onOpen={() => onOpenRecord(record)} />
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </FocusShell>
  );
}

function FocusRecordCard({
  record,
  primary,
  onOpen,
}: {
  record: AreaRecord;
  primary?: boolean;
  onOpen: () => void;
}) {
  const Icon = record.kind === "project" ? CircleDot : FileText;
  return (
    <article
      className={`mt-4 rounded-xl border p-6 md:p-8 ${
        primary ? "border-primary/35 bg-primary/10" : "border-border-subtle bg-surface"
      }`}
    >
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-start">
        <div className="max-w-2xl">
          <span className="inline-flex items-center gap-2 font-mono text-code-sm uppercase tracking-wide text-primary">
            <Icon size={14} aria-hidden="true" />
            {record.metadata}
          </span>
          <h2
            id="current-focus-title"
            className="mt-3 font-display text-headline-md text-on-surface"
          >
            {record.title}
          </h2>
          <p className="mt-2 text-body-md leading-6 text-on-surface-variant">{record.summary}</p>
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded bg-primary px-4 text-body-md font-semibold text-on-primary hover:brightness-110"
        >
          Open {record.kind === "project" ? "project" : "note"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function FocusRow({ record, onOpen }: { record: AreaRecord; onOpen: () => void }) {
  const Icon = record.kind === "project" ? CircleDot : FileText;
  return (
    <button
      type="button"
      onClick={onOpen}
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
