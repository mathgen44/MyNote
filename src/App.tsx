import { useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { PageList } from "./components/PageList";
import { PageView } from "./components/PageView";
import { SettingsDialog, labelFor } from "./components/SettingsDialog";
import { DialogHost, MenuHost, askText } from "./components/overlays";
import { createNotebook, createPage, getSnapshot, useWorkspace } from "./lib/store";
import { startSync, useSyncStatus } from "./lib/sync";

interface Selection {
  notebookId?: string;
  sectionId?: string;
  pageId?: string;
}

const SELECTION_KEY = "mynote.selection";

function loadSelection(): Selection {
  try {
    return JSON.parse(localStorage.getItem(SELECTION_KEY) ?? "{}");
  } catch {
    return {};
  }
}

/** Corrige une sélection devenue invalide (élément supprimé, synchro…). */
function resolve(sel: Selection): Selection {
  const { notebooks, sections, pages } = getSnapshot();
  const notebook = notebooks.find((n) => n.id === sel.notebookId) ?? notebooks[0];
  if (!notebook) return {};
  const nbSections = sections.filter((s) => s.notebookId === notebook.id);
  const section = nbSections.find((s) => s.id === sel.sectionId) ?? nbSections[0];
  if (!section) return { notebookId: notebook.id };
  const secPages = pages.filter((p) => p.sectionId === section.id);
  const page = secPages.find((p) => p.id === sel.pageId) ?? secPages[0];
  return { notebookId: notebook.id, sectionId: section.id, pageId: page?.id };
}

export default function App() {
  const workspace = useWorkspace();
  const sync = useSyncStatus();
  const [selection, setSelection] = useState<Selection>(loadSelection);
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const sel = resolve(selection);

  useEffect(() => {
    try {
      localStorage.setItem(SELECTION_KEY, JSON.stringify(sel));
    } catch {
      /* stockage indisponible : sans conséquence */
    }
  }, [sel.notebookId, sel.sectionId, sel.pageId]);

  useEffect(() => {
    void startSync();
  }, []);

  const selectPage = (pageId: string) => {
    const { pages, sections } = getSnapshot();
    const page = pages.find((p) => p.id === pageId);
    const section = sections.find((s) => s.id === page?.sectionId);
    setSelection({ notebookId: section?.notebookId, sectionId: section?.id, pageId });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key.toLowerCase() === "n" && sel.sectionId) {
        e.preventDefault();
        selectPage(createPage(sel.sectionId));
      } else if (e.key.toLowerCase() === "e" || (e.key.toLowerCase() === "f" && e.shiftKey)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const firstNotebook = async () => {
    const name = await askText("Nouveau carnet", "Mon carnet");
    if (!name?.trim()) return;
    const ids = createNotebook(name.trim());
    setSelection({ notebookId: ids.notebookId, sectionId: ids.sectionId, pageId: createPage(ids.sectionId) });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">MyNote</div>
        <input
          ref={searchRef}
          className="search"
          type="search"
          placeholder="Rechercher (Ctrl+E)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
        />
        <button className={`sync-pill ${sync.state}`} title={sync.message ?? "Paramètres de synchronisation"} onClick={() => setSettingsOpen(true)}>
          <span className="dot" />
          {sync.state === "disconnected" ? "Drive non connecté" : labelFor(sync.state)}
        </button>
        <button className="icon-button" title="Paramètres" onClick={() => setSettingsOpen(true)}>
          ⚙
        </button>
      </header>

      {workspace.notebooks.length === 0 ? (
        <div className="welcome">
          <h1>Bienvenue dans MyNote</h1>
          <p>Vos notes sont enregistrées sur cet ordinateur et peuvent se synchroniser avec votre Google Drive.</p>
          <div className="row">
            <button className="primary" onClick={firstNotebook}>
              Créer mon premier carnet
            </button>
            <button onClick={() => setSettingsOpen(true)}>Connecter Google Drive</button>
          </div>
          <p className="hint">Vous avez déjà des notes sur Drive ? Connectez-vous : elles apparaîtront ici.</p>
        </div>
      ) : (
        <div className="columns">
          <Sidebar
            notebookId={sel.notebookId}
            sectionId={sel.sectionId}
            onSelectSection={(notebookId, sectionId) => {
              setQuery("");
              setSelection({ notebookId, sectionId });
            }}
          />
          <PageList sectionId={sel.sectionId} pageId={sel.pageId} query={query} onSelectPage={selectPage} />
          <PageView pageId={sel.pageId} />
        </div>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      <DialogHost />
      <MenuHost />
    </div>
  );
}
