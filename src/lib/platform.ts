// Couche d'abstraction plateforme : aujourd'hui Tauri (bureau).
// Pour la future PWA, il suffira de fournir une autre implémentation
// (OAuth via un mini-backend, téléchargement via <a download>).

import { invoke } from "@tauri-apps/api/core";

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
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

/** Propose d'enregistrer un fichier sur le disque. Retourne false si annulé. */
export async function saveFile(name: string, data: Blob | string): Promise<boolean> {
  const blob = typeof data === "string" ? new Blob([data]) : data;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke<boolean>("save_file", { name, data: Array.from(bytes) });
}
