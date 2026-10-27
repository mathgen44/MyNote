import { useState } from "react";
import { createPage, movePage, remove, update, useWorkspace } from "../lib/store";
import { search, useIndexVersion } from "../lib/search";
import type { Layout } from "../lib/pageDoc";
import { confirmAction, openMenu } from "./overlays";

interface Props {
  sectionId?: string;
  pageId?: string;
  query: string;
  onSelectPage: (pageId: string) => void;
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Colonne du milieu : pages de la section, ou résultats de recherche. */
export function PageList({ sectionId, pageId, query, onSelectPage }: Props) {
  const { sections, pages: allPages } = useWorkspace();
  useIndexVersion();
  const [dragOver, setDragOver] = useState<string>();

  if (query.trim()) {
    const results = search(query);
    return (
      <aside className="page-list">
        <div className="page-list-header">Résultats ({results.length})</div>
        <div className="page-list-scroll">
          {results.map((r) => {
            const page = allPages.find((p) => p.id === r.id);
            const section = sections.find((s) => s.id === page?.sectionId);
            return (
              <div key={r.id} className={"page-item result" + (r.id === pageId ? " active" : "")} onClick={() => onSelectPage(r.id)}>
                <div className="page-title">{r.title}</div>
                {section && <div className="result-section" style={{ color: section.color }}>{section.name}</div>}
                {r.snippet && <div className="result-snippet">{r.snippet}</div>}
              </div>
            );
          })}
          {results.length === 0 && <p className="empty-hint">Aucun résultat.</p>}
        </div>
      </aside>
    );
  }

  const section = sections.find((s) => s.id === sectionId);
  if (!section) return <aside className="page-list" />;
  const pages = allPages.filter((p) => p.sectionId === section.id);

  const add = (opts?: { afterId?: string; level?: number; layout?: Layout }) => onSelectPage(createPage(section.id, opts));

  return (
    <aside className="page-list" style={{ ["--section-color" as string]: section.color }}>
      <div className="page-list-header">
        <span>{section.name}</span>
        <button
          className="icon-button"
          title="Ajouter une page"
          onClick={(e) =>
            openMenu(e, [
              { label: "Page (Ctrl+N)", action: () => add() },
              { label: "Page libre (canvas)", action: () => add({ layout: "canvas" }) },
            ])
          }
        >
          +
        </button>
      </div>
      <div
        className="page-list-scroll"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const id = e.dataTransfer.getData("application/x-mynote-page");
          if (id) movePage(id, section.id);
          setDragOver(undefined);
        }}
      >
        {pages.map((p) => (
          <div
            key={p.id}
            draggable
            className={"page-item" + (p.id === pageId ? " active" : "") + (dragOver === p.id ? " drop-before" : "")}
            style={{ paddingLeft: 14 + p.level * 18 }}
            onClick={() => onSelectPage(p.id)}
            onDragStart={(e) => e.dataTransfer.setData("application/x-mynote-page", p.id)}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(p.id);
            }}
            onDragLeave={() => setDragOver(undefined)}
            onDrop={(e) => {
              e.stopPropagation();
              setDragOver(undefined);
              const id = e.dataTransfer.getData("application/x-mynote-page");
              if (id && id !== p.id) movePage(id, section.id, p.id);
            }}
            onContextMenu={(e) =>
              openMenu(e, [
                { label: "Nouvelle page en dessous", action: () => add({ afterId: p.id, level: p.level, layout: p.layout }) },
                { label: "Nouvelle sous-page", action: () => add({ afterId: p.id, level: Math.min(2, p.level + 1), layout: p.layout }) },
                "separator",
                { label: "Augmenter le retrait", disabled: p.level >= 2, action: () => update("pages", p.id, { level: p.level + 1 }) },
                { label: "Diminuer le retrait", disabled: p.level <= 0, action: () => update("pages", p.id, { level: p.level - 1 }) },
                "separator",
                {
                  label: "Supprimer la page",
                  danger: true,
                  action: async () => {
                    if (await confirmAction("Supprimer la page", `Supprimer « ${p.title || "Sans titre"} » ?`)) remove("pages", p.id);
                  },
                },
              ])
            }
          >
            <div className="page-title">{p.title || "Sans titre"}</div>
            <div className="page-date">
              {dateFmt.format(p.updated)}
              {p.layout === "canvas" && " · page libre"}
            </div>
          </div>
        ))}
        {pages.length === 0 && (
          <button className="link-button" onClick={() => add()}>
            + Ajouter une page
          </button>
        )}
      </div>
    </aside>
  );
}
