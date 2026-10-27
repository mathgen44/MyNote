// Pièces jointes (images, fichiers) : stockées en Blob dans IndexedDB,
// référencées dans les pages par leur identifiant (`attachment:<id>`).
// Elles sont immuables, ce qui rend leur synchronisation triviale.

import { createStore, get, keys, set } from "idb-keyval";
import { newId } from "./ids";
import { emitter } from "./store";

export const ATTACHMENT_PREFIX = "attachment:";

const blobs = createStore("mynote-attachments", "blobs");
const urls = new Map<string, string>();

/** Émis quand une pièce jointe arrive (par ex. téléchargée depuis Drive). */
export const attachmentAdded = emitter<string>();

const MAX_IMAGE_SIDE = 2560;

/** Réduit les très grandes images pour garder une base légère. */
async function shrinkImage(file: Blob): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale >= 1) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), type, 0.88));
}

export async function saveAttachment(file: Blob): Promise<string> {
  const id = newId();
  await set(id, await shrinkImage(file), blobs);
  return id;
}

export async function storeAttachment(id: string, blob: Blob) {
  await set(id, blob, blobs);
  attachmentAdded.emit(id);
}

export const getAttachment = (id: string) => get<Blob>(id, blobs);

export async function listAttachmentIds(): Promise<string[]> {
  return (await keys(blobs)).map(String);
}

export async function attachmentUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return known;
  const blob = await getAttachment(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
