import * as Y from "yjs";
export const REMOTE_ORIGIN = "mynote-remote";
export function emitter<T = void>() { const l = new Set<(v: T) => void>(); return { on(f: (v: T) => void) { l.add(f); return () => void l.delete(f); }, emit(v: T) { l.forEach((f) => f(v)); } }; }
export const localChange = emitter();
export const workspace = new Y.Doc();
export const workspaceReady = Promise.resolve();
export const getSnapshot = () => ({ allPageIds: [...workspace.getMap("pages").keys()] });
const docs = new Map<string, { doc: Y.Doc; ready: Promise<void> }>();
export function getPageDoc(id: string) { if (!docs.has(id)) docs.set(id, { doc: new Y.Doc(), ready: Promise.resolve() }); return docs.get(id)!; }
