//! 安装目录下的数据读写：`data.json`（业务数据）、`cache/`（文档缓存）、`temp/`（临时导出）。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::data_layout::DataLayout;

/// 前端传入的文件名必须收敛到单一目录内，禁止路径穿越。
pub fn safe_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.len() > 120 {
        return Err("文件名不合法".into());
    }
    if trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains("..")
        || !trimmed.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c))
    {
        return Err(format!("文件名不合法：{trimmed}"));
    }
    Ok(trimmed.to_string())
}

fn read_json(path: &Path) -> Value {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .unwrap_or_else(|| Value::Object(Default::default()))
}

/// 原子写入：先落 `.tmp` 再替换，避免进程被杀时留下半截 JSON。
fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn read_data(layout: &DataLayout) -> Value {
    read_json(&layout.data_file)
}

pub fn write_data(layout: &DataLayout, value: &Value) -> Result<(), String> {
    write_json(&layout.data_file, value)
}

pub fn write_file(path: PathBuf, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| format!("写入 {} 失败：{e}", path.display()))
}

/// 递归统计目录占用字节数。
pub fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries.fold(0u64, |acc, entry| {
        let Ok(entry) = entry else { return acc };
        let path = entry.path();
        if path.is_dir() {
            acc + dir_size(&path)
        } else if let Ok(meta) = entry.metadata() {
            acc + meta.len()
        } else {
            acc
        }
    })
}

/// 清空目录内容但保留目录本身，返回释放的字节数。
pub fn clear_dir(dir: &Path) -> Result<u64, String> {
    let freed = dir_size(dir);
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        let result = if path.is_dir() {
            fs::remove_dir_all(&path)
        } else {
            fs::remove_file(&path)
        };
        result.map_err(|e| format!("删除 {} 失败：{e}", path.display()))?;
    }
    Ok(freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicUsize, Ordering};

    static SANDBOX_SEQ: AtomicUsize = AtomicUsize::new(0);

    /// 每个用例独占一个临时目录，跑完即删。
    fn sandbox(tag: &str) -> PathBuf {
        let seq = SANDBOX_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "knife-doc-test-{}-{tag}-{seq}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("创建测试目录失败");
        dir
    }

    #[test]
    fn safe_name_accepts_plain_file_names() {
        for name in ["doc.json", "a-b_c.1", "  spaced.json  "] {
            assert!(safe_name(name).is_ok(), "{name} 应当合法");
        }
        assert_eq!(safe_name(" doc.json ").unwrap(), "doc.json");
    }

    #[test]
    fn safe_name_blocks_traversal_and_separators() {
        let long = "a".repeat(121);
        for name in [
            "", "   ", "../escape.txt", "..", "a/b.json", "a\\b.json", "C:\\windows\\x",
            "中文.json", "a b.json", long.as_str(),
        ] {
            assert!(safe_name(name).is_err(), "{name} 应当被拒绝");
        }
    }

    #[test]
    fn write_json_is_atomic_and_readable() {
        let dir = sandbox("json");
        let file = dir.join("data.json");
        let value = serde_json::json!({ "version": 1, "buckets": { "projects": [] } });

        write_json(&file, &value).expect("写入失败");
        assert_eq!(read_json(&file), value);
        assert!(!dir.join("data.json.tmp").exists(), "不应留下临时文件");

        fs::write(&file, "{ not json").expect("覆盖失败");
        assert_eq!(read_json(&file), Value::Object(Default::default()));

        assert_eq!(
            read_json(&dir.join("missing.json")),
            Value::Object(Default::default())
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_file_creates_missing_parent_dirs() {
        let dir = sandbox("nested");
        let file = dir.join("cache").join("sub").join("out.txt");
        write_file(file.clone(), "hello").expect("写入失败");
        assert_eq!(fs::read_to_string(&file).unwrap(), "hello");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn dir_size_counts_nested_and_clear_dir_keeps_root() {
        let dir = sandbox("size");
        fs::write(dir.join("a.txt"), "12345").unwrap();
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub").join("b.txt"), "678").unwrap();

        assert_eq!(dir_size(&dir), 8);
        assert_eq!(clear_dir(&dir).unwrap(), 8);
        assert!(dir.exists(), "clear_dir 只清空内容，不删目录");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        assert_eq!(dir_size(&dir), 0);

        assert!(clear_dir(&dir.join("nope")).is_err(), "目录不存在时应报错");
        let _ = fs::remove_dir_all(&dir);
    }
}
