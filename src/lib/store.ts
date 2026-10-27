// Modèle de données local-first.
//
// - Un document Yjs « workspace » contient l'arborescence : carnets, sections,
//   pages (métadonnées). Chaque entité est une Y.Map, ce qui permet de fusionner
//   champ par champ des modifications faites hors ligne sur deux appareils.
// - Chaque page a son propre document Yjs (contenu de l'éditeur).
// - Tout est persisté dans IndexedDB ; la synchronisation Drive se greffe dessus.

import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { newId } from "./ids";
import type { Layout } from "./pageDoc";

export const REMOTE_ORIGIN = "mynote-remote";

export type Kind = "notebooks" | "sections" | "pages";

interface Base {
  id: string;
  order: number;
  deleted?: boolean;
}
export interface Notebook extends Base {
  name: string;
  color: string;
}
export interface Section extends Base {
  notebookId: string;
  name: string;
  color: string;
}
export interface Page extends Base {
  sectionId: string;
  title: string;
  level: number; // 0 = page, 1-2 = sous-page (comme OneNote)
  layout?: Layout; // absent = flux (pages créées avant le canvas)
  created: number;
  updated: number;
}

export const SECTION_COLORS = [
  "#0e7490", "#2d7ff9", "#0f9d58", "#e8710a", "#d93025",
  "#c2185b", "#00897b", "#5f6368", "#b8860b", "#3949ab",
];

// --- Petit émetteur d'événements -------------------------------------------

type Listener<T> = (value: T) => void;
export function emitter<T = void>() {
  const listeners = new Set<Listener<T>>();
  return {
    on(fn: Listener<T>) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    emit(value: T) {
      listeners.forEach((fn) => fn(value));
    },
  };
}

/** Une modification locale (pas issue de la synchro) a eu lieu. */
export const localChange = emitter();
/** Le contenu d'une page a changé (localement ou via la synchro). */
export const pageContentChange = emitter<string>();

// --- Workspace --------------------------------------------------------------

export const workspace = new Y.Doc();
const wsPersistence = new IndexeddbPersistence("mynote-workspace", workspace);
export const workspaceReady: Promise<void> = wsPersistence.whenSynced.then(() => undefined);

const map = (kind: Kind) => workspace.getMap<Y.Map<unknown>>(kind);

export interface WorkspaceSnapshot {
  notebooks: Notebook[];
  sections: Section[];
  pages: Page[];
  /** Toutes les pages, y compris supprimées (pour la synchro). */
  allPageIds: string[];
}

let version = 0;
let cached: { version: number; snap: WorkspaceSnapshot } | null = null;
const wsListeners = new Set<() => void>();

workspace.on("update", (_update: Uint8Array, origin: unknown) => {
  version++;
  wsListeners.forEach((fn) => fn());
  if (origin !== REMOTE_ORIGIN && origin !== wsPersistence) localChange.emit();
});

function readAll<T extends Base>(kind: Kind): T[] {
  const out: T[] = [];
  map(kind).forEach((entity, id) => out.push({ id, ...(entity.toJSON() as object) } as T));
  return out.sort((a, b) => a.order - b.order);
}

export function getSnapshot(): WorkspaceSnapshot {
  if (cached?.version === version) return cached.snap;
  const notebooks = readAll<Notebook>("notebooks").filter((n) => !n.deleted);
  const nbIds = new Set(notebooks.map((n) => n.id));
  const sections = readAll<Section>("sections").filter((s) => !s.deleted && nbIds.has(s.notebookId));
  const secIds = new Set(sections.map((s) => s.id));
  const allPages = readAll<Page>("pages");
  const pages = allPages.filter((p) => !p.deleted && secIds.has(p.sectionId));
  const snap = { notebooks, sections, pages, allPageIds: allPages.map((p) => p.id) };
  cached = { version, snap };
  return snap;
}

function subscribe(fn: () => void) {
  wsListeners.add(fn);
  return () => void wsListeners.delete(fn);
}

export function useWorkspace(): WorkspaceSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// --- Mutations --------------------------------------------------------------

function insert(kind: Kind, fields: Record<string, unknown>): string {
  const id = newId();
  workspace.transact(() => {
    const entity = new Y.Map<unknown>();
    map(kind).set(id, entity);
    for (const [k, v] of Object.entries(fields)) entity.set(k, v);
  });
  return id;
}

export function update(kind: Kind, id: string, patch: Record<string, unknown>) {
  const entity = map(kind).get(id);
  if (!entity) return;
  workspace.transact(() => {
    for (const [k, v] of Object.entries(patch)) entity.set(k, v);
  });
}

/** Suppression logique : l'élément reste dans le document pour la synchro. */
export function remove(kind: Kind, id: string) {
  update(kind, id, { deleted: true });
}

const nextOrder = (items: Base[]) => (items.length ? Math.max(...items.map((i) => i.order)) + 1 : 0);

export function createNotebook(name: string): { notebookId: string; sectionId: string } {
  const { notebooks } = getSnapshot();
  let sectionId = "";
  let notebookId = "";
  workspace.transact(() => {
    notebookId = insert("notebooks", { name, color: SECTION_COLORS[notebooks.length % SECTION_COLORS.length], order: nextOrder(notebooks) });
    sectionId = createSection(notebookId, "Nouvelle section");
  });
  return { notebookId, sectionId };
}

export function createSection(notebookId: string, name: string): string {
  const siblings = getSnapshot().sections.filter((s) => s.notebookId === notebookId);
  return insert("sections", {
    notebookId,
    name,
    color: SECTION_COLORS[(siblings.length + 1) % SECTION_COLORS.length],
    order: nextOrder(siblings),
  });
}

export function sectionPages(sectionId: string): Page[] {
  return getSnapshot().pages.filter((p) => p.sectionId === sectionId);
}

/** Crée une page, éventuellement juste après `afterId` (sous-page si `level` > 0). */
export function createPage(sectionId: string, opts: { afterId?: string; level?: number; layout?: Layout } = {}): string {
  const pages = sectionPages(sectionId);
  const idx = pages.findIndex((p) => p.id === opts.afterId);
  let order = nextOrder(pages);
  if (idx >= 0) {
    // On se place après la page et ses sous-pages.
    let end = idx;
    while (end + 1 < pages.length && pages[end + 1].level > pages[idx].level) end++;
    const next = pages[end + 1];
    order = next ? (pages[end].order + next.order) / 2 : pages[end].order + 1;
  }
  const now = Date.now();
  return insert("pages", { sectionId, title: "", level: opts.level ?? 0, layout: opts.layout ?? "flow", order, created: now, updated: now });
}

/** Déplace une page avant `beforeId` (ou en fin de section). */
export function movePage(pageId: string, sectionId: string, beforeId?: string) {
  const pages = sectionPages(sectionId).filter((p) => p.id !== pageId);
  const idx = beforeId ? pages.findIndex((p) => p.id === beforeId) : -1;
  let order: number;
  if (idx < 0) order = nextOrder(pages);
  else if (idx === 0) order = pages[0].order - 1;
  else order = (pages[idx - 1].order + pages[idx].order) / 2;
  update("pages", pageId, { sectionId, order });
}

// --- Documents de page ------------------------------------------------------

interface PageEntry {
  doc: Y.Doc;
  ready: Promise<void>;
}
const pageDocs = new Map<string, PageEntry>();
const touchTimers = new Map<string, number>();

export function getPageDoc(id: string): PageEntry {
  let entry = pageDocs.get(id);
  if (entry) return entry;
  const doc = new Y.Doc();
  const persistence = new IndexeddbPersistence(`mynote-page-${id}`, doc);
  entry = { doc, ready: persistence.whenSynced.then(() => undefined) };
  pageDocs.set(id, entry);

  doc.on("update", (_u: Uint8Array, origin: unknown) => {
    if (origin === persistence) return;
    if (origin === REMOTE_ORIGIN) {
      pageContentChange.emit(id);
      return;
    }
    // Édition locale : on regroupe la mise à jour de la date et l'indexation.
    window.clearTimeout(touchTimers.get(id));
    touchTimers.set(
      id,
      window.setTimeout(() => {
        update("pages", id, { updated: Date.now() });
        pageContentChange.emit(id);
      }, 1500),
    );
  });
  return entry;
}
