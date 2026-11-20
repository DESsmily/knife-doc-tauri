//! 暴露给前端的命令。前端只走这些入口访问文件系统，因此 capability 里不必给
//! WebView 通用 fs 权限。

use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Write;
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

/// 标准 base64 解码（忽略空白与 `=`），供前端分块传输二进制响应使用。
fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value_of(byte: u8) -> Option<u32> {
        match byte {
            b'A'..=b'Z' => Some(u32::from(byte - b'A')),
            b'a'..=b'z' => Some(u32::from(byte - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(byte - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }

    let mut out: Vec<u8> = Vec::with_capacity(input.len() / 4 * 3);
    let mut buffer: u32 = 0;
    let mut bits: u32 = 0;
    for byte in input.bytes() {
        if matches!(byte, b'=' | b'\n' | b'\r' | b' ' | b'\t') {
            continue;
        }
        let value = value_of(byte).ok_or_else(|| "二进制数据编码不合法".to_string())?;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Ok(out)
}

/// 分块写入二进制文件：`append = false` 为首块（覆盖已有内容），后续块追加。
///
/// 前端把下载内容切成若干块依次传入，避免一次 IPC 携带上百 MB 数据时卡住界面。
#[tauri::command]
pub fn write_binary_chunk(path: String, data: String, append: bool) -> Result<String, String> {
    let bytes = decode_base64(&data)?;
    let path = PathBuf::from(&path);

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("创建 {} 失败：{e}", parent.display()))?;
        }
    }

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true);
    if append {
        options.append(true);
    } else {
        options.truncate(true);
    }

    let mut file = options
        .open(&path)
        .map_err(|e| format!("打开 {} 失败：{e}", path.display()))?;
    file.write_all(&bytes)
        .map_err(|e| format!("写入 {} 失败：{e}", path.display()))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_base64_handles_padding_and_whitespace() {
        assert_eq!(decode_base64("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(decode_base64("aGk=").unwrap(), b"hi");
        assert_eq!(decode_base64("").unwrap(), Vec::<u8>::new());
        // 分块传输时前端不会插入换行，但仍要容忍
        assert_eq!(decode_base64("aGVs\nbG8=").unwrap(), b"hello");
    }

    #[test]
    fn decode_base64_keeps_all_byte_values() {
        let bytes: Vec<u8> = (0u16..=255).map(|value| value as u8).collect();
        assert_eq!(decode_base64(&encode_for_test(&bytes)).unwrap(), bytes);
    }

    #[test]
    fn decode_base64_rejects_invalid_input() {
        assert!(decode_base64("not base64!!").is_err());
    }

    /// 测试辅助：标准 base64 编码，用于验证解码的往返一致性
    fn encode_for_test(bytes: &[u8]) -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = u32::from(chunk[0]);
            let b1 = chunk.get(1).map(|it| u32::from(*it)).unwrap_or(0);
            let b2 = chunk.get(2).map(|it| u32::from(*it)).unwrap_or(0);
            let triple = (b0 << 16) | (b1 << 8) | b2;
            out.push(ALPHABET[(triple >> 18) as usize & 0x3f] as char);
            out.push(ALPHABET[(triple >> 12) as usize & 0x3f] as char);
            out.push(if chunk.len() > 1 {
                ALPHABET[(triple >> 6) as usize & 0x3f] as char
            } else {
                '='
            });
            out.push(if chunk.len() > 2 {
                ALPHABET[triple as usize & 0x3f] as char
            } else {
                '='
            });
        }
        out
    }
}

