# 翻译助手 (Translation Assistant)

一个基于 DeepSeek API 的 Chrome/Edge 划词翻译扩展。选中网页上的文字即可翻译，支持中英互翻。

## ✨ 功能特性

- 🖱️ **划词翻译** — 选中文字自动弹出"翻"按钮
- 🌐 **DeepSeek v4-flash** — 高质量翻译，自动检测中英方向
- ⚡ **翻译缓存** — 重复翻译同一段文字秒出，缓存命中显示标记，省时省钱
- 💬 **Shadow DOM 支持** — 兼容 B站、抖音等使用 Shadow DOM 渲染评论区的网站
- 🔍 **全屏模式支持** — 抖音放大/全屏模式下也能正常翻译
- 📜 **长文本滚动** — 长翻译内容可滚动查看，标题栏固定不动
- 📌 **多浮窗置顶** — 可同时钉多个翻译在屏幕上，互相独立
- 🖱️ **浮窗拖动** — 浮窗可拖到屏幕任意位置
- 📋 **一键复制** — 复制翻译结果到剪贴板
- ⚙️ **API 管理** — 设置页面配置 DeepSeek API 密钥

## 🚀 安装使用

### 方式一：从 Release 下载（普通用户，无需安装环境）

1. 前往 [Releases 页面](https://github.com/silicon-trex/translation-assistant/releases)
2. 下载最新的 `.zip` 安装包
3. 解压 zip
4. 打开 `chrome://extensions`（或 `edge://extensions`）
5. 打开"开发者模式"
6. 点击"加载已解压的扩展程序"
7. 选择解压后的文件夹

### 方式二：从源码构建（开发者）

1. 克隆或下载本仓库
2. 安装依赖：
   ```bash
   npm install
   ```
3. 构建扩展：
   ```bash
   npm run build
   ```
4. 打开 `chrome://extensions`（或 `edge://extensions`）
5. 打开"开发者模式"
6. 点击"加载已解压的扩展程序"
7. 选择 `.output/chrome-mv3/` 文件夹

### 方式三：使用 `npm run dev` 开发模式

```bash
npm run dev
```

会自动监听代码变化并重新构建。

## ⚙️ 配置 API 密钥

1. 前往 [DeepSeek 开放平台](https://platform.deepseek.com) 注册并获取 API 密钥
2. 在扩展的"扩展程序选项"（设置页）中填入 API 密钥
3. 点击"测试翻译"验证连接

## 🛠️ 技术栈

- [WXT](https://wxt.dev) — 浏览器扩展开发框架
- [Vite](https://vitejs.dev) — 构建工具
- [DeepSeek API](https://platform.deepseek.com) — 翻译引擎
- TypeScript

## 📁 项目结构

```
翻译助手/
├── entrypoints/
│   ├── background.ts          # 后台脚本（调用 DeepSeek API）
│   ├── content.ts             # 内容脚本（UI、浮窗、翻译逻辑）
│   ├── selection-main-world.ts # 主世界检测脚本（解决 Shadow DOM 问题）
│   └── options.html           # 设置页面
├── options-script.ts          # 设置页逻辑
├── public/icons/              # 扩展图标
├── wxt.config.ts              # WXT 配置
└── package.json
```

## 📄 License

MIT
