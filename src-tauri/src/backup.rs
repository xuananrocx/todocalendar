use super::{
    load_memos, load_settings, migrate_data, now_iso, storage, validation, Data, MemoData,
    Settings, DATA_VERSION,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const FILES: [&str; 3] = ["todos.json", "memos.json", "settings.json"];
const JOURNAL: &str = "restore-pending.json";

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    format: String,
    version: u32,
    created_at: String,
    pub data: Data,
    pub memos: MemoData,
    pub settings: serde_json::Value,
}

// Raw originals preserve even a damaged file when restoring a valid backup.
// Fixed fields/filenames prevent a journal from writing arbitrary paths.
#[derive(Serialize, Deserialize)]
struct Originals {
    version: u32,
    files: [Option<Vec<u8>>; 3],
    #[serde(default = "all_selected")]
    selected: [bool; 3],
}

fn all_selected() -> [bool; 3] {
    [true; 3]
}

pub fn snapshot(dir: &Path) -> Result<Bundle, String> {
    let mut data = storage::read_optional::<Data>(&dir.join(FILES[0]))?.unwrap_or_else(|| Data {
        version: DATA_VERSION.into(),
        updated_at: now_iso(),
        todos: vec![],
        groups: vec![],
    });
    validation::data(&data)?;
    migrate_data(&mut data, &now_iso());
    let memos = load_memos(&dir.join(FILES[1]))?;
    validation::memos(&memos)?;
    let settings =
        serde_json::to_value(load_settings(&dir.join(FILES[2]))?).map_err(|e| e.to_string())?;
    Ok(Bundle {
        format: "todocalendar-backup".into(),
        version: 1,
        created_at: now_iso(),
        data,
        memos,
        settings,
    })
}

pub fn validate(bundle: &mut Bundle) -> Result<(), String> {
    if bundle.format != "todocalendar-backup" || bundle.version != 1 {
        return Err("不是受支持的完整备份（请使用数据导入读取普通数据 JSON）".into());
    }
    validation::data(&bundle.data)?;
    validation::memos(&bundle.memos)?;
    migrate_data(&mut bundle.data, &now_iso());
    let fields = bundle
        .settings
        .as_object()
        .ok_or("备份设置必须是 JSON 对象")?;
    let mut merged = serde_json::to_value(Settings::default()).map_err(|e| e.to_string())?;
    for (key, value) in fields {
        merged
            .as_object_mut()
            .unwrap()
            .insert(key.clone(), value.clone());
    }
    let settings: Settings =
        serde_json::from_value(merged).map_err(|e| format!("备份设置无效：{}", e))?;
    settings.reminders.validate()?;
    settings.rest.validate()?;
    bundle.settings = serde_json::to_value(settings).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn recovery_copy(dir: &Path, kind: &str) -> Result<PathBuf, String> {
    let bundle = snapshot(dir)?;
    let folder = dir.join("backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let path = folder.join(format!(
        "{}-{}-{}.json",
        kind,
        chrono::Local::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4()
    ));
    storage::write_json(&path, &bundle)?;
    Ok(path)
}

// Called under the store transaction lock, before any normal mutation.
pub fn before_write(file: &Path) -> Result<(), String> {
    let Some(dir) = file.parent() else {
        return Ok(());
    };
    if !FILES
        .iter()
        .any(|name| file.file_name().is_some_and(|f| f == *name))
    {
        return Ok(());
    }
    let settings = load_settings(&dir.join(FILES[2]))?;
    if !settings.auto_backup {
        return Ok(());
    }
    let folder = dir.join("backups");
    let target = folder.join(format!(
        "auto-{}.json",
        chrono::Local::now().format("%Y-%m-%d")
    ));
    // A corrupt daily backup must not count as a successful backup.
    if let Some(mut existing) = storage::read_optional::<Bundle>(&target)? {
        validate(&mut existing)?;
        return Ok(());
    }
    let bundle = snapshot(dir)?;
    fs::create_dir_all(&folder).map_err(|e| format!("无法创建备份目录：{}", e))?;
    storage::write_json(&target, &bundle)?;
    let mut automatic = Vec::new();
    for entry in fs::read_dir(&folder).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("auto-")
            && name.ends_with(".json")
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            automatic.push(entry.path());
        }
    }
    automatic.sort();
    let remove = automatic
        .len()
        .saturating_sub(settings.backup_keep.clamp(1, 100) as usize);
    for old in automatic.into_iter().take(remove) {
        fs::remove_file(&old)
            .map_err(|e| format!("无法清理旧自动备份：{}（{}）", old.display(), e))?;
    }
    Ok(())
}

fn originals(dir: &Path) -> Result<Originals, String> {
    let mut files = [None, None, None];
    for (index, name) in FILES.iter().enumerate() {
        files[index] = match fs::read(dir.join(name)) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("无法读取恢复前数据 {}：{}", name, e)),
        };
    }
    Ok(Originals {
        version: 1,
        files,
        selected: all_selected(),
    })
}

fn rollback(dir: &Path, before: &Originals) -> Result<(), String> {
    if before.version != 1 {
        return Err("不支持的恢复日志版本".into());
    }
    for (index, (name, original)) in FILES.iter().zip(&before.files).enumerate() {
        if !before.selected[index] {
            continue;
        }
        let target = dir.join(name);
        // Unchanged/locked files need no rewrite.
        match original {
            Some(bytes) => {
                if fs::read(&target).ok().as_ref() != Some(bytes) {
                    storage::write_atomic(&target, bytes)?;
                }
            }
            None => match fs::remove_file(&target) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("无法回滚新增文件 {}：{}", name, e)),
            },
        }
    }
    fs::remove_file(dir.join(JOURNAL)).map_err(|e| format!("无法清理恢复日志：{}", e))
}

// Every app storage transaction checks for a previously interrupted restore first.
pub fn recover_pending(dir: &Path) -> Result<(), String> {
    if let Some(before) = storage::read_optional::<Originals>(&dir.join(JOURNAL))? {
        rollback(dir, &before).map_err(|e| {
            format!(
                "上次恢复尚未完成，已暂停数据操作；请解除文件占用后重试：{}",
                e
            )
        })?;
    }
    Ok(())
}

pub fn restore(dir: &Path, bundle: &mut Bundle) -> Result<PathBuf, String> {
    validate(bundle)?;
    recover_pending(dir)?;
    // Serialize everything before changing any live files.
    let values = [
        serde_json::to_vec_pretty(&bundle.data),
        serde_json::to_vec_pretty(&bundle.memos),
        serde_json::to_vec_pretty(&bundle.settings),
    ];
    let payloads: Vec<Vec<u8>> = values
        .into_iter()
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    replace_files(
        dir,
        payloads
            .into_iter()
            .map(Some)
            .collect::<Vec<_>>()
            .try_into()
            .unwrap(),
        "before-restore",
    )
}

pub fn replace_files(
    dir: &Path,
    payloads: [Option<Vec<u8>>; 3],
    kind: &str,
) -> Result<PathBuf, String> {
    recover_pending(dir)?;
    let mut before = originals(dir)?;
    before.selected = std::array::from_fn(|i| payloads[i].is_some());
    let folder = dir.join("backups");
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let copy = folder.join(format!("{}-{}.json", kind, uuid::Uuid::new_v4()));
    // Prefer a restorable complete backup; retain raw files if the originals are damaged.
    let copy = match snapshot(dir) {
        Ok(bundle) => {
            storage::write_json(&copy, &bundle)?;
            copy
        }
        Err(_) => {
            let raw = copy.with_extension("originals.json");
            storage::write_json(&raw, &before)?;
            raw
        }
    };
    storage::write_json(&dir.join(JOURNAL), &before)?;
    let result = (|| {
        for (name, bytes) in FILES.iter().zip(&payloads) {
            if let Some(bytes) = bytes {
                storage::write_atomic(&dir.join(name), bytes)?;
            }
        }
        fs::remove_file(dir.join(JOURNAL)).map_err(|e| format!("无法完成恢复：{}", e))
    })();
    if let Err(error) = result {
        return match rollback(dir, &before) {
            Ok(()) => Err(format!("恢复失败，已回滚原数据：{}", error)),
            Err(rollback_error) => Err(format!(
                "恢复失败：{}；回滚待完成：{}。已保留恢复日志，修复文件访问后重试。",
                error, rollback_error
            )),
        };
    }
    Ok(copy)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("todocal-backup-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn seeded(dir: &Path) {
        storage::write_json(
            &dir.join("settings.json"),
            &serde_json::json!({"theme":"dark"}),
        )
        .unwrap();
        let bundle = snapshot(dir).unwrap();
        storage::write_json(&dir.join("todos.json"), &bundle.data).unwrap();
        storage::write_json(&dir.join("memos.json"), &bundle.memos).unwrap();
    }

    #[test]
    fn complete_backup_restores_all_three_files_and_keeps_originals() {
        let dir = Temp::new();
        seeded(&dir.0);
        let mut bundle = snapshot(&dir.0).unwrap();
        bundle.settings["theme"] = serde_json::json!("light");
        bundle.memos.entries.push(super::super::MemoEntry {
            id: "memo".into(),
            title: "restored".into(),
            body: "body".into(),
            pinned: false,
            order: 0,
            links: vec![],
            updated_at: now_iso(),
        });
        let copy = restore(&dir.0, &mut bundle).unwrap();
        let old: Bundle = storage::read_optional(&copy).unwrap().unwrap();
        assert_eq!(old.settings["theme"], "dark");
        assert_eq!(
            load_settings(&dir.0.join("settings.json")).unwrap().theme,
            "light"
        );
        assert_eq!(
            load_memos(&dir.0.join("memos.json")).unwrap().entries[0].title,
            "restored"
        );
        assert!(!dir.0.join(JOURNAL).exists());
    }

    #[test]
    fn incompatible_backup_is_rejected_before_any_write() {
        let dir = Temp::new();
        seeded(&dir.0);
        let before = fs::read(dir.0.join("settings.json")).unwrap();
        let mut bundle = snapshot(&dir.0).unwrap();
        bundle.version = 99;
        assert!(restore(&dir.0, &mut bundle).is_err());
        assert_eq!(fs::read(dir.0.join("settings.json")).unwrap(), before);
        assert!(!dir.0.join("backups").exists());
    }

    #[test]
    fn interrupted_restore_rolls_back_on_next_transaction() {
        let dir = Temp::new();
        seeded(&dir.0);
        let before = originals(&dir.0).unwrap();
        storage::write_json(&dir.0.join(JOURNAL), &before).unwrap();
        storage::write_json(
            &dir.0.join("settings.json"),
            &serde_json::json!({"theme":"light"}),
        )
        .unwrap();
        recover_pending(&dir.0).unwrap();
        assert_eq!(
            load_settings(&dir.0.join("settings.json")).unwrap().theme,
            "dark"
        );
        assert!(!dir.0.join(JOURNAL).exists());
    }

    #[test]
    fn selective_recovery_never_rewrites_settings_and_reads_old_journals() {
        let dir = Temp::new();
        seeded(&dir.0);
        let mut before = originals(&dir.0).unwrap();
        before.selected = [true, true, false];
        storage::write_json(&dir.0.join(JOURNAL), &before).unwrap();
        fs::write(dir.0.join("todos.json"), b"interrupted").unwrap();
        fs::write(dir.0.join("settings.json"), b"independent settings").unwrap();
        recover_pending(&dir.0).unwrap();
        assert_eq!(
            fs::read(dir.0.join("todos.json")).unwrap(),
            before.files[0].clone().unwrap()
        );
        assert_eq!(
            fs::read(dir.0.join("settings.json")).unwrap(),
            b"independent settings"
        );
        let mut old = serde_json::to_value(&before).unwrap();
        old.as_object_mut().unwrap().remove("selected");
        let old: Originals = serde_json::from_value(old).unwrap();
        assert_eq!(old.selected, [true; 3]);
    }

    #[cfg(windows)]
    #[test]
    fn failed_second_file_restores_first_file_without_losing_locked_original() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = Temp::new();
        seeded(&dir.0);
        let before = originals(&dir.0).unwrap();
        let mut bundle = snapshot(&dir.0).unwrap();
        bundle.data.updated_at = "changed".into();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(dir.0.join("memos.json"))
            .unwrap();
        let result = restore(&dir.0, &mut bundle);
        drop(held);
        assert!(result.unwrap_err().contains("已回滚"));
        assert_eq!(originals(&dir.0).unwrap().files, before.files);
        assert!(!dir.0.join(JOURNAL).exists());
    }

    #[test]
    fn valid_backup_can_recover_damaged_originals_and_preserves_the_raw_copy() {
        let dir = Temp::new();
        seeded(&dir.0);
        let mut bundle = snapshot(&dir.0).unwrap();
        fs::write(dir.0.join("settings.json"), b"damaged original").unwrap();
        let copy = restore(&dir.0, &mut bundle).unwrap();
        let old: Originals = storage::read_optional(&copy).unwrap().unwrap();
        assert_eq!(
            old.files[2].as_deref(),
            Some(b"damaged original".as_slice())
        );
        assert_eq!(
            load_settings(&dir.0.join("settings.json")).unwrap().theme,
            "dark"
        );
    }

    #[test]
    fn automatic_backup_is_once_daily_before_changes_and_rotates_only_automatic_files() {
        let dir = Temp::new();
        seeded(&dir.0);
        storage::write_json(
            &dir.0.join("settings.json"),
            &serde_json::json!({"theme":"dark","autoBackup":true,"backupKeep":1}),
        )
        .unwrap();
        let folder = dir.0.join("backups");
        fs::create_dir(&folder).unwrap();
        storage::write_json(
            &folder.join("auto-2000-01-01.json"),
            &snapshot(&dir.0).unwrap(),
        )
        .unwrap();
        fs::write(folder.join("before-import-keep.json"), "keep").unwrap();
        before_write(&dir.0.join("todos.json")).unwrap();
        let today = folder.join(format!(
            "auto-{}.json",
            chrono::Local::now().format("%Y-%m-%d")
        ));
        let bytes = fs::read(&today).unwrap();
        storage::write_json(
            &dir.0.join("settings.json"),
            &serde_json::json!({"theme":"light","autoBackup":true,"backupKeep":1}),
        )
        .unwrap();
        before_write(&dir.0.join("memos.json")).unwrap();
        assert_eq!(fs::read(today).unwrap(), bytes);
        assert!(!folder.join("auto-2000-01-01.json").exists());
        assert!(folder.join("before-import-keep.json").exists());
    }

    #[test]
    fn automatic_backup_failure_blocks_mutation() {
        let dir = Temp::new();
        seeded(&dir.0);
        storage::write_json(
            &dir.0.join("settings.json"),
            &serde_json::json!({"autoBackup":true}),
        )
        .unwrap();
        fs::write(dir.0.join("backups"), "not a directory").unwrap();
        let original = fs::read(dir.0.join("todos.json")).unwrap();
        let result = super::super::save_data_checked(
            &dir.0.join("todos.json"),
            &snapshot(&dir.0).unwrap().data,
        );
        assert!(result.is_err());
        assert_eq!(fs::read(dir.0.join("todos.json")).unwrap(), original);
    }
}
