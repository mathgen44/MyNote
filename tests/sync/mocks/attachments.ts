const a = new Map<string, Blob>();
export const listAttachmentIds = async () => [...a.keys()];
export const getAttachment = async (id: string) => a.get(id);
export const storeAttachment = async (id: string, b: Blob) => void a.set(id, b);
export const saveLocal = (id: string, b: Blob) => a.set(id, b);
