import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Command, FileText, Search } from "lucide-react";
import { useModalSurface } from "../hooks/useModalSurface";
import { cn } from "../lib/utils";
import { matchesSearchFields } from "../lib/search";

interface CommandItem {
  path: string;
  title: string;
  searchIndex: string;
  searchIndexNormalized: string;
  searchIndexCompact: string;
}

interface CommandBarProps {
  items: CommandItem[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onSelect: (item: CommandItem) => void;
}

export function CommandBar({ items, isOpen, onOpenChange, onSelect }: CommandBarProps) {
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

  const filteredItems = useMemo(() => {
    if (!query) return [];
    return items
      .filter((item) =>
        matchesSearchFields(
          {
            raw: item.searchIndex,
            normalized: item.searchIndexNormalized,
            compact: item.searchIndexCompact,
          },
          query,
        ),
      )
      .slice(0, 20);
  }, [items, query]);

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

  const activeOptionId =
    filteredItems.length > 0 ? `${listboxId}-option-${selectedIndex}` : undefined;
  const resultStatus = query
    ? filteredItems.length
      ? `${filteredItems.length} result${filteredItems.length === 1 ? "" : "s"} available.`
      : `No results for ${query}.`
    : "Start typing to search.";

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex((previous) => (previous + 1) % filteredItems.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (filteredItems.length > 0) {
        setSelectedIndex(
          (previous) => (previous - 1 + filteredItems.length) % filteredItems.length,
        );
      }
    } else if (event.key === "Enter") {
      const selectedItem = filteredItems[selectedIndex];
      if (selectedItem) selectItem(selectedItem);
    }
  }

  function selectItem(item: CommandItem) {
    onSelect(item);
    onOpenChange(false);
    setQuery("");
  }

  if (typeof document === "undefined") return null;

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
          Search local knowledge
        </h2>
        <p id={descriptionId} className="sr-only">
          Search indexed notes and use the arrow keys to choose a result.
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
          className="fixed left-1/2 top-[15%] z-[101] w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-border-subtle bg-surface-sidebar shadow-2xl"
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
              placeholder="Search notes, terms, commands..."
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
            aria-label="Knowledge search results"
            className="max-h-[400px] overflow-y-auto p-2"
          >
            {filteredItems.length > 0 ? (
              filteredItems.map((item, index) => (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={item.path}
                  type="button"
                  role="option"
                  tabIndex={-1}
                  aria-selected={index === selectedIndex}
                  className={cn(
                    "flex w-full items-center justify-between rounded p-3 text-left transition-all",
                    index === selectedIndex
                      ? "bg-surface-container-high text-primary shadow-sm"
                      : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface",
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => selectItem(item)}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "rounded p-2",
                        index === selectedIndex ? "bg-surface-sidebar" : "bg-surface-container",
                      )}
                    >
                      <FileText className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="text-sm font-bold leading-tight">{item.title}</div>
                      <div className="mt-0.5 text-[11px] opacity-70">{item.path}</div>
                    </div>
                  </div>
                  {index === selectedIndex && (
                    <ArrowRight strokeWidth={2.8} className="mr-1 h-3.5 w-3.5 text-primary" />
                  )}
                </button>
              ))
            ) : query ? (
              <div className="py-12 text-center text-sm text-on-surface-variant">
                No results for &quot;{query}&quot;
              </div>
            ) : (
              <div className="py-8 text-center text-sm italic text-on-surface-variant">
                Start typing to search...
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
