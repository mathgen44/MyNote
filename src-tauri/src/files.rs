use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

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
