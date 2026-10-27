// Extensions TipTap propres à MyNote : images et fichiers stockés en local.

import { Node, mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { EditorView } from "@tiptap/pm/view";
import { ATTACHMENT_PREFIX, attachmentAdded, attachmentUrl, getAttachment, saveAttachment } from "./attachments";
import { saveFile } from "./platform";

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

export async function downloadAttachment(id: string, name: string) {
  const blob = await getAttachment(id);
  if (blob) await saveFile(name, blob);
}

/** Insère des fichiers (collés ou déposés) dans l'éditeur. */
export async function insertFiles(view: EditorView, files: File[], pos?: number) {
  for (const file of files) {
    const id = await saveAttachment(file);
    const { schema } = view.state;
    const node = file.type.startsWith("image/")
      ? schema.nodes.image.create({ src: ATTACHMENT_PREFIX + id, alt: file.name })
      : schema.nodes.fileAttachment.create({ id, name: file.name, size: file.size });
    const at = pos ?? view.state.selection.from;
    view.dispatch(view.state.tr.insert(Math.min(at, view.state.doc.content.size), node));
    if (pos !== undefined) pos += node.nodeSize;
  }
}
