//! 暴露给前端的命令。前端只走这些入口访问文件系统，因此 capability 里不必给
//! WebView 通用 fs 权限。

use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use crate::persist;
use crate::settings::Settings;
use crate::AppState;

fn path_string(path: &PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn get_app_info(state: State<AppState>) -> Value {
    let settings = state.settings.snapshot();
    json!({
        "productName": "Knife Doc Tool",
        "version": env!("CARGO_PKG_VERSION"),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "dataRoot": path_string(&state.layout.root),
        "cacheDir": path_string(&state.layout.cache),
        "tempDir": path_string(&state.layout.temp),
        "dataFile": path_string(&state.layout.data_file),
        "settingsFile": path_string(&state.layout.settings_file),
        "source": state.layout.source,
        "installCandidate": state.layout.install_candidate.as_ref().map(path_string),
        "closeBehavior": settings.close_behavior,
    })
}

#[tauri::command]
pub fn read_data(state: State<AppState>) -> Value {
    persist::read_data(&state.layout)
}

/// 前端整份数据（项目 / 全局参数 / 快捷请求）一次性落盘。
#[tauri::command]
pub fn write_data(state: State<AppState>, value: Value) -> Result<(), String> {
    persist::write_data(&state.layout, &value)
}

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    state.settings.snapshot()
}

#[tauri::command]
pub fn set_settings(state: State<AppState>, settings: Settings) -> Result<Settings, String> {
    state.settings.save(&state.layout.settings_file, settings)
}

/// 保存用户通过原生对话框选定的绝对路径（路径由用户挑选，故不做目录收敛）。
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<String, String> {
    persist::write_file(PathBuf::from(&path), &content)?;
    Ok(path)
}

#[derive(Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum DirTarget {
    Root,
    Cache,
    Temp,
}

fn target_dir(state: &AppState, target: DirTarget) -> PathBuf {
    match target {
        DirTarget::Root => state.layout.root.clone(),
        DirTarget::Cache => state.layout.cache.clone(),
        DirTarget::Temp => state.layout.temp.clone(),
    }
}

#[tauri::command]
pub fn write_cache_text(state: State<AppState>, name: String, content: String) -> Result<String, String> {
    let file = persist::safe_name(&name)?;
    let path = state.layout.cache.join(file);
    persist::write_file(path.clone(), &content)?;
    Ok(path_string(&path))
}

#[tauri::command]
pub fn read_cache_text(state: State<AppState>, name: String) -> Result<Option<String>, String> {
    let file = persist::safe_name(&name)?;
    match std::fs::read_to_string(state.layout.cache.join(file)) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_temp_text(state: State<AppState>, name: String, content: String) -> Result<String, String> {
    let file = persist::safe_name(&name)?;
    let path = state.layout.temp.join(file);
    persist::write_file(path.clone(), &content)?;
    Ok(path_string(&path))
}

#[tauri::command]
pub fn data_usage(state: State<AppState>) -> Value {
    let data_bytes = std::fs::metadata(&state.layout.data_file).map(|it| it.len()).unwrap_or(0);
    json!({
        "dataBytes": data_bytes,
        "cacheBytes": persist::dir_size(&state.layout.cache),
        "tempBytes": persist::dir_size(&state.layout.temp),
    })
}

#[tauri::command]
pub fn clear_dir(state: State<AppState>, target: DirTarget) -> Result<u64, String> {
    if matches!(target, DirTarget::Root) {
        return Err("根目录包含数据文件，只允许清理缓存或临时目录".into());
    }
    persist::clear_dir(&target_dir(&state, target))
}

#[tauri::command]
pub fn open_dir(app: AppHandle, state: State<AppState>, target: DirTarget) -> Result<(), String> {
    let path = target_dir(&state, target);
    app.opener()
        .open_path(path_string(&path), None::<&str>)
        .map_err(|e| e.to_string())
}

