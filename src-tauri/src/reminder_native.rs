use super::reminders::{Config, Item};
use chrono::{DateTime, Local, NaiveDate, TimeZone};

fn elapsed_days(item: &Item, today: NaiveDate) -> Option<i64> {
    NaiveDate::parse_from_str(&item.date, "%Y-%m-%d").ok()
        .map(|date| today.signed_duration_since(date).num_days())
}

fn overdue(item: &Item, now: &DateTime<Local>) -> bool {
    item.is_overdue(now)
}

// Text also acts as the scheduler's change marker: midnight updates are silent.
pub(crate) fn notification_text(items: &[Item], now: &DateTime<Local>) -> (String, String) {
    if let [item] = items {
        let kind = if item.kind == "end" { "截止" } else { "开始" };
        let body = if item.date_only {
            let status = match elapsed_days(item, now.date_naive()) {
                Some(days) if days > 0 => format!("{} {days} 天", if item.kind == "end" { "已逾期" } else { "已开始" }),
                Some(0) => format!("今日{kind}"),
                _ => format!("{kind}提醒"),
            };
            format!("{status} · {} {kind} · 仅日期 · 点击查看提醒", item.date)
        } else {
            let status = if item.target <= now.timestamp() {
                if item.kind == "end" { "已逾期" } else { "已开始" }
            } else if item.kind == "end" { "即将截止" } else { "即将开始" };
            let target = Local.timestamp_opt(item.target, 0).single()
                .map(|date| date.format("%Y-%m-%d %H:%M").to_string())
                .unwrap_or_else(|| item.date.clone());
            format!("{status} · {target} {kind} · 点击查看提醒")
        };
        (format!("{kind}提醒 · {}", item.title), body)
    } else {
        let count = items.iter().filter(|item| overdue(item, now)).count();
        let status = if count > 0 { format!("，其中 {count} 项已逾期") } else { String::new() };
        (format!("有 {} 项待办需要关注", items.len()),
         format!("共 {} 项提醒{status} · 点击查看并处理", items.len()))
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::Mutex;
    use tauri::Manager;
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        Foundation::{TypedEventHandler, Uri},
        Media::{Core::MediaSource, Playback::MediaPlayer},
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };
    static REGISTERED: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    static TOAST: Mutex<Option<ToastNotification>> = Mutex::new(None);
    pub fn id(app: &tauri::AppHandle) -> HSTRING {
        HSTRING::from(format!("{}.Reminders", app.config().identifier))
    }
    fn quiet() -> bool {
        use windows_sys::Win32::UI::Shell::{
            SHQueryUserNotificationState, QUNS_ACCEPTS_NOTIFICATIONS,
        };
        let mut state = 0;
        unsafe {
            SHQueryUserNotificationState(&mut state) < 0 || state != QUNS_ACCEPTS_NOTIFICATIONS
        }
    }
    fn xml(s: &str) -> String {
        s.replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&apos;")
    }
    fn register(app: &tauri::AppHandle) -> Result<(), String> {
        if REGISTERED.get().is_some() {
            return Ok(());
        }
        use std::os::windows::process::CommandExt;
        let status = std::process::Command::new("reg.exe")
            .args([
                "add",
                &format!("HKCU\\Software\\Classes\\AppUserModelId\\{}", id(app)),
                "/v",
                "DisplayName",
                "/t",
                "REG_SZ",
                "/d",
                if cfg!(debug_assertions) {
                    "TodoCalendar Dev"
                } else {
                    "TodoCalendar"
                },
                "/f",
            ])
            .creation_flags(0x08000000)
            .output()
            .map_err(|e| e.to_string())?;
        if !status.status.success() {
            return Err("无法注册 Windows 通知名称".into());
        }
        shortcut(app).map_err(|e| format!("无法注册通知快捷方式：{e}"))?;
        let _ = REGISTERED.set(());
        Ok(())
    }
    fn shortcut(app: &tauri::AppHandle) -> windows::core::Result<()> {
        use windows::{
            core::Interface,
            Win32::{
                Foundation::PROPERTYKEY,
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile,
                    StructuredStorage::PROPVARIANT, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED,
                },
                UI::Shell::{IShellLinkW, PropertiesSystem::IPropertyStore, ShellLink},
            },
        };
        let link_path = std::path::PathBuf::from(
            std::env::var_os("APPDATA").ok_or_else(windows::core::Error::from_win32)?,
        )
        .join("Microsoft/Windows/Start Menu/Programs")
        .join(format!("{}.lnk", id(app)));
        unsafe {
            let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let result = (|| -> windows::core::Result<()> {
                let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
                let exe =
                    std::env::current_exe().map_err(|_| windows::core::Error::from_win32())?;
                link.SetPath(&HSTRING::from(exe.to_string_lossy().as_ref()))?;
                link.SetDescription(&HSTRING::from("TodoCalendar 待办提醒"))?;
                let store: IPropertyStore = link.cast()?;
                let value = PROPVARIANT::from(id(app).to_string().as_str());
                let key = PROPERTYKEY {
                    fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
                    pid: 5,
                };
                store.SetValue(&key, &value)?;
                store.Commit()?;
                let file: IPersistFile = link.cast()?;
                file.Save(&HSTRING::from(link_path.to_string_lossy().as_ref()), true)?;
                Ok(())
            })();
            if initialized {
                CoUninitialize();
            }
            result
        }
    }
    pub fn notify(app: &tauri::AppHandle, items: &[Item], fresh: &[Item], cfg: &Config, silent: bool) -> Result<(), String> {
        if items.is_empty() { clear(app); return Ok(()); }
        register(app)?;
        let (title, body) = notification_text(items, &Local::now());
        let audio = if !silent && cfg.sound == "system" && !quiet() {
            "<audio src=\"ms-winsoundevent:Notification.Default\"/>"
        } else {
            "<audio silent=\"true\"/>"
        };
        let result = (|| -> windows::core::Result<()> {
            let doc = XmlDocument::new()?;
            doc.LoadXml(&HSTRING::from(format!("<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual>{}</toast>",xml(&title),xml(&body),audio)))?;
            let toast = ToastNotification::CreateToastNotification(&doc)?;
            toast.SetTag(&HSTRING::from("pending"))?;
            toast.SetGroup(&HSTRING::from("reminders"))?;
            toast.SetSuppressPopup(silent)?;
            let h = app.clone();
            toast.Activated(&TypedEventHandler::new(move |_, _| {
                let h = h.clone();
                std::thread::spawn(move || {
                    if let Err(e) = super::super::reminders::show(&h) {
                        super::super::report_storage_error(&h, &e);
                    } else if let Some(w) = h.get_webview_window("reminder") {
                        let _ = w.set_focus();
                    }
                });
                Ok(())
            }))?;
            let failed_app = app.clone();
            let failed_items = fresh.to_vec();
            let only_system = !cfg.popup && !silent;
            toast.Failed(&TypedEventHandler::<
                ToastNotification,
                windows::UI::Notifications::ToastFailedEventArgs,
            >::new(move |_, args| {
                let message = format!(
                    "Windows 通知发送失败：{:?}",
                    args.as_ref().and_then(|a| a.ErrorCode().ok())
                );
                let h = failed_app.clone();
                let items = failed_items.clone();
                std::thread::spawn(move || {
                    super::super::reminders::notification_failed(&h, items, only_system, message)
                });
                Ok(())
            }))?;
            let notifier = ToastNotificationManager::CreateToastNotifierWithId(&id(app))?;
            // An unregistered first-use notifier can return ERROR_NOT_FOUND until its first Show.
            match notifier.Setting() {
                Ok(setting)
                    if setting != windows::UI::Notifications::NotificationSetting::Enabled =>
                {
                    return Err(windows::core::Error::new(
                        windows::core::HRESULT(0x80070005u32 as i32),
                        "Windows 通知被系统设置禁用",
                    ))
                }
                Err(e) if e.code().0 != 0x80070490u32 as i32 => return Err(e),
                _ => {}
            }
            notifier.Show(&toast)?;
            eprintln!("[toast] accepted items={} fresh={} silent={}", items.len(), fresh.len(), silent);
            *TOAST.lock().unwrap() = Some(toast);
            Ok(())
        })();
        result.map_err(|e| format!("Windows 通知失败：{e}"))
    }
    pub fn clear(app: &tauri::AppHandle) {
        if let Ok(history) = ToastNotificationManager::History() {
            let _ = history.RemoveGroupedTagWithId(
                &HSTRING::from("pending"),
                &HSTRING::from("reminders"),
                &id(app),
            );
        }
        *TOAST.lock().unwrap() = None;
    }
    pub fn sound(cfg: &Config) -> Result<(), String> {
        if cfg.sound == "none" || quiet() {
            return Ok(());
        }
        if cfg.sound == "system" {
            unsafe {
                windows_sys::Win32::System::Diagnostics::Debug::MessageBeep(0);
            }
            return Ok(());
        }
        let bytes: &[u8] = match cfg.sound.as_str() {
            "knock" => include_bytes!("../../frontend/sounds/gentle-knock.wav"),
            "notes" => include_bytes!("../../frontend/sounds/rising-notes.wav"),
            _ => return Err("未知提示音".into()),
        };
        let file = std::env::temp_dir().join(format!("todocal-sound-{}.wav", uuid::Uuid::new_v4()));
        std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        let result = (|| -> windows::core::Result<MediaPlayer> {
            let player = MediaPlayer::new()?;
            player.SetVolume(f64::from(cfg.volume) / 100.)?;
            player.SetSource(&MediaSource::CreateFromUri(&Uri::CreateUri(
                &HSTRING::from(format!(
                    "file:///{}",
                    file.to_string_lossy().replace('\\', "/")
                )),
            )?)?)?;
            player.Play()?;
            Ok(player)
        })();
        match result {
            Ok(player) => {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    let _ = player.Close();
                    let _ = std::fs::remove_file(file);
                });
                Ok(())
            }
            Err(e) => {
                let _ = std::fs::remove_file(file);
                Err(format!("提示音播放失败：{e}"))
            }
        }
    }
    struct Instance(windows::Win32::Foundation::HANDLE);
    unsafe impl Send for Instance {}
    unsafe impl Sync for Instance {}
    impl Drop for Instance {
        fn drop(&mut self) {
            unsafe {
                let _ = windows::Win32::Foundation::CloseHandle(self.0);
            }
        }
    }
    pub fn single_instance(app: &tauri::AppHandle) -> Result<(), String> {
        use windows::Win32::{
            Foundation::{GetLastError, ERROR_ALREADY_EXISTS},
            System::Threading::CreateMutexW,
        };
        let name = HSTRING::from(format!("Local\\TodoCalendar-{}", app.config().identifier));
        unsafe {
            let handle = CreateMutexW(None, false, &name).map_err(|e| e.to_string())?;
            if GetLastError() == ERROR_ALREADY_EXISTS {
                let _ = windows::Win32::Foundation::CloseHandle(handle);
                return Err("同一数据目录的 TodoCalendar 已在运行，请使用已有窗口".into());
            }
            app.manage(Instance(handle));
        }
        Ok(())
    }
}
#[cfg(windows)]
pub use platform::{clear, notify, single_instance, sound};
#[cfg(not(windows))]
pub fn single_instance(_: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
#[cfg(not(windows))]
pub fn notify(_: &tauri::AppHandle, _: &[Item], _: &[Item], _: &Config, _: bool) -> Result<(), String> {
    Err("系统通知暂仅支持 Windows".into())
}
#[cfg(not(windows))]
pub fn clear(_: &tauri::AppHandle) {}
#[cfg(not(windows))]
pub fn sound(cfg: &Config) -> Result<(), String> {
    if cfg.sound == "none" {
        Ok(())
    } else {
        Err("提示音暂仅支持 Windows".into())
    }
}

// Keep the existing notification in sync without replaying its banner or audio.
pub fn sync(app: &tauri::AppHandle, items: &[Item], cfg: &Config) -> Result<(), String> {
    if items.is_empty() || !cfg.enabled || !cfg.system {
        clear(app);
        Ok(())
    } else {
        notify(app, items, &[], cfg, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(date: &str, kind: &str) -> Item {
        serde_json::from_value(serde_json::json!({"key":"test","todoId":"test","title":"Test","path":"Work","kind":kind,"target":0,"dateOnly":true,"date":date,"batch":1,"count":1,"due":0})).unwrap()
    }
    fn local(time: &str) -> DateTime<Local> {
        Local.from_local_datetime(&chrono::NaiveDateTime::parse_from_str(time, "%Y-%m-%d %H:%M:%S").unwrap()).earliest().unwrap()
    }
    #[test]
    fn date_deadline_is_overdue_only_after_local_midnight() {
        let i = item("2026-11-10", "end");
        for time in ["2026-11-10 00:00:00", "2026-11-10 09:31:00", "2026-11-10 23:59:59"] {
            let now = local(time);
            assert!(!overdue(&i, &now));
            assert!(notification_text(&[i.clone()], &now).1.contains("今日截止"));
        }
        let now = local("2026-11-11 00:00:00");
        assert!(overdue(&i, &now));
        assert!(notification_text(&[i], &now).1.contains("已逾期 1 天 · 2026-11-10 截止"));
    }
    #[test]
    fn date_counts_cross_years_and_leap_days_and_keep_start_semantics() {
        assert_eq!(elapsed_days(&item("2025-12-31", "end"), NaiveDate::from_ymd_opt(2026, 1, 1).unwrap()), Some(1));
        assert_eq!(elapsed_days(&item("2024-02-28", "end"), NaiveDate::from_ymd_opt(2024, 3, 1).unwrap()), Some(2));
        let i = item("2026-11-08", "start");
        let now = local("2026-11-11 12:00:00");
        assert!(!overdue(&i, &now));
        assert!(notification_text(&[i], &now).1.contains("已开始 3 天"));
    }
    #[test]
    fn summary_counts_only_overdue_deadlines_and_changes_at_midnight() {
        let items = vec![item("2026-11-10", "end"), item("2026-11-09", "end"), item("2026-11-08", "start")];
        let before = notification_text(&items, &local("2026-11-10 23:59:59"));
        let after = notification_text(&items, &local("2026-11-11 00:00:00"));
        assert!(before.1.contains("共 3 项提醒，其中 1 项已逾期"));
        assert!(after.1.contains("共 3 项提醒，其中 2 项已逾期"));
        assert_ne!(before, after);
        assert_eq!(after, notification_text(&items, &local("2026-11-11 00:00:02")));
    }
    #[test]
    fn timed_notification_retains_time_and_switches_status_at_target() {
        let mut i = item("2026-11-11", "end");
        i.date_only = false; i.target = local("2026-11-11 10:30:00").timestamp();
        assert!(notification_text(&[i.clone()], &local("2026-11-11 10:29:59")).1.contains("即将截止 · 2026-11-11 10:30"));
        assert!(notification_text(&[i], &local("2026-11-11 10:30:00")).1.contains("已逾期 · 2026-11-11 10:30"));
    }
}
