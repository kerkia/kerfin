// No console window next to the app in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod engine;

use tauri::{Manager, RunEvent};

fn main() {
    tauri::Builder::default()
        // A second instance would open the same vault: focus the first one instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(engine::Engine::default())
        .invoke_handler(tauri::generate_handler![engine::engine_info, engine::stop_engine])
        .setup(|app| {
            engine::start(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kerfin")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<engine::Engine>().stop();
            }
        });
}
