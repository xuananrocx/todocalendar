use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Period {
    pub start: String,
    pub end: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Schedule {
    pub enabled: bool,
    pub day_mode: String,
    pub weekdays: Vec<u32>,
    pub periods: Vec<Period>,
}
impl Default for Schedule {
    fn default() -> Self {
        Self {
            enabled: true,
            day_mode: "workday".into(),
            weekdays: vec![1, 2, 3, 4, 5],
            periods: vec![
                Period { start: "09:00".into(), end: "11:35".into() },
                Period { start: "13:30".into(), end: "18:00".into() },
            ],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Window {
    date: NaiveDate,
    start: u32,
    end: u32,
}
impl Window {
    pub fn unrestricted() -> Self { Self { date: NaiveDate::MIN, start: 0, end: 1440 } }
}

fn minute(value: &str) -> Option<u32> {
    let bytes = value.as_bytes();
    if bytes.len() != 5 || bytes[2] != b':' || ![0, 1, 3, 4].into_iter().all(|i| bytes[i].is_ascii_digit()) { return None; }
    let hour: u32 = value[..2].parse().ok()?;
    let minutes: u32 = value[3..].parse().ok()?;
    (hour < 24 && minutes < 60).then_some(hour * 60 + minutes)
}

impl Schedule {
    pub fn validate(&self) -> Result<(), String> {
        if !["workday", "everyday", "custom"].contains(&self.day_mode.as_str()) { return Err("无效的休息提醒日期".into()); }
        if self.weekdays.iter().any(|d| !(1..=7).contains(d))
            || self.weekdays.iter().collect::<std::collections::HashSet<_>>().len() != self.weekdays.len()
            || (self.day_mode == "custom" && self.weekdays.is_empty()) { return Err("请至少选择一个提醒日期，且日期不能重复".into()); }
        if self.periods.is_empty() || self.periods.len() > 8 { return Err("提醒时段须为 1–8 段".into()); }
        let mut ranges = Vec::new();
        for period in &self.periods {
            let start = minute(&period.start).ok_or("提醒时段开始时间格式无效")?;
            let end = minute(&period.end).ok_or("提醒时段结束时间格式无效")?;
            if start >= end { return Err("提醒时段的结束时间须晚于开始时间，不支持单段跨午夜".into()); }
            ranges.push((start, end));
        }
        ranges.sort_unstable();
        if ranges.windows(2).any(|r| r[0].1 > r[1].0) { return Err("提醒时段不能重叠".into()); }
        Ok(())
    }
    fn includes_day(&self, date: NaiveDate, holidays: &super::super::HolidaysData) -> bool {
        match self.day_mode.as_str() {
            "everyday" => true,
            "custom" => self.weekdays.contains(&date.weekday().number_from_monday()),
            _ => {
                let key = date.format("%Y-%m-%d").to_string();
                holidays.days.iter().find(|day| day.date == key)
                    .map(|day| !day.is_off_day)
                    .unwrap_or(date.weekday().number_from_monday() <= 5)
            }
        }
    }
    pub(super) fn window_at(&self, local: NaiveDateTime, holidays: &super::super::HolidaysData) -> Option<Window> {
        if !self.enabled { return Some(Window::unrestricted()); }
        if !self.includes_day(local.date(), holidays) { return None; }
        let now = local.hour() * 60 + local.minute();
        self.periods.iter().find_map(|p| {
            let (start, end) = (minute(&p.start)?, minute(&p.end)?);
            (start <= now && now < end).then_some(Window { date: local.date(), start, end })
        })
    }
    pub(super) fn next_start(&self, local: NaiveDateTime, holidays: &super::super::HolidaysData) -> Option<String> {
        if !self.enabled { return None; }
        (0..370).filter_map(|offset| {
            let date = local.date().checked_add_signed(Duration::days(offset))?;
            if !self.includes_day(date, holidays) { return None; }
            self.periods.iter().filter_map(|p| {
                let start = minute(&p.start)?;
                date.and_hms_opt(start / 60, start % 60, 0).filter(|time| *time > local)
            }).min()
        }).next().map(|time| time.format("%Y-%m-%d %H:%M").to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn dt(value: &str) -> NaiveDateTime { NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap() }
    #[test]
    fn workdays_follow_holidays_and_makeup_days_with_weekday_fallback() {
        let holidays = super::super::super::HolidaysData { days: vec![
            super::super::super::HolidayDay { date: "2026-11-11".into(), name: "test".into(), is_off_day: true },
            super::super::super::HolidayDay { date: "2026-11-14".into(), name: "test".into(), is_off_day: false },
        ] };
        let c = Schedule::default();
        assert!(c.window_at(dt("2026-11-11 10:00:00"), &holidays).is_none());
        assert!(c.window_at(dt("2026-11-14 10:00:00"), &holidays).is_some());
        assert!(c.window_at(dt("2026-11-12 10:00:00"), &holidays).is_some());
        assert!(c.window_at(dt("2026-11-15 10:00:00"), &holidays).is_none());
    }
    #[test]
    fn exact_boundaries_next_start_weekends_and_custom_days() {
        let holidays = super::super::super::HolidaysData::default();
        let mut c = Schedule::default();
        for time in ["09:00:00", "11:34:59", "13:30:00", "17:59:59"] { assert!(c.window_at(dt(&format!("2026-11-11 {time}")), &holidays).is_some()); }
        for time in ["08:59:59", "11:35:00", "13:29:59", "18:00:00"] { assert!(c.window_at(dt(&format!("2026-11-11 {time}")), &holidays).is_none()); }
        assert_eq!(c.next_start(dt("2026-11-11 11:35:00"), &holidays).as_deref(), Some("2026-11-11 13:30"));
        assert_eq!(c.next_start(dt("2026-11-13 18:00:00"), &holidays).as_deref(), Some("2026-11-16 09:00"));
        c.day_mode = "custom".into(); c.weekdays = vec![7];
        assert!(c.window_at(dt("2026-11-15 10:00:00"), &holidays).is_some());
        c.day_mode = "everyday".into();
        assert!(c.window_at(dt("2026-11-14 10:00:00"), &holidays).is_some());
        c.enabled = false;
        assert_eq!(c.window_at(dt("2026-11-15 01:00:00"), &holidays), Some(Window::unrestricted()));
    }
    #[test]
    fn rejects_invalid_empty_overlapping_ranges_and_accepts_adjacent_ranges() {
        let mut c = Schedule::default();
        assert!(c.validate().is_ok());
        for bad in ["9:00", "24:00", "09:60", "aa:bb", "💡:"] { c.periods[0].start = bad.into(); assert!(c.validate().is_err()); }
        c = Schedule::default(); c.periods[1].start = "11:00".into(); assert!(c.validate().is_err());
        c.periods[1].start = "11:35".into(); assert!(c.validate().is_ok());
        c.periods[0].end = "09:00".into(); assert!(c.validate().is_err());
        c = Schedule::default(); c.day_mode = "custom".into(); c.weekdays.clear(); assert!(c.validate().is_err());
        c = Schedule::default(); c.periods.clear(); assert!(c.validate().is_err());
    }
}
