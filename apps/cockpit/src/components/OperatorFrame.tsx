import { useEffect, useState } from "react";
import {
  Archive,
  BookOpen,
  Grid2X2,
  HelpCircle,
  History,
  LayoutDashboard,
  Menu,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Rocket,
  Search,
  Settings,
  UserCircle,
  X,
} from "lucide-react";
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
    { key: "graph", label: "Context Graph", icon: Network, onClick: onGraph },
    { key: "settings", label: "Settings", icon: Settings, disabled: true },
  ];

  function runNavAction(action) {
    setIsMobileNavOpen(false);
    action?.();
  }

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {commandBar}
      {isMobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setIsMobileNavOpen(false)}
          aria-label="Close side menu"
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[300px] flex-col border-r border-border-subtle bg-surface-sidebar px-4 py-6 shadow-2xl shadow-black/40 transition-transform duration-200 md:hidden ${
          isMobileNavOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!isMobileNavOpen}
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
            <div className="font-display text-headline-sm font-semibold">Operator Cockpit</div>
            <div className="text-metadata text-on-surface-variant">Technical Lead</div>
          </div>
        </button>
        <button
          type="button"
          className="absolute right-4 top-6 flex h-9 w-9 items-center justify-center rounded border border-border-subtle bg-surface-container text-on-surface-variant hover:border-primary hover:text-primary"
          onClick={() => setIsMobileNavOpen(false)}
          aria-label="Close side menu"
        >
          <X size={18} />
        </button>

        <button
          className="mb-8 flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2 text-label-caps font-semibold uppercase text-on-primary opacity-70"
          type="button"
          disabled
        >
          <Plus size={16} />
          New Document
        </button>

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
                } ${item.disabled ? "cursor-not-allowed opacity-45" : ""}`}
                onClick={() => runNavAction(item.onClick)}
                disabled={item.disabled}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="shrink-0" size={20} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="mt-auto flex flex-col gap-1 border-t border-border-subtle pt-4">
          <button
            className="flex cursor-not-allowed items-center gap-3 rounded px-3 py-3 text-on-surface-variant opacity-45"
            disabled
            type="button"
          >
            <HelpCircle size={20} />
            Support
          </button>
          <button
            className="flex cursor-not-allowed items-center gap-3 rounded px-3 py-3 text-on-surface-variant opacity-45"
            disabled
            type="button"
          >
            <Archive size={20} />
            Archive
          </button>
        </div>
      </aside>
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
              <div className="text-metadata text-on-surface-variant">Technical Lead</div>
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

        <button
          className={`mb-8 flex w-full items-center justify-center gap-2 rounded bg-primary text-label-caps font-semibold uppercase text-on-primary opacity-70 ${
            isNavCollapsed ? "h-10 px-0 py-0" : "px-4 py-2"
          }`}
          type="button"
          disabled
          title="New Document"
        >
          <Plus size={16} />
          <span className={isNavCollapsed ? "sr-only" : ""}>New Document</span>
        </button>

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
                } ${isNavCollapsed ? "h-11 justify-center px-0" : "gap-3 px-3 py-2"} ${item.disabled ? "cursor-not-allowed opacity-45" : ""}`}
                onClick={() => runNavAction(item.onClick)}
                disabled={item.disabled}
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

        <div className="mt-auto flex flex-col gap-1 border-t border-border-subtle pt-4">
          <button
            className={`flex cursor-not-allowed items-center rounded text-on-surface-variant opacity-45 ${
              isNavCollapsed ? "h-11 justify-center px-0" : "gap-3 px-3 py-2"
            }`}
            disabled
            type="button"
            aria-label="Support"
            title="Support"
          >
            <HelpCircle size={20} />
            <span className={isNavCollapsed ? "sr-only" : ""}>Support</span>
          </button>
          <button
            className={`flex cursor-not-allowed items-center rounded text-on-surface-variant opacity-45 ${
              isNavCollapsed ? "h-11 justify-center px-0" : "gap-3 px-3 py-2"
            }`}
            disabled
            type="button"
            aria-label="Archive"
            title="Archive"
          >
            <Archive size={20} />
            <span className={isNavCollapsed ? "sr-only" : ""}>Archive</span>
          </button>
        </div>
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
          <div className="mx-6 hidden shrink-0 items-center gap-5 text-label-caps uppercase text-on-surface-variant lg:flex">
            <button type="button" className="hover:text-primary">
              Recent
            </button>
            <button type="button" className="cursor-not-allowed opacity-45" disabled>
              Pinned
            </button>
            <button type="button" className="cursor-not-allowed opacity-45" disabled>
              Shared
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-primary">
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
            <History size={20} className="hidden shrink-0 md:block" />
            <UserCircle size={22} className="shrink-0" />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
