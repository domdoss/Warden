/* eslint-disable */
/**
 * Element Picker Inject Script
 *
 * Injected script to let the user manually pick elements for chrome_request_element_selection.
 * - Writes refs into window.__claudeElementMap (compatible with accessibility-tree-helper.js)
 * - Generates stable CSS selectors (prefers id/data-testid/etc.)
 * - Supports iframe picking by reporting selection via chrome.runtime.sendMessage (background reads sender.frameId)
 */

(function () {
  'use strict';

  // Prevent double initialization
  if (window.__MCP_ELEMENT_PICKER_INITIALIZED__) return;
  window.__MCP_ELEMENT_PICKER_INITIALIZED__ = true;

  // ============================================================
  // Constants
  // ============================================================

  const UI_HOST_ID = '__mcp_element_picker_host__';
  const HIGHLIGHT_ID = '__mcp_element_picker_highlight__';
  const MAX_TEXT_LEN = 160;

  // Highlight colors matching Editorial accent (terracotta)
  const HIGHLIGHT_COLOR = '#d97757';
  const HIGHLIGHT_BG = 'rgba(217, 119, 87, 0.08)';
  const HIGHLIGHT_BORDER = 'rgba(217, 119, 87, 0.4)';

  // ============================================================
  // State
  // ============================================================

  const STATE = {
    active: false,
    sessionId: null,
    activeRequestId: null,
    listenersAttached: false,
    hoverRafId: null,
    pendingHoverEvent: null,
    lastHoverEl: null,
    highlighter: null,
  };

  // ============================================================
  // CSS Escape Helper
  // ============================================================

  function cssEscape(value) {
    try {
      if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(value);
      }
    } catch {
      // Fallback
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  }

  // ============================================================
  // UI Detection Helpers
  // ============================================================

  function getUiHost() {
    try {
      return document.getElementById(UI_HOST_ID);
    } catch {
      return null;
    }
  }

  function isOverlayElement(node) {
    if (!(node instanceof Node)) return false;
    const host = getUiHost();
    if (!host) return false;
    if (node === host) return true;
    const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    return root instanceof ShadowRoot && root.host === host;
  }

  function isEventFromUi(ev) {
    if (!ev) return false;
    try {
      if (typeof ev.composedPath === 'function') {
        const path = ev.composedPath();
        if (Array.isArray(path)) {
          return path.some((n) => isOverlayElement(n));
        }
      }
    } catch {
      // Fallback
    }
    return isOverlayElement(ev.target);
  }

  /**
   * Get the deepest page target from an event, handling Shadow DOM.
   */
  function getDeepPageTarget(ev) {
    if (!ev) return null;
    try {
      const path = typeof ev.composedPath === 'function' ? ev.composedPath() : null;
      if (Array.isArray(path) && path.length > 0) {
        for (const node of path) {
          if (node instanceof Element && !isOverlayElement(node)) {
            return node;
          }
        }
      }
    } catch {
      // Fallback
    }
    const fallback = ev.target instanceof Element ? ev.target : null;
    if (fallback && !isOverlayElement(fallback)) {
      return fallback;
    }
    return null;
  }

  // ============================================================
  // Highlighter
  // ============================================================

  function ensureHighlighter() {
    if (STATE.highlighter && STATE.highlighter.isConnected) {
      return STATE.highlighter;
    }

    // Remove any existing highlighter
    try {
      const existing = document.getElementById(HIGHLIGHT_ID);
      if (existing) existing.remove();
    } catch {
      // Best effort
    }

    const hl = document.createElement('div');
    hl.id = HIGHLIGHT_ID;
    Object.assign(hl.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '0px',
      height: '0px',
      border: `2px solid ${HIGHLIGHT_COLOR}`,
      borderRadius: '4px',
      boxShadow: `0 0 0 1px ${HIGHLIGHT_BORDER}`,
      background: HIGHLIGHT_BG,
      pointerEvents: 'none',
      zIndex: '2147483647',
      display: 'none',
      transition: 'transform 60ms linear, width 60ms linear, height 60ms linear',
    });

    try {
      (document.documentElement || document.body).appendChild(hl);
    } catch {
      // Best effort
    }

    STATE.highlighter = hl;
    return hl;
  }

  function clearHighlighter() {
    const hl = STATE.highlighter;
    if (!hl) return;
    try {
      hl.style.display = 'none';
    } catch {
      // Best effort
    }
  }

  function moveHighlighterTo(el) {
    const hl = ensureHighlighter();
    if (!hl || !(el instanceof Element)) return;

    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch {
      clearHighlighter();
      return;
    }

    if (!rect || rect.width <= 0 || rect.height <= 0) {
      clearHighlighter();
      return;
    }

    try {
      hl.style.display = 'block';
      hl.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
      hl.style.width = `${Math.round(rect.width)}px`;
      hl.style.height = `${Math.round(rect.height)}px`;
    } catch {
      // Best effort
    }
  }

  // ============================================================
  // Selector Uniqueness Check (Optimized)
  // ============================================================

  /**
   * Check if element is inside a Shadow DOM.
   */
  function isInShadowDom(el) {
    try {
      const root = el.getRootNode();
      return root instanceof ShadowRoot;
    } catch {
      return false;
    }
  }

  /**
   * Fast uniqueness check using native querySelectorAll.
   * For Shadow DOM elements, queries within their shadow root only.
   */
  function isSelectorUnique(selector, target) {
    if (!selector || !(target instanceof Element)) return false;

    try {
      // For elements not in Shadow DOM, use fast native query
      if (!isInShadowDom(target)) {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === target;
      }

      // For Shadow DOM elements, query within their root
      const root = target.getRootNode();
      if (root instanceof ShadowRoot) {
        const matches = root.querySelectorAll(selector);
        return matches.length === 1 && matches[0] === target;
      }

      return false;
    } catch {
      return false;
    }
  }

  // ============================================================
  // Selector Generation (Stable & Unique)
  // ============================================================

  function buildPathFromAncestor(ancestor, target) {
    const segs = [];
    let cur = target;

    const root = target.getRootNode();
    const isShadowElement = root instanceof ShadowRoot;
    const boundary = isShadowElement ? root.host : document.body;

    while (cur && cur !== ancestor && cur !== boundary) {
      let seg = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === cur.tagName);
        if (siblings.length > 1) {
          seg += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
      }
      segs.unshift(seg);
      cur = parent;
      if (isShadowElement && cur === boundary) break;
    }

    return segs.join(' > ');
  }

  function buildFullPath(el) {
    let path = '';
    let current = el;

    const root = el.getRootNode();
    const isShadowElement = root instanceof ShadowRoot;
    const boundary = isShadowElement ? root.host : document.body;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== boundary) {
      let sel = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          sel += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path = path ? `${sel} > ${path}` : sel;
      current = parent;
      if (isShadowElement && current === boundary) break;
    }

    if (isShadowElement) return path || el.tagName.toLowerCase();
    return path ? `body > ${path}` : 'body';
  }

  /**
   * Generate a stable CSS selector for an element.
   * Prioritizes: id > data-testid/data-test/etc > anchor + relative path > full path
   */
  function generateSelector(el) {
    if (!(el instanceof Element)) return '';

    // Prefer unique IDs
    try {
      if (el.id) {
        const idSel = `#${cssEscape(el.id)}`;
        if (isSelectorUnique(idSel, el)) return idSel;
      }
    } catch {
      // Continue
    }

    // Prefer stable test attributes
    try {
      const attrNames = [
        'data-testid',
        'data-testId',
        'data-test',
        'data-qa',
        'data-cy',
        'name',
        'aria-label',
        'title',
        'alt',
      ];
      const tag = el.tagName.toLowerCase();
      for (const attr of attrNames) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const attrSel = `[${attr}="${cssEscape(v)}"]`;
        const testSel = /^(input|textarea|select)$/i.test(tag) ? `${tag}${attrSel}` : attrSel;
        if (isSelectorUnique(testSel, el)) return testSel;
      }
    } catch {
      // Continue
    }

    // Anchor + relative path
    try {
      let cur = el;
      const anchorAttrs = [
        'id',
        'data-testid',
        'data-testId',
        'data-test',
        'data-qa',
        'data-cy',
        'name',
      ];

      const root = el.getRootNode();
      const isShadowElement = root instanceof ShadowRoot;
      const boundary = isShadowElement ? root.host : document.body;

      while (cur && cur !== boundary) {
        if (cur.id) {
          const anchor = `#${cssEscape(cur.id)}`;
          if (isSelectorUnique(anchor, cur)) {
            const rel = buildPathFromAncestor(cur, el);
            const composed = rel ? `${anchor} ${rel}` : anchor;
            if (isSelectorUnique(composed, el)) return composed;
          }
        }

        for (const attr of anchorAttrs) {
          const val = cur.getAttribute(attr);
          if (!val) continue;
          const aSel = `[${attr}="${cssEscape(val)}"]`;
          if (isSelectorUnique(aSel, cur)) {
            const rel = buildPathFromAncestor(cur, el);
            const composed = rel ? `${aSel} ${rel}` : aSel;
            if (isSelectorUnique(composed, el)) return composed;
          }
        }

        cur = cur.parentElement;
      }
    } catch {
      // Continue
    }

    // Fallback to full path
    return buildFullPath(el);
  }

  // ============================================================
  // Text Summarization
  // ============================================================

  function summarizeText(el) {
    if (!(el instanceof Element)) return '';
    try {
      const aria = el.getAttribute('aria-label');
      if (aria && aria.trim()) return aria.trim().slice(0, MAX_TEXT_LEN);
      const placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.trim()) return placeholder.trim().slice(0, MAX_TEXT_LEN);
      const title = el.getAttribute('title');
      if (title && title.trim()) return title.trim().slice(0, MAX_TEXT_LEN);
      const alt = el.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim().slice(0, MAX_TEXT_LEN);
    } catch {
      // Continue
    }
    try {
      const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
      return t ? t.slice(0, MAX_TEXT_LEN) : '';
    } catch {
      return '';
    }
  }

  // ============================================================
  // Ref Management (Compatible with accessibility-tree-helper.js)
  // ============================================================

  function ensureRefForElement(el) {
    try {
      if (!window.__claudeElementMap) window.__claudeElementMap = {};
      if (!window.__claudeRefCounter) window.__claudeRefCounter = 0;
    } catch {
      // Best effort
    }

    // Check if element already has a ref
    let refId = null;
    try {
      for (const k in window.__claudeElementMap) {
        const w = window.__claudeElementMap[k];
        if (w && w.deref && w.deref() === el) {
          refId = k;
          break;
        }
      }
    } catch {
      // Continue
    }

    // Create new ref if needed
    if (!refId) {
      try {
        refId = `ref_${++window.__claudeRefCounter}`;
        window.__claudeElementMap[refId] = new WeakRef(el);
      } catch {
        // Continue
      }
    }

    return refId || '';
  }

  // ============================================================
  // Communication
  // ============================================================

  function sendFrameEvent(payload) {
    try {
      chrome.runtime.sendMessage(payload);
    } catch {
      // Best effort
    }
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  function processMouseMove(ev) {
    if (!STATE.active) return;

    // Skip if event is from our UI
    if (isEventFromUi(ev)) {
      STATE.lastHoverEl = null;
      clearHighlighter();
      return;
    }

    const target = getDeepPageTarget(ev);
    if (!target) {
      STATE.lastHoverEl = null;
      clearHighlighter();
      return;
    }

    // Skip if same element
    if (STATE.lastHoverEl === target) return;
    STATE.lastHoverEl = target;
    moveHighlighterTo(target);
  }

  function onMouseMove(ev) {
    if (!STATE.active) return;
    STATE.pendingHoverEvent = ev;
    if (STATE.hoverRafId != null) return;
    STATE.hoverRafId = requestAnimationFrame(() => {
      STATE.hoverRafId = null;
      const latest = STATE.pendingHoverEvent;
      STATE.pendingHoverEvent = null;
      if (!latest) return;
      processMouseMove(latest);
    });
  }

  function onClick(ev) {
    if (!STATE.active) return;

    // Allow UI interactions without interference
    if (isEventFromUi(ev)) return;

    const rawTarget = ev.target instanceof Element ? ev.target : null;
    if (!rawTarget) return;

    // Require an active request id so background can map the selection
    if (!STATE.sessionId || !STATE.activeRequestId) return;

    ev.preventDefault();
    ev.stopPropagation();

    const target = getDeepPageTarget(ev) || rawTarget;
    if (!(target instanceof Element)) return;

    const ref = ensureRefForElement(target);
    const selector = generateSelector(target);
    let rect;
    try {
      rect = target.getBoundingClientRect();
    } catch {
      rect = { x: 0, y: 0, width: 0, height: 0, left: 0, top: 0 };
    }

    const center = {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };

    sendFrameEvent({
      type: 'element_picker_frame_event',
      sessionId: STATE.sessionId,
      event: 'selected',
      requestId: STATE.activeRequestId,
      element: {
        ref,
        selector,
        selectorType: 'css',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        center,
        text: summarizeText(target),
        tagName: target.tagName ? String(target.tagName).toLowerCase() : '',
      },
    });
  }

  function onKeyDown(ev) {
    if (!STATE.active) return;
    if (ev && ev.key === 'Escape') {
      if (isEventFromUi(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (STATE.sessionId) {
        sendFrameEvent({
          type: 'element_picker_frame_event',
          sessionId: STATE.sessionId,
          event: 'cancel',
        });
      }
    }
  }

  // ============================================================
  // Listener Management
  // ============================================================

  function attachListeners() {
    if (STATE.listenersAttached) return;
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    STATE.listenersAttached = true;
  }

  function detachListeners() {
    if (!STATE.listenersAttached) return;
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
    STATE.listenersAttached = false;
  }

  // ============================================================
  // Session Management API
  // ============================================================

  function startSession(payload) {
    const sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
    if (!sessionId) return;

    STATE.active = true;
    STATE.sessionId = sessionId;
    STATE.activeRequestId =
      payload && payload.activeRequestId ? String(payload.activeRequestId) : null;
    ensureHighlighter();
    attachListeners();
  }

  function stopSession(payload) {
    const sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
    // Only stop if session matches or no specific session requested
    if (sessionId && STATE.sessionId && sessionId !== STATE.sessionId) return;

    STATE.active = false;
    STATE.sessionId = null;
    STATE.activeRequestId = null;
    STATE.lastHoverEl = null;
    detachListeners();
    clearHighlighter();

    // Remove highlighter element
    try {
      const hl = STATE.highlighter;
      if (hl && hl.remove) hl.remove();
    } catch {
      // Best effort
    }
    STATE.highlighter = null;
  }

  function setActiveRequest(payload) {
    const sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
    if (sessionId && STATE.sessionId && sessionId !== STATE.sessionId) return;
    STATE.activeRequestId =
      payload && payload.activeRequestId ? String(payload.activeRequestId) : null;
  }

  // ============================================================
  // Expose API for Background Script
  // ============================================================

  window.__mcpElementPicker = {
    startSession,
    stopSession,
    setActiveRequest,
  };

  // ============================================================
  // Message Listener (for direct communication)
  // ============================================================

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    try {
      if (request && request.action === 'chrome_request_element_selection_ping') {
        sendResponse({ status: 'pong' });
        return false;
      }
      if (request && request.action === 'elementPickerStart') {
        startSession(request);
        sendResponse({ success: true });
        return false;
      }
      if (request && request.action === 'elementPickerStop') {
        stopSession(request);
        sendResponse({ success: true });
        return false;
      }
      if (request && request.action === 'elementPickerSetActiveRequest') {
        setActiveRequest(request);
        sendResponse({ success: true });
        return false;
      }
    } catch (e) {
      sendResponse({ success: false, error: String(e && e.message ? e.message : e) });
      return false;
    }
    return false;
  });
})();
