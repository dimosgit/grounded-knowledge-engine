import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  BookOpen,
  Database,
  Grid2X2,
  LayoutDashboard,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Scale,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useModalSurface } from "../hooks/useModalSurface";
import { OperatorActions } from "./OperatorActions";

export function OperatorFrame({
  activeView,
  title,
  children,
  commandBar,
  onCommand,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  askProjectId = undefined,
  askProjectTitle = undefined,
}) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const mobileNavCloseRef = useRef<HTMLButtonElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const mobileNavModalRef = useModalSurface<HTMLDivElement>({
    isOpen: isMobileNavOpen,
    onClose: () => setIsMobileNavOpen(false),
    initialFocusRef: mobileNavCloseRef,
  });
  const [isNavCollapsed, setIsNavCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage?.getItem("operator-nav-collapsed") === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage?.setItem("operator-nav-collapsed", String(isNavCollapsed));
    } catch {
      // The visual state still works when storage is blocked.
    }
  }, [isNavCollapsed]);

  const navItems = [
    { key: "hub", label: "Mission Control", icon: LayoutDashboard, onClick: onHub },
    { key: "library", label: "Knowledge Base", icon: BookOpen, onClick: onLibrary },
    { key: "projects", label: "Project Board", icon: Grid2X2, onClick: onProjects },
    {
      key: "decisions",
      label: "Decision Replay",
      icon: Scale,
      onClick: () => {
        window.location.hash = "/decisions";
      },
    },
    { key: "graph", label: "Context Graph", icon: Network, onClick: onGraph },
  ];

  function runNavAction(action) {
    setIsMobileNavOpen(false);
    action?.();
  }

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {commandBar}
      {typeof document !== "undefined" &&
        isMobileNavOpen &&
        createPortal(
          <motion.div
            ref={mobileNavModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-operator-navigation-title"
            aria-describedby="mobile-operator-navigation-description"
            tabIndex={-1}
            className="fixed inset-0 z-40 md:hidden"
            initial={shouldReduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
          >
            <h2 id="mobile-operator-navigation-title" className="sr-only">
              Operator navigation
            </h2>
            <p id="mobile-operator-navigation-description" className="sr-only">
              Choose an Operator Cockpit view or close the navigation menu.
            </p>
            <button
              type="button"
              className="fixed inset-0 bg-black/60"
              aria-hidden="true"
              tabIndex={-1}
              onClick={() => setIsMobileNavOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col border-r border-border-subtle bg-surface-sidebar px-4 py-6 shadow-2xl shadow-black/40"
              initial={shouldReduceMotion ? false : { x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.18 }}
            >
              <button
                type="button"
                className="mb-8 flex w-full items-center gap-3 rounded px-2 py-1 pr-12 text-left transition hover:bg-surface-container-high"
                onClick={() => runNavAction(onHub)}
                aria-label="Go to Mission Control"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary-container text-on-primary-container">
                  <Rocket size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-display text-headline-sm font-semibold">
                    Operator Cockpit
                  </div>
                  <div className="text-metadata text-on-surface-variant">
                    Inspect · review · understand
                  </div>
                </div>
              </button>
              <button
                ref={mobileNavCloseRef}
                type="button"
                className="absolute right-4 top-6 flex h-9 w-9 items-center justify-center rounded border border-border-subtle bg-surface-container text-on-surface-variant hover:border-primary hover:text-primary"
                onClick={() => setIsMobileNavOpen(false)}
                aria-label="Close side menu"
              >
                <X size={18} />
              </button>

              <WorkspaceStatus />

              <nav className="flex flex-1 flex-col gap-1" aria-label="Mobile operator views">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.key === activeView || (item.key === "library" && activeView === "doc");
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`flex items-center gap-3 rounded px-3 py-3 text-left text-body-md transition ${
                        isActive
                          ? "bg-surface-container-high text-primary"
                          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                      }`}
                      onClick={() => runNavAction(item.onClick)}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className="shrink-0" size={20} />
                      {item.label}
                    </button>
                  );
                })}
              </nav>

              <div className="mt-auto border-t border-border-subtle pt-4">
                <p className="px-3 text-metadata text-on-surface-variant">
                  Local-first · provider-neutral
                </p>
              </div>
            </motion.aside>
          </motion.div>,
          document.body,
        )}
      <aside
        className={`fixed left-0 top-0 z-40 hidden h-full flex-col border-r border-border-subtle bg-surface-sidebar py-6 transition-all duration-200 md:flex ${
          isNavCollapsed ? "w-[88px] px-3" : "w-[280px] px-4"
        }`}
      >
        <div
          className={`mb-8 flex gap-3 ${isNavCollapsed ? "flex-col items-center px-0" : "items-center px-2"}`}
        >
          <button
            type="button"
            className={`flex items-center gap-3 rounded py-1 text-left transition hover:bg-surface-container-high ${
              isNavCollapsed ? "h-10 w-10 justify-center px-0" : "min-w-0 flex-1 px-1"
            }`}
            onClick={() => runNavAction(onHub)}
            aria-label="Go to Mission Control"
            title="Go to Mission Control"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary-container text-on-primary-container">
              <Rocket size={18} />
            </div>
            <div className={isNavCollapsed ? "hidden" : ""}>
              <div className="font-display text-headline-sm font-semibold">Operator Cockpit</div>
              <div className="text-metadata text-on-surface-variant">
                Inspect · review · understand
              </div>
            </div>
          </button>
          <button
            type="button"
            className={`flex h-8 w-8 items-center justify-center rounded border border-border-subtle bg-surface-container text-on-surface-variant hover:border-primary hover:text-primary ${
              isNavCollapsed ? "" : "ml-auto"
            }`}
            onClick={() => setIsNavCollapsed((value) => !value)}
            aria-label={isNavCollapsed ? "Expand side menu" : "Collapse side menu"}
            title={isNavCollapsed ? "Expand side menu" : "Collapse side menu"}
          >
            {isNavCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>

        <WorkspaceStatus collapsed={isNavCollapsed} />

        <nav className="flex flex-1 flex-col gap-1" aria-label="Operator views">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.key === activeView || (item.key === "library" && activeView === "doc");
            return (
              <button
                key={item.key}
                type="button"
                className={`flex items-center rounded text-left text-body-md transition ${
                  isActive
                    ? "bg-surface-container-high text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                } ${isNavCollapsed ? "h-11 justify-center px-0" : "gap-3 px-3 py-2"}`}
                onClick={() => runNavAction(item.onClick)}
                aria-current={isActive ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
              >
                <Icon className="shrink-0" size={20} />
                <span className={isNavCollapsed ? "sr-only" : ""}>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {!isNavCollapsed && (
          <p className="mt-auto border-t border-border-subtle px-3 pt-4 text-metadata text-on-surface-variant">
            Local-first · provider-neutral
          </p>
        )}
      </aside>

      <main
        className={`min-h-screen transition-[margin] duration-200 ${isNavCollapsed ? "md:ml-[88px]" : "md:ml-[280px]"}`}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border-subtle bg-background/90 px-4 backdrop-blur md:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              type="button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded border border-border-subtle bg-surface-container text-on-surface-variant hover:border-primary hover:text-primary md:hidden"
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Open side menu"
            >
              <Menu size={19} />
            </button>
            <div className="truncate font-display text-headline-md font-semibold text-on-background">
              {title}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-primary">
            <div className="hidden items-center gap-2 rounded-full border border-status-done/30 bg-status-done/10 px-3 py-1.5 text-metadata font-semibold text-status-done lg:flex">
              <ShieldCheck size={14} />
              Local engine
            </div>
            {import.meta.env.DEV && (
              <OperatorActions projectId={askProjectId} projectTitle={askProjectTitle} />
            )}
            <button
              type="button"
              onClick={onCommand}
              className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded border border-border-subtle bg-surface-container px-3 py-2 text-on-surface-variant hover:border-primary hover:text-primary"
              aria-label="Quick Search"
            >
              <Search size={16} className="shrink-0" />
              <span className="hidden text-body-md md:inline">Quick Search</span>
              <span className="hidden rounded border border-border-subtle bg-surface-container-high px-1.5 py-0.5 font-mono text-[11px] lg:inline-block">
                ⌘ K
              </span>
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function WorkspaceStatus({ collapsed = false }: { collapsed?: boolean }) {
  const isDemo = import.meta.env.PROD;
  const label = isDemo ? "Demo workspace" : "Local workspace";
  const policy = isDemo ? "Read-only preview" : "Workspace policy active";

  return (
    <div
      className={`mb-6 rounded-lg border border-primary/20 bg-primary-container/10 ${
        collapsed ? "flex h-12 items-center justify-center px-0" : "p-3"
      }`}
      title={`${label} · ${policy}`}
      aria-label={`${label}: ${policy}`}
    >
      {collapsed ? (
        <Database size={19} className="text-primary" />
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-primary-container/20 text-primary">
            <Database size={17} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-body-md font-semibold text-on-surface">{label}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-metadata text-status-done">
              <span className="h-1.5 w-1.5 rounded-full bg-status-done" />
              {policy}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
