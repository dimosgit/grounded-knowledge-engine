import { useEffect, useRef, type RefObject } from "react";

let nextModalId = 0;
let activeModal: ActiveModal | null = null;
let pendingRestoreTarget: HTMLElement | null = null;
let previousBodyOverflow: string | null = null;
const activeSurfaces = new Set<HTMLElement>();
const backgroundStates = new Map<HTMLElement, BackgroundState>();

interface ModalSurfaceOptions {
  isOpen: boolean;
  onClose: () => void;
  closeDisabled?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

interface BackgroundState {
  ariaHidden: string | null;
  hadInert: boolean;
}

interface ActiveModal {
  id: string;
  surface: HTMLElement;
  close: () => void;
  closeDisabled: () => boolean;
  restoreTarget: HTMLElement | null;
}

export function useModalSurface<T extends HTMLElement>({
  isOpen,
  onClose,
  closeDisabled = false,
  initialFocusRef,
}: ModalSurfaceOptions): RefObject<T | null> {
  const surfaceRef = useRef<T>(null);
  const modalIdRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  if (!modalIdRef.current) modalIdRef.current = `gke-modal-${++nextModalId}`;
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!isOpen || !surfaceRef.current) return;

    const surface = surfaceRef.current;
    const modalId = modalIdRef.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const registered = registerModal({
      id: modalId,
      surface,
      close: () => onCloseRef.current(),
      closeDisabled: () => closeDisabledRef.current,
      restoreTarget: opener,
    });
    if (!registered) return;

    const focusTarget =
      initialFocusRef?.current && surface.contains(initialFocusRef.current)
        ? initialFocusRef.current
        : getFocusableElements(surface)[0] || surface;
    focusTarget.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      trapFocus(event, surface);
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      const restoreTarget = unregisterModal(modalId, surface);
      if (restoreTarget && document.contains(restoreTarget)) restoreTarget.focus();
    };
  }, [initialFocusRef, isOpen]);

  return surfaceRef;
}

function registerModal(modal: ActiveModal): boolean {
  const incumbent = activeModal;
  if (incumbent && incumbent.id !== modal.id) {
    if (incumbent.closeDisabled()) {
      modal.close();
      return false;
    }
    incumbent.close();
    if (modal.restoreTarget && incumbent.surface.contains(modal.restoreTarget)) {
      modal.restoreTarget = incumbent.restoreTarget;
    }
  }

  activeModal = modal;
  pendingRestoreTarget = modal.restoreTarget;
  activateSurface(modal.surface);
  return true;
}

function unregisterModal(modalId: string, surface: HTMLElement): HTMLElement | null {
  if (activeModal?.id === modalId) activeModal = null;
  deactivateSurface(surface);
  if (activeSurfaces.size > 0) return null;

  const restoreTarget = pendingRestoreTarget;
  pendingRestoreTarget = null;
  return restoreTarget;
}

function activateSurface(surface: HTMLElement) {
  if (activeSurfaces.size === 0) previousBodyOverflow = document.body.style.overflow;
  activeSurfaces.add(surface);
  syncModalEnvironment();
}

function deactivateSurface(surface: HTMLElement) {
  activeSurfaces.delete(surface);
  if (activeSurfaces.size > 0) {
    syncModalEnvironment();
    return;
  }

  document.body.style.overflow = previousBodyOverflow ?? "";
  previousBodyOverflow = null;
  for (const [element, state] of backgroundStates) restoreBackgroundState(element, state);
  backgroundStates.clear();
}

function syncModalEnvironment() {
  document.body.style.overflow = "hidden";
  const bodyChildren = Array.from(document.body.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );

  for (const element of bodyChildren) {
    const ownsModal = Array.from(activeSurfaces).some(
      (surface) => element === surface || element.contains(surface),
    );
    if (ownsModal) {
      const state = backgroundStates.get(element);
      if (state) {
        restoreBackgroundState(element, state);
        backgroundStates.delete(element);
      }
      continue;
    }

    if (!backgroundStates.has(element)) {
      backgroundStates.set(element, {
        ariaHidden: element.getAttribute("aria-hidden"),
        hadInert: element.hasAttribute("inert"),
      });
    }
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  }
}

function restoreBackgroundState(element: HTMLElement, state: BackgroundState) {
  if (state.hadInert) element.setAttribute("inert", "");
  else element.removeAttribute("inert");

  if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", state.ariaHidden);
}

function trapFocus(event: KeyboardEvent, surface: HTMLElement) {
  const focusable = getFocusableElements(surface);
  if (!focusable.length) {
    event.preventDefault();
    surface.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !surface.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !surface.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function getFocusableElements(surface: HTMLElement): HTMLElement[] {
  const selector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "summary",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  return Array.from(surface.querySelectorAll<HTMLElement>(selector)).filter((element) => {
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[inert], [aria-hidden='true']")) return false;
    return element.tabIndex >= 0;
  });
}
