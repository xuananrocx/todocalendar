use super::{app_dir, load_data, load_settings, lock_store, reminder_native, storage, Data};
use chrono::{DateTime, Local, NaiveDate, NaiveTime, TimeZone, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{Emitter, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub enabled: bool,
    pub scope: String,
    pub date_start: String,
    pub date_end: String,
    pub count: u32,
    pub interval_minutes: u32,
    pub start_minutes: u32,
    pub end_minutes: u32,
    pub popup: bool,
    pub system: bool,
    pub topmost: bool,
    pub policy: String,
    pub snooze_minutes: u32,
    pub sound: String,
    pub volume: u32,
    pub default_group_enabled: bool,
    pub new_group_enabled: bool,
    pub group_enabled: BTreeMap<String, bool>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            scope: "both".into(),
            date_start: "09:30".into(),
            date_end: "09:30".into(),
            count: 1,
            interval_minutes: 180,
            start_minutes: 10,
            end_minutes: 30,
            popup: true,
            system: true,
            topmost: true,
            policy: "ack".into(),
            snooze_minutes: 10,
            sound: "knock".into(),
            volume: 50,
            default_group_enabled: true,
            new_group_enabled: true,
            group_enabled: BTreeMap::new(),
        }
    }
}
impl Config {
    pub fn group_is_enabled(&self, group_id: Option<&str>) -> bool {
        match group_id {
            None => self.default_group_enabled,
            Some(id) => self.group_enabled.get(id).copied().unwrap_or(self.new_group_enabled),
        }
    }

    // Freeze existing groups before changing the default for future groups.
    // Keeping this in the settings transaction avoids a second write to todos.json.
    pub fn preserve_existing_groups(&mut self, data: &Data) {
        for group in &data.groups {
            self.group_enabled.entry(group.id.clone()).or_insert(self.new_group_enabled);
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if !["both", "start", "end"].contains(&self.scope.as_str())
            || !["ack", "shown"].contains(&self.policy.as_str())
            || !["none", "system", "knock", "notes"].contains(&self.sound.as_str())
        {
            return Err("提醒选项无效".into());
        }
        if !(1..=12).contains(&self.count)
            || !(1..=1440).contains(&self.interval_minutes)
            || !(1..=1440).contains(&self.snooze_minutes)
            || self.start_minutes > 10080
            || self.end_minutes > 10080
            || self.volume > 100
        {
            return Err("提醒次数、间隔、提前量或音量超出范围".into());
        }
        for s in [&self.date_start, &self.date_end] {
            let t = NaiveTime::parse_from_str(s, "%H:%M").map_err(|_| "提醒时间应为 HH:MM")?;
            if t.hour() * 60 + t.minute() + (self.count - 1) * self.interval_minutes >= 1440 {
                return Err("仅日期提醒不能跨到次日，请减少次数或间隔".into());
            }
        }
        if self.enabled && !self.popup && !self.system {
            return Err("请至少开启一种提醒方式".into());
        }
        Ok(())
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Record {
    acknowledged: bool,
    delivered: u32,
    snooze: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
struct Ledger {
    version: u32,
    records: BTreeMap<String, Record>,
    #[serde(default)]
    position: Option<(i32, i32)>,
}
impl Default for Ledger {
    fn default() -> Self {
        Self {
            version: 1,
            records: BTreeMap::new(),
            position: None,
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub key: String,
    pub todo_id: String,
    pub title: String,
    pub path: String,
    pub kind: String,
    pub target: i64,
    pub date_only: bool,
    pub date: String,
    pub batch: u32,
    pub count: u32,
    pub due: i64,
}
impl Item {
    pub fn is_overdue(&self, now: &DateTime<Local>) -> bool {
        self.kind == "end" && if self.date_only {
            NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").ok()
                .is_some_and(|date| date < now.date_naive())
        } else { self.target <= now.timestamp() }
    }
    fn overdue_seconds(&self, now: &DateTime<Local>) -> i64 {
        if self.date_only {
            NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").ok()
                .map(|date| now.date_naive().signed_duration_since(date).num_days().max(0) * 86400)
                .unwrap_or(0)
        } else { now.timestamp().saturating_sub(self.target).max(0) }
    }
    fn sort_target(&self) -> i64 {
        if self.kind == "end" && self.date_only {
            NaiveDate::parse_from_str(&self.date, "%Y-%m-%d").ok()
                .and_then(|date| date.succ_opt())
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .and_then(|date| Local.from_local_datetime(&date).earliest())
                .map(|date| date.timestamp()).unwrap_or(self.target)
        } else { self.target }
    }
}
struct Candidate {
    item: Item,
    due: Vec<i64>,
}
#[derive(Default)]
struct Runtime {
    active: BTreeMap<String, Item>,
    offered: BTreeMap<String, u32>,
    last_error: String,
    retry_after: i64,
    notification_text: Option<(String, String)>,
}
impl Runtime {
    fn items(&self) -> Vec<Item> {
        self.items_at(&Local::now())
    }

    fn items_at(&self, now: &DateTime<Local>) -> Vec<Item> {
        let mut items: Vec<_> = self.active.values().cloned().collect();
        items.sort_by_key(|i| {
            let overdue = i.is_overdue(now);
            (if overdue { 0 } else if i.kind == "end" { 1 } else { 2 },
             if overdue { -i.overdue_seconds(now) } else { i.sort_target() }, i.key.clone())
        });
        items
    }

    fn reconcile(&mut self, candidates: Vec<Candidate>, ledger: &Ledger, policy: &str, now: i64) -> Vec<Item> {
        let valid: HashSet<_> = candidates.iter().map(|c| c.item.key.clone()).collect();
        self.active.retain(|k, _| valid.contains(k));
        self.offered.retain(|k, _| valid.contains(k));
        let mut fresh = vec![];
        for c in candidates {
            let r = ledger.records.get(&c.item.key).cloned().unwrap_or_default();
            if let Some(item) = pending(&c, &r, now, policy) {
                if self.offered.get(&item.key).copied().unwrap_or(0) < item.batch {
                    fresh.push(item.clone());
                }
                self.active.insert(item.key.clone(), item);
            } else if !self.active.contains_key(&c.item.key)
                || r.acknowledged || r.snooze.is_some()
                || c.due.first().is_some_and(|t| *t > now) {
                self.active.remove(&c.item.key);
                self.offered.remove(&c.item.key);
            } else if let Some(item) = self.active.get_mut(&c.item.key) {
                // Displayed-policy reminders stay in the open summary until handled.
                item.title = c.item.title;
                item.path = c.item.path;
            }
        }
        fresh
    }
}

pub struct Service {
    runtime: Mutex<Runtime>,
    layout: Mutex<()>,
    ready: AtomicBool,
}

fn time(value: &str, precision: Option<bool>) -> Option<(DateTime<Local>, bool)> {
    if let Ok(d) = NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return Local
            .from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
            .earliest()
            .map(|t| (t, true));
    }
    let t = DateTime::parse_from_rfc3339(value)
        .ok()?
        .with_timezone(&Local);
    let date_only = !precision.unwrap_or(t.hour() != 0 || t.minute() != 0 || t.second() != 0);
    Some((t, date_only))
}
fn candidates(data: &Data, cfg: &Config) -> Vec<Candidate> {
    let mut output = vec![];
    for todo in &data.todos {
        if todo.done || todo.archived_at.is_some() || todo.suspended_at.is_some()
            || !cfg.group_is_enabled(todo.group_id.as_deref()) {
            continue;
        }
        let mut names = vec![];
        let mut parent = todo.parent_id.as_deref();
        let mut seen = HashSet::new();
        while let Some(id) = parent {
            if !seen.insert(id) {
                break;
            }
            let Some(p) = data.todos.iter().find(|t| t.id == id) else {
                break;
            };
            names.push(p.title.clone());
            parent = p.parent_id.as_deref();
        }
        names.reverse();
        if let Some(g) = data
            .groups
            .iter()
            .find(|g| Some(&g.id) == todo.group_id.as_ref())
        {
            names.insert(0, g.name.clone());
        }
        for (kind, value, precision, clock, lead) in [
            (
                "start",
                &todo.start_time,
                todo.start_has_time,
                &cfg.date_start,
                cfg.start_minutes,
            ),
            (
                "end",
                &todo.end_time,
                todo.end_has_time,
                &cfg.date_end,
                cfg.end_minutes,
            ),
        ] {
            if cfg.scope != "both" && cfg.scope != kind {
                continue;
            }
            let Some((target, date_only)) = value.as_deref().and_then(|v| time(v, precision))
            else {
                continue;
            };
            let due = if date_only {
                let Ok(clock) = NaiveTime::parse_from_str(clock, "%H:%M") else {
                    continue;
                };
                (0..cfg.count)
                    .filter_map(|i| {
                        let local = target.date_naive().and_time(clock)
                            + chrono::Duration::minutes((i * cfg.interval_minutes) as i64);
                        Local
                            .from_local_datetime(&local)
                            .earliest()
                            .map(|t| t.timestamp())
                    })
                    .collect::<Vec<_>>()
            } else {
                vec![target.timestamp() - i64::from(lead) * 60]
            };
            let identity = if date_only {
                target.format("%Y-%m-%d").to_string()
            } else {
                target.timestamp().to_string()
            };
            let key = serde_json::to_string(&(&todo.id, kind, identity, date_only)).unwrap();
            output.push(Candidate {
                item: Item {
                    key,
                    todo_id: todo.id.clone(),
                    title: todo.title.clone(),
                    path: names.join(" / "),
                    kind: kind.into(),
                    target: target.timestamp(),
                    date_only,
                    date: target.format("%Y-%m-%d").to_string(),
                    batch: 0,
                    count: due.len() as u32,
                    due: due.first().copied().unwrap_or(0),
                },
                due,
            });
        }
    }
    output
}
fn pending(c: &Candidate, r: &Record, now: i64, policy: &str) -> Option<Item> {
    if r.acknowledged {
        return None;
    }
    let batch = c.due.iter().filter(|t| **t <= now).count() as u32;
    if batch == 0 {
        return None;
    }
    if let Some(until) = r.snooze {
        if until > now {
            return None;
        }
    } else if policy == "shown" && batch <= r.delivered {
        return None;
    }
    let mut item = c.item.clone();
    item.batch = batch;
    item.due = c.due[batch as usize - 1];
    Some(item)
}
fn ledger(dir: &std::path::Path) -> Result<Ledger, String> {
    let l: Ledger = storage::read_optional(&dir.join("reminder-state.json"))?.unwrap_or_default();
    if l.version != 1 {
        return Err("不支持的提醒记录版本".into());
    }
    Ok(l)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    items: Vec<Item>,
    config: Config,
    theme: String,
    error: String,
}
#[tauri::command]
pub fn reminder_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    let _lock = lock_store(&app)?;
    let settings = load_settings(&app_dir(&app)?.join("settings.json"))?;
    let data = load_data(&app_dir(&app)?.join("todos.json"))?;
    let valid: HashSet<_> = candidates(&data, &settings.reminders).into_iter().map(|c| c.item.key).collect();
    let service = app.state::<Service>();
    let rt = service.runtime.lock().map_err(|e| e.to_string())?;
    let items = rt.items().into_iter()
        .filter(|i| settings.reminders.enabled && valid.contains(&i.key)).collect();
    Ok(Snapshot {
        items,
        config: settings.reminders,
        theme: settings.theme,
        error: rt.last_error.clone(),
    })
}
#[tauri::command]
pub fn reminder_ready(app: tauri::AppHandle) {
    app.state::<Service>().ready.store(true, Ordering::Release);
}

#[tauri::command]
pub fn reminder_open_todo(app: tauri::AppHandle, id: String) -> Result<(), String> {
    {
        let _l = lock_store(&app)?;
        let data = load_data(&app_dir(&app)?.join("todos.json"))?;
        if !data
            .todos
            .iter()
            .any(|t| t.id == id && t.archived_at.is_none())
        {
            return Err("该待办已不存在或已归档".into());
        }
    }
    let main = app.get_webview_window("main").ok_or("主窗口不可用")?;
    main.show().map_err(|e| e.to_string())?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;
    app.emit_to("main", "reminder-open-todo", id)
        .map_err(|e| e.to_string())
}

pub fn notification_failed(
    app: &tauri::AppHandle,
    items: Vec<Item>,
    only_system: bool,
    error: String,
) {
    let result = (|| -> Result<(), String> {
        let _l = lock_store(app)?;
        let dir = app_dir(app)?;
        let service = app.state::<Service>();
        let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
        if only_system {
            let mut l = ledger(&dir)?;
            for item in items {
                if let Some(r) = l.records.get_mut(&item.key) {
                    if !r.acknowledged {
                        r.delivered = r.delivered.min(item.batch.saturating_sub(1));
                    }
                }
                rt.offered.remove(&item.key);
            }
            storage::write_json(&dir.join("reminder-state.json"), &l)?;
        }
        rt.last_error = error.clone();
        rt.retry_after = Utc::now().timestamp() + 60;
        Ok(())
    })();
    eprintln!("[reminders] {error}; state={result:?}");
    let _ = app.emit("reminder-error", error);
}

#[tauri::command]
pub fn reminder_action(
    app: tauri::AppHandle,
    keys: Vec<String>,
    action: String,
) -> Result<(), String> {
    if !["ack", "snooze"].contains(&action.as_str()) {
        return Err("未知提醒操作".into());
    }
    let _lock = lock_store(&app)?;
    let dir = app_dir(&app)?;
    let cfg = load_settings(&dir.join("settings.json"))?.reminders;
    let data = load_data(&dir.join("todos.json"))?;
    let valid: HashSet<_> = candidates(&data, &cfg).into_iter().map(|c| c.item.key).collect();
    let mut l = ledger(&dir)?;
    let service = app.state::<Service>();
    let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
    for key in &keys {
        if !cfg.enabled || !valid.contains(key) || !rt.active.contains_key(key) {
            continue;
        }
        let record = l.records.entry(key.clone()).or_default();
        if action == "ack" {
            record.acknowledged = true;
            record.snooze = None;
        } else {
            record.snooze = Some(Utc::now().timestamp() + i64::from(cfg.snooze_minutes) * 60);
        }
    }
    storage::write_json(&dir.join("reminder-state.json"), &l)?;
    for key in keys {
        rt.active.remove(&key);
        rt.offered.remove(&key);
    }
    let remaining = rt.items();
    let empty = remaining.is_empty();
    drop(rt);
    drop(_lock);
    let notification_error = reminder_native::sync(&app, &remaining, &cfg).err();
    if empty {
        if let Some(w) = app.get_webview_window("reminder") {
            w.hide().map_err(|e| e.to_string())?;
        }
    }
    let _ = app.emit("reminders-changed", ());
    if let Some(error) = notification_error {
        notification_failed(&app, vec![], false, error);
    }
    Ok(())
}

#[tauri::command]
pub fn reminder_sound_preview(app: tauri::AppHandle) -> Result<(), String> {
    let cfg = {
        let _l = lock_store(&app)?;
        load_settings(&app_dir(&app)?.join("settings.json"))?.reminders
    };
    reminder_native::sound(&cfg)
}
fn fit_window(window: &tauri::WebviewWindow, requested: Option<f64>) -> Result<(), String> {
    let service = window.state::<Service>();
    let _layout = service.layout.lock().map_err(|e| e.to_string())?;
    let monitor = window.current_monitor().map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?).ok_or("无法获取显示器尺寸")?;
    let area = monitor.work_area();
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let outer = window.outer_size().map_err(|e| e.to_string())?;
    let inner = window.inner_size().map_err(|e| e.to_string())?;
    let frame_height = outer.height.saturating_sub(inner.height) as f64;
    let frame_width = outer.width.saturating_sub(inner.width) as f64;
    let available_height = ((area.size.height as f64 - frame_height) / scale - 16.).max(120.);
    let available_width = ((area.size.width as f64 - frame_width) / scale - 16.).max(320.);
    let height = requested.unwrap_or(inner.height as f64 / scale).clamp(160., 520.).min(available_height);
    let width = 400_f64.min(available_width);
    if (inner.height as f64 / scale - height).abs() > 1.
        || (inner.width as f64 / scale - width).abs() > 1. {
        window.set_size(tauri::LogicalSize::new(width, height)).map_err(|e| e.to_string())?;
        eprintln!("[reminders] resize width={width:.0} height={height:.0}");
    }
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let margin = (8. * scale).round() as i32;
    let x = clamp_window_axis(position.x, area.position.x, area.size.width, size.width, margin);
    let y = clamp_window_axis(position.y, area.position.y, area.size.height, size.height, margin);
    if x != position.x || y != position.y {
        window.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn clamp_window_axis(position: i32, origin: i32, available: u32, extent: u32, margin: i32) -> i32 {
    let min = origin.saturating_add(margin);
    let max = (i64::from(origin) + i64::from(available) - i64::from(extent) - i64::from(margin))
        .clamp(i64::from(min), i64::from(i32::MAX)) as i32;
    position.clamp(min, max)
}

#[tauri::command]
pub async fn reminder_resize(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != "reminder" || !height.is_finite() {
        return Err("无效的提醒窗口尺寸请求".into());
    }
    fit_window(&window, Some(height))
}

pub fn show(app: &tauri::AppHandle) -> Result<(), String> {
    let w = app
        .get_webview_window("reminder")
        .ok_or("提醒窗口尚未就绪")?;
    if !w.is_visible().unwrap_or(false) {
        let position = {
            let _l = lock_store(app)?;
            ledger(&app_dir(app)?)?.position
        };
        if let Some((x, y)) = position {
            w.set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
    }
    // Re-check the whole window against the work area, including taskbar and DPI.
    fit_window(&w, None)?;
    // Keep tao's visibility flags in sync; raw ShowWindow makes later hide() a no-op.
    w.set_focusable(false).map_err(|e| e.to_string())?;
    let shown = w.show().map_err(|e| e.to_string());
    let focusable = w.set_focusable(true).map_err(|e| e.to_string());
    shown.and(focusable)
}

fn tick(app: &tauri::AppHandle) -> Result<(), String> {
    let service = app.state::<Service>();
    if !service.ready.load(Ordering::Acquire) {
        return Ok(());
    }
    let _lock = lock_store(app)?;
    let dir = app_dir(app)?;
    let cfg = load_settings(&dir.join("settings.json"))?.reminders;
    cfg.validate()?;
    let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
    if !cfg.enabled {
        let dirty = !rt.active.is_empty();
        rt.active.clear();
        rt.offered.clear();
        rt.retry_after = 0;
        rt.notification_text = None;
        drop(rt);
        drop(_lock);
        if dirty {
            reminder_native::clear(app);
            if let Some(w) = app.get_webview_window("reminder") {
                let _ = w.hide();
            }
        }
        return Ok(());
    }
    let retrying = rt.retry_after > Utc::now().timestamp();
    let data = load_data(&dir.join("todos.json"))?;
    let mut l = ledger(&dir)?;
    let old = serde_json::to_string(&rt.active).unwrap();
    let fresh = rt.reconcile(candidates(&data, &cfg), &l, &cfg.policy, Utc::now().timestamp());
    let summary = rt.items();
    let text = reminder_native::notification_text(&summary, &Local::now());
    let status_changed = rt.notification_text.as_ref() != Some(&text);
    rt.notification_text = Some(text);
    let changed = old != serde_json::to_string(&rt.active).unwrap();
    let empty = rt.active.is_empty();
    drop(rt);
    drop(_lock);
    if let Some(w) = app.get_webview_window("reminder") {
        let _ = w.set_always_on_top(cfg.topmost);
        if empty {
            let _ = w.hide();
        }
    }
    if changed {
        let _ = app.emit("reminders-changed", ());
    }
    if (changed || status_changed) && (fresh.is_empty() || retrying) {
        reminder_native::sync(app, &summary, &cfg)?;
    }
    if fresh.is_empty() || retrying {
        return Ok(());
    }
    let mut delivered = false;
    let mut system_delivered = false;
    let mut errors = vec![];
    if cfg.popup {
        match show(app) {
            Ok(()) => delivered = true,
            Err(e) => errors.push(e),
        }
    }
    if cfg.system {
        match reminder_native::notify(app, &summary, &fresh, &cfg, false) {
            Ok(()) => {
                delivered = true;
                system_delivered = true;
            }
            Err(e) => errors.push(e),
        }
    }
    if !delivered {
        return Err(errors.join("；"));
    }
    if cfg.sound != "system" || !system_delivered {
        if let Err(e) = reminder_native::sound(&cfg) {
            errors.push(e);
        }
    }
    // Re-read under the lock: a click may have acknowledged/snoozed while windows were shown.
    let _lock = lock_store(app)?;
    l = ledger(&dir)?;
    let mut rt = service.runtime.lock().map_err(|e| e.to_string())?;
    for item in &fresh {
        if rt.active.contains_key(&item.key) {
            let r = l.records.entry(item.key.clone()).or_default();
            r.delivered = r.delivered.max(item.batch);
            if r.snooze.is_some_and(|t| t <= Utc::now().timestamp()) {
                r.snooze = None;
            }
        }
    }
    storage::write_json(&dir.join("reminder-state.json"), &l)?;
    for item in fresh {
        if rt.active.contains_key(&item.key) {
            rt.offered.insert(item.key, item.batch);
        }
    }
    rt.last_error = errors.join("；");
    eprintln!(
        "[reminders] delivery popup={} system={} active={}",
        cfg.popup,
        cfg.system,
        rt.active.len()
    );
    if !rt.last_error.is_empty() {
        eprintln!("[reminders] {}", rt.last_error);
    }
    Ok(())
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    reminder_native::single_instance(app)?;
    reminder_native::clear(app);
    app.manage(Service {
        runtime: Mutex::new(Runtime::default()),
        layout: Mutex::new(()),
        ready: AtomicBool::new(false),
    });
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "reminder",
        tauri::WebviewUrl::App("reminder.html".into()),
    )
    .title("待办提醒")
    .inner_size(400., 220.)
    .min_inner_size(320., 120.)
    .visible(false)
    .focused(false)
    .center()
    .build()
    .map_err(|e| e.to_string())?;
    let h = app.clone();
    window.on_window_event(move |e| {
        if let tauri::WindowEvent::Moved(p) = e {
            let h = h.clone();
            let position = (p.x, p.y);
            std::thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let _l = lock_store(&h)?;
                    let dir = app_dir(&h)?;
                    let mut l = ledger(&dir)?;
                    if l.position != Some(position) {
                        l.position = Some(position);
                        storage::write_json(&dir.join("reminder-state.json"), &l)?;
                    }
                    Ok(())
                })();
                if let Err(e) = result {
                    eprintln!("[reminders] position: {e}");
                }
            });
        } else if let tauri::WindowEvent::CloseRequested { api, .. } = e {
            api.prevent_close();
            let h = h.clone();
            std::thread::spawn(move || {
                let keys = h
                    .state::<Service>()
                    .runtime
                    .lock()
                    .unwrap()
                    .active
                    .keys()
                    .cloned()
                    .collect();
                if let Err(e) = reminder_action(h.clone(), keys, "ack".into()) {
                    super::report_storage_error(&h, &e);
                }
            });
        }
    });
    let h = app.clone();
    std::thread::spawn(move || loop {
        if let Err(e) = tick(&h) {
            let s = h.state::<Service>();
            let mut rt = s.runtime.lock().unwrap();
            rt.retry_after = Utc::now().timestamp() + 60;
            if rt.last_error != e {
                rt.last_error = e.clone();
                eprintln!("[reminders] {e}");
                let _ = h.emit("reminder-error", &e);
            }
        }
        std::thread::sleep(std::time::Duration::from_secs(2));
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn data() -> Data {
        serde_json::from_value(serde_json::json!({"version":"2","updatedAt":"","todos":[{"id":"t","title":"test","startTime":"2026-11-09T00:00:00+08:00","endTime":"2026-11-10T15:00:00+08:00","startHasTime":false,"endHasTime":true}]})).unwrap()
    }
    fn timed_data() -> (Data, Config, i64) {
        let now = 1_800_000_000;
        let mut d = data();
        d.todos[0].start_time = Some(Utc.timestamp_opt(now, 0).unwrap().to_rfc3339());
        d.todos[0].start_has_time = Some(true);
        let mut second = d.todos[0].clone(); second.id = "second".into();
        second.start_time = Some(Utc.timestamp_opt(now + 60, 0).unwrap().to_rfc3339());
        d.todos.push(second);
        let mut cfg = Config::default(); cfg.scope = "start".into(); cfg.start_minutes = 0;
        (d, cfg, now)
    }
    fn delivered(rt: &mut Runtime, ledger: &mut Ledger, fresh: &[Item]) {
        for item in fresh {
            rt.offered.insert(item.key.clone(), item.batch);
            ledger.records.entry(item.key.clone()).or_default().delivered = item.batch;
        }
    }
    fn ordering_fixture() -> (Runtime, DateTime<Local>) {
        let now = Local.with_ymd_and_hms(2026, 11, 11, 12, 0, 0).single().unwrap();
        let mut rt = Runtime::default();
        for (key, kind, date_only, date, target) in [
            ("today", "end", true, "2026-11-11", now.timestamp() - 43200),
            ("yesterday", "end", true, "2026-11-10", now.timestamp() - 129600),
            ("minute", "end", false, "2026-11-11", now.timestamp() - 60),
            ("second", "end", false, "2026-11-11", now.timestamp() - 1),
            ("future", "end", false, "2026-11-11", now.timestamp() + 60),
            ("start", "start", false, "2026-11-10", now.timestamp() - 86400),
        ] {
            let item: Item = serde_json::from_value(serde_json::json!({"key":key,"todoId":key,"title":key,"path":"Work","kind":kind,"target":target,"dateOnly":date_only,"date":date,"batch":1,"count":1,"due":0})).unwrap();
            rt.active.insert(key.into(), item);
        }
        (rt, now)
    }
    #[test]
    fn overdue_even_one_second_precedes_today_and_start_reminders() {
        let (rt, now) = ordering_fixture();
        let keys: Vec<_> = rt.items_at(&now).into_iter().map(|i| i.key).collect();
        assert_eq!(keys, ["yesterday", "minute", "second", "future", "today", "start"]);
        assert!(!rt.active["today"].is_overdue(&now));
        assert!(rt.active["second"].is_overdue(&now));
        assert!(!rt.active["start"].is_overdue(&now));
    }
    #[test]
    fn deadline_order_uses_day_end_and_updates_status_with_stable_ties() {
        let (mut rt, now) = ordering_fixture();
        let minute_later = now + chrono::Duration::minutes(1);
        assert!(rt.active["future"].is_overdue(&minute_later));
        let midnight = Local.with_ymd_and_hms(2026, 11, 12, 0, 0, 0).single().unwrap();
        assert!(rt.active["today"].is_overdue(&midnight));
        assert_eq!(rt.active["today"].sort_target(), midnight.timestamp());
        let mut tie = rt.active["minute"].clone(); tie.key = "minute-z".into();
        rt.active.insert(tie.key.clone(), tie);
        let keys: Vec<_> = rt.items_at(&midnight).into_iter().map(|i| i.key).collect();
        assert_eq!(keys, ["yesterday", "today", "minute", "minute-z", "second", "future", "start"]);
    }
    #[test]
    fn mixed_precision_sorts_displayed_day_above_17_hours_but_below_25_hours() {
        let (mut rt, now) = ordering_fixture();
        rt.active.retain(|key, _| key == "yesterday");
        let mut timed = rt.active["yesterday"].clone();
        timed.date_only = false; timed.key = "timed".into();
        timed.target = now.timestamp() - 17 * 3600;
        rt.active.insert(timed.key.clone(), timed.clone());
        assert_eq!(rt.items_at(&now)[0].key, "yesterday");
        timed.target = now.timestamp() - 25 * 3600;
        rt.active.insert(timed.key.clone(), timed.clone());
        assert_eq!(rt.items_at(&now)[0].key, "timed");
        timed.target = now.timestamp() - 86399;
        rt.active.insert(timed.key.clone(), timed);
        assert_eq!(rt.items_at(&now)[0].key, "yesterday");
        assert_eq!(rt.items_at(&(now + chrono::Duration::seconds(2)))[0].key, "timed");
    }
    #[test]
    fn becoming_overdue_does_not_offer_an_already_open_reminder_again() {
        let (mut d, mut cfg, now) = timed_data();
        d.todos.truncate(1); cfg.scope = "end".into(); cfg.end_minutes = 1;
        d.todos[0].end_time = Some(Utc.timestamp_opt(now + 60, 0).unwrap().to_rfc3339());
        d.todos[0].end_has_time = Some(true);
        let mut rt = Runtime::default(); let mut l = Ledger::default();
        let fresh = rt.reconcile(candidates(&d, &cfg), &l, "ack", now);
        assert_eq!(fresh.len(), 1); delivered(&mut rt, &mut l, &fresh);
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 60).is_empty());
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 120).is_empty());
        let later = Utc.timestamp_opt(now + 120, 0).unwrap().with_timezone(&Local);
        assert!(rt.items_at(&later)[0].is_overdue(&later));
    }
    #[test]
    fn staggered_reminders_share_one_summary_without_reoffering_old_items() {
        let (d, cfg, now) = timed_data();
        let mut rt = Runtime::default(); let mut l = Ledger::default();
        let a = rt.reconcile(candidates(&d, &cfg), &l, "ack", now);
        assert_eq!((a.len(), rt.items().len()), (1, 1)); delivered(&mut rt, &mut l, &a);
        let b = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 60);
        assert_eq!((b.len(), rt.items().len()), (1, 2));
        assert_eq!(b[0].todo_id, "second"); delivered(&mut rt, &mut l, &b);
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 61).is_empty());
        assert_eq!(rt.items().len(), 2);
    }
    #[test]
    fn editing_two_times_replaces_old_plans_then_regroups_new_due_items() {
        let (mut d, cfg, now) = timed_data();
        let mut rt = Runtime::default(); let mut l = Ledger::default();
        let old = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 60);
        assert_eq!(old.len(), 2); delivered(&mut rt, &mut l, &old);
        for (i, t) in d.todos.iter_mut().enumerate() {
            t.start_time = Some(Utc.timestamp_opt(now + 120 + i as i64 * 60, 0).unwrap().to_rfc3339());
        }
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 61).is_empty());
        assert!(rt.items().is_empty());
        let first = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 120);
        assert_eq!((first.len(), rt.items().len()), (1, 1)); delivered(&mut rt, &mut l, &first);
        let second = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 180);
        assert_eq!((second.len(), rt.items().len()), (1, 2));
        assert!(rt.items().iter().all(|i| old.iter().all(|o| o.key != i.key)));
    }
    #[test]
    fn acknowledged_and_snoozed_items_leave_summary_without_losing_other_items() {
        let (d, cfg, now) = timed_data();
        let mut rt = Runtime::default(); let mut l = Ledger::default();
        let all = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 60);
        delivered(&mut rt, &mut l, &all);
        let first = all.iter().find(|i| i.todo_id == "t").unwrap();
        l.records.get_mut(&first.key).unwrap().snooze = Some(now + 120);
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 61).is_empty());
        assert_eq!(rt.items().len(), 1);
        let returned = rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 120);
        assert_eq!((returned.len(), rt.items().len()), (1, 2));
        l.records.get_mut(&first.key).unwrap().acknowledged = true;
        assert!(rt.reconcile(candidates(&d, &cfg), &l, "ack", now + 121).is_empty());
        assert_eq!(rt.items().len(), 1);
        assert_eq!(rt.items()[0].todo_id, "second");
    }
    #[test]
    fn shown_policy_keeps_existing_open_items_when_later_reminder_arrives() {
        let (d, cfg, now) = timed_data();
        let mut rt = Runtime::default(); let mut l = Ledger::default();
        let first = rt.reconcile(candidates(&d, &cfg), &l, "shown", now);
        delivered(&mut rt, &mut l, &first);
        let second = rt.reconcile(candidates(&d, &cfg), &l, "shown", now + 60);
        assert_eq!((second.len(), rt.items().len()), (1, 2));
        let mut restarted = Runtime::default();
        assert_eq!(restarted.reconcile(candidates(&d, &cfg), &l, "shown", now + 60).len(), 1);
        assert_eq!(restarted.items()[0].todo_id, "second");
    }

    #[test]
    fn adaptive_window_position_stays_in_work_area() {
        assert_eq!(clamp_window_axis(1700, 0, 1920, 416, 8), 1496);
        assert_eq!(clamp_window_axis(900, 0, 1040, 550, 8), 482);
        assert_eq!(clamp_window_axis(-1900, -1920, 1920, 416, 8), -1900);
        assert_eq!(clamp_window_axis(-50, -1920, 1920, 416, 8), -424);
        assert_eq!(clamp_window_axis(0, 0, 100, 416, 8), 8);
    }

    #[test]
    fn defaults_match_approved_reminder_preferences() {
        let c = Config::default();
        assert!(c.enabled);
        assert_eq!(c.sound, "knock");
        assert_eq!(c.volume, 50);
        assert_eq!(c.scope, "both");
        assert!(c.popup && c.system && c.topmost);
        assert_eq!(c.policy, "ack");
        assert_eq!(c.start_minutes, 10);
        assert_eq!(c.end_minutes, 30);
        assert_eq!(c.snooze_minutes, 10);
        assert_eq!(c.interval_minutes, 180);
        assert_eq!(c.date_start, "09:30");
        assert_eq!(c.date_end, "09:30");
        assert_eq!(c.count, 1);
        c.validate().unwrap();
    }
    #[test]
    fn legacy_config_keeps_all_groups_and_future_default_does_not_toggle_existing_groups() {
        let mut c: Config = serde_json::from_str(r#"{"enabled":true}"#).unwrap();
        let mut d = data();
        d.groups = vec![super::super::Group { id:"work".into(), name:"Work".into(), order:0, color:None }];
        assert!(c.group_is_enabled(None));
        assert!(c.group_is_enabled(Some("work")));
        c.preserve_existing_groups(&d);
        c.new_group_enabled = false;
        assert!(c.group_is_enabled(Some("work")));
        assert!(!c.group_is_enabled(Some("new")));
        d.groups.push(super::super::Group { id:"new".into(), name:"New".into(), order:1, color:None });
        c.preserve_existing_groups(&d);
        c.new_group_enabled = true;
        assert!(!c.group_is_enabled(Some("new")));
        assert!(c.group_is_enabled(Some("later")));
        let restored: Config = serde_json::from_value(serde_json::to_value(c).unwrap()).unwrap();
        assert!(!restored.group_is_enabled(Some("new")));
        assert!(restored.group_is_enabled(Some("work")));
    }

    #[test]
    fn group_filter_covers_both_times_moving_and_default_group() {
        let mut d = data();
        let mut c = Config::default();
        c.group_enabled.insert("muted".into(), false);
        assert_eq!(candidates(&d, &c).len(), 2);
        d.todos[0].group_id = Some("muted".into());
        assert!(candidates(&d, &c).is_empty());
        d.todos[0].group_id = Some("active".into());
        assert_eq!(candidates(&d, &c).len(), 2);
        c.default_group_enabled = false;
        d.todos[0].group_id = None;
        assert!(candidates(&d, &c).is_empty());
        c.default_group_enabled = true;
        assert_eq!(candidates(&d, &c).len(), 2);
    }

    #[test]
    fn disabling_and_reenabling_preserves_ack_snooze_and_displayed_policy() {
        let d = data();
        let mut c = Config::default();
        let before = candidates(&d, &c).remove(0);
        let now = before.due[0] + 100;
        let ack = Record { acknowledged:true, ..Default::default() };
        let snooze = Record { snooze:Some(now + 600), ..Default::default() };
        let displayed = Record { delivered:1, ..Default::default() };
        c.default_group_enabled = false;
        assert!(candidates(&d, &c).is_empty());
        c.default_group_enabled = true;
        let after = candidates(&d, &c).remove(0);
        assert_eq!(before.item.key, after.item.key);
        assert!(pending(&after, &ack, now, "ack").is_none());
        assert!(pending(&after, &snooze, now, "ack").is_none());
        assert!(pending(&after, &displayed, now, "shown").is_none());
        assert!(pending(&after, &Record::default(), now, "ack").is_some());
    }

    #[test]
    fn invalid_configs_reject_cross_midnight_and_no_channel() {
        let mut c = Config::default();
        c.count = 12;
        assert!(c.validate().is_err());
        c.count = 1;
        c.date_end = "25:00".into();
        assert!(c.validate().is_err());
        c.date_end = "09:30".into();
        c.enabled = true;
        c.popup = false;
        c.system = false;
        assert!(c.validate().is_err());
    }
    #[test]
    fn explicit_midnight_precision_is_not_lost() {
        let midnight = Local
            .with_ymd_and_hms(2026, 11, 9, 0, 0, 0)
            .earliest()
            .unwrap()
            .to_rfc3339();
        assert!(!time(&midnight, Some(true)).unwrap().1);
        assert!(time(&midnight, None).unwrap().1);
        assert!(time(&midnight, Some(false)).unwrap().1);
    }
    #[test]
    fn date_schedule_is_local_and_count_includes_first() {
        let mut c = Config::default();
        c.count = 3;
        c.scope = "start".into();
        let cs = candidates(&data(), &c);
        let s = &cs[0];
        assert!(s.item.date_only);
        assert_eq!(s.due.len(), 3);
        let dt = Local.timestamp_opt(s.due[0], 0).unwrap();
        assert_eq!((dt.hour(), dt.minute()), (9, 30));
        assert_eq!(s.due[1] - s.due[0], 180 * 60);
        let item = pending(s, &Record::default(), s.due[2] + 1, "ack").unwrap();
        assert_eq!(item.batch, 3);
    }
    #[test]
    fn acknowledged_stops_all_batches_but_displayed_only_current() {
        let mut c = Config::default();
        c.count = 3;
        c.scope = "start".into();
        let cs = candidates(&data(), &c);
        let s = &cs[0];
        let ack = Record {
            acknowledged: true,
            ..Default::default()
        };
        assert!(pending(s, &ack, s.due[2] + 1, "ack").is_none());
        let shown = Record {
            delivered: 1,
            ..Default::default()
        };
        assert!(pending(s, &shown, s.due[0], "shown").is_none());
        assert_eq!(pending(s, &shown, s.due[1], "shown").unwrap().batch, 2);
        assert!(pending(s, &shown, s.due[0], "ack").is_some());
    }
    #[test]
    fn snooze_defers_and_coalesces_overlapping_batches() {
        let mut c = Config::default();
        c.count = 3;
        let cs = candidates(&data(), &c);
        let s = &cs[0];
        let r = Record {
            delivered: 1,
            snooze: Some(s.due[1] + 60),
            ..Default::default()
        };
        assert!(pending(s, &r, s.due[1], "shown").is_none());
        assert_eq!(pending(s, &r, s.due[1] + 60, "shown").unwrap().batch, 2);
    }
    #[test]
    fn complete_archive_suspend_remove_candidates() {
        for field in ["done", "archivedAt", "suspendedAt"] {
            let mut value = serde_json::to_value(data()).unwrap();
            value["todos"][0][field] = if field == "done" {
                true.into()
            } else {
                "now".into()
            };
            let d: Data = serde_json::from_value(value).unwrap();
            assert!(candidates(&d, &Config::default()).is_empty());
        }
    }
    #[test]
    fn identity_changes_only_for_schedule_not_titles_or_lead_times() {
        let mut d = data();
        let mut c = Config::default();
        let old = candidates(&d, &c);
        d.todos[0].title = "renamed".into();
        c.start_minutes = 100;
        c.date_start = "10:00".into();
        assert_eq!(old[0].item.key, candidates(&d, &c)[0].item.key);
        d.todos[0].end_time = Some("2026-11-11T15:00:00+08:00".into());
        let new = candidates(&d, &c);
        assert_eq!(old[0].item.key, new[0].item.key);
        assert_ne!(old[1].item.key, new[1].item.key);
    }
    #[test]
    fn ledger_roundtrip_keeps_ack_and_snooze_and_rejects_unknown_version() {
        let dir = std::env::temp_dir().join(format!("reminder-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let mut l = Ledger::default();
        l.records.insert(
            "t".into(),
            Record {
                acknowledged: false,
                delivered: 2,
                snooze: Some(123),
            },
        );
        storage::write_json(&dir.join("reminder-state.json"), &l).unwrap();
        let restored = ledger(&dir).unwrap();
        assert_eq!(restored.records["t"].snooze, Some(123));
        l.version = 99;
        storage::write_json(&dir.join("reminder-state.json"), &l).unwrap();
        assert!(ledger(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
