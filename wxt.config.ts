import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  extensionApi: 'chrome',
  manifest: {
    name: '翻译助手',
    description: '划词翻译工具 - 选中文本即可翻译',
    version: '1.1.2',
    permissions: ['storage'],
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
