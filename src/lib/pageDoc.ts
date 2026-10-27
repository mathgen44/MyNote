// Contenu d'une page (un document Yjs par page), selon sa mise en page :
//
// - « flux »   : un seul fragment `content`, édité par TipTap ;
// - « canvas » : des blocs positionnés librement (map `blocks`). Chaque bloc de
//   texte a son propre fragment `block-<id>`, édité par sa propre instance TipTap.
//
// Les blocs sont des Y.Map : deux appareils qui déplacent des blocs différents,
// ou écrivent dans le même bloc, fusionnent sans conflit. Supprimer un bloc ne
// retire que son entrée dans `blocks` : son texte reste dans le document, ce qui
// permet de l'annuler.

import * as Y from "yjs";
import { newId } from "./ids";

export const CONTENT_FIELD = "content";

export type Layout = "flow" | "canvas";
export type BlockType = "text" | "image";

export interface Block {
  id: string;
  type: BlockType;
  x: number;
  y: number;
  /** Largeur en px ; la hauteur suit le contenu. */
  w: number;
  z: number;
  /** Image : `attachment:<id>`. */
  src?: string;
}

export const blockField = (id: string) => `block-${id}`;
export const blocksOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("blocks");

export function readBlocks(doc: Y.Doc): Block[] {
  const out: Block[] = [];
  blocksOf(doc).forEach((b, id) => out.push({ id, ...(b.toJSON() as Omit<Block, "id">) }));
  return out.sort((a, b) => a.z - b.z);
}

/** Ordre de lecture : de haut en bas, puis de gauche à droite. */
export function readingOrder(blocks: Block[]): Block[] {
  return [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
}

const topZ = (doc: Y.Doc) => readBlocks(doc).reduce((max, b) => Math.max(max, b.z || 0), 0);

export function addBlock(doc: Y.Doc, fields: Omit<Block, "id" | "z">): string {
  const id = newId();
  // z calculé avant l'insertion : le nouveau bloc n'a pas encore de z.
  const z = topZ(doc) + 1;
  doc.transact(() => {
    const block = new Y.Map<unknown>();
    blocksOf(doc).set(id, block);
    for (const [k, v] of Object.entries({ ...fields, z })) block.set(k, v);
  });
  return id;
}

export function updateBlock(doc: Y.Doc, id: string, patch: Partial<Omit<Block, "id">>) {
  const block = blocksOf(doc).get(id);
  if (!block) return;
  doc.transact(() => {
    for (const [k, v] of Object.entries(patch)) if (block.get(k) !== v) block.set(k, v);
  });
}

export function bringToFront(doc: Y.Doc, id: string) {
  const top = topZ(doc);
  const block = blocksOf(doc).get(id);
  if (block && block.get("z") !== top) block.set("z", top + 1);
}

export function removeBlock(doc: Y.Doc, id: string) {
  blocksOf(doc).delete(id);
}

const cloneChildren = (fragment: Y.XmlFragment) =>
  fragment.toArray().map((node) => (node as Y.XmlElement | Y.XmlText).clone());

/** Flux → canvas : le contenu existant devient un premier bloc de texte. */
export function convertToCanvas(doc: Y.Doc) {
  const content = doc.getXmlFragment(CONTENT_FIELD);
  if (content.length === 0) return;
  doc.transact(() => {
    const id = addBlock(doc, { type: "text", x: 48, y: 24, w: 760 });
    doc.getXmlFragment(blockField(id)).insert(0, cloneChildren(content));
    content.delete(0, content.length);
  });
}

/** Canvas → flux : les blocs sont mis bout à bout dans l'ordre de lecture. */
export function convertToFlow(doc: Y.Doc) {
  const content = doc.getXmlFragment(CONTENT_FIELD);
  doc.transact(() => {
    for (const block of readingOrder(readBlocks(doc))) {
      if (block.type === "text") {
        const fragment = doc.getXmlFragment(blockField(block.id));
        content.push(cloneChildren(fragment));
        fragment.delete(0, fragment.length);
      } else if (block.src) {
        const image = new Y.XmlElement("image");
        image.setAttribute("src", block.src);
        content.push([image]);
      }
      removeBlock(doc, block.id);
    }
  });
}

/** Texte brut d'une page, quelle que soit sa mise en page (recherche). */
export function pageText(doc: Y.Doc): string {
  const fragments = [
    doc.getXmlFragment(CONTENT_FIELD),
    ...readingOrder(readBlocks(doc))
      .filter((b) => b.type === "text")
      .map((b) => doc.getXmlFragment(blockField(b.id))),
  ];
  return fragments
    .map((f) => f.toString())
    .join(" ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
