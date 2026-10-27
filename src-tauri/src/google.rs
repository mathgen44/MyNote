//! Authentification Google (OAuth 2.0 « application de bureau ») :
//! redirection vers un serveur local 127.0.0.1 + PKCE, jeton de
//! renouvellement conservé dans le gestionnaire d'identifiants Windows.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
// drive.file : l'application ne voit que les fichiers qu'elle a créés
// (périmètre « non sensible », pas d'audit de sécurité Google requis).
const SCOPE: &str = "https://www.googleapis.com/auth/drive.file";
const KEYRING_SERVICE: &str = "MyNote";
const KEYRING_USER: &str = "google-refresh-token";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleConfig {
    client_id: String,
    client_secret: String,
}

#[derive(Default)]
pub struct GoogleState {
    access: Mutex<Option<(String, Instant)>>,
}

#[derive(Serialize)]
pub struct GoogleStatus {
    configured: bool,
    connected: bool,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("google.json"))
}

fn load_config(app: &AppHandle) -> Option<GoogleConfig> {
    let raw = std::fs::read_to_string(config_path(app).ok()?).ok()?;
    let cfg: GoogleConfig = serde_json::from_str(&raw).ok()?;
    (!cfg.client_id.is_empty()).then_some(cfg)
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn stored_refresh_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

fn random_b64(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

fn cache_token(state: &GoogleState, token: &TokenResponse) {
    let expiry = Instant::now() + Duration::from_secs(token.expires_in);
    *state.access.lock().unwrap() = Some((token.access_token.clone(), expiry));
}

async fn post_token(params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let res = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Google injoignable : {e}"))?;
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        if body.contains("invalid_grant") {
            return Err("SESSION_EXPIRED".into());
        }
        return Err(format!("Erreur Google : {body}"));
    }
    res.json::<TokenResponse>().await.map_err(|e| e.to_string())
}

/// Attend la redirection de Google sur le serveur local et renvoie le code.
fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    loop {
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("Délai de connexion dépassé".into());
                }
                std::thread::sleep(Duration::from_millis(200));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        };
        stream.set_nonblocking(false).ok();
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let path = request.split_whitespace().nth(1).unwrap_or("/");
        let url = reqwest::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
        let param = |key: &str| url.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned());

        let (code, error) = (param("code"), param("error"));
        if code.is_none() && error.is_none() {
            // Requête parasite (favicon…) : on l'ignore.
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let message = if code.is_some() {
            "Connexion r&eacute;ussie. Vous pouvez fermer cet onglet et revenir &agrave; MyNote."
        } else {
            "Connexion refus&eacute;e. Vous pouvez fermer cet onglet."
        };
        let body = format!("<html><body style=\"font-family:sans-serif;padding:3em\"><h2>MyNote</h2><p>{message}</p></body></html>");
        let _ = stream.write_all(
            format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
                .as_bytes(),
        );

        if let Some(error) = error {
            return Err(format!("Connexion refusée : {error}"));
        }
        if param("state").as_deref() != Some(expected_state) {
            return Err("Réponse OAuth invalide (state)".into());
        }
        return Ok(code.unwrap());
    }
}

#[tauri::command]
pub fn google_status(app: AppHandle) -> GoogleStatus {
    GoogleStatus {
        configured: load_config(&app).is_some(),
        connected: stored_refresh_token().is_some(),
    }
}

#[tauri::command]
pub fn google_get_config(app: AppHandle) -> GoogleConfig {
    load_config(&app).unwrap_or_default()
}

#[tauri::command]
pub fn google_set_config(
    app: AppHandle,
    state: State<GoogleState>,
    client_id: String,
    client_secret: String,
) -> Result<(), String> {
    let cfg = GoogleConfig { client_id: client_id.trim().into(), client_secret: client_secret.trim().into() };
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    std::fs::write(config_path(&app)?, json).map_err(|e| e.to_string())?;
    *state.access.lock().unwrap() = None;
    Ok(())
}

#[tauri::command]
pub async fn google_login(app: AppHandle, state: State<'_, GoogleState>) -> Result<(), String> {
    let cfg = load_config(&app).ok_or("Identifiants OAuth non configurés")?;
    let verifier = random_b64(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let csrf = random_b64(16);

    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}");

    let auth_url = reqwest::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", cfg.client_id.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", SCOPE),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("access_type", "offline"),
            ("prompt", "consent"),
            ("state", csrf.as_str()),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener().open_url(auth_url.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &csrf))
        .await
        .map_err(|e| e.to_string())??;

    let token = post_token(&[
        ("code", code.as_str()),
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
        ("grant_type", "authorization_code"),
        ("code_verifier", verifier.as_str()),
    ])
    .await?;
    let refresh = token.refresh_token.as_deref().ok_or("Google n'a pas fourni de jeton de renouvellement")?;
    keyring_entry()?.set_password(refresh).map_err(|e| e.to_string())?;
    cache_token(&state, &token);
    Ok(())
}

/// Renvoie un jeton d'accès valide, renouvelé si nécessaire.
#[tauri::command]
pub async fn google_access_token(app: AppHandle, state: State<'_, GoogleState>) -> Result<String, String> {
    if let Some((token, expiry)) = state.access.lock().unwrap().clone() {
        if expiry > Instant::now() + Duration::from_secs(60) {
            return Ok(token);
        }
    }
    let cfg = load_config(&app).ok_or("Identifiants OAuth non configurés")?;
    let refresh = stored_refresh_token().ok_or("NOT_CONNECTED")?;
    let token = post_token(&[
        ("client_id", cfg.client_id.as_str()),
        ("client_secret", cfg.client_secret.as_str()),
        ("refresh_token", refresh.as_str()),
        ("grant_type", "refresh_token"),
    ])
    .await?;
    cache_token(&state, &token);
    Ok(token.access_token)
}

#[tauri::command]
pub async fn google_logout(state: State<'_, GoogleState>) -> Result<(), String> {
    *state.access.lock().unwrap() = None;
    if let Some(refresh) = stored_refresh_token() {
        // Révocation « au mieux » : on déconnecte localement même hors ligne.
        let _ = reqwest::Client::new().post(REVOKE_URL).form(&[("token", refresh.as_str())]).send().await;
        keyring_entry()?.delete_credential().map_err(|e| e.to_string())?;
    }
    Ok(())
}
