// Synchronisation asynchrone avec Google Drive.
//
// Dossier Â« MyNote Â» Ã  la racine du Drive :
//   workspace.yjs        arborescence (carnets / sections / pages)
//   page-<id>.yjs        contenu de chaque page (Ã©tat Yjs complet)
//   att-<id>             piÃ¨ces jointes (immuables)
//
// Pour chaque document : si la version Drive a changÃ©, on la tÃ©lÃ©charge et on
// la fusionne (CRDT, sans conflit). Puis, si l'Ã©tat local contient quelque chose
// que Drive n'a pas (comparaison de snapshots Yjs), on tÃ©lÃ©verse l'Ã©tat fusionnÃ©.
// Deux appareils qui s'Ã©crasent mutuellement convergent au cycle suivant.

import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { createStore, del, get, keys, set } from "idb-keyval";
import { getAttachment, listAttachmentIds, storeAttachment } from "./attachments";
import { google } from "./platform";
import { REMOTE_ORIGIN, emitter, getPageDoc, getSnapshot, localChange, workspace, workspaceReady } from "./store";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER = "MyNote";
const PERIODIC_MS = 60_000;
const AFTER_EDIT_MS = 5_000;

interface RemoteFile {
  id: string;
  name: string;
  version: string;
}
interface DocMeta {
  fileId: string;
  version: string;
  snapshot: Uint8Array;
}

const meta = createStore("mynote-sync", "meta");

// --- Ã‰tat exposÃ© Ã  l'interface ---------------------------------------------

export type SyncState = "disconnected" | "idle" | "syncing" | "offline" | "error";
export interface SyncStatus {
  state: SyncState;
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

// --- Appels Drive ------------------------------------------------------------

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

async function ensureFolder(): Promise<string> {
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

async function listFolder(folderId: string): Promise<Map<string, RemoteFile>> {
  const files = new Map<string, RemoteFile>();
  let pageToken = "";
  do {
    const query = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const res = await request(
      `${DRIVE}/files?q=${query}&pageSize=1000&fields=nextPageToken,files(id,name,version)${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    const body = await res.json();
    for (const f of body.files ?? []) {
      // En cas de doublon (deux appareils ont crÃ©Ã© le mÃªme fichier), on garde le premier.
      if (!files.has(f.name)) files.set(f.name, f);
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

async function download(fileId: string): Promise<Blob> {
  return (await request(`${DRIVE}/files/${fileId}?alt=media`)).blob();
}

async function upload(folderId: string, name: string, data: Blob, existingId?: string): Promise<RemoteFile> {
  if (existingId) {
    const res = await request(`${UPLOAD}/files/${existingId}?uploadType=media&fields=id,name,version`, { method: "PATCH", body: data });
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
}

// --- Algorithme --------------------------------------------------------------

async function syncDoc(folderId: string, name: string, doc: Y.Doc, remote: RemoteFile | undefined) {
  let m = await get<DocMeta>(`doc:${name}`, meta);

  if (remote && (!m || m.fileId !== remote.id || m.version !== remote.version)) {
    const bytes = new Uint8Array(await (await download(remote.id)).arrayBuffer());
    Y.applyUpdate(doc, bytes, REMOTE_ORIGIN);
    const remoteDoc = new Y.Doc();
    Y.applyUpdate(remoteDoc, bytes);
    m = { fileId: remote.id, version: remote.version, snapshot: Y.encodeSnapshot(Y.snapshot(remoteDoc)) };
    remoteDoc.destroy();
    await set(`doc:${name}`, m, meta);
  }

  const upToDate = remote && m && m.fileId === remote.id && Y.equalSnapshots(Y.snapshot(doc), Y.decodeSnapshot(m.snapshot));
  if (upToDate) return;

  // Ã‰tat et snapshot capturÃ©s au mÃªme instant : une frappe pendant l'envoi
  // sera simplement dÃ©tectÃ©e au cycle suivant.
  const state = Y.encodeStateAsUpdate(doc);
  const snapshot = Y.encodeSnapshot(Y.snapshot(doc));
  const saved = await upload(folderId, name, new Blob([state as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }), remote?.id);
  await set(`doc:${name}`, { fileId: saved.id, version: saved.version, snapshot }, meta);
}

async function syncAttachments(folderId: string, files: Map<string, RemoteFile>) {
  const local = new Set(await listAttachmentIds());
  for (const id of local) {
    if (files.has(`att-${id}`)) continue;
    const blob = await getAttachment(id);
    if (blob) await upload(folderId, `att-${id}`, blob);
  }
  for (const [name, file] of files) {
    if (!name.startsWith("att-")) continue;
    const id = name.slice(4);
    if (!local.has(id)) await storeAttachment(id, await download(file.id));
  }
}

let running = false;
let rerun = false;

export async function syncNow(): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  setStatus({ ...status, state: "syncing", message: undefined });
  try {
    await workspaceReady;
    const folderId = await ensureFolder();
    const files = await listFolder(folderId);

    // L'arborescence d'abord : elle fait apparaÃ®tre les pages crÃ©Ã©es ailleurs.
    await syncDoc(folderId, "workspace.yjs", workspace, files.get("workspace.yjs"));

    const pageIds = new Set(getSnapshot().allPageIds);
    for (const name of files.keys()) {
      const match = /^page-(.+)\.yjs$/.exec(name);
      if (match) pageIds.add(match[1]);
    }
    for (const id of pageIds) {
      const entry = getPageDoc(id);
      await entry.ready;
      await syncDoc(folderId, `page-${id}.yjs`, entry.doc, files.get(`page-${id}.yjs`));
    }

    await syncAttachments(folderId, files);
    setStatus({ state: "idle", lastSync: Date.now() });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message === "NOT_CONNECTED") setStatus({ state: "disconnected" });
    else if (message === "SESSION_EXPIRED") setStatus({ state: "error", message: "Session Google expirÃ©e : reconnectez-vous dans les paramÃ¨tres." });
    else if (!navigator.onLine || e instanceof TypeError) setStatus({ ...status, state: "offline", message: "Hors ligne â€” synchronisation diffÃ©rÃ©e" });
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
  if (status.state === "disconnected") return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), delay);
}

let started = false;
/** DÃ©marre la synchro automatique si un compte Google est connectÃ©. */
export async function startSync() {
  const s = await google.status().catch(() => ({ configured: false, connected: false }));
  if (!s.connected) {
    setStatus({ state: "disconnected" });
    return;
  }
  setStatus({ state: "idle" });
  void syncNow();
  if (started) return;
  started = true;
  localChange.on(() => scheduleSync());
  window.setInterval(() => status.state !== "disconnected" && void syncNow(), PERIODIC_MS);
  window.addEventListener("online", () => scheduleSync(500));
}

/** Oublie l'Ã©tat de synchro local (aprÃ¨s dÃ©connexion ou changement de compte). */
export async function resetSyncState() {
  window.clearTimeout(timer);
  for (const k of await keys(meta)) await del(k, meta);
  setStatus({ state: "disconnected" });
}
