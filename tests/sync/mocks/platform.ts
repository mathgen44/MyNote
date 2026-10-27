const R: Map<string, { data: Uint8Array; version: string }> = ((globalThis as any).REMOTE ??= new Map());
let v = 0;
export const google = { status: async () => ({ connected: false }), accessToken: async () => "" };
export const syncSettings = { get: async () => ({ mode: "folder", folder: "X" }), setMode: async () => {} };
export const folder = {
  list: async () => [...R].map(([name, f]) => ({ name, version: f.version })),
  read: async (name: string) => new Blob([R.get(name)!.data]),
  write: async (name: string, data: Blob) => {
    ((globalThis as any).WRITES ??= []).push(name);
    const version = String(++v) + Math.random();
    R.set(name, { data: new Uint8Array(await data.arrayBuffer()), version });
    return { name, version };
  },
};
