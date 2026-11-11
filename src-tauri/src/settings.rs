//! 应用设置：落盘在安装目录的 `settings.json`，同时在内存里保留一份快照，
//! 让窗口关闭事件这种同步路径不必读盘就能拿到「关闭行为」。

use std::fs;
use std::path::Path;
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CloseBehavior {
    /// 点关闭只隐藏窗口，进程与托盘常驻（默认）
    MinimizeToTray,
    /// 点关闭直接退出应用
    Quit,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// 点击关闭按钮时的行为
    pub close_behavior: CloseBehavior,
    /// 界面主题：system / light / dark
    pub theme: String,
    /// 调试与快捷请求的默认超时（毫秒），0 表示不限制
    pub request_timeout: u64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_behavior: CloseBehavior::MinimizeToTray,
            theme: "system".into(),
            request_timeout: 60_000,
        }
    }
}

#[derive(Default)]
pub struct SettingsStore {
    pub current: RwLock<Settings>,
}

impl SettingsStore {
    /// 启动时读取磁盘设置，文件缺失或损坏都回退默认值。
    pub fn load(path: &Path) -> Self {
        let settings = fs::read_to_string(path)
            .ok()
            .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
            .unwrap_or_default();
        Self {
            current: RwLock::new(settings),
        }
    }

    pub fn snapshot(&self) -> Settings {
        self.current.read().map(|it| it.clone()).unwrap_or_default()
    }

    fn write_to_disk(&self, path: &Path, settings: &Settings) -> Result<(), String> {
        let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        // 先写临时文件再替换，避免进程中断留下半截 JSON。
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, text).map_err(|e| e.to_string())?;
        fs::rename(&tmp, path).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save(&self, path: &Path, next: Settings) -> Result<Settings, String> {
        self.write_to_disk(path, &next)?;
        let mut guard = self.current.write().map_err(|e| e.to_string())?;
        *guard = next.clone();
        Ok(next)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::fs;

    #[test]
    fn default_close_behavior_minimizes_to_tray() {
        let settings = Settings::default();
        assert_eq!(settings.close_behavior, CloseBehavior::MinimizeToTray);
        assert_eq!(settings.theme, "system");
        assert_eq!(settings.request_timeout, 60_000);
    }

    #[test]
    fn json_uses_camel_case_enum_names() {
        let text = serde_json::to_string(&Settings::default()).unwrap();
        assert!(
            text.contains("\"closeBehavior\":\"minimizeToTray\""),
            "got {text}"
        );

        let quit: Settings =
            serde_json::from_str(r#"{"closeBehavior":"quit","theme":"dark","requestTimeout":0}"#)
                .expect("反序列化失败");
        assert_eq!(quit.close_behavior, CloseBehavior::Quit);
        assert_eq!(quit.theme, "dark");
        assert_eq!(quit.request_timeout, 0);
    }

    #[test]
    fn load_falls_back_to_defaults_when_file_missing_or_broken() {
        let dir = std::env::temp_dir().join(format!("knife-doc-settings-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();

        let missing = dir.join("absent.json");
        let _ = fs::remove_file(&missing);
        assert_eq!(SettingsStore::load(&missing).snapshot(), Settings::default());

        let broken = dir.join("broken.json");
        fs::write(&broken, "{ half-written").unwrap();
        assert_eq!(SettingsStore::load(&broken).snapshot(), Settings::default());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_writes_disk_and_updates_snapshot() {
        let dir = std::env::temp_dir().join(format!(
            "knife-doc-settings-save-{}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("settings.json");
        let _ = fs::remove_file(&file);

        let store = SettingsStore::load(&file);
        let next = Settings {
            close_behavior: CloseBehavior::Quit,
            theme: "dark".into(),
            request_timeout: 15_000,
        };
        assert_eq!(store.save(&file, next.clone()).unwrap(), next);
        assert_eq!(store.snapshot(), next);
        assert_eq!(SettingsStore::load(&file).snapshot(), next);
        assert!(!dir.join("settings.json.tmp").exists(), "不应留下临时文件");

        let _ = fs::remove_dir_all(&dir);
    }
}
