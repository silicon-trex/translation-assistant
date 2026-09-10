// ─── 截图翻译：圈选蒙层 ─────────────────────────────
// 交互：先截一张当前可视区的图 → 拿它当蒙层背景铺满视口（"冻结画面"）
//      → 用户拖框选一块 → 用 canvas 裁剪 → 返回 base64
//
// 为什么"先截图，再显示蒙层"（而不是反过来）：
//   1. captureVisibleTab 截的是浏览器【渲染出来的画面】，先显示蒙层的话蒙层会被截进去
//   2. 冻结画面能免疫"用户选的过程中网页还在动/在滚"

export interface CropResult {
  /** 裁剪出来的图片，PNG 格式的 base64（不带 data: 前缀） */
  base64: string;
  /** 选框在视口里的 CSS 坐标，用来决定翻译浮窗弹在哪 */
  rect: { left: number; top: number; width: number; height: number };
}

const OVERLAY_STYLES = `
.shot-overlay {
  position: fixed;
  inset: 0;
  z-index: 2147483645;
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
  /* :host 里那句 all:initial 会把字体打回衬线体，这里必须自己再声明一次 */
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}

.shot-freeze {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}

.shot-box {
  position: absolute;
  border: 1px solid #4f46e5;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
  pointer-events: none;
}

.shot-hint {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  text-align: center;
}

.shot-privacy {
  font-size: 12px;
  opacity: 0.72;
}
`;

/** 选框小于这个尺寸（CSS 像素）判定为误触，直接取消 */
const MIN_SELECTION_SIZE = 12;

export class ScreenshotOverlay {
  private shadow: ShadowRoot;
  private root: HTMLDivElement | null = null;
  private box: HTMLDivElement | null = null;
  private freezeImg: HTMLImageElement | null = null;

  private startX = 0;
  private startY = 0;
  private dragging = false;
  private settled = false;

  // 拖拽过程中挂在 document 上的监听（结束时必须摘掉）
  private onMove = (e: MouseEvent) => this.handleMove(e);
  private onUp = (e: MouseEvent) => this.handleUp(e);
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.finish(null);
    }
  };

  constructor(shadow: ShadowRoot) {
    this.shadow = shadow;
  }

  /**
   * 显示蒙层，等用户框选。
   * @param dataUrl captureVisibleTab 拿到的截图（data:image/png;base64,...）
   * @returns 裁剪结果；用户按 Esc 或误触过小时返回 null
   */
  async start(dataUrl: string): Promise<CropResult | null> {
    const img = await this.loadImage(dataUrl);
    if (!img) return null;

    this.settled = false;
    this.dragging = false;

    // 样式只注入一次
    if (!this.shadow.querySelector('style[data-shot]')) {
      const style = document.createElement('style');
      style.setAttribute('data-shot', '');
      style.textContent = OVERLAY_STYLES;
      this.shadow.appendChild(style);
    }

    const root = document.createElement('div');
    root.className = 'shot-overlay';
    // 让焦点落在蒙层上：否则焦点可能还停在页面/iframe 里，Esc 事件收不到
    root.tabIndex = -1;

    img.className = 'shot-freeze';

    const box = document.createElement('div');
    box.className = 'shot-box';
    box.style.left = '0px';
    box.style.top = '0px';
    box.style.width = '0px';
    box.style.height = '0px';

    const hint = document.createElement('div');
    hint.className = 'shot-hint';
    hint.innerHTML =
      '拖动选择要翻译的区域，按 Esc 取消' +
      '<br><span class="shot-privacy">框选的内容会发送到 DeepSeek 进行识别和翻译</span>';

    root.appendChild(img);
    root.appendChild(box);
    root.appendChild(hint);
    this.shadow.appendChild(root);

    this.root = root;
    this.box = box;
    this.freezeImg = img;
    root.focus();

    // 等一帧再挂监听，避免把触发快捷键的那一下误当成拖拽起点
    await this.nextFrame();

    root.addEventListener('mousedown', (e) => this.handleDown(e));
    document.addEventListener('keydown', this.onKeyDown, true);

    return new Promise<CropResult | null>((resolve) => {
      this.resolve = resolve;
    });
  }

  private resolve: ((r: CropResult | null) => void) | null = null;

  // ── 拖拽 ──
  private handleDown(e: MouseEvent) {
    if (this.dragging) return;
    this.dragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.updateBox(e.clientX, e.clientY);

    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseup', this.onUp);
  }

  private handleMove(e: MouseEvent) {
    if (!this.dragging) return;
    this.updateBox(e.clientX, e.clientY);
  }

  private handleUp(e: MouseEvent) {
    if (!this.dragging) return;
    this.dragging = false;
    this.updateBox(e.clientX, e.clientY);

    const width = Math.abs(e.clientX - this.startX);
    const height = Math.abs(e.clientY - this.startY);

    // 误触（点一下没怎么拖）→ 当作取消
    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      this.finish(null);
      return;
    }

    const left = Math.min(this.startX, e.clientX);
    const top = Math.min(this.startY, e.clientY);
    const base64 = this.crop(left, top, width, height);
    this.finish(base64 ? { base64, rect: { left, top, width, height } } : null);
  }

  /** 支持往左上方向反着拖 */
  private updateBox(curX: number, curY: number) {
    if (!this.box) return;
    const left = Math.min(this.startX, curX);
    const top = Math.min(this.startY, curY);
    this.box.style.left = `${left}px`;
    this.box.style.top = `${top}px`;
    this.box.style.width = `${Math.abs(curX - this.startX)}px`;
    this.box.style.height = `${Math.abs(curY - this.startY)}px`;
  }

  // ── 裁剪 ──
  private crop(left: number, top: number, width: number, height: number): string | null {
    const img = this.freezeImg;
    if (!img) return null;

    // 换算基准锚在【背景图自己的渲染矩形】上，而不是 window.innerWidth：
    // 截图之后窗口被 resize / 进出全屏时，innerWidth 会变，而背景图是被拉伸铺满的，
    // 两者就对不上了。用 img 的实时 rect 算，永远同步。
    const box = img.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;

    // 截图是【物理像素】，拖框是【CSS 像素】，两者差一个缩放比。
    // 不直接读 devicePixelRatio，用 naturalWidth / 渲染宽度 反推更稳：
    // Windows 125%/150% 缩放、多显示器不同缩放比，都能自动算对。
    const scaleX = img.naturalWidth / box.width;
    const scaleY = img.naturalHeight / box.height;

    // 先把选框 clamp 到背景图范围内（用户可能拖到视口外）
    const x0 = Math.max(0, Math.min(left - box.left, box.width));
    const y0 = Math.max(0, Math.min(top - box.top, box.height));
    const x1 = Math.max(0, Math.min(left + width - box.left, box.width));
    const y1 = Math.max(0, Math.min(top + height - box.top, box.height));

    // 源矩形【必须】落在图片边界内：一旦越界，drawImage 不会剪裁，
    // 而是把目标矩形按比例整体缩放 —— 裁出来会又小又错位。
    const sx = Math.max(0, Math.min(Math.round(x0 * scaleX), img.naturalWidth - 1));
    const sy = Math.max(0, Math.min(Math.round(y0 * scaleY), img.naturalHeight - 1));
    const sw = Math.max(1, Math.min(Math.round((x1 - x0) * scaleX), img.naturalWidth - sx));
    const sh = Math.max(1, Math.min(Math.round((y1 - y0) * scaleY), img.naturalHeight - sy));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    // 截的是文字，用 PNG 无损，避免 JPEG 压缩糊掉笔画
    return canvas.toDataURL('image/png').split(',')[1] || null;
  }

  // ── 收尾 ──
  private finish(result: CropResult | null) {
    if (this.settled) return;
    this.settled = true;

    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseup', this.onUp);
    document.removeEventListener('keydown', this.onKeyDown, true);

    // 先断开 src 再移除节点：一张大截图的 dataURL 是几十 MB 的字符串，
    // 留着会让开着很久的标签页悄悄吃内存
    if (this.freezeImg) this.freezeImg.src = '';
    this.root?.remove();
    this.root = null;
    this.box = null;
    this.freezeImg = null;
    this.dragging = false;

    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(result);
  }

  private loadImage(dataUrl: string): Promise<HTMLImageElement | null> {
    return new Promise((resolve) => {
      const img = document.createElement('img');
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  private nextFrame(): Promise<void> {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }
}
