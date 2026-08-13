use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager};
use uuid::Uuid;

static HOLIDAY_UPDATE_LOCK: Mutex<bool> = Mutex::new(false);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub start_time: Option<String>,
    #[serde(default)]
    pub end_time: Option<String>,
    #[serde(default)]
    pub order: i64,
    #[serde(default = "default_true")]
    pub expanded: bool,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub group_id: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub suspended_at: Option<String>,
    #[serde(default)]
    pub is_priority: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
    pub order: i64,
}

fn default_true() -> bool {
    true
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub version: String,
    pub updated_at: String,
    pub todos: Vec<Todo>,
    #[serde(default)]
    pub groups: Vec<Group>,
}

/// 用户设置。新增字段直接加,旧 settings.json 缺字段时用 Default 补。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub theme: String,     // light | dark | system
    pub font_size: String, // small | medium | large
    pub compact: bool,
    pub show_icons: bool,
    pub week_start: String, // monday | sunday
    pub show_week_number: bool,
    pub show_ongoing_in_calendar: bool,
    pub show_end_in_calendar: bool,
    pub show_start_in_calendar: bool,
    pub show_calendar_done: bool,
    pub show_lunar: bool,
    pub default_start_time: String, // none | 09:00 | ...
    pub sort_mode: String,          // auto | manual
    pub drag_mode: String,          // sibling | tree
    pub auto_collapse_done: bool,
    pub delete_confirm: bool,
    pub auto_backup: bool,
    pub backup_keep: i64,
    pub auto_archive: bool,
    pub archive_after_days: i64,
    pub show_bulk_add: bool,
    pub show_single_add: bool,
    pub show_numbering: bool,
    pub numbering_style: String,   // wbs | simple
    pub numbering_palette: String, // classic | morandi | ocean
    pub click_action: String,      // edit | expand
    pub notes_display: String,     // none | hover | inline
    pub theme_color: String,       // clay | blue | cyan | red | ink | sunset | deep | aurora | flame
    pub show_time_precision: bool,
    pub app_icon: String,          // b | bf
    pub enable_groups: bool,
    pub font_color: String,        // default | warm1 | warm2 | warm3
    pub day_item_color_mode: String,        // theme | none | custom
    pub day_item_custom_color: String,      // clay | blue | ... (when mode=custom)
    pub todo_item_color_mode: String,       // theme | none | custom
    pub todo_item_custom_color: String,     // clay | blue | ... (when mode=custom)
    pub start_event_color_mode: String,     // theme | custom
    pub start_event_custom_color: String,   // amber | blue | ... (when mode=custom)
    pub auto_sync_start: bool,
    pub auto_sync_end: bool,
    pub calendar_child_display: String, // current | main-only | main-child | child-main
    pub close_on_outside_click: bool,
    pub weekend_color: String, // none | yellow | pink | blue | green | beige | peach | dawn | aurora
    pub stats_style: String, // text | chip | bar
    pub clock_show_seconds: bool, // 顶部时钟显示秒数(隐藏日期,显示进度条)
    pub holiday_color: String, // none | yellow | pink | blue | green | beige | peach | dawn | aurora
    pub holiday_auto_update: bool,
    pub holiday_last_update: Option<String>,
    pub priority_highlight: String, // none | icon | bar | bg | full
    pub priority_auto_top: bool,    // 自动排序模式下优先待办置顶
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            font_size: "medium".into(),
            compact: false,
            show_icons: true,
            week_start: "monday".into(),
            show_week_number: false,
            show_ongoing_in_calendar: false,
            show_end_in_calendar: true,
            show_start_in_calendar: true,
            show_calendar_done: false,
            show_lunar: true,
            default_start_time: "now".into(),
            sort_mode: "auto".into(),
            drag_mode: "sibling".into(),
            auto_collapse_done: true,
            delete_confirm: true,
            auto_backup: false,
            backup_keep: 5,
            auto_archive: true,
            archive_after_days: 7,
            show_bulk_add: true,
            show_single_add: false,
            show_numbering: true,
            numbering_style: "simple".into(),
            numbering_palette: "classic".into(),
            click_action: "expand".into(),
            notes_display: "hover".into(),
            theme_color: "sunset".into(),
            show_time_precision: false,
            app_icon: "b".into(),
            enable_groups: false,
            font_color: "warm1".into(),
            day_item_color_mode: "theme".into(),
            day_item_custom_color: "deep".into(),
            todo_item_color_mode: "none".into(),
            todo_item_custom_color: "aurora".into(),
            start_event_color_mode: "theme".into(),
            start_event_custom_color: "slate".into(),
            auto_sync_start: false,
            auto_sync_end: false,
            calendar_child_display: "main-only".into(),
            close_on_outside_click: true,
            weekend_color: "beige".into(),
            stats_style: "text".into(),
            clock_show_seconds: false,
            holiday_color: "none".into(),
            holiday_auto_update: true,
            holiday_last_update: None,
            priority_highlight: "tag".into(),
            priority_auto_top: true,
        }
    }
}

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn app_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app_data_dir");
    fs::create_dir_all(&dir).ok();
    dir
}

fn data_file(app: &tauri::AppHandle) -> PathBuf {
    let dir = app_dir(app);
    let f = dir.join("todos.json");
    if !f.exists() {
        // 迁移老数据
        const OLD: &str = "F:\\CodePilot\\TodoCalendar\\data\\todos.json";
        if PathBuf::from(OLD).exists() {
            fs::copy(OLD, &f).ok();
        } else {
            let empty = Data {
                version: "2".into(),
                updated_at: now_iso(),
                todos: vec![],
                groups: vec![],
            };
            save_data(&f, &empty);
        }
    }
    f
}

fn settings_file(app: &tauri::AppHandle) -> PathBuf {
    app_dir(app).join("settings.json")
}

// ===== 法定节假日数据 =====

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HolidayDay {
    name: String,
    date: String, // YYYY-MM-DD
    #[serde(rename = "isOffDay")]
    is_off_day: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct HolidaysData {
    #[serde(default)]
    days: Vec<HolidayDay>,
}

static HOLIDAYS: Mutex<Option<HolidaysData>> = Mutex::new(None);

fn holidays_cache_file(app: &tauri::AppHandle) -> PathBuf {
    app_dir(app).join("holidays_cache.json")
}

fn parse_holidays(s: &str) -> Option<HolidaysData> {
    serde_json::from_str::<HolidaysData>(s).ok()
}

fn load_builtin_holidays(app: &tauri::AppHandle) -> HolidaysData {
    let resource = app
        .path()
        .resolve("resources/holidays.json", tauri::path::BaseDirectory::Resource)
        .ok();
    if let Some(p) = resource {
        if let Ok(s) = fs::read_to_string(&p) {
            if let Some(d) = parse_holidays(&s) {
                return d;
            }
        }
    }
    HolidaysData::default()
}

fn load_holidays(app: &tauri::AppHandle) -> HolidaysData {
    if let Ok(guard) = HOLIDAYS.lock() {
        if let Some(data) = guard.as_ref() {
            return data.clone();
        }
    }
    let cache = holidays_cache_file(app);
    let data = if cache.exists() {
        fs::read_to_string(&cache)
            .ok()
            .and_then(|s| parse_holidays(&s))
            .unwrap_or_else(|| load_builtin_holidays(app))
    } else {
        load_builtin_holidays(app)
    };
    if let Ok(mut guard) = HOLIDAYS.lock() {
        *guard = Some(data.clone());
    }
    data
}

async fn fetch_year_holidays(
    app: &tauri::AppHandle,
    year: i32,
    step_idx: usize,
    total_steps: usize,
) -> Result<HolidaysData, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let urls = [
        ("GitHub raw", format!("https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{}.json", year)),
        ("jsDelivr CDN", format!("https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{}.json", year)),
    ];

    let emit_progress = |source_idx: usize, source_name: &str, url: &str, status: &str, elapsed: u128, payload_extra: Value| {
        let mut map = serde_json::Map::new();
        map.insert("step".into(), json!(step_idx));
        map.insert("totalSteps".into(), json!(total_steps));
        map.insert("sourceIdx".into(), json!(source_idx));
        map.insert("sourceName".into(), json!(source_name));
        map.insert("url".into(), json!(url));
        map.insert("year".into(), json!(year));
        map.insert("status".into(), json!(status));
        map.insert("elapsedMs".into(), json!(elapsed));
        if let Value::Object(obj) = payload_extra {
            for (k, v) in obj {
                map.insert(k, v);
            }
        }
        let _ = app.emit("holiday-progress", Value::Object(map));
    };

    let mut last_err = String::new();
    let mut last_was_network_err = false;
    for (source_idx, (source_name, url)) in urls.iter().enumerate() {
        emit_progress(source_idx, source_name, url, "connecting", 0, json!({}));
        let t0 = Instant::now();
        match client.get(url.as_str()).send().await {
            Ok(resp) => {
                let status_code = resp.status();
                let elapsed = t0.elapsed().as_millis();
                if status_code.as_u16() == 404 {
                    last_err = format!("{} 年数据尚未发布", year);
                    last_was_network_err = false;
                    emit_progress(source_idx, source_name, url, "warning", elapsed, json!({ "warning": last_err.clone() }));
                    continue;
                }
                if !status_code.is_success() {
                    last_err = format!("HTTP {}", status_code.as_u16());
                    last_was_network_err = true;
                    emit_progress(source_idx, source_name, url, "failed", elapsed, json!({ "error": last_err.clone() }));
                    continue;
                }
                let text = match resp.text().await {
                    Ok(t) => t,
                    Err(e) => {
                        let elapsed = t0.elapsed().as_millis();
                        last_err = e.to_string();
                        last_was_network_err = true;
                        emit_progress(source_idx, source_name, url, "failed", elapsed, json!({ "error": last_err.clone() }));
                        continue;
                    }
                };
                let elapsed = t0.elapsed().as_millis();
                let bytes = text.len();
                let Ok(v) = serde_json::from_str::<Value>(&text) else {
                    last_err = "JSON 解析失败".into();
                    last_was_network_err = true;
                    emit_progress(source_idx, source_name, url, "failed", elapsed, json!({ "error": last_err.clone() }));
                    continue;
                };
                let Some(days_arr) = v.get("days").and_then(|d| d.as_array()) else {
                    last_err = format!("{} 年数据为空", year);
                    last_was_network_err = false;
                    emit_progress(source_idx, source_name, url, "warning", elapsed, json!({ "warning": last_err.clone() }));
                    continue;
                };
                let mut days = Vec::new();
                for d in days_arr {
                    let name = d.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    let date = d.get("date").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    let is_off = d.get("isOffDay").and_then(|n| n.as_bool()).unwrap_or(false);
                    if !date.is_empty() {
                        days.push(HolidayDay { name, date, is_off_day: is_off });
                    }
                }
                if days.is_empty() {
                    last_err = format!("{} 年数据为空", year);
                    last_was_network_err = false;
                    emit_progress(source_idx, source_name, url, "warning", elapsed, json!({ "warning": last_err.clone() }));
                    continue;
                }
                emit_progress(source_idx, source_name, url, "ok", elapsed, json!({ "bytes": bytes, "count": days.len() }));
                return Ok(HolidaysData { days });
            }
            Err(e) => {
                let elapsed = t0.elapsed().as_millis();
                let is_timeout = e.is_timeout();
                last_err = if is_timeout {
                    "连接超时(10s)".to_string()
                } else {
                    let msg = e.to_string();
                    if msg.contains("dns") || msg.contains("resolve") {
                        "DNS 解析失败".to_string()
                    } else if msg.contains("connect") {
                        "连接被拒绝".to_string()
                    } else {
                        msg
                    }
                };
                last_was_network_err = true;
                emit_progress(source_idx, source_name, url, "failed", elapsed, json!({ "error": last_err.clone() }));
                continue;
            }
        }
    }
    if last_err.is_empty() {
        last_err = "所有源都失败".into();
    }
    let _ = last_was_network_err;
    Err(last_err)
}

#[tauri::command]
fn list_holidays(app: tauri::AppHandle) -> Value {
    let data = load_holidays(&app);
    let mut map: serde_json::Map<String, Value> = serde_json::Map::new();
    for d in &data.days {
        map.insert(
            d.date.clone(),
            json!({ "name": d.name, "isOffDay": d.is_off_day }),
        );
    }
    Value::Object(map)
}

#[tauri::command]
async fn check_holiday_updates(app: tauri::AppHandle) -> Result<String, String> {
    {
        let mut guard = HOLIDAY_UPDATE_LOCK.lock().unwrap();
        if *guard {
            return Err("更新进行中,请稍后".into());
        }
        *guard = true;
    }
    let result = check_holiday_updates_inner(&app).await;
    {
        let mut guard = HOLIDAY_UPDATE_LOCK.lock().unwrap();
        *guard = false;
    }
    result
}

async fn check_holiday_updates_inner(app: &tauri::AppHandle) -> Result<String, String> {
    let year = Utc::now().format("%Y").to_string().parse::<i32>().unwrap_or(2025);
    let years = vec![year, year + 1];
    let total_steps = years.len();
    let mut fetched: Vec<HolidayDay> = Vec::new();
    let mut fetched_years: std::collections::HashSet<String> = std::collections::HashSet::new();
    // (year, status: "ok"|"warning"|"failed", detail)
    let mut year_results: Vec<(i32, &'static str, String)> = Vec::new();
    for (idx, y) in years.iter().enumerate() {
        match fetch_year_holidays(app, *y, idx, total_steps).await {
            Ok(data) => {
                fetched_years.insert(y.to_string());
                let count = data.days.len();
                fetched.extend(data.days);
                year_results.push((*y, "ok", format!("{} 条", count)));
            }
            Err(e) => {
                let trimmed = e.trim();
                let status = if trimmed.ends_with("尚未发布") || trimmed.ends_with("数据为空") {
                    "warning"
                } else {
                    "failed"
                };
                year_results.push((*y, status, e));
            }
        }
    }
    let _ = app.emit(
        "holiday-progress",
        json!({
            "step": total_steps,
            "totalSteps": total_steps,
            "status": "saving",
            "yearResults": year_results.iter().map(|(y, s, msg)| json!({ "year": y, "status": s, "msg": msg })).collect::<Vec<_>>(),
        }),
    );
    if fetched.is_empty() {
        let detail = year_results
            .iter()
            .map(|(y, s, msg)| format!("{}年: {}", y, match *s { "ok" => format!("成功({})", msg), "warning" => format!("警告({})", msg), _ => format!("失败({})", msg) }))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(format!("未能获取任何节假日数据。{}", detail));
    }
    let existing = load_holidays(app);
    let mut merged: Vec<HolidayDay> = existing
        .days
        .into_iter()
        .filter(|d| !fetched_years.contains(&d.date[..4]))
        .collect();
    merged.extend(fetched);
    let new_data = HolidaysData { days: merged };
    let cache = holidays_cache_file(app);
    let json_text = serde_json::to_string_pretty(&new_data).map_err(|e| e.to_string())?;
    fs::write(&cache, json_text).map_err(|e| e.to_string())?;
    if let Ok(mut guard) = HOLIDAYS.lock() {
        *guard = Some(new_data.clone());
    }
    let year_summary = year_results
        .iter()
        .map(|(y, s, msg)| format!("{}年: {}", y, match *s { "ok" => format!("✓ {}", msg), "warning" => format!("⚠ {}", msg), _ => format!("✗ {}", msg) }))
        .collect::<Vec<_>>()
        .join(" / ");
    Ok(format!("已更新 [{}],总计 {} 条记录", year_summary, new_data.days.len()))
}

fn maybe_auto_update_holidays(app: &tauri::AppHandle) {
    let settings_text = match fs::read_to_string(settings_file(app)) {
        Ok(s) => s,
        Err(_) => return,
    };
    let s: Value = match serde_json::from_str(&settings_text) {
        Ok(v) => v,
        Err(_) => return,
    };
    let auto = s.get("holidayAutoUpdate").and_then(|v| v.as_bool()).unwrap_or(true);
    if !auto {
        return;
    }
    let last = s.get("holidayLastUpdate").and_then(|v| v.as_str());
    if let Some(last) = last {
        if let Ok(last_dt) = DateTime::parse_from_rfc3339(last) {
            let elapsed = Utc::now().signed_duration_since(last_dt.with_timezone(&Utc));
            if elapsed < Duration::days(30) {
                return;
            }
        }
    }
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match check_holiday_updates(app_handle.clone()).await {
            Ok(_) => {
                if let Ok(mut s_text) = fs::read_to_string(settings_file(&app_handle)) {
                    if let Ok(mut v) = serde_json::from_str::<Value>(&s_text) {
                        if let Some(obj) = v.as_object_mut() {
                            obj.insert("holidayLastUpdate".into(), json!(now_iso()));
                            s_text = serde_json::to_string(&v).unwrap_or(s_text);
                            let _ = fs::write(settings_file(&app_handle), s_text);
                        }
                    }
                }
            }
            Err(_) => {}
        }
    });
}

const DATA_VERSION: &str = "2";

fn migrate_data(data: &mut Data, migrated_at: &str) -> bool {
    if data.version == DATA_VERSION {
        return false;
    }

    for todo in &mut data.todos {
        if todo.done && todo.completed_at.is_none() {
            todo.completed_at = Some(migrated_at.to_string());
        }
    }
    data.version = DATA_VERSION.into();
    true
}

fn load_data(file: &PathBuf) -> Data {
    let mut data = match fs::read_to_string(file) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_else(|_| Data {
            version: DATA_VERSION.into(),
            updated_at: now_iso(),
            todos: vec![],
            groups: vec![],
        }),
        Err(_) => Data {
            version: DATA_VERSION.into(),
            updated_at: now_iso(),
            todos: vec![],
            groups: vec![],
        },
    };

    if migrate_data(&mut data, &now_iso()) {
        save_data(file, &data);
    }

    data
}

fn save_data_checked(file: &PathBuf, data: &Data) -> Result<(), String> {
    let mut d = data.clone();
    d.updated_at = now_iso();
    let json = serde_json::to_string_pretty(&d).map_err(|e| format!("序列化失败: {}", e))?;
    let tmp = file.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("写入临时文件失败: {}", e))?;
    fs::copy(&tmp, file).map_err(|e| format!("替换数据文件失败: {}", e))?;
    let _ = fs::remove_file(&tmp);
    Ok(())
}

fn save_data(file: &PathBuf, data: &Data) {
    let _ = save_data_checked(file, data);
}

fn load_settings(file: &PathBuf) -> Settings {
    match fs::read_to_string(file) {
        Ok(s) => {
            // 用 Value 接,再 merge 到 Default,缺字段自动补
            let mut def: Value = serde_json::to_value(Settings::default()).unwrap();
            if let Ok(read) = serde_json::from_str::<Value>(&s) {
                if let (Some(def_map), Some(read_map)) = (def.as_object_mut(), read.as_object()) {
                    for (k, v) in read_map {
                        def_map.insert(k.clone(), v.clone());
                    }
                }
            }
            serde_json::from_value(def).unwrap_or_default()
        }
        Err(_) => Settings::default(),
    }
}

fn save_settings(file: &PathBuf, s: &Settings) {
    let json = serde_json::to_string_pretty(s).unwrap_or_else(|_| "{}".into());
    let tmp = file.with_extension("json.tmp");
    if fs::write(&tmp, json).is_ok() && fs::copy(&tmp, file).is_ok() {
        let _ = fs::remove_file(&tmp);
    }
}

fn collect_descendants(todos: &[Todo], root: &str) -> Vec<String> {
    let mut result = vec![root.to_string()];
    let mut pending = vec![root.to_string()];
    while let Some(cur) = pending.pop() {
        for t in todos {
            if t.parent_id.as_deref() == Some(cur.as_str()) && !result.contains(&t.id) {
                result.push(t.id.clone());
                pending.push(t.id.clone());
            }
        }
    }
    result
}

fn find_root_id(todos: &[Todo], id: &str) -> String {
    let mut cur_id = id.to_string();
    let mut seen = std::collections::HashSet::new();
    seen.insert(cur_id.clone());
    loop {
        let cur = todos.iter().find(|t| t.id == cur_id);
        match cur.and_then(|t| t.parent_id.as_ref()) {
            Some(pid) if !seen.contains(pid) && todos.iter().any(|t| t.id == *pid) => {
                seen.insert(pid.clone());
                cur_id = pid.clone();
            }
            _ => break,
        }
    }
    cur_id
}

fn collect_tree_ids(todos: &[Todo], id: &str) -> Vec<String> {
    let root = find_root_id(todos, id);
    collect_descendants(todos, &root)
}

fn filtered_data(data: &Data, archived: bool) -> Data {
    let mut filtered = data.clone();
    filtered
        .todos
        .retain(|todo| todo.archived_at.is_some() == archived);
    filtered
}

fn archive_due_at(data: &mut Data, days: i64, now: DateTime<Utc>) -> Vec<String> {
    let cutoff = now - Duration::days(days.max(1));
    let is_due = |todo: &Todo| {
        todo.done
            && todo.archived_at.is_none()
            && todo
                .completed_at
                .as_deref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .is_some_and(|completed| completed.with_timezone(&Utc) <= cutoff)
    };
    let candidates: Vec<String> = data
        .todos
        .iter()
        .filter(|todo| is_due(todo))
        .map(|todo| todo.id.clone())
        .collect();
    let archived_at = now.format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let mut archived_ids = Vec::new();

    for candidate in candidates {
        let Some(root) = data.todos.iter().find(|todo| todo.id == candidate) else {
            continue;
        };
        if root.archived_at.is_some() {
            continue;
        }
        let subtree = collect_descendants(&data.todos, &candidate);
        let can_archive = data
            .todos
            .iter()
            .filter(|todo| subtree.contains(&todo.id) && todo.archived_at.is_none())
            .all(&is_due);
        if !can_archive {
            continue;
        }
        for todo in &mut data.todos {
            if subtree.contains(&todo.id) && todo.archived_at.is_none() {
                todo.archived_at = Some(archived_at.clone());
                archived_ids.push(todo.id.clone());
            }
        }
    }

    archived_ids
}

fn archive_due_for_settings_at(
    data: &mut Data,
    settings: &Settings,
    now: DateTime<Utc>,
) -> Vec<String> {
    if !settings.auto_archive {
        return Vec::new();
    }
    archive_due_at(data, settings.archive_after_days, now)
}

fn restore_archived_branch(data: &mut Data, id: &str) -> Result<Vec<String>, String> {
    let selected = data
        .todos
        .iter()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "归档待办不存在".to_string())?;
    if selected.archived_at.is_none() {
        return Ok(Vec::new());
    }

    let mut restore_ids = collect_descendants(&data.todos, id);
    let mut parent_id = selected.parent_id.clone();
    while let Some(current_id) = parent_id {
        let Some(parent) = data.todos.iter().find(|todo| todo.id == current_id) else {
            break;
        };
        if parent.archived_at.is_some() && !restore_ids.contains(&parent.id) {
            restore_ids.push(parent.id.clone());
        }
        parent_id = parent.parent_id.clone();
    }

    restore_ids.retain(|restore_id| {
        data.todos
            .iter()
            .any(|todo| todo.id == *restore_id && todo.archived_at.is_some())
    });
    for todo in &mut data.todos {
        if restore_ids.contains(&todo.id) {
            todo.done = false;
            todo.completed_at = None;
            todo.archived_at = None;
            todo.expanded = true;
        }
    }
    Ok(restore_ids)
}

fn archive_branch_at(data: &mut Data, id: &str, archived_at: &str) -> Result<Vec<String>, String> {
    let root = data
        .todos
        .iter()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "待办不存在".to_string())?;
    if root.archived_at.is_some() {
        return Err("该待办已经归档".into());
    }
    if !root.done {
        return Err("只能归档已完成的待办".into());
    }

    let subtree = collect_descendants(&data.todos, id);
    let has_unfinished = data
        .todos
        .iter()
        .any(|todo| subtree.contains(&todo.id) && todo.archived_at.is_none() && !todo.done);
    if has_unfinished {
        return Err("该待办仍有未完成的子待办".into());
    }

    let mut archived_ids = Vec::new();
    for todo in &mut data.todos {
        if subtree.contains(&todo.id) && todo.archived_at.is_none() {
            todo.archived_at = Some(archived_at.to_string());
            archived_ids.push(todo.id.clone());
        }
    }
    Ok(archived_ids)
}

fn delete_archived_branch(data: &mut Data, id: &str) -> Result<Vec<String>, String> {
    let selected = data
        .todos
        .iter()
        .find(|todo| todo.id == id)
        .ok_or_else(|| "归档待办不存在".to_string())?;
    if selected.archived_at.is_none() {
        return Err("只能永久删除历史记录中的待办".into());
    }

    let ids = collect_descendants(&data.todos, id);
    if data
        .todos
        .iter()
        .any(|todo| ids.contains(&todo.id) && todo.archived_at.is_none())
    {
        return Err("归档分支中包含活动待办，无法永久删除".into());
    }
    let ids_set: std::collections::HashSet<&String> = ids.iter().collect();
    data.todos.retain(|todo| !ids_set.contains(&todo.id));
    Ok(ids)
}

#[tauri::command]
fn list_todos(app: tauri::AppHandle) -> Data {
    let file = data_file(&app);
    filtered_data(&load_data(&file), false)
}

#[tauri::command]
fn list_archived_todos(app: tauri::AppHandle) -> Data {
    let file = data_file(&app);
    filtered_data(&load_data(&file), true)
}

#[tauri::command]
fn export_all_data(app: tauri::AppHandle) -> Data {
    let file = data_file(&app);
    load_data(&file)
}

/// 从 child_id 出发,递归向上重算父代办的 start/end(只在 auto=true 时)
/// 任意一层没变化就停止向上
fn sync_parent_time(data: &mut Data, settings: &Settings, mut child_id: String) {
    if !settings.auto_sync_start && !settings.auto_sync_end {
        return;
    }
    loop {
        let parent_id = match data.todos.iter().find(|t| t.id == child_id) {
            Some(t) => t.parent_id.clone(),
            None => return,
        };
        let parent_id = match parent_id {
            Some(p) => p,
            None => return,
        };
        let parent_idx = match data.todos.iter().position(|t| t.id == parent_id) {
            Some(i) => i,
            None => return,
        };

        let children_info: Vec<(Option<String>, Option<String>)> = data
            .todos
            .iter()
            .filter(|t| t.parent_id == Some(parent_id.clone()))
            .map(|t| (t.start_time.clone(), t.end_time.clone()))
            .collect();

        let mut changed = false;
        let parent = &mut data.todos[parent_idx];

        if settings.auto_sync_start {
            let new_start: Option<String> = children_info
                .iter()
                .filter_map(|(s, _)| s.clone())
                .min();
            if new_start.is_some() && parent.start_time != new_start {
                parent.start_time = new_start;
                changed = true;
            }
        }

        if settings.auto_sync_end {
            let new_end: Option<String> = children_info
                .iter()
                .filter_map(|(_, e)| e.clone())
                .max();
            if new_end.is_some() && parent.end_time != new_end {
                parent.end_time = new_end;
                changed = true;
            }
        }

        if !changed {
            break;
        }
        child_id = parent_id.clone();
    }
}

#[tauri::command]
fn create_todo(
    app: tauri::AppHandle,
    title: String,
    mut parent_id: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    notes: Option<String>,
) -> Todo {
    let file = data_file(&app);
    let mut data = load_data(&file);

    if let Some(ref pid) = parent_id {
        if let Some(parent) = data.todos.iter().find(|t| t.id == *pid) {
            if parent.archived_at.is_some() {
                parent_id = None;
            }
        }
    }

    let max_order = data
        .todos
        .iter()
        .filter(|t| t.parent_id == parent_id)
        .map(|t| t.order)
        .max()
        .unwrap_or(-1);

    let title = if title.trim().is_empty() {
        "新待办".to_string()
    } else {
        title
    };

    // 子代办继承父的 group_id
    let group_id = parent_id
        .as_ref()
        .and_then(|pid| data.todos.iter().find(|t| t.id == *pid).and_then(|p| p.group_id.clone()));

    let new = Todo {
        id: Uuid::new_v4().to_string()[..12].into(),
        title,
        done: false,
        parent_id: parent_id.clone(),
        start_time: start_time.clone(),
        end_time: end_time.clone(),
        order: max_order + 1,
        expanded: true,
        created_at: now_iso(),
        completed_at: None,
        archived_at: None,
        group_id,
        notes: notes.filter(|s| !s.trim().is_empty()),
        suspended_at: None,
        is_priority: None,
    };
    let new_id = new.id.clone();
    data.todos.push(new.clone());
    let settings = load_settings(&settings_file(&app));
    sync_parent_time(&mut data, &settings, new_id);
    save_data(&file, &data);
    new
}

#[tauri::command]
fn move_todo(
    app: tauri::AppHandle,
    id: String,
    parent_id: Option<String>,
    index: usize,
) -> Result<Data, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let moving = data
        .todos
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "待办不存在".to_string())?;
    let old_parent_id = moving.parent_id.clone();

    if let Some(ref new_parent_id) = parent_id {
        if !data.todos.iter().any(|t| &t.id == new_parent_id) {
            return Err("目标父待办不存在".into());
        }
        if let Some(target) = data.todos.iter().find(|t| &t.id == new_parent_id) {
            if target.archived_at.is_some() {
                return Err("目标父待办已归档,不能移到其下".into());
            }
        }
        let descendants = collect_descendants(&data.todos, &id);
        if descendants.contains(new_parent_id) {
            return Err("不能把待办移动到自身或自己的子级中".into());
        }
    }

    let sorted_siblings = |target_parent: &Option<String>| {
        let mut siblings: Vec<(i64, usize, String)> = data
            .todos
            .iter()
            .enumerate()
            .filter(|(_, t)| t.parent_id == *target_parent && t.id != id)
            .map(|(position, t)| (t.order, position, t.id.clone()))
            .collect();
        siblings.sort_by_key(|(order, position, _)| (*order, *position));
        siblings
            .into_iter()
            .map(|(_, _, sibling_id)| sibling_id)
            .collect::<Vec<_>>()
    };

    let mut target_ids = sorted_siblings(&parent_id);
    target_ids.insert(index.min(target_ids.len()), id.clone());
    let old_ids = if old_parent_id != parent_id {
        sorted_siblings(&old_parent_id)
    } else {
        Vec::new()
    };

    let moved = data
        .todos
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "待办不存在".to_string())?;
    moved.parent_id = parent_id.clone();
    if let Some(ref new_parent_id) = parent_id {
        if let Some(parent) = data.todos.iter_mut().find(|t| &t.id == new_parent_id) {
            parent.expanded = true;
        }
    }

    for (order, todo_id) in old_ids.iter().enumerate() {
        if let Some(todo) = data.todos.iter_mut().find(|t| &t.id == todo_id) {
            todo.order = order as i64;
        }
    }
    for (order, todo_id) in target_ids.iter().enumerate() {
        if let Some(todo) = data.todos.iter_mut().find(|t| &t.id == todo_id) {
            todo.order = order as i64;
        }
    }

    // move 跨父时,新旧父都要重算时间
    let settings = load_settings(&settings_file(&app));
    if old_parent_id != parent_id {
        if let Some(old_pid) = old_parent_id.clone() {
            sync_parent_time(&mut data, &settings, old_pid);
        }
        if let Some(new_pid) = parent_id.clone() {
            sync_parent_time(&mut data, &settings, new_pid);
        }
    }

    save_data_checked(&file, &data)?;
    let mut result = data.clone();
    result.todos.retain(|t| t.archived_at.is_none());
    Ok(result)
}

/// patch 是任意字段的 JSON 对象,只更新提供的字段(null 也算"提供",会清空)
#[tauri::command]
fn update_todo(app: tauri::AppHandle, id: String, patch: serde_json::Value) -> Option<Todo> {
    let file = data_file(&app);
    let mut data = load_data(&file);

    for t in data.todos.iter_mut() {
        if t.id == id {
            if let Some(obj) = patch.as_object() {
                let was_done = t.done;
                let mut current: serde_json::Value =
                    serde_json::to_value(&t).unwrap_or(serde_json::Value::Null);
                if let Some(map) = current.as_object_mut() {
                    for (k, v) in obj {
                        map.insert(k.clone(), v.clone());
                    }
                }
                if let Ok(mut updated) = serde_json::from_value::<Todo>(current) {
                    if updated.done {
                        if !was_done || updated.completed_at.is_none() {
                            updated.completed_at = Some(now_iso());
                        }
                        updated.suspended_at = None;
                    } else {
                        updated.completed_at = None;
                        updated.archived_at = None;
                    }
                    *t = updated;
                }
            }
            let result = t.clone();
            let child_id = t.id.clone();
            let settings = load_settings(&settings_file(&app));
            sync_parent_time(&mut data, &settings, child_id);
            save_data(&file, &data);
            return Some(result);
        }
    }
    None
}

#[tauri::command]
fn delete_todo(app: tauri::AppHandle, id: String) -> Vec<String> {
    let file = data_file(&app);
    let mut data = load_data(&file);

    // 找到被删除项的 parent_id,删除后用于触发父重算
    let parent_id = data
        .todos
        .iter()
        .find(|t| t.id == id)
        .and_then(|t| t.parent_id.clone());

    let ids = collect_descendants(&data.todos, &id);
    let ids_set: std::collections::HashSet<&String> = ids.iter().collect();
    data.todos.retain(|t| !ids_set.contains(&t.id));

    if let Some(pid) = parent_id {
        let settings = load_settings(&settings_file(&app));
        sync_parent_time(&mut data, &settings, pid);
    }

    save_data(&file, &data);
    ids
}

/// 递归把 rootId 及其所有后代代办 done 同步为参数值。用于"勾选父→子全选"
#[tauri::command]
fn set_todo_done_recursive(app: tauri::AppHandle, id: String, done: bool) -> Vec<String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let ids = collect_descendants(&data.todos, &id);
    let ids_set: std::collections::HashSet<&String> = ids.iter().collect();
    let completed_at = done.then(now_iso);
    for t in data.todos.iter_mut() {
        if ids_set.contains(&t.id) {
            if t.archived_at.is_some() {
                continue;
            }
            t.done = done;
            t.completed_at = completed_at.clone();
            if done {
                t.suspended_at = None;
            }
        }
    }
    save_data(&file, &data);
    ids
}

#[tauri::command]
fn archive_due_todos(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let settings = load_settings(&settings_file(&app));
    if !settings.auto_archive {
        return Ok(Vec::new());
    }

    let file = data_file(&app);
    let mut data = load_data(&file);
    let archived_ids = archive_due_for_settings_at(&mut data, &settings, Utc::now());
    if !archived_ids.is_empty() {
        save_data_checked(&file, &data)?;
    }
    Ok(archived_ids)
}

#[tauri::command]
fn archive_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let archived_ids = archive_branch_at(&mut data, &id, &now_iso())?;
    save_data_checked(&file, &data)?;
    Ok(archived_ids)
}

#[tauri::command]
fn restore_archived_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let restored_ids = restore_archived_branch(&mut data, &id)?;
    save_data_checked(&file, &data)?;
    Ok(restored_ids)
}

#[tauri::command]
fn set_suspended(app: tauri::AppHandle, id: String, suspended: bool) -> Result<Vec<String>, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let tree_ids = collect_tree_ids(&data.todos, &id);
    let ts = if suspended { Some(now_iso()) } else { None };
    let mut affected = Vec::new();
    for t in data.todos.iter_mut() {
        if tree_ids.contains(&t.id) {
            t.suspended_at = ts.clone();
            if suspended {
                t.is_priority = None;
            }
            affected.push(t.id.clone());
        }
    }
    save_data_checked(&file, &data)?;
    Ok(affected)
}

#[tauri::command]
fn set_priority(app: tauri::AppHandle, id: String, priority: bool) -> Result<Vec<String>, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let tree_ids = collect_tree_ids(&data.todos, &id);
    let p = if priority { Some(true) } else { None };
    let mut affected = Vec::new();
    for t in data.todos.iter_mut() {
        if tree_ids.contains(&t.id) {
            t.is_priority = p;
            if priority {
                t.suspended_at = None;
            }
            affected.push(t.id.clone());
        }
    }
    save_data_checked(&file, &data)?;
    Ok(affected)
}

#[tauri::command]
fn delete_archived_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let deleted_ids = delete_archived_branch(&mut data, &id)?;
    save_data_checked(&file, &data)?;
    Ok(deleted_ids)
}

#[tauri::command]
fn set_todos_expanded(app: tauri::AppHandle, expanded: bool) -> Result<Data, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let parent_ids: std::collections::HashSet<String> = data
        .todos
        .iter()
        .filter_map(|todo| todo.parent_id.clone())
        .collect();

    for todo in data.todos.iter_mut() {
        if parent_ids.contains(&todo.id) {
            todo.expanded = expanded;
        }
    }

    save_data_checked(&file, &data)?;
    let mut result = data.clone();
    result.todos.retain(|t| t.archived_at.is_none());
    Ok(result)
}

#[tauri::command]
fn list_settings(app: tauri::AppHandle) -> Settings {
    let file = settings_file(&app);
    load_settings(&file)
}

/// patch 形如 { "theme": "dark", "fontSize": "large" }
#[tauri::command]
fn update_settings(app: tauri::AppHandle, patch: serde_json::Value) -> Settings {
    let file = settings_file(&app);
    let mut s = load_settings(&file);

    if let Some(obj) = patch.as_object() {
        let mut cur = serde_json::to_value(&s).unwrap_or(Value::Null);
        if let Some(map) = cur.as_object_mut() {
            for (k, v) in obj {
                map.insert(k.clone(), v.clone());
            }
        }
        if let Ok(updated) = serde_json::from_value::<Settings>(cur) {
            s = updated;
        }
    }
    save_settings(&file, &s);
    s
}

/// 导出 todos.json 到用户选的路径。前端用 plugin-dialog 选路径,把路径传进来。
#[tauri::command]
fn export_data(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let src = data_file(&app);
    let data = load_data(&src);
    let json = serde_json::to_string_pretty(&data).map_err(|e| format!("序列化失败: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("写入失败: {}", e))
}

/// 从用户选的路径导入,覆盖当前数据。返回新的 Data。
#[tauri::command]
fn import_data(app: tauri::AppHandle, path: String) -> Result<Data, String> {
    let content = fs::read_to_string(&path).map_err(|e| format!("读取失败: {}", e))?;
    let parsed: Data = serde_json::from_str(&content).map_err(|e| format!("解析失败: {}", e))?;
    let dst = data_file(&app);
    save_data(&dst, &parsed);
    Ok(parsed)
}

/// 用系统命令打开数据目录(Windows: explorer)
#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_dir(&app);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&dir)
            .spawn()
            .map_err(|e| format!("打开失败: {}", e))?;
    }
    Ok(dir.to_string_lossy().into())
}

#[tauri::command]
fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 重置设置为默认值
#[tauri::command]
fn reset_settings(app: tauri::AppHandle) -> Settings {
    let s = Settings::default();
    save_settings(&settings_file(&app), &s);
    s
}

/// 用前端传进来的 Data 直接覆盖本地文件(导入用)
#[tauri::command]
fn replace_data(app: tauri::AppHandle, data: Data) -> Data {
    let dst = data_file(&app);
    save_data(&dst, &data);
    data
}

/// 返回数据目录路径(给 settings UI 显示用)
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> String {
    app_dir(&app).to_string_lossy().into()
}

/// 读取图标文件路径(打包资源 / dev fallback 到磁盘)
fn resolve_icon_path(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    let valid = matches!(name, "b" | "bf");
    if !valid {
        return None;
    }
    let filename = format!("icon_{}_256.png", name);
    // 打包模式:资源目录
    if let Some(resource) = app.path().resource_dir().ok() {
        let path = resource.join("icons").join(&filename);
        if path.exists() {
            return Some(path);
        }
    }
    // dev 模式:用编译期 manifest 目录定位 src-tauri/icons
    let dev_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("icons")
        .join(&filename);
    if dev_path.exists() {
        Some(dev_path)
    } else {
        None
    }
}

#[tauri::command]
fn set_app_icon(app: tauri::AppHandle, name: String) -> Result<(), String> {
    use tauri::Manager;
    let path = resolve_icon_path(&app, &name)
        .ok_or_else(|| format!("图标 {} 不存在", name))?;
    eprintln!("[icon] resolved path: {:?}", path);
    let img = tauri::image::Image::from_path(&path)
        .map_err(|e| format!("图标解析失败: {}", e))?;
    let Some(window) = app.get_webview_window("main") else {
        return Err("窗口 main 不存在".into());
    };
    window
        .set_icon(img)
        .map_err(|e| format!("设置窗口图标失败: {}", e))?;
    eprintln!("[icon] set_icon ok");
    Ok(())
}

fn apply_app_icon_on_startup(app: &tauri::AppHandle) {
    let settings = load_settings(&settings_file(app));
    let name = settings.app_icon;
    eprintln!("[icon] startup applying icon: {}", name);
    match set_app_icon(app.clone(), name) {
        Ok(_) => eprintln!("[icon] startup ok"),
        Err(e) => eprintln!("[icon] startup failed: {}", e),
    }
}

// 防止 unused warning(json 在 update_settings 早期被使用)
#[allow(dead_code)]
fn _unused() -> Value {
    json!({})
}

#[tauri::command]
fn list_groups(app: tauri::AppHandle) -> Vec<Group> {
    let file = data_file(&app);
    load_data(&file).groups
}

#[tauri::command]
fn create_group(app: tauri::AppHandle, name: String) -> Result<Group, String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("分组名不能为空".into());
    }
    let max_order = data.groups.iter().map(|g| g.order).max().unwrap_or(0);
    let group = Group {
        id: Uuid::new_v4().to_string()[..12].into(),
        name: trimmed.into(),
        order: max_order + 1,
    };
    data.groups.push(group.clone());
    save_data_checked(&file, &data)?;
    Ok(group)
}

#[tauri::command]
fn rename_group(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("分组名不能为空".into());
    }
    for g in data.groups.iter_mut() {
        if g.id == id {
            g.name = trimmed.into();
            save_data_checked(&file, &data)?;
            return Ok(());
        }
    }
    Err("分组不存在".into())
}

#[tauri::command]
fn delete_group(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    data.groups.retain(|g| g.id != id);
    // 该组的所有待办移到 Default(group_id = None)
    for t in data.todos.iter_mut() {
        if t.group_id.as_deref() == Some(id.as_str()) {
            t.group_id = None;
        }
    }
    save_data_checked(&file, &data)?;
    Ok(())
}

#[tauri::command]
fn reorder_groups(app: tauri::AppHandle, ids: Vec<String>) -> Result<(), String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    for (idx, id) in ids.iter().enumerate() {
        for g in data.groups.iter_mut() {
            if &g.id == id {
                g.order = (idx + 1) as i64;
                break;
            }
        }
    }
    data.groups.sort_by_key(|g| g.order);
    save_data_checked(&file, &data)?;
    Ok(())
}

#[tauri::command]
fn set_todo_group(app: tauri::AppHandle, id: String, group_id: Option<String>) -> Result<(), String> {
    let file = data_file(&app);
    let mut data = load_data(&file);
    let target = data.todos.iter().find(|t| t.id == id).cloned();
    let Some(root) = target else {
        return Err("待办不存在".into());
    };
    // 收集子树
    let subtree = collect_descendants(&data.todos, &id);
    for t in data.todos.iter_mut() {
        if subtree.contains(&t.id) {
            t.group_id = group_id.clone();
        }
    }
    // 确保 _unused 引用 root 避免警告
    let _ = &root;
    save_data_checked(&file, &data)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_todos,
            list_archived_todos,
            export_all_data,
            create_todo,
            move_todo,
            update_todo,
            delete_todo,
            set_todo_done_recursive,
            archive_due_todos,
            archive_todo,
            restore_archived_todo,
            set_suspended,
            set_priority,
            delete_archived_todo,
            set_todos_expanded,
            list_settings,
            update_settings,
            reset_settings,
            export_data,
            import_data,
            replace_data,
            get_data_dir,
            open_data_dir,
            app_version,
            open_external,
            set_app_icon,
            list_groups,
            create_group,
            rename_group,
            delete_group,
            reorder_groups,
            set_todo_group,
            list_holidays,
            check_holiday_updates,
        ])
        .setup(|app| {
            apply_app_icon_on_startup(app.handle());
            maybe_auto_update_holidays(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn todo(
        id: &str,
        parent_id: Option<&str>,
        done: bool,
        completed_at: Option<&str>,
        archived_at: Option<&str>,
    ) -> Todo {
        Todo {
            id: id.into(),
            title: id.into(),
            done,
            parent_id: parent_id.map(str::to_string),
            start_time: None,
            end_time: None,
            order: 0,
            expanded: false,
            created_at: "2026-07-01T00:00:00Z".into(),
            completed_at: completed_at.map(str::to_string),
            archived_at: archived_at.map(str::to_string),
        }
    }

    fn data(todos: Vec<Todo>) -> Data {
        Data {
            version: DATA_VERSION.into(),
            updated_at: "2026-07-01T00:00:00Z".into(),
            todos,
        }
    }

    fn utc(value: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(value)
            .unwrap()
            .with_timezone(&Utc)
    }

    #[test]
    fn migration_stamps_legacy_completed_todos_once() {
        let migrated_at = "2026-07-22T12:00:00Z";
        let existing = "2026-07-01T12:00:00Z";
        let mut value = data(vec![
            todo("legacy-done", None, true, None, None),
            todo("known-done", None, true, Some(existing), None),
            todo("active", None, false, None, None),
        ]);
        value.version = "1".into();

        assert!(migrate_data(&mut value, migrated_at));
        assert_eq!(value.version, DATA_VERSION);
        assert_eq!(value.todos[0].completed_at.as_deref(), Some(migrated_at));
        assert_eq!(value.todos[1].completed_at.as_deref(), Some(existing));
        assert_eq!(value.todos[2].completed_at, None);
        assert!(!migrate_data(&mut value, "2026-08-01T00:00:00Z"));
        assert_eq!(value.todos[0].completed_at.as_deref(), Some(migrated_at));
        assert_eq!(
            archive_due_at(&mut value, 7, utc(migrated_at)),
            vec!["known-done"]
        );
        assert!(value.todos[0].archived_at.is_none());
    }

    #[test]
    fn archive_due_uses_exact_cutoff_and_ignores_invalid_records() {
        let now = utc("2026-07-22T12:00:00Z");
        let mut value = data(vec![
            todo("exact", None, true, Some("2026-07-15T12:00:00Z"), None),
            todo("newer", None, true, Some("2026-07-15T12:00:01Z"), None),
            todo("invalid", None, true, Some("not-a-date"), None),
            todo(
                "unfinished",
                None,
                false,
                Some("2026-07-01T00:00:00Z"),
                None,
            ),
            todo("missing", None, true, None, None),
        ]);

        assert_eq!(archive_due_at(&mut value, 7, now), vec!["exact"]);
        assert_eq!(
            value.todos[0].archived_at.as_deref(),
            Some("2026-07-22T12:00:00Z")
        );
        assert!(value.todos[1..]
            .iter()
            .all(|item| item.archived_at.is_none()));
    }

    #[test]
    fn archive_days_below_one_are_clamped_to_one_day() {
        let now = utc("2026-07-22T12:00:00Z");
        for days in [0, -3] {
            let mut value = data(vec![
                todo("exact", None, true, Some("2026-07-21T12:00:00Z"), None),
                todo("newer", None, true, Some("2026-07-21T12:00:01Z"), None),
            ]);

            assert_eq!(archive_due_at(&mut value, days, now), vec!["exact"]);
            assert!(value.todos[1].archived_at.is_none());
        }
    }

    #[test]
    fn auto_archive_respects_disabled_and_custom_days() {
        let now = utc("2026-07-22T12:00:00Z");
        let mut value = data(vec![
            todo("old", None, true, Some("2026-07-18T12:00:00Z"), None),
            todo("recent", None, true, Some("2026-07-20T12:00:00Z"), None),
        ]);
        let mut settings = Settings {
            auto_archive: false,
            archive_after_days: 3,
            ..Settings::default()
        };

        assert!(archive_due_for_settings_at(&mut value, &settings, now).is_empty());
        assert!(value.todos.iter().all(|item| item.archived_at.is_none()));

        settings.auto_archive = true;
        assert_eq!(
            archive_due_for_settings_at(&mut value, &settings, now),
            vec!["old"]
        );
        assert!(value.todos[1].archived_at.is_none());
    }

    #[test]
    fn auto_archive_waits_for_branch_but_archives_due_child_branch() {
        let now = utc("2026-07-22T12:00:00Z");
        let due = "2026-07-10T12:00:00Z";
        let mut value = data(vec![
            todo("parent", None, true, Some(due), None),
            todo("due-child", Some("parent"), true, Some(due), None),
            todo(
                "recent-child",
                Some("parent"),
                true,
                Some("2026-07-20T12:00:00Z"),
                None,
            ),
        ]);

        assert_eq!(archive_due_at(&mut value, 7, now), vec!["due-child"]);
        assert!(value.todos[0].archived_at.is_none());
        assert!(value.todos[2].archived_at.is_none());

        value.todos[2].completed_at = Some(due.into());
        assert_eq!(
            archive_due_at(&mut value, 7, now),
            vec!["parent", "recent-child"]
        );
        assert!(value.todos.iter().all(|item| item.archived_at.is_some()));
    }

    #[test]
    fn manual_archive_requires_completed_active_subtree() {
        let archived_at = "2026-07-22T12:00:00Z";
        let mut value = data(vec![
            todo("parent", None, true, Some(archived_at), None),
            todo("child", Some("parent"), false, None, None),
        ]);

        assert_eq!(
            archive_branch_at(&mut value, "parent", archived_at).unwrap_err(),
            "该待办仍有未完成的子待办"
        );
        value.todos[1].done = true;
        value.todos[1].completed_at = Some(archived_at.into());
        assert_eq!(
            archive_branch_at(&mut value, "parent", archived_at).unwrap(),
            vec!["parent", "child"]
        );
        assert!(value
            .todos
            .iter()
            .all(|item| { item.archived_at.as_deref() == Some(archived_at) }));
    }

    #[test]
    fn restoring_child_restores_ancestors_and_selected_descendants() {
        let completed = "2026-07-10T12:00:00Z";
        let archived = "2026-07-20T12:00:00Z";
        let mut value = data(vec![
            todo("root", None, true, Some(completed), Some(archived)),
            todo(
                "selected",
                Some("root"),
                true,
                Some(completed),
                Some(archived),
            ),
            todo(
                "grandchild",
                Some("selected"),
                true,
                Some(completed),
                Some(archived),
            ),
            todo(
                "sibling",
                Some("root"),
                true,
                Some(completed),
                Some(archived),
            ),
        ]);

        assert_eq!(
            restore_archived_branch(&mut value, "selected").unwrap(),
            vec!["selected", "grandchild", "root"]
        );
        for item in &value.todos[..3] {
            assert!(!item.done);
            assert_eq!(item.completed_at, None);
            assert_eq!(item.archived_at, None);
            assert!(item.expanded);
        }
        assert!(value.todos[3].done);
        assert!(value.todos[3].archived_at.is_some());
    }

    #[test]
    fn permanent_delete_rejects_active_descendant_then_deletes_archived_branch() {
        let archived = "2026-07-20T12:00:00Z";
        let mut value = data(vec![
            todo("root", None, true, Some(archived), Some(archived)),
            todo("child", Some("root"), false, None, None),
            todo("other", None, false, None, None),
        ]);

        assert_eq!(
            delete_archived_branch(&mut value, "root").unwrap_err(),
            "归档分支中包含活动待办，无法永久删除"
        );
        value.todos[1].done = true;
        value.todos[1].completed_at = Some(archived.into());
        value.todos[1].archived_at = Some(archived.into());
        assert_eq!(
            delete_archived_branch(&mut value, "root").unwrap(),
            vec!["root", "child"]
        );
        assert_eq!(value.todos.len(), 1);
        assert_eq!(value.todos[0].id, "other");
    }

    #[test]
    fn active_and_history_filters_leave_full_export_source_intact() {
        let archived = "2026-07-20T12:00:00Z";
        let value = data(vec![
            todo("active", None, false, None, None),
            todo("history", None, true, Some(archived), Some(archived)),
        ]);

        assert_eq!(filtered_data(&value, false).todos[0].id, "active");
        assert_eq!(filtered_data(&value, true).todos[0].id, "history");
        assert_eq!(value.todos.len(), 2);
        assert!(serde_json::to_string(&value).unwrap().contains("history"));
    }

    #[test]
    fn archive_settings_default_and_persist_through_reload() {
        let file = std::env::temp_dir().join(format!("todocal-settings-{}.json", Uuid::new_v4()));
        fs::write(&file, r#"{"theme":"dark"}"#).unwrap();

        let mut settings = load_settings(&file);
        assert!(settings.auto_archive);
        assert_eq!(settings.archive_after_days, 7);
        settings.auto_archive = false;
        settings.archive_after_days = 14;
        save_settings(&file, &settings);

        let reloaded = load_settings(&file);
        assert!(!reloaded.auto_archive);
        assert_eq!(reloaded.archive_after_days, 14);
        let _ = fs::remove_file(file);
    }
}
