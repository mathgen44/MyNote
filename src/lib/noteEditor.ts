// Configuration commune des éditeurs TipTap : page en flux et blocs du canvas.

import { getSchema } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import { useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { openUrl } from "@tauri-apps/plugin-opener";
import { yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import type * as Y from "yjs";
import { ATTACHMENT_PREFIX } from "./attachments";
import { AttachmentImage, FileAttachment, FilePreview, attachmentMenu, chooseInsertMode, insertFiles, openAttachment } from "./extensions";

/** Extensions qui définissent le contenu (schéma) d'une note. */
function contentExtensions(): Extensions {
  return [
    // L'historique est géré par Yjs (annulation par utilisateur).
    StarterKit.configure({ history: false }),
    Underline,
    Highlight.configure({ multicolor: true }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    Link.configure({ openOnClick: false, autolink: true }),
    AttachmentImage.configure({ allowBase64: true }),
    FileAttachment,
    FilePreview,
  ];
}

let schema: Schema | undefined;
const noteSchema = () => (schema ??= getSchema(contentExtensions()));

/** HTML d'un fragment Yjs, sans monter d'éditeur (export). */
export function fragmentToHtml(fragment: Y.XmlFragment): string {
  const root = yXmlFragmentToProseMirrorRootNode(fragment, noteSchema());
  const container = document.createElement("div");
  container.appendChild(DOMSerializer.fromSchema(noteSchema()).serializeFragment(root.content));
  return container.innerHTML;
}

interface Options {
  placeholder?: string;
  className?: string;
  onCreate?: (editor: Editor) => void;
  onFocus?: (editor: Editor) => void;
}

/** Éditeur lié au fragment `field` du document de la page. */
export function useNoteEditor(doc: Y.Doc, field: string, opts: Options = {}) {
  return useEditor({
    extensions: [
      ...contentExtensions(),
      Collaboration.configure({ document: doc, field }),
      ...(opts.placeholder ? [Placeholder.configure({ placeholder: opts.placeholder })] : []),
    ],
    editorProps: {
      attributes: { class: opts.className ?? "note-content", spellcheck: "true" },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        const pos = view.state.selection.from;
        const { left, bottom } = view.coordsAtPos(pos);
        void chooseInsertMode(files, left, bottom, true).then((mode) => insertFiles(view, files, pos, mode));
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void chooseInsertMode(files, event.clientX, event.clientY, false).then((mode) => insertFiles(view, files, pos, mode));
        return true;
      },
      handleClickOn(_view, _pos, node, _nodePos, event) {
        if (node.type.name === "fileAttachment") {
          void openAttachment(node.attrs.id, node.attrs.name);
          return true;
        }
        // Ctrl+clic sur un lien : ouverture dans le navigateur.
        const link = (event.target as HTMLElement).closest("a");
        if (link && (event.ctrlKey || event.metaKey)) {
          void openUrl(link.href);
          return true;
        }
        return false;
      },
      handleDoubleClickOn(_view, _pos, node) {
        const src = String(node.attrs.src ?? "");
        if (node.type.name !== "image" || !src.startsWith(ATTACHMENT_PREFIX)) return false;
        void openAttachment(src.slice(ATTACHMENT_PREFIX.length), node.attrs.alt || "image.png");
        return true;
      },
      handleDOMEvents: {
        // Clic droit sur une pièce jointe : ouvrir, lien / aperçu, enregistrer.
        contextmenu(view, event) {
          const target = event.target as HTMLElement;
          const el = target.closest(".file-chip, .file-preview, img");
          if (!el || !view.dom.contains(el)) return false;
          // Selon le nœud, la position trouvée est sur lui ou juste après son début.
          const inside = view.posAtCoords({ left: event.clientX, top: event.clientY })?.inside ?? -1;
          const atDom = view.posAtDOM(el, 0);
          const found = [inside, atDom, atDom - 1].some((pos) => pos >= 0 && attachmentMenu(view, pos, event.clientX, event.clientY));
          if (!found) return false;
          event.preventDefault();
          return true;
        },
      },
    },
    onCreate: ({ editor }) => opts.onCreate?.(editor as Editor),
    onFocus: ({ editor }) => opts.onFocus?.(editor as Editor),
  });
}
