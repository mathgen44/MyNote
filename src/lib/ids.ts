export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 20);
