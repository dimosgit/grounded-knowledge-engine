import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

const KIND_ORDER = ["Overview", "Track", "Module", "Client", "Project"];

const KIND_TONES = {
  Overview: "border-outline-variant text-on-surface-variant",
  Track: "border-track-ai/60 text-track-ai",
  Module: "border-track-demo/60 text-on-surface",
  Client: "border-track-demo/60 text-on-surface",
  Project: "border-primary/60 text-primary",
};

function groupByKind(options) {
  const groups = new Map<string, any[]>();
  for (const option of options) {
    const bucket = groups.get(option.kind) || [];
    bucket.push(option);
    groups.set(option.kind, bucket);
  }
  return [...groups.entries()].sort((a, b) => KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]));
}

/**
 * Searchable focus picker. Replaces the old input + native <select> pair: one
 * field, keyboard-navigable, grouped by kind, so a portfolio with dozens of
 * tracks/modules/projects stays reachable in two keystrokes.
 */
export function GraphFocusPicker({ options, activeOption, query, onQueryChange, onSelect }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const grouped = useMemo(() => groupByKind(options), [options]);
  const flatOptions = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  function commit(option) {
    if (!option) return;
    onSelect(option.id);
    onQueryChange("");
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(event) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        const next = current + step;
        if (next < 0) return Math.max(flatOptions.length - 1, 0);
        return next >= flatOptions.length ? 0 : next;
      });
      return;
    }
    if (event.key === "Enter") {
      if (!isOpen) return;
      event.preventDefault();
      commit(flatOptions[activeIndex]);
      return;
    }
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      onQueryChange("");
    }
  }

  let renderIndex = -1;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <span className="mb-1 block text-label-caps uppercase text-on-surface-variant">
        Focus context
      </span>
      <div className="relative">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-label="Focus context"
          className="h-11 w-full rounded border border-border-subtle bg-surface-container pl-9 pr-16 text-body-md text-on-surface outline-none focus:border-primary"
          // The field holds the query only; the current focus is painted over the
          // empty state so typing never has to clear a pre-filled label first.
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={
            !isOpen && activeOption ? "" : "Search tracks, modules, clients, projects..."
          }
        />
        {!isOpen && !query && activeOption && (
          <span
            className="pointer-events-none absolute left-9 right-16 top-1/2 flex -translate-y-1/2 items-center gap-2 truncate text-body-md text-on-surface"
            aria-hidden="true"
          >
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-code-sm uppercase ${
                KIND_TONES[activeOption.kind] || KIND_TONES.Overview
              }`}
            >
              {activeOption.kind}
            </span>
            <span className="truncate">{activeOption.label}</span>
          </span>
        )}
        {activeOption && activeOption.id !== "overview" && !isOpen && (
          <button
            type="button"
            className="absolute right-9 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-on-surface-variant hover:text-primary"
            onClick={() => commit({ id: "overview" })}
            aria-label="Clear focus and show the overview"
            title="Back to overview"
          >
            <X size={14} />
          </button>
        )}
        <button
          type="button"
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-on-surface-variant hover:text-primary"
          onClick={() => {
            setIsOpen((current) => !current);
            inputRef.current?.focus();
          }}
          aria-label={isOpen ? "Close focus list" : "Open focus list"}
          tabIndex={-1}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      {isOpen && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Graph focus options"
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[320px] overflow-y-auto rounded border border-border-subtle bg-surface-container shadow-lg shadow-black/40"
        >
          {!flatOptions.length && (
            <p className="px-3 py-4 text-body-md text-on-surface-variant">
              Nothing matches "{query}".
            </p>
          )}
          {grouped.map(([kind, items]) => (
            <div key={kind}>
              <div className="sticky top-0 bg-surface-container-high px-3 py-1.5 text-label-caps uppercase text-on-surface-variant">
                {kind}
              </div>
              {items.map((option) => {
                renderIndex += 1;
                const index = renderIndex;
                const isActive = index === activeIndex;
                const isSelected = option.id === activeOption?.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-body-md ${
                      isActive ? "bg-surface-container-high text-on-surface" : "text-on-surface"
                    } ${isSelected ? "font-semibold text-primary" : ""}`}
                    onPointerEnter={() => setActiveIndex(index)}
                    onClick={() => commit(option)}
                  >
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-code-sm uppercase ${
                        KIND_TONES[option.kind] || KIND_TONES.Overview
                      }`}
                    >
                      {option.kind}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
