/* eslint-disable */

(() => {
  const GLOBAL_KEY = '__MCP_WEB_EDITOR__';
  if (window[GLOBAL_KEY]) return;

  const IS_MAIN = window === window.top;
  const COLORS = {
    hover: '#3b82f6', // blue-500
    selected: '#22c55e', // green-500
    backdrop: 'rgba(15, 23, 42, 0.15)', // slate-900 @ 15%
  };

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  const normalizeTextSnippet = (value, maxLen) => {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLen || 80);
  };

  const containsPoint = (rect, x, y) => {
    if (!rect) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  };

  const getElementLabel = (el) => {
    if (!(el instanceof Element)) return '';
    const tag = String(el.tagName || '').toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const classes =
      el.classList && el.classList.length
        ? `.${Array.from(el.classList).slice(0, 3).join('.')}`
        : '';
    return `${tag}${id}${classes}`;
  };

  const detectTailwind = (classes) => {
    try {
      const patterns = [
        /^bg-/,
        /^text-/,
        /^p[trblxy]?-/,
        /^m[trblxy]?-/,
        /^flex$/,
        /^grid$/,
        /^items-/,
        /^justify-/,
        /^gap-/,
        /^rounded/,
        /^shadow/,
        /^border/,
      ];
      for (const cls of classes || []) {
        if (patterns.some((p) => p.test(cls))) return true;
      }
    } catch {}
    return false;
  };

  const findReactFileFromFiber = (fiber) => {
    try {
      let current = fiber;
      for (let i = 0; i < 40 && current; i++) {
        const src = current._debugSource;
        if (src && src.fileName && typeof src.fileName === 'string') return src.fileName;
        const owner = current._debugOwner;
        const ownerSrc = owner && owner._debugSource;
        if (ownerSrc && ownerSrc.fileName && typeof ownerSrc.fileName === 'string')
          return ownerSrc.fileName;
        current = current.return;
      }
    } catch {}
    return '';
  };

  const findReactSourceFile = (el) => {
    try {
      let node = el;
      for (let depth = 0; depth < 15 && node; depth++) {
        const keys = Object.keys(node);
        for (const k of keys) {
          if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
            const fiber = node[k];
            const found = findReactFileFromFiber(fiber);
            if (found) return found;
          }
        }
        node = node.parentElement;
      }
    } catch {}
    return '';
  };

  const findVueSourceFile = (el) => {
    try {
      let node = el;
      for (let depth = 0; depth < 15 && node; depth++) {
        const inst = node.__vueParentComponent;
        if (inst && inst.type && inst.type.__file) return String(inst.type.__file);
        node = node.parentElement;
      }
    } catch {}
    return '';
  };

  const resolveTargetFile = (el) => {
    try {
      let node = el;
      for (let depth = 0; depth < 20 && node; depth++) {
        const reactFile = findReactSourceFile(node);
        if (reactFile && !reactFile.includes('node_modules')) return reactFile;
        const vueFile = findVueSourceFile(node);
        if (vueFile && !vueFile.includes('node_modules')) return vueFile;
        node = node.parentElement;
      }
    } catch {}
    return '';
  };

  const findMeaningfulElement = (el, clientX, clientY) => {
    try {
      let current = el instanceof Element ? el : null;
      for (let i = 0; i < 8 && current; i++) {
        const tag = String(current.tagName || '').toUpperCase();
        if (tag === 'HTML' || tag === 'BODY') {
          const deeper = document.elementFromPoint(clientX, clientY);
          if (deeper && deeper !== current && deeper instanceof Element) {
            current = deeper;
            continue;
          }
          return current;
        }

        let style;
        try {
          style = window.getComputedStyle(current);
        } catch {
          return current;
        }

        const bg = String(style.backgroundColor || '').toLowerCase();
        const isTransparentBg = bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)';
        const borderWidth = [
          style.borderTopWidth,
          style.borderRightWidth,
          style.borderBottomWidth,
          style.borderLeftWidth,
        ]
          .map((x) => String(x || '0px'))
          .join(',');
        const hasBorder = borderWidth !== '0px,0px,0px,0px';

        if (!isTransparentBg || hasBorder) return current;

        const rect = current.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return current;

        let bestChild = null;
        let bestArea = Infinity;
        const children = Array.from(current.children || []);
        for (const child of children) {
          if (!(child instanceof Element)) continue;
          const r = child.getBoundingClientRect();
          if (!r || r.width <= 0 || r.height <= 0) continue;
          if (!containsPoint(r, clientX, clientY)) continue;
          const area = r.width * r.height;
          if (area < bestArea) {
            bestArea = area;
            bestChild = child;
          }
        }

        if (!bestChild) return current;

        const childRect = bestChild.getBoundingClientRect();
        const sameSize =
          Math.abs(rect.width - childRect.width) < 2 &&
          Math.abs(rect.height - childRect.height) < 2;
        if (!sameSize) return current;

        current = bestChild;
      }
    } catch {}
    return el instanceof Element ? el : null;
  };

  const createToastHost = () => {
    const host = document.createElement('div');
    Object.assign(host.style, {
      position: 'fixed',
      left: '12px',
      bottom: '12px',
      zIndex: 2147483647,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      pointerEvents: 'none',
    });
    return host;
  };

  const showToast = (state, message, kind) => {
    try {
      if (!state.toastHost) return;
      const item = document.createElement('div');
      const bg =
        kind === 'error'
          ? 'rgba(220, 38, 38, 0.92)'
          : kind === 'success'
            ? 'rgba(22, 163, 74, 0.92)'
            : 'rgba(15, 23, 42, 0.92)';
      Object.assign(item.style, {
        background: bg,
        color: '#fff',
        padding: '8px 10px',
        borderRadius: '10px',
        fontSize: '12px',
        fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial',
        boxShadow: '0 6px 18px rgba(0,0,0,0.22)',
        maxWidth: '340px',
        lineHeight: '1.35',
      });
      item.textContent = String(message || '');
      state.toastHost.appendChild(item);
      setTimeout(() => {
        try {
          item.remove();
        } catch {}
      }, 2800);
    } catch {}
  };

  const buildStyleMapFromInput = (raw) => {
    const out = {};
    const text = String(raw || '').trim();
    if (!text) return out;
    const parts = text
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      const idx = part.indexOf(':');
      if (idx <= 0) continue;
      const key = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return out;
  };

  const applyInlineStyleMap = (el, styles) => {
    try {
      if (!(el instanceof Element)) return;
      const entries = Object.entries(styles || {});
      for (const [key, value] of entries) {
        if (!key || !value) continue;
        try {
          el.style.setProperty(key, value);
        } catch {}
      }
    } catch {}
  };

  const state = {
    active: false,
    root: null,
    canvas: null,
    ctx: null,
    raf: 0,
    dpr: 1,
    viewport: { w: 0, h: 0 },
    hoveredEl: null,
    selectedEl: null,
    hoverRect: null,
    selectedRect: null,
    toolbar: null,
    toastHost: null,
    inputText: '',
    inputStyle: '',
    lastPointer: { x: 0, y: 0 },
  };

  const ensureCanvas = () => {
    if (!state.canvas || !state.ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const h = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    if (state.viewport.w === w && state.viewport.h === h && Math.abs(state.dpr - dpr) < 0.01)
      return;
    state.dpr = dpr;
    state.viewport = { w, h };
    state.canvas.width = Math.round(w * dpr);
    state.canvas.height = Math.round(h * dpr);
    state.canvas.style.width = `${w}px`;
    state.canvas.style.height = `${h}px`;
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const drawRect = (rect, color, dashed) => {
    if (!rect || !state.ctx) return;
    const ctx = state.ctx;
    const x = Math.round(rect.left) + 0.5;
    const y = Math.round(rect.top) + 0.5;
    const w = Math.max(0, Math.round(rect.width));
    const h = Math.max(0, Math.round(rect.height));
    if (w <= 0 || h <= 0) return;
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.fillStyle = `${color}22`;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  };

  const draw = () => {
    if (!state.active || !state.ctx) return;
    ensureCanvas();
    const ctx = state.ctx;
    ctx.clearRect(0, 0, state.viewport.w, state.viewport.h);

    // Keep selected rect fresh in case HMR/layout changes.
    try {
      if (state.selectedEl && state.selectedEl instanceof Element) {
        state.selectedRect = state.selectedEl.getBoundingClientRect();
      }
    } catch {}
    try {
      if (state.hoveredEl && state.hoveredEl instanceof Element) {
        state.hoverRect = state.hoveredEl.getBoundingClientRect();
      }
    } catch {}

    drawRect(state.hoverRect, COLORS.hover, true);
    drawRect(state.selectedRect, COLORS.selected, false);

    // Keep toolbar anchored to the selected element.
    positionToolbar();
  };

  const tick = () => {
    if (!state.active) return;
    draw();
    state.raf = requestAnimationFrame(tick);
  };

  const isInToolbar = (target) => {
    try {
      if (!target || !(target instanceof Node)) return false;
      if (!state.toolbar) return false;
      return state.toolbar.contains(target);
    } catch {
      return false;
    }
  };

  const updateHover = (el, clientX, clientY) => {
    const picked = findMeaningfulElement(el, clientX, clientY);
    state.hoveredEl = picked;
    try {
      state.hoverRect = picked ? picked.getBoundingClientRect() : null;
    } catch {
      state.hoverRect = null;
    }
  };

  const positionToolbar = () => {
    try {
      if (!state.toolbar || !state.selectedRect) return;
      const pad = 10;
      const maxW = 420;
      const rect = state.selectedRect;
      const preferredLeft = clamp(
        Math.round(rect.left),
        pad,
        Math.max(pad, window.innerWidth - maxW - pad),
      );
      const preferredTop = Math.round(rect.top - 12);
      const top = preferredTop < 80 ? Math.round(rect.bottom + 12) : preferredTop;
      Object.assign(state.toolbar.style, {
        left: `${preferredLeft}px`,
        top: `${clamp(top, pad, Math.max(pad, window.innerHeight - 180))}px`,
      });
    } catch {}
  };

  const updateToolbarHeader = () => {
    try {
      if (!state.toolbar) return;
      const label = state.toolbar.querySelector('[data-role="label"]');
      if (!label) return;
      label.textContent = state.selectedEl ? getElementLabel(state.selectedEl) : 'No selection';
    } catch {}
  };

  const buildApplyPayload = (instruction) => {
    const el = state.selectedEl;
    const tag = el && el.tagName ? String(el.tagName || '').toLowerCase() : 'unknown';
    const id = el && el.id ? String(el.id) : undefined;
    const classes = el && el.classList ? Array.from(el.classList).slice(0, 24) : [];
    const text = normalizeTextSnippet(el ? el.textContent : '', 96);
    const fingerprint = { tag, id, classes, text };
    const targetFile = el ? resolveTargetFile(el) : '';
    const hints = [];
    try {
      if (el) {
        const r = findReactSourceFile(el);
        const v = findVueSourceFile(el);
        if (r) hints.push('React');
        if (v) hints.push('Vue');
      }
      if (detectTailwind(classes)) hints.push('Tailwind');
    } catch {}
    return {
      pageUrl: String(location && location.href ? location.href : ''),
      targetFile: targetFile || undefined,
      fingerprint,
      techStackHint: hints.length ? hints : undefined,
      instruction,
    };
  };

  const onMouseMove = (e) => {
    if (!state.active) return;
    if (isInToolbar(e.target)) return;
    state.lastPointer = { x: e.clientX, y: e.clientY };
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    updateHover(el, e.clientX, e.clientY);
  };

  const onClick = (e) => {
    if (!state.active) return;
    if (isInToolbar(e.target)) return;
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {}
    const el = state.hoveredEl;
    if (!el) return;
    state.selectedEl = el;
    try {
      state.selectedRect = el.getBoundingClientRect();
    } catch {
      state.selectedRect = null;
    }
    updateToolbarHeader();
    positionToolbar();
  };

  const intercept = (e) => {
    if (!state.active) return;
    if (isInToolbar(e.target)) return;
    // Allow scroll/wheel to keep navigation usable in edit mode.
    if (e.type === 'wheel') return;
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {}
  };

  const onKeyDown = (e) => {
    if (!state.active) return;
    if (isInToolbar(e.target)) return;
    if (e.key === 'Escape') {
      try {
        e.preventDefault();
        e.stopPropagation();
      } catch {}
      stop();
      return;
    }
  };

  const buildToolbar = () => {
    const box = document.createElement('div');
    state.toolbar = box;
    Object.assign(box.style, {
      position: 'fixed',
      left: '12px',
      top: '12px',
      zIndex: 2147483647,
      pointerEvents: 'auto',
      width: 'min(420px, calc(100vw - 24px))',
      background: 'rgba(255,255,255,0.96)',
      border: '1px solid rgba(148, 163, 184, 0.6)',
      borderRadius: '12px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,Arial',
      color: '#0f172a',
      overflow: 'hidden',
    });

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '10px',
      padding: '10px 12px',
      background: 'rgba(248,250,252,0.9)',
      borderBottom: '1px solid rgba(148, 163, 184, 0.35)',
    });
    const label = document.createElement('div');
    label.setAttribute('data-role', 'label');
    Object.assign(label.style, {
      fontSize: '12px',
      fontWeight: '600',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '280px',
    });
    label.textContent = 'Select an element';

    const btnExit = document.createElement('button');
    btnExit.textContent = 'Exit (Esc)';
    Object.assign(btnExit.style, {
      fontSize: '12px',
      padding: '6px 10px',
      borderRadius: '10px',
      border: '1px solid rgba(148,163,184,0.6)',
      background: '#fff',
      cursor: 'pointer',
    });
    btnExit.addEventListener('click', () => stop());

    header.appendChild(label);
    header.appendChild(btnExit);

    const body = document.createElement('div');
    Object.assign(body.style, {
      padding: '10px 12px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
    });

    const mkRow = (titleText) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      });
      const title = document.createElement('div');
      title.textContent = titleText;
      Object.assign(title.style, { fontSize: '12px', fontWeight: '600', color: '#334155' });
      row.appendChild(title);
      return { row, title };
    };

    const mkActions = () => {
      const actions = document.createElement('div');
      Object.assign(actions.style, {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
      });
      return actions;
    };

    const mkButton = (text, variant) => {
      const btn = document.createElement('button');
      btn.textContent = text;
      const bg = variant === 'primary' ? '#0f172a' : '#fff';
      const color = variant === 'primary' ? '#fff' : '#0f172a';
      Object.assign(btn.style, {
        fontSize: '12px',
        padding: '7px 10px',
        borderRadius: '10px',
        border: '1px solid rgba(148,163,184,0.6)',
        background: bg,
        color,
        cursor: 'pointer',
      });
      return btn;
    };

    // Text edit
    const textRow = mkRow('Text');
    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.placeholder = 'New text…';
    Object.assign(textInput.style, {
      width: '100%',
      padding: '8px 10px',
      borderRadius: '10px',
      border: '1px solid rgba(148,163,184,0.6)',
      fontSize: '12px',
      outline: 'none',
    });
    textInput.addEventListener('input', () => {
      state.inputText = textInput.value;
    });
    const textActions = mkActions();
    const btnApplyText = mkButton('Apply (DOM)', 'secondary');
    btnApplyText.addEventListener('click', () => {
      if (!state.selectedEl) return showToast(state, 'No selection', 'error');
      const v = String(state.inputText || '').trim();
      if (!v) return showToast(state, 'Text is empty', 'error');
      try {
        state.selectedEl.textContent = v;
        showToast(state, 'Text applied (DOM)', 'success');
      } catch {
        showToast(state, 'Failed to apply text', 'error');
      }
    });
    const btnSyncText = mkButton('Sync to Code', 'primary');
    btnSyncText.addEventListener('click', async () => {
      if (!state.selectedEl) return showToast(state, 'No selection', 'error');
      const v = String(state.inputText || '').trim();
      if (!v) return showToast(state, 'Text is empty', 'error');
      const payload = buildApplyPayload({
        type: 'update_text',
        description: `Set the element text to: ${JSON.stringify(v)}`,
        text: v,
      });
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'web_editor_apply', payload });
        if (resp && resp.success) {
          showToast(state, `Agent accepted (requestId=${resp.requestId || 'n/a'})`, 'success');
        } else {
          showToast(state, resp?.error || 'Agent request failed', 'error');
        }
      } catch (err) {
        showToast(state, String(err && err.message ? err.message : err), 'error');
      }
    });
    textActions.appendChild(btnApplyText);
    textActions.appendChild(btnSyncText);
    textRow.row.appendChild(textInput);
    textRow.row.appendChild(textActions);

    // Style edit
    const styleRow = mkRow('Style (CSS declarations)');
    const styleInput = document.createElement('input');
    styleInput.type = 'text';
    styleInput.placeholder = 'e.g. background-color: #f3f4f6; padding: 12px';
    Object.assign(styleInput.style, {
      width: '100%',
      padding: '8px 10px',
      borderRadius: '10px',
      border: '1px solid rgba(148,163,184,0.6)',
      fontSize: '12px',
      outline: 'none',
    });
    styleInput.addEventListener('input', () => {
      state.inputStyle = styleInput.value;
    });
    const styleActions = mkActions();
    const btnApplyStyle = mkButton('Apply (DOM)', 'secondary');
    btnApplyStyle.addEventListener('click', () => {
      if (!state.selectedEl) return showToast(state, 'No selection', 'error');
      const map = buildStyleMapFromInput(state.inputStyle);
      const keys = Object.keys(map);
      if (!keys.length) return showToast(state, 'No valid declarations', 'error');
      applyInlineStyleMap(state.selectedEl, map);
      showToast(state, 'Style applied (DOM)', 'success');
    });
    const btnSyncStyle = mkButton('Sync to Code', 'primary');
    btnSyncStyle.addEventListener('click', async () => {
      if (!state.selectedEl) return showToast(state, 'No selection', 'error');
      const map = buildStyleMapFromInput(state.inputStyle);
      const keys = Object.keys(map);
      if (!keys.length) return showToast(state, 'No valid declarations', 'error');
      const decl = keys.map((k) => `${k}: ${map[k]}`).join('; ');
      const payload = buildApplyPayload({
        type: 'update_style',
        description: `Apply CSS declarations: ${decl}`,
        style: map,
      });
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'web_editor_apply', payload });
        if (resp && resp.success) {
          showToast(state, `Agent accepted (requestId=${resp.requestId || 'n/a'})`, 'success');
        } else {
          showToast(state, resp?.error || 'Agent request failed', 'error');
        }
      } catch (err) {
        showToast(state, String(err && err.message ? err.message : err), 'error');
      }
    });
    styleActions.appendChild(btnApplyStyle);
    styleActions.appendChild(btnSyncStyle);
    styleRow.row.appendChild(styleInput);
    styleRow.row.appendChild(styleActions);

    body.appendChild(textRow.row);
    body.appendChild(styleRow.row);
    box.appendChild(header);
    box.appendChild(body);
    return box;
  };

  const start = () => {
    if (!IS_MAIN) return;
    if (state.active) return;
    state.active = true;

    const root = document.createElement('div');
    state.root = root;
    root.id = '__mcp_web_editor_root';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      zIndex: 2147483647,
      pointerEvents: 'none',
    });

    const canvas = document.createElement('canvas');
    state.canvas = canvas;
    Object.assign(canvas.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    root.appendChild(canvas);

    try {
      const ctx = canvas.getContext('2d');
      state.ctx = ctx;
    } catch {
      state.ctx = null;
    }

    const toolbar = buildToolbar();
    root.appendChild(toolbar);

    const toastHost = createToastHost();
    state.toastHost = toastHost;
    root.appendChild(toastHost);

    document.documentElement.appendChild(root);

    document.addEventListener('mousemove', onMouseMove, { capture: true, passive: true });
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousedown', intercept, true);
    document.addEventListener('mouseup', intercept, true);
    document.addEventListener('dblclick', intercept, true);
    document.addEventListener('contextmenu', intercept, true);
    document.addEventListener('submit', intercept, true);
    document.addEventListener('keydown', onKeyDown, true);

    // Visual cue
    showToast(state, 'Web Editor: ON (Esc to exit)', 'info');

    // Start RAF
    state.raf = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!IS_MAIN) return;
    if (!state.active) return;
    state.active = false;

    try {
      if (state.raf) cancelAnimationFrame(state.raf);
    } catch {}
    state.raf = 0;

    try {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', intercept, true);
      document.removeEventListener('mouseup', intercept, true);
      document.removeEventListener('dblclick', intercept, true);
      document.removeEventListener('contextmenu', intercept, true);
      document.removeEventListener('submit', intercept, true);
      document.removeEventListener('keydown', onKeyDown, true);
    } catch {}

    try {
      state.root && state.root.remove();
    } catch {}

    state.root = null;
    state.canvas = null;
    state.ctx = null;
    state.hoveredEl = null;
    state.selectedEl = null;
    state.hoverRect = null;
    state.selectedRect = null;
    state.toolbar = null;
    state.toastHost = null;
    state.inputText = '';
    state.inputStyle = '';
  };

  const toggle = () => {
    if (!IS_MAIN) return false;
    if (state.active) {
      stop();
      return false;
    }
    start();
    return true;
  };

  // Expose minimal API for debugging
  window[GLOBAL_KEY] = {
    start,
    stop,
    toggle,
    getState: () => ({ active: state.active }),
  };

  // Message handler (background -> tab)
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (!IS_MAIN) return false;
      if (request && request.action === 'web_editor_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'web_editor_toggle') {
        const active = toggle();
        sendResponse({ active });
        return true;
      }
      if (request && request.action === 'web_editor_start') {
        start();
        sendResponse({ active: true });
        return true;
      }
      if (request && request.action === 'web_editor_stop') {
        stop();
        sendResponse({ active: false });
        return true;
      }
    } catch (e) {
      try {
        sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      } catch {}
      return true;
    }
    return false;
  });
})();
