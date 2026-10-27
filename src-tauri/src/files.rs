use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

/// Ouvre la boîte « Enregistrer sous » et écrit le contenu fourni.
/// Retourne `false` si l'utilisateur a annulé.
#[tauri::command]
pub async fn save_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<bool, String> {
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Ouvre une pièce jointe avec l'application associée de Windows.
/// Le contenu brut arrive dans le corps de la requête ; l'identifiant et le
/// nom (encodé en URL, les en-têtes n'acceptant que l'ASCII) dans les en-têtes
/// x-id et x-name. Le fichier est copié dans le cache de MyNote : les
/// modifications faites dans l'autre application ne reviennent pas dans la note.
#[tauri::command]
pub async fn open_file(app: AppHandle, request: Request<'_>) -> Result<(), String> {
    let header = |key: &str| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .ok_or(format!("En-tête {key} manquant"))
    };
    let id = header("x-id")?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(format!("Identifiant invalide : {id}"));
    }
    let name: String = percent_decode_str(header("x-name")?)
        .decode_utf8_lossy()
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let name = name.trim_matches(|c| c == '.' || c == ' ');
    let name = if name.is_empty() { "fichier" } else { name };
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Contenu binaire attendu".into());
    };

    // Un dossier par pièce jointe : deux fichiers de même nom ne se mélangent pas.
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("open").join(id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(name);
    // Déjà extrait (et peut-être encore ouvert, donc verrouillé) : on le réutilise.
    if !path.exists() {
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    }
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
