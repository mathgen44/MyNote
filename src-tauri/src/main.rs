// Masque la console Windows en version release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod files;
mod folder;
mod google;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(google::GoogleState::default())
        .invoke_handler(tauri::generate_handler![
            google::google_status,
            google::google_get_config,
            google::google_set_config,
            google::google_login,
            google::google_access_token,
            google::google_logout,
            files::save_file,
            folder::sync_settings,
            folder::sync_set_mode,
            folder::folder_pick,
            folder::folder_list,
            folder::folder_read,
            folder::folder_write,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de MyNote");
}
