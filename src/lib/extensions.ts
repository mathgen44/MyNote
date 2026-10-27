// Extensions TipTap propres à MyNote : images et fichiers stockés en local.

import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { openMenuAt } from "../components/overlays";
import { ATTACHMENT_PREFIX, attachmentAdded, attachmentUrl, getAttachment, saveAttachment } from "./attachments";
import { openFile, saveFile } from "./platform";

export const ATTACHMENT_SRC = "data-attachment-src";

/** Image dont la source `attachment:<id>` est résolue depuis IndexedDB. */
export const AttachmentImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // En HTML (rendu initial, copier-coller, export), la référence locale va
      // dans data-attachment-src : le navigateur n'essaie pas de la charger.
      src: {
        default: null,
        parseHTML: (el) => el.getAttribute(ATTACHMENT_SRC) ?? el.getAttribute("src"),
        renderHTML: (attrs) =>
          String(attrs.src ?? "").startsWith(ATTACHMENT_PREFIX) ? { [ATTACHMENT_SRC]: attrs.src } : { src: attrs.src },
      },
    };
  },
  parseHTML() {
    return [{ tag: `img[${ATTACHMENT_SRC}]` }, ...(this.parent?.() ?? [])];
  },
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement("img");
      let src = node.attrs.src as string;
      let unsubscribe: (() => void) | undefined;

      const render = async () => {
        unsubscribe?.();
        if (!src.startsWith(ATTACHMENT_PREFIX)) {
          img.src = src;
          return;
        }
        const id = src.slice(ATTACHMENT_PREFIX.length);
        const url = await attachmentUrl(id);
        if (url) {
          img.src = url;
          img.classList.remove("pending");
        } else {
          // Pas encore téléchargée depuis Drive : on attend son arrivée.
          img.classList.add("pending");
          img.alt = "Image en cours de synchronisation…";
          unsubscribe = attachmentAdded.on((added) => added === id && void render());
        }
      };
      void render();

      return {
        dom: img,
        update(next) {
          if (next.type !== node.type) return false;
          if (next.attrs.src !== src) {
            src = next.attrs.src;
            void render();
          }
          return true;
        },
        destroy: () => unsubscribe?.(),
      };
    };
  },
});

/** Pièce jointe quelconque, affichée comme une pastille cliquable. */
export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { id: { default: null }, name: { default: "fichier" }, size: { default: 0 } };
  },
  parseHTML() {
    return [{ tag: "span[data-attachment]", getAttrs: (el) => ({ id: (el as HTMLElement).dataset.attachment, name: (el as HTMLElement).textContent?.replace(/^📎\s*/, "") }) }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-attachment": node.attrs.id, class: "file-chip", title: "Cliquer pour enregistrer" }), `📎 ${node.attrs.name}`];
  },
});

// --- Aperçu des fichiers --------------------------------------------------------

export type PreviewKind = "image" | "pdf" | "word" | "text";

const TEXT_FILE = /\.(txt|md|markdown|csv|tsv|json|log|xml|ya?ml|ini|cfg|conf)$/i;

/** Type d'aperçu possible pour un fichier, d'après son type MIME ou son nom. */
export function previewKind(name: string, type = ""): PreviewKind | null {
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)) return "image";
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/\.docx$/i.test(name)) return "word";
  if (type.startsWith("text/") || TEXT_FILE.test(name)) return "text";
  return null;
}

const MAX_TEXT_PREVIEW = 100_000;

/** Remplit `body` avec l'aperçu du fichier ; renvoie de quoi le nettoyer. */
async function renderPreview(body: HTMLElement, id: string, name: string): Promise<() => void> {
  const blob = await getAttachment(id);
  if (!blob) {
    // Pas encore téléchargé depuis la synchro : on attend son arrivée.
    body.textContent = "Fichier en cours de synchronisation…";
    return attachmentAdded.on((added) => added === id && void renderPreview(body, id, name));
  }
  const kind = previewKind(name, blob.type);
  body.className = `file-preview-body ${kind ?? ""}`;
  body.replaceChildren();
  if (kind === "pdf" || kind === "image") {
    // Le Blob peut avoir perdu son type (synchro) : on le rétablit pour le navigateur.
    const url = URL.createObjectURL(kind === "pdf" ? new Blob([blob], { type: "application/pdf" }) : blob);
    const el = document.createElement(kind === "pdf" ? "iframe" : "img");
    el.src = url;
    body.append(el);
    return () => URL.revokeObjectURL(url);
  }
  if (kind === "word") {
    const mammoth = await import("mammoth");
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await blob.arrayBuffer() });
    // Iframe isolée, sans script : le contenu du document ne touche pas à la page.
    const frame = document.createElement("iframe");
    frame.sandbox.value = "";
    frame.srcdoc =
      `<style>body{font:14px/1.5 "Segoe UI",sans-serif;margin:16px 24px;color:#1f1f24;background:#fff}` +
      `img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px}</style>${value}`;
    body.append(frame);
  } else if (kind === "text") {
    const pre = document.createElement("pre");
    const text = await blob.text();
    pre.textContent = text.length > MAX_TEXT_PREVIEW ? text.slice(0, MAX_TEXT_PREVIEW) + "\n…" : text;
    body.append(pre);
  } else {
    body.textContent = "Aperçu indisponible pour ce type de fichier.";
  }
  return () => {};
}

/** Fichier affiché avec son aperçu (PDF, Word, texte, image). */
export const FilePreview = Node.create({
  name: "filePreview",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { id: { default: null }, name: { default: "fichier" }, size: { default: 0 } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-file-preview]",
        getAttrs: (el) => ({ id: (el as HTMLElement).dataset.filePreview, name: (el as HTMLElement).dataset.name }),
      },
    ];
  },
  renderHTML({ node }) {
    // Export : un lien vers le fichier, l'aperçu n'a de sens que dans MyNote.
    return ["div", { "data-file-preview": node.attrs.id, "data-name": node.attrs.name, class: "file-chip" }, `📎 ${node.attrs.name}`];
  },
  addNodeView() {
    return ({ node }) => {
      const { id, name } = node.attrs as { id: string; name: string };
      const dom = document.createElement("div");
      dom.className = "file-preview";
      dom.contentEditable = "false";
      const bar = document.createElement("div");
      bar.className = "file-preview-bar";
      bar.dataset.dragHandle = "";
      const title = document.createElement("span");
      title.textContent = `📎 ${name}`;
      const open = document.createElement("button");
      open.textContent = "Ouvrir";
      open.onclick = () => void openAttachment(id, name);
      bar.append(title, open);
      const body = document.createElement("div");
      body.className = "file-preview-body";
      dom.append(bar, body);

      let cleanup: (() => void) | undefined;
      void renderPreview(body, id, name).then((c) => (cleanup = c));
      return {
        dom,
        // L'aperçu (défilement, PDF…) garde ses événements ; la barre sert à sélectionner et déplacer.
        stopEvent: (e) => body.contains(e.target as globalThis.Node) || e.target === open,
        ignoreMutation: () => true,
        update: (next) => next.type === node.type && next.attrs.id === id,
        destroy: () => cleanup?.(),
      };
    };
  },
});

// --- Ouverture, enregistrement, insertion -----------------------------------------

export async function openAttachment(id: string, name: string) {
  const blob = await getAttachment(id);
  if (blob) await openFile(id, name, blob);
}

export async function downloadAttachment(id: string, name: string) {
  const blob = await getAttachment(id);
  if (blob) await saveFile(name, blob);
}

export type InsertMode = "preview" | "link";

/**
 * Lien ou aperçu ? On demande quand un aperçu est possible ; une capture
 * d'écran collée devient directement une image. Menu refermé : rien.
 */
export function chooseInsertMode(files: File[], x: number, y: number, pasted: boolean): Promise<InsertMode> {
  if (!files.some((f) => previewKind(f.name, f.type))) return Promise.resolve("link");
  if (pasted && files.every((f) => f.type.startsWith("image/"))) return Promise.resolve("preview");
  return new Promise((resolve) =>
    openMenuAt(x, y, [
      { label: "Insérer avec aperçu", action: () => resolve("preview") },
      { label: "Insérer comme lien", action: () => resolve("link") },
    ]),
  );
}

function attachmentNode(view: EditorView, mode: InsertMode, file: { id: string; name: string; size: number; type?: string }): PMNode {
  const { nodes } = view.state.schema;
  const kind = mode === "preview" ? previewKind(file.name, file.type) : null;
  if (kind === "image") return nodes.image.create({ src: ATTACHMENT_PREFIX + file.id, alt: file.name });
  if (kind) return nodes.filePreview.create({ id: file.id, name: file.name, size: file.size });
  return nodes.fileAttachment.create({ id: file.id, name: file.name, size: file.size });
}

/** Insère des fichiers (collés ou déposés) dans l'éditeur. */
export async function insertFiles(view: EditorView, files: File[], pos?: number, mode: InsertMode = "preview") {
  let at = pos ?? view.state.selection.from;
  for (const file of files) {
    const id = await saveAttachment(file);
    const node = attachmentNode(view, mode, { id, name: file.name, size: file.size, type: file.type });
    at = Math.min(at, view.state.doc.content.size);
    const tr = view.state.tr.replaceRangeWith(at, at, node);
    at = tr.mapping.map(at);
    view.dispatch(tr);
  }
}

/** Pièce jointe représentée par un nœud : lien, aperçu ou image locale. */
function attachmentOf(node: PMNode | null | undefined): { id: string; name: string; size: number } | null {
  if (!node) return null;
  if (node.type.name === "fileAttachment" || node.type.name === "filePreview") return node.attrs as { id: string; name: string; size: number };
  const src = String(node.attrs.src ?? "");
  if (node.type.name === "image" && src.startsWith(ATTACHMENT_PREFIX))
    return { id: src.slice(ATTACHMENT_PREFIX.length), name: node.attrs.alt || "image.png", size: 0 };
  return null;
}

/** Menu contextuel d'une pièce jointe : ouvrir, basculer lien / aperçu, enregistrer. */
export function attachmentMenu(view: EditorView, pos: number, x: number, y: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  const file = attachmentOf(node);
  if (!node || !file) return false;
  const isLink = node.type.name === "fileAttachment";
  const replace = (mode: InsertMode) => {
    const next = attachmentNode(view, mode, file);
    // Un lien se place dans un paragraphe ; un aperçu, entre deux paragraphes.
    const content = mode === "link" ? view.state.schema.nodes.paragraph.create(null, next) : next;
    view.dispatch(view.state.tr.replaceRangeWith(pos, pos + node.nodeSize, content));
  };
  openMenuAt(x, y, [
    { label: "Ouvrir", action: () => void openAttachment(file.id, file.name) },
    isLink
      ? { label: "Afficher l'aperçu", action: () => replace("preview"), disabled: !previewKind(file.name) }
      : { label: "Afficher comme lien", action: () => replace("link") },
    { label: "Enregistrer sous…", action: () => void downloadAttachment(file.id, file.name) },
  ]);
  return true;
}
