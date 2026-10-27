// Synchronisation asynchrone, vers Google Drive ou vers un dossier local
// répliqué par un client tiers (Drive pour ordinateur, OneDrive, Dropbox…).
//
// Chaque appareil n'écrit QUE ses propres fichiers, ce qui supprime tout
// conflit d'écriture (et les copies « (1) » des clients de synchro) :
//   workspace.<appareil>.yjs     arborescence carnets / sections / pages
//   page-<id>.<appareil>.yjs     contenu d'une page (état Yjs complet)
//   att-<id>                     pièces jointes (immuables)
//
// Pour chaque document : on fusionne (CRDT) les fichiers des autres appareils
// qui ont changé, puis on réécrit son propre fichier seulement si l'état local
// contient quelque chose que les fichiers distants n'ont pas (comparaison de
// snapshots Yjs, suppressions comprises). Un nouvel appareil qui n'a rien
// modifié n'écrit donc rien, et une modification ne provoque pas d'écho.

import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { createStore, del, get, keys, set } from "idb-keyval";
import { getAttachment, listAttachmentIds, storeAttachment } from "./attachments";
import { newId } from "./ids";
import { folder, google, syncSettings } from "./platform";
import type { SyncMode } from "./platform";
import { REMOTE_ORIGIN, emitter, getPageDoc, getSnapshot, localChange, workspace, workspaceReady } from "./store";

const AFTER_EDIT_MS = 5_000;

interface RemoteFile {
  id: string;
  name: string;
  version: string;
}

interface Backend {
  mode: Exclude<SyncMode, "none">;
  /** Intervalle de vérification des changements distants. */
  interval: number;
  list(): Promise<RemoteFile[]>;
  read(file: RemoteFile): Promise<Blob>;
  write(name: string, data: Blob, existing?: RemoteFile): Promise<RemoteFile>;
}

/** Ce que l'on sait des fichiers distants d'un document. */
interface DocMeta {
  /** Versions des fichiers des autres appareils déjà fusionnés. */
  files: Record<string, string>;
  /** État Yjs de l'union des fichiers distants connus. */
  union?: Uint8Array;
  snapshot?: Uint8Array;
  /** Cet appareil a déjà écrit son fichier. */
  wrote?: boolean;
}

const meta = createStore("mynote-sync", "meta");

async function deviceId(): Promise<string> {
  let id = await get<string>("deviceId", meta);
  if (!id) {
    id = newId();
    await set("deviceId", id, meta);
  }
  return id;
}

// --- État exposé à l'interface ---------------------------------------------

export type SyncState = "disconnected" | "idle" | "syncing" | "offline" | "error";
export interface SyncStatus {
  state: SyncState;
  mode?: SyncMode;
  lastSync?: number;
  message?: string;
}
let status: SyncStatus = { state: "disconnected" };
const statusChange = emitter();
function setStatus(next: SyncStatus) {
  status = next;
  statusChange.emit();
}
export const useSyncStatus = () => useSyncExternalStore(statusChange.on, () => status);

// --- Google Drive (API REST v3) -----------------------------------------------

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER = "MyNote";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await google.accessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rate/i.test(await res.clone().text()));
    if (!retryable || attempt >= 4) throw new HttpError(res.status, await res.text());
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1000 + Math.random() * 500));
  }
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function ensureDriveFolder(): Promise<string> {
  const known = await get<string>("folderId", meta);
  if (known) {
    try {
      const f = await (await request(`${DRIVE}/files/${known}?fields=id,trashed`)).json();
      if (!f.trashed) return known;
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) throw e;
    }
  }
  const query = `name='${q(ROOT_FOLDER)}' and mimeType='${FOLDER_MIME}' and trashed=false and 'root' in parents`;
  const found = await (await request(`${DRIVE}/files?q=${encodeURIComponent(query)}&fields=files(id)&orderBy=createdTime`)).json();
  let id: string | undefined = found.files?.[0]?.id;
  if (!id) {
    const created = await request(`${DRIVE}/files?fields=id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: ROOT_FOLDER, mimeType: FOLDER_MIME }),
    });
    id = (await created.json()).id as string;
  }
  await set("folderId", id, meta);
  return id;
}

function driveBackend(): Backend {
  let folderId = "";
  return {
    mode: "drive",
    interval: 60_000,
    async list() {
      folderId = await ensureDriveFolder();
      const files: RemoteFile[] = [];
      let pageToken = "";
      do {
        const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
        const res = await request(
          `${DRIVE}/files?q=${query}&pageSize=1000&fields=nextPageToken,files(id,name,version)${pageToken ? `&pageToken=${pageToken}` : ""}`,
        );
        const body = await res.json();
        files.push(...(body.files ?? []));
        pageToken = body.nextPageToken ?? "";
      } while (pageToken);
      return files;
    },
    async read(file) {
      return (await request(`${DRIVE}/files/${file.id}?alt=media`)).blob();
    },
    async write(name, data, existing) {
      if (existing) {
        const res = await request(`${UPLOAD}/files/${existing.id}?uploadType=media&fields=id,name,version`, { method: "PATCH", body: data });
        return res.json();
      }
      const boundary = "mynote" + Math.random().toString(36).slice(2);
      const metadata = JSON.stringify({ name, parents: [folderId] });
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
        `--${boundary}\r\nContent-Type: ${data.type || "application/octet-stream"}\r\n\r\n`,
        data,
        `\r\n--${boundary}--`,
      ]);
      const res = await request(`${UPLOAD}/files?uploadType=multipart&fields=id,name,version`, {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      });
      return res.json();
    },
  };
}

// --- Dossier local ------------------------------------------------------------

function folderBackend(): Backend {
  return {
    mode: "folder",
    // Lister un dossier local ne coûte rien : on vérifie plus souvent.
    interval: 15_000,
    async list() {
      return (await folder.list()).map((f) => ({ id: f.name, ...f }));
    },
    read: (file) => folder.read(file.name),
    async write(name, data) {
      const saved = await folder.write(name, data);
      return { id: saved.name, ...saved };
    },
  };
}

// --- Algorithme --------------------------------------------------------------

const DOC_FILE = /^(workspace|page-[0-9a-z]+)\.([0-9a-z]+)\.yjs$/;
const ATT_FILE = /^att-([0-9a-z]+)$/;

async function syncDoc(backend: Backend, me: string, key: string, doc: Y.Doc, files: RemoteFile[]) {
  let m: DocMeta = (await get<DocMeta>(`doc:${key}`, meta)) ?? { files: {} };
  const deviceOf = (f: RemoteFile) => DOC_FILE.exec(f.name)?.[2];
  const mine = files.find((f) => deviceOf(f) === me);
  const others = files.filter((f) => deviceOf(f) !== me);

  // Un fichier connu a disparu (appareil retiré, nettoyage) : on reconstruit
  // l'union, ce qui provoquera la réécriture de notre propre état complet.
  const present = new Set(others.map((f) => f.name));
  if (Object.keys(m.files).some((name) => !present.has(name))) m = { files: {}, wrote: m.wrote };

  let union: Y.Doc | undefined;
  for (const file of others) {
    if (m.files[file.name] === file.version) continue;
    const bytes = new Uint8Array(await (await backend.read(file)).arrayBuffer());
    Y.applyUpdate(doc, bytes, REMOTE_ORIGIN);
    if (!union) {
      union = new Y.Doc();
      if (m.union) Y.applyUpdate(union, m.union);
    }
    Y.applyUpdate(union, bytes);
    m.files[file.name] = file.version;
  }
  if (union) {
    m.union = Y.encodeStateAsUpdate(union);
    m.snapshot = Y.encodeSnapshot(Y.snapshot(union));
    union.destroy();
  }

  const known = m.snapshot ? Y.decodeSnapshot(m.snapshot) : undefined;
  const hasNews = !known || !Y.equalSnapshots(Y.snapshot(doc), known);
  if (hasNews || (m.wrote && !mine)) {
    // État et snapshot capturés au même instant : une frappe pendant l'envoi
    // sera simplement détectée au cycle suivant.
    const state = Y.encodeStateAsUpdate(doc);
    const snapshot = Y.encodeSnapshot(Y.snapshot(doc));
    await backend.write(`${key}.${me}.yjs`, new Blob([state as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), mine);
    m.union = state;
    m.snapshot = snapshot;
    m.wrote = true;
  }
  await set(`doc:${key}`, m, meta);
}

async function syncAttachments(backend: Backend, remote: Map<string, RemoteFile>) {
  const local = new Set(await listAttachmentIds());
  for (const id of local) {
    if (remote.has(id)) continue;
    const blob = await getAttachment(id);
    if (blob) await backend.write(`att-${id}`, blob);
  }
  for (const [id, file] of remote) {
    if (!local.has(id)) await storeAttachment(id, await backend.read(file));
  }
}

let backend: Backend | null = null;
let running = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  const current = backend;
  if (!current) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus({ ...status, state: "syncing", message: undefined });
  try {
    await workspaceReady;
    const me = await deviceId();
    const docs = new Map<string, RemoteFile[]>();
    const attachments = new Map<string, RemoteFile>();
    for (const file of await current.list()) {
      const doc = DOC_FILE.exec(file.name);
      if (doc) docs.set(doc[1], [...(docs.get(doc[1]) ?? []), file]);
      const att = ATT_FILE.exec(file.name);
      if (att) attachments.set(att[1], file);
    }

    // L'arborescence d'abord : elle fait apparaître les pages créées ailleurs.
    await syncDoc(current, me, "workspace", workspace, docs.get("workspace") ?? []);

    const pageIds = new Set(getSnapshot().allPageIds);
    for (const key of docs.keys()) if (key.startsWith("page-")) pageIds.add(key.slice(5));
    for (const id of pageIds) {
      const entry = getPageDoc(id);
      await entry.ready;
      await syncDoc(current, me, `page-${id}`, entry.doc, docs.get(`page-${id}`) ?? []);
    }

    await syncAttachments(current, attachments);
    if (backend === current) setStatus({ state: "idle", mode: current.mode, lastSync: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (backend !== current) return;
    if (message === "NOT_CONNECTED") setStatus({ state: "disconnected" });
    else if (message === "SESSION_EXPIRED") setStatus({ ...status, state: "error", message: "Session Google expirée : reconnectez-vous dans les paramètres." });
    else if (current.mode === "drive" && (!navigator.onLine || e instanceof TypeError))
      setStatus({ ...status, state: "offline", message: "Hors ligne — synchronisation différée" });
    else setStatus({ ...status, state: "error", message });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync(1000);
    }
  }
}

let timer = 0;
export function scheduleSync(delay = AFTER_EDIT_MS) {
  if (!backend) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

let interval = 0;
let listening = false;

/** (Re)démarre la synchro automatique selon le mode choisi dans les paramètres. */
export async function startSync() {
  const settings = await syncSettings.get().catch(() => ({ mode: "none" as SyncMode, folder: null }));
  backend = null;
  if (settings.mode === "drive") {
    const g = await google.status().catch(() => ({ connected: false }));
    if (g.connected) backend = driveBackend();
  } else if (settings.mode === "folder" && settings.folder) {
    backend = folderBackend();
  }

  window.clearInterval(interval);
  if (!backend) {
    setStatus({ state: "disconnected" });
    return;
  }
  setStatus({ state: "idle", mode: backend.mode });
  interval = window.setInterval(() => void syncNow(), backend.interval);
  void syncNow();
  if (listening) return;
  listening = true;
  localChange.on(() => scheduleSync());
  window.addEventListener("online", () => scheduleSync(500));
}

/** Oublie l'état de synchro (changement de mode ou de compte). L'identifiant d'appareil est conservé. */
export async function resetSyncState() {
  backend = null;
  window.clearTimeout(timer);
  window.clearInterval(interval);
  for (const k of await keys(meta)) if (k !== "deviceId") await del(k, meta);
  setStatus({ state: "disconnected" });
}
