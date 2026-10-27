// Simulation de plusieurs appareils partageant un dossier de synchro (en mémoire).
// Usage : npm run test:sync
import * as Y from "yjs";
globalThis.window = globalThis; globalThis.addEventListener = () => {};
const A = await import("./bundle.mjs?A");
const B = await import("./bundle.mjs?B");
const text = (dev, id) => dev.store.getPageDoc(id).doc.getText("t").toString();
const writes = () => { const w = globalThis.WRITES ?? []; globalThis.WRITES = []; return w.join(", ") || "(aucune)"; };
const ok = (label, cond) => { console.log((cond ? "OK   " : "ECHEC") + " " + label); if (!cond) process.exitCode = 1; };

// 1. A crée une page avec une image, puis synchronise
const p = new Y.Map(); A.store.workspace.getMap("pages").set("p1", p); p.set("title", "Réunion");
A.store.getPageDoc("p1").doc.getText("t").insert(0, "hello");
A.att.saveLocal("img1", new Blob(["PNG"]));
await A.startSync(); await new Promise((r) => setTimeout(r, 1500));
console.log("A écrit :", writes());

// 2. B, appareil neuf, récupère tout sans rien écrire
await B.startSync(); await new Promise((r) => setTimeout(r, 1500));
ok("B récupère la page", text(B, "p1") === "hello");
ok("B récupère le titre", B.store.workspace.getMap("pages").get("p1")?.get("title") === "Réunion");
ok("B récupère l'image", (await B.att.getAttachment("img1")) !== undefined);
ok("appareil neuf : aucune écriture", writes() === "(aucune)");

// 3. Modifications concurrentes hors ligne : B ajoute, A supprime seulement
B.store.getPageDoc("p1").doc.getText("t").insert(5, " world");
A.store.getPageDoc("p1").doc.getText("t").delete(0, 1);
await B.syncNow(); await A.syncNow(); await B.syncNow();
console.log("écritures :", writes());
ok("convergence A = B", text(A, "p1") === text(B, "p1"));
ok("suppression + ajout conservés", text(A, "p1") === "ello world");

// 4. Plus rien à faire : aucune écriture en écho
await A.syncNow(); await B.syncNow(); await A.syncNow();
ok("pas d'écho", writes() === "(aucune)");

// 5. Fichier d'un appareil supprimé à la main : l'autre réécrit l'état complet
const pageFiles = [...globalThis.REMOTE.keys()].filter((n) => n.startsWith("page-p1."));
console.log("fichiers de la page :", pageFiles.join(", "));
globalThis.REMOTE.delete(pageFiles[0]);
await A.syncNow(); await B.syncNow();
console.log("réécritures :", writes());
const C = await import("./bundle.mjs?C"); await C.startSync(); await new Promise((r) => setTimeout(r, 1500));
ok("un 3e appareil récupère tout après suppression", text(C, "p1") === "ello world");
process.exit();
