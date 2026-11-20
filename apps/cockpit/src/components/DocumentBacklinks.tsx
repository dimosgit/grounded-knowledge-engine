import { useMemo } from "react";
import { buildBacklinks } from "../domain/graph";

/** "Linked from" list: notes whose Markdown or wiki-links point at this one. */
export function DocumentBacklinks({ activePath, docs, onOpenDoc }) {
  const backlinks = useMemo(() => buildBacklinks(activePath, docs), [activePath, docs]);
  if (!backlinks.length) return null;

  return (
    <section className="doc-backlinks" aria-labelledby="doc-backlinks-title">
      <h2 id="doc-backlinks-title">Linked from</h2>
      <ul>
        {backlinks.map((doc) => (
          <li key={doc.path}>
            <button
              type="button"
              className="doc-backlinks-item"
              onClick={() => onOpenDoc(doc.path, { sourcePath: activePath })}
            >
              <span className="doc-backlinks-title">{doc.title}</span>
              <span className="doc-backlinks-path">{doc.path}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
