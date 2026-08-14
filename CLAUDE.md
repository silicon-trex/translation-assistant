# CLAUDE.md — 翻译助手 项目档案

> 开新会话先读这个，快速接上项目进度。不是给用户的说明文档（那个是 README.md），是给 AI 的"项目记忆"。

## 项目是什么

Chrome/Edge 划词翻译扩展：选中网页文字 → 出现"翻"按钮 → 点击弹窗显示翻译结果。基于 DeepSeek API，中英互翻。

## 技术栈

- WXT v0.19（Vite 之上的扩展框架）+ TypeScript + Manifest V3
- 构建命令：
  - `npm run dev` —— 开发热更新
  - `npm run build` —— 构建到 `.output/chrome-mv3/`（加载扩展就拖这个文件夹）
  - `npm run zip` —— 打发布用的 zip
- API：DeepSeek，模型 `deepseek-v4-flash`，非流式（`stream: false`）。模型写死在 `background.ts` 的 `translateText` 里。

## 目录结构

| 文件 | 职责 |
|---|---|
| `entrypoints/content.ts` | 内容脚本（ISOLATED 世界）。**所有 UI 逻辑**（翻按钮 + 翻译弹窗）都在这，最大最核心 |
| `entrypoints/background.ts` | Service Worker：翻译缓存 + 调 DeepSeek API |
| `entrypoints/selection-main-world.ts` | 注入页面主世界的脚本，专解 Shadow DOM（B站评论等）选中检测 |
| `entrypoints/options.html` / `options-script.ts` | 设置页，填 DeepSeek API key（存 `chrome.storage.sync`） |
| `wxt.config.ts` + `package.json` | 配置 + 版本号，**两个文件的 version 要同步改** |

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
7. **弹窗**：closed shadow root。支持置顶（图钉图标变靛蓝）、拖拽、复制（成功变绿）、多浮窗（每弹一个向下偏移 20px 防重叠）。

## 版本号

当前 **1.1.3**。升级规则：bug 修复升 PATCH（1.1.2 → 1.1.3）。改版时 `package.json` 和 `wxt.config.ts` **两处**都要同步。

## 已砍掉 / 用户明确不要的功能（别自作主张加回来）

- 流式输出（MV3 service worker 会中断导致"翻译中断"，bug 太多已回滚）
- TTS 朗读（Chrome `speechSynthesis` 在部分 Windows 上无声，已回滚）
- 自动翻译、生词本、快捷键、暗黑模式、多引擎、模型选择、整页/批量翻译

## 已知坑（历史教训）

- 输入框打字失灵：别在无选中时调 `removeAllRanges()` 清选中（会让输入框丢焦点）。
- 快速拖动选词偶发按钮不出现：用固定延时发送，**不要**用可重置的防抖。
- B站评论按钮位置错乱：按钮定位用选区的 `getBoundingClientRect`，坐标失效时兜底用鼠标位置。
- 代码注释、commit message 都用中文。

## Git / 发布

- GitHub 已发布（`silicon-trex/翻译助手`），MIT License（Copyright (c) 2026 silicon-trex）。
- 仓库里**没有**真实 API key：用户自己填在 options 页，代码里只有校验用的 `key.startsWith('sk-')` 和占位符 `placeholder="sk-..."`，都只是提示格式。
- 发 Release 时产物 = `npm run zip` 生成的 zip。

## 沟通偏好

- 用户是编程初学者（学过 Java/MyBatis/MySQL/Spring），**讲解用大白话 + 类比 + 结构化**，别堆术语。
- 用户偏好：改之前先讨论、先讲原因再动手、不要自作主张加功能。
