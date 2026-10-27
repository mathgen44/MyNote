# MyNote

Application de prise de notes open source organisée en carnets, sections et pages, pour Windows (Tauri), avec synchronisation asynchrone sur Google Drive.

**[Télécharger](https://github.com/mathgen44/MyNote/releases/latest)** · **[Site](https://mathgen44.github.io/MyNote/)** · [Confidentialité](https://mathgen44.github.io/MyNote/privacy.html) · [Conditions d'utilisation](https://mathgen44.github.io/MyNote/terms.html)

## Installation

1. Téléchargez `MyNote_x.y.z_x64-setup.exe` depuis la [dernière version](https://github.com/mathgen44/MyNote/releases/latest) et lancez-le. Le `.msi` sert aux déploiements en entreprise.
2. L'installateur n'est pas signé : si Windows SmartScreen affiche « Windows a protégé votre ordinateur », cliquez sur **Informations complémentaires** puis **Exécuter quand même**.
3. Pour synchroniser vos notes entre plusieurs PC : ⚙ → **Google Drive** → **Se connecter à Google**. Pas d'autre réglage.

Une nouvelle version s'installe par-dessus l'ancienne. Les notes et la connexion Google sont conservées.

## Fonctionnalités

- **Carnets → sections → pages** avec sous-pages (deux niveaux de retrait), couleurs et menus contextuels (clic droit)
- **Éditeur riche** : titres, gras/italique/souligné/barré, surlignage multicolore, listes, **listes de tâches**, citations, code, tableaux, liens, séparateurs
- **Images et pièces jointes** : coller, glisser-déposer ou bouton 📎. Les grandes images sont réduites automatiquement
- **Glisser-déposer** de pages (réordonner, ou déposer sur une autre section pour la déplacer)
- **Recherche plein texte hors ligne** (`Ctrl+E`) dans les titres et le contenu
- **Hors ligne d'abord** : tout est enregistré localement (IndexedDB) ; la synchronisation est un plus
- **Synchronisation** en arrière-plan, avec fusion automatique sans conflit (CRDT Yjs), au choix :
  - **Google Drive** : connexion en un clic
  - **Dossier synchronisé** : n'importe quel dossier répliqué par Google Drive pour ordinateur, OneDrive, Dropbox, Syncthing…
- **Export** HTML (images intégrées), Markdown, impression / PDF
- Thème clair / sombre automatique
- Raccourcis : `Ctrl+N` nouvelle page, `Ctrl+E` recherche, `Ctrl+Z` / `Ctrl+Y`, `Ctrl+clic` pour ouvrir un lien

## Connexion à Google Drive : comment ça marche

L'utilisateur n'a **rien à configurer** : l'identifiant OAuth de MyNote est intégré à l'exécutable. Il ne crée donc ni projet Google Cloud ni identifiant. Un clic sur « Se connecter à Google » déclenche le flux OAuth 2.0 prévu par Google pour les [applications de bureau](https://developers.google.com/identity/protocols/oauth2/native-app) :

```
MyNote (Rust)                          Navigateur                       Google
─────────────                          ──────────                       ──────
1. ouvre un serveur local
   http://127.0.0.1:<port aléatoire>
2. génère un secret PKCE (S256)
3. ouvre le navigateur par défaut ───▶ page de connexion Google ─────▶ l'utilisateur autorise
                                        « MyNote » (drive.file)
4. reçoit le code d'autorisation  ◀─── redirection vers 127.0.0.1 ◀──
5. échange code + secret PKCE ──────────────────────────────────────▶ jeton d'accès (1 h)
                                                                       + jeton de renouvellement
6. range le jeton de renouvellement
   dans le Gestionnaire d'identifiants Windows
```

- **Navigateur système, pas de fenêtre intégrée** : l'utilisateur se connecte dans son navigateur habituel, avec ses mots de passe et sa double authentification. MyNote ne voit jamais le mot de passe Google.
- **PKCE + redirection locale** : seul le processus MyNote qui a lancé la connexion peut récupérer le code. C'est cela qui sécurise le flux. Le « code secret » d'un client de type *Application de bureau* n'est pas confidentiel, Google le précise lui-même, et peut donc être intégré à l'exécutable.
- **Accès minimal `drive.file`** : MyNote ne voit **que les fichiers qu'il a créés** (le dossier `MyNote` à la racine du Drive), jamais le reste. Ce périmètre « non sensible » ne demande pas d'audit de sécurité Google.
- **Jetons** : le jeton d'accès reste en mémoire et se renouvelle automatiquement. Le jeton de renouvellement est conservé dans le Gestionnaire d'identifiants Windows, jamais dans un fichier. **Se déconnecter** le révoque auprès de Google et l'efface.
- **Appels Drive** : l'interface appelle directement l'API REST Google Drive v3. MyNote n'a pas de serveur.

Un utilisateur peut aussi utiliser **son propre identifiant OAuth** : ⚙ → Google Drive → *Avancé*. Tous ses appareils doivent alors utiliser le même, car `drive.file` limite l'accès aux fichiers créés par un même projet Google Cloud.

## Dossier synchronisé (alternative sans compte)

MyNote écrit dans un dossier choisi, par exemple `G:\Mon Drive`, où il crée un sous-dossier `MyNote`. Un logiciel tiers se charge de la réplication : Google Drive pour ordinateur, OneDrive, Dropbox, Syncthing ou Nextcloud. Aucun compte n'est connecté dans MyNote. Il suffit de choisir le même dossier sur chaque PC.

## Fonctionnement de la synchronisation

Le format est identique dans les deux modes. **Chaque appareil n'écrit que ses propres fichiers**, il n'y a donc jamais de conflit d'écriture ni de copie « (1) » :

| Fichier | Contenu |
|---|---|
| `workspace.<appareil>.yjs` | arborescence carnets / sections / pages |
| `page-<id>.<appareil>.yjs` | contenu d'une page (état Yjs) |
| `att-<id>` | pièces jointes (immuables) |

À chaque cycle, l'application procède en deux temps :

1. Elle fusionne les fichiers des autres appareils qui ont changé (CRDT : rien ne se perd, même avec des modifications hors ligne des deux côtés).
2. Elle réécrit son propre fichier, mais seulement si l'état local contient quelque chose d'absent des fichiers distants. La comparaison se fait par snapshots Yjs et tient compte des suppressions.

Conséquences : un nouvel appareil n'écrit rien tant qu'il ne modifie rien, et une modification ne provoque pas d'écho chez les autres appareils.

La synchronisation a lieu 5 s après une modification, puis toutes les 60 s en mode Drive et toutes les 15 s en mode dossier.

## Développement

Prérequis : Node 20+, Rust stable, WebView2 (inclus dans Windows 11).

```bash
npm install
npm run tauri dev
```

Exécutable et installateurs (`src-tauri/target/release/bundle/`) :

```bash
npm run tauri build
```

Test du moteur de synchronisation (plusieurs appareils simulés en mémoire) :

```bash
npm run test:sync
```

### Architecture

```
src/
  lib/store.ts        modèle Yjs (workspace + une doc par page), persistance IndexedDB
  lib/sync.ts         moteur de synchro (Google Drive API v3 ou dossier local)
  lib/search.ts       index plein texte (MiniSearch)
  lib/attachments.ts  pièces jointes (Blob IndexedDB)
  lib/extensions.ts   extensions TipTap (images locales, fichiers)
  lib/platform.ts     abstraction plateforme (Tauri aujourd'hui, PWA demain)
  components/         interface React
src-tauri/src/
  google.rs           OAuth 2.0 bureau : serveur loopback + PKCE + keyring
  folder.rs           réglages de synchro, mode dossier (lecture / écriture atomique)
  files.rs            « Enregistrer sous » natif
src-tauri/build.rs    intègre l'identifiant OAuth (google-oauth.json)
docs/                 site public (GitHub Pages)
tests/sync/           simulation multi-appareils du moteur de synchro
```

## Limites connues / pistes

- Pas encore de corbeille visible (les suppressions sont logiques et synchronisées)
- Pas de canvas libre façon OneNote (éditeur en flux) : prévu pour la prochaine version
- Pas d'écriture au stylet, d'OCR, d'audio ni d'import OneNote (API Microsoft Graph)
- Le fichier d'une page sur Drive n'est pas lisible directement (format binaire Yjs) : utiliser l'export
- PWA : il faudra un mini-backend pour les jetons Google (une application web pure n'obtient pas de jeton de renouvellement)
