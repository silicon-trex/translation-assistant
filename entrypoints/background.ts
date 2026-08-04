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
      model: 'deepseek-v4-flash',
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
async function handleTranslate(text: string, targetLang: string, apiKey: string): Promise<{ success: boolean; data?: string; cached?: boolean; error?: string }> {
  const key = makeKey(text, targetLang);

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

  // 3. 调 API（成功才缓存）
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

export default defineBackground(() => {
  // 启动时加载缓存
  loadCache();

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
  });
});
