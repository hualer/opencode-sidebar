# OpenCode SideBar

[English](README.en.md) | 简体中文

> 为官方 opencode web UI（`opencode web` / `opencode serve`）加一条 OpenChamber 风格的
> **提示词导航轨（prompt navigator rail）**：会话时间线右侧一列均匀刻度，**每条用户消息对应一个刻度**，
> 鼠标在整条轨上滑动按 Y 轴映射到最近的刻度，点击即跳转到对应对话位置，当前视口相邻的轮次高亮。

![OpenCode SideBar：右侧导航轨与目录（TOC）面板](toc-screenshot.png)

纯 Chrome 扩展（Manifest V3），只注入 content script：

- **无后台进程**、**无额外权限请求**
- **不向任何外部地址发送数据**——数据全部来自与页面同源的 opencode HTTP API

---

### 安装（唯一需要手动做的一步）

1. Chrome 地址栏打开 `chrome://extensions`
2. 右上角打开 **开发者模式**
3. 点 **加载已解压的扩展程序**，选择本项目文件夹
   —— 或克隆本仓库后选择克隆下来的目录
4. 打开 / 刷新任一 opencode 会话页，即可看到右侧导航轨

> 注：Chrome 137+ 正式版禁用了命令行 `--load-extension`，所以自动化测试跑在 Edge 上
> （扩展本身是标准 MV3 content script，不使用任何浏览器私有 API，Chrome 手动加载行为一致）。

### 生效地址

默认匹配（`manifest.json` 的 `content_scripts.matches`，任意端口）：

- `http://localhost/*`、`http://127.0.0.1/*`
- `https://localhost/*`、`https://127.0.0.1/*`

如果 opencode web 部署在其他域名 / 地址，修改 `manifest.json` 中的 `matches`
（以及 `host_permissions`）后在扩展页点 **重新加载** 即可。

### 行为说明

| 交互        | 行为                                                                                                                                                                                                                                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 刻度来源      | 同源消息 API：先试当前版 `GET /api/session/{id}/message`，非 JSON / 形状不对 / **返回空** `data` 时回退旧版 `GET /session/{id}/message`（裸数组）。空数组不作为定论——有的部署对 `/api/` 路径只回 `{"data":[],"cursor":{…}}`，真数据在旧路径上（实测 407 条消息 / 14 条用户消息）。兼容 `{data:[...]}` 与裸数组、`type:"user"` 与 `info.role` 两种响应结构；每个用户消息一个刻度，按时间顺序均匀分布（12px 间距） |
| 目录面板（TOC） | 鼠标进入导轨 200ms 后在左侧弹出面板，列出**全部**用户消息（不受 30 刻度窗口限制）：`#序号 时间 单行预览`，顶部显示总条数；面板内部滚动，active 行自动滚入可见区；**顶部锚定**——hover 展开时面板向下生长，行位置不抖动                                                                                                           |
| hover 联动  | 导轨 ↔ 目录行双向同步（`setHover`）；hover 的目录行**就地展开**显示完整预览（≤600 字 / 约 6 行），替代原生 `title` 提示；对应刻度加宽变蓝；hover 落在 30 窗口外时窗口平移以包含该刻度                                                                                                                                            |
| 目录行点击     | `ocJumpTo` 跳转，**面板保持打开**（可连续跳转），active 行随之滚动跟随                                                                                                                                                                                                                                                           |
| 面板关闭      | 移出导轨 + 面板 250ms 后关闭；`Esc` 立即关闭                                                                                                                                                                                                                                                                                   |
| 同屏上限      | 最多 30 个刻度，围绕当前轮开窗滑动（边缘渐隐遮罩）                                                                                                                                                                                                                                                                                    |
| 配色随主题     | 按页面背景亮度在 `#oc-rail-host[data-oc-theme]` 上标注 `light/dark`：深色页用灰色刻度 + 白色 active；浅色页（`rgb(250,250,250)`）改用 slate 灰 + 近黑 active + 深蓝 hover。原先白色 active 刻度在浅色背景上是白底白线，完全看不见                                                                                                             |
| 可见性自恢复    | 时间线只要有任何一次不渲染 `[data-timeline-row]`（重挂载、虚拟化重建、窗口 resize），导轨会隐藏；几何更新（watchdog 每 1s）会重新显示。此前只有 active 变化 / 新消息才会触发重绘，横线会一直消失到用户滚到另一轮为止                                                                                                                         |
| 首次定位前不渲染  | 主机元素拿到时间线几何（`updatePosition`）之前保持隐藏——`position:fixed` 且未设 `left/top` 会落在静态位置（视口外），看起来同样是"横线全没了"                                                                                                                                                                                                       |
| 整条 hover  | 鼠标 Y → 最近刻度，命中刻度加宽变蓝；移出导轨清除                                                                                                                                                                                                                                                                                |
| 点击        | 设置 `location.hash = message-<id>`，走应用自带的 hash 跳转（虚拟化滚动、历史分页加载均由应用自己处理）；目标 hash 与当前值相同时采用两段式（先清后设）确保应用能收到变化；1.5s 后若目标行仍未进入视口则回退 `scrollIntoView`                                                                                                                           |
| 当前轮高亮     | sticky 头下方最顶可见的用户行（动态测量 sticky 头高度，避免被遮住的上一行误判）；**滚到底部时 = 最后一条**（与应用自身语义一致）；rAF 节流跟随滚动                                                                                                                                                                       |
| 会话切换      | URL / 会话变化自动卸载重建；回首页卸载；新消息到达（MutationObserver 发现未知 id）自动增量刷新刻度                                                                                                                                                                                                                     |

会话页判定：路径包含 `/session/ses_` 且时间线（`[data-scrollable]` + `[data-timeline-row]`）存在。

### 调试

- 页面 console 中带 `[oc-rail]` 前缀的日志；
- 主机元素 `#oc-rail-host` 的 `data-oc-status` 属性是 JSON 状态
  （`mounted / sessionID / tickCount / activeIndex / hoverIndex / tocVisible / jumpCount / errors`），
  跨 isolated / main world 可读——在页面 console 里可直接查看：

```js
JSON.parse(document.getElementById("oc-rail-host").dataset.ocStatus)
```

- 同一元素上的 `data-oc-theme` 是 `light` / `dark`（由页面背景亮度推导），刻度配色按它切换；
  怀疑"线看不见"时先看 `visibility`（`style.visibility`）与 `data-oc-theme`。
- 出错信息同样记录在 `errors` 字段并 `console.error` 输出。

### 目录结构

```
manifest.json      MV3 清单（仅 content_scripts + host_permissions）
src/debug.js       状态命名空间、日志、跨世界状态镜像
src/api.js         会话 id 解析 + 用户消息列表拉取
src/jump.js        hash 跳转（两段式 + 回退）
src/rail.js        Shadow DOM 导轨渲染、Y→tick 映射、sticky 头测量、TOC 面板
src/main.js        生命周期编排：挂载/卸载、滚动/Resize/Mutation 观察、刷新
tools/             开发与测试工具（不参与扩展运行）
toc-screenshot.png 界面效果截图（README 插图）
README.md          中文说明
README.en.md       English documentation
LICENSE
```

### 开发 / 测试工具（tools/）

- `serve.mjs` — 从进程表发现本地 `opencode serve` 的端口与 Basic 认证密码（OpenChamber 每次启动会随机换端口）
- `e2e.mjs` — 真扩展端到端（28 项断言：挂载、刻度数 = API 消息数、TOC 开 / 关 / 重开、
  hover 行展开 + 刻度高亮、远端窗口平移、点击跳转 + 面板保持、active 行滚动跟随、`Esc` 关闭、零报错）
  - 运行：`node tools/e2e.mjs [sessionID]`；需要 Edge（Chrome 137+ 禁用 `--load-extension`）
  - opencode web 在 zh locale 下会话页会因 `Intl.ListFormat` 崩溃（应用侧 bug），
    测试强制 `locale: en-US` 绕开
- `probe-dom.mjs` — 打开会话页并报告扩展依赖的 DOM 事实（scroller / 行数 / 挂载状态）
- `debug-scroller.mjs` / `debug-geom.mjs` / `debug-hover.mjs` — 专项探针：
  scroller 祖先链、导轨几何时间序列、TOC hover 事件流与命中测试
- `debug-ticks.mjs` / `debug-ticks-zoom.mjs` — 刻度可见性探针：宿主 / 刻度几何与计算样式、
  遮罩取值、命中测试；6x 高清裁剪图（判断"线画出来了但看不见"这类对比度问题）
- `debug-hidden.mjs` — 复现"横线全部消失"：让时间线短暂不渲染任何行，验证导轨隐藏后能否自行恢复
- `debug-api.mjs` — 打印消息接口的真实返回（状态码 / Content-Type / 顶层结构 / role 直方图 / 样例），
  用于核对 `src/api.js` 的解析假设
- `probe-remote.mjs` / `probe-remote-dom.mjs` — 带 nginx Basic 认证打开远程会话页
  （凭据由 `tools/remote.mjs` 从运行中的 OpenChamber 进程环境读取，
  或用 `OC_REMOTE_USER` / `OC_REMOTE_PASS` 覆盖，**不写进文件**）：记录应用自己请求了哪个消息接口、
  导轨状态 / 刻度几何 / 配色，并导出时间线 DOM 结构（`[data-scrollable]`、`[data-timeline-row]` 层级）

### 已知限制（当前范围）

- 未实现（预留扩展点）：键盘导航、视口位置缩略条、轨内搜索
- TOC 面板为固定深色样式，未跟随页面浅 / 深色主题切换
- 依赖 opencode web 的页面结构选择器（`[data-scrollable]`、`[data-timeline-row]`）与同源消息 API，
  opencode 大版本 UI 重构后需同步更新选择器
- 无扩展图标（使用默认拼图图标）

### License

MIT
