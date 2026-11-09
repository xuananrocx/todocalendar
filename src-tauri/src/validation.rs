use super::{Data, MemoData};
use std::collections::{HashMap, HashSet};

pub fn data(value: &Data) -> Result<(), String> {
    if !["1", "2"].contains(&value.version.as_str()) {
        return Err(format!("不支持的任务数据版本：{}", value.version));
    }
    let mut groups = HashSet::new();
    for group in &value.groups {
        if group.id.trim().is_empty() || !groups.insert(group.id.as_str()) {
            return Err("分组 ID 为空或重复".into());
        }
    }
    let mut todos = HashMap::new();
    for todo in &value.todos {
        if todo.id.trim().is_empty() || todos.insert(todo.id.as_str(), todo).is_some() {
            return Err("任务 ID 为空或重复".into());
        }
        if let Some(group) = &todo.group_id {
            if !groups.contains(group.as_str()) {
                return Err(format!("任务 {} 引用了不存在的分组 {}", todo.id, group));
            }
        }
        for time in [&todo.start_time, &todo.end_time].into_iter().flatten() {
            if chrono::DateTime::parse_from_rfc3339(time).is_err()
                && chrono::NaiveDate::parse_from_str(time, "%Y-%m-%d").is_err()
            {
                return Err(format!("任务 {} 的时间格式无效：{}", todo.id, time));
            }
        }
    }
    // Walk parent chains iteratively; accepted deep trees must not overflow the stack.
    let mut checked = HashSet::new();
    for id in todos.keys() {
        let mut path = HashSet::new();
        let mut current = *id;
        loop {
            if checked.contains(current) {
                break;
            }
            if !path.insert(current) {
                return Err(format!("任务 {} 存在循环父子关系", id));
            }
            let todo = todos
                .get(current)
                .ok_or_else(|| format!("任务 {} 的父节点 {} 不存在", id, current))?;
            match todo.parent_id.as_deref() {
                Some(parent) => current = parent,
                None => break,
            }
        }
        checked.extend(path);
    }
    Ok(())
}

pub fn memos(value: &MemoData) -> Result<(), String> {
    if value.version != "1" {
        return Err("不支持的备忘录数据版本".into());
    }
    let mut ids = HashSet::new();
    for entry in &value.entries {
        if entry.id.trim().is_empty() || !ids.insert(&entry.id) {
            return Err("备忘录 ID 为空或重复".into());
        }
        if entry.title.trim().is_empty() {
            return Err("备忘录标题不能为空".into());
        }
    }
    Ok(())
}
