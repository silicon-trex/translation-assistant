// 加载已保存的 API 密钥
async function loadApiKey() {
  const result = await chrome.storage.sync.get('deepseekApiKey');
  const input = document.getElementById('apiKey') as HTMLInputElement;
  if (result.deepseekApiKey) {
    input.value = result.deepseekApiKey;
  }
}

// 保存 API 密钥
async function saveApiKey() {
  const input = document.getElementById('apiKey') as HTMLInputElement;
  const key = input.value.trim();
  const status = document.getElementById('status')!;
  const btn = document.getElementById('saveBtn') as HTMLButtonElement;

  if (!key) {
    showStatus('请填入 API 密钥', 'error');
    return;
  }

  if (!key.startsWith('sk-')) {
    showStatus('API 密钥格式不正确，应以 sk- 开头', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = '保存中...';

  try {
    await chrome.storage.sync.set({ deepseekApiKey: key });
    showStatus('✅ 保存成功！你现在可以开始使用了', 'success');
  } catch (error) {
    showStatus('保存失败：' + (error instanceof Error ? error.message : '未知错误'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

// 测试翻译功能
async function testTranslation() {
  const input = document.getElementById('apiKey') as HTMLInputElement;
  const key = input.value.trim();
  const result = document.getElementById('testResult')!;

  if (!key) {
    result.textContent = '请先填入 API 密钥';
    result.style.color = '#dc2626';
    return;
  }

  result.textContent = '⏳ 测试中...';
  result.style.color = '#666';

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: '将以下内容翻译成中文：Hello, how are you?' },
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const translation = data.choices[0].message.content.trim();
    result.textContent = `✅ 测试成功！翻译结果："${translation}"`;
    result.style.color = '#059669';
  } catch (error) {
    result.textContent = '❌ 测试失败：' + (error instanceof Error ? error.message : '网络错误');
    result.style.color = '#dc2626';
  }
}

function showStatus(message: string, type: 'success' | 'error') {
  const status = document.getElementById('status')!;
  status.textContent = message;
  status.className = `status ${type}`;

  // 3 秒后自动隐藏成功消息
  if (type === 'success') {
    setTimeout(() => {
      status.className = 'status';
    }, 3000);
  }
}

// 页面加载完成后的初始化
document.addEventListener('DOMContentLoaded', () => {
  loadApiKey();

  document.getElementById('saveBtn')!.addEventListener('click', saveApiKey);
  document.getElementById('testBtn')!.addEventListener('click', testTranslation);
});
