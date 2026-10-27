//! Réglages de synchronisation et mode « dossier local synchronisé » :
//! MyNote écrit dans un dossier (ex. G:\Mon Drive\MyNote) que Google Drive
//! pour ordinateur, OneDrive, Dropbox ou Syncthing se charge de répliquer.
//! Les commandes de fichiers n'opèrent que dans ce dossier.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const FOLDER_NAME: &str = "MyNote";

#[derive(Default, Clone, Serialize, Deserialize)]
pub struct SyncSettings {
    /// "none", "drive" ou "folder"
    mode: String,
    folder: Option<String>,
}

#[derive(Serialize)]
pub struct FolderEntry {
    name: String,
    version: String,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("sync.json"))
}

fn load(app: &AppHandle) -> SyncSettings {
    settings_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_else(|| SyncSettings { mode: "none".into(), folder: None })
}

fn store(app: &AppHandle, settings: &SyncSettings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(app)?, json).map_err(|e| e.to_string())
}

fn sync_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = load(app).folder.ok_or("Aucun dossier de synchronisation choisi")?;
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(format!("Dossier introuvable : {}", dir.display()));
    }
    Ok(dir)
}

/// Seuls des noms simples générés par MyNote sont acceptés (pas de chemin).
fn checked(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let valid = !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_');
    if !valid {
        return Err(format!("Nom de fichier refusé : {name}"));
    }
    Ok(dir.join(name))
}

fn entry(path: &Path) -> Option<FolderEntry> {
    let meta = std::fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some(FolderEntry {
        name: path.file_name()?.to_string_lossy().into_owned(),
        version: format!("{modified}-{}", meta.len()),
    })
}

#[tauri::command]
pub fn sync_settings(app: AppHandle) -> SyncSettings {
    load(&app)
}

#[tauri::command]
pub fn sync_set_mode(app: AppHandle, mode: String) -> Result<(), String> {
    if !["none", "drive", "folder"].contains(&mode.as_str()) {
        return Err(format!("Mode inconnu : {mode}"));
    }
    store(&app, &SyncSettings { mode, ..load(&app) })
}

/// Demande un dossier ; un sous-dossier « MyNote » y est créé si besoin.
#[tauri::command]
pub async fn folder_pick(app: AppHandle) -> Result<Option<String>, String> {
    let mut dialog = app.dialog().file().set_title("Dossier de synchronisation MyNote");
    // Dossier Google Drive pour ordinateur, s'il est installé.
    for candidate in ["G:\\Mon Drive", "G:\\My Drive"] {
        if Path::new(candidate).is_dir() {
            dialog = dialog.set_directory(candidate);
            break;
        }
    }
    let Some(picked) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    let mut dir = picked.into_path().map_err(|e| e.to_string())?;
    if dir.file_name().map(|n| n != FOLDER_NAME).unwrap_or(true) {
        dir = dir.join(FOLDER_NAME);
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let folder = dir.to_string_lossy().into_owned();
    store(&app, &SyncSettings { mode: "folder".into(), folder: Some(folder.clone()) })?;
    Ok(Some(folder))
}

#[tauri::command]
pub async fn folder_list(app: AppHandle) -> Result<Vec<FolderEntry>, String> {
    let dir = sync_dir(&app)?;
    let mut out = Vec::new();
    for item in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = item.map_err(|e| e.to_string())?.path();
        if path.is_file() {
            out.extend(entry(&path));
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn folder_read(app: AppHandle, name: String) -> Result<Response, String> {
    let path = checked(&sync_dir(&app)?, &name)?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

/// Écriture atomique (fichier temporaire puis renommage) : le client de
/// synchronisation ne voit jamais un fichier à moitié écrit.
#[tauri::command]
pub async fn folder_write(app: AppHandle, request: Request<'_>) -> Result<FolderEntry, String> {
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("En-tête x-name manquant")?
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Contenu binaire attendu".into());
    };
    let dir = sync_dir(&app)?;
    let target = checked(&dir, &name)?;
    let tmp = dir.join(format!(".{name}.tmp"));
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    entry(&target).ok_or_else(|| "Fichier écrit introuvable".into())
}
