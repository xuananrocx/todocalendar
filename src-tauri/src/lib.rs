mod backup;
mod reminders;
mod reminder_native;
mod rest;
mod exchange;
mod validation;
mod storage;

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
    pub start_has_time: Option<bool>,
    #[serde(default)]
    pub end_has_time: Option<bool>,
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
    #[serde(default)]
    pub color: Option<String>,
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

/// 备忘录:长期速查信息,独立于待办列表
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoLink {
    pub name: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoEntry {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub order: i64,
    #[serde(default)]
    pub links: Vec<MemoLink>,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoData {
    pub version: String,
    pub updated_at: String,
    #[serde(default)]
    pub entries: Vec<MemoEntry>,
}

/// 用户设置。新增字段直接加,旧 settings.json 缺字段时用 Default 补。
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub reminders: reminders::Config,
    #[serde(default)]
    pub rest: rest::Config,
    pub theme: String,     // light | dark | system | glass-light | glass-dark
    pub glass_strength: u32, // 玻璃主题强度 0-100(透明度+模糊)
    pub font_size: String, // small | medium | large
    pub compact: bool,
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
    pub numbering_palette: String, // classic | morandi | ocean | theme
    pub click_action: String,      // edit | expand
    pub notes_display: String,     // none | hover | inline
    pub theme_color: String,       // clay | blue | cyan | red | ink | sunset | deep | aurora | flame
    pub show_time_precision: bool,
    pub app_icon: String,          // b | a1 | a2
    pub enable_groups: bool,
    pub group_bar_merged: bool,    // 分组栏并入顶部卡片(否则单独成卡)
    pub font_color: String,        // default | warm1 | warm2 | warm3
    pub day_item_color_mode: String,        // theme | none | custom
    pub day_item_custom_color: String,      // clay | blue | ... (when mode=custom)
    pub todo_item_color_mode: String,       // theme | none | custom
    pub todo_item_custom_color: String,     // clay | blue | ... (when mode=custom)
    pub start_event_color_mode: String,     // theme | custom
    pub start_event_custom_color: String,   // amber | blue | ... (when mode=custom)
    pub day_expand_default: String, // all-collapsed | follow-list | smart
    pub auto_sync_start: bool,
    pub auto_sync_end: bool,
    pub calendar_child_display: String, // current | main-only | main-child | child-main
    pub close_on_outside_click: bool,
    pub weekend_color: String, // none | yellow | pink | blue | green | beige | peach | dawn | aurora
    pub stats_style: String, // none | text | chip | bar
    pub clock_show_time: bool, // 时钟显示具体时间(关闭只显示"xx月xx日 周几")
    pub clock_show_seconds: bool, // 顶部时钟显示秒数(隐藏日期,显示进度条)
    pub holiday_color: String, // none | yellow | pink | blue | green | beige | peach | dawn | aurora
    pub show_rest_badge: bool, // 周末/法定假日显示"休"角标
    pub holiday_auto_update: bool,
    pub holiday_last_update: Option<String>,
    pub priority_highlight: String, // none | icon | bar | bg | full
    pub priority_auto_top: bool,    // 自动排序模式下优先待办置顶
    pub suspended_grey: bool,       // 搁置待办标题置灰(完成同款灰,无删除线)
    pub calendar_follow_group: bool, // 日历/日详情跟随分组筛选
    pub stats_follow_group: bool,   // 统计条跟随分组筛选
    pub default_group_name: String,      // 内置 Default 分组显示名
    pub default_group_color: Option<String>, // 内置 Default 分组卡片色
    pub memo_enabled: bool,        // 备忘录功能开关
    pub memo_entry: String,        // 备忘录入口位置 menu | topbar
    pub memo_display_mode: String, // 备忘录显示方式 sidebar | mini | window
    pub memo_sidebar_open: bool,   // 备忘录侧栏展开状态
    pub memo_sidebar_width: i64,   // 备忘录侧栏宽度 px
    pub memo_side_position: String, // 备忘录侧栏位置 left | right
    pub memo_mini_open: bool,      // 迷你卡片显示状态
    pub memo_mini_show: String,    // 迷你卡片常显内容 none | pinned | all
    pub memo_mini_collapsed: bool, // 迷你卡片折叠状态(只显示标题)
    pub memo_mini_bar_hidden: bool,// 迷你卡片常显栏收起状态
    pub memo_win_top: bool,        // 备忘小窗置顶
    pub memo_win_restore: bool,    // 启动时恢复备忘小窗
    #[serde(default)]
    pub memo_win_rect_physical: bool, // x/y use physical desktop pixels; w/h remain logical
    pub memo_win_rect: Option<Vec<i64>>, // 备忘小窗位置尺寸 [x,y,w,h] 逻辑像素
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            reminders: reminders::Config::default(),
            rest: rest::Config::default(),
            theme: "system".into(),
            glass_strength: 65,
            font_size: "medium".into(),
            compact: false,
            week_start: "monday".into(),
            show_week_number: false,
            show_ongoing_in_calendar: false,
            show_end_in_calendar: true,
            show_start_in_calendar: true,
            show_calendar_done: false,
            show_lunar: true,
            default_start_time: "09:00".into(),
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
            group_bar_merged: false,
            font_color: "warm1".into(),
            day_item_color_mode: "none".into(),
            day_item_custom_color: "deep".into(),
            todo_item_color_mode: "none".into(),
            todo_item_custom_color: "aurora".into(),
            start_event_color_mode: "theme".into(),
            start_event_custom_color: "slate".into(),
            day_expand_default: "all-collapsed".into(),
            auto_sync_start: false,
            auto_sync_end: true,
            calendar_child_display: "main-only".into(),
            close_on_outside_click: true,
            weekend_color: "none".into(),
            stats_style: "text".into(),
            clock_show_time: false,
            clock_show_seconds: false,
            holiday_color: "none".into(),
            show_rest_badge: true,
            holiday_auto_update: true,
            holiday_last_update: None,
            priority_highlight: "bg".into(),
            priority_auto_top: true,
            suspended_grey: true,
            calendar_follow_group: true,
            stats_follow_group: false,
            default_group_name: "Default".into(),
            default_group_color: None,
            memo_enabled: false,
            memo_entry: "menu".into(),
            memo_display_mode: "sidebar".into(),
            memo_sidebar_open: true,
            memo_sidebar_width: 230,
            memo_side_position: "left".into(),
            memo_mini_open: true,
            memo_mini_show: "pinned".into(),
            memo_mini_collapsed: false,
            memo_mini_bar_hidden: false,
            memo_win_top: false,
            memo_win_restore: false,
            memo_win_rect_physical: false,
            memo_win_rect: None,
        }
    }
}

fn now_iso() -> String {
    Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if cfg!(debug_assertions) && app.config().identifier == "com.todocalendar.app" {
        return Err("开发版禁止访问正式版数据，请使用 tauri.dev.conf.json 启动".into());
    }
    let dir = app.path().app_data_dir().map_err(|e| format!("无法定位数据目录：{}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建数据目录：{}（{}）", dir.display(), e))?;
    Ok(dir)
}

fn lock_store(app: &tauri::AppHandle) -> Result<std::sync::MutexGuard<'static, ()>, String> {
    let guard = storage::lock()?;
    backup::recover_pending(&app_dir(app)?)?;
    Ok(guard)
}

fn data_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let f = app_dir(app)?.join("todos.json");
    // Never migrate production data into the isolated development directory.
    if !f.try_exists().map_err(|e| format!("无法检查数据文件：{}（{}）", f.display(), e))?
        && app.config().identifier == "com.todocalendar.app"
    {
        let old = PathBuf::from(r"F:\CodePilot\TodoCalendar\data\todos.json");
        if let Some(mut data) = storage::read_optional::<Data>(&old)? {
            migrate_data(&mut data, &now_iso());
            save_data_checked(&f, &data)?;
        }
    }
    Ok(f)
}

fn settings_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("settings.json"))
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

fn holidays_cache_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("holidays_cache.json"))
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

fn load_holidays(app: &tauri::AppHandle) -> Result<HolidaysData, String> {
    if let Ok(guard) = HOLIDAYS.lock() {
        if let Some(data) = guard.as_ref() {
            return Ok(data.clone());
        }
    }
    let cache = holidays_cache_file(app)?;
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
    Ok(data)
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
fn list_holidays(app: tauri::AppHandle) -> Result<Value, String> {
    let _store = lock_store(&app)?;
    let data = load_holidays(&app)?;
    let mut map: serde_json::Map<String, Value> = serde_json::Map::new();
    for d in &data.days {
        map.insert(
            d.date.clone(),
            json!({ "name": d.name, "isOffDay": d.is_off_day }),
        );
    }
    Ok(Value::Object(map))
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
    let _store = lock_store(&app)?;
    let existing = load_holidays(app)?;
    let mut merged: Vec<HolidayDay> = existing
        .days
        .into_iter()
        .filter(|d| !fetched_years.contains(&d.date[..4]))
        .collect();
    merged.extend(fetched);
    let new_data = HolidaysData { days: merged };
    let cache = holidays_cache_file(app)?;
    let json_text = serde_json::to_string_pretty(&new_data).map_err(|e| e.to_string())?;
    storage::write_atomic(&cache, json_text.as_bytes()).map_err(|e| {
        report_storage_error(app, &e);
        e
    })?;
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
    // Preserve the existing first-run behavior: no automatic fetch before settings exist.
    let read = (|| -> Result<Option<Settings>, String> {
        let _store = lock_store(&app)?;
        let file = settings_file(app)?;
        if !file.try_exists().map_err(|e| format!("无法检查设置文件：{}", e))? {
            return Ok(None);
        }
        load_settings(&file).map(Some)
    })();
    let settings = match read {
        Ok(Some(s)) => s,
        Ok(None) => return,
        Err(e) => { report_storage_error(app, &e); return; }
    };
    if !settings.holiday_auto_update { return; }
    if let Some(last) = settings.holiday_last_update.as_deref() {
        if let Ok(dt) = DateTime::parse_from_rfc3339(last) {
            if Utc::now().signed_duration_since(dt.with_timezone(&Utc)) < Duration::days(30) { return; }
        }
    }
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        match check_holiday_updates(handle.clone()).await {
            Ok(_) => {
                let result = (|| -> Result<(), String> {
                    let _store = lock_store(&handle)?;
                    let file = settings_file(&handle)?;
                    let mut s = load_settings(&file)?;
                    s.holiday_last_update = Some(now_iso());
                    save_settings(&file, &s)
                })();
                if let Err(e) = result { report_storage_error(&handle, &e); }
                else { let _ = handle.emit("settings-changed", ()); }
            }
            Err(e) => eprintln!("[holidays] automatic update failed: {e}"),
        }
    });
}

fn report_storage_error(app: &tauri::AppHandle, error: &str) {
    eprintln!("[storage] {error}");
    let _ = app.emit("storage-error", error);
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

fn load_data(file: &PathBuf) -> Result<Data, String> {
    let mut data = storage::read_optional::<Data>(file)?.unwrap_or_else(|| Data {
        version: DATA_VERSION.into(), updated_at: now_iso(), todos: vec![], groups: vec![],
    });
    validation::data(&data)?;
    if migrate_data(&mut data, &now_iso()) { save_data_checked(file, &data)?; }
    Ok(data)
}

fn save_data_checked(file: &PathBuf, data: &Data) -> Result<(), String> {
    validation::data(data)?;
    let mut d = data.clone();
    d.updated_at = now_iso();
    backup::before_write(file)?;
    storage::write_json(file, &d)
}



fn load_settings(file: &PathBuf) -> Result<Settings, String> {
    let Some(read) = storage::read_optional::<Value>(file)? else { return Ok(Settings::default()); };
    let fields = read.as_object().ok_or_else(|| format!("设置文件必须是 JSON 对象，已保留原文件：{}", file.display()))?;
    let mut merged = serde_json::to_value(Settings::default()).map_err(|e| e.to_string())?;
    for (k, v) in fields { merged.as_object_mut().unwrap().insert(k.clone(), v.clone()); }
    serde_json::from_value(merged).map_err(|e| format!("设置字段格式异常，已保留原文件：{}（{}）", file.display(), e))
}

fn save_settings(file: &PathBuf, s: &Settings) -> Result<(), String> {
    s.reminders.validate()?;
    s.rest.validate()?;
    backup::before_write(file)?;
    storage::write_json(file, s)
}

fn read_app_settings(app: &tauri::AppHandle) -> Result<Settings, String> {
    let _store = lock_store(&app)?;
    load_settings(&settings_file(app)?)
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
fn list_todos(app: tauri::AppHandle) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    Ok(filtered_data(&load_data(&file)?, false))
}

#[tauri::command]
fn list_archived_todos(app: tauri::AppHandle) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    Ok(filtered_data(&load_data(&file)?, true))
}

#[tauri::command]
fn export_all_data(app: tauri::AppHandle) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    load_data(&file)
}

// Recompute this parent, then propagate to its ancestors. Empty child times preserve the old value.
fn recompute_parent_times(data: &mut Data, settings: &Settings, mut parent_id: String) {
    if !settings.auto_sync_start && !settings.auto_sync_end { return; }
    let mut visited = std::collections::HashSet::new();
    while visited.insert(parent_id.clone()) {
        let Some(index) = data.todos.iter().position(|t| t.id == parent_id) else { return; };
        let children: Vec<_> = data.todos.iter().filter(|t| t.parent_id.as_deref() == Some(&parent_id)).collect();
        let start_child = children.iter().filter(|t| t.start_time.is_some()).min_by_key(|t| time_order(t.start_time.as_deref().unwrap()));
        let start = start_child.and_then(|t| t.start_time.clone());
        let start_precision = start_child.and_then(|t| t.start_has_time);
        let end_child = children.iter().filter(|t| t.end_time.is_some()).max_by_key(|t| time_order(t.end_time.as_deref().unwrap()));
        let end = end_child.and_then(|t| t.end_time.clone());
        let end_precision = end_child.and_then(|t| t.end_has_time);
        let parent = &mut data.todos[index];
        let mut changed = false;
        if settings.auto_sync_start && start.is_some() && (parent.start_time != start || parent.start_has_time != start_precision) {
            parent.start_time = start; parent.start_has_time = start_precision; changed = true;
        }
        if settings.auto_sync_end && end.is_some() && (parent.end_time != end || parent.end_has_time != end_precision) {
            parent.end_time = end; parent.end_has_time = end_precision; changed = true;
        }
        if !changed { return; }
        let Some(next) = parent.parent_id.clone() else { return; };
        parent_id = next;
    }
}

fn time_order(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value).map(|d| d.timestamp_millis()).unwrap_or_else(|_| {
        chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d")
            .ok().and_then(|d| d.and_hms_opt(0, 0, 0)).map(|d| d.and_utc().timestamp_millis()).unwrap_or(i64::MIN)
    })
}

fn sync_parent_time(data: &mut Data, settings: &Settings, child_id: String) {
    if let Some(parent) = data.todos.iter().find(|t| t.id == child_id).and_then(|t| t.parent_id.clone()) {
        recompute_parent_times(data, settings, parent);
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
    start_has_time: Option<bool>,
    end_has_time: Option<bool>,
    group_id: Option<String>,
) -> Result<Todo, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;

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

    // 子代办继承父的 group_id(父在 Default 组也是权威);顶层待办用显式传入的分组
    let group_id = match &parent_id {
        Some(pid) => data
            .todos
            .iter()
            .find(|t| t.id == *pid)
            .and_then(|p| p.group_id.clone()),
        None => group_id,
    };

    let new = Todo {
        id: Uuid::new_v4().to_string()[..12].into(),
        title,
        done: false,
        parent_id: parent_id.clone(),
        start_time: start_time.clone(),
        end_time: end_time.clone(),
        start_has_time,
        end_has_time,
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
    let settings = load_settings(&settings_file(&app)?)?;
    sync_parent_time(&mut data, &settings, new_id);
    save_data_checked(&file, &data)?;
    Ok(new)
}

#[tauri::command]
fn move_todo(
    app: tauri::AppHandle,
    id: String,
    parent_id: Option<String>,
    index: usize,
    group_id: Option<String>,
    change_group: bool,
) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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

    let target_group = if let Some(pid) = &parent_id {
        data.todos.iter().find(|t| &t.id == pid).and_then(|t| t.group_id.clone())
    } else if change_group { group_id } else {
        data.todos.iter().find(|t| t.id == id).and_then(|t| t.group_id.clone())
    };
    let subtree = collect_descendants(&data.todos, &id);
    for t in &mut data.todos { if subtree.contains(&t.id) { t.group_id = target_group.clone(); } }

    // move 跨父时,新旧父都要重算时间
    let settings = load_settings(&settings_file(&app)?)?;
    if old_parent_id != parent_id {
        if let Some(old_pid) = old_parent_id.clone() {
            recompute_parent_times(&mut data, &settings, old_pid);
        }
        if let Some(new_pid) = parent_id.clone() {
            recompute_parent_times(&mut data, &settings, new_pid);
        }
    }

    save_data_checked(&file, &data)?;
    let mut result = data.clone();
    result.todos.retain(|t| t.archived_at.is_none());
    Ok(result)
}

/// patch 是任意字段的 JSON 对象,只更新提供的字段(null 也算"提供",会清空)
#[tauri::command]
fn update_todo(app: tauri::AppHandle, id: String, patch: serde_json::Value) -> Result<Option<Todo>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let settings = load_settings(&settings_file(&app)?)?;
    let result = apply_todo_patch(&mut data, &settings, &id, patch)?;
    if result.is_some() { save_data_checked(&file, &data)?; }
    Ok(result)
}

fn apply_todo_patch(data: &mut Data, settings: &Settings, id: &str, patch: Value) -> Result<Option<Todo>, String> {
    let Some(index) = data.todos.iter().position(|t| t.id == id) else { return Ok(None); };
    let old = data.todos[index].clone();
    let obj = patch.as_object().ok_or_else(|| "待办更新必须是 JSON 对象".to_string())?;
    let mut current = serde_json::to_value(&old).map_err(|e| e.to_string())?;
    for (k, v) in obj { current.as_object_mut().unwrap().insert(k.clone(), v.clone()); }
    for (time, precision) in [("startTime", "startHasTime"), ("endTime", "endHasTime")] {
        if obj.contains_key(time) && !obj.contains_key(precision) && current[time] != serde_json::to_value(&old).unwrap()[time] {
            current[precision] = Value::Null;
        }
    }
    let mut updated: Todo = serde_json::from_value(current).map_err(|e| format!("待办字段格式异常：{}", e))?;
    if updated.id != old.id { return Err("不能修改任务 ID".into()); }
    if let Some(pid) = &updated.parent_id {
        let parent = data.todos.iter().find(|t| &t.id == pid).ok_or("目标父待办不存在")?;
        if parent.archived_at.is_some() && old.parent_id != updated.parent_id { return Err("不能移动到归档待办下".into()); }
        if collect_descendants(&data.todos, id).contains(pid) { return Err("不能把待办移动到自身或自己的子级中".into()); }
        updated.group_id = parent.group_id.clone();
    }
    if updated.done {
        if !old.done || updated.completed_at.is_none() { updated.completed_at = Some(now_iso()); }
        updated.suspended_at = None;
    } else { updated.completed_at = None; updated.archived_at = None; }
    let group = updated.group_id.clone();
    let parent_changed = old.parent_id != updated.parent_id;
    data.todos[index] = updated;
    if group != old.group_id {
        let ids = collect_descendants(&data.todos, id);
        for t in &mut data.todos { if ids.contains(&t.id) { t.group_id = group.clone(); } }
    }
    validation::data(data)?;
    if parent_changed {
        if let Some(parent) = old.parent_id { recompute_parent_times(data, settings, parent); }
    }
    sync_parent_time(data, settings, id.into());
    Ok(Some(data.todos[index].clone()))
}

#[tauri::command]
fn delete_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;

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
        let settings = load_settings(&settings_file(&app)?)?;
        recompute_parent_times(&mut data, &settings, pid);
    }

    save_data_checked(&file, &data)?;
    Ok(ids)
}

/// 递归把 rootId 及其所有后代代办 done 同步为参数值。用于"勾选父→子全选"
#[tauri::command]
fn set_todo_done_recursive(app: tauri::AppHandle, id: String, done: bool) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    save_data_checked(&file, &data)?;
    Ok(ids)
}

#[tauri::command]
fn archive_due_todos(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let settings = load_settings(&settings_file(&app)?)?;
    if !settings.auto_archive {
        return Ok(Vec::new());
    }

    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let archived_ids = archive_due_for_settings_at(&mut data, &settings, Utc::now());
    if !archived_ids.is_empty() {
        save_data_checked(&file, &data)?;
    }
    Ok(archived_ids)
}

#[tauri::command]
fn archive_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let archived_ids = archive_branch_at(&mut data, &id, &now_iso())?;
    save_data_checked(&file, &data)?;
    Ok(archived_ids)
}

#[tauri::command]
fn restore_archived_todo(app: tauri::AppHandle, id: String) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let restored_ids = restore_archived_branch(&mut data, &id)?;
    save_data_checked(&file, &data)?;
    Ok(restored_ids)
}

#[tauri::command]
fn set_suspended(app: tauri::AppHandle, id: String, suspended: bool) -> Result<Vec<String>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let deleted_ids = delete_archived_branch(&mut data, &id)?;
    save_data_checked(&file, &data)?;
    Ok(deleted_ids)
}

#[tauri::command]
fn set_todos_expanded(app: tauri::AppHandle, expanded: bool) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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

// ===== 备忘录 =====
fn memos_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("memos.json"))
}

fn load_memos(file: &PathBuf) -> Result<MemoData, String> {
    Ok(storage::read_optional::<MemoData>(file)?.unwrap_or_else(|| MemoData {
        version: "1".into(), updated_at: now_iso(), entries: vec![],
    }))
}

fn save_memos(file: &PathBuf, data: &MemoData) -> Result<(), String> {
    validation::memos(data)?;
    backup::before_write(file)?;
    storage::write_json(file, data)
}

fn sort_memos(entries: &mut Vec<MemoEntry>) {
    entries.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(a.order.cmp(&b.order)));
}

#[tauri::command]
fn list_memos(app: tauri::AppHandle) -> Result<MemoData, String> {
    let _store = lock_store(&app)?;
    let file = memos_file(&app)?;
    let mut data = load_memos(&file)?;
    sort_memos(&mut data.entries);
    Ok(data)
}

/// 新建(id 为空)或更新一条备忘;返回最新全量数据
#[tauri::command]
fn save_memo_entry(app: tauri::AppHandle, mut entry: MemoEntry) -> Result<MemoData, String> {
    let _store = lock_store(&app)?;
    if entry.title.trim().is_empty() {
        return Err("标题不能为空".into());
    }
    let file = memos_file(&app)?;
    let mut data = load_memos(&file)?;
    entry.title = entry.title.trim().to_string();
    entry.updated_at = now_iso();
    if entry.id.is_empty() {
        entry.id = Uuid::new_v4().to_string();
        // 新条目排在同置顶级别的最前
        let min_order = data.entries.iter().map(|e| e.order).min().unwrap_or(0);
        entry.order = min_order - 1;
        data.entries.push(entry);
    } else {
        match data.entries.iter().position(|e| e.id == entry.id) {
            Some(i) => {
                // 置顶状态变化时跳到新分组最前(新置顶→全体最前;取消置顶→非置顶组最前)
                if entry.pinned != data.entries[i].pinned {
                    let pool_min = data
                        .entries
                        .iter()
                        .filter(|e| e.pinned == entry.pinned)
                        .map(|e| e.order)
                        .min();
                    let min_order = pool_min.map_or(0, |m| m.min(0));
                    entry.order = min_order - 1;
                } else {
                    entry.order = data.entries[i].order;
                }
                data.entries[i] = entry;
            }
            None => return Err("条目不存在".into()),
        }
    }
    data.updated_at = now_iso();
    sort_memos(&mut data.entries);
    save_memos(&file, &data)?;
    let _ = app.emit("memos-changed", ());
    Ok(data)
}

#[tauri::command]
fn delete_memo_entry(app: tauri::AppHandle, id: String) -> Result<MemoData, String> {
    let _store = lock_store(&app)?;
    let file = memos_file(&app)?;
    let mut data = load_memos(&file)?;
    data.entries.retain(|e| e.id != id);
    data.updated_at = now_iso();
    save_memos(&file, &data)?;
    let _ = app.emit("memos-changed", ());
    Ok(data)
}

/// 按传入的 id 顺序重排(order = 下标)
#[tauri::command]
fn reorder_memos(app: tauri::AppHandle, ids: Vec<String>) -> Result<MemoData, String> {
    let _store = lock_store(&app)?;
    let file = memos_file(&app)?;
    let mut data = load_memos(&file)?;
    for (i, id) in ids.iter().enumerate() {
        if let Some(e) = data.entries.iter_mut().find(|e| e.id == *id) {
            e.order = i as i64;
        }
    }
    data.updated_at = now_iso();
    sort_memos(&mut data.entries);
    save_memos(&file, &data)?;
    let _ = app.emit("memos-changed", ());
    Ok(data)
}

// ===== 备忘小窗(独立窗口模式) =====
const MEMO_WIN_LABEL: &str = "memo";

fn memo_win_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window(MEMO_WIN_LABEL)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

/// 小窗当前位置尺寸(逻辑像素)落库;拖动/缩放时节流 800ms 调用
fn memo_win_save_rect(app: &tauri::AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window(MEMO_WIN_LABEL) else { return Ok(()) };
    let (Some(p), Some(sz)) = (w.outer_position().ok(), w.inner_size().ok()) else {
        eprintln!("[memo-win] save_rect: pos/size read failed");
        return Ok(());
    };
    let sf = w.scale_factor().unwrap_or(1.0);
    let lp = p.to_logical::<f64>(sf);
    let ls = sz.to_logical::<f64>(sf);
    // 窗口创建/隐藏瞬间会报停放坐标(-18286 之类)或 0x0 尺寸,跳过不落库
    if ls.width < 1.0 || ls.height < 1.0 || lp.x.abs() > 10000.0 || lp.y.abs() > 10000.0 {
        eprintln!("[memo-win] save_rect skip parked/zero rect");
        return Ok(());
    }
    let _store = lock_store(&app)?;
    let file = settings_file(app)?;
    let mut s = load_settings(&file)?;
    let rect = Some(vec![
        p.x as i64,
        p.y as i64,
        ls.width.round() as i64,
        ls.height.round() as i64,
    ]);
    if s.memo_win_rect == rect && s.memo_win_rect_physical { return Ok(()); }
    s.memo_win_rect = rect;
    s.memo_win_rect_physical = true;
    save_settings(&file, &s)?;
    drop(_store);
    let _ = app.emit("settings-changed", ());
    eprintln!(
        "[memo-win] save_rect ok [{},{},{},{}]",
        lp.x.round(),
        lp.y.round(),
        ls.width.round(),
        ls.height.round()
    );
    Ok(())
}

/// 显示备忘小窗;不存在则按记忆的位置尺寸创建(默认 280x480),置顶状态取设置
fn memo_win_show(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MEMO_WIN_LABEL) {
        let s = read_app_settings(app)?;
        w.set_always_on_top(s.memo_win_top).map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    memo_win_create(app, true)
}

/// 确保小窗存在。visible=false 时只建不显示(启动预建用)。
fn memo_win_ensure(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    if app.get_webview_window(MEMO_WIN_LABEL).is_some() {
        if visible {
            return memo_win_show(app);
        }
        return Ok(());
    }
    memo_win_create(app, visible)
}

/// 创建备忘小窗。Windows 上从命令线程(入口点击/设置钩子)同步建 WebView2 窗会得到
/// 死渲染管线(白屏+X失灵,WidgetWin_0 停在 0x0),因此运行期一律不直接建窗:
/// 启动时预建(restore=false 也建,隐藏),运行期只 show/hide。
fn memo_position_on_screen(rect: &[i64], physical: bool, monitors: &[(i32, i32, u32, u32, f64)]) -> Option<(i32, i32)> {
    if rect.len() != 4 || rect[2] < 240 || rect[3] < 320 { return None; }
    for &(mx, my, width, height, scale) in monitors {
        let factor = if physical { 1.0 } else { scale };
        let x = rect[0] as f64 * factor;
        let y = rect[1] as f64 * factor;
        if x >= mx as f64 - 60.0 && y >= my as f64
            && x < mx as f64 + width as f64 - 60.0 && y < my as f64 + height as f64 - 32.0 {
            return Some((x.round() as i32, y.round() as i32));
        }
    }
    None
}

fn memo_win_create(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    let s = read_app_settings(app)?;
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        MEMO_WIN_LABEL,
        tauri::WebviewUrl::App("memo.html".into()),
    )
    .title("备忘录")
    .min_inner_size(240.0, 320.0)
    .always_on_top(s.memo_win_top)
    .visible(visible);
    let monitors: Vec<_> = app.available_monitors().map_err(|e| e.to_string())?
        .iter().map(|m| (m.position().x, m.position().y, m.size().width, m.size().height, m.scale_factor())).collect();
    let position = s.memo_win_rect.as_ref().and_then(|r| memo_position_on_screen(r, s.memo_win_rect_physical, &monitors));
    if let (Some(r), Some(_)) = (&s.memo_win_rect, position) {
        builder = builder.inner_size(r[2] as f64, r[3] as f64);
    } else {
        builder = builder.inner_size(280.0, 480.0).center();
    }
    let w = builder.visible(false).build().map_err(|e| e.to_string())?;
    if let Some((x, y)) = position {
        w.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    }
    if visible { w.show().map_err(|e| e.to_string())?; }
    // 全局 Builder::on_window_event 对运行时动态创建的窗口不生效,
    // 必须在窗口实例上挂事件处理器。回调运行在事件循环线程上,
    // 其中同步调窗口方法(读位置等)会派回事件循环 → 自锁死,
    // 所以 hide/save_rect 一律开线程执行。
    let app2 = app.clone();
    let rect_last = std::sync::Arc::new(std::sync::Mutex::new(
        std::time::Instant::now() - std::time::Duration::from_secs(10),
    ));
    let rect_last2 = rect_last.clone();
    w.on_window_event(move |event| match event {
        tauri::WindowEvent::CloseRequested { api, .. } => {
            eprintln!("[memo-win] CloseRequested: prevent + hide(spawn)");
            api.prevent_close();
            let app3 = app2.clone();
            std::thread::spawn(move || match memo_win_hide(&app3) {
                Ok(()) => eprintln!("[memo-win] hide ok"),
                Err(e) => report_storage_error(&app3, &e),
            });
        }
        tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
            let mut last = rect_last2.lock().unwrap();
            if last.elapsed() >= std::time::Duration::from_millis(800) {
                *last = std::time::Instant::now();
                drop(last);
                let app3 = app2.clone();
                std::thread::spawn(move || {
                    if let Err(e) = memo_win_save_rect(&app3) { report_storage_error(&app3, &e); }
                });
            }
        }
        _ => {}
    });
    Ok(())
}

/// 隐藏备忘小窗(保留窗口,先存位置)
fn memo_win_hide(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(MEMO_WIN_LABEL) {
        eprintln!("[memo-win] hide begin");
        let saved = memo_win_save_rect(app);
        w.hide().map_err(|e| e.to_string())?;
        saved?;
        eprintln!("[memo-win] hide end ok");
    }
    Ok(())
}

/// 备忘录入口点击(窗口模式):可见→隐藏,不可见→显示(正常情况启动已预建)
#[tauri::command]
fn memo_win_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    if memo_win_visible(&app) {
        memo_win_hide(&app)?;
        Ok(false)
    } else if app.get_webview_window(MEMO_WIN_LABEL).is_some() {
        memo_win_show(&app)?;
        Ok(true)
    } else {
        // 兜底:窗口不存在时延迟到命令返回后再建,避免命令线程建出死 webview
        let h = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(400));
            let _ = memo_win_show(&h);
        });
        Ok(true)
    }
}

/// 小窗页面内隐藏(标题栏关闭走 WindowEvent::CloseRequested 同样处理)
#[tauri::command]
fn memo_win_hide_window(app: tauri::AppHandle) -> Result<(), String> {
    memo_win_hide(&app)
}

/// TEMP 诊断:前端把运行状态打到 dev 日志(排查 JS 是否真的在跑)
#[tauri::command]
fn diag_log(msg: String) {
    eprintln!("[diag] {msg}");
}

#[tauri::command]
fn list_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let _store = lock_store(&app)?;
    let file = settings_file(&app)?;
    load_settings(&file)
}

/// patch 形如 { "theme": "dark", "fontSize": "large" }
#[tauri::command]
fn update_settings(app: tauri::AppHandle, patch: serde_json::Value) -> Result<Settings, String> {
    let _store = lock_store(&app)?;
    let file = settings_file(&app)?;
    let mut s = load_settings(&file)?;
    let (old_enabled, old_mode) = (s.memo_enabled, s.memo_display_mode.clone());

    let obj = patch.as_object().ok_or_else(|| "设置更新必须是 JSON 对象".to_string())?;
    if obj.get("reminders").and_then(|r| r.get("newGroupEnabled"))
        .and_then(Value::as_bool).is_some_and(|v| v != s.reminders.new_group_enabled) {
        let data = load_data(&app_dir(&app)?.join("todos.json"))?;
        s.reminders.preserve_existing_groups(&data);
    }
    let mut cur = serde_json::to_value(&s).map_err(|e| e.to_string())?;
    for (k, v) in obj {
        if k == "rest" {
            for (field, value) in v.as_object().ok_or("休息提醒设置必须是对象")? {
                cur["rest"].as_object_mut().unwrap().insert(field.clone(), value.clone());
            }
        } else if k == "reminders" {
            let fields = v.as_object().ok_or("提醒设置必须是对象")?;
            for (field, value) in fields {
                if field == "groupEnabled" {
                    let groups = value.as_object().ok_or("分组提醒设置必须是对象")?;
                    for (id, enabled) in groups {
                        cur["reminders"]["groupEnabled"].as_object_mut().unwrap().insert(id.clone(), enabled.clone());
                    }
                } else {
                    cur["reminders"].as_object_mut().unwrap().insert(field.clone(), value.clone());
                }
            }
        } else { cur.as_object_mut().unwrap().insert(k.clone(), v.clone()); }
    }
    s = serde_json::from_value(cur).map_err(|e| format!("设置字段格式异常：{}", e))?;
    save_settings(&file, &s)?;
    drop(_store); // Window callbacks may also save settings.

    // 备忘小窗联动:置顶即时生效;关功能/切走窗口模式→隐藏;切入窗口模式→弹出
    if let Some(w) = app.get_webview_window(MEMO_WIN_LABEL) {
        if w.is_visible().unwrap_or(false) {
            let _ = w.set_always_on_top(s.memo_win_top);
        }
    }
    let want_win = s.memo_enabled && s.memo_display_mode == "window";
    if !want_win {
        if memo_win_visible(&app) {
            if let Err(e) = memo_win_hide(&app) { report_storage_error(&app, &e); }
        }
    } else if !old_enabled || old_mode != "window" {
        if app.get_webview_window(MEMO_WIN_LABEL).is_some() {
            let _ = memo_win_show(&app);
        } else {
            // 命令线程直接建窗会得到死 webview,延迟到命令返回后建(同 boot 路径)
            let h = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(400));
                if let Err(e) = memo_win_show(&h) {
                    eprintln!("[memo-win] runtime create FAILED: {e}");
                }
            });
        }
    }
    let _ = app.emit("settings-changed", ());
    Ok(s)
}

/// 导出 todos.json 到用户选的路径。前端用 plugin-dialog 选路径,把路径传进来。
#[tauri::command]
fn export_data(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _store = lock_store(&app)?;
    let bundle = exchange::snapshot(&app_dir(&app)?)?;
    storage::write_json(std::path::Path::new(&path), &bundle)
}

#[tauri::command]
fn inspect_import(path: String) -> Result<String, String> {
    Ok(exchange::read(std::path::Path::new(&path))?.scope().into())
}

#[tauri::command]
fn import_data(app: tauri::AppHandle, path: String, expected_scope: Option<String>) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let parsed = exchange::read(std::path::Path::new(&path))?;
    let includes_memos = parsed.memos.is_some();
    let data = exchange::apply(&app_dir(&app)?, parsed, expected_scope.as_deref().unwrap_or("legacyTasks"))?;
    drop(_store);
    let _ = app.emit("todos-changed", ());
    if includes_memos { let _ = app.emit("memos-changed", ()); }
    Ok(data)
}

fn import_tasks(dir: &std::path::Path, mut parsed: Data) -> Result<Data, String> {
    validation::data(&parsed)?;
    migrate_data(&mut parsed, &now_iso());
    backup::recovery_copy(dir, "before-import")?;
    save_data_checked(&dir.join("todos.json"), &parsed)?;
    Ok(parsed)
}

#[tauri::command]
fn export_backup(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _store = lock_store(&app)?;
    let bundle = backup::snapshot(&app_dir(&app)?)?;
    storage::write_json(std::path::Path::new(&path), &bundle)
}

#[tauri::command]
fn restore_backup(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let _store = lock_store(&app)?;
    let mut bundle: backup::Bundle = storage::read_optional(std::path::Path::new(&path))?.ok_or("备份文件不存在")?;
    let copy = backup::restore(&app_dir(&app)?, &mut bundle)?;
    drop(_store);
    // Existing windows reload data/settings; no direct runtime WebView creation here.
    let settings = read_app_settings(&app)?;
    if let Some(w) = app.get_webview_window(MEMO_WIN_LABEL) {
        if !settings.memo_enabled || settings.memo_display_mode != "window" {
            if let Err(e) = w.hide() { report_storage_error(&app, &e.to_string()); }
        } else if let Err(e) = w.set_always_on_top(settings.memo_win_top) {
            report_storage_error(&app, &e.to_string());
        }
    }
    let _ = app.emit("settings-changed", ());
    let _ = app.emit("memos-changed", ());
    let _ = app.emit("todos-changed", ());
    Ok(copy.to_string_lossy().into_owned())
}

/// 用系统命令打开数据目录(Windows: explorer)
#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app_dir(&app)?;
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

/// 重置设置为默认值(内置分组的名字/颜色属于用户数据,不重置)
#[tauri::command]
fn reset_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    let _store = lock_store(&app)?;
    let cur = load_settings(&settings_file(&app)?)?;
    let mut s = Settings::default();
    s.default_group_name = cur.default_group_name;
    s.default_group_color = cur.default_group_color;
    // 小窗位置记忆属于用户使用痕迹,保留
    s.memo_win_rect = cur.memo_win_rect;
    s.memo_win_rect_physical = cur.memo_win_rect_physical;
    save_settings(&settings_file(&app)?, &s)?;
    drop(_store); // Window callbacks may also save settings.
    if memo_win_visible(&app) {
        if let Err(e) = memo_win_hide(&app) { report_storage_error(&app, &e); }
    }
    let _ = app.emit("settings-changed", ());
    Ok(s)
}

/// 用前端传进来的 Data 直接覆盖本地文件(导入用)
#[tauri::command]
fn replace_data(app: tauri::AppHandle, data: Data) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    import_tasks(&app_dir(&app)?, data)
}

/// 返回数据目录路径(给 settings UI 显示用)
#[tauri::command]
fn get_data_dir(app: tauri::AppHandle) -> Result<String, String> {
    Ok(app_dir(&app)?.to_string_lossy().into())
}

/// 读取图标文件路径(打包资源 / dev fallback 到磁盘)
fn resolve_icon_path(app: &tauri::AppHandle, name: &str) -> Option<std::path::PathBuf> {
    resolve_icon_file(app, &format!("icon_{}_256.png", name))
}

fn resolve_icon_file(app: &tauri::AppHandle, filename: &str) -> Option<std::path::PathBuf> {
    use tauri::Manager;
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
    // WM_SETICON 只影响标题栏/Alt-Tab,任务栏跟随窗口类图标,需一并替换
    #[cfg(target_os = "windows")]
    {
        let ico_path = resolve_icon_file(&app, &format!("icon_{}.ico", name))
            .ok_or_else(|| format!("图标 ico {} 不存在", name))?;
        let hwnd = window
            .hwnd()
            .map_err(|e| format!("获取窗口句柄失败: {}", e))?
            .0;
        update_taskbar_icon(hwnd as *mut std::ffi::c_void, &ico_path)?;
    }
    Ok(())
}

/// 任务栏解析图标的顺序是 AUMID 匹配快捷方式在前:打包版开始菜单快捷方式指向内嵌
/// 默认图标的 exe,任务栏会一直显示快捷方式图标而无视 WM_SETICON(标题栏仍跟随)。
/// 给进程设一个不与任何快捷方式匹配的显式 AUMID(Electron setAppUserModelId 同款机制),
/// 任务栏才回退到 WM_SETICON 的窗口图标。必须在创建任何窗口之前调用。
/// 注:不能用 SHGetPropertyStoreForWindow+SetValue 写窗口属性存储,实测在
/// tauri/webview2 窗口上 SetValue 会在 PROPSYS.dll 内固定偏移 0x3062e 访问违例崩溃。
#[cfg(target_os = "windows")]
fn set_explicit_aumid() {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let name = if cfg!(debug_assertions) { "TodoCalendar.Dev\0" } else { "TodoCalendar.MainWindow\0" };
    let id: Vec<u16> = name.encode_utf16().collect();
    let hr = unsafe { SetCurrentProcessExplicitAppUserModelID(id.as_ptr()) };
    if hr == 0 {
        eprintln!("[icon] process AUMID set");
    } else {
        eprintln!("[icon] process AUMID failed: 0x{:08X}", hr as u32);
    }
}

/// 记录我们 LoadImageW 加载并挂在窗口上的图标句柄,替换时销毁旧句柄防 GDI 泄漏
#[cfg(target_os = "windows")]
static TASKBAR_ICON_CACHE: std::sync::Mutex<(isize, isize)> = std::sync::Mutex::new((0, 0));

#[cfg(target_os = "windows")]
fn update_taskbar_icon(
    hwnd: *mut std::ffi::c_void,
    ico_path: &std::path::Path,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, GetSystemMetrics, LoadImageW, SendMessageW, ICON_BIG, ICON_SMALL, IMAGE_ICON,
        LR_LOADFROMFILE, SM_CXICON, SM_CYICON, WM_SETICON,
    };
    type Handle = *mut std::ffi::c_void;
    let wide: Vec<u16> = ico_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe fn load(wide: &[u16], cx: i32, cy: i32, what: &str) -> Result<Handle, String> {
        let h = LoadImageW(
            std::ptr::null_mut(),
            wide.as_ptr(),
            IMAGE_ICON,
            cx,
            cy,
            LR_LOADFROMFILE,
        );
        if h.is_null() {
            Err(format!("加载{}图标失败: {}", what, GetLastError()))
        } else {
            Ok(h)
        }
    }
    unsafe {
        let big = load(&wide, GetSystemMetrics(SM_CXICON), GetSystemMetrics(SM_CYICON), "大")?;
        // Win11 任务栏忽略过小的 ICON_SMALL(16px 时只改标题栏),必须挂大图才会刷新
        let small = load(&wide, 256, 256, "小")
            .map_err(|e| {
                DestroyIcon(big);
                e
            })?;
        // WM_SETICON 是任务栏唯一会收到通知的图标通道;类图标(SetClassLongPtr)不会触发刷新
        SendMessageW(hwnd, WM_SETICON, ICON_BIG as usize, big as isize);
        SendMessageW(hwnd, WM_SETICON, ICON_SMALL as usize, small as isize);
        let mut cache = TASKBAR_ICON_CACHE.lock().unwrap();
        let (old_big, old_small) = *cache;
        if old_big != 0 {
            DestroyIcon(old_big as Handle);
        }
        if old_small != 0 {
            DestroyIcon(old_small as Handle);
        }
        *cache = (big as isize, small as isize);
    }
    eprintln!("[icon] window icons updated via WM_SETICON");
    Ok(())
}

fn apply_app_icon_on_startup(app: &tauri::AppHandle) {
    let settings = match read_app_settings(app) {
        Ok(s) => s,
        Err(e) => { eprintln!("[icon] settings unavailable: {e}"); return; }
    };
    // 存量配置可能是被移除的图标(如 bf),回落默认 b
    let name = match settings.app_icon.as_str() {
        "b" | "a1" | "a2" => settings.app_icon,
        _ => "b".to_string(),
    };
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
fn list_groups(app: tauri::AppHandle) -> Result<Vec<Group>, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    Ok(load_data(&file)?.groups)
}

#[tauri::command]
fn create_group(app: tauri::AppHandle, name: String, color: Option<String>) -> Result<Group, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("分组名不能为空".into());
    }
    let max_order = data.groups.iter().map(|g| g.order).max().unwrap_or(0);
    let group = Group {
        id: Uuid::new_v4().to_string()[..12].into(),
        name: trimmed.into(),
        order: max_order + 1,
        color: color.filter(|c| !c.trim().is_empty()),
    };
    data.groups.push(group.clone());
    save_data_checked(&file, &data)?;
    Ok(group)
}

#[tauri::command]
fn set_group_color(app: tauri::AppHandle, id: String, color: Option<String>) -> Result<(), String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    for g in data.groups.iter_mut() {
        if g.id == id {
            g.color = color.filter(|c| !c.trim().is_empty());
            save_data_checked(&file, &data)?;
            return Ok(());
        }
    }
    Err("分组不存在".into())
}

#[tauri::command]
fn rename_group(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
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

/// 移入分组:整个子树换组 + 变为该组顶层(追加到末尾)
#[tauri::command]
fn move_todo_to_group(
    app: tauri::AppHandle,
    id: String,
    group_id: Option<String>,
) -> Result<Data, String> {
    let _store = lock_store(&app)?;
    let file = data_file(&app)?;
    let mut data = load_data(&file)?;
    let moving = data
        .todos
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "待办不存在".to_string())?;
    let old_parent_id = moving.parent_id.clone();

    let subtree = collect_descendants(&data.todos, &id);
    for t in data.todos.iter_mut() {
        if subtree.contains(&t.id) {
            t.group_id = group_id.clone();
        }
    }

    let max_top_order = data
        .todos
        .iter()
        .filter(|t| t.parent_id.is_none())
        .map(|t| t.order)
        .max()
        .unwrap_or(-1);
    if let Some(t) = data.todos.iter_mut().find(|t| t.id == id) {
        t.parent_id = None;
        t.order = max_top_order + 1;
    }

    if let Some(old_pid) = old_parent_id {
        let settings = load_settings(&settings_file(&app)?)?;
        recompute_parent_times(&mut data, &settings, old_pid);
    }

    save_data_checked(&file, &data)?;
    let mut result = data.clone();
    result.todos.retain(|t| t.archived_at.is_none());
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    set_explicit_aumid();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            reminders::reminder_snapshot,
            rest::rest_snapshot,
            rest::rest_action,
            rest::rest_ready,
            reminders::reminder_resize,
            reminders::reminder_action,
            reminders::reminder_ready,
            reminders::reminder_open_todo,
            reminders::reminder_sound_preview,
            diag_log,
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
            export_backup,
            restore_backup,
            import_data,
            inspect_import,
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
            move_todo_to_group,
            set_group_color,
            list_holidays,
            check_holiday_updates,
            list_memos,
            save_memo_entry,
            delete_memo_entry,
            reorder_memos,
            memo_win_toggle,
            memo_win_hide_window,
        ])
        .setup(|app| {
            eprintln!("[startup] identifier={} data_dir={}", app.config().identifier, app_dir(app.handle())?.display());
            reminders::start(app.handle())?;
            rest::start(app.handle())?;
            apply_app_icon_on_startup(app.handle());
            maybe_auto_update_holidays(app.handle());
            // 备忘小窗:窗口模式下启动即预建(restore=false 也建,隐藏),
            // 避免运行期点击入口时才建窗(Windows 上命令线程建 WebView2 会白屏+X失灵)
            let s = match read_app_settings(app.handle()) {
                Ok(s) => s,
                Err(e) => { report_storage_error(app.handle(), &e); return Ok(()); }
            };
            eprintln!(
                "[memo-win] boot cond: enabled={} mode={} restore={}",
                s.memo_enabled, s.memo_display_mode, s.memo_win_restore
            );
            if s.memo_enabled && s.memo_display_mode == "window" {
                let visible = s.memo_win_restore;
                let h = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(400));
                    let what = if visible { "show" } else { "precreate-hidden" };
                    match memo_win_ensure(&h, visible) {
                        Ok(()) => eprintln!("[memo-win] boot {what} ok"),
                        Err(e) => eprintln!("[memo-win] boot {what} FAILED: {e}"),
                    }
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) { window.app_handle().exit(0); }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("todocal-storage-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn file(&self, name: &str) -> PathBuf { self.0.join(name) }
    }

    impl Drop for TestDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    #[test]
    fn parent_sync_copies_explicit_precision_even_when_timestamp_is_unchanged() {
        let mut parent=todo("parent",None,false,None,None);
        parent.end_time=Some("2026-11-09T00:00:00+08:00".into());
        parent.end_has_time=Some(false);
        let mut child=todo("child",Some("parent"),false,None,None);
        child.end_time=parent.end_time.clone();child.end_has_time=Some(true);
        let mut data=data(vec![parent,child]);
        recompute_parent_times(&mut data,&Settings::default(),"parent".into());
        assert_eq!(data.todos[0].end_has_time,Some(true));
    }

    #[test]
    fn missing_files_return_defaults_without_creating_files() {
        let dir = TestDir::new();
        assert!(load_data(&dir.file("todos.json")).unwrap().todos.is_empty());
        assert!(load_memos(&dir.file("memos.json")).unwrap().entries.is_empty());
        assert_eq!(load_settings(&dir.file("settings.json")).unwrap().theme, Settings::default().theme);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 0);
    }

    #[test]
    fn damaged_files_are_errors_and_keep_original_bytes() {
        let dir = TestDir::new();
        let broken = b"{\"unfinished\":";
        for name in ["todos.json", "settings.json", "memos.json"] {
            fs::write(dir.file(name), broken).unwrap();
        }
        assert!(load_data(&dir.file("todos.json")).is_err());
        assert!(load_settings(&dir.file("settings.json")).is_err());
        assert!(load_memos(&dir.file("memos.json")).is_err());
        for name in ["todos.json", "settings.json", "memos.json"] {
            assert_eq!(fs::read(dir.file(name)).unwrap(), broken);
        }
    }

    #[test]
    fn invalid_settings_values_do_not_fall_back_to_defaults() {
        let dir = TestDir::new();
        let file = dir.file("settings.json");
        for value in ["null", "[]", r#"{"autoArchive":"yes"}"#] {
            fs::write(&file, value).unwrap();
            assert!(load_settings(&file).is_err());
            assert_eq!(fs::read_to_string(&file).unwrap(), value);
        }
    }

    #[test]
    fn read_errors_are_not_treated_as_missing_files() {
        let dir = TestDir::new();
        let file = dir.file("not-a-file.json");
        fs::create_dir(&file).unwrap();
        assert!(load_data(&file).is_err());
        assert!(load_settings(&file).is_err());
        assert!(load_memos(&file).is_err());
    }

    #[test]
    fn failed_load_stops_read_modify_write_before_overwrite() {
        let dir = TestDir::new();
        let file = dir.file("todos.json");
        fs::write(&file, b"broken original").unwrap();
        let result = (|| -> Result<(), String> {
            let _store = storage::lock()?;
            let mut value = load_data(&file)?;
            value.todos.push(todo("new", None, false, None, None));
            save_data_checked(&file, &value)
        })();
        assert!(result.is_err());
        assert_eq!(fs::read(&file).unwrap(), b"broken original");
    }

    #[test]
    fn atomic_save_replaces_existing_file_and_leaves_no_temp_files() {
        let dir = TestDir::new();
        let file = dir.file("todos.json");
        save_data_checked(&file, &data(vec![])).unwrap();
        save_data_checked(&file, &data(vec![todo("saved", None, false, None, None)])).unwrap();
        assert_eq!(load_data(&file).unwrap().todos[0].id, "saved");
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[test]
    fn all_save_helpers_propagate_failures() {
        let dir = TestDir::new();
        let file = dir.file("missing-parent/data.json");
        assert!(save_data_checked(&file, &data(vec![])).is_err());
        assert!(save_settings(&file, &Settings::default()).is_err());
        let memos = MemoData { version: "1".into(), updated_at: now_iso(), entries: vec![] };
        assert!(save_memos(&file, &memos).is_err());
        assert!(!file.exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_replace_failure_preserves_original_and_cleans_temp() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TestDir::new();
        let file = dir.file("todos.json");
        save_data_checked(&file, &data(vec![todo("original", None, false, None, None)])).unwrap();
        let original = fs::read(&file).unwrap();
        // Permit readers, but deny deletion/replacement, as another program might.
        let held = fs::OpenOptions::new().read(true).share_mode(1).open(&file).unwrap();
        assert!(load_data(&file).is_ok());
        let result = save_data_checked(&file, &data(vec![]));
        drop(held);
        assert!(result.is_err());
        assert_eq!(fs::read(&file).unwrap(), original);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn windows_read_denial_is_reported_without_reset() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = TestDir::new();
        let file = dir.file("settings.json");
        fs::write(&file, r#"{"theme":"dark"}"#).unwrap();
        let held = fs::OpenOptions::new().read(true).share_mode(0).open(&file).unwrap();
        assert!(load_settings(&file).is_err());
        drop(held);
        assert_eq!(fs::read_to_string(&file).unwrap(), r#"{"theme":"dark"}"#);
    }

    #[test]
    fn concurrent_read_modify_write_keeps_every_update() {
        let dir = TestDir::new();
        let file = dir.file("todos.json");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let handles: Vec<_> = (0..4).map(|worker| {
            let file = file.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || -> Result<(), String> {
                barrier.wait();
                for n in 0..10 {
                    let _store = storage::lock()?;
                    let mut value = load_data(&file)?;
                    value.todos.push(todo(&format!("{worker}-{n}"), None, false, None, None));
                    save_data_checked(&file, &value)?;
                }
                Ok(())
            })
        }).collect();
        for handle in handles { handle.join().unwrap().unwrap(); }
        let value = load_data(&file).unwrap();
        let ids: std::collections::HashSet<_> = value.todos.iter().map(|t| &t.id).collect();
        assert_eq!(ids.len(), 40);
        assert_eq!(value.todos.len(), 40);
    }

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
            start_has_time: None,
            end_has_time: None,
            order: 0,
            expanded: false,
            created_at: "2026-07-01T00:00:00Z".into(),
            completed_at: completed_at.map(str::to_string),
            archived_at: archived_at.map(str::to_string),
            group_id: None,
            notes: None,
            suspended_at: None,
            is_priority: None,
        }
    }

    #[test]
    fn parent_time_recomputes_after_delete_and_propagates_to_grandparent() {
        let settings = Settings { auto_sync_end: true, ..Settings::default() };
        let mut root = todo("root", None, false, None, None);
        root.end_time = Some("2026-11-20T00:00:00Z".into());
        let mut parent = todo("parent", Some("root"), false, None, None);
        parent.end_time = root.end_time.clone();
        let mut child = todo("remaining", Some("parent"), false, None, None);
        child.end_time = Some("2026-11-10T00:00:00Z".into());
        let mut value = data(vec![root, parent, child]);
        recompute_parent_times(&mut value, &settings, "parent".into());
        assert_eq!(value.todos[0].end_time, value.todos[2].end_time);
        assert_eq!(value.todos[1].end_time, value.todos[2].end_time);
    }

    #[test]
    fn empty_child_times_preserve_parent_and_disabled_sync_does_not_change_it() {
        let mut parent = todo("parent", None, false, None, None);
        parent.end_time = Some("2026-11-20T00:00:00Z".into());
        let original = parent.end_time.clone();
        let mut value = data(vec![parent, todo("child", Some("parent"), false, None, None)]);
        recompute_parent_times(&mut value, &Settings::default(), "parent".into());
        assert_eq!(value.todos[0].end_time, original);
        value.todos[1].end_time = Some("2026-11-10T00:00:00Z".into());
        let settings = Settings { auto_sync_end: false, auto_sync_start: false, ..Settings::default() };
        recompute_parent_times(&mut value, &settings, "parent".into());
        assert_eq!(value.todos[0].end_time, original);
    }

    #[test]
    fn editing_parent_recomputes_both_branches_and_rejects_cycles() {
        let mut old = todo("old", None, false, None, None);
        old.end_time = Some("2026-11-20T00:00:00Z".into());
        let mut new = todo("new", None, false, None, None);
        new.end_time = Some("2026-11-01T00:00:00Z".into());
        let mut moving = todo("moving", Some("old"), false, None, None);
        moving.end_time = old.end_time.clone();
        let mut remaining = todo("remaining", Some("old"), false, None, None);
        remaining.end_time = Some("2026-11-10T00:00:00Z".into());
        let mut value = data(vec![old, new, moving, remaining]);
        apply_todo_patch(&mut value, &Settings::default(), "moving", json!({"parentId":"new"})).unwrap();
        assert_eq!(value.todos[0].end_time.as_deref(), Some("2026-11-10T00:00:00Z"));
        assert_eq!(value.todos[1].end_time.as_deref(), Some("2026-11-20T00:00:00Z"));
        assert!(apply_todo_patch(&mut value, &Settings::default(), "new", json!({"parentId":"moving"})).is_err());
    }

    #[test]
    fn parent_time_compares_actual_instants_across_offsets() {
        let mut early = todo("early", Some("parent"), false, None, None);
        early.end_time = Some("2026-11-10T10:00:00+08:00".into());
        let mut late = todo("late", Some("parent"), false, None, None);
        late.end_time = Some("2026-11-10T09:00:00Z".into());
        let mut value = data(vec![todo("parent", None, false, None, None), early, late]);
        recompute_parent_times(&mut value, &Settings::default(), "parent".into());
        assert_eq!(value.todos[0].end_time, value.todos[2].end_time);
    }

    #[test]
    fn import_rejects_duplicate_missing_parent_cycle_and_invalid_group_before_writes() {
        let dir = TestDir::new();
        save_data_checked(&dir.file("todos.json"), &data(vec![])).unwrap();
        let original = fs::read(dir.file("todos.json")).unwrap();
        let mut bad_group = todo("a", None, false, None, None);
        bad_group.group_id = Some("missing".into());
        let invalid = vec![
            data(vec![todo("a", None, false, None, None), todo("a", None, false, None, None)]),
            data(vec![todo("a", Some("missing"), false, None, None)]),
            data(vec![todo("a", Some("b"), false, None, None), todo("b", Some("a"), false, None, None)]),
            data(vec![bad_group]),
        ];
        for value in invalid {
            assert!(import_tasks(&dir.0, value).is_err());
            assert_eq!(fs::read(dir.file("todos.json")).unwrap(), original);
            assert!(!dir.file("backups").exists());
        }
    }

    #[test]
    fn task_import_migrates_legacy_records_preserves_settings_and_keeps_backup() {
        let dir = TestDir::new();
        fs::write(dir.file("settings.json"), r#"{"theme":"dark"}"#).unwrap();
        let before = fs::read(dir.file("settings.json")).unwrap();
        let mut legacy = data(vec![todo("old", None, true, None, None)]);
        legacy.version = "1".into();
        let result = import_tasks(&dir.0, legacy).unwrap();
        assert_eq!(result.version, "2");
        assert!(result.todos[0].completed_at.is_some());
        assert_eq!(fs::read(dir.file("settings.json")).unwrap(), before);
        assert_eq!(fs::read_dir(dir.file("backups")).unwrap().count(), 1);
    }

    #[test]
    fn memo_position_uses_physical_coordinates_and_supports_legacy_scaled_positions() {
        let monitors = [(0, 0, 1920, 1080, 1.0), (1920, 0, 2560, 1440, 1.5)];
        assert_eq!(memo_position_on_screen(&[3000, 100, 280, 480], true, &monitors), Some((3000, 100)));
        assert_eq!(memo_position_on_screen(&[2000, 100, 280, 480], false, &monitors), Some((3000, 150)));
        assert_eq!(memo_position_on_screen(&[5000, 0, 280, 480], true, &monitors), None);
        assert_eq!(memo_position_on_screen(&[3000, 100, 280, 480], true, &monitors[..1]), None);
    }

    fn data(todos: Vec<Todo>) -> Data {
        Data {
            version: DATA_VERSION.into(),
            updated_at: "2026-07-01T00:00:00Z".into(),
            todos,
            groups: vec![],
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

        let mut settings = load_settings(&file).unwrap();
        assert!(settings.auto_archive);
        assert_eq!(settings.archive_after_days, 7);
        settings.auto_archive = false;
        settings.archive_after_days = 14;
        save_settings(&file, &settings).unwrap();

        let reloaded = load_settings(&file).unwrap();
        assert!(!reloaded.auto_archive);
        assert_eq!(reloaded.archive_after_days, 14);
        let _ = fs::remove_file(file);
    }
}
