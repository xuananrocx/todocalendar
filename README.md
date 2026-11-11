# TodoCalendar

> 极简待办日历
>
> A minimalist local-first desktop calendar + todo app.

<p align="center">
  <img src="docs/screenshots/main.png" width="65%" alt="主界面">
</p>

## 核心功能

### 📅 日历

- 月视图,可选农历 / 周数
- 点击日期查看当日详情
- 跨日任务可视化(开始 / 进行中 / 截止)
- 当天截止高亮警示

<p align="center"><img src="docs/screenshots/calendar.png" width="65%" alt="日历视图"></p>

### ✅ 待办

- 无限嵌套子任务
- 拖拽排序 / 自动按截止时间
- 批量创建(粘贴缩进文本)
- 自定义分组(Default + 自定义)
- 时间精度切换(日期 / 具体时间)
- 编号样式(WBS / 简单)

<p align="center"><img src="docs/screenshots/list.png" width="65%" alt="待办列表"></p>

### 🎨 个性化

- 浅 / 深 / 跟随系统 三种主题
- 9 种主题色(纯色 + 渐变)
- 字体大小(小 / 中 / 较大 / 大)
- 字体颜色偏好(默认 + 3 暖色预设)
- 紧凑模式
- 下拉框、日期/时间面板、校验及确认弹窗统一跟随主题，支持键盘操作
- 日期面板右侧展开时间，小时/分钟支持滚轮、拖动、滑动选择及手动输入；独立时间选择器保持一致

<p align="center"><img src="docs/screenshots/settings.png" width="65%" alt="设置面板"></p>

### 🌙 深色模式

<p align="center"><img src="docs/screenshots/dark1.png" width="65%" alt="深色模式"></p>

### 📦 归档

- 完成后自动归档(可配置天数)
- 历史记录按树形展示
- 时间范围批量删除(二次确认)
- 一键恢复

## 下载

前往 [Releases](../../releases) 下载 Windows 安装包(NSIS `.exe`)。

支持 Windows 10 / 11。

## 隐私

任务、备忘录和设置存于本地，无账号、无遥测。节假日更新会请求 GitHub raw / jsDelivr；手动检查版本会请求 GitHub Releases API。

- Windows: `%APPDATA%\com.todocalendar.app\`
  - `todos.json` — 待办与分组
  - `settings.json` — 偏好设置
  - `memos.json` — 备忘录
  - `backups/` — 自动备份与导入、恢复前的副本

数据 JSON 导出 / 导入包含待办、分组、归档和备忘录，不包含设置，合并为一个文件；本地仍分别保存 todos.json 和 memos.json。兼容旧版任务 JSON，导入旧版文件时保留备忘录和设置。导入前验证所有内容并明确提示覆盖范围，保存恢复副本；多文件写入失败会回滚，异常中断后下次数据操作前恢复原数据。

设置 → 数据中可保存或恢复完整备份，包含任务、备忘录和设置。恢复会覆盖这三项；写入失败会回滚，中断后在下一次数据操作前恢复原数据。原文件损坏时恢复前另保留原始字节副本。

每日自动备份默认关闭。开启后，在每天第一次数据修改前保存完整快照；默认保留 5 份自动备份，可设为 1–100 份。导入、恢复前的副本不参与自动轮换。备份失败时该次修改不会继续。

## 待办提醒

设置 → 提醒可配置全局提醒（默认开启，开始与截止均提醒，弹窗与 Windows 通知均开启，弹窗置顶），选择开始、截止或两者，以及倒计时弹窗和 Windows 系统通知。仅日期待办默认当天 09:30 提醒一次，可配置次数与间隔，计划不能跨到次日；具体时间默认开始前 10 分钟、截止前 30 分钟提醒。日期输入精度自动保存，旧数据本地零点按仅日期兼容；实际午夜任务请编辑并保留具体时间。

「已知晓」结束该事项对应开始/截止时间的本轮提醒，不完成待办；「稍后提醒」默认延后 10 分钟，不修改待办时间。处理方式可选关闭或已知晓后记为处理，或成功显示后结束当前批次。多个错过批次合并；应用启动后汇总所有仍有效的未处理提醒，完成、归档、删除、搁置待办不参与。父子任务分别参与并显示层级路径。关闭主窗口退出应用，不增加托盘或系统唤醒任务。

提示音默认「轻敲提示」，音量 50%（可选「无」关闭），可选 Windows 系统默认、轻敲提示、清亮三音。自带音效为本地合成 WAV，音量单独控制；同批次两种渠道只响一次。系统通知受 Windows 权限与勿扰设置影响；自带音效在 Windows 通知状态查询失败或报告不允许打扰时静音。系统接受通知发送不代表用户实际看到。

提醒处理记录及弹窗位置保存在本机 `reminder-state.json`，不随数据导出或完整备份迁移；完整备份包含提醒设置和任务精度。导入/恢复后按新内容重建计划，并保留本机同一任务、同一时间的已处理记录，避免反复提示。不同数据目录使用独立通知身份和单实例锁。首次发送系统通知时注册当前用户的通知名称及开始菜单快捷方式；无需管理员权限。

## 开发

依赖:[Node.js](https://nodejs.org/) 18+、[Rust](https://www.rust-lang.org/tools/install) stable、Windows SDK。

```bash
# 启动开发模式
npx --yes @tauri-apps/cli@2.11.4 dev --config tauri.dev.conf.json

# 构建 release 安装包
npx --yes @tauri-apps/cli@2.11.4 build --bundles nsis
# 输出: src-tauri/target/release/bundle/
```

开发版使用 `com.todocalendar.dev` 独立数据目录，不迁入旧正式数据。Debug 构建会拒绝访问正式标识 `com.todocalendar.app`。

需要全新空数据的人工验证环境时，在仓库目录执行 `powershell -ExecutionPolicy Bypass -File scripts/start-review.ps1`。每次会创建独立的 `com.todocalendar.dev.review-*` 数据目录，显示“修复验证版”窗口，并输出日志和数据目录位置；不读取安装版或已有开发版数据。

验证命令：`cargo test --manifest-path src-tauri/Cargo.toml --locked --offline`、`node --test scripts/storage-errors.test.cjs scripts/ui-controls.test.cjs`。

## 反馈

[新建 Issue](../../issues/new) 报 Bug 或提建议。

## License

[MIT](LICENSE)
