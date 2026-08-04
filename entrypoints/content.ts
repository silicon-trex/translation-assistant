import { defineContentScript } from 'wxt/sandbox';
import { injectScript } from 'wxt/client';

// ─── 样式 ───────────────────────────────────────────
const STYLES = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.trans-popup {
  position: fixed;
  z-index: 2147483647;
  background: #ffffff;
  border-radius: 12px;
  min-width: 240px;
  max-width: 380px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 2px 8px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.popup-header {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: #f8f8fb;
  border-bottom: 1px solid #eee;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}

.popup-header:active {
  cursor: grabbing;
}

.popup-header .pin-btn {
  background: none;
  border: none;
  padding: 2px 6px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  transition: background 0.15s;
}

.popup-header .pin-btn:hover { background: #e8e8ee; }
.popup-header .pin-btn.pinned { color: #4f46e5; }

.popup-header .title {
  flex: 1;
  font-size: 12px;
  color: #999;
  text-align: center;
  font-weight: 500;
}

.popup-header .close-btn {
  background: none;
  border: none;
  padding: 2px 6px;
  font-size: 14px;
  cursor: pointer;
  border-radius: 4px;
  line-height: 1;
  color: #aaa;
  transition: background 0.15s, color 0.15s;
}

.popup-header .close-btn:hover { background: #e8e8ee; color: #555; }

.popup-body { padding: 10px 14px 14px; }

.popup-body .original {
  font-size: 13px;
  color: #888;
  margin-bottom: 6px;
  word-break: break-word;
  line-height: 1.4;
}

.popup-body .result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.popup-body .result-text {
  font-size: 15px;
  color: #1a1a1a;
  line-height: 1.5;
  word-break: break-word;
  flex: 1;
}

.popup-body .language-hint {
  font-size: 11px;
  color: #aaa;
  margin-top: 6px;
}

.popup-body .copy-btn {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: #f0f0f0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  font-size: 13px;
  color: #555;
}

.popup-body .copy-btn:hover { background: #e0e0e0; }
.popup-body .copy-btn.copied { background: #34d399; color: white; }

.popup-body .loading {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #999;
  font-size: 14px;
}

.popup-body .spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #e5e7eb;
  border-top-color: #6b7280;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.popup-body .error { color: #ef4444; font-size: 13px; line-height: 1.4; }

/* ── 触发按钮 ── */
.trans-trigger {
  position: fixed;
  z-index: 2147483646;
  background: #4f46e5;
  color: white;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 13px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.35);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity 0.15s ease, transform 0.15s ease;
  pointer-events: none;
  font-weight: 500;
  letter-spacing: 0.3px;
}

.trans-trigger.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}

.trans-trigger:hover { background: #4338ca; }
`;

// ─── 单个浮窗实例 ──────────────────────────────
class PopupInstance {
  readonly el: HTMLDivElement;
  isPinned = false;
  private selectedText = '';
  private targetLang = '';
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;

  constructor(
    private shadow: ShadowRoot,
    private text: string,
    top: number,
    left: number,
    private onClose?: () => void,
  ) {
    this.selectedText = text;

    this.el = document.createElement('div');
    this.el.className = 'trans-popup';
    this.el.style.top = `${top}px`;
    this.el.style.left = `${left}px`;
    this.shadow.appendChild(this.el);

    this.showLoading();
  }

  // ── 头部 ──
  private buildHeader() {
    const header = document.createElement('div');
    header.className = 'popup-header';

    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin-btn';
    pinBtn.textContent = '📌';
    pinBtn.title = '置顶窗口';
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePin(pinBtn);
    });
    header.appendChild(pinBtn);

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = '翻译助手';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });
    header.appendChild(closeBtn);

    // 拖动
    header.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.startDrag(e);
    });

    return header;
  }

  // ── 置顶 ──
  private togglePin(btn: HTMLButtonElement) {
    this.isPinned = !this.isPinned;
    btn.className = 'pin-btn' + (this.isPinned ? ' pinned' : '');
    btn.textContent = this.isPinned ? '📍' : '📌';
    btn.title = this.isPinned ? '取消置顶' : '置顶窗口';
  }

  // ── 拖动 ──
  private startDrag(e: MouseEvent) {
    this.isDragging = true;
    const rect = this.el.getBoundingClientRect();
    this.dragOffsetX = e.clientX - rect.left;
    this.dragOffsetY = e.clientY - rect.top;

    const onMove = (ev: MouseEvent) => {
      if (!this.isDragging) return;
      this.el.style.left = `${ev.clientX - this.dragOffsetX}px`;
      this.el.style.top = `${ev.clientY - this.dragOffsetY}px`;
      this.el.style.transform = 'none';
    };

    const onUp = () => {
      this.isDragging = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── 加载 ──
  private showLoading() {
    const header = this.buildHeader();
    const body = document.createElement('div');
    body.className = 'popup-body';
    body.innerHTML = `
      <div class="original">${this.escapeHtml(this.selectedText)}</div>
      <div class="loading">
        <div class="spinner"></div>
        <span>翻译中...</span>
      </div>
    `;
    this.el.appendChild(header);
    this.el.appendChild(body);
  }

  // ── 结果 ──
  showResult(data: string, sourceLang: string, targetLang: string, cached = false) {
    this.targetLang = targetLang;
    this.el.innerHTML = '';

    const header = this.buildHeader();
    const body = document.createElement('div');
    body.className = 'popup-body';
    body.innerHTML = `
      <div class="original">${this.escapeHtml(this.selectedText)}</div>
      <div class="result">
        <span class="result-text">${this.escapeHtml(data)}</span>
        <button class="copy-btn" title="复制翻译结果">📋</button>
      </div>
      <div class="language-hint">${sourceLang} → ${targetLang}${cached ? '  ·  ⚡ 缓存' : ''}</div>
    `;

    this.el.appendChild(header);
    this.el.appendChild(body);

    // 复制
    const copyBtn = body.querySelector('.copy-btn') as HTMLButtonElement;
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(data);
          copyBtn.textContent = '✓';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '📋';
            copyBtn.classList.remove('copied');
          }, 1500);
        } catch {
          const ta = document.createElement('textarea');
          ta.value = data;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = '✓';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '📋';
            copyBtn.classList.remove('copied');
          }, 1500);
        }
      });
    }

    // 恢复置顶状态
    if (this.isPinned) {
      const pinBtn = this.el.querySelector('.pin-btn') as HTMLButtonElement;
      if (pinBtn) {
        pinBtn.className = 'pin-btn pinned';
        pinBtn.textContent = '📍';
        pinBtn.title = '取消置顶';
      }
    }
  }

  // ── 错误 ──
  showError(message: string) {
    this.el.innerHTML = '';
    const header = this.buildHeader();
    const body = document.createElement('div');
    body.className = 'popup-body';
    body.innerHTML = `
      <div class="original">${this.escapeHtml(this.selectedText)}</div>
      <div class="error">⚠️ ${this.escapeHtml(message)}</div>
    `;
    this.el.appendChild(header);
    this.el.appendChild(body);
  }

  // ── 关闭 ──
  hide() {
    this.el.remove();
    this.onClose?.();
  }

  // ── 工具 ──
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ─── 主管理类 ──────────────────────────────────────
class TranslationManager {
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;
  private trigger: HTMLButtonElement | null = null;
  private instances: PopupInstance[] = [];
  private selectedText = '';
  private triggerCooldown = false;
  private lastPopupCreatedAt = 0;
  private isTriggerPressed = false;

  init() {
    if (this.host) return;

    this.host = document.createElement('div');
    this.host.id = 'translation-assistant-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = STYLES;
    this.shadow.appendChild(style);

    // 触发按钮
    this.trigger = document.createElement('button');
    this.trigger.className = 'trans-trigger';
    this.trigger.textContent = '翻';
    this.shadow.appendChild(this.trigger);

    document.body.appendChild(this.host);

    // 按下瞬间"抓住"指针：鼠标移动也能正常触发 click
    this.trigger.addEventListener('pointerdown', (e) => {
      this.isTriggerPressed = true;
      try { (e.target as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    });
    this.trigger.addEventListener('pointerup', () => {
      this.isTriggerPressed = false;
    });
    // mousedown 兜底：万一 pointerdown 被页面拦截，也能标记"正在按"
    this.trigger.addEventListener('mousedown', () => {
      this.isTriggerPressed = true;
    });
    this.trigger.addEventListener('click', () => {
      this.createPopup();
    });

    // ESC 关闭所有未置顶的浮窗
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closeUnpinned();
    });

    // 点击扩展外部 → 关闭未置顶浮窗 + 收起按钮
    document.addEventListener('mousedown', (e) => {
      // 点在我们的区域（按钮/浮窗）→ 标记正在按，防止被收起
      if (this.host && this.host.contains(e.target as Node)) {
        this.isTriggerPressed = true;
        return;
      }
      // 点在外面但正在按按钮 → 也先不收起（等松开再处理）
      if (this.isTriggerPressed) return;
      this.trigger?.classList.remove('visible');
      this.closeUnpinned();
    });

    // 松开鼠标 → 清除"正在按"标记
    document.addEventListener('mouseup', () => {
      this.isTriggerPressed = false;
    });

    // 全屏（放大）时把宿主移进全屏元素，按钮才能显示在视频上层
    document.addEventListener('fullscreenchange', () => {
      this.handleFullscreenChange();
    });
  }

  private handleFullscreenChange() {
    if (!this.host) return;
    const fsEl = document.fullscreenElement;
    if (fsEl) {
      // 进入全屏：把宿主移进全屏元素
      if (fsEl !== document.body && !fsEl.contains(this.host)) {
        fsEl.appendChild(this.host);
      }
    } else {
      // 退出全屏：移回 body
      if (!document.body.contains(this.host)) {
        document.body.appendChild(this.host);
      }
    }
  }

  private getSelectionInfo() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return null;
      const text = sel.toString().trim();
      if (!text || text.length > 5000) return null;
      // 选中状态可能在变化中（如点击按钮清空选中的瞬间），rangeCount 可能是 0
      if (sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      return { text, rect: range.getBoundingClientRect() };
    } catch {
      return null;
    }
  }

  showTrigger() {
    // 刚点完"翻"按钮，短暂冷却
    if (this.triggerCooldown) return;
    const info = this.getSelectionInfo();
    if (!info) return;
    // 按钮已可见且文本没变 → 跳过（拖动/点按钮后文本没变）
    // 按钮不可见但文本相同 → 允许重新显示（防止重复选同段文字时按钮不出现）
    if (this.trigger?.classList.contains('visible') && info.text === this.selectedText) return;
    this.selectedText = info.text;

    if (this.trigger) {
      let top = info.rect.bottom + 6;
      let left = info.rect.left;
      if (left + 40 > window.innerWidth) left = window.innerWidth - 44;
      if (top + 30 > window.innerHeight) top = info.rect.top - 30;
      this.trigger.style.top = `${Math.max(0, top)}px`;
      this.trigger.style.left = `${Math.max(0, left)}px`;
      this.trigger.classList.add('visible');
    }
  }

  // 接收主世界传来的选中文字和位置（解决 Shadow DOM 场景）
  showTriggerAt(text: string, data: {
    rect?: { top: number; bottom: number; left: number; right: number } | null;
    mouseX?: number;
    mouseY?: number;
  }) {
    if (this.triggerCooldown) return;
    if (!text) return;
    // 按钮已可见且文本没变 → 跳过；按钮不可见但文本相同 → 允许重新显示
    if (this.trigger?.classList.contains('visible') && text === this.selectedText) return;
    this.selectedText = text;

    if (this.trigger) {
      const rect = data.rect;
      const rectValid = rect && (rect.bottom > 0 || rect.top > 0) && (rect.left > 0 || rect.right > 0);

      let top: number;
      let left: number;

      if (rectValid) {
        // 正常：按钮在选区下方
        top = rect!.bottom + 6;
        left = rect!.left;
        // 下方空间不足时放上方
        if (top + 30 > window.innerHeight) {
          top = rect!.top - 30;
        }
      } else {
        // 兜底：鼠标位置 + 向下偏移，避免遮挡选中文字
        const my = data.mouseY ?? window.innerHeight / 2;
        const mx = data.mouseX ?? window.innerWidth / 2;
        top = my + 18;
        left = mx - 20;
        // 下方空间不足时放上方
        if (top + 30 > window.innerHeight) {
          top = my - 40;
        }
      }

      if (left + 40 > window.innerWidth) left = window.innerWidth - 44;
      left = Math.max(0, left);

      this.trigger.style.top = `${Math.max(0, top)}px`;
      this.trigger.style.left = `${left}px`;
      this.trigger.classList.add('visible');
    }
  }

  private async createPopup() {
    if (!this.shadow || !this.selectedText) return;

    // 隐藏触发按钮
    this.trigger?.classList.remove('visible');
    // 冷却 500ms，防止 mouseup 延迟触发又把按钮亮出来
    this.triggerCooldown = true;
    setTimeout(() => { this.triggerCooldown = false; }, 500);

    // 计算新浮窗位置（选区附近）
    let top = 100, left = 100;
    try {
      const info = this.getSelectionInfo();
      if (info) {
        top = info.rect.bottom + 6;
        left = info.rect.left;
        if (left + 380 > window.innerWidth) left = window.innerWidth - 390;
        if (top + 80 > window.innerHeight) top = info.rect.top - 80;
      }
    } catch {
      // 位置计算失败就用默认位置，确保翻译框一定能弹出来
    }

    // 偏移一下，避免和已有浮窗完全重叠
    const offset = this.instances.length * 20;
    top += offset;
    left += offset;

    const popup = new PopupInstance(
      this.shadow, this.selectedText,
      Math.max(0, top), Math.max(0, left),
      () => this.onPopupClosed(popup),
    );
    this.instances.push(popup);
    // 记录创建时间，用于保护期（防止点"翻"时误关）
    this.lastPopupCreatedAt = Date.now();

    // 调用翻译
    try {
      const sourceLang = this.detectLanguage(this.selectedText);
      const targetLang = sourceLang === '中文' ? '英文' : '中文';

      const response = await chrome.runtime.sendMessage({
        action: 'translate',
        text: this.selectedText,
        targetLang,
      });

      if (response?.success) {
        popup.showResult(response.data, sourceLang, targetLang, response.cached === true);
      } else {
        popup.showError(response?.error || '翻译失败');
      }
    } catch {
      popup.showError('网络错误，请检查网络连接');
    }
  }

  // 关闭所有未置顶的浮窗
  // 单个浮窗被关闭（点击 ✕）
  private onPopupClosed(popup: PopupInstance) {
    this.instances = this.instances.filter(p => p !== popup);
    if (this.instances.length === 0) {
      this.trigger?.classList.remove('visible');
    }
  }

  // 选中被清空时：收起按钮 + 关闭未置顶浮窗
  hideTriggerAndUnpinned() {
    // 正在按住"翻"按钮时，不隐藏按钮（防止点击过程按钮消失）
    if (!this.isTriggerPressed) {
      this.trigger?.classList.remove('visible');
    }
    // 刚创建浮窗 1 秒内，忽略"选中被清空"信号
    // （防止点"翻"按钮时页面清空选中，误关刚弹出的翻译框）
    if (Date.now() - this.lastPopupCreatedAt < 1000) return;
    this.closeUnpinned();
  }

  private closeUnpinned() {
    const remaining: PopupInstance[] = [];
    for (const p of this.instances) {
      if (p.isPinned) {
        remaining.push(p);
      } else {
        p.hide();
      }
    }
    this.instances = remaining;
    // 正在按"翻"按钮时不隐藏按钮（防止点击过程按钮消失）
    if (this.instances.length === 0 && !this.isTriggerPressed) {
      this.trigger?.classList.remove('visible');
    }
  }

  private detectLanguage(text: string): string {
    if (/[一-鿿㐀-䶿]/.test(text)) return '中文';
    if (/[぀-ゟ゠-ヿ]/.test(text)) return '日文';
    return '英文';
  }
}

// ─── 入口 ───────────────────────────────────────────
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  world: 'ISOLATED',
  main() {
    const manager = new TranslationManager();
    manager.init();

    // 注入主世界检测脚本（解决 B站评论等 Shadow DOM 场景）
    injectScript('/selection-main-world.js', { keepInDom: true }).catch(() => {});

    // 监听鼠标松开，检测是否选中文本（普通页面用）
    document.addEventListener('mouseup', () => {
      setTimeout(() => manager.showTrigger(), 200);
    });

    // 接收主世界检测脚本发来的选中信息（Shadow DOM 页面用）
    window.addEventListener('message', (event) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'FYLZ_SELECTION') {
        manager.showTriggerAt(event.data.text, event.data);
      } else if (event.data.type === 'FYLZ_CLEAR') {
        // 选中被清空 → 收起按钮 + 关闭未置顶浮窗
        manager.hideTriggerAndUnpinned();
      }
    });
  },
});
