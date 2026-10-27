import { useState } from "react";
import {
  SECTION_COLORS,
  createNotebook,
  createSection,
  movePage,
  remove,
  update,
  useWorkspace,
} from "../lib/store";
import { askText, confirmAction, openMenu } from "./overlays";

interface Props {
  notebookId?: string;
  sectionId?: string;
  onSelectSection: (notebookId: string, sectionId?: string) => void;
}

/** Colonne de gauche : carnets et leurs sections. */
export function Sidebar({ notebookId, sectionId, onSelectSection }: Props) {
  const { notebooks, sections } = useWorkspace();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string>();

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const addNotebook = async () => {
    const name = await askText("Nouveau carnet", "", "Nom du carnet");
    if (!name?.trim()) return;
    const ids = createNotebook(name.trim());
    onSelectSection(ids.notebookId, ids.sectionId);
  };

  const addSection = async (nbId: string) => {
    const name = await askText("Nouvelle section", "", "Nom de la section");
    if (!name?.trim()) return;
    onSelectSection(nbId, createSection(nbId, name.trim()));
  };

  return (
    <nav className="sidebar">
      <div className="sidebar-scroll">
        {notebooks.map((nb) => {
          const open = !collapsed.has(nb.id);
          return (
            <div key={nb.id} className="notebook">
              <div
                className={"notebook-header" + (nb.id === notebookId ? " active" : "")}
                onClick={() => toggle(nb.id)}
                onContextMenu={(e) =>
                  openMenu(e, [
                    { label: "Nouvelle section", action: () => addSection(nb.id) },
                    {
                      label: "Renommer le carnet",
                      action: async () => {
                        const name = await askText("Renommer le carnet", nb.name);
                        if (name?.trim()) update("notebooks", nb.id, { name: name.trim() });
                      },
                    },
                    { colors: SECTION_COLORS, current: nb.color, pick: (color) => update("notebooks", nb.id, { color }) },
                    "separator",
                    {
                      label: "Supprimer le carnet",
                      danger: true,
                      action: async () => {
                        if (await confirmAction("Supprimer le carnet", `Supprimer « ${nb.name} » et tout son contenu ?`))
                          remove("notebooks", nb.id);
                      },
                    },
                  ])
                }
              >
                <span className={"chevron" + (open ? " open" : "")}>›</span>
                <span className="notebook-icon" style={{ background: nb.color }} />
                <span className="label">{nb.name}</span>
              </div>
              {open && (
                <div className="sections">
                  {sections
                    .filter((s) => s.notebookId === nb.id)
                    .map((s) => (
                      <div
                        key={s.id}
                        className={
                          "section-item" + (s.id === sectionId ? " active" : "") + (dropTarget === s.id ? " drop" : "")
                        }
                        style={{ ["--section-color" as string]: s.color }}
                        onClick={() => onSelectSection(nb.id, s.id)}
                        onDragOver={(e) => {
                          if (!e.dataTransfer.types.includes("application/x-mynote-page")) return;
                          e.preventDefault();
                          setDropTarget(s.id);
                        }}
                        onDragLeave={() => setDropTarget(undefined)}
                        onDrop={(e) => {
                          setDropTarget(undefined);
                          const pageId = e.dataTransfer.getData("application/x-mynote-page");
                          if (pageId) movePage(pageId, s.id);
                        }}
                        onContextMenu={(e) =>
                          openMenu(e, [
                            {
                              label: "Renommer la section",
                              action: async () => {
                                const name = await askText("Renommer la section", s.name);
                                if (name?.trim()) update("sections", s.id, { name: name.trim() });
                              },
                            },
                            { colors: SECTION_COLORS, current: s.color, pick: (color) => update("sections", s.id, { color }) },
                            "separator",
                            {
                              label: "Supprimer la section",
                              danger: true,
                              action: async () => {
                                if (await confirmAction("Supprimer la section", `Supprimer « ${s.name} » et ses pages ?`))
                                  remove("sections", s.id);
                              },
                            },
                          ])
                        }
                      >
                        <span className="section-dot" />
                        <span className="label">{s.name}</span>
                      </div>
                    ))}
                  <button className="link-button small" onClick={() => addSection(nb.id)}>
                    + Section
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {notebooks.length === 0 && <p className="empty-hint">Aucun carnet pour l'instant.</p>}
      </div>
      <button className="add-notebook" onClick={addNotebook}>
        + Nouveau carnet
      </button>
    </nav>
  );
}
