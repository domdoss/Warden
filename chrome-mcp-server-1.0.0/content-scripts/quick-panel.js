var quickPanel = (function() {
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
  const BACKGROUND_MESSAGE_TYPES = {
    SWITCH_SEMANTIC_MODEL: "switch_semantic_model",
    GET_MODEL_STATUS: "get_model_status",
    UPDATE_MODEL_STATUS: "update_model_status",
    GET_STORAGE_STATS: "get_storage_stats",
    CLEAR_ALL_DATA: "clear_all_data",
    GET_SERVER_STATUS: "get_server_status",
    REFRESH_SERVER_STATUS: "refresh_server_status",
    SERVER_STATUS_CHANGED: "server_status_changed",
    INITIALIZE_SEMANTIC_ENGINE: "initialize_semantic_engine",
    // Record & Replay background control and queries
    RR_START_RECORDING: "rr_start_recording",
    RR_STOP_RECORDING: "rr_stop_recording",
    RR_PAUSE_RECORDING: "rr_pause_recording",
    RR_RESUME_RECORDING: "rr_resume_recording",
    RR_GET_RECORDING_STATUS: "rr_get_recording_status",
    RR_LIST_FLOWS: "rr_list_flows",
    RR_FLOWS_CHANGED: "rr_flows_changed",
    RR_GET_FLOW: "rr_get_flow",
    RR_DELETE_FLOW: "rr_delete_flow",
    RR_PUBLISH_FLOW: "rr_publish_flow",
    RR_UNPUBLISH_FLOW: "rr_unpublish_flow",
    RR_RUN_FLOW: "rr_run_flow",
    RR_SAVE_FLOW: "rr_save_flow",
    RR_EXPORT_FLOW: "rr_export_flow",
    RR_EXPORT_ALL: "rr_export_all",
    RR_IMPORT_FLOW: "rr_import_flow",
    RR_LIST_RUNS: "rr_list_runs",
    // Triggers
    RR_LIST_TRIGGERS: "rr_list_triggers",
    RR_SAVE_TRIGGER: "rr_save_trigger",
    RR_DELETE_TRIGGER: "rr_delete_trigger",
    RR_REFRESH_TRIGGERS: "rr_refresh_triggers",
    // Scheduling
    RR_SCHEDULE_FLOW: "rr_schedule_flow",
    RR_UNSCHEDULE_FLOW: "rr_unschedule_flow",
    RR_LIST_SCHEDULES: "rr_list_schedules",
    // Element marker management
    ELEMENT_MARKER_LIST_ALL: "element_marker_list_all",
    ELEMENT_MARKER_LIST_FOR_URL: "element_marker_list_for_url",
    ELEMENT_MARKER_SAVE: "element_marker_save",
    ELEMENT_MARKER_UPDATE: "element_marker_update",
    ELEMENT_MARKER_DELETE: "element_marker_delete",
    ELEMENT_MARKER_VALIDATE: "element_marker_validate",
    ELEMENT_MARKER_START: "element_marker_start_from_popup",
    // Element picker (human-in-the-loop element selection)
    ELEMENT_PICKER_UI_EVENT: "element_picker_ui_event",
    ELEMENT_PICKER_FRAME_EVENT: "element_picker_frame_event",
    // Web editor (in-page visual editing)
    WEB_EDITOR_TOGGLE: "web_editor_toggle",
    WEB_EDITOR_APPLY: "web_editor_apply",
    WEB_EDITOR_STATUS_QUERY: "web_editor_status_query",
    // Web editor <-> AgentChat integration (Phase 1.1)
    WEB_EDITOR_APPLY_BATCH: "web_editor_apply_batch",
    WEB_EDITOR_TX_CHANGED: "web_editor_tx_changed",
    WEB_EDITOR_HIGHLIGHT_ELEMENT: "web_editor_highlight_element",
    // Web editor <-> AgentChat integration (Phase 2 - Revert)
    WEB_EDITOR_REVERT_ELEMENT: "web_editor_revert_element",
    // Web editor <-> AgentChat integration - Selection sync
    WEB_EDITOR_SELECTION_CHANGED: "web_editor_selection_changed",
    // Web editor <-> AgentChat integration - Clear selection (sidepanel -> web-editor)
    WEB_EDITOR_CLEAR_SELECTION: "web_editor_clear_selection",
    // Web editor <-> AgentChat integration - Cancel execution
    WEB_EDITOR_CANCEL_EXECUTION: "web_editor_cancel_execution",
    // Web editor props (Phase 7.1.6 early injection)
    WEB_EDITOR_PROPS_REGISTER_EARLY_INJECTION: "web_editor_props_register_early_injection",
    // Web editor props - open source file in VSCode
    WEB_EDITOR_OPEN_SOURCE: "web_editor_open_source",
    // Quick Panel <-> AgentChat integration
    QUICK_PANEL_SEND_TO_AI: "quick_panel_send_to_ai",
    QUICK_PANEL_CANCEL_AI: "quick_panel_cancel_ai",
    // Quick Panel Search - Tabs bridge
    QUICK_PANEL_TABS_QUERY: "quick_panel_tabs_query",
    QUICK_PANEL_TAB_ACTIVATE: "quick_panel_tab_activate",
    QUICK_PANEL_TAB_CLOSE: "quick_panel_tab_close"
  };
  const TOOL_MESSAGE_TYPES = {
    // Quick Panel AI streaming events (background -> content script)
    QUICK_PANEL_AI_EVENT: "quick_panel_ai_event"
  };
  const LOG_PREFIX$2 = "[QuickPanelAgentBridge]";
  const DEFAULT_MAX_BUFFERED_EVENTS = 200;
  const TERMINAL_CLEANUP_DELAY_MS = 3e4;
  class QuickPanelAgentBridge {
    constructor(options) {
      /** Listeners organized by requestId */
      __publicField(this, "listenersByRequestId", /* @__PURE__ */ new Map());
      /** Event buffer for handling race conditions where events arrive before listeners */
      __publicField(this, "bufferByRequestId", /* @__PURE__ */ new Map());
      /** Pending cleanup timers for delayed terminal cleanup */
      __publicField(this, "cleanupTimers", /* @__PURE__ */ new Map());
      /** Maximum events to buffer per request */
      __publicField(this, "maxBufferedEvents");
      /** Message handler bound to this instance */
      __publicField(this, "boundMessageHandler");
      /** Disposed state flag */
      __publicField(this, "disposed", false);
      var _a2;
      this.maxBufferedEvents = (_a2 = options == null ? void 0 : options.maxBufferedEvents) != null ? _a2 : DEFAULT_MAX_BUFFERED_EVENTS;
      this.boundMessageHandler = this.handleMessage.bind(this);
      chrome.runtime.onMessage.addListener(this.boundMessageHandler);
    }
    /**
     * Clean up all resources and unregister listeners.
     * Should be called when Quick Panel is closing.
     */
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      chrome.runtime.onMessage.removeListener(this.boundMessageHandler);
      this.listenersByRequestId.clear();
      this.bufferByRequestId.clear();
      for (const timer of this.cleanupTimers.values()) {
        clearTimeout(timer);
      }
      this.cleanupTimers.clear();
    }
    /**
     * Check if the bridge has been disposed.
     */
    isDisposed() {
      return this.disposed;
    }
    /**
     * Subscribe to RealtimeEvents for a specific requestId.
     *
     * @param requestId - The request ID to subscribe to
     * @param listener - Callback function for events
     * @returns Unsubscribe function
     *
     * @remarks
     * Events that arrived before subscription are flushed immediately.
     * This handles the race condition where background sends events
     * before the UI has finished setting up listeners.
     */
    onRequestEvent(requestId, listener) {
      if (this.disposed) {
        console.warn(`${LOG_PREFIX$2} Cannot subscribe - bridge is disposed`);
        return () => {
        };
      }
      const id = requestId.trim();
      if (!id) {
        console.warn(`${LOG_PREFIX$2} Invalid requestId`);
        return () => {
        };
      }
      let listeners = this.listenersByRequestId.get(id);
      if (!listeners) {
        listeners = /* @__PURE__ */ new Set();
        this.listenersByRequestId.set(id, listeners);
      }
      listeners.add(listener);
      const buffer = this.bufferByRequestId.get(id);
      if (buffer && buffer.length > 0) {
        for (const event of buffer) {
          this.safeInvokeListener(listener, event);
        }
        this.bufferByRequestId.delete(id);
      }
      return () => {
        const set = this.listenersByRequestId.get(id);
        if (!set) return;
        set.delete(listener);
        if (set.size === 0) {
          this.listenersByRequestId.delete(id);
        }
      };
    }
    /**
     * Send a new instruction to the selected AgentChat session.
     *
     * The background layer will:
     * 1. Read the selected session ID
     * 2. Open SSE subscription
     * 3. POST /act to start the request
     * 4. Stream events back via QUICK_PANEL_AI_EVENT
     *
     * @param payload - The instruction and optional context
     * @returns Promise resolving to success with requestId/sessionId, or failure with error
     */
    sendToAI(payload) {
      return __async(this, null, function* () {
        if (this.disposed) {
          return { success: false, error: "Bridge is disposed" };
        }
        try {
          const response = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_SEND_TO_AI,
            payload
          });
          return response;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: msg || "Failed to send message" };
        }
      });
    }
    /**
     * Cancel an active AI request.
     *
     * @param requestId - The request ID to cancel
     * @param sessionId - Optional session ID for fallback (useful if background state was lost)
     * @returns Promise resolving to success or failure
     *
     * @remarks
     * Prefer passing sessionId when available for resilience against
     * MV3 Service Worker restarts that may clear background state.
     */
    cancelRequest(requestId, sessionId) {
      return __async(this, null, function* () {
        if (this.disposed) {
          return { success: false, error: "Bridge is disposed" };
        }
        try {
          const response = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.QUICK_PANEL_CANCEL_AI,
            payload: { requestId, sessionId }
          });
          return response;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { success: false, error: msg || "Failed to cancel request" };
        }
      });
    }
    /**
     * Check if there are active listeners for a request.
     * Useful for determining if UI is still interested in events.
     */
    hasListeners(requestId) {
      const listeners = this.listenersByRequestId.get(requestId);
      return listeners !== void 0 && listeners.size > 0;
    }
    /**
     * Get the number of active requests being tracked.
     * Useful for debugging and monitoring.
     */
    getActiveRequestCount() {
      return this.listenersByRequestId.size + this.bufferByRequestId.size;
    }
    // ============================================================
    // Private Methods
    // ============================================================
    /**
     * Handle incoming messages from background.
     */
    handleMessage(message) {
      if (this.disposed) return;
      const msg = message;
      if (!msg || msg.action !== TOOL_MESSAGE_TYPES.QUICK_PANEL_AI_EVENT) {
        return;
      }
      const requestId = typeof msg.requestId === "string" ? msg.requestId : "";
      const event = msg.event;
      if (!requestId || !event) return;
      const listeners = this.listenersByRequestId.get(requestId);
      if (listeners && listeners.size > 0) {
        for (const listener of listeners) {
          this.safeInvokeListener(listener, event);
        }
      } else {
        this.bufferEvent(requestId, event);
      }
      if (this.isTerminalEvent(event, requestId)) {
        this.scheduleDelayedCleanup(requestId);
      }
    }
    /**
     * Safely invoke a listener, catching and logging any errors.
     */
    safeInvokeListener(listener, event) {
      try {
        listener(event);
      } catch (err) {
        console.warn(`${LOG_PREFIX$2} Listener error:`, err);
      }
    }
    /**
     * Buffer an event for a request that doesn't have listeners yet.
     */
    bufferEvent(requestId, event) {
      let buffer = this.bufferByRequestId.get(requestId);
      if (!buffer) {
        buffer = [];
        this.bufferByRequestId.set(requestId, buffer);
      }
      buffer.push(event);
      if (buffer.length > this.maxBufferedEvents) {
        buffer.splice(0, buffer.length - this.maxBufferedEvents);
      }
    }
    /**
     * Check if an event represents a terminal state for the request.
     *
     * Terminal events include:
     * - status events with terminal status (completed, error, cancelled)
     * - error events (type: 'error')
     */
    isTerminalEvent(event, requestId) {
      if (event.type === "error") {
        return true;
      }
      if (event.type === "status") {
        const data = event.data;
        if ((data == null ? void 0 : data.requestId) !== requestId) return false;
        const status = data.status;
        return status === "completed" || status === "error" || status === "cancelled";
      }
      return false;
    }
    /**
     * Clean up all state associated with a request.
     * Called after delay to allow late subscribers to receive terminal events.
     */
    cleanupRequest(requestId) {
      const existingTimer = this.cleanupTimers.get(requestId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.cleanupTimers.delete(requestId);
      }
      this.bufferByRequestId.delete(requestId);
      this.listenersByRequestId.delete(requestId);
    }
    /**
     * Schedule delayed cleanup for a request after terminal event.
     * This allows late subscribers to still receive the terminal event.
     */
    scheduleDelayedCleanup(requestId) {
      if (this.cleanupTimers.has(requestId)) return;
      const timer = setTimeout(() => {
        this.cleanupTimers.delete(requestId);
        this.cleanupRequest(requestId);
      }, TERMINAL_CLEANUP_DELAY_MS);
      this.cleanupTimers.set(requestId, timer);
    }
  }
  function createAgentBridge(options) {
    return new QuickPanelAgentBridge(options);
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
  const DEFAULT_HOST_ID = "__mcp_quick_panel_host__";
  const UI_CONTAINER_ID = "__mcp_quick_panel_ui__";
  const ROOT_ID = "__mcp_quick_panel_root__";
  const DEFAULT_Z_INDEX = 2147483647;
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
    const hostId = (_a2 = options.hostId) != null ? _a2 : DEFAULT_HOST_ID;
    const zIndex = (_b2 = options.zIndex) != null ? _b2 : DEFAULT_Z_INDEX;
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
  function createMarkdownRenderer(container) {
    let currentContent = "";
    const contentEl = document.createElement("div");
    contentEl.className = "qp-markdown-content";
    container.appendChild(contentEl);
    return {
      setContent(newContent, _streaming = false) {
        currentContent = newContent;
        contentEl.textContent = newContent;
      },
      getContent() {
        return currentContent;
      },
      dispose() {
        try {
          contentEl.remove();
        } catch (e) {
        }
      }
    };
  }
  const REQUEST_ID_DISPLAY_LENGTH = 10;
  function isNonEmptyString$1(value) {
    return typeof value === "string" && value.trim().length > 0;
  }
  function joinClasses(...parts) {
    return parts.filter(Boolean).join(" ");
  }
  function formatMessageTime(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      return "";
    }
  }
  function isStreamingMessage(message) {
    return message.isStreaming === true && message.isFinal !== true;
  }
  function getWrapperClassName(role) {
    return role === "user" ? "qp-msg qp-msg--user" : "qp-msg qp-msg--assistant";
  }
  function getBubbleClassName(role) {
    return joinClasses("qp-bubble", role === "user" && "qp-bubble--user");
  }
  function formatRequestIdForDisplay(requestId) {
    const full = requestId.trim();
    const short = full.length <= REQUEST_ID_DISPLAY_LENGTH ? full : full.slice(0, REQUEST_ID_DISPLAY_LENGTH);
    return { short, full };
  }
  function getMessageTypeLabel(message) {
    if (message.role === "tool") return "Tool";
    if (message.role === "system") return "System";
    if (message.messageType === "tool_use") return "Tool";
    if (message.messageType === "tool_result") return "Result";
    return null;
  }
  function createMetaLeftElement() {
    const container = document.createElement("div");
    Object.assign(container.style, {
      display: "inline-flex",
      alignItems: "center",
      gap: "6px",
      minWidth: "0"
    });
    const streamDot = document.createElement("span");
    streamDot.className = "qp-msg-stream-dot ac-pulse";
    streamDot.hidden = true;
    const time = document.createElement("span");
    container.append(streamDot, time);
    return { container, streamDot, time };
  }
  function createMetaRightElement() {
    const container = document.createElement("span");
    container.hidden = true;
    const requestId = document.createElement("code");
    container.append(requestId);
    return { container, requestId };
  }
  function createMessageEntry(messageId, message) {
    const wrapper = document.createElement("div");
    wrapper.className = getWrapperClassName(message.role);
    wrapper.dataset.messageId = messageId;
    wrapper.dataset.role = message.role;
    wrapper.dataset.messageType = message.messageType;
    const bubble = document.createElement("div");
    bubble.className = getBubbleClassName(message.role);
    const textEl = document.createElement("div");
    textEl.className = "qp-msg-text";
    const metaEl = document.createElement("div");
    metaEl.className = "qp-msg-meta";
    const metaLeft = createMetaLeftElement();
    const metaRight = createMetaRightElement();
    metaEl.append(metaLeft.container, metaRight.container);
    bubble.append(textEl, metaEl);
    wrapper.append(bubble);
    let markdownRenderer = null;
    if (message.role === "assistant") {
      markdownRenderer = createMarkdownRenderer(textEl);
    }
    return {
      wrapper,
      bubble,
      textEl,
      metaEl,
      metaLeftEl: metaLeft.container,
      streamDotEl: metaLeft.streamDot,
      timeEl: metaLeft.time,
      metaRightEl: metaRight.container,
      requestIdEl: metaRight.requestId,
      markdownRenderer
    };
  }
  function updateMessageEntry(entry, messageId, message) {
    var _a2;
    const wrapperClass = getWrapperClassName(message.role);
    if (entry.wrapper.className !== wrapperClass) {
      entry.wrapper.className = wrapperClass;
    }
    entry.wrapper.dataset.role = message.role;
    entry.wrapper.dataset.messageType = message.messageType;
    entry.wrapper.dataset.messageId = messageId;
    const bubbleClass = getBubbleClassName(message.role);
    if (entry.bubble.className !== bubbleClass) {
      entry.bubble.className = bubbleClass;
    }
    const textContent = (_a2 = message.content) != null ? _a2 : "";
    if (message.role === "assistant" && entry.markdownRenderer) {
      entry.markdownRenderer.setContent(textContent, isStreamingMessage(message));
    } else {
      if (entry.textEl.textContent !== textContent) {
        entry.textEl.textContent = textContent;
      }
    }
    const typeLabel = getMessageTypeLabel(message);
    const timeText = formatMessageTime(message.createdAt) || "—";
    entry.timeEl.textContent = typeLabel ? `${typeLabel} • ${timeText}` : timeText;
    entry.streamDotEl.hidden = !isStreamingMessage(message);
    const rawRequestId = isNonEmptyString$1(message.requestId) ? message.requestId.trim() : "";
    if (rawRequestId) {
      const formatted = formatRequestIdForDisplay(rawRequestId);
      entry.requestIdEl.textContent = formatted.short;
      entry.requestIdEl.title = formatted.full;
      entry.metaRightEl.hidden = false;
    } else {
      entry.requestIdEl.textContent = "";
      entry.requestIdEl.title = "";
      entry.metaRightEl.hidden = true;
    }
  }
  function createQuickPanelMessageRenderer(options) {
    var _a2;
    const container = options.container;
    const scrollContainer = (_a2 = options.scrollContainer) != null ? _a2 : null;
    const thresholdPx = options.autoScrollThresholdPx;
    const entries = /* @__PURE__ */ new Map();
    let disposed = false;
    function isNearBottom() {
      if (!scrollContainer) return true;
      const { scrollHeight, scrollTop, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      return distanceFromBottom <= thresholdPx;
    }
    function scrollToBottom() {
      if (!scrollContainer) return;
      try {
        scrollContainer.scrollTo({ top: scrollContainer.scrollHeight });
      } catch (e) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
    function upsert(message) {
      var _a3;
      if (disposed) return;
      const messageId = (_a3 = message.id) == null ? void 0 : _a3.trim();
      if (!messageId) return;
      const shouldAutoScroll = isNearBottom();
      let entry = entries.get(messageId);
      if (!entry) {
        entry = createMessageEntry(messageId, message);
        entries.set(messageId, entry);
        container.append(entry.wrapper);
      }
      updateMessageEntry(entry, messageId, message);
      if (shouldAutoScroll) {
        scrollToBottom();
      }
    }
    function remove(messageId) {
      var _a3;
      if (disposed) return;
      const id = messageId == null ? void 0 : messageId.trim();
      if (!id) return;
      const entry = entries.get(id);
      if (!entry) return;
      entries.delete(id);
      if (entry.markdownRenderer) {
        entry.markdownRenderer.dispose();
      }
      try {
        entry.wrapper.remove();
      } catch (e) {
        (_a3 = entry.wrapper.parentElement) == null ? void 0 : _a3.removeChild(entry.wrapper);
      }
    }
    function clear() {
      if (disposed) return;
      for (const entry of entries.values()) {
        if (entry.markdownRenderer) {
          entry.markdownRenderer.dispose();
        }
      }
      entries.clear();
      container.textContent = "";
    }
    function setMessages(messages) {
      var _a3;
      if (disposed) return;
      for (const entry of entries.values()) {
        if (entry.markdownRenderer) {
          entry.markdownRenderer.dispose();
        }
      }
      entries.clear();
      container.textContent = "";
      for (const msg of messages) {
        const id = (_a3 = msg.id) == null ? void 0 : _a3.trim();
        if (!id) continue;
        const entry = createMessageEntry(id, msg);
        entries.set(id, entry);
        updateMessageEntry(entry, id, msg);
        container.append(entry.wrapper);
      }
      scrollToBottom();
    }
    function getMessageCount() {
      return entries.size;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) {
        if (entry.markdownRenderer) {
          entry.markdownRenderer.dispose();
        }
      }
      entries.clear();
      container.textContent = "";
    }
    return {
      upsert,
      remove,
      clear,
      setMessages,
      getMessageCount,
      scrollToBottom,
      dispose
    };
  }
  const LOG_PREFIX$1 = "[QuickPanelAiChatPanel]";
  const DEFAULT_TITLE = "Agent";
  const DEFAULT_SUBTITLE = "Quick Panel";
  const DEFAULT_PLACEHOLDER = "Ask the agent...";
  const MAX_SELECTED_TEXT_CHARS = 3e3;
  const MAX_ERROR_DISPLAY_CHARS = 600;
  const TEXTAREA_MIN_HEIGHT_PX = 42;
  const TEXTAREA_MAX_HEIGHT_PX = 160;
  const BANNER_AUTO_HIDE_MS = 2400;
  const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
  const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>`;
  const ICON_STOP = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>`;
  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }
  function truncateText(text, maxChars) {
    const trimmed = text.trim();
    if (trimmed.length <= maxChars) return trimmed;
    return `${trimmed.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  function safeFocus(element) {
    try {
      element.focus();
    } catch (e) {
    }
  }
  function isTerminalStatus(status) {
    return status === "completed" || status === "error" || status === "cancelled";
  }
  function collectDefaultContext() {
    var _a2, _b2, _c, _d;
    const context = {
      pageUrl: (_a2 = globalThis.location) == null ? void 0 : _a2.href
    };
    try {
      const selection = (_b2 = globalThis.getSelection) == null ? void 0 : _b2.call(globalThis);
      const selectedText = (_d = (_c = selection == null ? void 0 : selection.toString()) == null ? void 0 : _c.trim()) != null ? _d : "";
      if (selectedText) {
        context.selectedText = truncateText(selectedText, MAX_SELECTED_TEXT_CHARS);
      }
    } catch (e) {
    }
    return context;
  }
  function buildLocalUserMessage(sessionId, requestId, instruction) {
    return {
      id: `local-user:${requestId}`,
      sessionId,
      role: "user",
      content: instruction,
      messageType: "chat",
      requestId,
      isStreaming: false,
      isFinal: true,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function formatUsageStats(usage) {
    if (!usage) return null;
    const parts = [];
    const inputTokens = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
    const outputTokens = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
    parts.push(`in ${inputTokens}`, `out ${outputTokens}`);
    if (Number.isFinite(usage.durationMs) && usage.durationMs > 0) {
      const seconds = Math.max(1, Math.round(usage.durationMs / 1e3));
      parts.push(`${seconds}s`);
    }
    if (Number.isFinite(usage.totalCostUsd) && usage.totalCostUsd > 0) {
      parts.push(`$${usage.totalCostUsd.toFixed(4)}`);
    }
    return parts.join(" • ");
  }
  function buildPanelDOM(options) {
    var _a2, _b2, _c;
    const title = ((_a2 = options.title) == null ? void 0 : _a2.trim()) || DEFAULT_TITLE;
    const subtitle = ((_b2 = options.subtitle) == null ? void 0 : _b2.trim()) || DEFAULT_SUBTITLE;
    const placeholder = ((_c = options.placeholder) == null ? void 0 : _c.trim()) || DEFAULT_PLACEHOLDER;
    const overlay = document.createElement("div");
    overlay.className = "qp-overlay";
    overlay.setAttribute("data-mcp-quick-panel-ai-chat", "true");
    const panel = document.createElement("div");
    panel.className = "qp-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    const header = document.createElement("div");
    header.className = "qp-header";
    const headerLeft = document.createElement("div");
    headerLeft.className = "qp-header-left";
    const brand = document.createElement("div");
    brand.className = "qp-brand";
    brand.textContent = "✦";
    const titleWrap = document.createElement("div");
    titleWrap.className = "qp-title";
    const titleNameEl = document.createElement("div");
    titleNameEl.className = "qp-title-name";
    titleNameEl.textContent = title;
    const titleSubEl = document.createElement("div");
    titleSubEl.className = "qp-title-sub";
    titleSubEl.textContent = subtitle;
    titleWrap.append(titleNameEl, titleSubEl);
    headerLeft.append(brand, titleWrap);
    const headerRight = document.createElement("div");
    headerRight.className = "qp-header-right";
    const streamIndicator = document.createElement("div");
    streamIndicator.className = "qp-stream-indicator";
    streamIndicator.hidden = true;
    const streamDot = document.createElement("span");
    streamDot.className = "qp-stream-dot ac-pulse";
    const streamText = document.createElement("span");
    streamText.textContent = "Streaming";
    streamIndicator.append(streamDot, streamText);
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "qp-icon-btn ac-focus-ring";
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.setAttribute("aria-label", "Close Quick Panel");
    headerRight.append(streamIndicator, closeBtn);
    header.append(headerLeft, headerRight);
    const contentEl = document.createElement("div");
    contentEl.className = "qp-content ac-scroll";
    const emptyEl = document.createElement("div");
    emptyEl.className = "qp-empty";
    const emptyIcon = document.createElement("div");
    emptyIcon.className = "qp-empty-icon";
    emptyIcon.textContent = "✦";
    const emptyText = document.createElement("div");
    emptyText.className = "qp-empty-text";
    emptyText.textContent = "Ask about this page. Streaming replies appear here.";
    emptyEl.append(emptyIcon, emptyText);
    const messagesEl = document.createElement("div");
    messagesEl.className = "qp-messages";
    contentEl.append(emptyEl, messagesEl);
    const composer = document.createElement("div");
    composer.className = "qp-composer";
    const banner = document.createElement("div");
    banner.className = "qp-status";
    banner.hidden = true;
    const textarea = document.createElement("textarea");
    textarea.className = "qp-textarea ac-focus-ring";
    textarea.placeholder = placeholder;
    textarea.rows = 1;
    const actions = document.createElement("div");
    actions.className = "qp-actions";
    const actionsLeft = document.createElement("div");
    actionsLeft.className = "qp-actions-left";
    const hints = [
      { key: "Enter", label: "Send" },
      { key: "Shift+Enter", label: "New line" },
      { key: "Esc", label: "Close" }
    ];
    for (const hint of hints) {
      const keyEl = document.createElement("span");
      keyEl.className = "qp-kbd";
      keyEl.textContent = hint.key;
      const labelEl = document.createElement("span");
      labelEl.textContent = hint.label;
      actionsLeft.append(keyEl, labelEl);
    }
    const actionsRight = document.createElement("div");
    actionsRight.className = "qp-actions-right";
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "qp-icon-btn qp-icon-btn--action qp-icon-btn--primary ac-focus-ring";
    actionBtn.innerHTML = ICON_SEND;
    actionBtn.setAttribute("aria-label", "Send message");
    actionBtn.dataset.action = "send";
    actionsRight.append(actionBtn);
    actions.append(actionsLeft, actionsRight);
    composer.append(banner, textarea, actions);
    panel.append(header, contentEl, composer);
    overlay.append(panel);
    return {
      overlay,
      panel,
      titleSubEl,
      streamIndicator,
      streamText,
      closeBtn,
      contentEl,
      emptyEl,
      messagesEl,
      banner,
      textarea,
      actionBtn
    };
  }
  function mountQuickPanelAiChatPanel(options) {
    var _a2, _b2;
    const disposer = new Disposer();
    const mount = options.mount;
    const agentBridge = options.agentBridge;
    const defaultSubtitle = ((_a2 = options.subtitle) == null ? void 0 : _a2.trim()) || DEFAULT_SUBTITLE;
    try {
      const existing = (_b2 = mount.querySelector) == null ? void 0 : _b2.call(mount, '[data-mcp-quick-panel-ai-chat="true"]');
      if (existing instanceof HTMLElement) {
        existing.remove();
      }
    } catch (e) {
    }
    let disposed = false;
    let requestUnsubscribe = null;
    let bannerTimer = null;
    let state = {
      sending: false,
      streaming: false,
      cancelling: false,
      currentRequestId: null,
      sessionId: null,
      lastStatus: null,
      lastUsage: null,
      errorMessage: null
    };
    const dom = buildPanelDOM(options);
    mount.append(dom.overlay);
    disposer.add(() => dom.overlay.remove());
    const renderer = createQuickPanelMessageRenderer({
      container: dom.messagesEl,
      scrollContainer: dom.contentEl,
      autoScrollThresholdPx: 96
    });
    disposer.add(() => renderer.dispose());
    function clearBannerTimer() {
      if (bannerTimer) {
        clearTimeout(bannerTimer);
        bannerTimer = null;
      }
    }
    function hideBanner() {
      clearBannerTimer();
      dom.banner.hidden = true;
      dom.banner.className = "qp-status";
      dom.banner.textContent = "";
    }
    function showBanner(tone, message, autoHideMs) {
      clearBannerTimer();
      dom.banner.hidden = false;
      dom.banner.className = "qp-status";
      if (tone === "error") dom.banner.classList.add("qp-status--error");
      if (tone === "success") dom.banner.classList.add("qp-status--success");
      if (tone === "warning") dom.banner.classList.add("qp-status--warning");
      dom.banner.textContent = message;
      if (autoHideMs && autoHideMs > 0) {
        bannerTimer = setTimeout(hideBanner, autoHideMs);
      }
    }
    function resizeTextarea() {
      try {
        dom.textarea.style.height = "auto";
        const targetHeight = Math.min(
          TEXTAREA_MAX_HEIGHT_PX,
          Math.max(TEXTAREA_MIN_HEIGHT_PX, dom.textarea.scrollHeight)
        );
        dom.textarea.style.height = `${targetHeight}px`;
      } catch (e) {
      }
    }
    function renderEmptyState() {
      const hasMessages = renderer.getMessageCount() > 0;
      dom.emptyEl.hidden = hasMessages;
      dom.messagesEl.hidden = !hasMessages;
    }
    function renderHeaderSubtitle() {
      if (state.errorMessage) {
        dom.titleSubEl.textContent = "Error";
        return;
      }
      if (state.streaming) {
        dom.titleSubEl.textContent = "Streaming…";
        return;
      }
      if (state.sending) {
        dom.titleSubEl.textContent = "Sending…";
        return;
      }
      const usageText = formatUsageStats(state.lastUsage);
      dom.titleSubEl.textContent = usageText ? `Last: ${usageText}` : defaultSubtitle;
    }
    function renderControls() {
      const inputText = dom.textarea.value.trim();
      const isLoading = state.sending || state.streaming || state.cancelling;
      const canSend = inputText.length > 0 && !isLoading;
      const canCancel = state.currentRequestId !== null && !state.cancelling;
      if (isLoading) {
        dom.actionBtn.innerHTML = ICON_STOP;
        dom.actionBtn.setAttribute("aria-label", "Stop request");
        dom.actionBtn.dataset.action = "stop";
        dom.actionBtn.disabled = !canCancel;
        dom.actionBtn.classList.remove("qp-icon-btn--primary");
        dom.actionBtn.classList.add("qp-icon-btn--danger");
      } else {
        dom.actionBtn.innerHTML = ICON_SEND;
        dom.actionBtn.setAttribute("aria-label", "Send message");
        dom.actionBtn.dataset.action = "send";
        dom.actionBtn.disabled = !canSend;
        dom.actionBtn.classList.remove("qp-icon-btn--danger");
        dom.actionBtn.classList.add("qp-icon-btn--primary");
      }
      dom.streamIndicator.hidden = !isLoading;
      if (state.cancelling) {
        dom.streamText.textContent = "Cancelling";
      } else if (state.sending) {
        dom.streamText.textContent = "Sending";
      } else {
        dom.streamText.textContent = "Streaming";
      }
      dom.textarea.disabled = state.sending || state.cancelling;
      renderHeaderSubtitle();
      renderEmptyState();
    }
    function setState(patch) {
      state = __spreadValues(__spreadValues({}, state), patch);
      renderControls();
    }
    function cleanupActiveSubscription() {
      if (requestUnsubscribe) {
        try {
          requestUnsubscribe();
        } catch (e) {
        }
        requestUnsubscribe = null;
      }
    }
    function resolveContext() {
      return __async(this, null, function* () {
        try {
          if (options.getContext) {
            const provided = yield options.getContext();
            if (provided && typeof provided === "object") {
              return provided;
            }
          }
        } catch (err) {
          console.warn(`${LOG_PREFIX$1} getContext failed:`, err);
        }
        const fallback = collectDefaultContext();
        if (!isNonEmptyString(fallback.pageUrl) && !isNonEmptyString(fallback.selectedText)) {
          return void 0;
        }
        return fallback;
      });
    }
    function sendCurrentInput() {
      return __async(this, null, function* () {
        if (disposed) return;
        if (state.sending || state.streaming || state.cancelling) return;
        const instruction = dom.textarea.value.trim();
        if (!instruction) return;
        setState({ errorMessage: null, lastUsage: null, lastStatus: null });
        hideBanner();
        const savedInput = dom.textarea.value;
        dom.textarea.value = "";
        resizeTextarea();
        setState({ sending: true });
        const context = yield resolveContext();
        if (disposed) return;
        const payload = {
          instruction,
          context: context != null ? context : void 0
        };
        const result2 = yield agentBridge.sendToAI(payload);
        if (disposed) return;
        if (!result2.success) {
          dom.textarea.value = savedInput;
          resizeTextarea();
          const errorMsg = truncateText(result2.error, MAX_ERROR_DISPLAY_CHARS);
          setState({ sending: false, errorMessage: errorMsg });
          showBanner("error", errorMsg);
          return;
        }
        renderer.upsert(buildLocalUserMessage(result2.sessionId, result2.requestId, instruction));
        renderer.scrollToBottom();
        setState({
          sending: false,
          streaming: true,
          currentRequestId: result2.requestId,
          sessionId: result2.sessionId,
          lastStatus: "starting"
        });
        cleanupActiveSubscription();
        requestUnsubscribe = agentBridge.onRequestEvent(result2.requestId, (event) => {
          if (disposed) return;
          handleRequestEvent(event);
        });
      });
    }
    function cancelCurrentRequest() {
      return __async(this, null, function* () {
        if (disposed) return;
        if (!state.currentRequestId) return;
        if (state.cancelling) return;
        const requestId = state.currentRequestId;
        const sessionId = state.sessionId || void 0;
        setState({ cancelling: true });
        const result2 = yield agentBridge.cancelRequest(requestId, sessionId);
        if (disposed) return;
        if (!result2.success) {
          const errorMsg = truncateText(result2.error, MAX_ERROR_DISPLAY_CHARS);
          setState({ cancelling: false, errorMessage: errorMsg });
          showBanner("error", errorMsg);
          return;
        }
        setState({ cancelling: false });
      });
    }
    function handleTerminal(status, message) {
      cleanupActiveSubscription();
      setState({
        streaming: false,
        sending: false,
        cancelling: false,
        currentRequestId: null,
        sessionId: null,
        lastStatus: status
      });
      if (status === "completed") {
        const usageText = formatUsageStats(state.lastUsage);
        const bannerMsg = usageText ? `Completed • ${usageText}` : "Completed";
        showBanner("success", bannerMsg, BANNER_AUTO_HIDE_MS);
        return;
      }
      if (status === "cancelled") {
        showBanner("warning", "Cancelled", BANNER_AUTO_HIDE_MS);
        return;
      }
      if (status === "error") {
        const errorMsg = truncateText(
          message || state.errorMessage || "Request failed",
          MAX_ERROR_DISPLAY_CHARS
        );
        setState({ errorMessage: errorMsg });
        showBanner("error", errorMsg);
      }
    }
    function handleRequestEvent(event) {
      if (disposed) return;
      if (!event || typeof event !== "object" || !("type" in event)) {
        console.warn(`${LOG_PREFIX$1} Invalid event structure:`, event);
        return;
      }
      try {
        switch (event.type) {
          case "message": {
            const msg = event.data;
            if (!msg || typeof msg !== "object" || typeof msg.id !== "string") {
              console.warn(`${LOG_PREFIX$1} Invalid message data:`, msg);
              return;
            }
            if (msg.role === "user") {
              const localUserId = `local-user:${msg.requestId}`;
              renderer.remove(localUserId);
            }
            renderer.upsert(msg);
            if (msg.isStreaming === true && !msg.isFinal) {
              setState({ streaming: true });
            }
            return;
          }
          case "status": {
            const statusData = event.data;
            if (!statusData || typeof statusData !== "object" || typeof statusData.status !== "string") {
              console.warn(`${LOG_PREFIX$1} Invalid status data:`, statusData);
              return;
            }
            setState({ lastStatus: statusData.status });
            if (statusData.status === "starting" || statusData.status === "ready" || statusData.status === "running") {
              setState({ streaming: true });
              return;
            }
            if (isTerminalStatus(statusData.status)) {
              handleTerminal(statusData.status, statusData.message);
            }
            return;
          }
          case "usage": {
            setState({ lastUsage: event.data });
            return;
          }
          case "error": {
            const errorMsg = truncateText(event.error || "Unknown error", MAX_ERROR_DISPLAY_CHARS);
            setState({ errorMessage: errorMsg });
            showBanner("error", errorMsg);
            cleanupActiveSubscription();
            setState({
              streaming: false,
              sending: false,
              cancelling: false,
              currentRequestId: null,
              sessionId: null,
              lastStatus: "error"
            });
            return;
          }
          case "connected":
          case "heartbeat": {
            return;
          }
        }
      } catch (err) {
        console.warn(`${LOG_PREFIX$1} Error handling event:`, err, event);
      }
    }
    disposer.listen(dom.overlay, "click", (ev) => {
      if (disposed) return;
      if (ev.target === dom.overlay) {
        close();
      }
    });
    disposer.listen(dom.closeBtn, "click", () => close());
    disposer.listen(dom.actionBtn, "click", () => {
      if (disposed) return;
      const action = dom.actionBtn.dataset.action;
      if (action === "stop") {
        void cancelCurrentRequest();
      } else {
        void sendCurrentInput();
      }
    });
    disposer.listen(dom.textarea, "input", () => {
      if (disposed) return;
      resizeTextarea();
      renderControls();
    });
    disposer.listen(dom.textarea, "keydown", (ev) => {
      if (disposed) return;
      if (ev.key === "Escape" && !ev.isComposing) {
        ev.preventDefault();
        close();
        return;
      }
      if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
        ev.preventDefault();
        void sendCurrentInput();
      }
    });
    function focusInput() {
      if (disposed) return;
      safeFocus(dom.textarea);
    }
    function clearMessages() {
      if (disposed) return;
      renderer.clear();
      hideBanner();
      setState({ lastUsage: null, lastStatus: null, errorMessage: null });
    }
    function close() {
      var _a3;
      if (disposed) return;
      if (state.currentRequestId) {
        void cancelCurrentRequest();
      }
      try {
        (_a3 = options.onRequestClose) == null ? void 0 : _a3.call(options);
      } catch (err) {
        console.warn(`${LOG_PREFIX$1} onRequestClose failed:`, err);
      }
      dispose();
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      cleanupActiveSubscription();
      clearBannerTimer();
      disposer.dispose();
    }
    resizeTextarea();
    renderControls();
    if (options.autoFocus !== false) {
      focusInput();
    }
    return {
      getState: () => __spreadValues({}, state),
      focusInput,
      clearMessages,
      close,
      dispose
    };
  }
  const LOG_PREFIX = "[QuickPanelController]";
  function createQuickPanelController(options = {}) {
    let disposed = false;
    let agentBridge = null;
    let shadowHost = null;
    let chatPanel = null;
    function ensureBridge() {
      if (!agentBridge || agentBridge.isDisposed()) {
        agentBridge = createAgentBridge();
      }
      return agentBridge;
    }
    function disposeUI() {
      if (chatPanel) {
        try {
          chatPanel.dispose();
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error disposing chat panel:`, err);
        }
        chatPanel = null;
      }
      if (shadowHost) {
        try {
          shadowHost.dispose();
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error disposing shadow host:`, err);
        }
        shadowHost = null;
      }
    }
    function show() {
      if (disposed) {
        console.warn(`${LOG_PREFIX} Cannot show - controller is disposed`);
        return;
      }
      if (chatPanel && (shadowHost == null ? void 0 : shadowHost.getElements())) {
        chatPanel.focusInput();
        return;
      }
      disposeUI();
      shadowHost = mountQuickPanelShadowHost({
        hostId: options.hostId,
        zIndex: options.zIndex
      });
      const elements = shadowHost.getElements();
      if (!elements) {
        console.error(`${LOG_PREFIX} Failed to create shadow host elements`);
        disposeUI();
        return;
      }
      const bridge = ensureBridge();
      chatPanel = mountQuickPanelAiChatPanel({
        mount: elements.root,
        agentBridge: bridge,
        title: options.title,
        subtitle: options.subtitle,
        placeholder: options.placeholder,
        autoFocus: true,
        onRequestClose: () => hide()
      });
    }
    function hide() {
      if (disposed) return;
      disposeUI();
    }
    function toggle() {
      if (disposed) return;
      if (isVisible()) {
        hide();
      } else {
        show();
      }
    }
    function isVisible() {
      return chatPanel !== null && (shadowHost == null ? void 0 : shadowHost.getElements()) !== null;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      disposeUI();
      if (agentBridge) {
        try {
          agentBridge.dispose();
        } catch (err) {
          console.warn(`${LOG_PREFIX} Error disposing agent bridge:`, err);
        }
        agentBridge = null;
      }
    }
    return {
      show,
      hide,
      toggle,
      isVisible,
      dispose
    };
  }
  const definition = defineContentScript({
    matches: ["<all_urls>"],
    runAt: "document_idle",
    main() {
      console.log("[QuickPanelContentScript] Content script loaded on:", window.location.href);
      let controller = null;
      function ensureController() {
        if (!controller) {
          controller = createQuickPanelController({
            title: "Agent",
            subtitle: "Quick Panel",
            placeholder: "Ask about this page..."
          });
        }
        return controller;
      }
      function handleMessage(message, _sender, sendResponse) {
        var _a2;
        const msg = message;
        if ((msg == null ? void 0 : msg.action) === "toggle_quick_panel") {
          console.log("[QuickPanelContentScript] Received toggle_quick_panel message");
          try {
            const ctrl = ensureController();
            ctrl.toggle();
            const visible = ctrl.isVisible();
            console.log("[QuickPanelContentScript] Toggle completed, visible:", visible);
            sendResponse({ success: true, visible });
          } catch (err) {
            console.error("[QuickPanelContentScript] Toggle error:", err);
            sendResponse({ success: false, error: String(err) });
          }
          return true;
        }
        if ((msg == null ? void 0 : msg.action) === "show_quick_panel") {
          try {
            const ctrl = ensureController();
            ctrl.show();
            sendResponse({ success: true });
          } catch (err) {
            console.error("[QuickPanelContentScript] Show error:", err);
            sendResponse({ success: false, error: String(err) });
          }
          return true;
        }
        if ((msg == null ? void 0 : msg.action) === "hide_quick_panel") {
          try {
            if (controller) {
              controller.hide();
            }
            sendResponse({ success: true });
          } catch (err) {
            console.error("[QuickPanelContentScript] Hide error:", err);
            sendResponse({ success: false, error: String(err) });
          }
          return true;
        }
        if ((msg == null ? void 0 : msg.action) === "get_quick_panel_status") {
          sendResponse({
            success: true,
            visible: (_a2 = controller == null ? void 0 : controller.isVisible()) != null ? _a2 : false,
            initialized: controller !== null
          });
          return true;
        }
        return false;
      }
      chrome.runtime.onMessage.addListener(handleMessage);
      window.addEventListener("unload", () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
        if (controller) {
          controller.dispose();
          controller = null;
        }
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
    return `${(_a2 = browser == null ? void 0 : browser.runtime) == null ? void 0 : _a2.id}:${"quick-panel"}:${eventName}`;
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
      const ctx = new ContentScriptContext("quick-panel", options);
      return yield main(ctx);
    } catch (err) {
      logger.error(
        `The content script "${"quick-panel"}" crashed on startup!`,
        err
      );
      throw err;
    }
  }))();
  return result;
})();
quickPanel;