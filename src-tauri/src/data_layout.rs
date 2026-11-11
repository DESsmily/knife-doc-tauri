//! 数据目录解析。
//!
//! 产品要求「缓存的数据与临时数据保存在应用程序所在的安装目录」，因此优先使用
//! 可执行文件同级的 `<exe 目录>/<app>-data/`；只有该目录不可写（例如被装进
//! `Program Files` 且没有管理员权限）才退回系统应用数据目录。

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// 数据根目录来源，用于在设置页向用户解释实际落盘位置。
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum RootSource {
    /// 环境变量 KNIFE_DOC_DATA_DIR 指定
    Env,
    /// 安装目录（exe 同级）
    Install,
    /// 安装目录不可写，退回系统应用数据目录
    AppData,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DataLayout {
    pub root: PathBuf,
    pub cache: PathBuf,
    pub temp: PathBuf,
    pub data_file: PathBuf,
    pub settings_file: PathBuf,
    pub source: RootSource,
    /// 安装目录候选路径（即使最终回退了也要让用户看到）
    pub install_candidate: Option<PathBuf>,
}

fn sub(root: &Path, name: &str) -> PathBuf {
    root.join(name)
}

/// 目录可用 = 能创建且能写入。
fn ensure_writable(dir: &Path) -> bool {
    if std::fs::create_dir_all(dir).is_err() {
        return false;
    }
    let probe = dir.join(".knife-doc-write-probe");
    let ok = std::fs::write(&probe, b"ok").is_ok();
    if ok {
        let _ = std::fs::remove_file(&probe);
    }
    ok
}

fn build_layout(root: PathBuf, source: RootSource, install_candidate: Option<PathBuf>) -> Option<DataLayout> {
    if !ensure_writable(&root) {
        return None;
    }
    let cache = sub(&root, "cache");
    let temp = sub(&root, "temp");
    if !ensure_writable(&cache) || !ensure_writable(&temp) {
        return None;
    }
    Some(DataLayout {
        data_file: sub(&root, "data.json"),
        settings_file: sub(&root, "settings.json"),
        root,
        cache,
        temp,
        source,
        install_candidate,
    })
}

fn install_candidate(app: &AppHandle) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?.to_path_buf();
    let name = app.package_info().name.replace([' ', '-'], "_").to_lowercase();
    Some(dir.join(format!("{name}-data")))
}

/// 解析数据目录，并把三级候选按优先级尝试到底。
pub fn resolve(app: &AppHandle) -> DataLayout {
    let install = install_candidate(app);

    if let Ok(custom) = std::env::var("KNIFE_DOC_DATA_DIR") {
        if !custom.trim().is_empty() {
            if let Some(layout) = build_layout(PathBuf::from(custom), RootSource::Env, install.clone()) {
                return layout;
            }
        }
    }

    if let Some(candidate) = install.clone() {
        if let Some(layout) = build_layout(candidate, RootSource::Install, install.clone()) {
            return layout;
        }
    }

    let fallback = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("knife-doc"));
    build_layout(fallback, RootSource::AppData, install.clone()).unwrap_or_else(|| {
        // 极端情况下（系统目录也不可用）退到临时目录，保证应用仍可运行。
        let temp = std::env::temp_dir().join("knife-doc-data");
        build_layout(temp, RootSource::AppData, install).unwrap_or(DataLayout {
            root: std::env::temp_dir(),
            cache: std::env::temp_dir(),
            temp: std::env::temp_dir(),
            data_file: std::env::temp_dir().join("knife-doc-data.json"),
            settings_file: std::env::temp_dir().join("knife-doc-settings.json"),
            source: RootSource::AppData,
            install_candidate: None,
        })
    })
}
