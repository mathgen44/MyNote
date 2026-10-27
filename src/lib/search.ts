// Recherche plein texte hors ligne (titres + contenu des pages).

import MiniSearch from "minisearch";
import { useSyncExternalStore } from "react";
import { emitter, getPageDoc, getSnapshot, pageContentChange, pageText, workspace, workspaceReady } from "./store";

interface Entry {
  id: string;
  title: string;
  text: string;
}

const index = new MiniSearch<Entry>({
  fields: ["title", "text"],
  storeFields: ["title"],
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3 }, combineWith: "AND" },
});
const entries = new Map<string, Entry>();
const changed = emitter();
let indexVersion = 0;

function upsert(entry: Entry) {
  if (index.has(entry.id)) index.replace(entry);
  else index.add(entry);
  entries.set(entry.id, entry);
}

async function indexPage(id: string) {
  const entry = getPageDoc(id);
  await entry.ready;
  const page = getSnapshot().pages.find((p) => p.id === id);
  if (!page) return;
  upsert({ id, title: page.title, text: pageText(entry.doc) });
  indexVersion++;
  changed.emit();
}

/** Aligne l'index sur l'arborescence (pages ajoutées, renommées, supprimées). */
function syncWithWorkspace() {
  const pages = getSnapshot().pages;
  const live = new Set(pages.map((p) => p.id));
  for (const id of [...entries.keys()]) {
    if (!live.has(id)) {
      index.discard(id);
      entries.delete(id);
    }
  }
  for (const page of pages) {
    const known = entries.get(page.id);
    if (!known) void indexPage(page.id);
    else if (known.title !== page.title) upsert({ ...known, title: page.title });
  }
  indexVersion++;
  changed.emit();
}

let timer = 0;
workspaceReady.then(() => {
  syncWithWorkspace();
  workspace.on("update", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(syncWithWorkspace, 400);
  });
  pageContentChange.on((id) => void indexPage(id));
});

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
}

export function search(query: string): SearchResult[] {
  if (!query.trim()) return [];
  return index.search(query).slice(0, 50).map((r) => {
    const text = entries.get(r.id)?.text ?? "";
    const term = r.terms[0] ?? "";
    const pos = Math.max(0, text.toLowerCase().indexOf(term.toLowerCase()));
    const start = Math.max(0, pos - 40);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, start + 140) + (start + 140 < text.length ? "…" : "");
    return { id: r.id, title: (r.title as string) || "Sans titre", snippet };
  });
}

/** Re-render des résultats quand l'index évolue. */
export function useIndexVersion() {
  return useSyncExternalStore(changed.on, () => indexVersion);
}
