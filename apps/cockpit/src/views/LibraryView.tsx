import { Suspense, lazy } from "react";
import { Zap } from "lucide-react";
import { CommandBar } from "../components/CommandBar";
import { OperatorFrame } from "../components/OperatorFrame";

const MarkdownArticle = lazy(() => import("../components/MarkdownArticle"));

function QuickRecallCard({ quickRecall, digestQuickView }) {
  const atGlance = quickRecall?.atGlance?.length
    ? quickRecall.atGlance
    : digestQuickView?.weekAtGlance || [];
  const nextSteps = quickRecall?.nextSteps?.length
    ? quickRecall.nextSteps
    : digestQuickView?.nextSteps || [];

  if (!atGlance.length && !nextSteps.length) return null;

  const jumpToArticle = () => {
    document.querySelector(".markdown-content h2, .markdown-content h3")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <section className="digest-quickview" aria-label="Quick recall">
      <div className="quick-recall-heading">
        <span className="quick-recall-icon" aria-hidden="true">
          <Zap size={20} strokeWidth={2.4} />
        </span>
        <h2>Quick Recall</h2>
      </div>
      <div className="digest-quick-grid">
        <section className="digest-quick-card">
          <h3>At a glance</h3>
          {atGlance.length ? (
            <ul>
              {atGlance.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>No quick items found.</p>
          )}
        </section>
        <section className="digest-quick-card">
          <h3>Next starting point</h3>
          {nextSteps.length ? (
            <>
              <ul>
                {nextSteps.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
              <button className="quick-recall-jump" type="button" onClick={jumpToArticle}>
                Jump to section
              </button>
            </>
          ) : (
            <p>No next actions found.</p>
          )}
        </section>
      </div>
    </section>
  );
}

export function LibraryView({
  docs,
  commandBarOpen,
  onCommandBarOpenChange,
  onCommand,
  onCommandSelect,
  onHub,
  onLibrary,
  onProjects,
  onGraph,
  isReadingMode,
  onToggleReadingMode,
  displayTrackLabel,
  scopedDocs,
  curationStats,
  query,
  onQueryChange,
  activeTrack,
  onActiveTrackChange,
  trackFilterOptions,
  activeItemType,
  onActiveItemTypeChange,
  learningItemOrder,
  learningItemLabels,
  libraryItemCounts,
  visibleTags,
  activeTag,
  onActiveTagChange,
  tagLabels,
  tagCounts,
  hideMerged,
  onHideMergedChange,
  groupedDocs,
  filteredDocs,
  activeDoc,
  activeDocInFilter,
  activeDocMetrics,
  activeBreadcrumbs,
  activeModuleDoc,
  digestQuickView,
  quickRecall,
  readableDocContent,
  onOpenDoc,
  onRevealActiveDoc,
  renderHighlighted,
  getDocBadge,
  getDocGuidance,
  resolveMarkdownDocPath,
  resolveMarkdownAssetPath,
  currentYear,
}) {
  return (
    <OperatorFrame
      activeView="library"
      title="Knowledge Base"
      commandBar={
        <CommandBar
          items={docs}
          isOpen={commandBarOpen}
          onOpenChange={onCommandBarOpenChange}
          onSelect={onCommandSelect}
        />
      }
      onCommand={onCommand}
      onHub={onHub}
      onLibrary={onLibrary}
      onProjects={onProjects}
      onGraph={onGraph}
    >
      <div className={`app-shell cockpit-library${isReadingMode ? " reading-mode" : ""}`}>
        <aside className="sidebar">
          <header className="sidebar-header">
            <p className="overline">Knowledge Base</p>
            <h1>{displayTrackLabel} Learning Library</h1>
            <p className="meta">
              {scopedDocs.length} items in scope · {docs.length} indexed
            </p>
            <div className="hub-entry-row">
              <button className="hub-link-btn" onClick={onHub} type="button">
                Back to Learning Hub
              </button>
            </div>
            <div className="curation-card">
              <p>Curation Status</p>
              <div className="curation-stats">
                <span>
                  <em>Modules</em>
                  <strong>{curationStats.module}</strong>
                </span>
                <span>
                  <em>Clients</em>
                  <strong>{curationStats.client}</strong>
                </span>
                <span>
                  <em>Canonical</em>
                  <strong>{curationStats.canonical}</strong>
                </span>
                <span>
                  <em>Merged stubs</em>
                  <strong>{curationStats.merged}</strong>
                </span>
              </div>
            </div>
          </header>

          <label className="search-box" htmlFor="doc-search">
            <input
              id="doc-search"
              type="search"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Search all docs (modules, topics, terms, digests)..."
            />
          </label>

          <section className="filter-panel" aria-label="Library filters">
            <div className="filter-select-grid">
              <label className="filter-field" htmlFor="track-filter">
                <span>Track</span>
                <select
                  id="track-filter"
                  value={activeTrack}
                  onChange={(event) => onActiveTrackChange(event.target.value)}
                >
                  {trackFilterOptions.map((track) => (
                    <option key={track.key} value={track.key}>
                      {track.label} ({track.count})
                    </option>
                  ))}
                </select>
              </label>

              <label className="filter-field" htmlFor="learning-item-filter">
                <span>Learning Item</span>
                <select
                  id="learning-item-filter"
                  value={activeItemType}
                  onChange={(event) => onActiveItemTypeChange(event.target.value)}
                >
                  {learningItemOrder.map((itemType) => {
                    const count = libraryItemCounts[itemType] || 0;
                    return (
                      <option
                        key={itemType}
                        value={itemType}
                        disabled={itemType !== "all" && count === 0}
                      >
                        {learningItemLabels[itemType]} ({count})
                      </option>
                    );
                  })}
                </select>
              </label>
            </div>

            <div className="filter-panel-heading">
              <p>Document Type</p>
            </div>

            <div className="filter-bar" role="group" aria-label="Document filters">
              {visibleTags.map((tag) => {
                const isActive = activeTag === tag;
                return (
                  <button
                    key={tag}
                    className={`filter-chip${isActive ? " active" : ""}`}
                    onClick={() => onActiveTagChange(tag)}
                    aria-pressed={isActive}
                    type="button"
                  >
                    {tagLabels[tag]}
                    <span>{tagCounts[tag] || 0}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <label className="merge-toggle">
            <input
              type="checkbox"
              checked={hideMerged}
              onChange={(event) => onHideMergedChange(event.target.checked)}
            />
            Hide merged stubs (focus on canonical notes)
          </label>

          <nav className="doc-nav" aria-label="Markdown documents">
            {groupedDocs.map(([section, items]) => {
              return (
                <section key={section} className="doc-group">
                  <h2>{section}</h2>
                  {items.map((doc, index) => {
                    const isActive = activeDoc?.path === doc.path;
                    const showStatusBadge =
                      query.trim().length > 0 ||
                      (activeTag !== "modules" && activeTag !== "clients");
                    return (
                      <button
                        key={doc.path}
                        className={`doc-item${isActive ? " active" : ""}`}
                        onClick={() => onOpenDoc(doc.path)}
                        style={{ "--stagger-index": index } as any}
                        type="button"
                      >
                        <div className="doc-item-top">
                          <strong>{renderHighlighted(doc.title, query)}</strong>
                          {showStatusBadge && (
                            <em className={`doc-badge ${doc.docType}`}>
                              {getDocBadge(doc.docType)}
                            </em>
                          )}
                        </div>
                        <span>{renderHighlighted(doc.path, query)}</span>
                        <small>{renderHighlighted(doc.excerpt, query)}</small>
                      </button>
                    );
                  })}
                </section>
              );
            })}
            {!filteredDocs.length && (
              <section className="empty-filter">
                <h2>No matching files</h2>
                <p>Try a different search or filter.</p>
              </section>
            )}
          </nav>
        </aside>

        <section className="content">
          <div className="content-body">
            {activeDoc ? (
              <>
                <div className="content-header">
                  <div className="content-context">
                    <nav className="content-breadcrumbs" aria-label="Document hierarchy">
                      {activeBreadcrumbs.map((crumb, index) => {
                        const showSeparator = index < activeBreadcrumbs.length - 1;
                        return (
                          <span className="breadcrumb-item" key={crumb.key}>
                            {crumb.path && !crumb.current ? (
                              <button
                                className="breadcrumb-link"
                                onClick={() => onOpenDoc(crumb.path)}
                                type="button"
                              >
                                {crumb.label}
                              </button>
                            ) : (
                              <span
                                className={`breadcrumb-label${crumb.current ? " is-current" : ""}`}
                              >
                                {crumb.label}
                              </span>
                            )}
                            {showSeparator && (
                              <span className="breadcrumb-separator" aria-hidden="true">
                                /
                              </span>
                            )}
                          </span>
                        );
                      })}
                    </nav>
                    <div className="content-title-meta">
                      <p>Path: {activeDoc.path}</p>
                      <em className={`doc-badge ${activeDoc.docType}`}>
                        {getDocBadge(activeDoc.docType)}
                      </em>
                      <em className="doc-badge metric">{displayTrackLabel}</em>
                      {activeDocMetrics && (
                        <>
                          <em className="doc-badge metric">{activeDocMetrics.readMinutes} min</em>
                          <em className="doc-badge metric">{activeDocMetrics.headings} headings</em>
                          <em className="doc-badge metric">{activeDocMetrics.words} words</em>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="view-actions">
                    {activeModuleDoc && activeModuleDoc.path !== activeDoc.path && (
                      <button
                        className="action-btn"
                        onClick={() => onOpenDoc(activeModuleDoc.path)}
                        type="button"
                      >
                        Back to Module
                      </button>
                    )}
                    <button className="action-btn" onClick={onToggleReadingMode} type="button">
                      {isReadingMode ? "Exit Reading Mode" : "Reading Mode"}
                    </button>
                    <button className="action-btn" onClick={() => window.print()} type="button">
                      Export PDF
                    </button>
                  </div>
                </div>
                <article className="markdown">
                  <header className="reader-document-header">
                    <div className="reader-kicker">
                      <span>{activeDoc.docType}</span>
                      <span>{displayTrackLabel}</span>
                    </div>
                    <h1>{activeDoc.title}</h1>
                    <p>{getDocGuidance(activeDoc.docType)}</p>
                    <div className="reader-meta-row">
                      <em className={`doc-badge ${activeDoc.docType}`}>
                        {getDocBadge(activeDoc.docType)}
                      </em>
                      <em className="doc-badge metric">{displayTrackLabel}</em>
                      {activeDocMetrics && (
                        <>
                          <em className="doc-badge metric">
                            {activeDocMetrics.readMinutes} min read
                          </em>
                          <em className="doc-badge metric">{activeDocMetrics.headings} headings</em>
                          <em className="doc-badge metric">{activeDocMetrics.words} words</em>
                        </>
                      )}
                    </div>
                  </header>
                  {!activeDocInFilter && (
                    <div className="filter-warning">
                      <p>Current document is outside active filters.</p>
                      <button className="action-btn" onClick={onRevealActiveDoc} type="button">
                        Show Current Doc
                      </button>
                    </div>
                  )}
                  <QuickRecallCard quickRecall={quickRecall} digestQuickView={digestQuickView} />
                  <Suspense fallback={<p>Loading document renderer...</p>}>
                    <MarkdownArticle
                      activePath={activeDoc.path}
                      content={readableDocContent || activeDoc.content}
                      docs={docs}
                      onOpenDoc={onOpenDoc}
                      resolveMarkdownDocPath={resolveMarkdownDocPath}
                      resolveMarkdownAssetPath={resolveMarkdownAssetPath}
                      suppressTopLevelTitle
                    />
                  </Suspense>
                </article>
              </>
            ) : docs.length === 0 ? (
              <section className="empty-state">
                <h2>No Markdown files found</h2>
                <p>Expected Markdown files under kb/ (or readme.md) in the repository root.</p>
              </section>
            ) : (
              <section className="empty-state">
                <h2>No matching documents</h2>
                <p>Adjust search text or choose a different filter.</p>
              </section>
            )}
          </div>
          <footer className="app-footer">
            <p>Operator Cockpit · {currentYear} · a UI layer over the grounded knowledge engine.</p>
          </footer>
        </section>
      </div>
    </OperatorFrame>
  );
}
