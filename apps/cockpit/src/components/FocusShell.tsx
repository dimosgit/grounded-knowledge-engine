import { ArrowUpRight, Command, Grid2X2, Search } from "lucide-react";
import type { ReactNode } from "react";
import type { CommandPaletteBinding } from "../domain/command-palette";
import { CommandBar } from "./CommandBar";
import { ThemeSwitcher } from "./ThemeSwitcher";

interface FocusShellProps {
  title: string;
  palette: CommandPaletteBinding;
  onCommand: () => void;
  onChooseArea?: () => void;
  onOpenWorkspace: () => void;
  children: ReactNode;
}

/**
 * A deliberately quiet shell for area-first work. The full Cockpit stays one
 * click away, while the focus flow avoids keeping every navigation surface in
 * peripheral vision.
 */
export function FocusShell({
  title,
  palette,
  onCommand,
  onChooseArea,
  onOpenWorkspace,
  children,
}: FocusShellProps) {
  return (
    <div className="min-h-screen bg-surface-main text-on-surface">
      <header className="sticky top-0 z-30 border-b border-border-subtle bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[76rem] items-center justify-between gap-4 px-4 md:px-8">
          {onChooseArea ? (
            <button
              type="button"
              onClick={onChooseArea}
              className="flex min-w-0 items-center gap-2 text-left text-on-surface-variant hover:text-on-surface"
            >
              <Grid2X2 size={18} aria-hidden="true" />
              <span className="truncate font-display text-body-md font-semibold text-on-surface">
                {title}
              </span>
              <span className="hidden text-metadata md:inline">Change area</span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2 text-on-surface-variant">
              <Grid2X2 size={18} aria-hidden="true" />
              <span className="truncate font-display text-body-md font-semibold text-on-surface">
                {title}
              </span>
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitcher compact />
            <button
              type="button"
              onClick={onCommand}
              className="inline-flex h-10 items-center gap-2 rounded border border-outline-variant bg-surface-container px-3 text-metadata font-medium text-on-surface-variant hover:border-primary hover:text-on-surface"
              aria-label="Search the Cockpit"
            >
              <Search size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Search</span>
              <span className="hidden items-center gap-0.5 font-mono text-code-sm text-on-surface-variant md:inline-flex">
                <Command size={11} aria-hidden="true" />K
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenWorkspace}
              className="hidden h-10 w-10 items-center justify-center rounded border border-outline-variant bg-surface-container text-on-surface-variant transition-colors hover:border-primary hover:bg-primary/10 hover:text-on-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:inline-flex lg:w-auto lg:gap-2 lg:px-3"
              aria-label="Open full workspace"
              title="Open full workspace"
            >
              <ArrowUpRight size={16} aria-hidden="true" />
              <span className="hidden lg:inline">Workspace</span>
            </button>
          </div>
        </div>
      </header>
      {children}
      <CommandBar {...palette} />
    </div>
  );
}
