use super::reminders::{Config, Item};

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
    pub fn notify(app: &tauri::AppHandle, items: &[Item], cfg: &Config) -> Result<(), String> {
        register(app)?;
        let title = if items.len() == 1 {
            format!(
                "{}提醒 · {}",
                if items[0].kind == "start" {
                    "开始"
                } else {
                    "截止"
                },
                items[0].title
            )
        } else {
            format!("有 {} 项待办需要关注", items.len())
        };
        let body = if items.len() == 1 {
            format!(
                "{} · {} · 点击查看提醒",
                items[0].date,
                if items[0].date_only {
                    "仅日期"
                } else {
                    "有具体时间"
                }
            )
        } else {
            "错过的提醒已合并，点击查看并处理".into()
        };
        let audio = if cfg.sound == "system" && !quiet() {
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
            let failed_items = items.to_vec();
            let only_system = !cfg.popup;
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
            eprintln!("[toast] accepted");
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
pub fn notify(_: &tauri::AppHandle, _: &[Item], _: &Config) -> Result<(), String> {
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
