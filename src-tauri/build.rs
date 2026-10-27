// Intègre l'identifiant OAuth Google de MyNote dans l'exécutable.
// Source, par ordre de priorité :
//   1. variables d'environnement MYNOTE_GOOGLE_CLIENT_ID / MYNOTE_GOOGLE_CLIENT_SECRET
//   2. fichier src-tauri/google-oauth.json (le JSON téléchargé depuis la
//      console Google Cloud, tel quel ; non versionné)
// Sans l'un ou l'autre, l'utilisateur devra saisir son propre identifiant.

fn main() {
    println!("cargo:rerun-if-changed=google-oauth.json");
    println!("cargo:rerun-if-env-changed=MYNOTE_GOOGLE_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=MYNOTE_GOOGLE_CLIENT_SECRET");

    if std::env::var("MYNOTE_GOOGLE_CLIENT_ID").is_err() {
        if let Ok(raw) = std::fs::read_to_string("google-oauth.json") {
            let json: serde_json::Value = serde_json::from_str(&raw).expect("google-oauth.json invalide");
            let creds = json.get("installed").unwrap_or(&json);
            let field = |key: &str| creds.get(key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
            println!("cargo:rustc-env=MYNOTE_GOOGLE_CLIENT_ID={}", field("client_id"));
            println!("cargo:rustc-env=MYNOTE_GOOGLE_CLIENT_SECRET={}", field("client_secret"));
        }
    }

    tauri_build::build()
}
