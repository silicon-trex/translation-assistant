import { defineBackground } from 'wxt/sandbox';

// ─── 翻译缓存 ──────────────────────────────────────
const MAX_CACHE_SIZE = 500;          // 缓存最多条数（FIFO 淘汰）
const MAX_CACHE_LENGTH = 500;        // 只缓存 500 字符以内的文本
const STORAGE_KEY = 'translationCache';

// 内存缓存：key -> 翻译结果
let cache = new Map<string, string>();
// 在途去重表：key -> 进行中的 Promise（同一段文字只调一次 API）
const inflight = new Map<string, Promise<string>>();
// 防抖保存定时器
let saveTimer: ReturnType<typeof setTimeout> | null = null;

// 缓存 key 规范化：去空格 + 忽略大小写（符号保留，因可能影响意思）
function normalizeKey(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function makeKey(text: string, targetLang: string): string {
  return normalizeKey(text) + '|' + targetLang;
}

// 启动时从 storage 加载缓存
async function loadCache() {
  try {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    if (data && data[STORAGE_KEY]) {
      const arr = data[STORAGE_KEY] as [string, string][];
      cache = new Map(arr.slice(-MAX_CACHE_SIZE));
    }
  } catch {
    cache = new Map();
  }
}

// 防抖写 storage（5 秒内多次变化只写一次）
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveCache();
  }, 5000);
}

async function saveCache() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [...cache.entries()] });
  } catch {
    // 写入失败静默忽略（如超过配额），不影响功能
  }
}

// 查缓存
function cacheGet(key: string): string | undefined {
  return cache.get(key);
}

// 存缓存（FIFO 淘汰最旧的）
function cacheSet(key: string, value: string) {
  if (cache.has(key)) {
    cache.delete(key); // 重新插入，让它排到最新
  }
  cache.set(key, value);
  while (cache.size > MAX_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
  scheduleSave();
}

// ─── API 密钥 ──────────────────────────────────────
async function getApiKey(): Promise<string> {
  const result = await chrome.storage.sync.get('deepseekApiKey');
  return result.deepseekApiKey || '';
}

// ─── 调用 DeepSeek API ─────────────────────────────
async function translateText(text: string, targetLang: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [
        {
          role: 'system',
          content:
            '你是一位专业的翻译助手。\n' +
            '把 <content> 标签里的内容翻译成指定的目标语言。\n' +
            '只输出翻译结果，不要解释，不要多余内容。\n' +
            '翻译要自然、准确。',
        },
        {
          role: 'user',
          content: `<content>${text}</content>\n翻译目标语言：${targetLang}`,
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`翻译服务异常 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
}

// ─── 翻译请求处理（缓存优先） ─────────────────────
async function handleTranslate(text: string, targetLang: string, apiKey: string, force = false): Promise<{ success: boolean; data?: string; cached?: boolean; error?: string }> {
  const key = makeKey(text, targetLang);

  // force = 用户点了「重新翻译」：跳过缓存直接重问，
  // 否则会被第一次那个"不合格"的缓存永远锁死
  if (!force) {
    // 1. 查缓存
    const cached = cacheGet(key);
    if (cached) {
      return { success: true, data: cached, cached: true };
    }

    // 2. 在途去重：同一段文字正在翻译中 → 共享结果（不重复调 API）
    if (inflight.has(key)) {
      const result = await inflight.get(key);
      return { success: true, data: result };
    }
  }

  // 3. 调 API（成功才缓存）
  //    重翻的新结果会【覆盖】旧缓存 —— 用户"翻到满意为止"，以最后一次为准
  const promise = translateText(text, targetLang, apiKey)
    .then((result) => {
      // 只缓存较短的文本，且成功结果才缓存
      if (text.length <= MAX_CACHE_LENGTH) {
        cacheSet(key, result);
      }
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  const result = await promise;
  return { success: true, data: result };
}

// ─── 图片翻译（截图翻译用）─────────────────────────
async function translateImage(
  dataUrl: string,
  apiKey: string,
): Promise<{ original: string; translation: string }> {
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-flash',
      messages: [
        {
          role: 'system',
          content:
            '你是专业的 OCR + 翻译助手。\n' +
            '1. 先识别图片中的文字，原样保留，不要翻译、不要改写、不要补充。\n' +
            '2. 再把识别出的文字翻译一次：若图中文字主要是中文，翻译成英文；否则翻译成中文。\n' +
            '严格按下面的格式输出，不要输出任何其他内容：\n' +
            '<原文>\n识别出的文字\n</原文>\n' +
            '<译文>\n翻译结果\n</译文>\n' +
            '若图中没有可识别的文字，输出 <原文></原文><译文>未识别到文字</译文>',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请识别并翻译这张图片。' },
            // detail: 'high' —— 截图里全是小字，别用 low（会缩到 512×512 把字糊掉）
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`翻译服务异常 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const raw = (data.choices?.[0]?.message?.content ?? '').trim();
  return parseOcrResult(raw);
}

/** 解析模型返回的 <原文>/<译文> 标签；标签缺失时降级成"整段当译文"，保证结果不丢 */
function parseOcrResult(raw: string): { original: string; translation: string } {
  // 模型有时会自作主张套个 markdown 代码块，先剥掉
  const s = raw.replace(/```[a-z]*/gi, '').trim();
  const o = s.match(/<原文>([\s\S]*?)<\/原文>/);
  const t = s.match(/<译文>([\s\S]*?)<\/译文>/);
  if (t) {
    return { original: (o?.[1] ?? '').trim(), translation: t[1].trim() };
  }
  return { original: '', translation: s };
}

// ─── 截图翻译：触发入口 ─────────────────────────────
// 快捷键或点工具栏图标 → 通知当前标签页的内容脚本进入截图模式
async function startScreenshotOnActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { action: 'start-screenshot' });
  } catch {
    // 当前页面不支持截图（chrome:// 页、扩展商店等），或内容脚本没注入 → 静默忽略
  }
}

export default defineBackground(() => {
  // 启动时加载缓存
  loadCache();

  // 快捷键触发（Ctrl+Shift+X）
  chrome.commands.onCommand.addListener((command) => {
    if (command === 'screenshot-translate') startScreenshotOnActiveTab();
  });

  // 点工具栏图标触发（快捷键的备用入口）
  chrome.action.onClicked.addListener(() => {
    startScreenshotOnActiveTab();
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'translate') {
      (async () => {
        try {
          const apiKey = await getApiKey();
          if (!apiKey) {
            sendResponse({
              success: false,
              error: '请先在扩展设置中配置 DeepSeek API 密钥',
            });
            return;
          }

          const result = await handleTranslate(
            request.text,
            request.targetLang || '中文',
            apiKey,
            request.force === true,
          );
          sendResponse(result);
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : '翻译失败，请重试',
          });
        }
      })();
      return true; // 保持消息通道打开，等待异步响应
    }

    if (request.action === 'translate-image') {
      (async () => {
        try {
          const apiKey = await getApiKey();
          if (!apiKey) {
            sendResponse({
              success: false,
              error: '请先在扩展设置中配置 DeepSeek API 密钥',
            });
            return;
          }
          const result = await translateImage(request.image, apiKey);
          sendResponse({
            success: true,
            original: result.original,
            data: result.translation,
          });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : '翻译失败，请重试',
          });
        }
      })();
      return true;
    }

    if (request.action === 'capture-screenshot') {
      (async () => {
        try {
          // 截当前可视区域：PNG 无损，文字边缘不会被压缩糊掉
          const dataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
          sendResponse({ success: true, dataUrl });
        } catch (error) {
          sendResponse({
            success: false,
            error: error instanceof Error ? error.message : '当前页面无法截图',
          });
        }
      })();
      return true;
    }

    // 兜底：未知请求也必须回一个响应，否则调用方的 sendMessage 会永远 pending
    sendResponse({ success: false, error: '未知请求' });
    return false;
  });
});
