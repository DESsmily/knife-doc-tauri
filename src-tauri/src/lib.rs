mod commands;
mod data_layout;
mod persist;
mod settings;
mod tray;

use tauri::{Manager, WindowEvent};

use crate::data_layout::DataLayout;
use crate::settings::{CloseBehavior, SettingsStore};

use tauri::menu::{MenuBuilder, PredefinedMenuItem};

pub struct AppState {
    pub layout: DataLayout,
    pub settings: SettingsStore,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 关键：透明接管 WebView 的 fetch / XMLHttpRequest，让所有 http(s) 请求
        // 改由 Rust 侧发出，从而绕开浏览器同源策略。前端的 axios 无需任何改动。
        .plugin(tauri_plugin_better_cors_fetch::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::default().build())
        // 数据文件是整份读写的，必须保证只有一个实例，否则两个窗口会互相覆盖。
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::show_main(app);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            let layout = data_layout::resolve(&handle);
            let settings = SettingsStore::load(&layout.settings_file);
            app.manage(AppState { layout, settings });

            let menu = MenuBuilder::new(app)
                .copy()
                .separator()
                .undo()
                .redo()
                .cut()
                .paste()
                .select_all()
                .item(&PredefinedMenuItem::copy(app, Some("custom text"))?)
                .build()?;
            app.set_menu(menu)?;

            tray::build(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭按钮按设置二选一：隐藏到托盘（默认）或直接退出进程。
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            if window.label() != "main" {
                return;
            }
            let behavior = window
                .app_handle()
                .state::<AppState>()
                .settings
                .snapshot()
                .close_behavior;
            if behavior == CloseBehavior::MinimizeToTray {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_app_info,
            commands::read_data,
            commands::write_data,
            commands::get_settings,
            commands::set_settings,
            commands::write_text_file,
            commands::write_cache_text,
            commands::read_cache_text,
            commands::write_temp_text,
            commands::data_usage,
            commands::clear_dir,
            commands::open_dir
        ])
        .run(tauri::generate_context!())
        .expect("Knife Doc Tool 启动失败");
}
