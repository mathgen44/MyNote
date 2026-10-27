import { useEffect, useRef, useState } from "react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import TurndownService from "turndown";
import type * as Y from "yjs";
import { ATTACHMENT_PREFIX, blobToDataUrl, getAttachment } from "../lib/attachments";
import { saveFile } from "../lib/platform";
import { getPageDoc, update, useWorkspace } from "../lib/store";
import { Editor } from "./Editor";
import { openMenu } from "./overlays";

const dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

/** HTML de la page avec les images intégrées (export autonome). */
async function exportHtml(editor: TiptapEditor): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = editor.getHTML();
  for (const img of Array.from(container.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    if (!src.startsWith(ATTACHMENT_PREFIX)) continue;
    const blob = await getAttachment(src.slice(ATTACHMENT_PREFIX.length));
    if (blob) img.src = await blobToDataUrl(blob);
  }
  return container.innerHTML;
}

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

  const exportAs = async (format: "html" | "md") => {
    const editor = editorRef.current;
    if (!editor) return;
    const body = await exportHtml(editor);
    const title = page.title || "Sans titre";
    if (format === "html") {
      const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`;
      await saveFile(`${safeName(title)}.html`, html);
    } else {
      const md = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).turndown(body);
      await saveFile(`${safeName(title)}.md`, `# ${title}\n\n${md}\n`);
    }
  };

  return (
    <main className="page-view">
      <div className="page-header">
        <input
          className="page-title-input"
          value={page.title}
          placeholder="Titre de la page"
          onChange={(e) => update("pages", page.id, { title: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editorRef.current?.commands.focus("start");
            }
          }}
        />
        <button
          className="icon-button"
          title="Exporter"
          onClick={(e) =>
            openMenu(e, [
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
      {doc && <Editor key={page.id} doc={doc} onReady={(ed) => (editorRef.current = ed)} />}
    </main>
  );
}
