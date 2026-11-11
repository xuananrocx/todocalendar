//! Independent, in-memory break timer. No task data or offline catch-up.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
#[path = "rest_schedule.rs"]
mod schedule;
use schedule::{Schedule, Window};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub interval_minutes: u32,
    pub duration_minutes: u32,
    pub warning_seconds: u32,
    pub mode: String,
    pub all_screens: bool,
    pub sound: String,
    pub volume: u32,
    pub schedule: Schedule,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_minutes: 50,
            duration_minutes: 5,
            warning_seconds: 10,
            mode: "forced".into(),
            all_screens: true,
            sound: "knock".into(),
            volume: 50,
            schedule: Schedule::default(),
        }
    }
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        self.schedule.validate()?;
        if self.volume > 100 { return Err("自带提示音音量须为 0–100%".into()); }
        if !(1..=300).contains(&self.warning_seconds) {
            return Err("提前提示时间须为 1–300 秒".into());
        }
        if !(1..=240).contains(&self.interval_minutes) || !(1..=60).contains(&self.duration_minutes)
        {
            return Err("休息间隔须为 1–240 分钟，休息时长须为 1–60 分钟".into());
        }
        if !["normal", "forced"].contains(&self.mode.as_str())
            || !["none", "knock", "notes"].contains(&self.sound.as_str())
        {
            return Err("无效的休息提醒模式或声音".into());
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Phase {
    Disabled,
    Outside,
    Waiting,
    Warning,
    Prompt,
    Rest,
}
struct Runtime {
    config: Config,
    phase: Phase,
    deadline: Instant,
    last_tick: Instant,
    generation: u64,
    quote: usize,
    quote_pool: Vec<usize>,
    next_quote_at: Option<Instant>,
    warning_hidden: bool,
    hold: Option<(String, Instant)>,
    error: String,
    window: Option<Window>,
    preview: bool,
    background: Option<Box<Runtime>>,
}
impl Runtime {
    fn new(now: Instant) -> Self {
        Self {
            config: Config::default(),
            phase: Phase::Disabled,
            deadline: now,
            last_tick: now,
            generation: 0,
            quote: 0,
            quote_pool: Vec::new(),
            next_quote_at: None,
            warning_hidden: false,
            hold: None,
            error: String::new(),
            window: None,
            preview: false,
            background: None,
        }
    }
    fn phase(&mut self, phase: Phase, now: Instant, seconds: u64) {
        self.phase = phase;
        self.deadline = now + Duration::from_secs(seconds);
        self.generation += 1;
        self.hold = None;
        self.warning_hidden = false;
        self.next_quote_at = (phase == Phase::Rest).then(|| now + self.quote_interval());
    }
    fn quote_interval(&self) -> Duration {
        Duration::from_secs((u64::from(self.config.duration_minutes) * 18 / 5).clamp(10, 30))
    }
    fn begin_preview(&mut self, now: Instant, config: Config, window: Option<Window>) -> Result<(), String> {
        if self.background.is_some() { return Err("休息效果体验正在进行".into()); }
        if matches!(self.phase, Phase::Prompt | Phase::Warning | Phase::Rest) {
            return Err("请先处理当前休息提醒，再体验休息效果".into());
        }
        let mut preview = Self::new(now);
        preview.config = config;
        preview.window = window;
        preview.generation = self.generation;
        preview.offer(now, true);
        let background = std::mem::replace(self, preview);
        self.background = Some(Box::new(background));
        Ok(())
    }
    fn finish_preview(&mut self) {
        if let Some(background) = self.background.take() {
            let generation = self.generation.max(background.generation) + 1;
            *self = *background;
            self.generation = generation;
        }
    }
    fn scheduled(&self) -> &Self { self.background.as_deref().unwrap_or(self) }
    fn reset(&mut self, now: Instant) {
        self.preview = false;
        self.phase(
            if !self.config.enabled {
                Phase::Disabled
            } else if self.window.is_some() {
                Phase::Waiting
            } else {
                Phase::Outside
            },
            now,
            u64::from(self.config.interval_minutes) * 60,
        );
    }
    fn offer(&mut self, now: Instant, preview: bool) {
        self.preview = preview;
        self.quote_pool.clear();
        self.next_quote();
        self.error.clear();
        if self.config.mode == "forced" {
            self.phase(
                if preview { Phase::Rest } else { Phase::Warning },
                now,
                if preview {
                    u64::from(self.config.duration_minutes) * 60
                } else {
                    u64::from(self.config.warning_seconds)
                },
            );
        } else {
            self.phase(Phase::Prompt, now, 0);
        }
    }
    fn next_quote(&mut self) {
        if self.quote_pool.is_empty() {
            self.quote_pool = (0..16).collect();
        }
        // Draw without replacement; also avoid a repeat across cycle boundaries.
        let choices: Vec<_> = self
            .quote_pool
            .iter()
            .enumerate()
            .filter(|(_, value)| **value != self.quote)
            .map(|(i, _)| i)
            .collect();
        let index = if choices.is_empty() {
            0
        } else {
            choices[(uuid::Uuid::new_v4().as_u128() % choices.len() as u128) as usize]
        };
        self.quote = self.quote_pool.swap_remove(index);
    }
    fn advance(&mut self, now: Instant, available: bool, config: Config, window: Option<Window>) {
        if let Some(background) = self.background.as_mut() {
            // Keep the real deadline moving, but defer delivery until the test ends.
            background.advance_timer(now, available, config.clone(), window, true);
        }
        self.advance_timer(now, available, config, window, false);
        if self.background.is_some() && !self.preview { self.finish_preview(); }
    }
    fn advance_timer(&mut self, now: Instant, available: bool, config: Config, window: Option<Window>, defer: bool) {
        let gap = now.saturating_duration_since(self.last_tick) > Duration::from_secs(10);
        self.last_tick = now;
        if self.config != config {
            self.config = config;
            self.window = window;
            self.reset(now);
            return;
        }
        let changed_window = self.window != window;
        self.window = window;
        if !available || gap {
            self.reset(now);
            return;
        }
        // A running rest may finish beyond the window. Pending prompts and
        // snoozes belong to their original window and never carry into the next.
        if !self.preview && self.phase != Phase::Rest
            && (changed_window || (window.is_none() && self.phase != Phase::Outside && self.config.enabled)) {
            self.reset(now);
            return;
        }
        if now < self.deadline {
            if self.phase == Phase::Rest && self.next_quote_at.is_some_and(|due| now >= due) {
                self.next_quote();
                self.next_quote_at = Some(now + self.quote_interval());
            }
            return;
        }
        match self.phase {
            Phase::Waiting if !defer => self.offer(now, false),
            Phase::Warning => self.phase(
                Phase::Rest,
                now,
                u64::from(self.config.duration_minutes) * 60,
            ),
            Phase::Rest => self.reset(now),
            _ => {}
        }
    }
    fn action(
        &mut self,
        action: &str,
        label: &str,
        generation: u64,
        now: Instant,
    ) -> Result<(), String> {
        if generation != self.generation {
            return Err("休息状态已更新，请重试".into());
        }
        if self.background.is_some() && action == "skip" && self.phase == Phase::Prompt {
            self.finish_preview();
            return Ok(());
        }
        match action {
            "start" if self.phase == Phase::Prompt => self.phase(
                Phase::Rest,
                now,
                u64::from(self.config.duration_minutes) * 60,
            ),
            "later" if !self.preview && matches!(self.phase, Phase::Prompt | Phase::Warning) => {
                self.phase(Phase::Waiting, now, 300)
            }
            "skip" if matches!(self.phase, Phase::Prompt | Phase::Warning) => self.reset(now),
            "dismissWarning" if self.phase == Phase::Warning => self.warning_hidden = true,
            "hold" if self.phase == Phase::Rest => {
                self.hold = Some((label.into(), now));
            }
            "cancelHold" => {
                if self.hold.as_ref().is_some_and(|(owner, _)| owner == label) {
                    self.hold = None;
                }
            }
            "exit" if self.phase == Phase::Rest => {
                if !self.hold.as_ref().is_some_and(|(owner, t)| {
                    owner == label && now.saturating_duration_since(*t) >= Duration::from_secs(2)
                }) {
                    return Err("请持续按住 2 秒退出".into());
                }
                self.reset(now);
            }
            _ => return Err("当前状态不支持该操作".into()),
        }
        if self.background.is_some() && !self.preview { self.finish_preview(); }
        Ok(())
    }
}
pub(crate) struct Service {
    runtime: Mutex<Runtime>,
    ready: Mutex<HashSet<String>>,
    pub(crate) operation: Mutex<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    phase: Phase,
    remaining: u64,
    generation: u64,
    quote: usize,
    config: Config,
    theme: String,
    error: String,
    next_start: Option<String>,
    preview: bool,
}
#[tauri::command]
pub fn rest_snapshot(app: tauri::AppHandle, scheduled: Option<bool>) -> Result<Snapshot, String> {
    let theme = super::read_app_settings(&app)?.theme;
    let service = app.state::<Service>();
    let runtime = service.runtime.lock().map_err(|e| e.to_string())?;
    let rt = if scheduled.unwrap_or(false) { runtime.scheduled() } else { &runtime };
    let next_start = if rt.phase == Phase::Outside {
        rt.config.schedule.next_start(chrono::Local::now().naive_local(), &super::load_holidays(&app)?)
    } else { None };
    Ok(Snapshot {
        phase: rt.phase,
        remaining: rt
            .deadline
            .saturating_duration_since(Instant::now())
            .as_millis()
            .div_ceil(1000) as u64,
        generation: rt.generation,
        quote: rt.quote,
        config: rt.config.clone(),
        theme,
        error: rt.error.clone(),
        next_start,
        preview: rt.preview,
    })
}
#[tauri::command]
pub fn rest_ready(window: tauri::WebviewWindow) {
    if window.label().starts_with("rest-") {
        eprintln!("[rest] ready {}", window.label());
        window
            .app_handle()
            .state::<Service>()
            .ready
            .lock()
            .unwrap()
            .insert(window.label().into());
    }
}
#[tauri::command]
pub async fn rest_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: String,
    generation: u64,
) -> Result<(), String> {
    let service = app.state::<Service>();
    let _operation = service.operation.lock().map_err(|e| e.to_string())?;
    let config = super::read_app_settings(&app)?.rest;
    config.validate()?;
    let window_at = config.schedule.window_at(chrono::Local::now().naive_local(), &super::load_holidays(&app)?);
    {
        let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
        if action == "preview" && window.label() == "main" {
            let now = Instant::now();
            rt.advance(now, desktop_available(), config.clone(), window_at);
            rt.begin_preview(now, config, window_at)?;
        } else {
            if !window.label().starts_with("rest-") {
                return Err("无效的休息窗口操作".into());
            }
            rt.advance(Instant::now(), desktop_available(), config, window_at);
            rt.action(&action, window.label(), generation, Instant::now())?;
        }
    }
    present(&app)?;
    let _ = app.emit("rest-changed", ());
    Ok(())
}
#[tauri::command]
pub fn rest_sound_preview(app: tauri::AppHandle) -> Result<(), String> {
    let config = super::read_app_settings(&app)?.rest;
    config.validate()?;
    super::reminder_native::sound(&super::reminders::Config {
        sound: config.sound,
        volume: config.volume,
        ..Default::default()
    })
}
pub fn blocking(app: &tauri::AppHandle) -> bool {
    app.try_state::<Service>()
        .is_some_and(|s| s.runtime.lock().is_ok_and(|r| r.phase == Phase::Rest))
}
#[cfg(windows)]
fn desktop_available() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::*;
    unsafe {
        let desk = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if desk.is_null() {
            return false;
        }
        let mut name = [0u16; 256];
        let mut needed = 0;
        let ok =
            GetUserObjectInformationW(desk, UOI_NAME, name.as_mut_ptr().cast(), 512, &mut needed)
                != 0;
        CloseDesktop(desk);
        ok && String::from_utf16_lossy(
            &name[..name.iter().position(|v| *v == 0).unwrap_or(name.len())],
        )
        .eq_ignore_ascii_case("Default")
    }
}
#[cfg(not(windows))]
fn desktop_available() -> bool {
    true
}

fn ensure_window(app: &tauri::AppHandle, label: &str) -> Result<tauri::WebviewWindow, String> {
    if let Some(w) = app.get_webview_window(label) {
        return Ok(w);
    }
    let w =
        tauri::WebviewWindowBuilder::new(app, label, tauri::WebviewUrl::App("rest.html".into()))
            .title("休息提醒")
            .inner_size(420., 300.)
            .resizable(false)
            .decorations(false)
            .shadow(!label.starts_with("rest-screen-"))
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .build()
            .map_err(|e| e.to_string())?;
    w.on_window_event(|event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
    Ok(w)
}
fn hide_all(app: &tauri::AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with("rest-") {
            hide_rest_window(&w);
        }
    }
}
fn hide_rest_window(w: &tauri::WebviewWindow) {
    if w.label().starts_with("rest-screen-") && w.is_fullscreen().unwrap_or(false) {
        let _ = w.set_fullscreen(false);
        // Restoring native placement may restore visibility as well. Complete it
        // before hiding, otherwise tao's cached hidden state can leave a small window.
        let _ = w.outer_position();
    }
    let _ = w.hide();
}
fn present(app: &tauri::AppHandle) -> Result<(), String> {
    let (phase, config, warning_hidden) = {
        let s = app.state::<Service>();
        let rt = s.runtime.lock().map_err(|e| e.to_string())?;
        (rt.phase, rt.config.clone(), rt.warning_hidden)
    };
    if matches!(phase, Phase::Waiting | Phase::Disabled | Phase::Outside)
        || (phase == Phase::Warning && warning_hidden)
    {
        hide_all(app);
        return Ok(());
    }
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    let primary = main.primary_monitor().map_err(|e| e.to_string())?;
    let mut monitors = main.available_monitors().map_err(|e| e.to_string())?;
    if let Some(p) = primary {
        monitors.sort_by_key(|m| m.position() != p.position());
    }
    if !config.all_screens || phase != Phase::Rest {
        monitors.truncate(1);
    }
    if monitors.is_empty() {
        return Err("没有可用显示器".into());
    }
    let mut wanted = HashSet::new();
    for (i, monitor) in monitors.iter().enumerate() {
        let label = if phase == Phase::Rest {
            format!("rest-screen-{i}")
        } else {
            "rest-notice".into()
        };
        wanted.insert(label.clone());
        let w = ensure_window(app, &label)?;
        if !app
            .state::<Service>()
            .ready
            .lock()
            .unwrap()
            .contains(&label)
        {
            continue;
        }
        let was_visible = w.is_visible().map_err(|e| e.to_string())?;
        w.set_always_on_top(true).map_err(|e| e.to_string())?;
        if phase == Phase::Rest {
            // A screen-sized client area is not fullscreen: Windows can still reserve
            // invisible non-client insets. Enter native borderless fullscreen instead.
            let p = monitor.position();
            let size = monitor.size();
            if !w.is_fullscreen().map_err(|e| e.to_string())?
                || w.outer_position().ok() != Some(*p)
                || w.inner_size().ok() != Some(*size)
            {
                w.set_fullscreen(false).map_err(|e| e.to_string())?;
                // Start small and wholly inside the target screen so Borderless(None)
                // selects that monitor, including secondary screens with different DPI.
                w.set_size(tauri::PhysicalSize::new(100u32, 100u32))
                    .map_err(|e| e.to_string())?;
                w.set_position(tauri::PhysicalPosition::new(p.x + 16, p.y + 16))
                    .map_err(|e| e.to_string())?;
                // Getter synchronizes queued native window mutations before fullscreen.
                w.outer_position().map_err(|e| e.to_string())?;
                w.set_fullscreen(true).map_err(|e| e.to_string())?;
            }
        } else if !was_visible {
            let work = monitor.work_area();
            let scale = monitor.scale_factor();
            let width = (420. * scale) as u32;
            let height = (300. * scale) as u32;
            w.set_size(tauri::PhysicalSize::new(
                width.min(work.size.width),
                height.min(work.size.height),
            ))
            .map_err(|e| e.to_string())?;
            w.set_position(tauri::PhysicalPosition::new(
                work.position.x + (work.size.width.saturating_sub(width) / 2) as i32,
                work.position.y + (work.size.height.saturating_sub(height) / 2) as i32,
            ))
            .map_err(|e| e.to_string())?;
        }
        if !was_visible {
            w.show().map_err(|e| e.to_string())?;
            if i == 0 {
                let _ = w.set_focus();
            }
        }
    }
    for (label, w) in app.webview_windows() {
        if label.starts_with("rest-") && !wanted.contains(&label) {
            hide_rest_window(&w);
        }
    }
    if phase == Phase::Rest {
        if let Some(w) = app.get_webview_window("reminder") {
            let _ = w.hide();
        }
    }
    Ok(())
}
pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    app.manage(Service {
        runtime: Mutex::new(Runtime::new(Instant::now())),
        ready: Mutex::new(HashSet::new()),
        operation: Mutex::new(()),
    });
    ensure_window(app, "rest-notice")?;
    let monitors = app
        .get_webview_window("main")
        .ok_or("主窗口不可用")?
        .available_monitors()
        .map_err(|e| e.to_string())?;
    for i in 0..monitors.len() {
        ensure_window(app, &format!("rest-screen-{i}"))?;
    }
    let h = app.clone();
    std::thread::spawn(move || loop {
        let result = (|| -> Result<(), String> {
            let service = h.state::<Service>();
            let _op = service.operation.lock().map_err(|e| e.to_string())?;
            let config = super::read_app_settings(&h)?.rest;
            config.validate()?;
            let window = config.schedule.window_at(chrono::Local::now().naive_local(), &super::load_holidays(&h)?);
            let (changed, sound) = {
                let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
                let old = rt.generation;
                rt.advance(Instant::now(), desktop_available(), config, window);
                (
                    old != rt.generation,
                    if old != rt.generation && matches!(rt.phase, Phase::Prompt | Phase::Warning) {
                        Some((rt.config.sound.clone(), rt.config.volume))
                    } else {
                        None
                    },
                )
            };
            present(&h)?;
            if let Some((sound, volume)) = sound {
                if let Err(e) = super::reminder_native::sound(&super::reminders::Config {
                    sound,
                    volume,
                    ..Default::default()
                }) {
                    eprintln!("[rest] sound: {e}");
                    service.runtime.lock().map_err(|e| e.to_string())?.error =
                        format!("提示音播放失败：{e}");
                }
            }
            if changed {
                eprintln!("[rest] phase changed");
            }
            let _ = h.emit("rest-changed", ());
            Ok(())
        })();
        if let Err(e) = result {
            hide_all(&h);
            let s = h.state::<Service>();
            let mut rt = s.runtime.lock().unwrap();
            if rt.error != e {
                eprintln!("[rest] {e}");
            }
            rt.error = e;
            rt.reset(Instant::now());
        }
        std::thread::sleep(Duration::from_secs(1));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn enabled(now: Instant, forced: bool) -> Runtime {
        let mut r = Runtime::new(now);
        r.config.enabled = true;
        r.config.interval_minutes = 1;
        r.config.schedule.enabled = false;
        r.window = Some(Window::unrestricted());
        r.config.mode = if forced { "forced" } else { "normal" }.into();
        r.reset(now);
        r
    }
    fn step(r: &mut Runtime, now: Instant) {
        r.last_tick = now;
        r.advance(now, true, r.config.clone(), r.window);
    }
    #[test]
    fn defaults_and_validation() {
        let c: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(c, Config::default());
        assert!(c.enabled);
        assert_eq!(c.interval_minutes, 50);
        assert_eq!(c.duration_minutes, 5);
        assert_eq!(c.mode, "forced");
        assert_eq!(c.warning_seconds, 10);
        assert_eq!(c.sound, "knock");
        assert_eq!(c.volume, 50);
        assert!(c.all_screens);
        assert_eq!(c.schedule.periods[0].end, "11:35");
        assert_eq!(c.schedule.periods[1].start, "13:30");
        assert!(c.schedule.enabled);
        assert_eq!(c.schedule.day_mode, "workday");
        assert_eq!(c.schedule.weekdays, vec![1, 2, 3, 4, 5]);
        let existing: Config = serde_json::from_str(r#"{"enabled":false,"intervalMinutes":30,"mode":"normal","sound":"none"}"#).unwrap();
        assert!(!existing.enabled);
        assert_eq!(existing.interval_minutes, 30);
        assert_eq!(existing.mode, "normal");
        assert_eq!(existing.sound, "none");
        let mut c = c;
        c.duration_minutes = 0;
        assert!(c.validate().is_err());
    }
    fn scheduled_window(time: &str) -> Option<Window> {
        Schedule::default().window_at(
            chrono::NaiveDateTime::parse_from_str(time, "%Y-%m-%d %H:%M").unwrap(),
            &super::super::HolidaysData::default(),
        )
    }
    fn window_step(r: &mut Runtime, now: Instant, window: Option<Window>) {
        r.last_tick = now;
        r.advance(now, true, r.config.clone(), window);
    }
    #[test]
    fn entering_each_window_starts_a_full_interval_and_outside_never_catches_up() {
        let t = Instant::now();
        let mut r = enabled(t, false);
        r.config.schedule.enabled = true;
        window_step(&mut r, t, None);
        assert_eq!(r.phase, Phase::Outside);
        window_step(&mut r, t + Duration::from_secs(7200), None);
        assert_eq!(r.phase, Phase::Outside);
        let morning = scheduled_window("2026-11-11 09:00");
        window_step(&mut r, t + Duration::from_secs(7201), morning);
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(7261));
        window_step(&mut r, t + Duration::from_secs(7261), morning);
        assert_eq!(r.phase, Phase::Prompt);
        window_step(&mut r, t + Duration::from_secs(7262), None);
        assert_eq!(r.phase, Phase::Outside);
        let afternoon = scheduled_window("2026-11-11 13:30");
        window_step(&mut r, t + Duration::from_secs(15000), afternoon);
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(15060));
    }
    #[test]
    fn ending_window_cancels_warning_prompt_and_snooze_with_stale_action_protection() {
        let t = Instant::now();
        for forced in [true, false] {
            let mut r = enabled(t, forced);
            r.window = scheduled_window("2026-11-11 11:34");
            r.offer(t, false);
            let old = r.generation;
            window_step(&mut r, t + Duration::from_secs(1), None);
            assert_eq!(r.phase, Phase::Outside);
            assert!(r.action("start", "rest-notice", old, t).is_err());
            r.window = scheduled_window("2026-11-11 11:34");
            r.offer(t, false);
            r.action("later", "rest-notice", r.generation, t).unwrap();
            window_step(&mut r, t + Duration::from_secs(1), None);
            assert_eq!(r.phase, Phase::Outside);
            window_step(&mut r, t + Duration::from_secs(300), None);
            assert_eq!(r.phase, Phase::Outside);
        }
    }
    #[test]
    fn running_rest_finishes_after_window_end_and_does_not_cancel_hold() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.window = scheduled_window("2026-11-11 11:34");
        r.offer(t, true);
        r.preview = false;
        let generation = r.generation;
        r.action("hold", "rest-screen-0", generation, t).unwrap();
        window_step(&mut r, t + Duration::from_secs(1), None);
        assert_eq!(r.phase, Phase::Rest);
        assert_eq!(r.generation, generation);
        assert!(r.hold.is_some());
        window_step(&mut r, t + Duration::from_secs(299), None);
        assert_eq!(r.phase, Phase::Rest);
        window_step(&mut r, t + Duration::from_secs(300), None);
        assert_eq!(r.phase, Phase::Outside);
    }
    #[test]
    fn immediate_experience_bypasses_schedule_even_with_feature_disabled() {
        let t = Instant::now();
        for forced in [true, false] {
            let mut r = enabled(t, forced);
            r.config.enabled = false;
            r.window = None;
            r.offer(t, true);
            window_step(&mut r, t + Duration::from_secs(1), None);
            assert!(matches!(r.phase, Phase::Rest | Phase::Prompt));
            if !forced { r.action("start", "rest-notice", r.generation, t).unwrap(); }
            window_step(&mut r, t + Duration::from_secs(300), None);
            assert_eq!(r.phase, Phase::Disabled);
        }
    }
    #[test]
    fn separate_preview_keeps_real_deadline_when_completed_or_exited() {
        for forced in [true, false] {
            for early_exit in [true, false] {
                let t = Instant::now();
                let mut r = enabled(t, forced);
                r.config.interval_minutes = 50;
                r.reset(t);
                let deadline = r.deadline;
                let config = r.config.clone();
                let window = r.window;
                r.begin_preview(t, config.clone(), window).unwrap();
                assert_eq!(r.scheduled().deadline, deadline);
                assert!(r.begin_preview(t, config.clone(), window).is_err());
                if !forced { r.action("start", "rest-notice", r.generation, t).unwrap(); }
                let duration = if early_exit { 2 } else { 300 };
                if early_exit { r.action("hold", "rest-screen-0", r.generation, t).unwrap(); }
                for seconds in 1..=duration { r.advance(t + Duration::from_secs(seconds), true, config.clone(), window); }
                if early_exit { r.action("exit", "rest-screen-0", r.generation, t + Duration::from_secs(2)).unwrap(); }
                assert!(r.background.is_none());
                assert!(!r.preview);
                assert_eq!(r.phase, Phase::Waiting);
                assert_eq!(r.deadline, deadline);
                assert_eq!(r.deadline.duration_since(t + Duration::from_secs(duration)).as_secs(), 3000 - duration);
            }
        }
    }
    #[test]
    fn preview_cancel_is_separate_and_stale_actions_cannot_touch_scheduled_session() {
        let t = Instant::now();
        let mut r = enabled(t, false);
        let deadline = r.deadline;
        r.begin_preview(t, r.config.clone(), r.window).unwrap();
        let generation = r.generation;
        assert!(r.action("later", "rest-notice", generation, t).is_err());
        r.action("skip", "rest-notice", generation, t).unwrap();
        assert_eq!(r.deadline, deadline);
        assert!(r.action("start", "rest-notice", generation, t).is_err());
        step(&mut r, t + Duration::from_secs(60));
        assert_eq!(r.phase, Phase::Prompt);
        assert!(r.begin_preview(t, r.config.clone(), r.window).is_err());
    }
    #[test]
    fn due_real_reminder_waits_for_preview_without_consuming_the_reminder() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        let config = r.config.clone();
        let window = r.window;
        r.begin_preview(t, config.clone(), window).unwrap();
        for seconds in 1..=300 { r.advance(t + Duration::from_secs(seconds), true, config.clone(), window); }
        assert!(r.background.is_none());
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(60));
        r.advance(t + Duration::from_secs(301), true, config, window);
        assert_eq!(r.phase, Phase::Warning);
        assert_eq!(r.deadline, t + Duration::from_secs(311));
    }
    #[test]
    fn preview_preserves_schedule_boundaries_and_disabled_state() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.config.schedule.enabled = true;
        r.window = scheduled_window("2026-11-11 11:34");
        let config = r.config.clone();
        r.begin_preview(t, config.clone(), r.window).unwrap();
        for seconds in 1..=300 { r.advance(t + Duration::from_secs(seconds), true, config.clone(), None); }
        assert_eq!(r.phase, Phase::Outside);
        assert!(r.background.is_none());
        r.config.enabled = false;
        r.reset(t);
        let config = r.config.clone();
        r.begin_preview(t, config.clone(), None).unwrap();
        for seconds in 1..=300 { r.advance(t + Duration::from_secs(seconds), true, config.clone(), None); }
        assert_eq!(r.phase, Phase::Disabled);
        assert!(!r.preview);
    }
    #[test]
    fn volume_defaults_roundtrips_and_rejects_values_above_one_hundred() {
        let mut config: Config = serde_json::from_str("{}").unwrap();
        assert_eq!(config.volume, 50);
        for volume in [0, 25, 100] {
            config.volume = volume;
            assert!(config.validate().is_ok());
            let restored: Config = serde_json::from_value(serde_json::to_value(&config).unwrap()).unwrap();
            assert_eq!(restored.volume, volume);
        }
        config.volume = 101;
        assert!(config.validate().is_err());
    }
    #[test]
    fn adjacent_windows_reset_instead_of_carrying_time_and_sleep_outside_stays_idle() {
        let t = Instant::now();
        let mut r = enabled(t, false);
        r.window = scheduled_window("2026-11-11 10:00");
        r.reset(t);
        window_step(&mut r, t + Duration::from_secs(60), scheduled_window("2026-11-11 14:00"));
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(120));
        r.advance(t + Duration::from_secs(500), true, r.config.clone(), None);
        assert_eq!(r.phase, Phase::Outside);
    }
    #[test]
    fn normal_snooze_skip_and_rest() {
        let t = Instant::now();
        let mut r = enabled(t, false);
        step(&mut r, t + Duration::from_secs(60));
        assert_eq!(r.phase, Phase::Prompt);
        r.action(
            "later",
            "rest-notice",
            r.generation,
            t + Duration::from_secs(60),
        )
        .unwrap();
        assert_eq!(r.deadline, t + Duration::from_secs(360));
        step(&mut r, t + Duration::from_secs(360));
        r.action(
            "start",
            "rest-notice",
            r.generation,
            t + Duration::from_secs(360),
        )
        .unwrap();
        assert_eq!(r.phase, Phase::Rest);
        step(&mut r, t + Duration::from_secs(660));
        assert_eq!(r.phase, Phase::Waiting);
    }
    #[test]
    fn forced_warns_then_requires_hold() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        step(&mut r, t + Duration::from_secs(60));
        assert_eq!(r.phase, Phase::Warning);
        step(&mut r, t + Duration::from_secs(90));
        assert_eq!(r.phase, Phase::Rest);
        assert!(r.action("skip", "rest-screen-0", r.generation, t).is_err());
        r.action("hold", "rest-screen-0", r.generation, t).unwrap();
        assert!(r
            .action(
                "exit",
                "rest-screen-1",
                r.generation,
                t + Duration::from_secs(4)
            )
            .is_err());
        assert!(r
            .action(
                "exit",
                "rest-screen-0",
                r.generation,
                t + Duration::from_millis(1999)
            )
            .is_err());
        r.action(
            "exit",
            "rest-screen-0",
            r.generation,
            t + Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(r.phase, Phase::Waiting);
    }
    #[test]
    fn unlock_sleep_and_config_changes_reset() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.offer(t, true);
        r.advance(t + Duration::from_secs(20), true, r.config.clone(), r.window);
        assert_eq!(r.phase, Phase::Waiting);
        r.offer(t, true);
        r.advance(t + Duration::from_secs(21), false, r.config.clone(), r.window);
        assert_eq!(r.phase, Phase::Waiting);
        let mut c = r.config.clone();
        c.enabled = false;
        r.advance(t + Duration::from_secs(22), true, c, r.window);
        assert_eq!(r.phase, Phase::Disabled);
    }
    #[test]
    fn stale_events_and_cancelled_holds_cannot_exit() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.offer(t, true);
        assert!(r
            .action("hold", "rest-screen-0", r.generation - 1, t)
            .is_err());
        r.action("hold", "rest-screen-0", r.generation, t).unwrap();
        r.action("cancelHold", "rest-screen-0", r.generation, t)
            .unwrap();
        assert!(r
            .action(
                "exit",
                "rest-screen-0",
                r.generation,
                t + Duration::from_secs(4)
            )
            .is_err());
    }
    #[test]
    fn random_phrases_do_not_repeat() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        for _ in 0..100 {
            let last = r.quote;
            r.offer(t, true);
            assert_ne!(last, r.quote);
            assert!(r.quote < 16);
        }
    }
    #[test]
    fn warning_duration_defaults_migrates_and_drives_transition() {
        let old: Config = serde_json::from_str(r#"{"mode":"forced"}"#).unwrap();
        assert_eq!(old.warning_seconds, 10);
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.config.warning_seconds = 7;
        r.offer(t, false);
        assert_eq!(r.deadline, t + Duration::from_secs(7));
        step(&mut r, t + Duration::from_secs(6));
        assert_eq!(r.phase, Phase::Warning);
        step(&mut r, t + Duration::from_secs(7));
        assert_eq!(r.phase, Phase::Rest);
        let restored: Config =
            serde_json::from_value(serde_json::to_value(&r.config).unwrap()).unwrap();
        assert_eq!(restored.warning_seconds, 7);
        r.config.warning_seconds = 0;
        assert!(r.config.validate().is_err());
        r.config.warning_seconds = 301;
        assert!(r.config.validate().is_err());
    }
    #[test]
    fn forced_snooze_waits_five_minutes_then_repeats_warning() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.offer(t, false);
        let old_generation = r.generation;
        r.action("later", "rest-notice", old_generation, t).unwrap();
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(300));
        assert!(r.action("skip", "rest-notice", old_generation, t).is_err());
        step(&mut r, t + Duration::from_secs(299));
        assert_eq!(r.phase, Phase::Waiting);
        step(&mut r, t + Duration::from_secs(300));
        assert_eq!(r.phase, Phase::Warning);
        assert_eq!(r.deadline, t + Duration::from_secs(310));
        step(&mut r, t + Duration::from_secs(310));
        assert_eq!(r.phase, Phase::Rest);
        assert!(r
            .action(
                "later",
                "rest-screen-0",
                r.generation,
                t + Duration::from_secs(310)
            )
            .is_err());
    }
    #[test]
    fn automatic_quotes_use_adaptive_interval_and_do_not_repeat_or_reset_hold() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.config.duration_minutes = 1;
        assert_eq!(r.quote_interval(), Duration::from_secs(10));
        r.config.duration_minutes = 60;
        assert_eq!(r.quote_interval(), Duration::from_secs(30));
        r.config.duration_minutes = 5;
        assert_eq!(r.quote_interval(), Duration::from_secs(18));
        r.offer(t, true);
        let first = r.quote;
        let generation = r.generation;
        step(&mut r, t + Duration::from_secs(17));
        assert_eq!(r.quote, first);
        r.action(
            "hold",
            "rest-screen-0",
            generation,
            t + Duration::from_secs(17),
        )
        .unwrap();
        let mut seen = HashSet::from([first]);
        for i in 1..16 {
            step(&mut r, t + Duration::from_secs(i * 18));
            assert!(seen.insert(r.quote));
        }
        assert_eq!(r.generation, generation);
        assert!(r.hold.is_some());
        let last = r.quote;
        step(&mut r, t + Duration::from_secs(288));
        assert_ne!(last, r.quote);
        let last = r.quote;
        step(&mut r, t + Duration::from_secs(300));
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.quote, last);
        assert!(r.next_quote_at.is_none());
    }
    #[test]
    fn each_phrase_cycle_is_unique_and_new_break_resets_pool() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.offer(t, true);
        for _ in 0..4 {
            let mut seen = HashSet::new();
            for _ in 0..16 {
                assert!(seen.insert(r.quote));
                let previous = r.quote;
                r.next_quote();
                assert_ne!(previous, r.quote);
            }
            assert_eq!(seen.len(), 16);
        }
        r.offer(t, true);
        assert_eq!(r.quote_pool.len(), 15);
    }
    #[test]
    fn dismiss_keeps_warning_deadline_but_skip_starts_next_interval() {
        let t = Instant::now();
        let mut r = enabled(t, true);
        r.offer(t, false);
        let due = r.deadline;
        r.action("dismissWarning", "rest-notice", r.generation, t)
            .unwrap();
        assert!(r.warning_hidden);
        assert_eq!(r.deadline, due);
        assert_eq!(r.phase, Phase::Warning);
        step(&mut r, due);
        assert_eq!(r.phase, Phase::Rest);
        assert!(!r.warning_hidden);
        r.offer(t, false);
        r.action("skip", "rest-notice", r.generation, t).unwrap();
        assert_eq!(r.phase, Phase::Waiting);
        assert_eq!(r.deadline, t + Duration::from_secs(60));
    }
}
