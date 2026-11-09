use super::{backup, migrate_data, now_iso, validation, Data, MemoData};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    format: String,
    version: u32,
    created_at: String,
    pub data: Data,
    pub memos: MemoData,
}

pub struct Import {
    pub data: Data,
    pub memos: Option<MemoData>,
}

impl Import {
    pub fn scope(&self) -> &'static str {
        if self.memos.is_some() {
            "data"
        } else {
            "legacyTasks"
        }
    }
}

pub fn snapshot(dir: &Path) -> Result<Bundle, String> {
    let data = super::load_data(&dir.join("todos.json"))?;
    let memos = super::load_memos(&dir.join("memos.json"))?;
    validation::data(&data)?;
    validation::memos(&memos)?;
    Ok(Bundle {
        format: "todocalendar-data".into(),
        version: 1,
        created_at: now_iso(),
        data,
        memos,
    })
}

pub fn parse(content: &str) -> Result<Import, String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|e| format!("无效 JSON：{}", e))?;
    let mut parsed = if let Some(format) = value.get("format") {
        if format == "todocalendar-backup" {
            return Err("这是完整备份，请使用“完整备份与恢复”导入".into());
        }
        if format != "todocalendar-data" || value.get("version").and_then(|v| v.as_u64()) != Some(1)
        {
            return Err("不支持的数据文件格式或版本".into());
        }
        let bundle: Bundle =
            serde_json::from_value(value).map_err(|e| format!("数据文件不完整：{}", e))?;
        validation::memos(&bundle.memos)?;
        Import {
            data: bundle.data,
            memos: Some(bundle.memos),
        }
    } else {
        let data: Data =
            serde_json::from_value(value).map_err(|e| format!("不是有效的旧版任务 JSON：{}", e))?;
        Import { data, memos: None }
    };
    validation::data(&parsed.data)?;
    migrate_data(&mut parsed.data, &now_iso());
    Ok(parsed)
}

pub fn read(path: &Path) -> Result<Import, String> {
    parse(&std::fs::read_to_string(path).map_err(|e| format!("读取失败：{}", e))?)
}

pub fn apply(dir: &Path, parsed: Import, expected_scope: &str) -> Result<Data, String> {
    if parsed.scope() != expected_scope {
        return Err("文件导入范围已改变，请重新选择并确认".into());
    }
    validation::data(&parsed.data)?;
    if let Some(memos) = &parsed.memos {
        validation::memos(memos)?;
    }
    let todos = serde_json::to_vec_pretty(&parsed.data).map_err(|e| e.to_string())?;
    let memos = parsed
        .memos
        .as_ref()
        .map(serde_json::to_vec_pretty)
        .transpose()
        .map_err(|e| e.to_string())?;
    backup::replace_files(dir, [Some(todos), memos, None], "before-import")?;
    Ok(parsed.data)
}

#[cfg(test)]
mod tests {
    use super::super::{storage, MemoEntry};
    use super::*;
    use std::fs;
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("todocal-exchange-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            fs::write(path.join("settings.json"), b"{ \"theme\": \"dark\" }").unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn content(dir: &Path) -> Bundle {
        let mut bundle = snapshot(dir).unwrap();
        bundle.memos.entries.push(MemoEntry {
            id: "memo".into(),
            title: "example".into(),
            body: "body".into(),
            pinned: false,
            order: 0,
            links: vec![],
            updated_at: now_iso(),
        });
        bundle
    }
    #[test]
    fn data_roundtrip_preserves_settings_and_exports_no_settings() {
        let dir = Temp::new();
        let settings = fs::read(dir.0.join("settings.json")).unwrap();
        let bundle = content(&dir.0);
        let value = serde_json::to_value(&bundle).unwrap();
        assert!(value.get("settings").is_none());
        apply(&dir.0, parse(&value.to_string()).unwrap(), "data").unwrap();
        assert_eq!(snapshot(&dir.0).unwrap().memos.entries[0].title, "example");
        assert_eq!(fs::read(dir.0.join("settings.json")).unwrap(), settings);
        assert_eq!(fs::read_dir(dir.0.join("backups")).unwrap().count(), 1);
    }
    #[test]
    fn legacy_import_preserves_memos_and_settings_bytes() {
        let dir = Temp::new();
        let bundle = content(&dir.0);
        storage::write_json(&dir.0.join("memos.json"), &bundle.memos).unwrap();
        let memos = fs::read(dir.0.join("memos.json")).unwrap();
        let settings = fs::read(dir.0.join("settings.json")).unwrap();
        apply(
            &dir.0,
            parse(&serde_json::to_string(&bundle.data).unwrap()).unwrap(),
            "legacyTasks",
        )
        .unwrap();
        assert_eq!(fs::read(dir.0.join("memos.json")).unwrap(), memos);
        assert_eq!(fs::read(dir.0.join("settings.json")).unwrap(), settings);
    }
    #[test]
    fn invalid_memos_versions_backup_and_changed_scope_are_rejected() {
        let dir = Temp::new();
        let mut value = serde_json::to_value(content(&dir.0)).unwrap();
        value["memos"]["entries"][0]["id"] = "".into();
        assert!(parse(&value.to_string()).is_err());
        value = serde_json::to_value(content(&dir.0)).unwrap();
        value["version"] = 99.into();
        assert!(parse(&value.to_string()).is_err());
        assert!(
            parse(&serde_json::to_string(&backup::snapshot(&dir.0).unwrap()).unwrap()).is_err()
        );
    }
    #[test]
    fn changed_scope_is_rejected_before_writing() {
        let dir = Temp::new();
        let parsed = parse(&serde_json::to_string(&content(&dir.0)).unwrap()).unwrap();
        assert!(apply(&dir.0, parsed, "legacyTasks").is_err());
        assert!(!dir.0.join("backups").exists());
    }
    #[cfg(windows)]
    #[test]
    fn second_file_failure_rolls_back_import_and_keeps_settings() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = Temp::new();
        let bundle = content(&dir.0);
        storage::write_json(&dir.0.join("todos.json"), &bundle.data).unwrap();
        storage::write_json(&dir.0.join("memos.json"), &bundle.memos).unwrap();
        let before: Vec<_> = ["todos.json", "memos.json", "settings.json"]
            .iter()
            .map(|f| fs::read(dir.0.join(f)).unwrap())
            .collect();
        let mut value = serde_json::to_value(bundle).unwrap();
        value["data"]["updatedAt"] = "changed".into();
        value["memos"]["entries"][0]["title"] = "new".into();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(dir.0.join("memos.json"))
            .unwrap();
        assert!(apply(&dir.0, parse(&value.to_string()).unwrap(), "data")
            .err()
            .unwrap()
            .contains("已回滚"));
        drop(held);
        for (i, file) in ["todos.json", "memos.json", "settings.json"]
            .iter()
            .enumerate()
        {
            assert_eq!(fs::read(dir.0.join(file)).unwrap(), before[i]);
        }
        assert!(!dir.0.join("restore-pending.json").exists());
    }
}
