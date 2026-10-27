# MyNote

Application de prise de notes open source inspirée de OneNote, pour Windows (Tauri), avec synchronisation asynchrone sur Google Drive.

## Fonctionnalités (v1)

- **Carnets → sections → pages** avec sous-pages (deux niveaux de retrait), couleurs et menus contextuels (clic droit)
- **Éditeur riche** : titres, gras/italique/souligné/barré, surlignage multicolore, listes, **listes de tâches**, citations, code, tableaux, liens, séparateurs
- **Images et pièces jointes** : coller, glisser-déposer ou bouton 📎. Les grandes images sont réduites automatiquement
- **Glisser-déposer** de pages (réordonner, ou déposer sur une autre section pour la déplacer)
- **Recherche plein texte hors ligne** (`Ctrl+E`) dans les titres et le contenu
- **Hors ligne d'abord** : tout est enregistré localement (IndexedDB) ; la synchro Drive est un plus
- **Synchronisation** en arrière-plan, avec fusion automatique sans conflit (CRDT Yjs), au choix :
  - **Google Drive** : connexion en un clic
  - **Dossier synchronisé** : n'importe quel dossier répliqué par Google Drive pour ordinateur, OneDrive, Dropbox, Syncthing…
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

Test du moteur de synchronisation (plusieurs appareils simulés en mémoire) :

```bash
npm run test:sync
```

## Synchronisation

Dans MyNote : ⚙ → choisir le mode.

### Google Drive (mode principal)

Pour l'utilisateur : **Se connecter à Google**, c'est tout. Le navigateur s'ouvre, on autorise MyNote, et un dossier `MyNote` apparaît à la racine du Drive. Le jeton de renouvellement est stocké dans le **Gestionnaire d'identifiants Windows**.

MyNote n'utilise que le périmètre `drive.file` : l'application ne voit **que les fichiers qu'elle a créés**, jamais le reste du Drive.

#### Identifiant OAuth intégré (à faire une fois par le mainteneur)

L'identifiant OAuth Google est intégré à l'exécutable au moment de la compilation :

1. Sur [console.cloud.google.com](https://console.cloud.google.com), créez un projet « MyNote ».
2. **API et services → Bibliothèque** : activez **Google Drive API**.
3. **Écran de consentement OAuth** (Google Auth Platform) : type *Externe*, nom « MyNote », e-mail d'assistance ; champ d'application `https://www.googleapis.com/auth/drive.file` ; puis **Publier l'application** (statut *En production*).
   - En mode *Test*, les connexions expirent au bout de 7 jours et seuls les testeurs déclarés peuvent se connecter.
   - `drive.file` est un périmètre non sensible : **pas d'audit de sécurité**. La vérification de la marque (nom et logo affichés à l'écran de consentement) est recommandée ; elle demande une page d'accueil et une politique de confidentialité, par exemple sur GitHub Pages.
4. **Identifiants → Créer des identifiants → ID client OAuth → Application de bureau**, puis **Télécharger le JSON**.
5. Enregistrez ce fichier sous `src-tauri/google-oauth.json`. Il est ignoré par git. Vous pouvez aussi définir les variables d'environnement `MYNOTE_GOOGLE_CLIENT_ID` et `MYNOTE_GOOGLE_CLIENT_SECRET`.
6. `npm run tauri build` : l'identifiant est intégré à l'exécutable.

#### Pages exigées par Google pour la publication

Le dossier [`docs/`](docs/) contient le site public exigé par Google : page d'accueil, [politique de confidentialité](docs/privacy.html) et [conditions d'utilisation](docs/terms.html), en français et en anglais. Pour les publier sur GitHub Pages :

1. Poussez le dépôt sur GitHub (`mathgen44/MyNote`, public).
2. Dans **Settings → Pages**, choisissez la source *Deploy from a branch*, branche `main`, dossier `/docs`. Le site est alors servi à `https://mathgen44.github.io/MyNote/`.
3. Dans [Google Search Console](https://search.google.com/search-console), ajoutez la propriété *Préfixe de l'URL* `https://mathgen44.github.io/MyNote/`. Copiez la balise `google-site-verification` dans `docs/index.html` (à l'emplacement prévu), poussez, puis cliquez sur **Valider**.
4. Dans Google Auth Platform, ouvrez **Branding** et renseignez :
   - domaine autorisé : `mathgen44.github.io` ;
   - page d'accueil : `https://mathgen44.github.io/MyNote/` ;
   - règles de confidentialité : `https://mathgen44.github.io/MyNote/privacy.html` ;
   - conditions d'utilisation : `https://mathgen44.github.io/MyNote/terms.html`.
5. Dans **Audience**, cliquez sur **Publier l'application**.

Le code secret d'un client « Application de bureau » n'est pas confidentiel au sens OAuth, comme l'indique Google : la sécurité repose sur PKCE et sur la redirection locale.

Un utilisateur peut toujours utiliser son propre identifiant : ⚙ → Google Drive → *Avancé*. Tous ses appareils doivent alors utiliser le même identifiant, car `drive.file` limite l'accès aux fichiers créés par un même projet Google Cloud.

### Dossier synchronisé (alternative locale)

MyNote écrit dans un dossier choisi, par exemple `G:\Mon Drive`, où il crée un sous-dossier `MyNote`. Un logiciel tiers se charge de la réplication : Google Drive pour ordinateur, OneDrive, Dropbox, Syncthing ou Nextcloud. Il n'y a aucun compte à connecter dans MyNote. Il suffit de choisir le même dossier sur chaque PC.

### Fonctionnement

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

## Architecture

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
tests/sync/           simulation multi-appareils du moteur de synchro
```

## Limites connues / pistes v2

- Pas encore de corbeille visible (les suppressions sont logiques et synchronisées)
- Pas de canvas libre façon OneNote (éditeur en flux)
- Pas d'écriture au stylet, d'OCR, d'audio ni d'import OneNote (API Microsoft Graph)
- Le fichier d'une page sur Drive n'est pas lisible directement (format binaire Yjs) : utiliser l'export
- PWA : il faudra un mini-backend pour les jetons Google (une application web pure n'obtient pas de jeton de renouvellement)
