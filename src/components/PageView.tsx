import { useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type * as Y from "yjs";
import { pageToHtml, pageToMarkdown } from "../lib/exportPage";
import { convertToCanvas, convertToFlow } from "../lib/pageDoc";
import { saveFile } from "../lib/platform";
import { getPageDoc, update, useWorkspace } from "../lib/store";
import { CanvasView } from "./CanvasView";
import { Editor } from "./Editor";
import { confirmAction, openMenu } from "./overlays";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

const safeName = (title: string) => (title.trim() || "page").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);

export function PageView({ pageId }: { pageId?: string }) {
  const { pages } = useWorkspace();
  const page = pages.find((p) => p.id === pageId);
  const [doc, setDoc] = useState<Y.Doc>();
  const editorRef = useRef<TiptapEditor>();

  useEffect(() => {
    setDoc(undefined);
    if (!pageId) return;
    let cancelled = false;
    const entry = getPageDoc(pageId);
    void entry.ready.then(() => !cancelled && setDoc(entry.doc));
    return () => {
      cancelled = true;
    };
  }, [pageId]);

  if (!page) {
    return (
      <main className="page-view empty">
        <p>Sélectionnez ou créez une page.</p>
      </main>
    );
  }

  const layout = page.layout ?? "flow";
  const title = page.title || "Sans titre";

  const exportAs = async (format: "html" | "md") => {
    if (!doc) return;
    if (format === "html") await saveFile(`${safeName(title)}.html`, await pageToHtml(doc, layout, title));
    else await saveFile(`${safeName(title)}.md`, await pageToMarkdown(doc, layout, title));
  };

  const switchLayout = async () => {
    if (!doc) return;
    if (layout === "flow") {
      convertToCanvas(doc);
      update("pages", page.id, { layout: "canvas" });
      return;
    }
    const ok = await confirmAction(
      "Convertir en page en flux",
      "Les blocs seront mis les uns sous les autres, de haut en bas : leur disposition sera perdue.",
      "Convertir",
    );
    if (!ok) return;
    convertToFlow(doc);
    update("pages", page.id, { layout: "flow" });
  };

  return (
    <main className={"page-view" + (layout === "canvas" ? " canvas" : "")}>
      <div className="page-header">
        <input
          className="page-title-input"
          value={page.title}
          placeholder="Titre de la page"
          onChange={(e) => update("pages", page.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && layout === "flow") {
              e.preventDefault();
              editorRef.current?.commands.focus("start");
            }
          }}
        />
        <button
          className="icon-button"
          title="Plus d'actions"
          onClick={(e) =>
            openMenu(e, [
              { label: layout === "flow" ? "Convertir en page libre (canvas)" : "Convertir en page en flux", action: () => void switchLayout() },
              "separator",
              { label: "Exporter en HTML", action: () => void exportAs("html") },
              { label: "Exporter en Markdown", action: () => void exportAs("md") },
              { label: "Imprimer / PDF", action: () => window.print() },
            ])
          }
        >
          ⋯
        </button>
      </div>
      <div className="page-meta">{dateFmt.format(page.created)}</div>
      {doc &&
        (layout === "canvas" ? (
          <CanvasView key={page.id} doc={doc} />
        ) : (
          <Editor key={page.id} doc={doc} onReady={(ed) => (editorRef.current = ed)} />
        ))}
    </main>
  );
}
