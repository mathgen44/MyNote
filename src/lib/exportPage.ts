// Export d'une page (HTML autonome ou Markdown), en flux ou en canvas.

import TurndownService from "turndown";
import type * as Y from "yjs";
import { ATTACHMENT_PREFIX, blobToDataUrl, getAttachment } from "./attachments";
import { ATTACHMENT_SRC } from "./extensions";
import { fragmentToHtml } from "./noteEditor";
import { CONTENT_FIELD, blockField, readBlocks, readingOrder } from "./pageDoc";
import type { Block, Layout } from "./pageDoc";

/** Remplace les références `attachment:` par les images elles-mêmes. */
async function inlineImages(html: string): Promise<string> {
  const container = document.createElement("div");
  container.innerHTML = html;
  for (const img of Array.from(container.querySelectorAll("img"))) {
    const src = img.getAttribute(ATTACHMENT_SRC) ?? img.getAttribute("src") ?? "";
    if (!src.startsWith(ATTACHMENT_PREFIX)) continue;
    img.removeAttribute(ATTACHMENT_SRC);
    const blob = await getAttachment(src.slice(ATTACHMENT_PREFIX.length));
    if (blob) img.src = await blobToDataUrl(blob);
  }
  return container.innerHTML;
}

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function blockHtml(doc: Y.Doc, block: Block): string {
  return block.type === "text"
    ? fragmentToHtml(doc.getXmlFragment(blockField(block.id)))
    : `<img ${ATTACHMENT_SRC}="${escapeAttr(block.src ?? "")}" style="width:100%">`;
}

/** Corps HTML : les blocs du canvas gardent leur position. */
async function bodyHtml(doc: Y.Doc, layout: Layout): Promise<string> {
  if (layout === "flow") return inlineImages(fragmentToHtml(doc.getXmlFragment(CONTENT_FIELD)));
  const blocks = readBlocks(doc);
  const height = Math.max(0, ...blocks.map((b) => b.y)) + 600;
  const inner = blocks
    .map((b) => `<div style="position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;z-index:${b.z}">${blockHtml(doc, b)}</div>`)
    .join("\n");
  return inlineImages(`<div style="position:relative;min-height:${height}px">${inner}</div>`);
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export async function pageToHtml(doc: Y.Doc, layout: Layout, title: string): Promise<string> {
  const body = await bodyHtml(doc, layout);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}

/** Markdown : en canvas, les blocs sont mis bout à bout dans l'ordre de lecture. */
export async function pageToMarkdown(doc: Y.Doc, layout: Layout, title: string): Promise<string> {
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
  const parts =
    layout === "flow"
      ? [fragmentToHtml(doc.getXmlFragment(CONTENT_FIELD))]
      : readingOrder(readBlocks(doc)).map((b) => blockHtml(doc, b));
  const md = [];
  for (const html of parts) md.push(turndown.turndown(await inlineImages(html)));
  return `# ${title}\n\n${md.filter(Boolean).join("\n\n")}\n`;
}
