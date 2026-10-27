import { EditorContent } from "@tiptap/react";
import type { Editor as TiptapEditor } from "@tiptap/react";
import type * as Y from "yjs";
import { CONTENT_FIELD } from "../lib/pageDoc";
import { useNoteEditor } from "../lib/noteEditor";
import { Toolbar } from "./Toolbar";

interface Props {
  doc: Y.Doc;
  onReady?: (editor: TiptapEditor) => void;
}

/** Page en flux : un seul éditeur sur toute la largeur. */
export function Editor({ doc, onReady }: Props) {
  const editor = useNoteEditor(doc, CONTENT_FIELD, { placeholder: "Commencez à écrire…", onCreate: onReady });

  if (!editor) return null;
  return (
    <>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} className="editor-scroll" />
    </>
  );
}
