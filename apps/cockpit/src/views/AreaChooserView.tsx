import { ArrowRight, Check, FolderOpen } from "lucide-react";
import { AreaIcon } from "../components/AreaIcon";
import { FocusShell } from "../components/FocusShell";
import type { CommandPaletteBinding } from "../domain/command-palette";
import type { FocusAreaDefinition } from "../domain/areas";

interface AreaChooserViewProps {
  areas: FocusAreaDefinition[];
  selectedAreaId: string;
  palette: CommandPaletteBinding;
  onCommand: () => void;
  onSelectArea: (areaId: string) => void;
  onOpenWorkspace: () => void;
}

export function AreaChooserView({
  areas,
  selectedAreaId,
  palette,
  onCommand,
  onSelectArea,
  onOpenWorkspace,
}: AreaChooserViewProps) {
  return (
    <FocusShell
      title="Focus"
      palette={palette}
      onCommand={onCommand}
      onOpenWorkspace={onOpenWorkspace}
    >
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-[76rem] items-center px-4 py-12 md:px-8">
        <section className="w-full">
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 font-mono text-code-sm uppercase tracking-wide text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Focus environment
            </span>
            <h1 className="mt-5 font-display text-display-lg text-on-surface">Choose an area</h1>
            <p className="mx-auto mt-3 max-w-xl text-body-md leading-6 text-on-surface-variant">
              Bring one part of your work forward. Everything else stays available when you need it.
            </p>
          </div>

          <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3 md:gap-6">
            {areas.map((area) => {
              const isSelected = area.id === selectedAreaId;
              const linkedCount = area.projectIds.length + area.documentPaths.length;
              return (
                <button
                  key={area.id}
                  type="button"
                  aria-current={isSelected ? "page" : undefined}
                  onClick={() => onSelectArea(area.id)}
                  className={`theme-card-elevated group relative flex min-h-64 flex-col justify-between rounded-xl border p-6 text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary md:p-8 ${
                    isSelected
                      ? "border-primary/60 bg-primary/10 shadow-[var(--theme-shadow)]"
                      : "border-outline-variant bg-surface hover:border-primary/50 hover:bg-surface-container-low"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-4">
                      <span
                        className={`flex h-11 w-11 items-center justify-center rounded border ${
                          isSelected
                            ? "border-primary/35 bg-primary/15 text-primary"
                            : "border-outline-variant bg-surface-container text-on-surface-variant group-hover:text-primary"
                        }`}
                      >
                        <AreaIcon icon={area.icon} size={22} />
                      </span>
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-1 font-mono text-code-sm uppercase tracking-wide text-primary">
                          <Check size={12} aria-hidden="true" />
                          Selected
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-7 font-display text-headline-md text-on-surface">
                      {area.label}
                    </h2>
                    {area.description ? (
                      <p className="mt-2 text-body-md leading-6 text-on-surface-variant">
                        {area.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-8 flex items-center justify-between border-t border-border-subtle pt-4 text-metadata text-on-surface-variant">
                    <span className="inline-flex items-center gap-2">
                      <FolderOpen size={15} aria-hidden="true" />
                      {linkedCount
                        ? `${linkedCount} linked record${linkedCount === 1 ? "" : "s"}`
                        : "No records linked yet"}
                    </span>
                    <ArrowRight
                      size={17}
                      className="text-primary transition-transform group-hover:translate-x-0.5"
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </main>
    </FocusShell>
  );
}
