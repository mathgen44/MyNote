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

// 6. Page libre (canvas) : modifications simultanées sur deux appareils
const blocks = (dev) => dev.store.getPageDoc("p2").doc.getMap("blocks");
const block = (dev, id) => blocks(dev).get(id);
{
  const doc = A.store.getPageDoc("p2").doc;
  const pg = new Y.Map(); A.store.workspace.getMap("pages").set("p2", pg); pg.set("layout", "canvas");
  doc.transact(() => {
    for (const [id, x] of [["b1", 10], ["b2", 500]]) {
      const b = new Y.Map(); blocks(A).set(id, b);
      b.set("type", "text"); b.set("x", x); b.set("y", 20); b.set("w", 300); b.set("z", 1);
      const f = doc.getXmlFragment(`block-${id}`); const p = new Y.XmlElement("paragraph"); const t = new Y.XmlText("Texte"); p.insert(0, [t]); f.insert(0, [p]);
    }
  });
}
await A.syncNow(); await B.syncNow();
ok("B reçoit les blocs du canvas", blocks(B).size === 2);
// A déplace b1, B déplace b2 et écrit dans b1, A écrit aussi dans b1 ; A crée b3, B supprime b2
block(A, "b1").set("x", 111);
block(B, "b2").set("y", 222);
B.store.getPageDoc("p2").doc.getXmlFragment("block-b1").get(0).get(0).insert(5, " de B");
A.store.getPageDoc("p2").doc.getXmlFragment("block-b1").get(0).get(0).insert(0, "A: ");
{ const b = new Y.Map(); blocks(A).set("b3", b); b.set("type", "text"); b.set("x", 0); b.set("y", 400); b.set("w", 200); b.set("z", 2); }
blocks(B).delete("b2");
await B.syncNow(); await A.syncNow(); await B.syncNow();
const state = (dev) => JSON.stringify([[...blocks(dev).keys()].sort(), blocks(dev).toJSON(), dev.store.getPageDoc("p2").doc.getXmlFragment("block-b1").toString()]);
ok("canvas : A = B après fusion", state(A) === state(B));
ok("canvas : déplacement de A conservé", block(B, "b1").get("x") === 111);
ok("canvas : bloc créé par A présent, bloc supprimé par B absent", blocks(A).has("b3") && !blocks(A).has("b2"));
ok("canvas : les deux saisies dans le même bloc sont conservées", /A: Texte de B/.test(A.store.getPageDoc("p2").doc.getXmlFragment("block-b1").toString()));
process.exit();
