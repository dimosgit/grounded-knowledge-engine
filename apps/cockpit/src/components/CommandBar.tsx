import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Command,
  FileText,
  Grid2X2,
  LayoutDashboard,
  Scale,
  Search,
  Sparkles,
} from "lucide-react";
import { useModalSurface } from "../hooks/useModalSurface";
import { cn } from "../lib/utils";
import {
  buildCommandPaletteResult,
  type CommandPaletteEntry,
  type CommandPaletteKind,
} from "../domain/command-palette";

export interface CommandBarProps {
  entries: CommandPaletteEntry[];
  recentIds?: string[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Single typed destination callback. Selection never mutates anything. */
  onSelect: (entry: CommandPaletteEntry) => void;
}

const KIND_ICONS: Record<CommandPaletteKind, typeof FileText> = {
  "review-action": Sparkles,
  view: LayoutDashboard,
  project: Grid2X2,
  decision: Scale,
  document: FileText,
};

export function CommandBar({
  entries,
  recentIds = [],
  isOpen,
  onOpenChange,
  onSelect,
}: CommandBarProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const listboxId = useId();
  const shouldReduceMotion = useReducedMotion();
  const modalRef = useModalSurface<HTMLDivElement>({
    isOpen,
    onClose: () => onOpenChange(false),
    initialFocusRef: inputRef,
  });

  const result = useMemo(
    () => buildCommandPaletteResult({ entries, query, recentIds }),
    [entries, query, recentIds],
  );
  const options = result.options;

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(true);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [onOpenChange]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    // A closed palette always reopens on the quick actions, never a stale query.
    if (!isOpen) setQuery("");
  }, [isOpen]);

  const activeIndex = options.length ? Math.min(selectedIndex, options.length - 1) : 0;
  const activeEntry = options[activeIndex];
  const activeOptionId = activeEntry ? `${listboxId}-option-${activeIndex}` : undefined;
  const activeGroupLabel = activeEntry
    ? result.groups.find((group) => group.entries.includes(activeEntry))?.label || ""
    : "";
  const resultStatus = buildResultStatus(query, options.length, activeGroupLabel, result.mode);

  useEffect(() => {
    if (!isOpen || !activeOptionId) return;
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeOptionId, isOpen]);

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((previous) => (previous + 1) % options.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length > 0) {
        setSelectedIndex((previous) => (previous - 1 + options.length) % options.length);
      }
    } else if (event.key === "Enter") {
      const selectedEntry = options[activeIndex];
      if (selectedEntry) selectEntry(selectedEntry);
    }
  }

  function selectEntry(entry: CommandPaletteEntry) {
    onSelect(entry);
    onOpenChange(false);
    setQuery("");
  }

  if (typeof document === "undefined") return null;

  let optionIndex = -1;

  return createPortal(
    isOpen ? (
      <motion.div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="fixed inset-0 z-[100]"
        initial={shouldReduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
      >
        <h2 id={titleId} className="sr-only">
          Command palette
        </h2>
        <p id={descriptionId} className="sr-only">
          Search documents, projects, decisions, and views, then use the arrow keys to choose a
          destination. Nothing here writes to the knowledge base.
        </p>
        <button
          type="button"
          className="fixed inset-0 bg-black/40 backdrop-blur-sm"
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => onOpenChange(false)}
        />
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.95, y: -20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -20 }}
          transition={{ duration: shouldReduceMotion ? 0 : 0.16 }}
          // Centered with auto margins rather than a translate: framer-motion
          // owns `transform` here, so a Tailwind translate class is overwritten
          // and the panel drifts off a narrow viewport.
          className="fixed inset-x-4 top-[15%] z-[101] mx-auto max-w-xl overflow-hidden rounded-lg border border-border-subtle bg-surface-sidebar shadow-2xl"
        >
          <div className="flex items-center border-b border-border-subtle px-4 py-3">
            <Search strokeWidth={2.4} className="mr-3 h-3.5 w-3.5 text-primary" />
            <input
              ref={inputRef}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={activeOptionId}
              placeholder="Search documents, projects, decisions, views..."
              className="flex-1 border-none bg-transparent text-[13.5px] font-medium text-on-surface outline-none placeholder:text-on-surface-variant"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
            />
            <div className="shortcut-keycap shortcut-keycap--compact" aria-hidden="true">
              <Command size={11} strokeWidth={2.7} />
              <span>K</span>
            </div>
          </div>

          <div
            id={listboxId}
            role="listbox"
            aria-label="Command palette results"
            className="max-h-[400px] overflow-y-auto p-2"
          >
            {options.length > 0 ? (
              result.groups.map((group) => (
                <div key={group.key} role="group" aria-label={group.label}>
                  <div
                    className="px-3 pb-1 pt-3 text-label-caps uppercase text-on-surface-variant"
                    aria-hidden="true"
                  >
                    {group.label}
                  </div>
                  {group.entries.map((entry) => {
                    optionIndex += 1;
                    const index = optionIndex;
                    const Icon = KIND_ICONS[entry.kind];
                    const isActive = index === activeIndex;
                    return (
                      <button
                        id={`${listboxId}-option-${index}`}
                        key={entry.id}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        aria-selected={isActive}
                        className={cn(
                          "flex w-full items-center justify-between rounded p-3 text-left transition-all",
                          isActive
                            ? "bg-surface-container-high text-primary shadow-sm"
                            : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                        )}
                        onMouseEnter={() => setSelectedIndex(index)}
                        onClick={() => selectEntry(entry)}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div
                            className={cn(
                              "rounded p-2",
                              isActive ? "bg-surface-sidebar" : "bg-surface-container",
                            )}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-bold leading-tight">{entry.title}</div>
                            <div className="mt-0.5 truncate text-[11px] opacity-70">
                              {entry.subtitle}
                            </div>
                          </div>
                        </div>
                        {isActive && (
                          <ArrowRight
                            strokeWidth={2.8}
                            className="ml-2 mr-1 h-3.5 w-3.5 shrink-0 text-primary"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))
            ) : query ? (
              <div className="py-12 text-center text-sm text-on-surface-variant">
                No matches for &quot;{query}&quot;
              </div>
            ) : (
              <div className="py-8 text-center text-sm italic text-on-surface-variant">
                Start with a quick action, or type to search documents, projects, decisions, and
                views.
              </div>
            )}
          </div>
          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {resultStatus}
          </div>
        </motion.div>
      </motion.div>
    ) : null,
    document.body,
  );
}

function buildResultStatus(
  query: string,
  optionCount: number,
  activeGroupLabel: string,
  mode: "suggestions" | "search",
): string {
  const group = activeGroupLabel ? ` Active group: ${activeGroupLabel}.` : "";
  if (mode === "suggestions") {
    return optionCount
      ? `${optionCount} suggestion${optionCount === 1 ? "" : "s"} available.${group}`
      : "Start typing to search.";
  }
  if (!optionCount) return `No results for ${query}.`;
  return `${optionCount} result${optionCount === 1 ? "" : "s"} available.${group}`;
}
