const { invoke } = window.__TAURI__.core;
const dialog = window.__TAURI__.dialog;

function tauriErrMsg(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}
window.__tauriErrMsg = tauriErrMsg;

const API = {
  // ===== Todos =====
  async list() {
    return await invoke('list_todos');
  },
  async create(body) {
    const { title, parentId, startTime, endTime, notes, groupId } = body;
    return await invoke('create_todo', { title, parentId, startTime, endTime, notes: notes ?? null, groupId: groupId ?? null });
  },
  async update(id, body) {
    return await invoke('update_todo', { id, patch: body });
  },
  async moveTodo(id, parentId, index) {
    return await invoke('move_todo', { id, parentId, index });
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
  // saveSettings 传整个 settings 对象,后端按 patch merge 即等于覆盖
  async saveSettings(settings) {
    return await invoke('update_settings', { patch: settings });
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
  async createGroup(name) { return await invoke('create_group', { name }); },
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
  async importDataFromPath(path) {
    return await invoke('import_data', { path });
  },
  async openDataDir() {
    return await invoke('open_data_dir');
  },
  async getDataDir() {
    return await invoke('get_data_dir');
  },
  async appVersion() {
    return await invoke('app_version');
  },
  async openExternal(url) {
    return await invoke('open_external', { url });
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
