import { defineBackground } from 'wxt/sandbox';

// 从 storage 读取 API 密钥
async function getApiKey(): Promise<string> {
  const result = await chrome.storage.sync.get('deepseekApiKey');
  return result.deepseekApiKey || '';
}

// 调用 DeepSeek API 进行翻译
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

export default defineBackground(() => {
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

          const result = await translateText(
            request.text,
            request.targetLang || '中文',
            apiKey,
          );
          sendResponse({ success: true, data: result });
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
