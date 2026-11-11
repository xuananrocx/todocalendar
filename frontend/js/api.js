const { invoke } = window.__TAURI__.core;
const dialog = window.__TAURI__.dialog;

function tauriErrMsg(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
window.__tauriErrMsg = tauriErrMsg;

// Startup recovery also works before Main's events are bound.
window.showStorageStartupError = function (error) {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.style.zIndex = '19000'; // Keep shared confirmation dialogs above recovery.
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.padding = '24px';
  const title = document.createElement('h3');
  title.textContent = '无法加载设置';
  const message = document.createElement('p');
  message.style.whiteSpace = 'pre-wrap';
  message.textContent = tauriErrMsg(error) + '\n原文件未被重置。请检查文件或从备份恢复，然后重试。';
  const retry = document.createElement('button');
  retry.className = 'btn primary';
  retry.textContent = '重新加载';
  retry.onclick = () => location.reload();
  const open = document.createElement('button');
  open.className = 'btn';
  open.textContent = '打开数据目录';
  open.onclick = async () => {
    try { await API.openDataDir(); }
    catch (e) { message.textContent = tauriErrMsg(e); }
  };
  const restore = document.createElement('button');
  restore.className = 'btn';
  restore.textContent = '从完整备份恢复';
  restore.onclick = async () => {
    try {
      const path = await API.pickOpenPath();
      if (!path) return;
      if (!await AppDialog.confirm({ message: '将覆盖任务、备忘录和设置，恢复前会保留当前文件副本。确定继续？', title: '恢复完整备份', danger: true, confirmText: '恢复并覆盖' })) return;
      await API.restoreBackup(path);
      location.reload();
    } catch (e) { message.textContent = tauriErrMsg(e); }
  };
  modal.append(title, message, open, restore, retry);
  mask.append(modal);
  document.body.append(mask);
};

const API = {
  // ===== Todos =====
  async list() {
    return await invoke('list_todos');
  },
  async create(body) {
    const { title, parentId, startTime, endTime, startHasTime, endHasTime, notes, groupId } = body;
    return await invoke('create_todo', { title, parentId, startTime, endTime, startHasTime: startHasTime ?? null, endHasTime: endHasTime ?? null, notes: notes ?? null, groupId: groupId ?? null });
  },
  async update(id, body) {
    return await invoke('update_todo', { id, patch: body });
  },
  async moveTodo(id, parentId, index, groupId) {
    return await invoke('move_todo', { id, parentId, index, groupId: groupId ?? null, changeGroup: groupId !== undefined });
  },
  async remove(id) {
    return await invoke('delete_todo', { id });
  },
  // 递归把 id 及所有后代 done 同步(父勾选→子全选)
  async setDoneRecursive(id, done) {
    return await invoke('set_todo_done_recursive', { id, done });
  },
  async setAllExpanded(expanded) {
    return await invoke('set_todos_expanded', { expanded });
  },
  async listArchived() {
    return await invoke('list_archived_todos');
  },
  async archiveDue() {
    return await invoke('archive_due_todos');
  },
  async archiveNow(id) {
    return await invoke('archive_todo', { id });
  },
  async restoreArchived(id) {
    return await invoke('restore_archived_todo', { id });
  },
  async deleteArchived(id) {
    return await invoke('delete_archived_todo', { id });
  },

  // ===== Settings =====
  // main.js 用 getSettings / saveSettings / resetSettings 命名
  async getSettings() {
    return await invoke('list_settings');
  },
  // 兼容别名；仅提交本次变更字段，避免覆盖其他窗口的新设置
  async saveSettings(patch) {
    return await invoke('update_settings', { patch });
  },
  async resetSettings() {
    return await invoke('reset_settings');
  },
  // 保留旧命名作别名,防其他地方调用
  async listSettings() { return await this.getSettings(); },
  async updateSettings(patch) { return await invoke('update_settings', { patch }); },
  async setAppIcon(name) { return await invoke('set_app_icon', { name }); },

  // ===== Groups =====
  async listGroups() { return await invoke('list_groups'); },
  async createGroup(name, color) { return await invoke('create_group', { name, color: color ?? null }); },
  async setGroupColor(id, color) { return await invoke('set_group_color', { id, color: color ?? null }); },
  async renameGroup(id, name) { return await invoke('rename_group', { id, name }); },
  async deleteGroup(id) { return await invoke('delete_group', { id }); },
  async reorderGroups(ids) { return await invoke('reorder_groups', { ids }); },
  async setTodoGroup(id, groupId) { return await invoke('set_todo_group', { id, groupId }); },
  async moveToGroup(id, groupId) { return await invoke('move_todo_to_group', { id, groupId }); },

  // ===== Data =====
  async listAll() {
    return await invoke('export_all_data');
  },
  // 导出:返回当前完整 Data 对象(含归档项)
  async exportJson() {
    return await this.listAll();
  },
  async exportDataToPath(path) {
    return await invoke('export_data', { path });
  },
  // 导入:接收 Data 对象,直接覆盖本地文件
  async importJson(data) {
    return await invoke('replace_data', { data });
  },
  async inspectImport(path) {
    return await invoke('inspect_import', { path });
  },
  async importDataFromPath(path, expectedScope) {
    return await invoke('import_data', { path, expectedScope });
  },
  async openDataDir() {
    return await invoke('open_data_dir');
  },
  async exportBackup(path) { return await invoke('export_backup', { path }); },
  async restoreBackup(path) { return await invoke('restore_backup', { path }); },
  async getDataDir() {
    return await invoke('get_data_dir');
  },
  async appVersion() {
    return await invoke('app_version');
  },
  async openExternal(url) {
    return await invoke('open_external', { url });
  },

  // ===== Memos(备忘录) =====
  async listMemos() {
    return await invoke('list_memos');
  },
  async saveMemoEntry(entry) {
    return await invoke('save_memo_entry', { entry });
  },
  async deleteMemoEntry(id) {
    return await invoke('delete_memo_entry', { id });
  },
  async reorderMemos(ids) {
    return await invoke('reorder_memos', { ids });
  },
  async memoWinToggle() {
    return await invoke('memo_win_toggle');
  },
  async memoWinHideWindow() {
    return await invoke('memo_win_hide_window');
  },

  // ===== Dialog helpers(暂未使用,保留) =====
  async pickSavePath(defaultName) {
    return await dialog.save({
      defaultPath: defaultName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
  },
  async pickOpenPath() {
    const path = await dialog.open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    return path || null;
  },
};
