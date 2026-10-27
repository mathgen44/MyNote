import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { insertFiles } from "../lib/extensions";
import { askText, openMenu } from "./overlays";

const HIGHLIGHTS = ["#fff59d", "#a5d6a7", "#90caf9", "#f48fb1", "#ffcc80", "#ce93d8"];

function Btn(props: { title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      className={"tool" + (props.active ? " active" : "")}
      // mousedown pour ne pas faire perdre la sélection à l'éditeur
      onMouseDown={(e) => {
        e.preventDefault();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

export function Toolbar({ editor }: { editor: Editor }) {
  const fileInput = useRef<HTMLInputElement>(null);
  // Suit la sélection de l'éditeur même quand il appartient à un autre composant (canvas).
  const [, refresh] = useState(0);
  useEffect(() => {
    const onChange = () => refresh((n) => n + 1);
    editor.on("transaction", onChange);
    return () => void editor.off("transaction", onChange);
  }, [editor]);
  const chain = () => editor.chain().focus();
  const inTable = editor.isActive("table");

  const setLink = async () => {
    const current = editor.getAttributes("link").href as string | undefined;
    const url = await askText("Lien", current ?? "https://", "https://…");
    if (url === null) return;
    if (!url.trim()) chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  return (
    <div className="toolbar">
      <Btn title="Annuler (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => chain().undo().run()}>↶</Btn>
      <Btn title="Rétablir (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => chain().redo().run()}>↷</Btn>
      <span className="sep" />
      <select
        className="tool-select"
        title="Style de paragraphe"
        value={[1, 2, 3].find((level) => editor.isActive("heading", { level })) ?? 0}
        onChange={(e) => {
          const level = Number(e.target.value) as 0 | 1 | 2 | 3;
          if (level === 0) chain().setParagraph().run();
          else chain().setHeading({ level }).run();
        }}
      >
        <option value={0}>Texte</option>
        <option value={1}>Titre 1</option>
        <option value={2}>Titre 2</option>
        <option value={3}>Titre 3</option>
      </select>
      <Btn title="Gras (Ctrl+B)" active={editor.isActive("bold")} onClick={() => chain().toggleBold().run()}><b>G</b></Btn>
      <Btn title="Italique (Ctrl+I)" active={editor.isActive("italic")} onClick={() => chain().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="Souligné (Ctrl+U)" active={editor.isActive("underline")} onClick={() => chain().toggleUnderline().run()}><u>S</u></Btn>
      <Btn title="Barré" active={editor.isActive("strike")} onClick={() => chain().toggleStrike().run()}><s>ab</s></Btn>
      <button
        type="button"
        title="Surligner"
        className={"tool" + (editor.isActive("highlight") ? " active" : "")}
        onMouseDown={(e) => {
          e.preventDefault();
          openMenu(e, [
            { colors: HIGHLIGHTS, current: editor.getAttributes("highlight").color, pick: (color) => chain().setHighlight({ color }).run() },
            { label: "Retirer le surlignage", action: () => chain().unsetHighlight().run() },
          ]);
        }}
      >
        <span className="highlight-icon">ab</span>
      </button>
      <Btn title="Code" active={editor.isActive("code")} onClick={() => chain().toggleCode().run()}>{"</>"}</Btn>
      <span className="sep" />
      <Btn title="Liste à puces" active={editor.isActive("bulletList")} onClick={() => chain().toggleBulletList().run()}>•≡</Btn>
      <Btn title="Liste numérotée" active={editor.isActive("orderedList")} onClick={() => chain().toggleOrderedList().run()}>1≡</Btn>
      <Btn title="Liste de tâches (À faire)" active={editor.isActive("taskList")} onClick={() => chain().toggleTaskList().run()}>☑</Btn>
      <Btn title="Citation" active={editor.isActive("blockquote")} onClick={() => chain().toggleBlockquote().run()}>❝</Btn>
      <Btn title="Bloc de code" active={editor.isActive("codeBlock")} onClick={() => chain().toggleCodeBlock().run()}>{"{ }"}</Btn>
      <Btn title="Séparateur" onClick={() => chain().setHorizontalRule().run()}>―</Btn>
      <span className="sep" />
      <Btn title="Lien (Ctrl+clic pour l'ouvrir)" active={editor.isActive("link")} onClick={setLink}>🔗</Btn>
      <Btn title="Image ou pièce jointe" onClick={() => fileInput.current?.click()}>📎</Btn>
      <button
        type="button"
        title="Tableau"
        className={"tool" + (inTable ? " active" : "")}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!inTable) {
            chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            return;
          }
          openMenu(e, [
            { label: "Insérer une ligne dessous", action: () => chain().addRowAfter().run() },
            { label: "Insérer une colonne à droite", action: () => chain().addColumnAfter().run() },
            { label: "Supprimer la ligne", action: () => chain().deleteRow().run() },
            { label: "Supprimer la colonne", action: () => chain().deleteColumn().run() },
            "separator",
            { label: "Supprimer le tableau", danger: true, action: () => chain().deleteTable().run() },
          ]);
        }}
      >
        ▦
      </button>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void insertFiles(editor.view, files);
        }}
      />
    </div>
  );
}
