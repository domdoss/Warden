var elementPicker = (function() {
  "use strict";var __defProp = Object.defineProperty;
var __defProps = Object.defineProperties;
var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
var __getOwnPropSymbols = Object.getOwnPropertySymbols;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __propIsEnum = Object.prototype.propertyIsEnumerable;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __spreadValues = (a, b) => {
  for (var prop in b || (b = {}))
    if (__hasOwnProp.call(b, prop))
      __defNormalProp(a, prop, b[prop]);
  if (__getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(b)) {
      if (__propIsEnum.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    }
  return a;
};
var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));
var __objRest = (source, exclude) => {
  var target = {};
  for (var prop in source)
    if (__hasOwnProp.call(source, prop) && exclude.indexOf(prop) < 0)
      target[prop] = source[prop];
  if (source != null && __getOwnPropSymbols)
    for (var prop of __getOwnPropSymbols(source)) {
      if (exclude.indexOf(prop) < 0 && __propIsEnum.call(source, prop))
        target[prop] = source[prop];
    }
  return target;
};
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

  var _a, _b;
  function defineContentScript(definition2) {
    return definition2;
  }
  class Disposer {
    constructor() {
      __publicField(this, "disposed", false);
      __publicField(this, "disposers", []);
    }
    /** Whether this disposer has already been disposed */
    get isDisposed() {
      return this.disposed;
    }
    /**
     * Add a dispose function to be called during cleanup.
     * If already disposed, the function is called immediately.
     */
    add(dispose) {
      if (this.disposed) {
        try {
          dispose();
        } catch (e) {
        }
        return;
      }
      this.disposers.push(dispose);
    }
    listen(target, type, listener, options) {
      target.addEventListener(type, listener, options);
      this.add(() => target.removeEventListener(type, listener, options));
    }
    /**
     * Add a ResizeObserver and automatically disconnect it on dispose.
     */
    observeResize(target, callback, options) {
      const observer = new ResizeObserver(callback);
      observer.observe(target, options);
      this.add(() => observer.disconnect());
      return observer;
    }
    /**
     * Add a MutationObserver and automatically disconnect it on dispose.
     */
    observeMutation(target, callback, options) {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      this.add(() => observer.disconnect());
      return observer;
    }
    /**
     * Add a requestAnimationFrame and automatically cancel it on dispose.
     * Returns a function to manually cancel the frame.
     */
    requestAnimationFrame(callback) {
      const id = requestAnimationFrame(callback);
      let cancelled = false;
      const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        cancelAnimationFrame(id);
      };
      this.add(cancel);
      return cancel;
    }
    /**
     * Dispose all registered resources in reverse order.
     * Safe to call multiple times.
     */
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (let i = this.disposers.length - 1; i >= 0; i--) {
        try {
          this.disposers[i]();
        } catch (e) {
        }
      }
      this.disposers.length = 0;
    }
  }
  const QUICK_PANEL_STYLES = (
    /* css */
    `
  /* ============================================================
   * Reset & Box Sizing
   * ============================================================ */

  :host {
    all: initial;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  [hidden] {
    display: none !important;
  }

  /* ============================================================
   * Root Container & Theme Tokens
   * Subset of AgentChat tokens for Quick Panel use
   * ============================================================ */

  .qp-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    font-family: var(--ac-font-body, ui-sans-serif, system-ui);
    color: var(--ac-text, #111827);
    line-height: 1.4;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .qp-root.agent-theme {
    /* ===========================================
     * Font Stacks
     * =========================================== */
    --ac-font-sans:
      'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial,
      'Apple Color Emoji', 'Segoe UI Emoji';
    --ac-font-serif: 'Newsreader', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif;
    --ac-font-mono:
      'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
    --ac-font-grotesk:
      'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial;

    --ac-font-body: var(--ac-font-sans);
    --ac-font-heading: var(--ac-font-serif);
    --ac-font-code: var(--ac-font-mono);

    /* ===========================================
     * Geometry & Spacing
     * =========================================== */
    --ac-border-width: 1px;
    --ac-border-width-strong: 2px;
    --ac-radius-container: 0px;
    --ac-radius-card: 12px;
    --ac-radius-inner: 8px;
    --ac-radius-button: 8px;

    /* ===========================================
     * Motion
     * =========================================== */
    --ac-motion-fast: 120ms;
    --ac-motion-normal: 180ms;

    /* ===========================================
     * Warm Editorial Theme (Default)
     * =========================================== */
    --ac-bg: transparent;
    --ac-bg-pattern: none;
    --ac-bg-pattern-size: 16px 16px;

    --ac-header-bg: rgba(253, 252, 248, 0.95);
    --ac-header-border: rgba(245, 245, 244, 0.5);

    --ac-surface: #ffffff;
    --ac-surface-muted: #f2f0eb;
    --ac-surface-inset: #f2f0eb;

    --ac-text: #1a1a1a;
    --ac-text-muted: #6e6e6e;
    --ac-text-subtle: #a8a29e;
    --ac-text-inverse: #ffffff;
    --ac-text-placeholder: #a8a29e;

    --ac-border: #e7e5e4;
    --ac-border-strong: #d6d3d1;

    --ac-hover-bg: #f5f5f4;
    --ac-hover-bg-subtle: #fafaf9;

    --ac-accent: #d97757;
    --ac-accent-hover: #c4664a;
    --ac-accent-subtle: rgba(217, 119, 87, 0.12);
    --ac-accent-contrast: #ffffff;

    --ac-link: var(--ac-accent);
    --ac-link-hover: var(--ac-accent-hover);

    --ac-selection-bg: #ffedd5;
    --ac-selection-text: #7c2d12;

    --ac-shadow-card: 0 1px 3px rgba(0, 0, 0, 0.08);
    --ac-shadow-float: 0 4px 20px -2px rgba(0, 0, 0, 0.05);

    --ac-focus-ring: rgba(214, 211, 209, 0.9);

    --ac-timeline-node-pulse-shadow:
      0 0 0 2px rgba(217, 119, 87, 0.25), 0 0 12px rgba(217, 119, 87, 0.2);

    /* Status Colors */
    --ac-success: #22c55e;
    --ac-warning: #f59e0b;
    --ac-danger: #ef4444;

    /* Scrollbar */
    --ac-scrollbar-size: 4px;
    --ac-scrollbar-thumb: rgba(0, 0, 0, 0.25);
    --ac-scrollbar-thumb-hover: rgba(0, 0, 0, 0.4);

    /* ===========================================
     * Quick Panel Solid Tokens (Editorial Style)
     * No glassmorphism - solid backgrounds for clarity
     * =========================================== */
    --qp-panel-bg: var(--ac-surface);
    --qp-panel-border: var(--ac-border);
    --qp-panel-shadow: var(--ac-shadow-card), 0 25px 50px -12px rgba(0, 0, 0, 0.15);
    --qp-divider: var(--ac-border);
    --qp-input-bg: var(--ac-surface);
    --qp-input-border: var(--ac-border);
  }

  /* ===========================================
   * Dark Console Theme
   * =========================================== */
  .qp-root.agent-theme[data-agent-theme='dark-console'] {
    --ac-font-body: var(--ac-font-mono);
    --ac-font-heading: var(--ac-font-mono);
    --ac-font-code: var(--ac-font-mono);

    --ac-surface: #0f1117;
    --ac-surface-muted: #0a0c10;
    --ac-surface-inset: #1a1d26;

    --ac-text: #e5e7eb;
    --ac-text-muted: #9ca3af;
    --ac-text-subtle: #6b7280;
    --ac-text-inverse: #0a0c10;
    --ac-text-placeholder: #4b5563;

    --ac-border: #1f2937;
    --ac-border-strong: #374151;

    --ac-hover-bg: rgba(255, 255, 255, 0.06);
    --ac-hover-bg-subtle: rgba(255, 255, 255, 0.04);

    --ac-accent: #d97757;
    --ac-accent-hover: #e8956f;
    --ac-accent-subtle: rgba(217, 119, 87, 0.18);
    --ac-accent-contrast: #ffffff;

    --ac-focus-ring: rgba(217, 119, 87, 0.4);
    --ac-timeline-node-pulse-shadow:
      0 0 0 2px rgba(217, 119, 87, 0.35), 0 0 14px rgba(217, 119, 87, 0.25);

    --ac-scrollbar-thumb: rgba(255, 255, 255, 0.12);
    --ac-scrollbar-thumb-hover: rgba(255, 255, 255, 0.22);

    --qp-panel-bg: var(--ac-surface);
    --qp-panel-border: var(--ac-border);
    --qp-panel-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.4);
    --qp-divider: var(--ac-border);
    --qp-input-bg: var(--ac-surface-inset);
    --qp-input-border: var(--ac-border);
  }

  .qp-root ::selection {
    background: var(--ac-selection-bg);
    color: var(--ac-selection-text);
  }

  /* ============================================================
   * Utility Classes (AgentChat Subset)
   * ============================================================ */

  /* Scrollbar Styling */
  .qp-root .ac-scroll {
    scrollbar-width: thin;
    scrollbar-color: var(--ac-scrollbar-thumb) transparent;
  }

  .qp-root .ac-scroll::-webkit-scrollbar {
    width: var(--ac-scrollbar-size);
    height: var(--ac-scrollbar-size);
  }

  .qp-root .ac-scroll::-webkit-scrollbar-track {
    background: transparent;
  }

  .qp-root .ac-scroll::-webkit-scrollbar-thumb {
    background-color: var(--ac-scrollbar-thumb);
    border-radius: 999px;
  }

  .qp-root .ac-scroll::-webkit-scrollbar-thumb:hover {
    background-color: var(--ac-scrollbar-thumb-hover);
  }

  /* Focus Ring */
  .qp-root .ac-focus-ring:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--ac-focus-ring);
  }

  /* Button Base */
  .qp-root .ac-btn {
    transition:
      background-color var(--ac-motion-fast),
      color var(--ac-motion-fast);
  }

  .qp-root .ac-btn:hover {
    background-color: var(--ac-hover-bg);
  }

  /* Pulse Animation (Streaming Indicator) */
  @keyframes ac-pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .qp-root .ac-pulse {
    animation: ac-pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .qp-root .ac-pulse {
      animation: none;
    }
  }

  /* Text Shimmer (Streaming Status) */
  .qp-root .text-shimmer {
    background: linear-gradient(
      90deg,
      var(--ac-accent, #d97757) 0%,
      var(--ac-accent-hover, #ffcab0) 50%,
      var(--ac-accent, #d97757) 100%
    );
    background-size: 200% auto;
    color: transparent;
    -webkit-background-clip: text;
    background-clip: text;
    animation: ac-shimmer 3s linear infinite;
  }

  @keyframes ac-shimmer {
    to {
      background-position: 200% center;
    }
  }

  /* ============================================================
   * Liquid Glass Panel (PRD V6)
   * ============================================================ */

  .qp-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    pointer-events: auto;
  }

  .qp-panel {
    width: min(760px, calc(100vw - 48px));
    max-height: min(720px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    border-radius: 24px;
    overflow: hidden;
    pointer-events: auto;

    background: var(--qp-panel-bg);
    border: var(--ac-border-width) solid var(--qp-panel-border);
    box-shadow: var(--qp-panel-shadow);
  }

  /* ============================================================
   * AI Chat Layout Components
   * ============================================================ */

  /* Header */
  .qp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 14px 16px;
    border-bottom: var(--ac-border-width) solid var(--qp-divider);
  }

  .qp-header-left {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .qp-brand {
    width: 34px;
    height: 34px;
    border-radius: var(--ac-radius-inner);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ac-accent-subtle);
    color: var(--ac-accent);
    font-size: 24px;
  }

  .qp-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .qp-title-name {
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.2px;
    color: var(--ac-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qp-title-sub {
    font-size: 11px;
    color: var(--ac-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qp-header-right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: none;
  }

  .qp-stream-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--ac-text-muted);
    user-select: none;
  }

  .qp-stream-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ac-accent);
    box-shadow: var(--ac-timeline-node-pulse-shadow);
  }

  /* Buttons */
  .qp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: var(--ac-border-width) solid var(--qp-divider);
    background: var(--ac-hover-bg);
    color: var(--ac-text);
    border-radius: var(--ac-radius-button);
    padding: 8px 10px;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    font-family: inherit;
    transition: background-color var(--ac-motion-fast);
  }

  .qp-btn:hover:not(:disabled) {
    background: var(--ac-hover-bg-subtle);
  }

  .qp-btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .qp-btn--primary {
    background: var(--ac-accent);
    border-color: var(--ac-accent);
    color: var(--ac-accent-contrast);
  }

  .qp-btn--primary:hover:not(:disabled) {
    background: var(--ac-accent-hover);
  }

  .qp-btn--danger {
    background: var(--ac-danger);
    border-color: var(--ac-danger);
    color: #ffffff;
  }

  /* Content Area */
  .qp-content {
    flex: 1;
    overflow: auto;
    padding: 14px;
    min-height: 0;
  }

  .qp-messages {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Message Bubbles */
  .qp-msg {
    display: flex;
    gap: 10px;
  }

  .qp-msg--user {
    justify-content: flex-end;
  }

  .qp-msg--assistant {
    justify-content: flex-start;
  }

  .qp-bubble {
    max-width: 90%;
    border-radius: var(--ac-radius-card);
    border: var(--ac-border-width) solid var(--ac-border);
    box-shadow: var(--ac-shadow-card);
    padding: 10px 12px;
    background: var(--ac-surface);
  }

  .qp-bubble--user {
    background: color-mix(in srgb, var(--ac-accent-subtle) 80%, transparent);
    border-color: color-mix(in srgb, var(--ac-border) 70%, transparent);
  }

  .qp-msg-text {
    font-size: 13px;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--ac-text);
  }

  .qp-msg-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 6px;
    font-size: 10px;
    color: var(--ac-text-subtle);
  }

  .qp-msg-meta code {
    font-family: var(--ac-font-code);
    font-size: 10px;
  }

  .qp-msg-stream-dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--ac-accent);
    box-shadow: var(--ac-timeline-node-pulse-shadow);
    flex: none;
  }

  /* Status Indicators */
  .qp-status {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 999px;
    border: var(--ac-border-width) solid var(--ac-border);
    background: var(--ac-surface-muted);
    color: var(--ac-text-muted);
    font-size: 11px;
    user-select: none;
    align-self: center;
  }

  .qp-status--error {
    border-color: color-mix(in srgb, var(--ac-danger) 55%, var(--ac-border));
    color: var(--ac-danger);
    background: color-mix(in srgb, var(--ac-danger) 12%, transparent);
  }

  .qp-status--success {
    border-color: color-mix(in srgb, var(--ac-success) 55%, var(--ac-border));
    color: color-mix(in srgb, var(--ac-success) 85%, var(--ac-text));
    background: color-mix(in srgb, var(--ac-success) 10%, transparent);
  }

  .qp-status--warning {
    border-color: color-mix(in srgb, var(--ac-warning) 55%, var(--ac-border));
    color: color-mix(in srgb, var(--ac-warning) 85%, var(--ac-text));
    background: color-mix(in srgb, var(--ac-warning) 10%, transparent);
  }

  /* Composer */
  .qp-composer {
    padding: 12px 14px;
    border-top: 1px solid var(--qp-divider);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .qp-textarea {
    width: 100%;
    min-height: 42px;
    max-height: 160px;
    resize: none;
    padding: 10px 10px;
    border-radius: var(--ac-radius-card);
    border: 1px solid var(--qp-input-border);
    background: var(--qp-input-bg);
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 13px;
    line-height: 1.35;
    outline: none;
  }

  .qp-textarea::placeholder {
    color: var(--ac-text-placeholder);
  }

  .qp-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .qp-actions-left {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    color: var(--ac-text-subtle);
    user-select: none;
  }

  .qp-actions-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .qp-kbd {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: var(--ac-border-width) solid var(--qp-divider);
    background: var(--ac-surface-muted);
    padding: 4px 8px;
    border-radius: 999px;
    font-family: var(--ac-font-code);
    font-size: 10px;
    color: var(--ac-text-muted);
  }

  /* Empty State */
  .qp-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 40px 20px;
    text-align: center;
    color: var(--ac-text-muted);
  }

  .qp-empty-icon {
    font-size: 32px;
    opacity: 0.6;
  }

  .qp-empty-text {
    font-size: 13px;
    line-height: 1.5;
  }

  /* ============================================================
   * Search UI (Phase 1)
   * ============================================================ */

  /* Search Input Container */
  .qp-search {
    min-width: 0;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  /* Scope Chip */
  .qp-scope-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--qp-divider);
    background: rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    padding: 6px 10px;
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 12px;
    cursor: pointer;
    user-select: none;
    flex: none;
    transition: background-color var(--ac-motion-fast);
  }

  .qp-scope-chip:hover {
    background: rgba(255, 255, 255, 0.18);
  }

  .qp-scope-chip__icon {
    font-size: 12px;
    line-height: 1;
  }

  .qp-scope-chip__label {
    font-weight: 600;
    letter-spacing: 0.2px;
    white-space: nowrap;
  }

  .qp-scope-chip__prefix {
    font-family: var(--ac-font-code);
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid var(--qp-divider);
    background: rgba(255, 255, 255, 0.1);
    color: var(--ac-text-muted);
  }

  /* Search Input */
  .qp-search-input {
    flex: 1;
    min-width: 0;
    height: 38px;
    padding: 0 12px;
    border-radius: var(--ac-radius-card);
    border: 1px solid var(--qp-input-border);
    background: var(--qp-input-bg);
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    font-size: 14px;
    line-height: 1.2;
    outline: none;
    transition: border-color var(--ac-motion-fast);
  }

  .qp-search-input:focus {
    border-color: var(--ac-accent);
  }

  .qp-search-input::placeholder {
    color: var(--ac-text-placeholder);
  }

  /* Icon Button (Clear, Close, Action, etc.) */
  .qp-icon-btn {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: var(--ac-border-width) solid var(--qp-divider);
    background: transparent;
    color: var(--ac-text-muted);
    border-radius: var(--ac-radius-button);
    cursor: pointer;
    user-select: none;
    flex: none;
    transition: background-color var(--ac-motion-fast), color var(--ac-motion-fast), border-color var(--ac-motion-fast);
  }

  .qp-icon-btn:hover:not(:disabled) {
    background: var(--ac-hover-bg);
    color: var(--ac-text);
  }

  .qp-icon-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .qp-icon-btn svg {
    width: 16px;
    height: 16px;
  }

  /* Action button variant (send/stop) */
  .qp-icon-btn--action {
    width: 32px;
    height: 32px;
  }

  .qp-icon-btn--action svg {
    width: 16px;
    height: 16px;
  }

  .qp-icon-btn--primary {
    background: var(--ac-accent);
    border-color: var(--ac-accent);
    color: var(--ac-accent-contrast);
  }

  .qp-icon-btn--primary:hover:not(:disabled) {
    background: var(--ac-accent-hover);
    border-color: var(--ac-accent-hover);
    color: var(--ac-accent-contrast);
  }

  .qp-icon-btn--danger {
    background: var(--ac-danger);
    border-color: var(--ac-danger);
    color: #ffffff;
  }

  .qp-icon-btn--danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ac-danger) 85%, #000);
    color: #ffffff;
  }

  /* Quick Entries Grid */
  .qp-entries {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 10px;
    padding: 10px 2px;
  }

  .qp-entry {
    border: var(--ac-border-width) solid var(--qp-divider);
    background: var(--ac-surface);
    border-radius: var(--ac-radius-card);
    padding: 14px 10px;
    cursor: pointer;
    user-select: none;
    color: var(--ac-text);
    font-family: var(--ac-font-body);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    transition:
      background-color var(--ac-motion-fast),
      border-color var(--ac-motion-fast),
      box-shadow var(--ac-motion-fast);
  }

  .qp-entry:hover {
    background: var(--ac-hover-bg);
    box-shadow: var(--ac-shadow-card);
  }

  .qp-entry:active {
    box-shadow: none;
  }

  .qp-entry:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .qp-entry[data-active='true'] {
    border-color: var(--ac-accent);
    background: var(--ac-accent-subtle);
  }

  .qp-entry__icon {
    width: 40px;
    height: 40px;
    border-radius: var(--ac-radius-inner);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ac-surface-muted);
    border: var(--ac-border-width) solid var(--qp-divider);
    font-size: 16px;
  }

  .qp-entry__label {
    font-weight: 600;
    font-size: 12px;
    letter-spacing: 0.2px;
  }

  .qp-entry__prefix {
    font-family: var(--ac-font-code);
    font-size: 10px;
    color: var(--ac-text-muted);
    border: var(--ac-border-width) solid var(--qp-divider);
    border-radius: 999px;
    padding: 2px 8px;
    background: var(--ac-surface-muted);
  }

  /* View Mount Points */
  .qp-header-mount,
  .qp-header-right-mount,
  .qp-content-mount,
  .qp-footer-mount {
    display: contents;
  }

  .qp-header-mount[hidden],
  .qp-header-right-mount[hidden],
  .qp-content-mount[hidden],
  .qp-footer-mount[hidden] {
    display: none;
  }

  /* Footer Hints */
  .qp-footer-hints {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 8px 0;
    font-size: 11px;
    color: var(--ac-text-muted);
  }

  .qp-footer-hint {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* ============================================================
   * Markdown Content Styles (for markstream-vue)
   * ============================================================ */

  .qp-markdown-content {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ac-text);
  }

  .qp-markdown-content pre {
    background-color: var(--ac-surface-muted);
    border: var(--ac-border-width) solid var(--ac-border);
    border-radius: var(--ac-radius-inner);
    padding: 12px;
    overflow-x: auto;
    margin: 0.5em 0;
  }

  .qp-markdown-content code {
    font-family: var(--ac-font-code);
    font-size: 0.875em;
    color: var(--ac-text);
  }

  .qp-markdown-content :not(pre) > code {
    background-color: var(--ac-surface-muted);
    padding: 0.125em 0.25em;
    border-radius: 4px;
  }

  .qp-markdown-content p {
    margin: 0.5em 0;
  }

  .qp-markdown-content p:first-child {
    margin-top: 0;
  }

  .qp-markdown-content p:last-child {
    margin-bottom: 0;
  }

  .qp-markdown-content ul,
  .qp-markdown-content ol {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .qp-markdown-content li {
    margin: 0.25em 0;
  }

  .qp-markdown-content h1,
  .qp-markdown-content h2,
  .qp-markdown-content h3,
  .qp-markdown-content h4,
  .qp-markdown-content h5,
  .qp-markdown-content h6 {
    margin: 0.75em 0 0.5em;
    font-weight: 600;
    line-height: 1.3;
  }

  .qp-markdown-content h1 { font-size: 1.5em; }
  .qp-markdown-content h2 { font-size: 1.3em; }
  .qp-markdown-content h3 { font-size: 1.15em; }
  .qp-markdown-content h4 { font-size: 1em; }

  .qp-markdown-content blockquote {
    border-left: 3px solid var(--ac-border-strong);
    padding-left: 1em;
    margin: 0.5em 0;
    color: var(--ac-text-muted);
  }

  .qp-markdown-content a {
    color: var(--ac-link);
    text-decoration: underline;
  }

  .qp-markdown-content a:hover {
    color: var(--ac-link-hover);
  }

  .qp-markdown-content table {
    border-collapse: collapse;
    margin: 0.5em 0;
    width: 100%;
    font-size: 0.9em;
  }

  .qp-markdown-content th,
  .qp-markdown-content td {
    border: var(--ac-border-width) solid var(--ac-border);
    padding: 0.5em;
    text-align: left;
  }

  .qp-markdown-content th {
    background-color: var(--ac-surface-muted);
    font-weight: 600;
  }

  .qp-markdown-content hr {
    border: none;
    border-top: var(--ac-border-width) solid var(--ac-border);
    margin: 1em 0;
  }

  .qp-markdown-content img {
    max-width: 100%;
    height: auto;
    border-radius: var(--ac-radius-inner);
  }

  .qp-markdown-content strong {
    font-weight: 600;
  }

  .qp-markdown-content em {
    font-style: italic;
  }
`
  );
  const DEFAULT_HOST_ID$1 = "__mcp_quick_panel_host__";
  const UI_CONTAINER_ID = "__mcp_quick_panel_ui__";
  const ROOT_ID = "__mcp_quick_panel_root__";
  const DEFAULT_Z_INDEX$1 = 2147483647;
  const THEME_STORAGE_KEY = "agentTheme";
  const DEFAULT_THEME_ID = "warm-editorial";
  const DARK_THEME_ID = "dark-console";
  const VALID_THEME_IDS = /* @__PURE__ */ new Set([
    "warm-editorial",
    "blueprint-architect",
    "zen-journal",
    "neo-pop",
    "dark-console",
    "swiss-grid"
  ]);
  const LIGHT_THEME_IDS = /* @__PURE__ */ new Set([
    "warm-editorial",
    "blueprint-architect",
    "zen-journal",
    "neo-pop",
    "swiss-grid"
  ]);
  const BLOCKED_EVENT_TYPES = [
    // Pointer events
    "pointerdown",
    "pointerup",
    "pointermove",
    "pointerenter",
    "pointerleave",
    "pointercancel",
    // Mouse events
    "mousedown",
    "mouseup",
    "mousemove",
    "mouseenter",
    "mouseleave",
    "click",
    "dblclick",
    "contextmenu",
    // Keyboard events
    "keydown",
    "keyup",
    "keypress",
    // Touch events
    "touchstart",
    "touchmove",
    "touchend",
    "touchcancel",
    // Scroll events
    "wheel",
    // Form events
    "focus",
    "blur",
    "input",
    "change"
  ];
  function setImportantStyle(element, property, value) {
    element.style.setProperty(property, value, "important");
  }
  function normalizeThemeId(value) {
    if (typeof value !== "string") return DEFAULT_THEME_ID;
    const trimmed = value.trim();
    return VALID_THEME_IDS.has(trimmed) ? trimmed : DEFAULT_THEME_ID;
  }
  function systemPrefersDark() {
    var _a2, _b2;
    try {
      return (_b2 = (_a2 = globalThis.matchMedia) == null ? void 0 : _a2.call(globalThis, "(prefers-color-scheme: dark)").matches) != null ? _b2 : false;
    } catch (e) {
      return false;
    }
  }
  function getEffectiveThemeId(baseThemeId) {
    if (systemPrefersDark() && LIGHT_THEME_IDS.has(baseThemeId)) {
      return DARK_THEME_ID;
    }
    return baseThemeId;
  }
  function readStoredThemeId() {
    return __async(this, null, function* () {
      var _a2;
      try {
        if (!((_a2 = chrome == null ? void 0 : chrome.storage) == null ? void 0 : _a2.local)) return DEFAULT_THEME_ID;
        const result2 = yield chrome.storage.local.get(THEME_STORAGE_KEY);
        return normalizeThemeId(result2[THEME_STORAGE_KEY]);
      } catch (e) {
        return DEFAULT_THEME_ID;
      }
    });
  }
  function applyThemeId(root, themeId) {
    const normalizedTheme = normalizeThemeId(themeId);
    const effectiveTheme = getEffectiveThemeId(normalizedTheme);
    root.dataset.agentTheme = effectiveTheme;
  }
  function mountQuickPanelShadowHost(options = {}) {
    var _a2, _b2, _c, _d, _e, _f;
    const disposer = new Disposer();
    let elements = null;
    const hostId = (_a2 = options.hostId) != null ? _a2 : DEFAULT_HOST_ID$1;
    const zIndex = (_b2 = options.zIndex) != null ? _b2 : DEFAULT_Z_INDEX$1;
    const existing = document.getElementById(hostId);
    if (existing) {
      try {
        existing.remove();
      } catch (e) {
      }
    }
    const host = document.createElement("div");
    host.id = hostId;
    host.setAttribute("data-mcp-quick-panel", "true");
    setImportantStyle(host, "position", "fixed");
    setImportantStyle(host, "inset", "0");
    setImportantStyle(host, "z-index", String(zIndex));
    setImportantStyle(host, "pointer-events", "none");
    setImportantStyle(host, "contain", "layout style paint");
    setImportantStyle(host, "isolation", "isolate");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = QUICK_PANEL_STYLES;
    shadowRoot.append(styleEl);
    const uiRoot = document.createElement("div");
    uiRoot.id = UI_CONTAINER_ID;
    setImportantStyle(uiRoot, "position", "fixed");
    setImportantStyle(uiRoot, "inset", "0");
    setImportantStyle(uiRoot, "pointer-events", "none");
    shadowRoot.append(uiRoot);
    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = "agent-theme qp-root";
    const initialTheme = getEffectiveThemeId(DEFAULT_THEME_ID);
    root.dataset.agentTheme = initialTheme;
    uiRoot.append(root);
    const mountPoint = (_c = document.documentElement) != null ? _c : document.body;
    mountPoint.append(host);
    disposer.add(() => host.remove());
    elements = { host, shadowRoot, uiRoot, root };
    const stopPropagation = (event) => {
      event.stopPropagation();
    };
    for (const eventType of BLOCKED_EVENT_TYPES) {
      disposer.listen(root, eventType, stopPropagation);
    }
    void (() => __async(null, null, function* () {
      const themeId = yield readStoredThemeId();
      applyThemeId(root, themeId);
    }))();
    let currentStoredThemeId = DEFAULT_THEME_ID;
    void (() => __async(null, null, function* () {
      currentStoredThemeId = yield readStoredThemeId();
    }))();
    const handleStorageChange = (changes, areaName) => {
      if (areaName !== "local") return;
      const change = changes[THEME_STORAGE_KEY];
      if (!change) return;
      currentStoredThemeId = normalizeThemeId(change.newValue);
      applyThemeId(root, currentStoredThemeId);
    };
    try {
      (_e = (_d = chrome == null ? void 0 : chrome.storage) == null ? void 0 : _d.onChanged) == null ? void 0 : _e.addListener(handleStorageChange);
      disposer.add(() => {
        var _a3, _b3;
        return (_b3 = (_a3 = chrome == null ? void 0 : chrome.storage) == null ? void 0 : _a3.onChanged) == null ? void 0 : _b3.removeListener(handleStorageChange);
      });
    } catch (e) {
    }
    try {
      const darkModeMediaQuery = (_f = globalThis.matchMedia) == null ? void 0 : _f.call(globalThis, "(prefers-color-scheme: dark)");
      if (darkModeMediaQuery) {
        const handleDarkModeChange = () => {
          applyThemeId(root, currentStoredThemeId);
        };
        if (typeof darkModeMediaQuery.addEventListener === "function") {
          darkModeMediaQuery.addEventListener("change", handleDarkModeChange);
          disposer.add(() => darkModeMediaQuery.removeEventListener("change", handleDarkModeChange));
        }
      }
    } catch (e) {
    }
    const isOverlayElement = (node) => {
      if (!(node instanceof Node)) return false;
      if (node === host) return true;
      const rootNode = typeof node.getRootNode === "function" ? node.getRootNode() : null;
      return rootNode instanceof ShadowRoot && rootNode.host === host;
    };
    const isEventFromUi = (event) => {
      try {
        if (typeof event.composedPath === "function") {
          return event.composedPath().some((el) => isOverlayElement(el));
        }
      } catch (e) {
      }
      return isOverlayElement(event.target);
    };
    return {
      getElements: () => elements,
      isOverlayElement,
      isEventFromUi,
      dispose: () => {
        elements = null;
        disposer.dispose();
      }
    };
  }
  const DEFAULT_HOST_ID = "__mcp_element_picker_host__";
  const DEFAULT_Z_INDEX = 2147483647;
  const ELEMENT_PICKER_STYLES = (
    /* css */
    `
  /* Overlay positioning - bottom-right corner */
  .ep-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: flex-end;
    padding: 16px;
    pointer-events: none;
  }

  /* Panel sizing */
  .ep-panel {
    width: min(480px, calc(100vw - 32px));
    max-height: min(600px, calc(100vh - 32px));
    pointer-events: auto;
  }

  /* Countdown badge */
  .ep-countdown {
    font-family: var(--ac-font-code);
    font-size: 12px;
    color: var(--ac-text-muted);
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid var(--qp-glass-divider);
    background: color-mix(in srgb, var(--qp-glass-input-bg) 80%, transparent);
    user-select: none;
    white-space: nowrap;
  }

  .ep-countdown--warning {
    color: var(--ac-warning);
    border-color: color-mix(in srgb, var(--ac-warning) 40%, var(--qp-glass-divider));
  }

  .ep-countdown--danger {
    color: var(--ac-danger);
    border-color: color-mix(in srgb, var(--ac-danger) 40%, var(--qp-glass-divider));
    animation: ep-pulse 1s ease-in-out infinite;
  }

  @keyframes ep-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* Hint text */
  .ep-hint {
    margin: 0 0 10px 0;
    font-size: 12px;
    color: var(--ac-text-muted);
  }

  /* Error banner */
  .ep-error {
    margin: 0 0 10px 0;
    padding: 8px 10px;
    border-radius: var(--ac-radius-card);
    border: 1px solid color-mix(in srgb, var(--ac-danger) 55%, var(--ac-border));
    background: color-mix(in srgb, var(--ac-danger) 10%, transparent);
    color: color-mix(in srgb, var(--ac-danger) 85%, var(--ac-text));
    font-size: 12px;
  }

  /* Request list */
  .ep-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* Request item card */
  .ep-item {
    border-radius: var(--ac-radius-card);
    border: var(--ac-border-width) solid var(--ac-border);
    box-shadow: var(--ac-shadow-card);
    background: var(--ac-surface);
    padding: 10px 12px;
    transition: border-color var(--ac-motion-fast), box-shadow var(--ac-motion-fast);
  }

  .ep-item--active {
    border-color: color-mix(in srgb, var(--ac-accent) 55%, var(--ac-border));
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--ac-accent-subtle) 65%, transparent),
      var(--ac-shadow-card);
  }

  /* Item header */
  .ep-item-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .ep-item-title {
    min-width: 0;
    font-weight: 600;
    font-size: 13px;
    color: var(--ac-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Status badge */
  .ep-badge {
    flex: none;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--qp-glass-divider);
    color: var(--ac-text-muted);
    background: color-mix(in srgb, var(--ac-surface-muted) 65%, transparent);
    user-select: none;
  }

  .ep-badge--selected {
    border-color: color-mix(in srgb, var(--ac-success) 55%, var(--qp-glass-divider));
    color: color-mix(in srgb, var(--ac-success) 85%, var(--ac-text));
    background: color-mix(in srgb, var(--ac-success) 10%, transparent);
  }

  .ep-badge--picking {
    border-color: color-mix(in srgb, var(--ac-accent) 55%, var(--qp-glass-divider));
    color: var(--ac-accent);
    background: color-mix(in srgb, var(--ac-accent) 10%, transparent);
    animation: ep-pulse 1.5s ease-in-out infinite;
  }

  /* Description text */
  .ep-desc {
    margin-top: 6px;
    font-size: 12px;
    color: var(--ac-text-muted);
    white-space: pre-wrap;
  }

  /* Picked element info */
  .ep-picked {
    margin-top: 8px;
    font-size: 12px;
    color: var(--ac-text);
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
    border-radius: var(--ac-radius-inner);
    background: var(--ac-surface-muted);
  }

  .ep-picked-text {
    font-weight: 500;
    word-break: break-word;
  }

  .ep-picked-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    font-size: 11px;
  }

  .ep-picked code {
    font-family: var(--ac-font-code);
    font-size: 10px;
    color: var(--ac-text-muted);
    padding: 2px 4px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.05);
    word-break: break-all;
  }

  /* Action buttons row */
  .ep-actions {
    margin-top: 8px;
    display: flex;
    gap: 8px;
  }

  /* Footer */
  .ep-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .ep-footer-left {
    font-size: 11px;
    color: var(--ac-text-muted);
  }

  .ep-footer-right {
    display: flex;
    gap: 8px;
  }
`
  );
  function formatCountdown(deadlineTs) {
    const remainingMs = Math.max(0, deadlineTs - Date.now());
    const totalSeconds = Math.floor(remainingMs / 1e3);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const text = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    let level = "normal";
    if (totalSeconds <= 30) {
      level = "danger";
    } else if (totalSeconds <= 60) {
      level = "warning";
    }
    return { text, level };
  }
  function truncate(text, max = 80) {
    const t = String(text || "").trim().replace(/\s+/g, " ");
    if (t.length <= max) return t;
    return `${t.slice(0, Math.max(0, max - 1))}...`;
  }
  function createElementPickerController(options = {}) {
    var _a2, _b2;
    let disposed = false;
    let shadowHost = null;
    let elements = null;
    let disposer = null;
    let state = null;
    let overlayEl = null;
    let panelEl = null;
    let countdownEl = null;
    let errorEl = null;
    let listEl = null;
    let confirmBtn = null;
    let cancelBtn = null;
    let progressEl = null;
    let timerId = null;
    const itemElementsMap = /* @__PURE__ */ new Map();
    const hostId = (_a2 = options.hostId) != null ? _a2 : DEFAULT_HOST_ID;
    const zIndex = (_b2 = options.zIndex) != null ? _b2 : DEFAULT_Z_INDEX;
    function ensureMounted() {
      if (shadowHost && elements) return;
      shadowHost = mountQuickPanelShadowHost({ hostId, zIndex });
      elements = shadowHost.getElements();
      if (!elements) throw new Error("Failed to mount Element Picker shadow host");
      const localDisposer = new Disposer();
      disposer = localDisposer;
      const styleEl = document.createElement("style");
      styleEl.textContent = ELEMENT_PICKER_STYLES;
      elements.shadowRoot.append(styleEl);
      localDisposer.add(() => styleEl.remove());
      overlayEl = document.createElement("div");
      overlayEl.className = "ep-overlay";
      panelEl = document.createElement("div");
      panelEl.className = "qp-panel qp-liquid-shimmer ep-panel";
      panelEl.setAttribute("role", "dialog");
      panelEl.setAttribute("aria-modal", "false");
      panelEl.setAttribute("aria-label", "Element Picker");
      const headerEl = document.createElement("div");
      headerEl.className = "qp-header";
      const headerLeft = document.createElement("div");
      headerLeft.className = "qp-header-left";
      const brand = document.createElement("div");
      brand.className = "qp-brand";
      brand.textContent = "👆";
      const title = document.createElement("div");
      title.className = "qp-title";
      const titleName = document.createElement("div");
      titleName.className = "qp-title-name";
      titleName.textContent = "Element Picker";
      const titleSub = document.createElement("div");
      titleSub.className = "qp-title-sub";
      titleSub.textContent = "Click on the requested elements";
      title.append(titleName, titleSub);
      headerLeft.append(brand, title);
      const headerRight = document.createElement("div");
      headerRight.className = "qp-header-right";
      countdownEl = document.createElement("span");
      countdownEl.className = "ep-countdown";
      countdownEl.textContent = "03:00";
      headerRight.append(countdownEl);
      headerEl.append(headerLeft, headerRight);
      const contentEl = document.createElement("div");
      contentEl.className = "qp-content ac-scroll";
      const hintEl = document.createElement("div");
      hintEl.className = "ep-hint";
      hintEl.textContent = "Click on each element the AI needs. Press Esc to cancel.";
      errorEl = document.createElement("div");
      errorEl.className = "ep-error";
      errorEl.hidden = true;
      listEl = document.createElement("div");
      listEl.className = "ep-list";
      contentEl.append(hintEl, errorEl, listEl);
      const footerEl = document.createElement("div");
      footerEl.className = "qp-composer";
      const footerInner = document.createElement("div");
      footerInner.className = "ep-footer";
      const footerLeft = document.createElement("div");
      footerLeft.className = "ep-footer-left";
      progressEl = document.createElement("span");
      progressEl.textContent = "0/0 selected";
      footerLeft.append(progressEl);
      const footerRight = document.createElement("div");
      footerRight.className = "ep-footer-right";
      cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "qp-btn ac-btn ac-focus-ring";
      cancelBtn.textContent = "Cancel";
      confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.className = "qp-btn ac-btn ac-focus-ring qp-btn--primary";
      confirmBtn.textContent = "Confirm";
      footerRight.append(cancelBtn, confirmBtn);
      footerInner.append(footerLeft, footerRight);
      footerEl.append(footerInner);
      panelEl.append(headerEl, contentEl, footerEl);
      overlayEl.append(panelEl);
      elements.root.append(overlayEl);
      localDisposer.add(() => overlayEl == null ? void 0 : overlayEl.remove());
      localDisposer.listen(cancelBtn, "click", () => {
        var _a3;
        return (_a3 = options.onCancel) == null ? void 0 : _a3.call(options);
      });
      localDisposer.listen(confirmBtn, "click", () => {
        var _a3;
        return (_a3 = options.onConfirm) == null ? void 0 : _a3.call(options);
      });
      const handleEscKey = (e) => {
        var _a3;
        if (e instanceof KeyboardEvent && e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          (_a3 = options.onCancel) == null ? void 0 : _a3.call(options);
        }
      };
      elements.shadowRoot.addEventListener("keydown", handleEscKey, { capture: true });
      localDisposer.add(
        () => elements == null ? void 0 : elements.shadowRoot.removeEventListener("keydown", handleEscKey, { capture: true })
      );
    }
    function clearTimer() {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    }
    function renderCountdown() {
      if (!state || !countdownEl) return;
      const countdown = formatCountdown(state.deadlineTs);
      countdownEl.textContent = countdown.text;
      countdownEl.className = `ep-countdown${countdown.level !== "normal" ? ` ep-countdown--${countdown.level}` : ""}`;
    }
    function createPickedInfoEl(picked) {
      const pickedEl = document.createElement("div");
      pickedEl.className = "ep-picked";
      if (picked.text) {
        const textEl = document.createElement("div");
        textEl.className = "ep-picked-text";
        textEl.textContent = `"${truncate(picked.text, 80)}"`;
        pickedEl.append(textEl);
      }
      const metaEl = document.createElement("div");
      metaEl.className = "ep-picked-meta";
      const tagCode = document.createElement("code");
      tagCode.textContent = picked.tagName || "element";
      metaEl.append(tagCode);
      const refCode = document.createElement("code");
      refCode.textContent = `ref=${picked.ref}`;
      metaEl.append(refCode);
      if (picked.frameId > 0) {
        const frameCode = document.createElement("code");
        frameCode.textContent = `frame=${picked.frameId}`;
        metaEl.append(frameCode);
      }
      pickedEl.append(metaEl);
      const selectorEl = document.createElement("div");
      const selectorCode = document.createElement("code");
      selectorCode.textContent = truncate(picked.selector || "", 100);
      selectorEl.append(selectorCode);
      pickedEl.append(selectorEl);
      return pickedEl;
    }
    function createItemEl(req) {
      const item = document.createElement("div");
      item.className = "ep-item";
      item.dataset.requestId = req.id;
      const header = document.createElement("div");
      header.className = "ep-item-header";
      const titleEl = document.createElement("div");
      titleEl.className = "ep-item-title";
      titleEl.textContent = req.name;
      const badge = document.createElement("div");
      badge.className = "ep-badge";
      badge.textContent = "Pending";
      header.append(titleEl, badge);
      item.append(header);
      if (req.description) {
        const desc = document.createElement("div");
        desc.className = "ep-desc";
        desc.textContent = req.description;
        item.append(desc);
      }
      const actions = document.createElement("div");
      actions.className = "ep-actions";
      const pickBtn = document.createElement("button");
      pickBtn.type = "button";
      pickBtn.className = "qp-btn ac-btn ac-focus-ring";
      pickBtn.textContent = "Pick";
      pickBtn.addEventListener("click", () => {
        var _a3;
        return (_a3 = options.onSetActiveRequest) == null ? void 0 : _a3.call(options, req.id);
      });
      const clearBtn = document.createElement("button");
      clearBtn.type = "button";
      clearBtn.className = "qp-btn ac-btn ac-focus-ring";
      clearBtn.textContent = "Clear";
      clearBtn.disabled = true;
      clearBtn.addEventListener("click", () => {
        var _a3;
        return (_a3 = options.onClearSelection) == null ? void 0 : _a3.call(options, req.id);
      });
      actions.append(pickBtn, clearBtn);
      item.append(actions);
      return { container: item, badge, pickedContainer: null, pickBtn, clearBtn };
    }
    function updateItemEl(itemEls, req, picked, isActive) {
      var _a3;
      const { container, badge, pickBtn, clearBtn } = itemEls;
      container.classList.toggle("ep-item--active", isActive);
      if (picked) {
        badge.className = "ep-badge ep-badge--selected";
        badge.textContent = "Selected";
      } else if (isActive) {
        badge.className = "ep-badge ep-badge--picking";
        badge.textContent = "Picking...";
      } else {
        badge.className = "ep-badge";
        badge.textContent = "Pending";
      }
      pickBtn.textContent = isActive ? "Picking..." : "Pick";
      pickBtn.disabled = isActive;
      clearBtn.disabled = !picked;
      const actionsEl = container.querySelector(".ep-actions");
      if (picked) {
        if (!itemEls.pickedContainer) {
          const pickedEl = createPickedInfoEl(picked);
          (_a3 = actionsEl == null ? void 0 : actionsEl.parentNode) == null ? void 0 : _a3.insertBefore(pickedEl, actionsEl);
          itemEls.pickedContainer = pickedEl;
        } else {
          const newPickedEl = createPickedInfoEl(picked);
          itemEls.pickedContainer.replaceWith(newPickedEl);
          itemEls.pickedContainer = newPickedEl;
        }
      } else if (itemEls.pickedContainer) {
        itemEls.pickedContainer.remove();
        itemEls.pickedContainer = null;
      }
    }
    function buildList() {
      if (!state || !listEl) return;
      listEl.innerHTML = "";
      itemElementsMap.clear();
      for (const req of state.requests) {
        const itemEls = createItemEl(req);
        itemElementsMap.set(req.id, itemEls);
        listEl.append(itemEls.container);
      }
    }
    function render() {
      if (!state || !listEl || !countdownEl || !confirmBtn || !errorEl || !progressEl) return;
      renderCountdown();
      const err = state.errorMessage ? state.errorMessage.trim() : "";
      if (err) {
        errorEl.hidden = false;
        errorEl.textContent = err;
      } else {
        errorEl.hidden = true;
        errorEl.textContent = "";
      }
      const needsRebuild = itemElementsMap.size !== state.requests.length || state.requests.some((r) => !itemElementsMap.has(r.id));
      if (needsRebuild) {
        buildList();
      }
      let selectedCount = 0;
      for (const req of state.requests) {
        const picked = state.selections[req.id] || null;
        const isActive = state.activeRequestId === req.id;
        if (picked) selectedCount++;
        const itemEls = itemElementsMap.get(req.id);
        if (itemEls) {
          updateItemEl(itemEls, req, picked, isActive);
        }
      }
      progressEl.textContent = `${selectedCount}/${state.requests.length} selected`;
      const allSelected = selectedCount === state.requests.length;
      confirmBtn.disabled = !allSelected;
      confirmBtn.textContent = allSelected ? "Confirm" : `Confirm (${selectedCount}/${state.requests.length})`;
    }
    function show(next) {
      if (disposed) return;
      ensureMounted();
      state = next;
      render();
      clearTimer();
      timerId = setInterval(() => {
        if (disposed || !state) return;
        renderCountdown();
      }, 250);
    }
    function update(patch) {
      var _a3, _b3, _c, _d, _e;
      if (disposed) return;
      if (!state || state.sessionId !== patch.sessionId) {
        return;
      }
      state = __spreadProps(__spreadValues(__spreadValues({}, state), patch), {
        sessionId: state.sessionId,
        // Keep stable
        requests: (_a3 = patch.requests) != null ? _a3 : state.requests,
        activeRequestId: (_b3 = patch.activeRequestId) != null ? _b3 : state.activeRequestId,
        selections: (_c = patch.selections) != null ? _c : state.selections,
        deadlineTs: (_d = patch.deadlineTs) != null ? _d : state.deadlineTs,
        errorMessage: (_e = patch.errorMessage) != null ? _e : state.errorMessage
      });
      render();
    }
    function hide() {
      clearTimer();
      state = null;
      itemElementsMap.clear();
      try {
        disposer == null ? void 0 : disposer.dispose();
      } finally {
        disposer = null;
      }
      overlayEl = null;
      panelEl = null;
      countdownEl = null;
      errorEl = null;
      listEl = null;
      confirmBtn = null;
      cancelBtn = null;
      progressEl = null;
      try {
        shadowHost == null ? void 0 : shadowHost.dispose();
      } finally {
        shadowHost = null;
        elements = null;
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      hide();
    }
    return {
      show,
      update,
      hide,
      isVisible: () => !!shadowHost && !!elements,
      dispose
    };
  }
  const BACKGROUND_MESSAGE_TYPES = {
    // Element picker (human-in-the-loop element selection)
    ELEMENT_PICKER_UI_EVENT: "element_picker_ui_event"
  };
  const TOOL_MESSAGE_TYPES = {
    ELEMENT_PICKER_UI_PING: "elementPickerUiPing",
    ELEMENT_PICKER_UI_SHOW: "elementPickerUiShow",
    ELEMENT_PICKER_UI_UPDATE: "elementPickerUiUpdate",
    ELEMENT_PICKER_UI_HIDE: "elementPickerUiHide"
  };
  const definition = defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_idle",
    main() {
      if (window.top !== window) return;
      let controller = null;
      let currentSessionId = null;
      function ensureController() {
        if (controller) return controller;
        controller = createElementPickerController({
          onCancel: () => {
            if (!currentSessionId) return;
            void chrome.runtime.sendMessage({
              type: BACKGROUND_MESSAGE_TYPES.ELEMENT_PICKER_UI_EVENT,
              sessionId: currentSessionId,
              event: "cancel"
            });
          },
          onConfirm: () => {
            if (!currentSessionId) return;
            void chrome.runtime.sendMessage({
              type: BACKGROUND_MESSAGE_TYPES.ELEMENT_PICKER_UI_EVENT,
              sessionId: currentSessionId,
              event: "confirm"
            });
          },
          onSetActiveRequest: (requestId) => {
            if (!currentSessionId) return;
            void chrome.runtime.sendMessage({
              type: BACKGROUND_MESSAGE_TYPES.ELEMENT_PICKER_UI_EVENT,
              sessionId: currentSessionId,
              event: "set_active_request",
              requestId
            });
          },
          onClearSelection: (requestId) => {
            if (!currentSessionId) return;
            void chrome.runtime.sendMessage({
              type: BACKGROUND_MESSAGE_TYPES.ELEMENT_PICKER_UI_EVENT,
              sessionId: currentSessionId,
              event: "clear_selection",
              requestId
            });
          }
        });
        return controller;
      }
      function handleMessage(message, _sender, sendResponse) {
        var _a2, _b2, _c;
        const msg = message;
        if (!(msg == null ? void 0 : msg.action)) return false;
        if (msg.action === TOOL_MESSAGE_TYPES.ELEMENT_PICKER_UI_PING) {
          sendResponse({ success: true });
          return true;
        }
        if (msg.action === TOOL_MESSAGE_TYPES.ELEMENT_PICKER_UI_SHOW) {
          const showMsg = msg;
          currentSessionId = typeof showMsg.sessionId === "string" ? showMsg.sessionId : null;
          if (!currentSessionId) {
            sendResponse({ success: false, error: "Missing sessionId" });
            return true;
          }
          const ctrl = ensureController();
          const initialState = {
            sessionId: currentSessionId,
            requests: Array.isArray(showMsg.requests) ? showMsg.requests : [],
            activeRequestId: (_a2 = showMsg.activeRequestId) != null ? _a2 : null,
            selections: {},
            deadlineTs: typeof showMsg.deadlineTs === "number" ? showMsg.deadlineTs : Date.now(),
            errorMessage: null
          };
          ctrl.show(initialState);
          sendResponse({ success: true });
          return true;
        }
        if (msg.action === TOOL_MESSAGE_TYPES.ELEMENT_PICKER_UI_UPDATE) {
          const updateMsg = msg;
          if (!currentSessionId || updateMsg.sessionId !== currentSessionId) {
            sendResponse({ success: false, error: "Session mismatch" });
            return true;
          }
          controller == null ? void 0 : controller.update({
            sessionId: currentSessionId,
            activeRequestId: (_b2 = updateMsg.activeRequestId) != null ? _b2 : null,
            selections: updateMsg.selections || {},
            deadlineTs: updateMsg.deadlineTs,
            errorMessage: (_c = updateMsg.errorMessage) != null ? _c : null
          });
          sendResponse({ success: true });
          return true;
        }
        if (msg.action === TOOL_MESSAGE_TYPES.ELEMENT_PICKER_UI_HIDE) {
          const hideMsg = msg;
          if (currentSessionId && hideMsg.sessionId !== currentSessionId) {
            console.warn("[ElementPicker] Session mismatch on hide, hiding anyway");
          }
          controller == null ? void 0 : controller.hide();
          currentSessionId = null;
          sendResponse({ success: true });
          return true;
        }
        return false;
      }
      chrome.runtime.onMessage.addListener(handleMessage);
      window.addEventListener("unload", () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        controller == null ? void 0 : controller.dispose();
        controller = null;
        currentSessionId = null;
      });
    }
  });
  const browser$1 = ((_b = (_a = globalThis.browser) == null ? void 0 : _a.runtime) == null ? void 0 : _b.id) ? globalThis.browser : globalThis.chrome;
  const browser = browser$1;
  function print$1(method, ...args) {
    return;
  }
  const logger$1 = {
    debug: (...args) => print$1(console.debug, ...args),
    log: (...args) => print$1(console.log, ...args),
    warn: (...args) => print$1(console.warn, ...args),
    error: (...args) => print$1(console.error, ...args)
  };
  const _WxtLocationChangeEvent = class _WxtLocationChangeEvent extends Event {
    constructor(newUrl, oldUrl) {
      super(_WxtLocationChangeEvent.EVENT_NAME, {});
      this.newUrl = newUrl;
      this.oldUrl = oldUrl;
    }
  };
  __publicField(_WxtLocationChangeEvent, "EVENT_NAME", getUniqueEventName("wxt:locationchange"));
  let WxtLocationChangeEvent = _WxtLocationChangeEvent;
  function getUniqueEventName(eventName) {
    var _a2;
    return `${(_a2 = browser == null ? void 0 : browser.runtime) == null ? void 0 : _a2.id}:${"element-picker"}:${eventName}`;
  }
  function createLocationWatcher(ctx) {
    let interval;
    let oldUrl;
    return {
      /**
       * Ensure the location watcher is actively looking for URL changes. If it's already watching,
       * this is a noop.
       */
      run() {
        if (interval != null) return;
        oldUrl = new URL(location.href);
        interval = ctx.setInterval(() => {
          let newUrl = new URL(location.href);
          if (newUrl.href !== oldUrl.href) {
            window.dispatchEvent(new WxtLocationChangeEvent(newUrl, oldUrl));
            oldUrl = newUrl;
          }
        }, 1e3);
      }
    };
  }
  const _ContentScriptContext = class _ContentScriptContext {
    constructor(contentScriptName, options) {
      __publicField(this, "isTopFrame", window.self === window.top);
      __publicField(this, "abortController");
      __publicField(this, "locationWatcher", createLocationWatcher(this));
      __publicField(this, "receivedMessageIds", /* @__PURE__ */ new Set());
      this.contentScriptName = contentScriptName;
      this.options = options;
      this.abortController = new AbortController();
      if (this.isTopFrame) {
        this.listenForNewerScripts({ ignoreFirstEvent: true });
        this.stopOldScripts();
      } else {
        this.listenForNewerScripts();
      }
    }
    get signal() {
      return this.abortController.signal;
    }
    abort(reason) {
      return this.abortController.abort(reason);
    }
    get isInvalid() {
      if (browser.runtime.id == null) {
        this.notifyInvalidated();
      }
      return this.signal.aborted;
    }
    get isValid() {
      return !this.isInvalid;
    }
    /**
     * Add a listener that is called when the content script's context is invalidated.
     *
     * @returns A function to remove the listener.
     *
     * @example
     * browser.runtime.onMessage.addListener(cb);
     * const removeInvalidatedListener = ctx.onInvalidated(() => {
     *   browser.runtime.onMessage.removeListener(cb);
     * })
     * // ...
     * removeInvalidatedListener();
     */
    onInvalidated(cb) {
      this.signal.addEventListener("abort", cb);
      return () => this.signal.removeEventListener("abort", cb);
    }
    /**
     * Return a promise that never resolves. Useful if you have an async function that shouldn't run
     * after the context is expired.
     *
     * @example
     * const getValueFromStorage = async () => {
     *   if (ctx.isInvalid) return ctx.block();
     *
     *   // ...
     * }
     */
    block() {
      return new Promise(() => {
      });
    }
    /**
     * Wrapper around `window.setInterval` that automatically clears the interval when invalidated.
     *
     * Intervals can be cleared by calling the normal `clearInterval` function.
     */
    setInterval(handler, timeout) {
      const id = setInterval(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearInterval(id));
      return id;
    }
    /**
     * Wrapper around `window.setTimeout` that automatically clears the interval when invalidated.
     *
     * Timeouts can be cleared by calling the normal `setTimeout` function.
     */
    setTimeout(handler, timeout) {
      const id = setTimeout(() => {
        if (this.isValid) handler();
      }, timeout);
      this.onInvalidated(() => clearTimeout(id));
      return id;
    }
    /**
     * Wrapper around `window.requestAnimationFrame` that automatically cancels the request when
     * invalidated.
     *
     * Callbacks can be canceled by calling the normal `cancelAnimationFrame` function.
     */
    requestAnimationFrame(callback) {
      const id = requestAnimationFrame((...args) => {
        if (this.isValid) callback(...args);
      });
      this.onInvalidated(() => cancelAnimationFrame(id));
      return id;
    }
    /**
     * Wrapper around `window.requestIdleCallback` that automatically cancels the request when
     * invalidated.
     *
     * Callbacks can be canceled by calling the normal `cancelIdleCallback` function.
     */
    requestIdleCallback(callback, options) {
      const id = requestIdleCallback((...args) => {
        if (!this.signal.aborted) callback(...args);
      }, options);
      this.onInvalidated(() => cancelIdleCallback(id));
      return id;
    }
    addEventListener(target, type, handler, options) {
      var _a2;
      if (type === "wxt:locationchange") {
        if (this.isValid) this.locationWatcher.run();
      }
      (_a2 = target.addEventListener) == null ? void 0 : _a2.call(
        target,
        type.startsWith("wxt:") ? getUniqueEventName(type) : type,
        handler,
        __spreadProps(__spreadValues({}, options), {
          signal: this.signal
        })
      );
    }
    /**
     * @internal
     * Abort the abort controller and execute all `onInvalidated` listeners.
     */
    notifyInvalidated() {
      this.abort("Content script context invalidated");
      logger$1.debug(
        `Content script "${this.contentScriptName}" context invalidated`
      );
    }
    stopOldScripts() {
      window.postMessage(
        {
          type: _ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE,
          contentScriptName: this.contentScriptName,
          messageId: Math.random().toString(36).slice(2)
        },
        "*"
      );
    }
    verifyScriptStartedEvent(event) {
      var _a2, _b2, _c;
      const isScriptStartedEvent = ((_a2 = event.data) == null ? void 0 : _a2.type) === _ContentScriptContext.SCRIPT_STARTED_MESSAGE_TYPE;
      const isSameContentScript = ((_b2 = event.data) == null ? void 0 : _b2.contentScriptName) === this.contentScriptName;
      const isNotDuplicate = !this.receivedMessageIds.has((_c = event.data) == null ? void 0 : _c.messageId);
      return isScriptStartedEvent && isSameContentScript && isNotDuplicate;
    }
    listenForNewerScripts(options) {
      let isFirst = true;
      const cb = (event) => {
        if (this.verifyScriptStartedEvent(event)) {
          this.receivedMessageIds.add(event.data.messageId);
          const wasFirst = isFirst;
          isFirst = false;
          if (wasFirst && (options == null ? void 0 : options.ignoreFirstEvent)) return;
          this.notifyInvalidated();
        }
      };
      addEventListener("message", cb);
      this.onInvalidated(() => removeEventListener("message", cb));
    }
  };
  __publicField(_ContentScriptContext, "SCRIPT_STARTED_MESSAGE_TYPE", getUniqueEventName(
    "wxt:content-script-started"
  ));
  let ContentScriptContext = _ContentScriptContext;
  function initPlugins() {
  }
  function print(method, ...args) {
    return;
  }
  const logger = {
    debug: (...args) => print(console.debug, ...args),
    log: (...args) => print(console.log, ...args),
    warn: (...args) => print(console.warn, ...args),
    error: (...args) => print(console.error, ...args)
  };
  const result = (() => __async(null, null, function* () {
    try {
      initPlugins();
      const _a2 = definition, { main } = _a2, options = __objRest(_a2, ["main"]);
      const ctx = new ContentScriptContext("element-picker", options);
      return yield main(ctx);
    } catch (err) {
      logger.error(
        `The content script "${"element-picker"}" crashed on startup!`,
        err
      );
      throw err;
    }
  }))();
  return result;
})();
elementPicker;