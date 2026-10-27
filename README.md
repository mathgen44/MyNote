# MyNote

Application de prise de notes open source inspirée de OneNote, pour Windows (Tauri), avec synchronisation asynchrone sur Google Drive.

## Fonctionnalités (v1)

- **Carnets → sections → pages** avec sous-pages (deux niveaux de retrait), couleurs et menus contextuels (clic droit)
- **Éditeur riche** : titres, gras/italique/souligné/barré, surlignage multicolore, listes, **listes de tâches**, citations, code, tableaux, liens, séparateurs
- **Images et pièces jointes** : coller, glisser-déposer ou bouton 📎. Les grandes images sont réduites automatiquement
- **Glisser-déposer** de pages (réordonner, ou déposer sur une autre section pour la déplacer)
- **Recherche plein texte hors ligne** (`Ctrl+E`) dans les titres et le contenu
- **Hors ligne d'abord** : tout est enregistré localement (IndexedDB) ; la synchro Drive est un plus
- **Synchronisation Google Drive** : en arrière-plan, 5 s après une modification et toutes les 60 s, avec fusion automatique sans conflit (CRDT Yjs)
- **Export** HTML (images intégrées), Markdown, impression / PDF
- Thème clair / sombre automatique
- Raccourcis : `Ctrl+N` nouvelle page, `Ctrl+E` recherche, `Ctrl+Z` / `Ctrl+Y`, `Ctrl+clic` pour ouvrir un lien

## Développement

Prérequis : Node 20+, Rust stable, WebView2 (inclus dans Windows 11).

```bash
npm install
npm run tauri dev
```

Pour produire l'exécutable et les installateurs (`src-tauri/target/release/bundle/`) :

```bash
npm run tauri build
```

## Configurer Google Drive

Comme le projet est open source, chacun utilise son propre identifiant OAuth Google (gratuit) :

1. Sur [console.cloud.google.com](https://console.cloud.google.com), créez un projet.
2. **API et services → Bibliothèque** : activez **Google Drive API**.
3. **Écran de consentement OAuth** : type *Externe*, ajoutez le champ d'application `.../auth/drive.file`, puis **publiez l'application (En production)**.
   - En mode *Test*, Google invalide la connexion tous les 7 jours.
   - `drive.file` est un périmètre non sensible : pas d'audit de sécurité. Google affichera seulement un avertissement « application non validée » lors de la première connexion (*Paramètres avancés → Accéder à MyNote*).
4. **Identifiants → Créer → ID client OAuth → Application de bureau**.
5. Dans MyNote : ⚙ → collez l'ID client et le code secret → **Enregistrer** → **Se connecter à Google**.

Le code secret d'un client « Application de bureau » n'est pas réellement secret (Google le sait), la sécurité repose sur PKCE. Le jeton de renouvellement est stocké dans le **Gestionnaire d'identifiants Windows**.

Sur un second PC, utilisez le **même** identifiant OAuth : avec `drive.file`, l'application ne voit que les fichiers créés par son propre projet Google Cloud.

## Fonctionnement de la synchronisation

Un dossier `MyNote` est créé à la racine du Drive :

| Fichier | Contenu |
|---|---|
| `workspace.yjs` | arborescence carnets / sections / pages |
| `page-<id>.yjs` | contenu d'une page (état Yjs) |
| `att-<id>` | pièces jointes (immuables) |

À chaque cycle, pour chaque document : si la version Drive a changé, elle est téléchargée et **fusionnée** (CRDT). Si l'état local contient des modifications absentes de Drive (comparaison de snapshots Yjs, suppressions comprises), l'état fusionné est téléversé. Deux appareils modifiant la même page hors ligne convergent sans perte.

## Architecture

```
src/
  lib/store.ts        modèle Yjs (workspace + une doc par page), persistance IndexedDB
  lib/sync.ts         moteur de synchro Google Drive (API REST v3)
  lib/search.ts       index plein texte (MiniSearch)
  lib/attachments.ts  pièces jointes (Blob IndexedDB)
  lib/extensions.ts   extensions TipTap (images locales, fichiers)
  lib/platform.ts     abstraction plateforme (Tauri aujourd'hui, PWA demain)
  components/         interface React
src-tauri/src/
  google.rs           OAuth 2.0 bureau : serveur loopback + PKCE + keyring
  files.rs            « Enregistrer sous » natif
```

## Limites connues / pistes v2

- Pas encore de corbeille visible (les suppressions sont logiques et synchronisées)
- Pas de canvas libre façon OneNote (éditeur en flux)
- Pas d'écriture au stylet, d'OCR, d'audio ni d'import OneNote (API Microsoft Graph)
- Le fichier d'une page sur Drive n'est pas lisible directement (format binaire Yjs) : utiliser l'export
- PWA : il faudra un mini-backend pour les jetons Google (une application web pure n'obtient pas de jeton de renouvellement)
