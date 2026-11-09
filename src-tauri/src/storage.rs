use serde::{de::DeserializeOwned, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use uuid::Uuid;

// Covers the whole read/modify/write transaction within this process.
// Never hold this lock while calling window APIs or awaiting network requests.
static STORE_LOCK: Mutex<()> = Mutex::new(());

pub fn lock() -> Result<MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .lock()
        .map_err(|_| "数据操作异常，请重启应用后重试".into())
}

pub fn read_optional<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| {
            format!(
                "数据文件格式异常，已保留原文件，请检查或恢复文件：{}（{}）",
                path.display(),
                e
            )
        }),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("无法读取数据文件：{}（{}）", path.display(), e)),
    }
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| format!("序列化失败：{}", e))?;
    write_atomic(path, &bytes)
}

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // Same-directory rename keeps the replacement on the same filesystem.
    // On Windows std::fs::rename uses MoveFileExW(REPLACE_EXISTING).
    // Do not delete the destination or fall back to copying on failure.
    let name = path
        .file_name()
        .ok_or_else(|| "保存路径缺少文件名".to_string())?;
    let mut temp_name = name.to_os_string();
    temp_name.push(format!(".{}.tmp", Uuid::new_v4()));
    let temp = path.with_file_name(temp_name);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .map_err(|e| format!("无法创建临时文件：{}（{}）", temp.display(), e))?;
    let written = file.write_all(bytes).and_then(|_| file.sync_all());
    drop(file);
    let result = written
        .map_err(|e| format!("无法写入临时文件：{}（{}）", temp.display(), e))
        .and_then(|_| {
            fs::rename(&temp, path).map_err(|e| {
                format!(
                    "无法替换数据文件，原文件未删除：{}（{}）",
                    path.display(),
                    e
                )
            })
        });
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
