import { defineUnlistedScript } from 'wxt/sandbox';

// 这个脚本会被 injectScript 注入到页面主世界运行
// 职责：检测 Shadow DOM 里的选中文字，通过 postMessage 通知 ISOLATED 脚本
export default defineUnlistedScript(() => {
  let lastSentText = '';
  let pendingText = '';
  let pendingRect: { top: number; bottom: number; left: number; right: number } | null = null;
  let mouseX = 0, mouseY = 0;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let timerActive = false;
  let emptyCount = 0;

  // 记录鼠标位置，作为坐标失效时的兜底
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  }, { passive: true });

  // 多方法获取选中区域坐标
  function getSelectionRect(): { top: number; bottom: number; left: number; right: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);

    // 方法1: getBoundingClientRect
    try {
      const r = range.getBoundingClientRect();
      if (r && (r.width > 0 || r.height > 0)) {
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      }
    } catch {}

    // 方法2: getClientRects
    try {
      const rects = range.getClientRects();
      if (rects && rects.length > 0) {
        const r = rects[rects.length - 1];
        if (r && (r.width > 0 || r.height > 0)) {
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }
      }
    } catch {}

    // 方法3: 找选中元素的父节点
    try {
      const node = sel.focusNode;
      const el = node ? (node.nodeType === 1 ? node as Element : node.parentElement) : null;
      if (el) {
        const r = el.getBoundingClientRect();
        if (r && (r.width > 0 || r.height > 0)) {
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        }
      }
    } catch {}

    return null;
  }

  // 读取当前选中的文字（带 getRangeAt 兜底）
  function readText(): string {
    try {
      const sel = window.getSelection();
      let text = sel ? sel.toString().trim() : '';
      if (!text && sel && sel.rangeCount > 0) {
        try {
          text = sel.getRangeAt(0).toString().trim();
        } catch {}
      }
      return text;
    } catch {
      return '';
    }
  }

  // 立即发送当前记住的选中
  function sendNow() {
    if (pendingText && pendingText !== lastSentText) {
      lastSentText = pendingText;
      window.postMessage({
        type: 'FYLZ_SELECTION',
        text: pendingText,
        rect: pendingRect,
        mouseX,
        mouseY,
      }, '*');
    }
  }

  // 固定延时发送（不是可重置的防抖）：
  // 快速拖动时，即使选中很快被清空，我们也已经捕获到了文字
  function scheduleSend() {
    if (timerActive) return;
    timerActive = true;
    sendTimer = setTimeout(() => {
      timerActive = false;
      sendNow();
    }, 100);
  }

  // selectionchange：立即捕获选中文字（不等防抖），固定延时发送
  document.addEventListener('selectionchange', () => {
    const text = readText();
    if (text) {
      pendingText = text;
      pendingRect = getSelectionRect();
      emptyCount = 0;
      scheduleSend();
    }
  }, { passive: true });

  // 轮询兜底：负责显示兜底 + 确认清空后再发 FYLZ_CLEAR
  setInterval(() => {
    const text = readText();
    if (text) {
      pendingText = text;
      pendingRect = getSelectionRect();
      emptyCount = 0;
      sendNow();
    } else {
      // 连续 3 次（约 600ms）都空，才认为是真的清空了
      emptyCount++;
      if (emptyCount >= 3) {
        if (lastSentText) {
          lastSentText = '';
          window.postMessage({ type: 'FYLZ_CLEAR' }, '*');
        }
        pendingText = '';
        pendingRect = null;
      }
    }
  }, 200);
});
