import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
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
import type * as Y from "yjs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CONTENT_FIELD } from "../lib/store";
import { AttachmentImage, FileAttachment, downloadAttachment, insertFiles } from "../lib/extensions";
import { Toolbar } from "./Toolbar";

interface Props {
  doc: Y.Doc;
  onReady?: (editor: TiptapEditor) => void;
}

export function Editor({ doc, onReady }: Props) {
  const editor = useEditor({
    extensions: [
      // L'historique est géré par Yjs (annulation par utilisateur).
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: doc, field: CONTENT_FIELD }),
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
      Placeholder.configure({ placeholder: "Commencez à écrire…" }),
    ],
    editorProps: {
      attributes: { class: "note-content", spellcheck: "true" },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        void insertFiles(view, files);
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        void insertFiles(view, files, pos);
        return true;
      },
      handleClickOn(_view, _pos, node, _nodePos, event) {
        if (node.type.name === "fileAttachment") {
          void downloadAttachment(node.attrs.id, node.attrs.name);
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
    },
    onCreate: ({ editor }) => onReady?.(editor as TiptapEditor),
  });

  if (!editor) return null;
  return (
    <>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor-scroll" />
    </>
  );
}
