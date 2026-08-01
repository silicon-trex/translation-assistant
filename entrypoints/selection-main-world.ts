import { defineUnlistedScript } from 'wxt/sandbox';

// 这个脚本会被 injectScript 注入到页面主世界运行
// 职责：检测 Shadow DOM 里的选中文字，通过 postMessage 通知 ISOLATED 脚本
export default defineUnlistedScript(() => {
  let lastText = '';
  let mouseX = 0, mouseY = 0;
  let detectTimer: ReturnType<typeof setTimeout> | null = null;

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

  function checkAndSend() {
    try {
      const sel = window.getSelection();
      // 全屏/放大模式下 sel.toString() 会返回空，但 getRangeAt(0).toString() 有内容
      let text = sel ? sel.toString().trim() : '';
      if (!text && sel && sel.rangeCount > 0) {
        try {
          text = sel.getRangeAt(0).toString().trim();
        } catch {}
      }
      if (text && text !== lastText) {
        lastText = text;
        const rect = getSelectionRect();
        window.postMessage({
          type: 'FYLZ_SELECTION',
          text,
          rect,
          mouseX,
          mouseY,
        }, '*');
      } else if (!text && lastText) {
        // 选中被清空（比如点击了别处）→ 通知隔离脚本收起按钮
        lastText = '';
        window.postMessage({ type: 'FYLZ_CLEAR' }, '*');
      } else if (!text) {
        lastText = '';
      }
    } catch {
      // 忽略异常
    }
  }

  // 即时检测（防抖 100ms，比轮询快）
  document.addEventListener('selectionchange', () => {
    if (detectTimer) clearTimeout(detectTimer);
    detectTimer = setTimeout(checkAndSend, 100);
  }, { passive: true });

  // 轮询兜底
  setInterval(checkAndSend, 200);
});
