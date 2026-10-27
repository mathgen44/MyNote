import { useEffect, useState } from "react";
import { google } from "../lib/platform";
import type { GoogleStatus } from "../lib/platform";
import { resetSyncState, startSync, syncNow, useSyncStatus } from "../lib/sync";

const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeStyle: "medium" });

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const sync = useSyncStatus();
  const [status, setStatus] = useState<GoogleStatus>({ configured: false, connected: false });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = async () => setStatus(await google.status());

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

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Synchronisation Google Drive</h3>

        <section>
          <h4>1. Identifiants OAuth</h4>
          <p className="hint">
            Créez un projet sur <b>console.cloud.google.com</b>, activez l'<b>API Google Drive</b>, configurez l'écran de
            consentement (périmètre <code>drive.file</code>, statut <b>En production</b>), puis créez un identifiant OAuth de type
            <b> Application de bureau</b>. Le détail est dans le README.
          </p>
          <label>
            ID client
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="xxxx.apps.googleusercontent.com" />
          </label>
          <label>
            Code secret du client
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" />
          </label>
          <button disabled={busy || !clientId.trim()} onClick={() => run(() => google.setConfig({ clientId, clientSecret }))}>
            Enregistrer
          </button>
        </section>

        <section>
          <h4>2. Compte Google</h4>
          {status.connected ? (
            <>
              <p>
                ✅ Connecté — dossier <b>MyNote</b> dans votre Drive.
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
                      await resetSyncState();
                    })
                  }
                >
                  Se déconnecter
                </button>
              </div>
            </>
          ) : (
            <button
              className="primary"
              disabled={busy || !status.configured}
              onClick={() =>
                run(async () => {
                  await google.login();
                  await startSync();
                })
              }
            >
              {busy ? "Connexion dans le navigateur…" : "Se connecter à Google"}
            </button>
          )}
          <p className="hint">
            État : {labelFor(sync.state)}
            {sync.lastSync && ` — dernière synchro à ${timeFmt.format(sync.lastSync)}`}
            {sync.message && <><br />{sync.message}</>}
          </p>
        </section>

        {error && <p className="error">{error}</p>}
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
      disconnected: "non connecté",
      idle: "à jour",
      syncing: "synchronisation…",
      offline: "hors ligne",
      error: "erreur",
    } as Record<string, string>
  )[state];
}
