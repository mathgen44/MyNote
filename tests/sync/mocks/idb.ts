export const createStore = () => new Map<string, unknown>();
export const get = async (k: string, s: Map<string, unknown>) => structuredClone(s.get(k)) as any;
export const set = async (k: string, v: unknown, s: Map<string, unknown>) => void s.set(k, structuredClone(v));
export const del = async (k: string, s: Map<string, unknown>) => void s.delete(k);
export const keys = async (s: Map<string, unknown>) => [...s.keys()];
