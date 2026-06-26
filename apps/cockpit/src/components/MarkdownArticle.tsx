import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { writeTextToClipboard } from "../utils/clipboard";

const TOC_MIN_HEADINGS = 4;
const TOC_MIN_WORDS = 380;
const WRAPPED_CODE_LANGUAGES = new Set(["text", "txt", "plain", "plaintext", "md", "markdown"]);
const MERMAID_CODE_LANGUAGES = new Set(["mermaid", "mmd"]);

function isExternalLink(href) {
  if (typeof href !== "string") return false;
  return /^https?:\/\//i.test(href);
}

function getSafeLinkHref(href) {
  if (typeof href !== "string") return "";
  const trimmed = href.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    /^https?:\/\//i.test(trimmed) ||
    /^mailto:/i.test(trimmed)
  ) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return "";
  return trimmed;
}

function cleanHeadingText(value) {
  if (!value) return "";
  return value
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[*_~]/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .trim();
}

function toHeadingSlug(value) {
  const normalized = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "section";
}

function getWordCount(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
}

function flattenNodeText(node) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => flattenNodeText(item)).join("");
  }
  if (node && typeof node === "object" && node.props) {
    return flattenNodeText(node.props.children);
  }
  return "";
}

function getHeadingLabelFromElement(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone.querySelectorAll(".markdown-heading-anchor").forEach((anchor) => anchor.remove());
  return (clone.textContent || "").trim();
}

function extractTextFromNode(node) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractTextFromNode(item)).join("");
  }
  if (node && typeof node === "object" && node.props) {
    return extractTextFromNode(node.props.children);
  }
  return "";
}

function getCodeLanguage(children) {
  const firstChild = Array.isArray(children) ? children[0] : children;
  const className = firstChild?.props?.className || "";
  const match = /language-([a-z0-9_-]+)/i.exec(className);
  return match ? match[1].toLowerCase() : "";
}

function CopyablePre({ children, forceWrap = false, ...props }) {
  const [copyState, setCopyState] = useState("idle");
  const codeValue = useMemo(() => extractTextFromNode(children).replace(/\n$/, ""), [children]);
  const shouldWrap = useMemo(() => {
    if (forceWrap) return true;
    const language = getCodeLanguage(children);
    if (!language) return false;
    return WRAPPED_CODE_LANGUAGES.has(language);
  }, [children, forceWrap]);

  useEffect(() => {
    if (copyState === "idle") return undefined;
    const resetTimer = window.setTimeout(() => setCopyState("idle"), 1600);
    return () => window.clearTimeout(resetTimer);
  }, [copyState]);

  async function handleCopy() {
    if (!codeValue) return;
    try {
      const copied = await writeTextToClipboard(codeValue);
      setCopyState(copied ? "copied" : "failed");
    } catch {
      setCopyState("failed");
    }
  }

  const buttonLabel = copyState === "copied" ? "Copied" : copyState === "failed" ? "Retry" : "Copy";

  return (
    <div className={`markdown-code-block${shouldWrap ? " is-wrapped" : ""}`}>
      <button
        type="button"
        className="markdown-copy-btn"
        onClick={handleCopy}
        aria-label="Copy code block"
        disabled={!codeValue}
      >
        {buttonLabel}
      </button>
      <pre {...props}>{children}</pre>
    </div>
  );
}

function MermaidDiagram({ chart }) {
  const diagramRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function renderChart() {
      if (!diagramRef.current) return;
      diagramRef.current.innerHTML = "";
      setError("");

      try {
        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default;
        const renderId = `markdown-mermaid-${Math.random().toString(36).slice(2, 10)}`;

        mermaid.initialize({
          startOnLoad: false,
          theme: "neutral",
          securityLevel: "strict",
          suppressErrorRendering: true,
        });

        const { svg, bindFunctions } = await mermaid.render(renderId, chart);
        if (cancelled || !diagramRef.current) return;

        diagramRef.current.innerHTML = svg;
        if (typeof bindFunctions === "function") {
          bindFunctions(diagramRef.current);
        }
      } catch (cause) {
        if (cancelled) return;
        const message =
          cause instanceof Error && cause.message ? cause.message : "Unknown rendering error.";
        setError(message);
      }
    }

    renderChart();
    return () => {
      cancelled = true;
      if (diagramRef.current) {
        diagramRef.current.innerHTML = "";
      }
    };
  }, [chart]);

  if (error) {
    return (
      <div className="markdown-mermaid-block">
        <p className="markdown-mermaid-error">Mermaid render failed: {error}</p>
        <CopyablePre>
          <code className="language-mermaid">{chart}</code>
        </CopyablePre>
      </div>
    );
  }

  return (
    <div className="markdown-mermaid-block">
      <div
        className="markdown-mermaid-diagram"
        ref={diagramRef}
        role="img"
        aria-label="Mermaid diagram"
      />
    </div>
  );
}

export default function MarkdownArticle({
  activePath,
  content,
  docs,
  onOpenDoc,
  resolveMarkdownDocPath,
  resolveMarkdownAssetPath,
  suppressTopLevelTitle = false,
}) {
  const articleContentRef = useRef(null);
  const headingElementMapRef = useRef(new Map());
  const [tocHeadings, setTocHeadings] = useState([]);
  const wordCount = useMemo(() => getWordCount(content), [content]);
  const forceWrapCodeBlocks = useMemo(
    () => /(^|\/)prompts\.md$/i.test(activePath || ""),
    [activePath],
  );
  const showToc =
    tocHeadings.length >= TOC_MIN_HEADINGS ||
    (tocHeadings.length >= 3 && wordCount >= TOC_MIN_WORDS);
  const [activeHeadingId, setActiveHeadingId] = useState(null);

  useEffect(() => {
    const contentRoot = articleContentRef.current;
    if (!contentRoot) {
      setTocHeadings([]);
      setActiveHeadingId(null);
      return;
    }

    const seenIds = {};
    const nextHeadingMap = new Map();
    const headings = [...contentRoot.querySelectorAll("h2, h3, h4")]
      .map((heading, index) => {
        const text = getHeadingLabelFromElement(heading);
        if (!text) return null;

        const preferred = (heading.getAttribute("id") || "").trim() || toHeadingSlug(text);
        const count = (seenIds[preferred] || 0) + 1;
        seenIds[preferred] = count;
        const id = count === 1 ? preferred : `${preferred}-${count}`;
        heading.setAttribute("id", id);
        nextHeadingMap.set(id, heading);

        return {
          id,
          text,
          level: Number(heading.tagName.slice(1)),
          order: index,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order)
      .map(({ id, text, level }) => ({ id, text, level }));

    headingElementMapRef.current = nextHeadingMap;
    setTocHeadings(headings);
    setActiveHeadingId(headings[0]?.id || null);
  }, [content]);

  function scrollToHeading(id) {
    if (!id) return;
    const target =
      headingElementMapRef.current.get(id) ||
      articleContentRef.current?.querySelector(`[id="${id}"]`) ||
      null;
    if (!target) return;

    const scrollRoot = articleContentRef.current?.closest(".markdown");
    if (scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight) {
      const offset = 92;
      const targetTop =
        target.getBoundingClientRect().top -
        scrollRoot.getBoundingClientRect().top +
        scrollRoot.scrollTop -
        offset;
      scrollRoot.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    } else {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    setActiveHeadingId(id);
  }

  useEffect(() => {
    if (!showToc) return undefined;
    const contentRoot = articleContentRef.current;
    if (!contentRoot) return undefined;

    const headingElements = tocHeadings
      .map((heading) => headingElementMapRef.current.get(heading.id))
      .filter(Boolean);
    if (!headingElements.length) return undefined;

    const scrollRoot = contentRoot.closest(".markdown");

    const getTop = (element) => {
      if (scrollRoot) {
        const elementTop = element.getBoundingClientRect().top;
        const rootTop = scrollRoot.getBoundingClientRect().top;
        return elementTop - rootTop + scrollRoot.scrollTop;
      }
      return element.getBoundingClientRect().top + window.scrollY;
    };

    const updateActiveHeading = () => {
      const currentOffset = scrollRoot ? scrollRoot.scrollTop + 120 : window.scrollY + 120;
      let currentId = tocHeadings[0].id;

      for (const element of headingElements) {
        if (getTop(element) <= currentOffset) {
          currentId = element.id;
        } else {
          break;
        }
      }

      setActiveHeadingId((previous) => (previous === currentId ? previous : currentId));
    };

    const eventTarget = scrollRoot || window;
    updateActiveHeading();
    eventTarget.addEventListener("scroll", updateActiveHeading, { passive: true });
    window.addEventListener("resize", updateActiveHeading);

    return () => {
      eventTarget.removeEventListener("scroll", updateActiveHeading);
      window.removeEventListener("resize", updateActiveHeading);
    };
  }, [showToc, tocHeadings]);

  const headingSlugCounts: Record<string, number> = {};
  function renderPre(props: any) {
    const language = getCodeLanguage(props.children);
    if (MERMAID_CODE_LANGUAGES.has(language)) {
      const source = extractTextFromNode(props.children).replace(/\n$/, "");
      return <MermaidDiagram chart={source} />;
    }
    return <CopyablePre forceWrap={forceWrapCodeBlocks} {...props} />;
  }

  function renderHeading(level: number, { children, ...props }: any) {
    const headingLabel = cleanHeadingText(flattenNodeText(children)) || `Section ${level}`;
    const base = toHeadingSlug(headingLabel);
    const count = (headingSlugCounts[base] || 0) + 1;
    headingSlugCounts[base] = count;
    const id = count === 1 ? base : `${base}-${count}`;
    const Tag = `h${level}` as any;

    if (level === 1 && suppressTopLevelTitle) return null;

    return (
      <Tag
        id={id}
        ref={(element) => {
          if (element) {
            headingElementMapRef.current.set(id, element);
          } else {
            headingElementMapRef.current.delete(id);
          }
        }}
        {...props}
      >
        {children}
        {level >= 2 ? (
          <a
            href={`#${id}`}
            className="markdown-heading-anchor"
            aria-label={`Jump to section ${headingLabel}`}
            onClick={(event) => {
              event.preventDefault();
              scrollToHeading(id);
            }}
          >
            #
          </a>
        ) : null}
      </Tag>
    );
  }

  function MarkdownImage({ src, alt, ...props }: any) {
    const [failed, setFailed] = useState(false);
    const resolvedSrc = resolveMarkdownAssetPath(activePath, src || "");
    const fallbackLabel = alt || src || "missing source";
    const showFallback = !resolvedSrc || failed;

    return (
      <span className={`markdown-image${showFallback ? " is-missing" : ""}`}>
        {!showFallback ? (
          <img
            src={resolvedSrc}
            alt={alt || ""}
            loading="lazy"
            onError={() => setFailed(true)}
            {...props}
          />
        ) : (
          <span className="markdown-image-fallback" role="note">
            <span role="img" aria-label={fallbackLabel}>
              Image unavailable: {fallbackLabel}
            </span>
          </span>
        )}
        {alt ? <span className="markdown-image-caption">{alt}</span> : null}
      </span>
    );
  }

  return (
    <div className="markdown-content" ref={articleContentRef}>
      {showToc ? (
        <nav className="markdown-toc" aria-label="On this page">
          <p className="markdown-toc-title">On this page</p>
          <ol className="markdown-toc-list">
            {tocHeadings.map((heading) => (
              <li key={heading.id} className="markdown-toc-item" data-level={heading.level}>
                <a
                  href={`#${heading.id}`}
                  className={`markdown-toc-link${activeHeadingId === heading.id ? " is-active" : ""}`}
                  onClick={(event) => {
                    event.preventDefault();
                    scrollToHeading(heading.id);
                  }}
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: renderPre,
          h1: (props) => renderHeading(1, props),
          h2: (props) => renderHeading(2, props),
          h3: (props) => renderHeading(3, props),
          h4: (props) => renderHeading(4, props),
          h5: (props) => renderHeading(5, props),
          h6: (props) => renderHeading(6, props),
          a: ({ href, children, ...props }) => {
            const safeHref = getSafeLinkHref(href);
            if (safeHref.startsWith("#")) {
              const targetId = safeHref.slice(1).trim();
              return (
                <a
                  href={safeHref}
                  onClick={(event) => {
                    if (!targetId) return;
                    event.preventDefault();
                    scrollToHeading(targetId);
                  }}
                  {...props}
                >
                  {children}
                </a>
              );
            }

            const resolvedPath = resolveMarkdownDocPath(activePath, href || "");
            const targetDoc = resolvedPath ? docs.find((doc) => doc.path === resolvedPath) : null;

            if (targetDoc) {
              return (
                <a
                  href={`#/doc/${encodeURIComponent(targetDoc.path)}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpenDoc(targetDoc.path, { sourcePath: activePath });
                  }}
                  {...props}
                >
                  {children}
                </a>
              );
            }

            if (!safeHref) {
              return <span {...props}>{children}</span>;
            }

            const external = isExternalLink(safeHref);
            return (
              <a
                href={safeHref}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer noopener" : undefined}
                {...props}
              >
                {children}
              </a>
            );
          },
          img: MarkdownImage,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
