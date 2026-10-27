import { useEffect, useState } from "react";
import { folder, google, syncSettings } from "../lib/platform";
import type { GoogleStatus, SyncMode, SyncSettings } from "../lib/platform";
import { resetSyncState, startSync, syncNow, useSyncStatus } from "../lib/sync";
import { AppearanceSettings } from "./AppearanceSettings";

export type SettingsTab = "appearance" | "sync";

const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeStyle: "medium" });

const MODES: { mode: SyncMode; title: string; description: string }[] = [
  { mode: "drive", title: "Google Drive", description: "Recommandé. Connexion en un clic, aucun logiciel à installer." },
  { mode: "folder", title: "Dossier synchronisé", description: "Sans compte dans MyNote : Google Drive pour ordinateur, OneDrive, Dropbox…" },
  { mode: "none", title: "Aucune", description: "Les notes restent uniquement sur cet ordinateur." },
];

export function SettingsDialog({ tab: initialTab, onClose }: { tab: SettingsTab; onClose: () => void }) {
  const sync = useSyncStatus();
  const [tab, setTab] = useState(initialTab);
  const [settings, setSettings] = useState<SyncSettings>({ mode: "none" });
  const [view, setView] = useState<SyncMode>();
  const [gStatus, setGStatus] = useState<GoogleStatus>({ configured: false, connected: false, builtin: false });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    const [s, g] = await Promise.all([syncSettings.get(), google.status()]);
    setSettings(s);
    setGStatus(g);
    setView((v) => v ?? s.mode);
  };

  useEffect(() => {
    void refresh();
    void google.getConfig().then((c) => {
      setClientId(c.clientId);
      setClientSecret(c.clientSecret);
    });
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  /** Change de mode : l'état de synchro précédent est oublié, les notes locales restent. */
  const activate = async (mode: SyncMode) => {
    await resetSyncState();
    await syncSettings.setMode(mode);
    await startSync();
  };

  const status = (
    <p className="hint">
      État : {labelFor(sync.state)}
      {sync.lastSync && ` — dernière synchro à ${timeFmt.format(sync.lastSync)}`}
      {sync.message && (
        <>
          <br />
          {sync.message}
        </>
      )}
    </p>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="tabs">
          <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}>
            Apparence
          </button>
          <button className={tab === "sync" ? "active" : ""} onClick={() => setTab("sync")}>
            Synchronisation
          </button>
        </div>

        {tab === "appearance" && <AppearanceSettings />}

        {tab === "sync" && (
          <>
            <div className="mode-list">
              {MODES.map((m) => (
                <label key={m.mode} className={"mode-option" + (view === m.mode ? " selected" : "")}>
                  <input type="radio" name="mode" checked={view === m.mode} onChange={() => setView(m.mode)} />
                  <span>
                    <b>{m.title}</b>
                    {settings.mode === m.mode && <span className="badge">actif</span>}
                    <br />
                    <span className="hint">{m.description}</span>
                  </span>
                </label>
              ))}
            </div>

            {view === "drive" && (
              <section>
                {gStatus.connected && settings.mode === "drive" ? (
                  <>
                    <p>
                      ✅ Connecté — dossier <b>MyNote</b> à la racine de votre Drive.
                    </p>
                    <div className="row">
                      <button className="primary" disabled={busy || sync.state === "syncing"} onClick={() => run(syncNow)}>
                        Synchroniser maintenant
                      </button>
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await google.logout();
                            await activate("none");
                          })
                        }
                      >
                        Se déconnecter
                      </button>
                    </div>
                    {status}
                  </>
                ) : (
                  <>
                    <button
                      className="primary"
                      disabled={busy || !gStatus.configured}
                      onClick={() =>
                        run(async () => {
                          if (!gStatus.connected) await google.login();
                          await activate("drive");
                        })
                      }
                    >
                      {busy ? "Connexion dans le navigateur…" : gStatus.connected ? "Activer la synchro Google Drive" : "Se connecter à Google"}
                    </button>
                    {!gStatus.configured && (
                      <p className="hint">Cette version de MyNote n'inclut pas d'identifiant Google : renseignez le vôtre ci-dessous.</p>
                    )}
                  </>
                )}

                <details open={!gStatus.configured}>
                  <summary>Avancé : utiliser mon propre identifiant OAuth</summary>
                  <p className="hint">
                    Facultatif{gStatus.builtin ? " : l'identifiant intégré suffit" : ""}. Projet Google Cloud avec l'API Drive activée et un
                    identifiant OAuth de type <b>Application de bureau</b> (voir README). Laissez vide pour revenir à l'identifiant intégré.
                  </p>
                  <label>
                    ID client
                    <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
                  </label>
                  <label>
                    Code secret du client
                    <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" />
                  </label>
                  <button disabled={busy} onClick={() => run(() => google.setConfig({ clientId, clientSecret }))}>
                    Enregistrer
                  </button>
                </details>
              </section>
            )}

            {view === "folder" && (
              <section>
                <p className="hint">
                  Choisissez un dossier répliqué par votre logiciel de synchronisation, par exemple <code>G:\Mon Drive</code> avec Google Drive
                  pour ordinateur. Un sous-dossier <b>MyNote</b> y sera créé. Choisissez le même dossier sur chaque PC.
                </p>
                {settings.mode === "folder" && settings.folder && (
                  <p>
                    📁 <code>{settings.folder}</code>
                  </p>
                )}
                <div className="row">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        if (!(await folder.pick())) return;
                        await resetSyncState();
                        await startSync();
                      })
                    }
                  >
                    {settings.mode === "folder" ? "Changer de dossier…" : "Choisir un dossier…"}
                  </button>
                  {settings.mode === "folder" && (
                    <button disabled={busy || sync.state === "syncing"} onClick={() => run(syncNow)}>
                      Synchroniser maintenant
                    </button>
                  )}
                </div>
                {settings.mode === "folder" && status}
              </section>
            )}

            {view === "none" && settings.mode !== "none" && (
              <section>
                <button className="danger" disabled={busy} onClick={() => run(() => activate("none"))}>
                  Désactiver la synchronisation
                </button>
                <p className="hint">Les notes déjà présentes sur cet ordinateur sont conservées.</p>
              </section>
            )}

            {error && <p className="error">{error}</p>}
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}

export function labelFor(state: string) {
  return (
    {
      disconnected: "non synchronisé",
      idle: "à jour",
      syncing: "synchronisation…",
      offline: "hors ligne",
      error: "erreur",
    } as Record<string, string>
  )[state];
}
