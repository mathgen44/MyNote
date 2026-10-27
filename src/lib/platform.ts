// Couche d'abstraction plateforme : aujourd'hui Tauri (bureau).
// Pour la future PWA, il suffira de fournir une autre implémentation
// (OAuth via un mini-backend, téléchargement via <a download>).

import { invoke } from "@tauri-apps/api/core";

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  /** Un identifiant OAuth est intégré à cette version. */
  builtin: boolean;
}
export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

export const google = {
  status: () => invoke<GoogleStatus>("google_status"),
  getConfig: () => invoke<GoogleConfig>("google_get_config"),
  setConfig: (c: GoogleConfig) => invoke<void>("google_set_config", { clientId: c.clientId, clientSecret: c.clientSecret }),
  login: () => invoke<void>("google_login"),
  accessToken: () => invoke<string>("google_access_token"),
  logout: () => invoke<void>("google_logout"),
};

export type SyncMode = "none" | "drive" | "folder";
export interface SyncSettings {
  mode: SyncMode;
  folder?: string | null;
}
export interface FolderEntry {
  name: string;
  version: string;
}

export const syncSettings = {
  get: () => invoke<SyncSettings>("sync_settings"),
  setMode: (mode: SyncMode) => invoke<void>("sync_set_mode", { mode }),
};

/** Dossier local synchronisé par un client tiers (Drive pour ordinateur…). */
export const folder = {
  pick: () => invoke<string | null>("folder_pick"),
  list: () => invoke<FolderEntry[]>("folder_list"),
  read: async (name: string) => new Blob([await invoke<ArrayBuffer>("folder_read", { name })]),
  write: async (name: string, data: Blob) =>
    invoke<FolderEntry>("folder_write", new Uint8Array(await data.arrayBuffer()), { headers: { "x-name": name } }),
};

/** Propose d'enregistrer un fichier sur le disque. Retourne false si annulé. */
export async function saveFile(name: string, data: Blob | string): Promise<boolean> {
  const blob = typeof data === "string" ? new Blob([data]) : data;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<boolean>("save_file", { name, data: Array.from(bytes) });
}
