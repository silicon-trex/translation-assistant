# CLAUDE.md — 翻译助手 项目档案

> 开新会话先读这个，快速接上项目进度。不是给用户的说明文档（那个是 README.md），是给 AI 的"项目记忆"。

## 项目是什么

Chrome/Edge 划词翻译扩展：选中网页文字 → 出现"翻"按钮 → 点击弹窗显示翻译结果。基于 DeepSeek API，中英互翻。

另外还有**截图翻译**：按快捷键（或点工具栏图标）→ 页面冻结 → 框选一块 → 弹窗显示「识别出的原文 + 译文」。专治文字藏在图片 / Canvas / 视频里的场景（那些地方划词选不中）。

## 技术栈

- WXT v0.19（Vite 之上的扩展框架）+ TypeScript + Manifest V3
- ⚠️ **项目没有装 `typescript` 包**：`npm run build` 走 esbuild，只把类型标注剥掉、**不做类型检查**。所以"build 通过"只等于"能打包"，不等于"类型正确"，类型错误只能靠运行时和手动测试暴露。
- 构建命令：
  - `npm run dev` —— 开发热更新
  - `npm run build` —— 构建到 `.output/chrome-mv3/`（加载扩展就拖这个文件夹）
  - `npm run zip` —— 打发布用的 zip
- API：DeepSeek，模型 `deepseek-flash`（即 DeepSeek-V4.1-Flash，2026-09-10 正式上线），非流式（`stream: false`）。**模型名写死在三处**，换名时要一起改：`background.ts` 的 `translateText`（划词）、`background.ts` 的 `translateImage`（截图，多模态）、`options-script.ts` 的测试按钮。

## 目录结构

| 文件 | 职责 |
|---|---|
| `entrypoints/content.ts` | 内容脚本（ISOLATED 世界）。**所有 UI 逻辑**（翻按钮 + 翻译弹窗 + 截图圈选编排）都在这，最大最核心 |
| `entrypoints/background.ts` | Service Worker：翻译缓存 + 调 DeepSeek API + 截图/图片翻译 + 快捷键与工具栏图标的触发入口 |
| `entrypoints/selection-main-world.ts` | 注入页面主世界的脚本，专解 Shadow DOM（B站评论等）选中检测 |
| `screenshot-overlay.ts` | 截图圈选的蒙层（冻结画面 + 拖框 + canvas 裁剪）。**在项目根目录**，不在 `entrypoints/` 下 |
| `entrypoints/options.html` / `options-script.ts` | 设置页，填 DeepSeek API key（存 `chrome.storage.sync`）。**脚本在项目根目录**，html 用 `../options-script.ts` 引用 |
| `wxt.config.ts` + `package.json` | 配置 + 版本号，**两个文件的 version 要同步改** |

> 项目根的 `.ts`（`options-script.ts`、`screenshot-overlay.ts`）不是入口，WXT 只扫 `entrypoints/`，这些是被 import 的共享模块。新加共享模块照这个约定放根目录。

## 核心机制（改之前先想清楚，都是踩坑换来的）

1. **Shadow DOM 选中检测**：ISOLATED 世界收不到 Shadow DOM 里的 selection 事件。方案 = `injectScript` 把 `selection-main-world.js` 注入主世界，用 `postMessage` 发回 `FYLZ_SELECTION` / `FYLZ_CLEAR`。主世界轮询每 200ms，**连续 3 次**读到空才发 FYLZ_CLEAR（防止短暂闪烁误判）。
2. **翻译缓存**（background.ts）：key 用 `normalizeKey`（trim + 空白合并 + 转小写，符号保留）。内存 Map + `chrome.storage.local` 持久化（防抖 5s 写一次）。上限 500 条 FIFO 淘汰；只缓存 500 字符以内的文本；in-flight 去重（同一段文字并发只调一次 API）。
3. **语言检测**（content.ts `detectLanguage`）：按字符数量**占比**判断，中文字符数 > 英文字符数 → 中文，否则英文。中英混合时取多数方。只服务中英互翻。
4. **翻按钮防消失**：`pointerdown` 时 `setPointerCapture` 抓住指针 + `isTriggerPressed` 标记，防止点击过程按钮闪没。点"翻"后 `triggerCooldown` 500ms 防 mouseup 误触发。
5. **弹窗防误关**（content.ts 三个时间戳，都是"1 秒/300ms 内忽略误信号"的思路）：
   - `lastPopupCreatedAt`：建弹窗后 1s 内忽略"选中清空"信号
   - `lastHostClickAt`：点自己界面后 1s 内忽略 FYLZ_CLEAR（点弹窗身体会清空页面选中，约 600ms 后才收到 FYLZ_CLEAR）
   - `lastDragEndTime`：拖完浮窗 300ms 内不显示翻按钮（拖拽松手的 mouseup 会误调 showTrigger）
6. **全屏**（抖音）：监听 `fullscreenchange`，把 host 移进 `document.fullscreenElement`，按钮才能盖在视频上层。
7. **弹窗**：closed shadow root。支持置顶（图钉图标变靛蓝）、拖拽、复制（成功变绿）、重新翻译（🔄 跳过缓存重问，新结果覆盖旧缓存）、多浮窗（每弹一个向右下各偏移 20px 防重叠）。
8. **截图翻译**（`screenshot-overlay.ts` + `content.ts` 的 `startScreenshot`）：
   - 触发两条路：快捷键 `Ctrl+Shift+X`（`chrome.commands`）和点工具栏图标（`chrome.action.onClicked`），都走 background → `chrome.tabs.sendMessage(tabId, {action:'start-screenshot'})`
   - **先截图，再显示蒙层**（不是反过来）。先藏自家 UI（翻按钮 + 浮窗）→ 等两帧 → `captureVisibleTab` → 拿这张图当蒙层背景铺满视口（"冻结画面"）
   - 裁剪用 canvas，坐标换算锚在 `<img>` 的 `getBoundingClientRect()` 上
   - 图片 v1 的多模态格式：`content` 是数组，`[{type:'text'},{type:'image_url','image_url':{url: dataURL, detail:'high'}}]`
   - 模型用 `<原文>` / `<译文>` 标签返回，`parseOcrResult` 解析；解析失败降级成"整段当译文"
   - **截图翻译不缓存**（OCR 有随机性，同一块图两次识别结果都可能不同，缓存必然命中不了）
   - 翻译方向没法提前判断（调 API 前看不见图里是什么语言）→ **拿译文反推**：`detectLanguage(译文)`
   - 截图翻译的「🔄 重新翻译」= 拿同一张图重认一遍（原图存在闭包里，浮窗关闭时随实例释放）

## 版本号

当前 **1.2.0**。升级规则：bug 修复升 PATCH（1.1.3 → 1.1.4），**新功能升 MINOR（1.1.4 → 1.2.0）**。改版时 `package.json` 和 `wxt.config.ts` **两处**都要同步。

> 开发状态（2026-09-10）：v1.2.0 包含两批改动 —— ① 模型名统一换成 `deepseek-flash`（旧名官方只承诺"暂时路由"，属于定时炸弹）；② **新增截图翻译**（快捷键 Ctrl+Shift+X + 工具栏图标）和**「重新翻译」按钮**（🔄 跳过缓存）。均已实测通过。本地已提交，GitHub 状态以 `git status` 为准。
>
> 用户已定的节奏（2026-08-27 起）：**先真实用一段时间，等用出真痛点再改版**。但 2026-09-10 用户主动要求做截图翻译，属于明确例外 —— 别把这条当成"可以随便加新功能"。

## 已砍掉 / 用户明确不要的功能（别自作主张加回来）

- 流式输出（MV3 service worker 会中断导致"翻译中断"，bug 太多已回滚）
- TTS 朗读（Chrome `speechSynthesis` 在部分 Windows 上无声，已回滚）
- 自动翻译、生词本、暗黑模式、多引擎、模型选择、整页/批量翻译
- **快捷键 —— 2026-09-10 用户明确解禁，但只解禁一个**：`截图翻译` 的命令快捷键（Ctrl+Shift+X）。
  **划词翻译仍然不加快捷键**，别顺手给划词也加上（那是用户当初明确不要的）。
- 截图翻译的「译文原位盖回页面」（像沉浸式翻译那样）—— 用户选了简单版，不做

## 已知坑（历史教训）

- 输入框打字失灵：别在无选中时调 `removeAllRanges()` 清选中（会让输入框丢焦点）。
- 快速拖动选词偶发按钮不出现：用固定延时发送，**不要**用可重置的防抖。
- B站评论按钮位置错乱：按钮定位用选区的 `getBoundingClientRect`，坐标失效时兜底用鼠标位置。
- **GitHub 站内前进/后退后「翻」按钮不弹 —— 用户 2026-09-10 决定：不修了，别再花时间**
  - 现象：只在 GitHub 这类慢速 SPA 的**站内跳转**后出现；GitHub→别的站→GitHub 反而正常
  - 已排除：host 被删、脚本死掉。用 `window.addEventListener('message')` 确认主世界的 `FYLZ_SELECTION` 信号**收得到**，卡在"收到信号 → 按钮没渲染出来"这一段。shadow root 是 closed，控制台查不进去
  - **不修的理由**：用户说自己用截图翻译代替就行（按钮不弹就直接框选那块字），这个 workaround 对他够用
  - 诊断记录保留在上面，将来若有人反馈再捡起来；排查首选是在 `content.ts` / `selection-main-world.ts` 加临时 `console.log`
- **background 的 `onMessage` 必须有兜底分支**：它是 if/else 链，未匹配的 action 如果不回 `sendResponse`，调用方的 `sendMessage` 会**永远 pending**（不是报错，是静默挂起，界面一直转圈）。
- 截图翻译（`screenshot-overlay.ts`）踩过的坑，改之前必读：
  - **canvas 的 `drawImage` 源矩形越界时不会剪裁，而是把目标矩形整体缩放** → 裁出来又小又错位。源矩形必须自己 clamp 到图片边界内。
  - 换算基准要锚在 **`<img>` 自己的 `getBoundingClientRect()`** 上，别用 `window.innerWidth` —— 截图后改窗口大小 / 进出全屏时 innerWidth 会变，而背景图是被拉伸铺满的，两者就对不上了。
  - `:host { all: initial }` 会把字体打回**衬线体**，蒙层的 CSS 必须自己再写一遍 `font-family`。
  - 蒙层要 `root.tabIndex = -1` + `focus()`，否则焦点停在 iframe 里时 **Esc 收不到**。
  - 截图前必须藏自家 UI（翻按钮 + 浮窗），否则会被 `captureVisibleTab` 一起截进图里。
  - 截图时用 `wheel`/`touchmove` 挡不挡滚动都行，正确性不受影响（像素永远来自那张冻结图）。
- **`PopupInstance.showLoading()` 开头必须清空 `el.innerHTML`**：它原本只在构造浮窗时调一次所以漏了清空；「重新翻译」会在**已有内容**的浮窗上再调它，不清空就会追加出**第二套头**（曾实测踩到）。
- 代码注释、commit message 都用中文。

## Git / 发布

- GitHub 已发布（`silicon-trex/翻译助手`），MIT License（Copyright (c) 2026 silicon-trex）。
- 仓库里**没有**真实 API key：用户自己填在 options 页，代码里只有校验用的 `key.startsWith('sk-')` 和占位符 `placeholder="sk-..."`，都只是提示格式。
- 发 Release 时产物 = `npm run zip` 生成的 zip。
- **1.2.0 新增了权限**：`permissions` 从 `['storage']` 变成 `['storage', 'activeTab']`（截图要用 `chrome.tabs.captureVisibleTab`），并新增 `action`（工具栏图标）和 `commands`（快捷键）。已装用户升级时会看到"需要新权限"的提示。
  - 如果 `captureVisibleTab` 报 `Either the '<all_urls>' or 'activeTab' permission is required`，退路是加 `host_permissions: ['<all_urls>']`（content script 本来就是 `<all_urls>`，安装时的权限提示不会因此变多）。
- **截图翻译的已知限制**（不是 bug，是浏览器的硬限制）：只能截当前标签页的**可视区域**，滚出屏幕的部分截不到；`chrome://` 页、扩展商店、Chrome 内置 PDF 阅读器等页面不允许截图。

## 沟通偏好

- 用户是编程初学者（学过 Java/MyBatis/MySQL/Spring），**讲解用大白话 + 类比 + 结构化**，别堆术语。
- 用户偏好：改之前先讨论、先讲原因再动手、不要自作主张加功能。
