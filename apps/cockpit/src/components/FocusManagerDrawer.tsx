import { useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleDot,
  FileText,
  ListPlus,
  LoaderCircle,
  Plus,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useModalSurface } from "../hooks/useModalSurface";
import type { FocusMutation } from "../lib/focus-api";
import type { AreaFocus, AreaRecord, FocusAreaDefinition } from "../domain/areas";

interface FocusManagerDrawerProps {
  area: FocusAreaDefinition;
  focus: AreaFocus;
  availableRecords: AreaRecord[];
  onUpdate: (mutation: FocusMutation) => Promise<void>;
}

export function FocusManagerDrawer({
  area,
  focus,
  availableRecords,
  onUpdate,
}: FocusManagerDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useModalSurface<HTMLDivElement>({
    isOpen,
    onClose: () => setIsOpen(false),
    closeDisabled: pending,
    initialFocusRef: closeButtonRef,
  });
  const recordsById = useMemo(
    () => new Map(focus.records.map((record) => [record.id, record])),
    [focus.records],
  );
  const orderedRecords = area.focusRecordIds
    .map((recordId) => recordsById.get(recordId) || null)
    .filter((record): record is AreaRecord => Boolean(record));
  const unscheduledRecords = focus.records.filter(
    (record) => !area.focusRecordIds.includes(record.id),
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const candidates = availableRecords
    .filter((record) => !focus.records.some((linked) => linked.id === record.id))
    .filter(
      (record) =>
        !normalizedQuery ||
        record.title.toLocaleLowerCase().includes(normalizedQuery) ||
        record.summary.toLocaleLowerCase().includes(normalizedQuery),
    )
    .slice(0, 20);

  async function submit(mutation: FocusMutation) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await onUpdate(mutation);
      if (mutation.action === "add-task") setTaskTitle("");
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setPending(false);
    }
  }

  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    void submit({ action: "add-task", areaId: area.id, title });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded border border-outline-variant bg-surface-container px-4 text-body-md font-semibold text-on-surface hover:border-primary hover:text-primary"
      >
        <ListPlus size={16} aria-hidden="true" />
        Manage focus
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={modalRef}
            className="fixed inset-0 z-[120] flex justify-end"
            role="dialog"
            aria-modal="true"
            aria-labelledby="focus-manager-title"
            aria-describedby="focus-manager-description"
            tabIndex={-1}
          >
            <button
              type="button"
              className="absolute inset-0 bg-black/65"
              aria-hidden="true"
              tabIndex={-1}
              disabled={pending}
              onClick={() => setIsOpen(false)}
            />
            <section className="relative flex h-full w-full max-w-2xl flex-col border-l border-border-subtle bg-background shadow-2xl">
              <header className="flex h-16 shrink-0 items-center justify-between border-b border-border-subtle px-5">
                <div>
                  <h2
                    id="focus-manager-title"
                    className="font-display text-headline-md font-semibold"
                  >
                    Manage {area.label}
                  </h2>
                  <p
                    id="focus-manager-description"
                    className="text-metadata text-on-surface-variant"
                  >
                    Changes are saved to this local workspace.
                  </p>
                </div>
                <button
                  ref={closeButtonRef}
                  type="button"
                  className="rounded border border-border-subtle p-2 text-on-surface-variant hover:text-primary disabled:opacity-45"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close focus manager"
                  disabled={pending}
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-7 overflow-y-auto p-5">
                <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                  {pending ? "Saving focus changes." : ""}
                </div>
                {error ? (
                  <div
                    role="alert"
                    className="rounded border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200"
                  >
                    {error}
                  </div>
                ) : null}

                <section>
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <span className="text-label-caps uppercase text-on-surface-variant">
                        Ordered focus
                      </span>
                      <h3 className="mt-1 font-display text-headline-sm text-on-surface">
                        Now and next
                      </h3>
                    </div>
                    <span className="font-mono text-code-sm text-on-surface-variant">
                      {orderedRecords.length} item{orderedRecords.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
                    {orderedRecords.length ? (
                      orderedRecords.map((record, index) => (
                        <ManagedRecord
                          key={record.id}
                          record={record}
                          index={index}
                          count={orderedRecords.length}
                          pending={pending}
                          onMakeCurrent={() =>
                            void submit({
                              action: "make-current",
                              areaId: area.id,
                              recordId: record.id,
                            })
                          }
                          onMove={(direction) =>
                            void submit({
                              action: "move",
                              areaId: area.id,
                              recordId: record.id,
                              direction,
                            })
                          }
                          onRemove={() =>
                            void submit({ action: "remove", areaId: area.id, recordId: record.id })
                          }
                        />
                      ))
                    ) : (
                      <p className="px-5 py-6 text-body-md text-on-surface-variant">
                        Add a project, note, or task to make it your current focus.
                      </p>
                    )}
                  </div>
                </section>

                {unscheduledRecords.length ? (
                  <section>
                    <span className="text-label-caps uppercase text-on-surface-variant">
                      Linked, not scheduled
                    </span>
                    <div className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
                      {unscheduledRecords.map((record) => (
                        <div key={record.id} className="flex items-center gap-3 px-4 py-3">
                          <RecordIcon record={record} />
                          <span className="min-w-0 flex-1 truncate text-body-md font-semibold text-on-surface">
                            {record.title}
                          </span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void submit({
                                action: "make-current",
                                areaId: area.id,
                                recordId: record.id,
                              })
                            }
                            className="rounded border border-border-subtle px-3 py-1.5 text-metadata font-semibold text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-45"
                          >
                            Add to focus
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section>
                  <span className="text-label-caps uppercase text-on-surface-variant">
                    Add a task
                  </span>
                  <form onSubmit={submitTask} className="mt-3 flex gap-2">
                    <input
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      maxLength={240}
                      placeholder="e.g. Draft the next lesson"
                      aria-label="New focus task"
                      className="min-w-0 flex-1 rounded border border-border-subtle bg-surface px-3 py-2 text-body-md text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
                    />
                    <button
                      type="submit"
                      disabled={!taskTitle.trim() || pending}
                      className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-body-md font-semibold text-on-primary disabled:opacity-45"
                    >
                      {pending ? (
                        <LoaderCircle className="animate-spin" size={16} />
                      ) : (
                        <Plus size={16} />
                      )}
                      Add task
                    </button>
                  </form>
                </section>

                <section>
                  <label
                    htmlFor="focus-record-search"
                    className="text-label-caps uppercase text-on-surface-variant"
                  >
                    Add a project or note
                  </label>
                  <input
                    id="focus-record-search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search this workspace"
                    className="mt-3 w-full rounded border border-border-subtle bg-surface px-3 py-2 text-body-md text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
                  />
                  <div className="mt-3 divide-y divide-border-subtle rounded-xl border border-border-subtle bg-surface">
                    {candidates.length ? (
                      candidates.map((record) => (
                        <div key={record.id} className="flex items-center gap-3 px-4 py-3">
                          <RecordIcon record={record} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-body-md font-semibold text-on-surface">
                              {record.title}
                            </span>
                            <span className="block truncate text-metadata text-on-surface-variant">
                              {record.metadata}
                            </span>
                          </span>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void submit({
                                action: "add-record",
                                areaId: area.id,
                                recordId: record.id,
                              })
                            }
                            className="rounded border border-border-subtle px-3 py-1.5 text-metadata font-semibold text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-45"
                          >
                            Add
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="px-5 py-6 text-body-md text-on-surface-variant">
                        {normalizedQuery
                          ? "No available records match that search."
                          : "Everything available is already linked here."}
                      </p>
                    )}
                  </div>
                </section>
              </div>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

function ManagedRecord({
  record,
  index,
  count,
  pending,
  onMakeCurrent,
  onMove,
  onRemove,
}: {
  record: AreaRecord;
  index: number;
  count: number;
  pending: boolean;
  onMakeCurrent: () => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className="font-mono text-code-sm text-on-surface-variant">{index + 1}</span>
      <RecordIcon record={record} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body-md font-semibold text-on-surface">
          {record.title}
        </span>
        <span className="block truncate text-metadata text-on-surface-variant">
          {record.metadata}
        </span>
      </span>
      <div className="flex items-center gap-1">
        {index > 0 ? (
          <button
            type="button"
            onClick={onMakeCurrent}
            disabled={pending}
            className="rounded p-2 text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-45"
            aria-label={`Make ${record.title} current`}
            title="Make current"
          >
            <Target size={16} aria-hidden="true" />
          </button>
        ) : (
          <span
            className="rounded p-2 text-primary"
            aria-label="Current focus"
            title="Current focus"
          >
            <Check size={16} aria-hidden="true" />
          </span>
        )}
        <button
          type="button"
          onClick={() => onMove("up")}
          disabled={pending || index === 0}
          className="rounded p-2 text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-35"
          aria-label={`Move ${record.title} up`}
        >
          <ArrowUp size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onMove("down")}
          disabled={pending || index === count - 1}
          className="rounded p-2 text-on-surface-variant hover:bg-surface-container hover:text-primary disabled:opacity-35"
          aria-label={`Move ${record.title} down`}
        >
          <ArrowDown size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={pending}
          className="rounded p-2 text-on-surface-variant hover:bg-red-950/30 hover:text-red-300 disabled:opacity-45"
          aria-label={`Remove ${record.title} from focus`}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function RecordIcon({ record }: { record: AreaRecord }) {
  const Icon = record.kind === "project" ? CircleDot : record.kind === "task" ? Target : FileText;
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-surface-container text-on-surface-variant">
      <Icon size={16} aria-hidden="true" />
    </span>
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Focus update failed.";
}
