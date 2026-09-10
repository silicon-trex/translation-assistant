import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  extensionApi: 'chrome',
  manifest: {
    name: '翻译助手',
    description: '划词翻译工具 - 选中文本即可翻译',
    version: '1.2.0',
    // activeTab：截图翻译要用 chrome.tabs.captureVisibleTab 截当前标签页
    permissions: ['storage', 'activeTab'],
    // 工具栏图标：点它也能触发截图翻译（快捷键的备用入口）
    action: {},
    // 快捷键：Ctrl+Shift+X 触发截图翻译
    commands: {
      'screenshot-translate': {
        suggested_key: { default: 'Ctrl+Shift+X' },
        description: '截图翻译',
      },
    },
    icons: {
      16: 'icons/16.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    web_accessible_resources: [
      {
        resources: ['selection-main-world.js'],
        matches: ['<all_urls>'],
      },
    ],
  },
});
