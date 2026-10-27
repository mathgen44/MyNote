// Page « canvas » : des blocs de texte et des images posés librement, comme
// dans OneNote. Un clic sur une zone vide crée un bloc de texte ; un bloc
// laissé vide disparaît quand on le quitte.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import * as Y from "yjs";
import { ATTACHMENT_PREFIX, attachmentAdded, attachmentUrl, saveAttachment } from "../lib/attachments";
import { insertFiles } from "../lib/extensions";
import { useNoteEditor } from "../lib/noteEditor";
import { addBlock, blockField, blocksOf, bringToFront, readBlocks, removeBlock, updateBlock } from "../lib/pageDoc";
import type { Block } from "../lib/pageDoc";
import { Toolbar } from "./Toolbar";

const TEXT_WIDTH = 420;
const MIN_WIDTH = 80;
const MAX_IMAGE_WIDTH = 600;
// Espace libre gardé à droite et en bas de la page, pour pouvoir y écrire.
const MARGIN_RIGHT = 80;
const MARGIN_BOTTOM = 320;

interface Drag {
  id: string;
  kind: "move" | "resize";
  startX: number;
  startY: number;
  origin: Block;
}

async function imageWidth(file: Blob): Promise<number> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  return Math.min(bitmap?.width ?? 400, MAX_IMAGE_WIDTH);
}

export function CanvasView({ doc }: { doc: Y.Doc }) {
  const [blocks, setBlocks] = useState<Block[]>(() => readBlocks(doc));
  const [activeId, setActiveId] = useState<string>();
  const [activeEditor, setActiveEditor] = useState<Editor>();
  const [drag, setDrag] = useState<Drag>();
  const [preview, setPreview] = useState<Partial<Block>>();
  const [heights, setHeights] = useState<Record<string, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editors = useRef(new Map<string, Editor>());
  const pendingFiles = useRef(new Map<string, File[]>());
  const focusOnCreate = useRef<string>();
  // Dernière position de la souris sur la page : là où l'on colle une image.
  const pointer = useRef<{ x: number; y: number }>();

  // Annuler / rétablir pour la disposition (création, déplacement, suppression
  // de blocs). La saisie dans un bloc a son propre historique, celui de l'éditeur.
  const undoManager = useMemo(() => new Y.UndoManager(blocksOf(doc)), [doc]);

  useEffect(() => {
    const map = blocksOf(doc);
    const refresh = () => setBlocks(readBlocks(doc));
    map.observeDeep(refresh);
    refresh();
    return () => {
      map.unobserveDeep(refresh);
      undoManager.destroy();
    };
  }, [doc, undoManager]);

  // Un bloc actif supprimé (par exemple depuis un autre appareil) n'est plus actif.
  useEffect(() => {
    if (activeId && !blocks.some((b) => b.id === activeId)) {
      setActiveId(undefined);
      setActiveEditor(undefined);
    }
  }, [blocks, activeId]);

  // En quittant la page, on retire les blocs de texte restés vides.
  useEffect(() => () => editors.current.forEach((ed, id) => ed.isEmpty && removeBlock(doc, id)), [doc]);

  const removeIfEmpty = (id: string | undefined) => {
    if (!id) return;
    const block = blocks.find((b) => b.id === id);
    if (block?.type === "text" && editors.current.get(id)?.isEmpty) removeBlock(doc, id);
  };

  const activate = (id: string | undefined) => {
    if (id === activeId) return;
    removeIfEmpty(activeId);
    setActiveId(id);
    setActiveEditor(id ? editors.current.get(id) : undefined);
    if (id) bringToFront(doc, id);
  };

  /** Position dans la page à partir d'un événement souris. */
  const pagePoint = (e: { clientX: number; clientY: number }) => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.round(e.clientX - rect.left)), y: Math.max(0, Math.round(e.clientY - rect.top)) };
  };

  const createTextBlock = (x: number, y: number, files?: File[]) => {
    const id = addBlock(doc, { type: "text", x, y, w: TEXT_WIDTH });
    focusOnCreate.current = id;
    if (files?.length) pendingFiles.current.set(id, files);
    removeIfEmpty(activeId);
    setActiveId(id);
    return id;
  };

  const addFiles = async (files: File[], x: number, y: number) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const others = files.filter((f) => !f.type.startsWith("image/"));
    for (const [i, file] of images.entries()) {
      const id = await saveAttachment(file);
      addBlock(doc, { type: "image", x: x + i * 24, y: y + i * 24, w: await imageWidth(file), src: ATTACHMENT_PREFIX + id });
    }
    if (others.length) createTextBlock(x, y + images.length * 24, others);
  };

  // --- Souris : création, déplacement, redimensionnement -----------------------

  const onSurfacePointerDown = (e: ReactPointerEvent) => {
    if (e.target !== surfaceRef.current || e.button !== 0) return;
    e.preventDefault();
    const { x, y } = pagePoint(e);
    createTextBlock(Math.max(0, x - 10), Math.max(0, y - 14));
  };

  const startDrag = (e: ReactPointerEvent, block: Block, kind: Drag["kind"]) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    activate(block.id);
    // Le focus va à la page : Ctrl+Z annule le geste, Suppr retire le bloc.
    scrollRef.current?.focus({ preventScroll: true });
    setDrag({ id: block.id, kind, startX: e.clientX, startY: e.clientY, origin: block });
  };

  useEffect(() => {
    if (!drag) return;
    const next = (e: PointerEvent): Partial<Block> => {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      return drag.kind === "move"
        ? { x: Math.max(0, drag.origin.x + dx), y: Math.max(0, drag.origin.y + dy) }
        : { w: Math.max(MIN_WIDTH, drag.origin.w + dx) };
    };
    const move = (e: PointerEvent) => setPreview(next(e));
    // La position n'est écrite dans le document qu'au relâchement : un seul
    // changement à synchroniser et à annuler par geste.
    const up = (e: PointerEvent) => {
      updateBlock(doc, drag.id, next(e));
      setDrag(undefined);
      setPreview(undefined);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, doc]);

  // --- Clavier, presse-papiers, glisser-déposer --------------------------------

  const inEditor = (target: EventTarget) => !!(target as HTMLElement).closest?.(".ProseMirror");

  const onKeyDown = (e: KeyboardEvent) => {
    if (inEditor(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undoManager.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      undoManager.redo();
    } else if ((e.key === "Delete" || e.key === "Backspace") && activeId) {
      e.preventDefault();
      removeBlock(doc, activeId);
    } else if (e.key === "Escape") {
      activate(undefined);
    }
  };

  const pasteOrigin = () => pointer.current ?? { x: (scrollRef.current?.scrollLeft ?? 0) + 48, y: (scrollRef.current?.scrollTop ?? 0) + 32 };

  const onPaste = (e: ClipboardEvent) => {
    if (inEditor(e.target)) return;
    const files = Array.from(e.clipboardData.files);
    if (!files.length) return;
    e.preventDefault();
    const { x, y } = pasteOrigin();
    void addFiles(files, x, y);
  };

  const onDrop = (e: DragEvent) => {
    if (inEditor(e.target)) return;
    const files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    e.preventDefault();
    const { x, y } = pagePoint(e);
    void addFiles(files, x, y);
  };

  // --- Rendu -----------------------------------------------------------------------

  const shown = blocks.map((b) => (drag && preview && b.id === drag.id ? { ...b, ...preview } : b));
  const width = Math.max(0, ...shown.map((b) => b.x + b.w)) + MARGIN_RIGHT;
  const height = Math.max(0, ...shown.map((b) => b.y + (heights[b.id] ?? 40))) + MARGIN_BOTTOM;

  return (
    <>
      {activeEditor ? (
        <Toolbar editor={activeEditor} />
      ) : (
        <div className="toolbar toolbar-hint">Cliquez n'importe où pour écrire · collez ou déposez une image sur la page</div>
      )}
      <div
        ref={scrollRef}
        className={"canvas-scroll" + (drag ? " dragging" : "")}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={onDrop}
      >
        <div
          ref={surfaceRef}
          className="canvas-surface"
          style={{ minWidth: `max(100%, ${width}px)`, minHeight: `max(100%, ${height}px)` }}
          onPointerDown={onSurfacePointerDown}
          onPointerMove={(e) => (pointer.current = pagePoint(e))}
          onPointerLeave={() => (pointer.current = undefined)}
        >
          {shown.map((block) => (
            <CanvasBlock
              key={block.id}
              doc={doc}
              block={block}
              active={block.id === activeId}
              onActivate={() => activate(block.id)}
              onStartDrag={(e, kind) => startDrag(e, block, kind)}
              onRemove={() => removeBlock(doc, block.id)}
              onHeight={(h) => setHeights((prev) => (prev[block.id] === h ? prev : { ...prev, [block.id]: h }))}
              onEditor={(editor) => {
                if (editor) editors.current.set(block.id, editor);
                else editors.current.delete(block.id);
                if (!editor) return;
                const files = pendingFiles.current.get(block.id);
                if (files) {
                  pendingFiles.current.delete(block.id);
                  void insertFiles(editor.view, files);
                }
                if (focusOnCreate.current === block.id) {
                  focusOnCreate.current = undefined;
                  setActiveEditor(editor);
                  editor.commands.focus();
                }
              }}
              onEditorFocus={(editor) => {
                activate(block.id);
                setActiveEditor(editor);
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}

interface BlockProps {
  doc: Y.Doc;
  block: Block;
  active: boolean;
  onActivate: () => void;
  onStartDrag: (e: ReactPointerEvent, kind: Drag["kind"]) => void;
  onRemove: () => void;
  onHeight: (height: number) => void;
  onEditor: (editor: Editor | undefined) => void;
  onEditorFocus: (editor: Editor) => void;
}

function CanvasBlock({ doc, block, active, onActivate, onStartDrag, onRemove, onHeight, onEditor, onEditorFocus }: BlockProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => onHeight(Math.round(el.offsetHeight)));
    observer.observe(el);
    return () => observer.disconnect();
    // onHeight change à chaque rendu ; l'observateur n'a besoin que de l'élément.
  }, []);

  return (
    <div
      ref={ref}
      className={`canvas-block ${block.type}` + (active ? " active" : "")}
      style={{ left: block.x, top: block.y, width: block.w, zIndex: block.z }}
    >
      <div className="block-bar" onPointerDown={(e) => onStartDrag(e, "move")} title="Déplacer">
        <button
          className="block-remove"
          title="Supprimer le bloc"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {block.type === "text" ? (
        <TextBlock doc={doc} id={block.id} onEditor={onEditor} onFocus={onEditorFocus} />
      ) : (
        <ImageBlock src={block.src ?? ""} onPointerDown={(e) => onStartDrag(e, "move")} onClick={onActivate} />
      )}
      <div className="block-resize" title="Largeur" onPointerDown={(e) => onStartDrag(e, "resize")} />
    </div>
  );
}

function TextBlock(props: { doc: Y.Doc; id: string; onEditor: (e: Editor | undefined) => void; onFocus: (e: Editor) => void }) {
  const editor = useNoteEditor(props.doc, blockField(props.id), {
    className: "note-content block-content",
    onFocus: props.onFocus,
  });
  const { onEditor } = props;
  useEffect(() => {
    if (!editor) return;
    onEditor(editor);
    return () => onEditor(undefined);
    // Enregistrement une seule fois par instance d'éditeur.
  }, [editor]);
  return <EditorContent editor={editor} />;
}

function ImageBlock({ src, onPointerDown, onClick }: { src: string; onPointerDown: (e: ReactPointerEvent) => void; onClick: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!src.startsWith(ATTACHMENT_PREFIX)) {
      setUrl(src);
      return;
    }
    const id = src.slice(ATTACHMENT_PREFIX.length);
    let cancelled = false;
    const load = () => void attachmentUrl(id).then((u) => !cancelled && setUrl(u));
    load();
    // Image pas encore téléchargée depuis la synchro : on attend son arrivée.
    const off = attachmentAdded.on((added) => added === id && load());
    return () => {
      cancelled = true;
      off();
    };
  }, [src]);
  return url ? (
    <img src={url} alt="" draggable={false} onPointerDown={onPointerDown} onClick={onClick} />
  ) : (
    <div className="image-pending" onPointerDown={onPointerDown}>
      Image en cours de synchronisation…
    </div>
  );
}
