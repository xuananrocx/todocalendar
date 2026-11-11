# TodoCalendar 项目交接文档

> **休息设置与独立体验调整（xuanan/dev-0.4.56）**
> 卡片顺序调整为休息节奏、提醒方式、提醒时段、声音与体验。增加 `rest.volume`（0–100，默认 50）和独立 `rest_sound_preview` 试听命令，实际提醒播放使用配置音量；无声音时禁用试听。体验按钮改为「休息效果立即体验」，与声音配置增加留白和分隔。
> 体验运行在独立临时 Runtime，正式计时在后台继续，体验自然结束、取消或长按退出均不重置正式截止时刻；正式提醒在体验期间到点时保留待展示，退出后展示，仍遵守原有时段边界。已有正式提醒待处理或休息中不再开启体验。设置页 `rest_snapshot({scheduled:true})` 读取正式计时，其余调用读取当前展示的会话；结束体验切换新的 generation，拒绝旧窗口操作。普通体验显示「结束体验」，不提供稍后提醒；强制体验继续长按 2 秒退出。
> 文案轮换统一为 `clamp(休息分钟数 × 18 / 5, 10, 30)` 秒，5 分钟为 18 秒；无放回随机、多屏同步和长按不受轮换影响的逻辑保留。90 项 Rust、59 项前端回归通过，包含独立体验自然结束/退出保留正式截止时刻、到点延后展示、时段切换、旧会话操作拒绝、音量兼容与边界。浏览器已验证卡片顺序、音量保存及试听命令参数、无声音禁用试听、体验入口和状态显示；实际音效与桌面体验可在隔离开发版人工验证。
> 暖白方案仅作预览；用户最终确认保留浅色全屏休息页的鼠尾草白背景 `#F2F5EF`。

> **休息提醒时段（xuanan/dev-0.4.56）**
> 设置 → 提醒 → 休息提醒新增「提醒时段」卡片，默认限制在工作日 09:00–11:35、13:30–18:00。工作日复用应用节假日与调休数据，未覆盖日期按周一至周五判断；另支持每天、自定义星期以及关闭时段限制。可设置 1–8 段，前后端校验时间格式、顺序、重叠与空选择；时间选择复用主题化滚轮控件，说明收进「？」。
> 每段独立重新计算完整提醒间隔，不带入午休前剩余时间。时段结束时取消未处理的普通提醒、强制预告和稍后提醒；已经开始的休息继续至结束，长按退出不会被时段切换打断。「立即体验」可在时段外或总开关关闭时使用。时段外显示下一次开始计时的时间，不补提醒。原有锁屏、休眠和修改配置重置间隔的行为保留。
> `rest.schedule` 随设置与完整备份保存，旧设置自动补齐默认值；运行时增加 `outside` 状态与时段标识，日间切换、跨日和调休变更统一重算。验证：85 项 Rust 测试、57 项前端测试通过；实际前端配独立浏览器桥接验证日期切换、时段增删、无效时间提示与草稿修正、浅/深主题及 800×600 时段行无横向溢出。浏览器夹具不等同于原生定时验收，跨真实时段、锁屏及多屏仍可在隔离开发版人工体验。开发版沿用 `com.todocalendar.dev.review-rest-feature`，不读取安装版数据。

> **更新说明与定期检查（xuanan/dev-0.4.56）**
> 展示后按反馈将更新弹窗宽度调整为 360，高度仍为 520；内边距同步收窄，版本数量单独一行，头尾固定、内容滚动。
> 保留进入帮助自动检查及关闭后留在帮助、前往下载关闭帮助并打开浏览器的行为；发现新版改为 360×520 应用内弹窗，头尾固定、中间滚动，按版本从新到旧展示当前版本之后至最新版的全部正式发布说明。GitHub Releases 分页读取，过滤草稿/预发布/重复/范围外版本；说明支持安全的段落、标题、列表、链接、强调和代码，不执行原始 HTML、不加载远程图片。部分获取失败保留已获取说明并支持重试。
> 通用设置新增 `appAutoUpdate`，默认开启；首次及距上次完整成功检查满 7 天时自动检查，长时间运行亦生效；进入帮助始终检查且不受开关/周期限制。失败静默延后 1 小时重试，同一版本自动弹出间隔至少 7 天；同次并发检查合并，关闭弹窗后未结束的请求不会重新打开它。
> 检查记录及待展示说明保存在当前 WebView 的 `localStorage`（`todocalendar.updates.v1`），不混入待办导出或完整备份；当前版本变化时清除旧检查记录。后台检查结果等待主窗口可见且有焦点、无编辑/其他弹窗/休息且空闲后展示；未展示结果重启后保留，关闭自动检查清除自动待展示项。设置开关按正常设置流程持久化及备份。
> 验证：77 项 Rust 测试通过；新增 14 项更新功能测试与既有前端回归合计 52 项通过。浏览器使用实际项目页面与独立桥接夹具，验证进入帮助自动弹出、关闭返回、下载目标、自动检查、关闭开关后帮助仍检查、浅/深主题、部分获取失败重试、最新版与失败不额外弹窗、列表滚动及 Tab/Escape；实测弹窗 640×520，内容滚动到底部时底栏位置不变。开发版继续使用 `com.todocalendar.dev.review-rest-feature`，未读写安装版数据。

> **独立休息提醒（xuanan/dev-0.4.56）**
> 强制预告中的「稍后 5 分钟」与「跳过此次休息 →」统一放在同一行。
> 强制休息预告新增「稍后 5 分钟」，收起后延后 300 秒，再重新进行配置时长的预告；已进入全屏仍通过长按退出。77 项 Rust 测试及休息页 4 项测试通过，覆盖预告延后、过期操作拒绝及再次进入休息。
> 全屏覆盖修复：原实现使用外框位置＋内容尺寸，Windows 无边框阴影仍保留非客户区，175% 主屏内容左偏移 12px、100% 副屏 8px。覆盖窗口关闭阴影，先缩至目标显示器内再进入原生无边框全屏；预告窗口保留阴影。退出先恢复非全屏，再隐藏，避免 Windows 恢复窗口位置时重新显示小窗。隔离原生实例实测：双屏内容区域分别严格等于 (0,0) 2560×1600、(2560,0) 1920×1080；退出无残留，再次进入仅主屏模式与退出均通过。76 项 Rust 测试通过。
> 休息设置说明收进各项「？」浮层，支持悬停、点击、聚焦及 Escape/Tab，运行状态与错误直接显示。长按退出前后端统一为 2 秒。取消手动换句按钮；后端按 `clamp(休息秒数 / 25, 8, 30)` 秒自动轮换（5 分钟为 12 秒），仅休息阶段运行，保持无放回随机与多屏同步，不改变会话代号或中断长按。76 项 Rust、38 项前端回归通过，浏览器已检查提示浮层和键盘焦点。
> 强制休息提前提示时间改为 `rest.warningSeconds`，默认 10 秒，可配 1–300 秒，仅强制模式显示配置项；旧配置自动补默认值。预告右上按钮改为「关闭弹窗」，只收起预告，倒计时照常继续。75 项 Rust 测试通过，覆盖自定义提示时长、旧配置兼容与边界校验。
> 设置入口整合：左侧只保留「提醒」，右侧「待办提醒 / 休息提醒」页签切换。两个功能仍独立配置；当前子页签在本次会话中记忆，保存后重绘保持子页签和滚动位置，方向键/Home/End 可切换。旧 rest 入口映射到提醒内的休息子页。38 项前端回归通过。
> 预告弹窗增加居中的「跳过此次休息 →」及右上关闭：关闭仅隐藏预告，不取消到点休息；跳过重置下一次间隔。普通提醒跳过入口位于右上。文案由后端维护每次休息的随机无放回池，16 条全部展示后重建，跨池边界不连续重复；多窗口共用同一轮换记录。74 项 Rust 与休息页 4 项前端测试通过，420×300 浏览器检查两种弹窗排版。
> 设置新增「休息提醒」，默认关闭、间隔 45 分钟、休息 5 分钟、普通模式、全部显示器、无声音。普通提醒可开始/稍后 5 分钟/跳过；强制模式提前 30 秒提示，之后全屏。休息页为不带边框的置顶窗口，按显示器物理尺寸覆盖（含任务栏），可配置仅主屏；不锁定 Windows。16 条随机文案不连续重复，已将程序员限定语改为「事情忙不完，休息不能欠」。
> `rest.rs` 管理内存计时与窗口，进程重启不补提醒；Windows 输入桌面不可用（锁屏/安全桌面）或调度中断超过 10 秒后重新计时，修改休息配置也重置计时。前端只展示后端倒计时，紧急退出须同一窗口持续长按 3 秒，失焦/松手撤销，后端校验会话代号和持有时长。窗口初始化成功后才显示；热插拔时重新枚举显示器。进入休息与待办提醒投递串行，休息中暂缓投递，结束后重新汇总。
> 配置位于 settings.json 的 rest 对象，完整备份随设置保存并校验；运行状态不落盘、不纳入普通数据导出。`rest-window.test.cjs` 覆盖长按提前松手、异步应答、失焦、新会话及普通/强制页面切换。真实多屏、锁屏/休眠和任务栏覆盖仍需 Windows 人工验收。开发验证使用独立标识 `com.todocalendar.dev.review-rest-feature`，不读取安装版数据。

> 设置下拉菜单已移除导入/导出快捷入口，功能统一从「更多设置 → 数据」进入。

> **逾期排序与文字强调（xuanan/dev-0.4.56）**
> 截止状态文字加深为浅色 `#c84635`、深色 `#f07862`，胶囊浅底与今日橙色保留。Rust `Item::is_overdue` 统一调度快照和系统通知的逾期判断；顺序为逾期截止、未逾期截止、开始。逾期按显示精度换算时长降序：仅日期自然日数乘 86400，具体时间按秒，保证 1 天排在 17 小时前、25 小时后；未逾期日期按当天结束排序，同值按 key 稳定排序。
> 前端 `ReminderStatus.sort` 使用同样规则，每秒检测顺序变化并移动既有卡片，保留滚动位置与焦点，只在顺序改变时重新测量窗口，不触发提醒投递。66 项 Rust、34 项前端测试通过，涵盖逾期 1 秒、混合精度、跨天、时长交叉及到达截止点不重复投递。

> **仅日期状态与警示色（xuanan/dev-0.4.56）**
> 新增 `reminder-status.js`，日期按本地年月日映射到 UTC 日序比较，避免把提醒时刻当截止时刻及夏令时的 23/25 小时误差。当天显示今日开始/截止，过去显示已开始/已逾期 N 天；详情保留日期。截止胶囊与右侧状态共用局部主题变量：正常清亮橙色、逾期柔和珊瑚红，底色淡化；开始保持蓝色，包含深色主题。秒级刷新同步状态和胶囊，不重绘列表。
> Windows 单条状态和多条逾期数量由 `notification_text` 统一生成，调度保存文案变化标记，跨天或到达具体截止时刻时静默刷新，不新增批次/声音。62 项 Rust、30 项前端测试通过，浏览器合成数据验证浅色/深色及跨天状态与胶囊同步；系统通知中心外观仍需人工验收。

> **提醒跨批次汇总修复（xuanan/dev-0.4.56）**
> 调度通过 `Runtime::reconcile` 维护所有到期未处理条目，新增批次只用于发送/声音和投递记录；Windows 通知正文使用完整汇总。修改时间清理旧计划，新计划先后到点仍汇总；已知晓退出，稍后到期再加入。部分处理或计划撤回通过 `SetSuppressPopup` 静默更新同一通知，避免重复横幅/声音。弹窗刷新改为共享 Promise 与 pending 循环，刷新期间的新事件会补取最新状态，避免丢失更新。
> 回归：58 项 Rust、25 项前端测试通过，覆盖修改两条时间后分批归并、稍后/已知晓、显示即处理策略和并发刷新事件。独立临时标识与合成数据联调日志确认：原先两条退出后，先 `items=1 fresh=1`，再 `items=2 fresh=1`；弹窗渲染数量同步为 1、2。Windows API 接受发送，通知中心实际外观及点击仍需人工验收。

> **提醒窗口自适应（xuanan/dev-0.4.56）**
> 新增 `reminder-layout.js` 按前三条自然卡片高度计算内容区大小（160–520），不使用 flex 撑开的列表高度。`reminder_resize` 只接受提醒窗口调用，统一按当前显示器工作区、DPI 和窗口边框避让；布局互斥锁避免显示与调整尺寸并发覆盖。默认 400×220、最小高度降为 120；宽度维持 400。倒计时每秒更新不触发缩放；列表重绘保留滚动位置。
> 验证：浏览器示例单条 255、双条 404、三条/五条 520，逐条处理可缩小，长标题滚动、空列表隐藏；54 项 Rust 和 23 项前端测试通过。多屏真实硬件体验待人工验证。

> **分组提醒开发补充（xuanan/dev-0.4.56）**
> B 方案：设置 → 提醒新增分组下拉多选，支持搜索、连续勾选、全选/清空及键盘操作。提醒配置新增 `defaultGroupEnabled`、`newGroupEnabled`、`groupEnabled`（按分组 ID 的覆盖值）。旧配置全部开启；更改新组默认值时，在同一设置事务内冻结现有分组选择，只影响未来新增分组，无需跨文件写入。调度统一过滤关闭组，保留 ledger；通知重试等待期间仍清理不再参与的条目。
> 自动测试覆盖旧配置、分组移动、默认组、新组策略及已知晓/稍后/显示策略；浏览器用模拟 API 验证连续多选、失败回退、搜索、主题和 800×600 菜单布局。Windows 原生通知行为仍需开发版人工验收。

> **v0.4.55 控件统一补充**
>
> `frontend/js/ui.js` / `css/ui.css` 为主窗口和备忘小窗提供共享下拉框、日期/时间选择器与排队确认弹窗。底层表单值、日期精度和 change 事件保留；所有业务 alert 与启动恢复确认已改为应用内弹窗。系统文件选择器和 Windows 提醒通知继续使用系统接口。
>
> 下拉框支持方向键/Home/End/Enter/Esc，浮层挂在 body，按视口避让；日期支持跨月、年份跳转、清空、取消和午夜时间。提示关闭后返回对应字段，多条提示依次显示；提醒设置重绘后恢复键盘焦点，未勾选的批量编辑字段同时禁用真实控件。
>
> 提醒弹窗采用已确认的 A 紧凑版：标题 12px、倒计时 16px、辅助文字 11px、卡片内边距 10px；类型与倒计时同排，查看入口与操作按钮同排，长内容允许换行。日期时间选择器底部操作提示已移除。
> 紧凑尺寸调整：组合面板宽 335px，纯日期 212px、纯时间 200px，不再被输入框宽度撑大；滚轮行高 28px、视窗 112px。浏览器验证组合面板约 335×309px，800×600 下左右布局无横向溢出，滚动同步正常。
> 日期＋时间采用左日历、右时间扩展布局，独立时间选择器复用 `AppTimeWheel`。小时/分钟支持原生滚动吸附、鼠标拖动、点击选项、方向键/Home/End/PageUp/PageDown 和手动输入；触摸使用浏览器原生滑动。确定前仅修改面板草稿，取消不改源值。浏览器已验证滚轮、拖动、边界、输入越界及 800×600 下的完整布局；触摸硬件待人工体验。
>
> 验证：`node --test scripts/storage-errors.test.cjs scripts/ui-controls.test.cjs` 共 16 项通过；真实前端页面配测试 API 完成下拉值同步、禁用状态、错误草稿保留、弹窗队列、闰日、午夜、越界提示和四种主题检查，菜单在 800×600 视口内未裁切。浏览器页面检查不等同于 WebView2 桌面人工验收。

> **v0.4.55 待办提醒**
>
> 新增全局提醒设置与 Rust 调度、独立倒计时窗口、Windows 原生通知、已知晓/稍后提醒、启动补提醒。按用户当前配置：总开关默认开，开始与截止均提醒，弹窗/系统通知/置顶均开启，提示音默认轻敲提示、音量 50%；仅日期的开始/截止默认均为 09:30。自带音效为轻敲提示和清亮三音。`startHasTime` / `endHasTime` 自动记录输入精度；旧数据零点按仅日期兼容。
>
> 提醒运行记录 `reminder-state.json` 留在本机，不随备份迁移。通知注册使用独立 AUMID 和当前用户快捷方式；同一标识限制单实例。Windows 新身份首次查询通知 Setting 可能返回 0x80070490，此时允许首次 Show，其他错误仍报告。ShellLink 属性使用 windows crate 拥有内存的 PROPVARIANT，禁止借用 Vec 指针给会自动释放的 PROPVARIANT。
>
> 测试已覆盖调度、次数、稍后提醒、持久化、日期精度与原有数据安全；原生通知已完成发送联调。Windows 通知点击、实际音效、勿扰模式及多屏体验仍需人工验收。关闭主窗口退出整个应用，不增加托盘。

> **2026-11-09 工作区修复补充（待 owner 验收，未发版）**
>
> 当前开发分支为 `xuanan/fix-data-integrity`，下文的 v0.4.54 / `1a6c554` 描述保留为历史基线。当前工作区已增加 `src-tauri/src/storage.rs`（原子写入、错误返回、进程内事务锁）、`backup.rs`（完整备份、每日自动备份、恢复回滚日志）和 `validation.rs`（任务关系校验）。文件损坏不再作为空数据处理，启动读取设置失败不再重置文件。
>
> 父任务时间同步已覆盖删除、拖拽、编辑换父级、移入分组；没有可用子任务时间时保留父任务原时间。主窗口设置按字段提交；小窗位置使用物理桌面坐标，兼容旧逻辑坐标；关闭兜底已补充 hide 权限。
>
> **数据导出包含待办、分组、归档和备忘录，不包含设置；旧版任务 JSON 导入保留备忘录和设置**；完整备份包含任务、备忘录和设置。自动备份默认关闭，开启后每天首次修改前保存，默认保留 5 份。导入/恢复前副本不参与自动轮换。完整恢复失败会回滚；异常中断的 `restore-pending.json` 会在下一次数据事务前用于恢复原文件。
>
> 验证入口：`powershell -ExecutionPolicy Bypass -File scripts/start-review.ps1`，每次生成全新 `com.todocalendar.dev.review-*` 标识，不读取安装版或已有开发版数据。常规开发仍用 `dev.bat`（已固定 CLI 2.11.4）；Debug 构建拒绝访问正式标识。本轮修复已获用户授权提交；不自动 push、打包或安装。
>
> 测试：`cargo test --manifest-path src-tauri/Cargo.toml --locked --offline` 与 `node --test scripts/storage-errors.test.cjs`。自动化测试不代表多屏和桌面交互已通过人工验收。


> 更新时间:2026-11-06。当前版本 **v0.4.54**(已热修,见 §10)。交接前请通读 §7(构建发版)与 §9(坑清单),这两节是踩坑换来的。

---

## 1. 项目概览

- **是什么**:极简、本地优先(local-first)的 Windows 桌面「日历 + 待办」应用,纯单机、无账号无后端。
- **形态**:Tauri 2 桌面应用(Rust 后端 + 原生 HTML/CSS/JS 前端,无前端框架、无构建步骤)。
- **核心功能**:月视图日历(农历/周数/节假日自动更新)、无限嵌套子任务、拖拽排序、批量创建(粘贴缩进文本)、自定义分组、优先/搁置、归档、搜索、统计条、主题系统(跟随系统/多配色/玻璃强度)、数据导出导入与自动备份、**备忘录**(v0.4.54 新增,侧边分栏左/右可选、迷你卡片、独立窗口三种显示方式,默认关闭)。
- **唯一目标平台**:Windows x64 WebView2。README 里图标目录有 android 子目录,但从未配置移动端构建,别被误导。

## 2. 仓库信息

| 项 | 值 |
|---|---|
| 远端 | `https://github.com/xuananrocx/todocalendar.git` (origin) |
| 分支 | 只有 `main`,单人开发模式 |
| 当前 HEAD | `1a6c554` fix: 备忘独立窗口白屏/X失灵——启动时预建小窗 |
| 上一功能 commit | `e443f16` feat: 备忘录功能 |
| 本地 git config | **未配置** user.name/email,commit 必须内联:`git -c user.name='xuananrocx' -c user.email='xuananrocx@users.noreply.github.com' commit -m "..."`(否则报 Committer identity unknown) |
| Tag 策略 | v0.4.34 之后**本地不打 tag**,发版用 `gh release create vX.Y.Z` 自动建远端 tag。本地 `git describe` 只到 v0.4.34 属正常 |
| 工作区未入库文件 | 根目录及 frontend/ 下的 `*_preview.html`、`icon_preview_*`、`palette_*.png`、`design/` 目录——都是历次视觉方案的 mockup 残留,留着参考,不入库 |
| 许可 | 见 LICENSE |

## 3. 技术栈与版本(锁定的关键版本别乱升)

| 组件 | 版本 | 备注 |
|---|---|---|
| Tauri (Rust crate) | **2.11.5** (Cargo.lock 锁定) | features: image-png |
| Tauri CLI | **@tauri-apps/cli@2.11.4** | 打包用这个精确版本;@latest 能用但会多报 `__TAURI_BUNDLE_TYPE__` 警告 |
| Rust | stable, rustup 管理 (`~/.rustup`) | edition 2021;release 配置 panic=abort + lto + strip + opt-level=s |
| Node | v24 | 只为跑 npx CLI;前端本身零依赖零构建 |
| tauri-plugin-dialog | 2.x | 唯一 Tauri 插件(另 fs 是间接依赖) |
| 其他 Rust deps | serde/serde_json、uuid(v4)、chrono、reqwest(0.12, rustls-tls,节假日联网更新用)、windows-sys 0.59 | |
| WebView2 | 系统安装版 | 数据/缓存目录见 §5 |

**版本号位置**:改版本要同时改 `src-tauri/Cargo.toml` 的 `version` 和 `src-tauri/tauri.conf.json` 的 `version`(历史上有过只改一边导致 Cargo.lock 滞后的 commit `020ed36`,两处都改再 build)。`package.json` 的 0.1.0 是装饰性的,可不管。

## 4. 目录结构导览

```
TodoCalendarTauri/
├── dev.bat                    # 开发启动入口(见 §6)
├── tauri.dev.conf.json        # dev 覆盖配置:identifier=com.todocalendar.dev,实现 dev 数据隔离
├── package.json               # 仅 devDependency: @tauri-apps/cli
├── src-tauri/
│   ├── tauri.conf.json        # 主配置(identifier=com.todocalendar.app, NSIS 自定义模板/中文语言)
│   ├── Cargo.toml / Cargo.lock
│   ├── src/lib.rs             # ★ 全部 Rust 后端,单文件 ~2450 行
│   ├── capabilities/default.json  # ⚠ windows 数组=["main","memo"],新增动态窗口必须把 label 加进来(见 §9)
│   ├── nsis/installer.nsi     # 自定义安装模板(检测旧版/覆盖升级文案)
│   ├── nsis/languages/SimpChinese.nsh  # 自定义中文翻译
│   ├── icons/                 # 多套应用图标(a1/a2/b),运行时可切换(appIcon 设置)
│   ├── resources/holidays.json
│   └── target/.tauri/NSIS/    # 本地化的 NSIS 工具链(useLocalToolsDir,见 §7;target 不入库)
├── frontend/                  # ★ 前端无构建,改完即生效(dev 模式)
│   ├── index.html             # 主窗口(628 行,含设置面板 DOM)
│   ├── memo.html              # 备忘独立小窗页面
│   ├── css/style.css          # 全部样式 ~3400 行
│   ├── js/
│   │   ├── main.js            # 主窗口逻辑 ~3800 行(设置面板、日历交互、命令调用)
│   │   ├── render.js          # 渲染层 ~1900 行
│   │   ├── memo.js            # 备忘录核心(三模式共用),独立小窗下 windowMode=true
│   │   ├── memo-win.js        # 独立小窗专属(X 关闭接管、置顶、boot 探针)
│   │   ├── api.js             # invoke 封装
│   │   ├── icons.js           # 图标渲染(⚠ 图标名不能与组件同名,会无限递归 OOM)
│   │   └── lib/lunar.min.js   # 农历库(vendor)
│   └── vendor/ assets/ icons/
├── scripts/gen_icons.py       # 图标批量生成
├── tools/make_icon.py
├── docs/screenshots/
└── design/ + *_preview.html   # 未入库的视觉 mockup 残留
```

### lib.rs 关键结构(后端导览)

- **数据层**:`load_data/save_data`(todos.json)、`load_memos/save_memos`(memos.json)、`load_settings/save_settings`(settings.json);所有 load 都是"文件不存在/损坏→返回默认值",不会崩。
- **设置**:`Settings` struct 字段与前端 settings 面板一一对应(camelCase 序列化);`update_settings` 命令做 patch 合并,**并带备忘小窗联动逻辑**(§8 的修法就动了这里)。
- **备忘小窗**:`memo_win_create/memo_win_ensure/memo_win_show/memo_win_hide/memo_win_toggle/memo_win_save_rect`,label 常量 `MEMO_WIN_LABEL = "memo"`。
- **节假日**:`maybe_auto_update_holidays` 启动检查更新(reqwest + 代理注意),`list_holidays/check_holiday_updates`。
- **诊断**:`diag_log` 命令——前端 `diag(msg)` → dev 日志/被重定向的 stderr 打 `[diag] ...`,排障利器,别删。
- **命令注册**:`.invoke_handler(tauri::generate_handler![...])` 里是全部命令清单(~2130 行处)。
- **setup 闭包**(~2147 行):应用图标应用、节假日更新、**备忘小窗启动预建**(v0.4.54 热修的核心,见 §8)。
- 代码里有少量中文注释解释非显然的坑(事件线程自锁、坐标过滤等),改动相关区域前先读注释。

## 5. 运行时数据与文件位置(Windows)

| 内容 | 路径 |
|---|---|
| 安装位置(本机) | `D:\application\TodoCalendar\`(NSIS 装的,含 uninstall.exe) |
| **用户真实数据** | `%APPDATA%\Roaming\com.todocalendar.app\` → `todos.json` / `memos.json` / `settings.json` / `holidays_cache.json` |
| WebView2 缓存 | `%LOCALAPPDATA%\com.todocalendar.app\EBWebView\`(数据在 Roaming,删缓存不丢数据) |
| dev 模式数据 | 同结构但 identifier 为 `com.todocalendar.dev`,与正式版**完全隔离**(这是 2026-11-05 明确要求"不要动我数据"后建立的) |
| 数据安全 | ① 备份:设置里有 autoBackup(默认关);② **任何 dev/调试严禁指向 com.todocalendar.app**;③ 强杀进程可能打断 settings.json 写入→文件半写→下次启动设置回默认(假性"数据丢失",见 §9) |

## 6. 开发流程

```bat
:: 双击仓库根目录 dev.bat,或:
npx --yes @tauri-apps/cli@latest dev --config tauri.dev.conf.json
```

- **必须带 `--config tauri.dev.conf.json`**(dev.bat 已带),否则 dev 实例直接读写正式版数据目录。
- dev 页面走 `http://127.0.0.1:1430` 本地服务:**改纯前端文件会热生效,但 tauri 的 watcher 只盯 src-tauri**——改完前端后 `touch src-tauri/src/lib.rs` 强制重启最稳。
- 前端无打包无 TS 无 lint;后端验证用 `cargo check`(在 src-tauri/ 下)。
- **改 `.py` 之外的辅助脚本**(gen_icons.py)重新生成图标后,记得把产物加进 `src-tauri/icons/` 并在 tauri.conf.json `bundle.resources` 登记新文件名。

## 7. 构建、发版完整流程(照抄模板,别拆步骤)

### 7.1 构建 NSIS

```bash
cd "F:/CodePilot/TodoCalendarTauri" && \
export USERPROFILE="C:\Users\xuanan" HOME="C:\Users\xuanan" \
       RUSTUP_HOME="C:\Users\xuanan\.rustup" \
       LOCALAPPDATA="C:\Users\xuanan\AppData\Local" \
       APPDATA="C:\Users\xuanan\AppData\Roaming" \
       CI=false && \
npx --yes @tauri-apps/cli@2.11.4 build --bundles nsis
```

- 耗时 ~2.5 分钟。产物:`src-tauri/target/release/bundle/nsis/TodoCalendar_X.Y.Z_x64-setup.exe`。
- **为什么 export 这些**:这串环境变量是 AI 终端(harness/bash)把 USERPROFILE 指向临时目录时防止 `dirs::cache_dir()` 返回 None → tauri-bundler 在 `nsis/mod.rs:85` unwrap panic 的保命符——同一个坑踩过 3 次。**普通 CMD/PowerShell 直接构建不需要 export**,但把模板整段照抄永远无害。环境变量不跨命令持久,必须和 build 同一条命令。
- `tauri.conf.json` 已配 `"useLocalToolsDir": true`,NSIS 工具链从 `src-tauri/target/.tauri/NSIS/` 取(不入库,新机器首次构建自动重新下载到该目录)。
- 只打 `--bundles nsis`,**不打 msi**(易 panic,历史结论)。
- 需要 `gh`(GitHub CLI,已登录 xuananrocx)与 git push 时走代理 `127.0.0.1:7897`(github 访问)。

### 7.2 发版步骤(用户明说"发版"才执行)

1. `git push origin main`
2. `gh release create vX.Y.Z <setup.exe绝对路径> --title "vX.Y.Z" --notes "..."`
   (近期不本地打 tag,远端 tag 由 gh 自动创建)
3. **替换已发版本的安装包**(热修场景,2026-11-06 实操):
   `gh release upload vX.Y.Z <setup.exe> --clobber` ——只换附件,**绝不动 Release 描述**。
4. push 被拒(远端有网页上改的 README 等):`git pull --rebase origin main` 再 push;若之前建过 tag 要删旧重打。
5. 覆盖整条 Release 的旧做法:`gh release delete vX.Y.Z --yes --cleanup-tag` 后重建(需要保留原 notes 原文)。

### 7.3 发版前自查清单

1. ☐ 版本号两处(Cargo.toml + tauri.conf.json)都改了?
2. ☐ 环境变量与 build 在**同一条命令**里?
3. ☐ 报 `panicked at nsis/mod.rs:85` = 100% 环境变量缺失,别查别的,重跑模板。
4. ☐ 本地实测:先跑裸 exe(`target/release/todocalendar.exe`,PowerShell `Start-Process -RedirectStandardError <file>` 可抓 GUI exe 的 eprintln 日志),再 `powershell Start-Process <setup.exe> -ArgumentList '/S' -Wait` 静默装一遍验证升级。
5. ☐ **静默安装别在 git-bash 直接传 `/S`**:MSYS 会把 `/S` 改写成 `S:/`,安装器弹 GUI 卡死。用 PowerShell Start-Process。
6. ☐ 静默安装前先温和关闭正在运行的实例(CloseMainWindow;不行再 Stop-Process——强杀有 settings.json 半写风险)。
7. ☐ 重传安装包时 Release notes 保留原文(用户明确要求过)。

## 8. v0.4.54 备忘录功能 & 白屏热修(最新上下文,必读)

**功能**(commit `e443f16`):备忘录默认关闭,设置里开启;三种显示方式——侧边分栏(左/右可选 `memoSidePosition`)、迷你卡片(置顶贴边)、独立窗口(`memo_win_*` 系列,可置顶、位置尺寸记忆、可选启动恢复 `memoWinRestore` 默认关);正文 URL 自动识别为链接;独立 `memos.json` 存储;拖拽排序。

**热修**(commit `1a6c554`,2026-11-06):独立窗口"白屏 + X 关不掉"的根因是 **Windows 上从命令线程(入口点击/设置钩子)同步 `WebviewWindowBuilder.build()` 会得到死渲染管线**(WebView 子窗口停在 0x0、页面 JS 全死→X 无人应答),与缓存损坏无关。修法:
- 窗口模式下**启动即预建小窗**(restore 关闭时 `.visible(false)` 隐藏预建,页面 JS 在隐藏态照常 boot);
- 运行期一律只 show/hide,绝不现场建窗;
- 兜底建窗(理论上到不了)也走 `std::thread::spawn + sleep 400ms` 延迟线程(与启动路径同款,实测健康)。
- v0.4.54 的 GitHub 安装包已用 `--clobber` 替换为修复版(16:40 构建),Release 描述未动;本机已静默升级。
- 未做的可选硬化:Rust 侧 watchdog 检测死 webview 自动销毁重建(用户未要求,别擅自加)。

## 9. 硬核坑清单(每条都真金白银踩过)

### Tauri/WebView2 行为
1. **运行期建窗=死 webview**:见 §8。任何新动态窗口都要"启动预建、运行期 show/hide"。
2. **窗口事件回调里禁止同步调窗口方法**(outer_position/hide 等):回调在事件循环线程,同步调用派回同一线程→**自锁死**,必须 `std::thread::spawn`。
3. **运行时创建的窗口点 X 只走页面 JS `onCloseRequested`**,Rust 侧 `on_window_event` 收不到;且全局 `Builder::on_window_event` 对动态窗口不生效,必须在窗口实例上 `w.on_window_event(...)` 挂。JS 关闭处理器要注册在 boot **最前面**。
4. **`tauri-plugin-dialog` 接管 `window.alert/confirm`** 变系统原生样式;应用内提示统一用 `Main.alertAction()`(confirmAction + hideCancel)。
5. **capabilities 的 windows 数组必须包含所有动态窗口 label**(现为 `["main","memo"]`),漏了该窗口所有 invoke 被拒(症状:小窗按钮全没反应)。
6. **窗口创建瞬间可能读到停放坐标 [-18286,-18286,0,0]**,落库前要过滤;备忘小窗还有"记忆位置必须落在某显示器上"的校验(副屏拔掉回退默认位)。
7. **外部 ShowWindow 会造成 tao 可见性状态失同步**:`.visible(false)` 创建的窗被外部脚本 SW_SHOW 后,tao 仍记"隐藏",`w.hide()` 被当冗余跳过(藏不掉但日志报 ok)。无头测试 X 路径要用 tao 自己 show 出来的窗。
8. **WebView2 白屏自愈**:EBWebView 缓存损坏(dev 进程被强杀后偶发)→ 删 `%LOCALAPPDATA%\<identifier>\EBWebView`(数据在 Roaming 不受影响)。鉴别:窗口缺 `Chrome_RenderWidgetHostHWND` 子窗口=渲染管线没建,与前端代码无关。
9. invoke 调用建议带 `Promise.race` 超时降级(memo-win.js 的 hideMemoWin 是范例:2.5s 超时→JS 原生 `getCurrentWindow().hide()` 兜底)。

### Windows/工具链
10. **MSYS 路径转换**:git-bash 里 `taskkill /PID`、安装器 `/S` 都会被改写,统一用 PowerShell 脚本;内联 PowerShell 的 `$var` 会被 bash 吃掉——**写成 .ps1 文件再执行**。
11. **中文 .ps1 必须 UTF-8 带 BOM**,否则 PS5.1 按 GBK 读崩;C# 源码里别放中文字符串(比较逻辑用 class+非空 title 等纯 ASCII 条件替代)。
12. **强杀进程(Stop-Process -Force)可能打断 settings.json 写入**→半写损坏→下次启动设置回默认(假性数据丢失)。
13. PowerShell 枚举窗口用静态 C# 方法(PS 5.1 lambda→委托转换会失败);GUI 子系统 exe 的 stderr 可用 `Start-Process -RedirectStandardError` 捕获。

### 发版/构建
14. build 环境变量缺失→`nsis/mod.rs:85` panic(§7 详解,踩过 3 次)。
15. **NSIS 中文化必须配 `customLanguageFiles`**:`nsis.languages` 只是声明,翻译文件要显式指定到 `./nsis/languages/SimpChinese.nsh`,否则静默回退默认翻译(修复在 commit `8e90055`)。
16. 本机没有 `cargo-tauri` 子命令,必须 `npx --yes @tauri-apps/cli@...`。
17. grep 编译进 exe 的 JS 字符串不可靠(资产压缩);dev 模式前端改动走 1430 端口热生效。

## 10. 版本史速览

| 版本 | 日期 | 要点 |
|---|---|---|
| v0.4.54 | 2026-11-06 | 备忘录功能(默认关);当天热修独立窗口白屏/X失灵(安装包已替换,Release 描述未动) |
| v0.4.53 | 2026-09-15 | 版本整理 |
| v0.4.51 | 2026-09-03 | 完成勾选框几何画法、顶栏间距、归档搜索修复 |
| v0.4.49 | 2026-09-01 | 搁置置灰开关 |
| v0.4.45 | 2026-08-20 | useLocalToolsDir 规避打包 cache_dir 问题 |
| v0.4.34 | 2026-08-19 | (最后一个本地打 tag 的版本) |

完整历史:`git log --oneline`;发版差异:`git log v0.4.54..HEAD`。

## 11. 与项目 owner 的协作约定(重要)

1. **改完代码不要立刻 commit**——留在工作区等 owner 实测,确认"没问题"后才 commit(未测试代码进 git 历史被明确批评过)。commit 后要告知:改了什么 + 未 push 的 commit 数。
2. **commit 后不要主动 push/打 tag/打包**,等明确说"发版/push/发新版本"。
3. **重传安装包必须保留 Release 原描述**(用户原话"版本描述为啥要替换,这个保持原来的四点就好")。
4. dev 必须走隔离 identifier,严禁动正式版数据目录(用户原话"不要动我数据")。
5. 视觉类新功能先出 HTML mockup 给用户看过再实现(工作区里那些 preview 文件就是这流程的产物);方案被否决的功能(如图标方向开关)不要复活,先问。
6. 网络受限地址(github 等)走本机代理 127.0.0.1:7897(或 1080)。

## 12. 接手建议路线

1. `git clone` → 装好 Node LTS + Rust stable → 双击 dev.bat 跑起来熟悉界面。
2. 读 `src-tauri/src/lib.rs` 的命令注册清单 + `frontend/js/main.js` 设置面板,建立"设置项=Settings 字段=UI 控件"的映射感。
3. 试一轮完整发版演练(§7):build → 裸 exe 测 → 静默装(可发个测试版本号到自己 fork)。
4. 改任何动态窗口/关闭逻辑前,重读 §8、§9.1-9.3。
5. 有不确定的设计意图(比如某设置为什么默认关),先问 owner,别猜。
