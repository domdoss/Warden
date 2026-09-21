var webEditorV2 = (function() {
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
  function defineUnlistedScript(arg) {
    if (arg == null || typeof arg === "function") return { main: arg };
    return arg;
  }
  const WEB_EDITOR_V2_VERSION = 2;
  const WEB_EDITOR_V2_LOG_PREFIX = "[WebEditorV2]";
  const WEB_EDITOR_V2_HOST_ID = "__mcp_web_editor_v2_host__";
  const WEB_EDITOR_V2_OVERLAY_ID = "__mcp_web_editor_v2_overlay__";
  const WEB_EDITOR_V2_UI_ID = "__mcp_web_editor_v2_ui__";
  const WEB_EDITOR_V2_Z_INDEX = 2147483647;
  const WEB_EDITOR_V2_COLORS = {
    /** Hover highlight color */
    hover: "#3b82f6",
    // blue-500
    /** Selected element color */
    selected: "#22c55e",
    // green-500
    /** Selection box border */
    selectionBorder: "#6366f1",
    // indigo-500
    /** Drag ghost color */
    dragGhost: "rgba(99, 102, 241, 0.3)",
    /** Insertion line color */
    insertionLine: "#f59e0b",
    // amber-500
    /** Alignment guide line color (snap guides) */
    guideLine: "#ec4899",
    // pink-500
    /** Distance label background (Phase 4.3) */
    distanceLabelBg: "rgba(15, 23, 42, 0.92)",
    // slate-900 @ 92%
    /** Distance label border (Phase 4.3) */
    distanceLabelBorder: "rgba(51, 65, 85, 0.5)",
    // slate-600 @ 50%
    /** Distance label text (Phase 4.3) */
    distanceLabelText: "rgba(255, 255, 255, 0.98)"
  };
  const WEB_EDITOR_V2_DRAG_THRESHOLD_PX = 5;
  const WEB_EDITOR_V2_DRAG_HYSTERESIS_PX = 6;
  const WEB_EDITOR_V2_DRAG_MAX_HIT_ELEMENTS = 8;
  const WEB_EDITOR_V2_INSERTION_LINE_WIDTH = 3;
  const WEB_EDITOR_V2_SNAP_THRESHOLD_PX = 6;
  const WEB_EDITOR_V2_SNAP_HYSTERESIS_PX = 2;
  const WEB_EDITOR_V2_SNAP_MAX_ANCHOR_ELEMENTS = 30;
  const WEB_EDITOR_V2_SNAP_MAX_SIBLINGS_SCAN = 300;
  const WEB_EDITOR_V2_GUIDE_LINE_WIDTH = 1;
  const WEB_EDITOR_V2_DISTANCE_LABEL_MIN_PX = 1;
  const WEB_EDITOR_V2_DISTANCE_LINE_WIDTH = 1;
  const WEB_EDITOR_V2_DISTANCE_TICK_SIZE = 4;
  const WEB_EDITOR_V2_DISTANCE_LABEL_FONT = '600 11px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  const WEB_EDITOR_V2_DISTANCE_LABEL_PADDING_X = 6;
  const WEB_EDITOR_V2_DISTANCE_LABEL_PADDING_Y = 3;
  const WEB_EDITOR_V2_DISTANCE_LABEL_RADIUS = 4;
  const WEB_EDITOR_V2_DISTANCE_LABEL_OFFSET = 8;
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
  const SHADOW_HOST_STYLES = (
    /* css */
    `
  :host {
    all: initial;

    /* Design tokens aligned with attr-ui.html design spec */
    /* Surface colors */
    --we-surface-bg: #ffffff;
    --we-surface-secondary: #fafafa;

    /* Control colors - input containers use gray bg */
    --we-control-bg: #f3f3f3;
    --we-control-bg-hover: #e8e8e8;
    --we-control-border-hover: #e0e0e0;
    --we-control-bg-focus: #ffffff;
    --we-control-border-focus: #3b82f6;

    /* Border colors */
    --we-border-subtle: #e5e5e5;
    --we-border-strong: #d4d4d4;
    --we-border-section: #f3f3f3;

    /* Text colors */
    --we-text-primary: #333333;
    --we-text-secondary: #737373;
    --we-text-muted: #a3a3a3;

    /* Accent surfaces (used by CSS/Props panels) */
    --we-accent-info-bg: rgba(59, 130, 246, 0.08);
    --we-accent-brand-bg: rgba(99, 102, 241, 0.12);
    --we-accent-brand-border: rgba(99, 102, 241, 0.25);
    --we-accent-warning-bg: rgba(251, 191, 36, 0.14);
    --we-accent-warning-border: rgba(251, 191, 36, 0.25);
    --we-accent-danger-bg: rgba(248, 113, 113, 0.12);
    --we-accent-danger-border: rgba(248, 113, 113, 0.25);

    /* Shadows - Tailwind-like shadow-xl */
    --we-shadow-subtle: 0 1px 2px rgba(0, 0, 0, 0.05);
    --we-shadow-panel: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
    --we-shadow-tab: 0 1px 2px rgba(0, 0, 0, 0.05);

    /* Radii */
    --we-radius-panel: 8px;
    --we-radius-control: 6px;
    --we-radius-tab: 4px;

    /* Sizes */
    --we-icon-btn-size: 24px;

    /* Focus ring - blue inset border style */
    --we-focus-ring: #3b82f6;

    /* Motion - bounce easing for toolbar animations */
    --we-ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* Overlay container - for Canvas and visual feedback */
  #${WEB_EDITOR_V2_OVERLAY_ID} {
    position: fixed;
    inset: 0;
    pointer-events: none;
    contain: layout style;
  }

  /* ==========================================================================
   * Resize Handles (Phase 4.9)
   * ========================================================================== */

  /* Handles layer - covers viewport, pass-through by default */
  .we-handles-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    contain: layout style paint;
  }

  /* Selection frame - positioned by selection rect */
  .we-selection-frame {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    transform: translate3d(0, 0, 0);
    pointer-events: none;
    will-change: transform, width, height;
  }

  /* Individual resize handle */
  .we-resize-handle {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid ${WEB_EDITOR_V2_COLORS.selectionBorder};
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    pointer-events: auto;
    touch-action: none;
    user-select: none;
    transition: background-color 0.1s ease, border-color 0.1s ease, transform 0.1s ease;
  }

  .we-resize-handle:hover {
    background: ${WEB_EDITOR_V2_COLORS.selectionBorder};
    border-color: ${WEB_EDITOR_V2_COLORS.selectionBorder};
    transform: translate(-50%, -50%) scale(1.15);
  }

  .we-resize-handle:active {
    transform: translate(-50%, -50%) scale(1.0);
  }

  /* Handle positions - all use translate(-50%, -50%) as base */
  .we-resize-handle[data-dir="n"]  { left: 50%; top: 0; transform: translate(-50%, -50%); cursor: ns-resize; }
  .we-resize-handle[data-dir="s"]  { left: 50%; top: 100%; transform: translate(-50%, -50%); cursor: ns-resize; }
  .we-resize-handle[data-dir="e"]  { left: 100%; top: 50%; transform: translate(-50%, -50%); cursor: ew-resize; }
  .we-resize-handle[data-dir="w"]  { left: 0; top: 50%; transform: translate(-50%, -50%); cursor: ew-resize; }
  .we-resize-handle[data-dir="nw"] { left: 0; top: 0; transform: translate(-50%, -50%); cursor: nwse-resize; }
  .we-resize-handle[data-dir="ne"] { left: 100%; top: 0; transform: translate(-50%, -50%); cursor: nesw-resize; }
  .we-resize-handle[data-dir="sw"] { left: 0; top: 100%; transform: translate(-50%, -50%); cursor: nesw-resize; }
  .we-resize-handle[data-dir="se"] { left: 100%; top: 100%; transform: translate(-50%, -50%); cursor: nwse-resize; }

  /* Size HUD - shows W×H while resizing */
  .we-size-hud {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translate(-50%, calc(-100% - 8px));
    padding: 3px 8px;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.2;
    color: rgba(255, 255, 255, 0.98);
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid rgba(51, 65, 85, 0.5);
    border-radius: 4px;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }

  /* ==========================================================================
   * Performance HUD (Phase 5.3)
   * ========================================================================== */

  .we-perf-hud {
    position: fixed;
    left: 12px;
    bottom: 12px;
    padding: 8px 10px;
    border-radius: 10px;
    background: rgba(15, 23, 42, 0.78);
    border: 1px solid rgba(51, 65, 85, 0.45);
    color: rgba(255, 255, 255, 0.96);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 12px;
    line-height: 1.25;
    pointer-events: none;
    user-select: none;
    white-space: nowrap;
    z-index: 10;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    font-variant-numeric: tabular-nums;
  }

  .we-perf-hud-line + .we-perf-hud-line {
    margin-top: 4px;
  }

  /* UI container - for panels and controls */
  /* Position below toolbar: 16px (toolbar top) + 40px (toolbar height) + 8px (gap) = 64px */
  #${WEB_EDITOR_V2_UI_ID} {
    position: fixed;
    top: 64px;
    right: 16px;
    pointer-events: auto;
    /* Inter font with system fallbacks (aligned with design spec) */
    font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 11px;
    line-height: 1.4;
    color: var(--we-text-primary);
    -webkit-font-smoothing: antialiased;
  }

  /* Panel styles */
  /* max-height: 100vh - 64px (top offset) - 16px (bottom margin) = 100vh - 80px */
  .we-panel {
    width: 280px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 80px);
    background: var(--we-surface-bg);
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-panel);
    box-shadow: var(--we-shadow-panel);
    overflow: hidden;
    contain: layout style paint;
  }

  .we-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    background: var(--we-surface-bg);
    border-bottom: 1px solid var(--we-border-subtle);
    user-select: none;
  }

  .we-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--we-text-primary);
  }

  .we-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border-radius: 4px;
  }

  .we-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    color: #475569;
    background: white;
    border: 1px solid rgba(148, 163, 184, 0.5);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .we-btn:hover {
    background: #f8fafc;
    border-color: rgba(148, 163, 184, 0.7);
  }

  .we-btn:active {
    background: #f1f5f9;
  }

  .we-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .we-btn--primary {
    background: linear-gradient(135deg, #0f172a, #1e293b);
    color: #ffffff;
    border-color: rgba(15, 23, 42, 0.5);
  }

  .we-btn--primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #1e293b, #334155);
    border-color: rgba(15, 23, 42, 0.65);
  }

  .we-btn--danger {
    color: #b91c1c;
    border-color: rgba(248, 113, 113, 0.45);
  }

  .we-btn--danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.6);
  }

  /* Icon button (28x28) - used for window controls (close/minimize, etc.) */
  .we-icon-btn {
    width: var(--we-icon-btn-size);
    height: var(--we-icon-btn-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: var(--we-control-bg);
    border: 0;
    border-radius: var(--we-radius-control);
    color: var(--we-text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }

  .we-icon-btn:hover {
    background: var(--we-control-bg-hover);
    color: var(--we-text-primary);
  }

  .we-icon-btn:active {
    background: var(--we-control-bg-hover);
  }

  .we-icon-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-icon-btn svg {
    width: 16px;
    height: 16px;
    display: block;
  }

  /* Drag handle (grip) - used for repositioning floating UI */
  .we-drag-handle {
    width: var(--we-icon-btn-size);
    height: var(--we-icon-btn-size);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: var(--we-radius-control);
    color: var(--we-text-muted);
    cursor: grab;
    touch-action: none;
    user-select: none;
    transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
  }

  .we-drag-handle:hover {
    background: var(--we-control-bg);
    color: var(--we-text-secondary);
  }

  .we-drag-handle:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-drag-handle:active,
  .we-drag-handle[data-dragging="true"] {
    cursor: grabbing;
    background: var(--we-control-bg-hover);
    color: var(--we-text-primary);
  }

  .we-drag-handle svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  /* ==========================================================================
   * Toolbar (Redesigned per toolbar-ui.html design spec)
   * - Bounce easing animations
   * - Collapsible pill (580x40 <-> 40x40)
   * - Grip icon rotation on collapse
   * ========================================================================== */

  .we-toolbar {
    position: fixed;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    width: 580px;
    height: 40px;
    max-width: calc(100vw - 32px);
    display: flex;
    align-items: center;
    background: #ffffff;
    border-radius: 999px;
    box-shadow: 0 -4px 10px -6px rgba(15, 23, 42, 0.18),
      0 10px 15px -3px rgba(203, 213, 225, 0.5),
      0 4px 6px -4px rgba(203, 213, 225, 0.5);
    pointer-events: auto;
    user-select: none;
    font-family: 'Inter', system-ui, -apple-system, sans-serif;
    font-size: 11px;
    color: #475569;
    transition: width 500ms var(--we-ease-bounce), height 500ms var(--we-ease-bounce);
    overflow: visible;
    will-change: width, height;
  }

  .we-toolbar[data-position="bottom"] {
    top: auto;
    bottom: 16px;
  }

  /* Dragged toolbar: use left/top (inline styles) instead of docked centering */
  .we-toolbar[data-dragged="true"] {
    left: auto;
    right: auto;
    top: auto;
    bottom: auto;
    transform: none;
  }

  /* Collapsed toolbar - 40x40 circle */
  .we-toolbar[data-minimized="true"] {
    width: 40px;
    height: 40px;
  }

  /* Toolbar content row (collapses with toolbar) */
  .we-toolbar-content {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: 10px;
    white-space: nowrap;
    padding-right: 8px;
    transition: opacity 350ms ease, transform 400ms var(--we-ease-bounce);
    will-change: opacity, transform;
  }

  .we-toolbar[data-minimized="true"] .we-toolbar-content {
    opacity: 0;
    transform: translateX(-16px) scale(0.95);
    pointer-events: none;
  }

  .we-toolbar[data-minimized="false"] .we-toolbar-content {
    opacity: 1;
    transform: translateX(0) scale(1);
    pointer-events: auto;
  }

  /* Grip toggle button (40x40, hover slate-50, active scale-90) */
  .we-toolbar .we-drag-handle {
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease;
  }

  .we-toolbar .we-drag-handle:hover {
    background: #f8fafc;
  }

  .we-toolbar .we-drag-handle:active {
    transform: scale(0.9);
  }

  /* Grip icon rotation (collapsed 90deg -> expanded 0deg) */
  .we-toolbar .we-drag-handle svg {
    width: 16px;
    height: 16px;
    color: #94a3b8;
    transition: transform 500ms var(--we-ease-bounce);
    transform: rotate(0deg);
  }

  .we-toolbar[data-minimized="true"] .we-drag-handle svg {
    transform: rotate(90deg);
  }

  /* Status indicator: green dot + "Editor" label */
  .we-toolbar-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: #f1f5f9;
    border-radius: 999px;
  }

  .we-toolbar-indicator-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #10b981;
  }

  .we-toolbar-indicator-label {
    font-size: 11px;
    font-weight: 700;
    color: #334155;
    letter-spacing: 0.04em;
  }

  /* Status-driven dot color + pulse */
  .we-toolbar[data-status="progress"] .we-toolbar-indicator-dot {
    background: #6366f1;
    animation: we-toolbar-dot-pulse 1.5s ease-in-out infinite;
  }

  .we-toolbar[data-status="success"] .we-toolbar-indicator-dot {
    background: #10b981;
  }

  .we-toolbar[data-status="error"] .we-toolbar-indicator-dot {
    background: #ef4444;
  }

  @keyframes we-toolbar-dot-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.55; }
  }

  /* Undo/Redo counts */
  .we-toolbar-history {
    display: flex;
    gap: 10px;
    font-size: 10px;
    font-weight: 500;
    color: #94a3b8;
    font-variant-numeric: tabular-nums;
  }

  .we-toolbar-history-value {
    color: #475569;
    font-weight: 700;
  }

  /* Divider */
  .we-toolbar-divider {
    width: 1px;
    height: 16px;
    background: #e2e8f0;
  }

  /* Structure group (Structure button + divider + Undo/Redo icons) */
  .we-toolbar-structure-group {
    display: inline-flex;
    align-items: center;
    background: #f1f5f9;
    border-radius: 999px;
    padding: 2px;
  }

  .we-toolbar-structure-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    color: #64748b;
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .we-toolbar-structure-btn:hover:not(:disabled) {
    color: #1e293b;
    background: #ffffff;
  }

  .we-toolbar-structure-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .we-toolbar-structure-btn svg {
    width: 10px;
    height: 10px;
    opacity: 0.5;
    display: block;
  }

  .we-toolbar-structure-separator {
    width: 1px;
    height: 12px;
    background: #e2e8f0;
  }

  .we-toolbar-group-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: #94a3b8;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .we-toolbar-group-icon-btn:hover:not(:disabled) {
    color: #334155;
    background: #ffffff;
  }

  .we-toolbar-group-icon-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .we-toolbar-group-icon-btn svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  /* End actions container: pushes apply + close to far right */
  .we-toolbar-end-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  /* Apply button (indigo-500) */
  .we-toolbar-apply-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 16px;
    font-size: 11px;
    font-weight: 700;
    color: #ffffff;
    background: #6366f1;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease, box-shadow 150ms ease;
    box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.25),
      0 2px 4px -2px rgba(99, 102, 241, 0.25);
  }

  .we-toolbar-apply-btn:hover:not(:disabled) {
    background: #4f46e5;
  }

  .we-toolbar-apply-btn:active:not(:disabled) {
    transform: scale(0.95);
  }

  .we-toolbar-apply-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    box-shadow: none;
  }

  /* Close button (red hover) */
  .we-toolbar-close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px;
    background: transparent;
    border: 0;
    border-radius: 999px;
    color: #94a3b8;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .we-toolbar-close-btn:hover:not(:disabled) {
    color: #ef4444;
    background: #fef2f2;
  }

  .we-toolbar-close-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .we-toolbar-close-btn svg {
    width: 14px;
    height: 14px;
    display: block;
  }

  /* Screen-reader-only utility */
  .we-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Respect reduced motion preference */
  @media (prefers-reduced-motion: reduce) {
    .we-toolbar,
    .we-toolbar-content,
    .we-toolbar .we-drag-handle,
    .we-toolbar .we-drag-handle svg,
    .we-toolbar-structure-btn,
    .we-toolbar-group-icon-btn,
    .we-toolbar-apply-btn,
    .we-toolbar-close-btn {
      transition: none;
    }
  }

  /* ==========================================================================
     Breadcrumbs (Phase 2.2) - Anchored to selection element
     ========================================================================== */
  .we-breadcrumbs {
    position: fixed;
    /* left/top set dynamically via JS based on selection rect */
    left: 16px;
    top: 72px;
    width: auto;
    max-width: min(600px, calc(100vw - 400px));
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 6px 12px;
    background: #5494D7;
    border: none;
    border-radius: 0;
    box-shadow: 0 2px 8px rgba(84, 148, 215, 0.3);
    pointer-events: auto;
    user-select: none;
    overflow-x: auto;
    white-space: nowrap;
    scrollbar-width: none;
    z-index: 5;
  }

  .we-breadcrumbs[data-hidden="true"] {
    display: none;
  }

  .we-breadcrumbs[data-position="bottom"] {
    top: auto;
    bottom: 72px;
  }

  .we-breadcrumbs::-webkit-scrollbar {
    display: none;
  }

  .we-crumb {
    display: inline-flex;
    align-items: center;
    max-width: 220px;
    padding: 2px 6px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.15s ease;
  }

  .we-crumb:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .we-crumb:active {
    background: rgba(255, 255, 255, 0.25);
  }

  .we-crumb:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
  }

  .we-crumb--current {
    background: rgba(255, 255, 255, 0.2);
  }

  .we-crumb-sep {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    flex: 0 0 auto;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
  }

  .we-crumb-sep--shadow {
    color: rgba(255, 255, 255, 0.9);
  }

  .we-body {
    padding: 14px;
    color: #475569;
    font-size: 12px;
  }

  .we-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 6px;
    color: #15803d;
    font-size: 12px;
  }

  .we-status-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* ==========================================================================
     Property Panel (Phase 3)
     ========================================================================== */

  .we-prop-panel {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 80px);
  }

  /* Dragged property panel: becomes a floating fixed panel positioned via left/top (inline styles) */
  .we-prop-panel[data-dragged="true"][data-minimized="false"] {
    position: fixed;
    left: auto;
    right: auto;
    top: auto;
    bottom: auto;
  }

  /* Minimized property panel - becomes a small icon button fixed at top-right */
  .we-prop-panel[data-minimized="true"] {
    position: fixed;
    top: 16px;
    right: 16px;
    width: auto;
    max-height: none;
    background: transparent;
    border: 0;
    box-shadow: none;
    overflow: visible;
    z-index: 10;
  }

  .we-prop-panel[data-minimized="true"] .we-header {
    padding: 0;
    background: transparent;
    border-bottom: 0;
  }

  /* Symmetric header layout: drag (left) | tabs (center) | minimize (right) */
  .we-prop-panel .we-header {
    padding: 8px;
    gap: 4px;
  }

  .we-prop-panel .we-header .we-prop-tabs {
    flex: 1;
    justify-content: center;
  }

  /* Minimize button chevron rotation */
  .we-minimize-btn svg {
    transition: transform 200ms ease;
  }

  .we-prop-panel[data-minimized="true"] .we-minimize-btn svg {
    transform: rotate(180deg);
  }

  /* Header tooltips: show below to avoid being clipped by panel overflow */
  .we-prop-panel .we-header [data-tooltip]::after {
    bottom: auto;
    top: calc(100% + 6px);
  }

  .we-prop-panel .we-header [data-tooltip]::before {
    bottom: auto;
    top: calc(100% + 2px);
    border-top-color: transparent;
    border-bottom-color: var(--we-text-primary);
  }

  /* Tab container with pill/segmented style (aligned with design spec) */
  .we-prop-tabs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    background: var(--we-control-bg);
    border-radius: var(--we-radius-tab);
  }

  .we-tab {
    border: 0;
    background: transparent;
    color: var(--we-text-secondary);
    padding: 4px 10px;
    border-radius: var(--we-radius-tab);
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.1s ease;
  }

  .we-tab:hover {
    color: var(--we-text-primary);
  }

  .we-tab:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--we-focus-ring);
  }

  /* Active tab: white background with subtle shadow */
  .we-tab[aria-selected="true"] {
    background: var(--we-surface-bg);
    color: var(--we-text-primary);
    box-shadow: var(--we-shadow-tab);
  }

  .we-prop-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 12px;
    padding-bottom: 80px; /* Extra space for scrolling (design spec: pb-20) */
    display: flex;
    flex-direction: column;
    gap: 12px;
    scrollbar-width: none; /* Firefox */
    -ms-overflow-style: none; /* IE 10+ */
  }

  /* Hide scrollbar for webkit browsers */
  .we-prop-body::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  /* Force hidden state for property panel sections during minimization */
  .we-prop-body[hidden],
  .we-prop-tabs[hidden] {
    display: none;
  }

  .we-prop-tab-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .we-prop-tab-content[hidden] {
    display: none;
  }

  .we-prop-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 12px;
    color: #64748b;
    font-size: 12px;
    text-align: center;
  }

  .we-prop-empty[hidden] {
    display: none;
  }

  .we-prop-panel[data-empty="true"] .we-prop-tab-content {
    display: none;
  }

  /* ==========================================================================
     Components Tree (Phase 3.2)
     ========================================================================== */

  .we-tree {
    font-size: 12px;
    line-height: 1.4;
  }

  .we-tree-empty {
    padding: 24px 12px;
    color: #64748b;
    text-align: center;
  }

  .we-tree-empty[hidden] {
    display: none;
  }

  .we-tree-list {
    display: flex;
    flex-direction: column;
  }

  .we-tree-list[hidden] {
    display: none;
  }

  .we-tree-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 8px;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.12s;
    color: #475569;
  }

  .we-tree-item:hover {
    background: rgba(59, 130, 246, 0.08);
  }

  .we-tree-item--selected {
    background: rgba(59, 130, 246, 0.12);
    color: #1d4ed8;
    font-weight: 500;
  }

  .we-tree-item--selected:hover {
    background: rgba(59, 130, 246, 0.16);
  }

  .we-tree-item--ancestor {
    color: #64748b;
  }

  .we-tree-item--child {
    color: #64748b;
    font-size: 11px;
  }

  .we-tree-indent {
    color: #94a3b8;
    font-family: monospace;
    user-select: none;
  }

  .we-tree-icon {
    flex-shrink: 0;
    color: #94a3b8;
    font-size: 10px;
  }

  .we-tree-item--selected .we-tree-icon {
    color: #3b82f6;
  }

  .we-tree-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  /* ==========================================================================
     Control Groups (Section style - aligned with design spec)
     Uses separator lines instead of card borders
     ========================================================================== */

  .we-group {
    /* No card-style border, use separator lines between sections */
    border: 0;
    border-radius: 0;
    overflow: visible;
    background: transparent;
  }

  /* Section separator - top border for non-first groups */
  .we-group + .we-group {
    border-top: 1px solid var(--we-border-section);
    padding-top: 12px;
    margin-top: 4px;
  }

  .we-group-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 0 8px 0;
    background: transparent;
  }

  .we-group-toggle {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0;
    background: transparent;
    border: 0;
    cursor: pointer;
    color: #333333;
    font-size: 11px;
    font-weight: 600;
    text-align: left;
    transition: color 0.1s ease;
  }

  .we-group-toggle:hover {
    color: var(--we-text-primary);
  }

  .we-group-toggle:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--we-focus-ring);
    border-radius: 2px;
  }

  .we-group-toggle--static {
    cursor: default;
    pointer-events: none;
  }

  .we-group-header-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 0 0 auto;
  }

  .we-group-body {
    padding: 0;
    background: transparent;
    border-top: 0;
  }

  .we-group[data-collapsed="true"] .we-group-body {
    display: none;
  }

  .we-chevron {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
    color: var(--we-text-muted);
    transition: transform 0.1s ease;
  }

  .we-group[data-collapsed="true"] .we-chevron {
    transform: rotate(-90deg);
  }

  /* ==========================================================================
     Form Controls (for Design controls)
     ========================================================================== */

  /* Field row: vertical stack (label on top, control below) */
  .we-field {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }

  /* Horizontal field variant (label left, control right) */
  .we-field--horizontal {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .we-field-label {
    flex: 0 0 auto;
    width: auto;
    font-size: 10px;
    font-weight: 500;
    color: var(--we-text-secondary);
  }

  /* Fixed width label for horizontal layout */
  .we-field--horizontal .we-field-label {
    width: 48px;
  }

  .we-field-label--short {
    width: 20px;
  }

  /* Hint text (small label above icon groups for H/V distinction) */
  .we-field-hint {
    font-size: 9px;
    color: var(--we-text-muted);
    text-align: center;
    line-height: 1;
  }

  /* Content container for complex controls (icon groups, grids, etc.) */
  .we-field-content {
    width: 100%;
    min-width: 0;
  }

  /* Input styling aligned with design spec:
   * - Gray background by default
   * - Inset border on hover
   * - White background + blue inset border on focus
   */
  .we-input {
    flex: 1 1 auto;
    flex-shrink: 0; /* Prevent height shrinking in column flex containers */
    min-width: 0;
    height: 28px; /* Design spec: h-[28px] */
    padding: 0 8px;
    font-size: 11px;
    line-height: 26px; /* Ensure vertical centering: 28px - 2px border */
    font-family: inherit;
    color: var(--we-text-primary);
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    outline: none;
    transition: background 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
  }

  .we-input::placeholder {
    color: var(--we-text-muted);
  }

  .we-input:hover:not(:focus) {
    border-color: var(--we-control-border-hover);
  }

  .we-input:focus {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  /* ==========================================================================
   * Input Container (Phase 2.1)
   *
   * A wrapper for inputs with prefix/suffix support.
   * Container handles hover/focus-within styling instead of input itself.
   * ========================================================================== */
  .we-input-container {
    min-width: 0;
    display: flex;
    align-items: center;
    height: 28px; /* Design spec: h-[28px] - must be explicit, not flex-controlled */
    flex-shrink: 0; /* Prevent height shrinking in column flex containers */
    padding: 0 8px;
    gap: 4px;
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    transition: background 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
  }

  /* In row flex containers, allow input-container to grow horizontally */
  .we-field-row > .we-input-container,
  .we-radius-control .we-field-row > .we-input-container {
    flex: 1 1 0;
  }

  .we-input-container:hover:not(:focus-within) {
    border-color: var(--we-control-border-hover);
  }

  .we-input-container:focus-within {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  .we-input-container__input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    font-size: 11px;
    line-height: 26px; /* Ensure vertical centering within 28px container */
    font-family: inherit;
    color: var(--we-text-primary);
    background: transparent;
    border: none;
    outline: none;
  }

  .we-input-container__input::placeholder {
    color: var(--we-text-muted);
  }

  /* Number inputs: right-aligned text in containers */
  .we-input-container__input[inputmode="decimal"],
  .we-input-container__input[inputmode="numeric"] {
    text-align: right;
  }

  /* Prefix and suffix elements */
  .we-input-container__prefix,
  .we-input-container__suffix {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--we-text-muted);
    user-select: none;
    pointer-events: none;
  }

  .we-input-container__prefix {
    margin-right: 2px;
  }

  .we-input-container__suffix {
    margin-left: 2px;
  }

  /* Icon in prefix/suffix */
  .we-input-container__prefix svg,
  .we-input-container__suffix svg {
    width: 12px;
    height: 12px;
    display: block;
  }

  /* ==========================================================================
   * Slider Input (Opacity and other numeric ranges)
   * ========================================================================== */
  .we-slider-input {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
  }

  .we-slider-input__slider {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    margin: 0;
    padding: 0;
    background: transparent;
    -webkit-appearance: none;
    appearance: none;
    cursor: pointer;
  }

  .we-slider-input__slider:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .we-slider-input__slider::-webkit-slider-runnable-track {
    height: 4px;
    background: linear-gradient(
      to right,
      var(--we-control-border-focus) 0%,
      var(--we-control-border-focus) var(--progress, 0%),
      var(--we-control-bg) var(--progress, 0%),
      var(--we-control-bg) 100%
    );
    border: 1px solid var(--we-control-border-hover);
    border-radius: 999px;
  }

  .we-slider-input__slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -5px; /* (12px thumb - 4px track) / 2 + border */
    border-radius: 999px;
    background: var(--we-control-bg-focus);
    border: 1px solid var(--we-border-strong);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .we-slider-input__slider:focus-visible {
    outline: none;
  }

  .we-slider-input__slider:focus-visible::-webkit-slider-thumb {
    border-color: var(--we-control-border-focus);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .we-slider-input__slider::-moz-range-track {
    height: 4px;
    background: linear-gradient(
      to right,
      var(--we-control-border-focus) 0%,
      var(--we-control-border-focus) var(--progress, 0%),
      var(--we-control-bg) var(--progress, 0%),
      var(--we-control-bg) 100%
    );
    border: 1px solid var(--we-control-border-hover);
    border-radius: 999px;
  }

  .we-slider-input__slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--we-control-bg-focus);
    border: 1px solid var(--we-border-strong);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  }

  .we-slider-input__slider:focus-visible::-moz-range-thumb {
    border-color: var(--we-control-border-focus);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  .we-slider-input__number {
    flex: 0 0 auto;
  }

  /* ==========================================================================
   * Icon Button Group (Phase 4.1)
   *
   * A single-select grid of icon buttons (e.g. flex-direction control).
   * ========================================================================== */
  .we-icon-button-group {
    display: grid;
    gap: 4px;
  }

  .we-icon-button-group__btn {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 28px; /* Design spec: h-[28px] */
    padding: 4px;
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    cursor: pointer;
    transition: background-color 0.1s ease, border-color 0.1s ease;
  }

  .we-icon-button-group__btn:hover:not(:disabled) {
    background: var(--we-control-bg-hover);
  }

  .we-icon-button-group__btn:focus-visible {
    outline: none;
    border-color: var(--we-control-border-focus);
    box-shadow: inset 0 0 0 2px var(--we-control-border-focus); /* Design spec: 2px inset */
  }

  .we-icon-button-group__btn[data-selected="true"] {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  .we-icon-button-group__btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .we-icon-button-group__btn svg {
    width: 14px;
    height: 14px;
    color: var(--we-text-secondary);
  }

  .we-icon-button-group__btn[data-selected="true"] svg {
    color: var(--we-control-border-focus);
  }

  /* ==========================================================================
   * Toggle Button
   *
   * A pressable toggle button (e.g. flip X/Y controls).
   * ========================================================================== */
  .we-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 4px;
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    cursor: pointer;
    transition: background-color 0.1s ease, border-color 0.1s ease;
  }

  .we-toggle-btn:hover:not(:disabled) {
    background: var(--we-control-bg-hover);
  }

  .we-toggle-btn[aria-pressed="true"] {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  .we-toggle-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .we-toggle-btn svg {
    width: 14px;
    height: 14px;
    color: var(--we-text-secondary);
  }

  .we-toggle-btn[aria-pressed="true"] svg {
    color: var(--we-control-border-focus);
  }

  /* ==========================================================================
   * Alignment Grid (Phase 4.2)
   *
   * 3×3 single-select grid for justify-content + align-items.
   * ========================================================================== */
  .we-alignment-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    padding: 8px;
    min-height: 90px;
    background: #f9f9f9;
    border: 1px solid #f0f0f0;
    border-radius: var(--we-radius-control);
    place-items: center;
  }

  .we-alignment-grid__cell {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .we-alignment-grid__cell:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.05);
  }

  .we-alignment-grid__cell:focus-visible {
    outline: 2px solid var(--we-control-border-focus);
    outline-offset: 1px;
  }

  .we-alignment-grid__cell:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Inactive dot */
  .we-alignment-grid__dot {
    width: 2px;
    height: 2px;
    background: var(--we-text-muted);
    border-radius: 50%;
  }

  /* Active marker (3 bars showing alignment) */
  .we-alignment-grid__marker {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: space-between;
    width: 12px;
    height: 12px;
  }

  .we-alignment-grid__bar {
    height: 2px;
    background: var(--we-control-border-focus);
    border-radius: 1px;
  }

  .we-alignment-grid__bar--1 { width: 8px; }
  .we-alignment-grid__bar--2 { width: 12px; }
  .we-alignment-grid__bar--3 { width: 4px; }

  /* ==========================================================================
   * Grid + Gap Two Column Layout (Layout Control)
   * ========================================================================== */

  .we-grid-gap-row {
    display: flex;
    gap: 8px;
  }

  .we-grid-gap-col {
    flex: 1;
    min-width: 0;
  }

  /* Keep Grid label space for alignment; hide text only when both columns are visible (grid mode) */
  .we-grid-gap-col--grid:not([hidden]):has(+ .we-grid-gap-col--gap:not([hidden])) .we-field-label {
    visibility: hidden;
  }

  .we-grid-gap-col .we-field-content {
    width: 100%;
    overflow: visible;
  }

  /* Gap inputs vertical layout */
  .we-grid-gap-inputs {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ==========================================================================
   * Grid Dimensions Picker (Layout Control)
   * ========================================================================== */

  .we-grid-dimensions-preview {
    width: 100%;
    height: 64px; /* Match two rows of gap inputs: 28px + 8px gap + 28px */
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 12px;
    font-family: inherit;
    color: var(--we-text-primary);
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    cursor: pointer;
    transition: background-color 0.1s ease, border-color 0.1s ease;
  }

  .we-grid-dimensions-preview:hover:not(:disabled) {
    background: var(--we-control-bg-hover);
  }

  .we-grid-dimensions-preview:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .we-grid-dimensions-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    min-width: 220px;
    padding: 10px;
    background: var(--we-surface-bg);
    border: 1px solid var(--we-border-subtle);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
    z-index: 60;
  }

  .we-grid-dimensions-popover[hidden] {
    display: none;
  }

  .we-grid-dimensions-inputs {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .we-grid-dimensions-times {
    font-size: 12px;
    color: var(--we-text-muted);
    user-select: none;
  }

  .we-grid-dimensions-matrix {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 3px;
    padding: 6px;
    background: var(--we-surface-secondary);
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-control);
  }

  .we-grid-dimensions-cell {
    width: 100%;
    aspect-ratio: 1 / 1;
    background: transparent;
    border: 1px solid rgba(0, 0, 0, 0.10);
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
    transition: background-color 0.08s ease, border-color 0.08s ease;
  }

  .we-grid-dimensions-cell[data-active="true"] {
    border-color: rgba(59, 130, 246, 0.65);
    background: rgba(59, 130, 246, 0.10);
  }

  .we-grid-dimensions-cell[data-selected="true"] {
    border-color: rgba(59, 130, 246, 0.9);
    background: rgba(59, 130, 246, 0.16);
  }

  .we-grid-dimensions-tooltip {
    margin-top: 8px;
    text-align: center;
    font-size: 11px;
    color: var(--we-text-secondary);
  }

  .we-grid-dimensions-tooltip[hidden] {
    display: none;
  }

  .we-input--short {
    width: 56px;
    flex: 0 0 auto;
  }

  /* Number inputs: right-aligned text */
  .we-input[type="text"][inputmode="decimal"],
  .we-input[type="number"] {
    text-align: right;
  }

  .we-select {
    flex: 1 1 auto;
    flex-shrink: 0; /* Prevent height shrinking in column flex containers */
    min-width: 0;
    height: 28px; /* Design spec: h-[28px] */
    padding: 0 24px 0 8px;
    font-size: 11px;
    line-height: 26px; /* Ensure vertical centering: 28px - 2px border */
    font-family: inherit;
    color: var(--we-text-primary);
    background: var(--we-control-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23737373' d='M2.5 3.5l2.5 3 2.5-3'/%3E%3C/svg%3E") no-repeat right 8px center;
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    outline: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
    cursor: pointer;
    transition: background-color 0.1s ease, border-color 0.1s ease, box-shadow 0.1s ease;
  }

  .we-select:hover:not(:focus) {
    border-color: var(--we-control-border-hover);
  }

  .we-select:focus {
    background-color: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  /* Field row for multiple inputs side by side */
  .we-field-row {
    display: flex;
    align-items: stretch;
    gap: 8px;
  }

  /* Size field with mode select + input stacked vertically */
  .we-size-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .we-size-mode-select {
    width: 100%;
  }

  .we-field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* ==========================================================================
     Effects (Box Shadow List)
     ========================================================================== */

  .we-effects-toolbar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 6px;
  }

  .we-effects-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .we-effects-item-wrap {
    position: relative;
  }

  .we-effects-item {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    transition: background-color 0.1s ease, border-color 0.1s ease, opacity 0.1s ease;
  }

  .we-effects-item:hover {
    background: var(--we-control-bg-hover);
  }

  .we-effects-item[data-open="true"] {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  .we-effects-item[data-enabled="false"] {
    opacity: 0.55;
  }

  .we-effects-name {
    flex: 1;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    text-align: left;
    font-size: 11px;
    color: var(--we-text-primary);
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .we-effects-name:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--we-focus-ring);
    border-radius: 4px;
  }

  .we-effects-icon-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 0;
    border-radius: var(--we-radius-control);
    color: var(--we-text-secondary);
    cursor: pointer;
    padding: 0;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .we-effects-icon-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.06);
    color: var(--we-text-primary);
  }

  .we-effects-icon-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-effects-icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .we-effects-icon-btn svg {
    width: 14px;
    height: 14px;
  }

  .we-effects-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: 220px;
    max-width: 220px;
    padding: 10px;
    background: var(--we-surface-bg);
    border: 1px solid var(--we-border-subtle);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
    z-index: 60;
  }

  .we-effects-popover[hidden] {
    display: none;
  }

  .we-effects-popover-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* ==========================================================================
     Gradient Preview Bar (Phase 4B)
     ========================================================================== */

  .we-gradient-bar-row {
    width: 100%;
    padding: 4px 0 8px;
  }

  .we-gradient-bar {
    position: relative;
    width: 100%;
    height: 60px;
    border-radius: 14px;
    border: 1px solid var(--we-border-subtle);
    background-color: var(--we-control-bg);
    background-image: none; /* set inline by GradientControl */
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.08),
      inset 0 0 0 1px rgba(255, 255, 255, 0.5);
    overflow: hidden;
  }

  /* Gradient thumbs container */
  .we-gradient-bar-thumbs {
    position: absolute;
    inset: 0;
    pointer-events: none; /* thumbs enable pointer events individually */
  }

  /* Gradient thumb (color stop marker) */
  .we-gradient-thumb {
    pointer-events: auto;
    position: absolute;
    top: 50%;
    left: 0;
    transform: translate(-50%, -50%);
    z-index: 1;
    width: 32px;
    height: 32px;
    border-radius: 6px;
    border: 2px solid rgba(255, 255, 255, 0.98);
    background-color: transparent; /* set inline */
    cursor: pointer;
    padding: 0;
    box-sizing: border-box;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    touch-action: none;
    user-select: none;
    transition: box-shadow 0.15s ease, z-index 0s;
  }

  .we-gradient-thumb:hover {
    box-shadow:
      0 0 0 2px rgba(59, 130, 246, 0.25),
      0 1px 3px rgba(0, 0, 0, 0.2);
  }

  .we-gradient-thumb:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 3px rgba(59, 130, 246, 0.4),
      0 1px 3px rgba(0, 0, 0, 0.2);
  }

  /* Selected thumb state - raise above unselected thumbs */
  .we-gradient-thumb--active {
    z-index: 2;
    box-shadow:
      0 0 0 3px rgba(59, 130, 246, 0.4),
      0 1px 3px rgba(0, 0, 0, 0.2);
  }

  /* Dragging thumb - always on top when overlapping at same position */
  .we-gradient-thumb--dragging {
    z-index: 3;
  }

  /* Dragging state - cursor feedback on entire bar */
  .we-gradient-bar--dragging {
    cursor: grabbing;
  }

  .we-gradient-bar--dragging .we-gradient-thumb {
    cursor: grabbing;
  }

  /* ==========================================================================
     Gradient Stops List (Phase 4D)
     ========================================================================== */

  .we-gradient-stops-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0 4px;
  }

  .we-gradient-stops-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--we-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .we-gradient-stops-add,
  .we-gradient-stop-remove {
    font-size: 14px;
    font-weight: 500;
    line-height: 1;
  }

  .we-gradient-stops-add:disabled,
  .we-gradient-stop-remove:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .we-gradient-stops-list {
    border: 1px solid var(--we-border-subtle);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.6);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 180px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .we-gradient-stop-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.85);
    cursor: pointer;
    user-select: none;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .we-gradient-stop-row:hover {
    background: rgba(59, 130, 246, 0.06);
  }

  .we-gradient-stop-row:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
  }

  .we-gradient-stop-row--active {
    border-color: rgba(59, 130, 246, 0.6);
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2);
  }

  .we-gradient-stop-pos {
    flex: 0 0 auto;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--we-text-secondary);
    padding: 3px 6px;
    border-radius: 6px;
    background: var(--we-control-bg);
    cursor: pointer;
    transition: box-shadow 0.15s ease;
  }

  .we-gradient-stop-pos:hover {
    background: var(--we-control-bg-hover, var(--we-control-bg));
  }

  .we-gradient-stop-pos:focus-within {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
  }

  /* Static position display (visible when row is not selected) */
  .we-gradient-stop-pos-static {
    display: block;
    width: 100%;
    text-align: right;
  }

  /* Position editor slot (visible when row is selected) */
  .we-gradient-stop-pos-editor {
    display: none;
    width: 100%;
  }

  /* Show editor and hide static in active row */
  .we-gradient-stop-row--active .we-gradient-stop-pos-static {
    display: none;
  }

  .we-gradient-stop-row--active .we-gradient-stop-pos-editor {
    display: block;
  }

  /* Position input styling */
  .we-gradient-stop-pos-input {
    width: 100%;
    border: 0;
    padding: 0;
    margin: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: right;
    outline: none;
    cursor: text;
  }

  .we-gradient-stop-pos-input::placeholder {
    color: var(--we-text-muted);
  }

  .we-gradient-stop-color {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    background: var(--we-control-bg);
  }

  /* Static color display (visible when row is not selected) */
  .we-gradient-stop-color-static {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
  }

  .we-gradient-stop-color-static:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
    border-radius: 4px;
  }

  /* Color editor slot (visible when row is selected) */
  .we-gradient-stop-color-editor {
    flex: 1;
    min-width: 0;
    display: none;
  }

  /* When row is active: hide static, show editor */
  .we-gradient-stop-row--active .we-gradient-stop-color {
    padding: 0;
    background: transparent;
  }

  .we-gradient-stop-row--active .we-gradient-stop-color-static {
    display: none;
  }

  .we-gradient-stop-row--active .we-gradient-stop-color-editor {
    display: block;
  }

  .we-gradient-stop-swatch {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.12);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
    background: transparent;
  }

  .we-gradient-stop-color-text {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--we-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Spacing section (Padding / Margin) */
  .we-spacing-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .we-spacing-section + .we-spacing-section {
    margin-top: 10px;
  }

  .we-spacing-header {
    font-size: 10px;
    font-weight: 600;
    color: #6b7280;
  }

  /* Spacing 2x2 grid layout */
  .we-spacing-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  /* ==========================================================================
   * Border Radius Control
   * ========================================================================== */

  .we-radius-control {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .we-radius-corners-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }

  /* ==========================================================================
     CSS Panel (Phase 4.6)
     ========================================================================== */

  .we-css-panel {
    font-size: 11px;
    line-height: 1.5;
  }

  /* Code-semantic elements use monospace font */
  .we-css-rule-selector,
  .we-css-decl-name,
  .we-css-decl-value,
  .we-css-decl-colon,
  .we-css-decl-semi,
  .we-css-decl-important,
  .we-css-rule-source,
  .we-css-rule-spec {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  /* ==========================================================================
     Class Editor (Phase 4.7)
     ========================================================================== */

  .we-css-class-editor-mount {
    margin-bottom: 12px;
  }

  .we-class-editor {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 8px 10px;
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-panel);
    background: var(--we-surface-bg);
    font-family: system-ui, -apple-system, sans-serif;
  }

  .we-class-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    flex: 0 1 auto;
  }

  .we-class-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--we-accent-brand-bg);
    border: 1px solid var(--we-accent-brand-border);
    color: #4338ca;
    font-size: 11px;
    line-height: 1.2;
  }

  .we-class-chip-text {
    word-break: break-all;
  }

  .we-class-chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: rgba(67, 56, 202, 0.8);
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    transition: background-color 0.15s ease;
  }

  .we-class-chip-remove:hover {
    background: rgba(99, 102, 241, 0.15);
    color: #4338ca;
  }

  .we-class-input {
    flex: 1 1 100px;
    min-width: 80px;
    padding: 5px 8px;
    font-size: 12px;
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-control);
    background: var(--we-control-bg-focus);
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .we-class-input:focus {
    border-color: var(--we-control-border-focus);
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-class-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .we-class-input::placeholder {
    color: #94a3b8;
  }

  .we-class-suggestions {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--we-surface-bg);
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-panel);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
    overflow: hidden;
    z-index: 20;
  }

  .we-class-suggestions[hidden] {
    display: none;
  }

  .we-class-suggestion {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: #0f172a;
    transition: background-color 0.1s ease;
  }

  .we-class-suggestion:hover {
    background: rgba(99, 102, 241, 0.08);
  }

  .we-class-suggestion:focus {
    outline: none;
    background: rgba(99, 102, 241, 0.12);
  }

  .we-css-info {
    padding: 8px 10px;
    background: var(--we-accent-info-bg);
    border-radius: var(--we-radius-control);
    color: var(--we-text-secondary);
    font-size: 10px;
    margin-bottom: 8px;
  }

  .we-css-info[hidden] {
    display: none;
  }

  .we-css-warnings {
    margin-bottom: 8px;
  }

  .we-css-warnings[hidden] {
    display: none;
  }

  .we-css-warning {
    padding: 6px 10px;
    background: var(--we-accent-warning-bg);
    border: 1px solid var(--we-accent-warning-border);
    border-radius: var(--we-radius-control);
    color: #92400e;
    font-size: 10px;
    margin-bottom: 4px;
  }

  .we-css-warning-more {
    padding: 4px 10px;
    color: #92400e;
    font-size: 10px;
    font-style: italic;
  }

  .we-css-empty {
    padding: 24px 12px;
    color: #64748b;
    text-align: center;
    font-family: system-ui, sans-serif;
    font-size: 12px;
  }

  .we-css-empty[hidden] {
    display: none;
  }

  .we-css-sections {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .we-css-section {
    border: 0;
    border-radius: 0;
    overflow: visible;
    background: transparent;
  }

  .we-css-section + .we-css-section {
    border-top: 1px solid var(--we-border-section);
    padding-top: 12px;
    margin-top: 4px;
  }

  .we-css-section[data-kind="inherited"] {
    background: transparent;
  }

  .we-css-section-header {
    padding: 0 0 8px 0;
    background: transparent;
    border-bottom: 0;
    font-weight: 600;
    color: var(--we-text-primary);
    font-size: 11px;
    text-transform: none;
    letter-spacing: normal;
  }

  .we-css-section-rules {
    padding: 0;
  }

  /* Flat list style (computed-like view) */
  .we-css-rule {
    margin: 0;
    padding: 0;
    background: transparent;
    border: 0;
    border-radius: 0;
  }

  .we-css-rule + .we-css-rule {
    border-top: 1px solid var(--we-border-section);
    padding-top: 10px;
    margin-top: 10px;
  }

  .we-css-rule[data-origin="inline"] {
    background: transparent;
  }

  .we-css-rule-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: nowrap;
    margin-bottom: 8px;
    padding-bottom: 0;
    border-bottom: 0;
  }

  .we-css-rule-selector {
    flex: 1 1 auto;
    min-width: 0;
    font-weight: 500;
    color: var(--we-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-css-rule[data-origin="inline"] .we-css-rule-selector {
    color: #92400e;
    font-style: italic;
  }

  .we-css-rule-source {
    flex-shrink: 0;
    color: var(--we-text-muted);
    font-size: 10px;
    margin-left: auto;
    max-width: 45%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-css-rule-spec {
    flex-shrink: 0;
    color: var(--we-text-muted);
    font-size: 9px;
    padding: 1px 4px;
    background: var(--we-control-bg);
    border-radius: 3px;
  }

  .we-css-decls {
    padding-left: 0;
  }

  /* Two-column grid layout for declarations */
  .we-css-decl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
    column-gap: 12px;
    align-items: baseline;
    padding: 5px 0;
    color: var(--we-text-primary);
  }


  .we-css-decl[data-status="overridden"] {
    text-decoration: line-through;
    color: var(--we-text-muted);
  }

  .we-css-decl-name {
    color: var(--we-text-secondary);
    overflow-wrap: anywhere;
  }

  /* Hide punctuation for computed-like view */
  .we-css-decl-colon,
  .we-css-decl-semi {
    display: none;
  }

  /* Value container for flex layout with !important */
  .we-css-decl-value-container {
    display: flex;
    align-items: baseline;
    gap: 4px;
    min-width: 0;
  }

  .we-css-decl-value {
    color: var(--we-text-primary);
    margin-left: 0;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-css-decl[data-status="overridden"] .we-css-decl-name,
  .we-css-decl[data-status="overridden"] .we-css-decl-value {
    color: var(--we-text-muted);
  }

  .we-css-decl-important {
    flex-shrink: 0;
    color: #dc2626;
    font-weight: 600;
    font-size: 10px;
  }

  .we-css-decl[data-status="overridden"] .we-css-decl-important {
    color: #b8c4d0;
  }

  /* ==========================================================================
   * Token Picker (Phase 5.4)
   * ========================================================================== */

  .we-token-picker {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: white;
    border: 1px solid rgba(226, 232, 240, 0.95);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
    overflow: hidden;
    z-index: 30;
  }

  .we-token-picker[hidden] {
    display: none;
  }

  .we-token-filter {
    width: 100%;
    padding: 8px 10px;
    border: none;
    border-bottom: 1px solid rgba(226, 232, 240, 0.8);
    background: transparent;
    font-family: inherit;
    font-size: 11px;
    color: #0f172a;
    outline: none;
  }

  .we-token-filter::placeholder {
    color: #94a3b8;
  }

  .we-token-toggle-row {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(226, 232, 240, 0.6);
    background: rgba(248, 250, 252, 0.5);
  }

  .we-token-toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #64748b;
    cursor: pointer;
  }

  .we-token-toggle-checkbox {
    width: 12px;
    height: 12px;
    margin: 0;
    cursor: pointer;
  }

  .we-token-list {
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .we-token-list[hidden] {
    display: none;
  }

  .we-token-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    background: transparent;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .we-token-item:hover {
    background: rgba(99, 102, 241, 0.06);
  }

  .we-token-item--selected,
  .we-token-item:focus {
    outline: none;
    background: rgba(99, 102, 241, 0.1);
  }

  .we-token-swatch {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  }

  .we-token-name {
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-token-value {
    flex-shrink: 0;
    max-width: 80px;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 10px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-token-empty {
    padding: 16px 10px;
    text-align: center;
    color: #94a3b8;
    font-size: 11px;
  }

  .we-token-empty[hidden] {
    display: none;
  }

  /* Token button for input fields */
  .we-token-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: rgba(99, 102, 241, 0.08);
    color: #6366f1;
    cursor: pointer;
    transition: background-color 0.15s ease;
  }

  .we-token-btn:hover {
    background: rgba(99, 102, 241, 0.15);
  }

  .we-token-btn:focus {
    outline: none;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.3);
  }

  .we-token-btn-icon {
    width: 12px;
    height: 12px;
  }

  /* ==========================================================================
   * Token Pill (Phase 5.3)
   *
   * Compact pill UI for displaying a CSS var() reference in input fields.
   * Used when ColorField value is a standalone var(--token) expression.
   * ========================================================================== */

  .we-token-pill {
    flex: 1;
    min-width: 0;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px 0 4px;
    background: var(--we-control-bg);
    border: 1px solid transparent;
    border-radius: var(--we-radius-control);
    transition: background 0.1s ease, border-color 0.1s ease;
  }

  .we-token-pill:hover:not([data-disabled="true"]) {
    border-color: var(--we-control-border-hover);
  }

  .we-token-pill:focus-within {
    background: var(--we-control-bg-focus);
    border-color: var(--we-control-border-focus);
  }

  .we-token-pill[data-disabled="true"] {
    opacity: 0.5;
    pointer-events: none;
  }

  .we-token-pill[hidden] {
    display: none;
  }

  /* Leading slot: holds external element (ColorField swatch) or internal swatch */
  .we-token-pill__leading {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
  }

  /* Internal swatch (used when no external leading element provided) */
  .we-token-pill__swatch {
    width: 16px;
    height: 16px;
    border-radius: 4px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    background: transparent;
  }

  /* Main clickable area */
  .we-token-pill__main {
    flex: 1;
    min-width: 0;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--we-text-primary);
    cursor: pointer;
    font-size: 11px;
    text-align: left;
  }

  .we-token-pill__main:focus {
    outline: none;
  }

  .we-token-pill__main:disabled {
    cursor: default;
  }

  /* Token name with ellipsis */
  .we-token-pill__name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
  }

  /* Link icon (rotated 45° to indicate variable binding) */
  .we-token-pill__icon {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    color: var(--we-text-muted);
    transform: rotate(45deg);
  }

  /* Clear button (hover to reveal) */
  .we-token-pill__clear {
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--we-text-muted);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
  }

  .we-token-pill:hover .we-token-pill__clear {
    opacity: 1;
    pointer-events: auto;
  }

  .we-token-pill__clear:hover {
    background: rgba(15, 23, 42, 0.06);
    color: var(--we-text-primary);
  }

  .we-token-pill__clear:focus {
    outline: none;
    opacity: 1;
    pointer-events: auto;
  }

  .we-token-pill__clear:disabled {
    cursor: default;
  }

  /* ==========================================================================
     Props Panel (Phase 7.3)
     ========================================================================== */

  .we-props-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .we-props-meta {
    padding: 0 0 8px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .we-props-meta-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--we-text-primary);
    font-size: 11px;
    font-weight: 600;
  }

  .we-props-component {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .we-props-badge {
    flex: 0 0 auto;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--we-accent-brand-bg);
    color: #1d4ed8;
  }

  .we-props-status {
    font-size: 11px;
    color: #64748b;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  .we-props-warning {
    font-size: 11px;
    color: #92400e;
    background: var(--we-accent-warning-bg);
    border: 1px solid var(--we-accent-warning-border);
    border-radius: var(--we-radius-control);
    padding: 6px 8px;
  }

  .we-props-error {
    font-size: 11px;
    color: #b91c1c;
    background: var(--we-accent-danger-bg);
    border: 1px solid var(--we-accent-danger-border);
    border-radius: var(--we-radius-control);
    padding: 6px 8px;
  }

  .we-props-source {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    padding: 4px 0;
  }

  .we-props-source[hidden] {
    display: none;
  }

  .we-props-source-label {
    flex: 0 0 auto;
    color: #64748b;
    font-weight: 500;
  }

  .we-props-source-path {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--we-text-primary);
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }

  .we-btn-small {
    padding: 2px 8px;
    font-size: 11px;
  }

  /* Source open button - minimal link style */
  .we-props-source-btn {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    margin-left: 2px;
    border: none;
    background: none;
    color: #64748b;
    cursor: pointer;
    transition: color 0.12s ease;
  }

  .we-props-source-btn:hover:not(:disabled) {
    color: #3b82f6;
  }

  .we-props-source-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .we-props-source-btn svg {
    display: block;
  }

  /* Tooltip - fixed position, mounted at shadow root level */
  .we-tooltip {
    position: fixed;
    transform: translateX(-50%);
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    line-height: 1.2;
    color: #fff;
    background: rgba(15, 23, 42, 0.92);
    border-radius: 4px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 10000;
  }

  .we-tooltip[hidden] {
    display: none;
  }

  .we-props-title-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .we-props-title-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  /* Action button - minimal icon style for title bar */
  .we-props-action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: none;
    background: none;
    color: var(--we-text-secondary);
    cursor: pointer;
    transition: color 0.12s ease;
  }

  .we-props-action-btn:hover:not(:disabled) {
    color: var(--we-text-primary);
  }

  .we-props-action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .we-props-action-btn svg {
    display: block;
  }

  .we-props-list {
    overflow: hidden;
  }

  .we-props-empty {
    padding: 16px 12px;
    color: #64748b;
    font-size: 12px;
    text-align: center;
  }

  .we-props-empty[hidden] {
    display: none;
  }

  /* Loading animations */
  @keyframes we-shimmer {
    to {
      background-position: 200% center;
    }
  }

  @keyframes we-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .we-props-empty.we-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .we-props-empty.we-loading svg {
    flex-shrink: 0;
    color: #94a3b8;
  }

  .we-props-empty.we-loading span {
    background: linear-gradient(
      90deg,
      #64748b 0%,
      #94a3b8 50%,
      #64748b 100%
    );
    background-size: 200% auto;
    color: transparent;
    -webkit-background-clip: text;
    background-clip: text;
    animation: we-shimmer 2s linear infinite;
  }

  .we-props-group {
    padding: 0 0 8px 0;
    margin-top: 4px;
    color: var(--we-text-primary);
    font-size: 11px;
    font-weight: 600;
    border-top: 1px solid var(--we-border-section);
    padding-top: 12px;
  }

  .we-props-group:first-child {
    border-top: 0;
    margin-top: 0;
    padding-top: 0;
  }

  .we-props-group + .we-props-row {
    border-top: 0;
  }

  .we-props-rows {
    display: flex;
    flex-direction: column;
  }

  .we-props-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 0;
    border-top: 1px solid var(--we-border-section);
  }

  .we-props-row:first-child {
    border-top: 0;
  }

  .we-props-key {
    flex: 0 0 110px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    color: #334155;
  }

  .we-props-value {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .we-props-value--readonly {
    justify-content: flex-start;
    color: #475569;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .we-props-input {
    width: 140px;
    max-width: 100%;
  }

  .we-props-input--invalid {
    border-color: rgba(248, 113, 113, 0.85);
  }

  .we-props-bool {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #475569;
    cursor: pointer;
  }

  .we-props-checkbox {
    width: 14px;
    height: 14px;
    accent-color: #6366f1;
    cursor: pointer;
  }

  .we-props-checkbox:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* ==========================================================================
   * Color Field (Phase 4.4)
   * ========================================================================== */

  .we-color-field {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .we-color-swatch {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    position: relative;
    border: 1px solid var(--we-border-subtle);
    border-radius: var(--we-radius-control);
    background: var(--we-control-bg);
    cursor: pointer;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    overflow: hidden;
  }

  .we-color-swatch:hover {
    border-color: var(--we-border-strong);
  }

  .we-color-swatch:focus-visible,
  .we-color-swatch:focus-within {
    outline: none;
    box-shadow: 0 0 0 2px var(--we-focus-ring);
  }

  .we-color-swatch:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Native color input overlays the swatch for direct click interaction */
  .we-color-native-input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
    border: none;
    padding: 0;
    margin: 0;
  }

  .we-color-text {
    flex: 1;
    min-width: 0;
  }

  /* ==========================================================================
   * Tooltip (data-tooltip)
   *
   * CSS-only tooltips using the data-tooltip attribute.
   * Shows on hover/focus with minimal delay.
   * ========================================================================== */

  [data-tooltip] {
    position: relative;
  }

  [data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 8px;
    font-size: 11px;
    font-family: inherit;
    font-weight: 400;
    line-height: 1.3;
    white-space: nowrap;
    color: var(--we-surface-bg);
    background-color: var(--we-text-primary);
    border-radius: var(--we-radius-control);
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 100ms ease,
      visibility 100ms ease;
    pointer-events: none;
    z-index: 99999;
  }

  [data-tooltip]::before {
    content: '';
    position: absolute;
    bottom: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    border: 4px solid transparent;
    border-top-color: var(--we-text-primary);
    opacity: 0;
    visibility: hidden;
    transition:
      opacity 100ms ease,
      visibility 100ms ease;
    pointer-events: none;
    z-index: 99999;
  }

  [data-tooltip]:hover::after,
  [data-tooltip]:focus-visible::after,
  [data-tooltip]:focus-within::after {
    opacity: 1;
    visibility: visible;
  }

  [data-tooltip]:hover::before,
  [data-tooltip]:focus-visible::before,
  [data-tooltip]:focus-within::before {
    opacity: 1;
    visibility: visible;
  }

  /* ==========================================================================
   * Global Hidden Rule
   * Ensures [hidden] attribute always hides elements, even when they have
   * explicit display values (flex, inline-flex, etc.)
   * ========================================================================== */
  [hidden] {
    display: none !important;
  }
`
  );
  function setImportantStyle(element, property, value) {
    element.style.setProperty(property, value, "important");
  }
  function mountShadowHost(options = {}) {
    var _a2;
    const disposer = new Disposer();
    let elements = null;
    const existing = document.getElementById(WEB_EDITOR_V2_HOST_ID);
    if (existing) {
      try {
        existing.remove();
      } catch (e) {
      }
    }
    const host = document.createElement("div");
    host.id = WEB_EDITOR_V2_HOST_ID;
    host.setAttribute("data-mcp-web-editor", "v2");
    setImportantStyle(host, "position", "fixed");
    setImportantStyle(host, "inset", "0");
    setImportantStyle(host, "z-index", String(WEB_EDITOR_V2_Z_INDEX));
    setImportantStyle(host, "pointer-events", "none");
    setImportantStyle(host, "contain", "layout style paint");
    setImportantStyle(host, "isolation", "isolate");
    const shadowRoot = host.attachShadow({ mode: "open" });
    const styleEl = document.createElement("style");
    styleEl.textContent = SHADOW_HOST_STYLES;
    shadowRoot.append(styleEl);
    const overlayRoot = document.createElement("div");
    overlayRoot.id = WEB_EDITOR_V2_OVERLAY_ID;
    const uiRoot = document.createElement("div");
    uiRoot.id = WEB_EDITOR_V2_UI_ID;
    shadowRoot.append(overlayRoot, uiRoot);
    const mountPoint = (_a2 = document.documentElement) != null ? _a2 : document.body;
    mountPoint.append(host);
    disposer.add(() => host.remove());
    elements = { host, shadowRoot, overlayRoot, uiRoot };
    const blockedEvents = [
      "pointerdown",
      "pointerup",
      "pointermove",
      "pointerenter",
      "pointerleave",
      "mousedown",
      "mouseup",
      "mousemove",
      "mouseenter",
      "mouseleave",
      "click",
      "dblclick",
      "contextmenu",
      "keydown",
      "keyup",
      "keypress",
      "wheel",
      "touchstart",
      "touchmove",
      "touchend",
      "touchcancel",
      "focus",
      "blur",
      "input",
      "change"
    ];
    const stopPropagation = (event) => {
      event.stopPropagation();
    };
    for (const eventType of blockedEvents) {
      disposer.listen(uiRoot, eventType, stopPropagation);
      disposer.listen(overlayRoot, eventType, stopPropagation);
    }
    const isOverlayElement = (node) => {
      if (!(node instanceof Node)) return false;
      if (node === host) return true;
      const root = typeof node.getRootNode === "function" ? node.getRootNode() : null;
      return root instanceof ShadowRoot && root.host === host;
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
  const WINDOW_CAPTURE = { capture: true, passive: false };
  function blockEvent(event) {
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
  }
  function clampNumber$1(value, min, max) {
    if (!Number.isFinite(value)) return min;
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.min(hi, Math.max(lo, value));
  }
  function clampPosition(position, size, clampMargin, viewport) {
    const margin = Number.isFinite(clampMargin) ? Math.max(0, clampMargin) : 0;
    const maxLeft = Math.max(margin, viewport.width - margin - size.width);
    const maxTop = Math.max(margin, viewport.height - margin - size.height);
    return {
      left: clampNumber$1(position.left, margin, maxLeft),
      top: clampNumber$1(position.top, margin, maxTop)
    };
  }
  function roundPosition(position) {
    return { left: Math.round(position.left), top: Math.round(position.top) };
  }
  function installFloatingDrag(options) {
    var _a2, _b2;
    const { handleEl, targetEl, onPositionChange, clampMargin } = options;
    const clickThresholdMs = Math.max(0, (_a2 = options.clickThresholdMs) != null ? _a2 : 0);
    const moveThresholdPx = Math.max(0, (_b2 = options.moveThresholdPx) != null ? _b2 : 0);
    const delayedActivation = clickThresholdMs > 0;
    const moveThresholdSq = moveThresholdPx * moveThresholdPx;
    let session = null;
    let disposed = false;
    let activationTimer = null;
    function teardownWindowListeners() {
      window.removeEventListener("pointermove", onWindowPointerMove, WINDOW_CAPTURE);
      window.removeEventListener("pointerup", onWindowPointerUp, WINDOW_CAPTURE);
      window.removeEventListener("pointercancel", onWindowPointerCancel, WINDOW_CAPTURE);
      window.removeEventListener("keydown", onWindowKeyDown, WINDOW_CAPTURE);
      window.removeEventListener("blur", onWindowBlur, WINDOW_CAPTURE);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
    function clearActivationTimer() {
      if (activationTimer !== null) {
        window.clearTimeout(activationTimer);
        activationTimer = null;
      }
    }
    function endDrag(pointerId) {
      const s = session;
      if (!s) return;
      if (s.pointerId !== pointerId) return;
      clearActivationTimer();
      try {
        handleEl.releasePointerCapture(pointerId);
      } catch (e) {
      }
      teardownWindowListeners();
      session = null;
      handleEl.dataset.dragging = "false";
    }
    function applyNextPosition(next) {
      const s = session;
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const size = s ? { width: s.targetWidth, height: s.targetHeight } : (() => {
        const rect = targetEl.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })();
      const clamped = clampPosition(next, size, clampMargin, viewport);
      onPositionChange(roundPosition(clamped));
    }
    function cancelDrag() {
      const s = session;
      if (!s) return;
      applyNextPosition(s.startPosition);
      endDrag(s.pointerId);
    }
    function suppressClickOnce() {
      const onClick = (e) => {
        blockEvent(e);
      };
      handleEl.addEventListener("click", onClick, { capture: true, once: true });
      window.setTimeout(() => {
        handleEl.removeEventListener("click", onClick, { capture: true });
      }, 300);
    }
    function activateDrag(pointerId) {
      const s = session;
      if (!s || s.pointerId !== pointerId || s.activated) return;
      s.activated = true;
      handleEl.dataset.dragging = "true";
      clearActivationTimer();
      try {
        handleEl.setPointerCapture(pointerId);
      } catch (e) {
      }
    }
    function onWindowPointerMove(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      if (!s.activated) {
        if (!delayedActivation || moveThresholdSq <= 0) return;
        const dx = event.clientX - s.startClientX;
        const dy = event.clientY - s.startClientY;
        if (dx * dx + dy * dy < moveThresholdSq) return;
        activateDrag(event.pointerId);
      }
      blockEvent(event);
      applyNextPosition({
        left: event.clientX - s.offsetX,
        top: event.clientY - s.offsetY
      });
    }
    function onWindowPointerUp(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      if (s.activated) {
        blockEvent(event);
        suppressClickOnce();
      }
      endDrag(event.pointerId);
    }
    function onWindowPointerCancel(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      if (s.activated) {
        blockEvent(event);
        cancelDrag();
      } else {
        endDrag(event.pointerId);
      }
    }
    function onWindowKeyDown(event) {
      if (event.key !== "Escape") return;
      const s = session;
      if (!s) return;
      if (s.activated) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        cancelDrag();
      } else {
        endDrag(s.pointerId);
      }
    }
    function onWindowBlur() {
      const s = session;
      if (!s) return;
      if (s.activated) {
        cancelDrag();
      } else {
        endDrag(s.pointerId);
      }
    }
    function onVisibilityChange() {
      const s = session;
      if (!s) return;
      if (document.visibilityState !== "hidden") return;
      if (s.activated) {
        cancelDrag();
      } else {
        endDrag(s.pointerId);
      }
    }
    function onHandlePointerDown(event) {
      if (disposed) return;
      if (!targetEl.isConnected) return;
      if (session) return;
      if (event.button !== 0) return;
      if (!event.isPrimary) return;
      if (!delayedActivation) {
        blockEvent(event);
      }
      const rect = targetEl.getBoundingClientRect();
      const startPosition = roundPosition({ left: rect.left, top: rect.top });
      session = {
        pointerId: event.pointerId,
        startPosition,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        targetWidth: rect.width,
        targetHeight: rect.height,
        startClientX: event.clientX,
        startClientY: event.clientY,
        activated: !delayedActivation
      };
      handleEl.dataset.dragging = session.activated ? "true" : "false";
      try {
        handleEl.setPointerCapture(event.pointerId);
      } catch (e) {
      }
      if (delayedActivation) {
        clearActivationTimer();
        const pointerId = event.pointerId;
        activationTimer = window.setTimeout(() => {
          activateDrag(pointerId);
        }, clickThresholdMs);
      }
      window.addEventListener("pointermove", onWindowPointerMove, WINDOW_CAPTURE);
      window.addEventListener("pointerup", onWindowPointerUp, WINDOW_CAPTURE);
      window.addEventListener("pointercancel", onWindowPointerCancel, WINDOW_CAPTURE);
      window.addEventListener("keydown", onWindowKeyDown, WINDOW_CAPTURE);
      window.addEventListener("blur", onWindowBlur, WINDOW_CAPTURE);
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    handleEl.dataset.dragging = "false";
    handleEl.addEventListener("pointerdown", onHandlePointerDown);
    return () => {
      disposed = true;
      handleEl.removeEventListener("pointerdown", onHandlePointerDown);
      if (session) {
        try {
          if (session.activated) {
            cancelDrag();
          } else {
            endDrag(session.pointerId);
          }
        } catch (e) {
        }
      }
      teardownWindowListeners();
      clearActivationTimer();
      session = null;
      handleEl.dataset.dragging = "false";
    };
  }
  function createSvgElement() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  function createSvgElement24() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    return svg;
  }
  function createStrokePath(d) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    return path;
  }
  function createCloseIcon() {
    const svg = createSvgElement();
    svg.append(createStrokePath("M6 6l8 8M14 6l-8 8"));
    return svg;
  }
  function createGripIcon() {
    const svg = createSvgElement();
    const DOT_POSITIONS = [
      [7, 6],
      [13, 6],
      [7, 10],
      [13, 10],
      [7, 14],
      [13, 14]
    ];
    for (const [cx, cy] of DOT_POSITIONS) {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", "1.4");
      circle.setAttribute("fill", "currentColor");
      svg.append(circle);
    }
    return svg;
  }
  function createChevronIcon() {
    const svg = createSvgElement();
    svg.classList.add("we-chevron");
    svg.append(createStrokePath("M7 8l3 3 3-3"));
    return svg;
  }
  function createUndoIcon() {
    const svg = createSvgElement24();
    svg.append(createStrokePath("M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"));
    return svg;
  }
  function createRedoIcon() {
    const svg = createSvgElement24();
    svg.append(createStrokePath("M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"));
    return svg;
  }
  function createChevronUpIcon() {
    const svg = createSvgElement();
    svg.append(createStrokePath("M6 12l4-4 4 4"));
    return svg;
  }
  function createChevronDownSmallIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M19 9l-7 7-7-7");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }
  function isPromiseLike(value) {
    return !!value && (typeof value === "object" || typeof value === "function") && typeof value.then === "function";
  }
  function isApplyResult(value) {
    if (!value || typeof value !== "object") return false;
    const req = value.requestId;
    return req === void 0 || typeof req === "string";
  }
  function formatStatusMessage(base, result2) {
    const req = (result2 == null ? void 0 : result2.requestId) ? `requestId=${result2.requestId}` : "";
    return req ? `${base} (${req})` : base;
  }
  const STATUS_RESET_DELAY_MS = 2400;
  const SUCCESS_STATUSES = ["success", "completed", "verified"];
  const ERROR_STATUSES = [
    "error",
    "failed",
    "timeout",
    "cancelled",
    "mismatch",
    "lost",
    "uncertain"
  ];
  const PROGRESS_STATUSES = [
    "applying",
    "running",
    "starting",
    "locating",
    "verifying"
  ];
  function getStatusCategory(status) {
    if (SUCCESS_STATUSES.includes(status)) return "success";
    if (ERROR_STATUSES.includes(status)) return "error";
    if (PROGRESS_STATUSES.includes(status)) return "progress";
    return "idle";
  }
  function createToolbar(options) {
    var _a2, _b2;
    const disposer = new Disposer();
    const dock = (_a2 = options.dock) != null ? _a2 : "top";
    let undoCount = 0;
    let redoCount = 0;
    let status = "idle";
    let statusMessage = "";
    let applying = false;
    let resetTimer = null;
    let minimized = false;
    let floatingPosition = (_b2 = options.initialPosition) != null ? _b2 : null;
    const root = document.createElement("div");
    root.className = "we-toolbar";
    root.dataset.position = dock;
    root.dataset.status = status;
    root.dataset.minimized = "false";
    root.dataset.dragged = floatingPosition ? "true" : "false";
    root.dataset.structureOpen = "false";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "Web Editor Toolbar");
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "we-drag-handle";
    dragHandle.setAttribute("aria-label", "Collapse toolbar");
    dragHandle.dataset.tooltip = "Collapse";
    dragHandle.append(createGripIcon());
    const content = document.createElement("div");
    content.className = "we-toolbar-content";
    const indicator = document.createElement("div");
    indicator.className = "we-toolbar-indicator";
    const indicatorDot = document.createElement("span");
    indicatorDot.className = "we-toolbar-indicator-dot";
    const indicatorLabel = document.createElement("span");
    indicatorLabel.className = "we-toolbar-indicator-label";
    indicatorLabel.textContent = "Editor";
    indicator.append(indicatorDot, indicatorLabel);
    const historyEl = document.createElement("div");
    historyEl.className = "we-toolbar-history";
    const undoCountLabel = document.createElement("span");
    const undoCountValue = document.createElement("b");
    undoCountValue.className = "we-toolbar-history-value";
    undoCountLabel.append("Undo: ", undoCountValue);
    const redoCountLabel = document.createElement("span");
    const redoCountValue = document.createElement("b");
    redoCountValue.className = "we-toolbar-history-value";
    redoCountLabel.append("Redo: ", redoCountValue);
    historyEl.append(undoCountLabel, redoCountLabel);
    const divider = document.createElement("div");
    divider.className = "we-toolbar-divider";
    const structureGroup = document.createElement("div");
    structureGroup.className = "we-toolbar-structure-group";
    const structureGroupSeparator = document.createElement("div");
    structureGroupSeparator.className = "we-toolbar-structure-separator";
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "we-toolbar-apply-btn";
    applyBtn.textContent = "Apply";
    applyBtn.setAttribute("aria-label", "Apply changes to code");
    const undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "we-toolbar-group-icon-btn";
    undoBtn.setAttribute("aria-label", "Undo last change");
    undoBtn.dataset.tooltip = "Undo";
    undoBtn.append(createUndoIcon());
    const redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "we-toolbar-group-icon-btn";
    redoBtn.setAttribute("aria-label", "Redo last undone change");
    redoBtn.dataset.tooltip = "Redo";
    redoBtn.append(createRedoIcon());
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "we-toolbar-close-btn";
    closeBtn.setAttribute("aria-label", "Close Web Editor");
    closeBtn.dataset.tooltip = "Exit Editor";
    closeBtn.append(createCloseIcon());
    const statusEl = document.createElement("span");
    statusEl.className = "we-sr-only";
    statusEl.setAttribute("aria-live", "polite");
    const DISALLOWED_TARGET_TAGS = /* @__PURE__ */ new Set(["HTML", "BODY", "HEAD"]);
    const DISALLOWED_CONTAINER_TAGS = /* @__PURE__ */ new Set(["HTML", "HEAD"]);
    const DEFAULT_STACK_GAP = "10px";
    const structureWrap = document.createElement("div");
    structureWrap.className = "we-structure-wrap";
    structureWrap.style.position = "relative";
    structureWrap.style.display = "inline-flex";
    const structureBtn = document.createElement("button");
    structureBtn.type = "button";
    structureBtn.className = "we-toolbar-structure-btn";
    structureBtn.setAttribute("aria-label", "Structure operations");
    structureBtn.setAttribute("aria-haspopup", "menu");
    structureBtn.setAttribute("aria-expanded", "false");
    structureBtn.append(document.createTextNode("Structure"), createChevronDownSmallIcon());
    const structureMenu = document.createElement("div");
    structureMenu.className = "we-structure-menu";
    structureMenu.setAttribute("role", "menu");
    structureMenu.setAttribute("aria-label", "Structure actions");
    Object.assign(structureMenu.style, {
      position: "absolute",
      top: "calc(100% + 8px)",
      right: "0",
      minWidth: "160px",
      padding: "6px",
      background: "rgba(255, 255, 255, 0.98)",
      border: "1px solid rgba(148, 163, 184, 0.45)",
      borderRadius: "10px",
      boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 10px 20px -5px rgba(0, 0, 0, 0.12)",
      backdropFilter: "blur(8px)",
      display: "none",
      flexDirection: "column",
      gap: "4px",
      zIndex: "10001"
    });
    structureWrap.append(structureBtn, structureMenu);
    function buildStructureData(action) {
      switch (action) {
        case "group":
          return { action: "wrap", wrapperTag: "div" };
        case "stack":
          return {
            action: "wrap",
            wrapperTag: "div",
            wrapperStyles: {
              display: "flex",
              "flex-direction": "column",
              gap: DEFAULT_STACK_GAP
            }
          };
        case "ungroup":
          return { action: "unwrap" };
        case "duplicate":
          return { action: "duplicate" };
        case "delete":
          return { action: "delete" };
      }
    }
    function createStructureMenuItem(action, label) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = action === "delete" ? "we-btn we-btn--danger" : "we-btn";
      btn.textContent = label;
      btn.setAttribute("role", "menuitem");
      btn.dataset.action = action;
      Object.assign(btn.style, {
        width: "100%",
        justifyContent: "flex-start",
        padding: "6px 10px"
      });
      return btn;
    }
    const structureItems = [
      { action: "group", label: "Group", el: createStructureMenuItem("group", "Group") },
      { action: "stack", label: "Stack", el: createStructureMenuItem("stack", "Stack") },
      { action: "ungroup", label: "Ungroup", el: createStructureMenuItem("ungroup", "Ungroup") },
      {
        action: "duplicate",
        label: "Duplicate",
        el: createStructureMenuItem("duplicate", "Duplicate")
      },
      { action: "delete", label: "Delete", el: createStructureMenuItem("delete", "Delete") }
    ];
    for (const item of structureItems) {
      structureMenu.append(item.el);
    }
    let structureOpen = false;
    function setStructureOpen(open) {
      structureOpen = open;
      structureMenu.style.display = open ? "flex" : "none";
      structureBtn.setAttribute("aria-expanded", open ? "true" : "false");
      root.dataset.structureOpen = open ? "true" : "false";
    }
    function getSelectedElement() {
      var _a3, _b3;
      const el = (_b3 = (_a3 = options.getSelectedElement) == null ? void 0 : _a3.call(options)) != null ? _b3 : null;
      return (el == null ? void 0 : el.isConnected) ? el : null;
    }
    function isDisallowedTarget(el) {
      var _a3;
      const tag = (_a3 = el.tagName) == null ? void 0 : _a3.toUpperCase();
      return DISALLOWED_TARGET_TAGS.has(tag);
    }
    function isDisallowedContainer(el) {
      var _a3;
      const tag = (_a3 = el.tagName) == null ? void 0 : _a3.toUpperCase();
      return DISALLOWED_CONTAINER_TAGS.has(tag);
    }
    function getStructureActionBlockReason(action, target) {
      if (applying) return "Operation in progress";
      if (!options.onStructure) return "Not configured";
      if (!target) return "Select an element first";
      if (isDisallowedTarget(target)) return "Cannot edit <html>, <body>, or <head>";
      const parent = target.parentElement;
      switch (action) {
        case "group":
        case "stack":
          if (!parent) return "Element has no parent";
          if (isDisallowedContainer(parent)) return "Cannot wrap under <html> or <head>";
          return null;
        case "ungroup":
          if (!parent) return "Element has no parent";
          if (isDisallowedContainer(parent)) return "Cannot unwrap under <html> or <head>";
          if (target.childElementCount !== 1) return "Ungroup requires exactly one child";
          return null;
        case "duplicate":
        case "delete":
          if (!parent) return "Element has no parent";
          if (isDisallowedContainer(parent)) return "Cannot modify under <html> or <head>";
          return null;
      }
    }
    function renderStructureControls() {
      var _a3;
      const target = getSelectedElement();
      let anyEnabled = false;
      for (const item of structureItems) {
        const reason = getStructureActionBlockReason(item.action, target);
        const disabled = !!reason;
        item.el.disabled = disabled;
        item.el.title = reason != null ? reason : "";
        anyEnabled = anyEnabled || !disabled;
      }
      structureBtn.disabled = !anyEnabled;
      structureBtn.title = !anyEnabled ? (_a3 = getStructureActionBlockReason("group", target)) != null ? _a3 : "Unavailable" : "";
      if (structureBtn.disabled && structureOpen) {
        setStructureOpen(false);
      }
    }
    structureGroup.append(structureWrap, structureGroupSeparator, undoBtn, redoBtn);
    const endActions = document.createElement("div");
    endActions.className = "we-toolbar-end-actions";
    endActions.append(applyBtn, closeBtn);
    content.append(indicator, historyEl, divider, structureGroup, endActions);
    root.append(dragHandle, content, statusEl);
    options.container.append(root);
    disposer.add(() => root.remove());
    const CLAMP_MARGIN_PX = 16;
    function clampToViewport(position) {
      const rect = root.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const margin = CLAMP_MARGIN_PX;
      const maxLeft = Math.max(margin, viewportW - margin - rect.width);
      const maxTop = Math.max(margin, viewportH - margin - rect.height);
      const left = Number.isFinite(position.left) ? position.left : 0;
      const top = Number.isFinite(position.top) ? position.top : 0;
      return {
        left: Math.round(Math.min(maxLeft, Math.max(margin, left))),
        top: Math.round(Math.min(maxTop, Math.max(margin, top)))
      };
    }
    function syncFloatingPositionStyles() {
      root.dataset.dragged = floatingPosition ? "true" : "false";
      if (!floatingPosition) {
        root.style.left = "";
        root.style.top = "";
        root.style.right = "";
        root.style.bottom = "";
        root.style.transform = "";
        return;
      }
      root.style.left = `${floatingPosition.left}px`;
      root.style.top = `${floatingPosition.top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
      root.style.transform = "none";
    }
    function setPosition(position) {
      var _a3;
      floatingPosition = position ? clampToViewport(position) : null;
      syncFloatingPositionStyles();
      (_a3 = options.onPositionChange) == null ? void 0 : _a3.call(options, floatingPosition);
    }
    function getPosition() {
      return floatingPosition;
    }
    disposer.add(
      installFloatingDrag({
        handleEl: dragHandle,
        targetEl: root,
        clampMargin: CLAMP_MARGIN_PX,
        onPositionChange: (pos) => setPosition(pos),
        // Delayed activation: short clicks pass through, long press/move activates drag
        clickThresholdMs: 200,
        moveThresholdPx: 5
      })
    );
    if (floatingPosition !== null) {
      setPosition(floatingPosition);
    } else {
      syncFloatingPositionStyles();
    }
    function clearResetTimer() {
      if (resetTimer !== null) {
        window.clearTimeout(resetTimer);
        resetTimer = null;
      }
    }
    disposer.add(clearResetTimer);
    function setMinimized(value) {
      const wasMinimized = minimized;
      minimized = value;
      root.dataset.minimized = minimized ? "true" : "false";
      if (minimized) {
        setStructureOpen(false);
      }
      if (wasMinimized && !minimized && floatingPosition) {
        setPosition(floatingPosition);
        root.addEventListener(
          "transitionend",
          (event) => {
            if (event.target !== root) return;
            if (event.propertyName !== "width" && event.propertyName !== "height") return;
            if (!minimized && floatingPosition) {
              setPosition(floatingPosition);
            }
          },
          { once: true }
        );
      }
      dragHandle.setAttribute("aria-label", minimized ? "Expand toolbar" : "Collapse toolbar");
      dragHandle.dataset.tooltip = minimized ? "Expand" : "Collapse";
    }
    function renderCounts() {
      undoCountValue.textContent = String(undoCount);
      redoCountValue.textContent = String(redoCount);
    }
    function renderButtons() {
      var _a3;
      undoBtn.disabled = applying || undoCount <= 0;
      redoBtn.disabled = applying || redoCount <= 0;
      const blockReason = (_a3 = options.getApplyBlockReason) == null ? void 0 : _a3.call(options);
      const isBlocked = !!blockReason;
      applyBtn.disabled = applying || undoCount <= 0 || !options.onApply || isBlocked;
      applyBtn.textContent = applying ? "Applying…" : "Apply";
      applyBtn.title = isBlocked ? blockReason : "";
      renderStructureControls();
    }
    function renderStatus() {
      const category = getStatusCategory(status);
      root.dataset.status = category;
      root.dataset.statusDetail = status;
      statusEl.textContent = status === "idle" ? "" : statusMessage;
    }
    function scheduleStatusReset() {
      clearResetTimer();
      resetTimer = window.setTimeout(() => setStatus("idle"), STATUS_RESET_DELAY_MS);
    }
    function setHistory(nextUndo, nextRedo) {
      undoCount = Math.max(0, Math.floor(nextUndo));
      redoCount = Math.max(0, Math.floor(nextRedo));
      renderCounts();
      renderButtons();
    }
    function setStatus(nextStatus, message) {
      status = nextStatus;
      statusMessage = (message != null ? message : "").trim();
      renderStatus();
      const category = getStatusCategory(status);
      if (category === "success" || category === "error") {
        scheduleStatusReset();
      } else {
        clearResetTimer();
      }
    }
    function handleApply() {
      return __async(this, null, function* () {
        if (applyBtn.disabled) return;
        if (!options.onApply) return;
        applying = true;
        renderButtons();
        setStatus("applying", "Sending…");
        try {
          const resultOrPromise = options.onApply();
          const result2 = isPromiseLike(resultOrPromise) ? yield resultOrPromise : resultOrPromise;
          const applyResult = isApplyResult(result2) ? result2 : void 0;
          setStatus("success", formatStatusMessage("Sent", applyResult));
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          setStatus("error", msg || "Failed");
        } finally {
          applying = false;
          renderButtons();
        }
      });
    }
    disposer.listen(applyBtn, "click", (event) => {
      event.preventDefault();
      void handleApply();
    });
    disposer.listen(dragHandle, "click", (event) => {
      event.preventDefault();
      setMinimized(!minimized);
    });
    disposer.listen(structureBtn, "click", (event) => {
      event.preventDefault();
      if (structureBtn.disabled) return;
      setStructureOpen(!structureOpen);
    });
    for (const item of structureItems) {
      disposer.listen(item.el, "click", (event) => {
        event.preventDefault();
        if (item.el.disabled) return;
        if (!options.onStructure) return;
        options.onStructure(buildStructureData(item.action));
        setStructureOpen(false);
      });
    }
    disposer.listen(
      window,
      "pointerdown",
      (event) => {
        if (!structureOpen) return;
        try {
          if (typeof event.composedPath === "function") {
            const inside = event.composedPath().some((n) => n === structureWrap);
            if (inside) return;
          }
        } catch (e) {
        }
        const target = event.target;
        if (target instanceof Node && structureWrap.contains(target)) return;
        setStructureOpen(false);
      },
      { capture: true }
    );
    disposer.listen(
      window,
      "keydown",
      (event) => {
        if (!structureOpen) return;
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        setStructureOpen(false);
      },
      { capture: true }
    );
    disposer.listen(undoBtn, "click", (event) => {
      var _a3;
      event.preventDefault();
      if (undoBtn.disabled) return;
      (_a3 = options.onUndo) == null ? void 0 : _a3.call(options);
    });
    disposer.listen(redoBtn, "click", (event) => {
      var _a3;
      event.preventDefault();
      if (redoBtn.disabled) return;
      (_a3 = options.onRedo) == null ? void 0 : _a3.call(options);
    });
    disposer.listen(closeBtn, "click", (event) => {
      var _a3;
      event.preventDefault();
      (_a3 = options.onRequestClose) == null ? void 0 : _a3.call(options);
    });
    const SELECTION_POLL_INTERVAL_MS = 140;
    let lastSelection = null;
    let selectionPollTimer = null;
    function scheduleSelectionPoll() {
      if (disposer.isDisposed) return;
      selectionPollTimer = window.setTimeout(() => {
        selectionPollTimer = null;
        const current = getSelectedElement();
        if (current !== lastSelection) {
          lastSelection = current;
          setStructureOpen(false);
          renderButtons();
        }
        scheduleSelectionPoll();
      }, SELECTION_POLL_INTERVAL_MS);
    }
    if (options.getSelectedElement) {
      lastSelection = getSelectedElement();
      scheduleSelectionPoll();
      disposer.add(() => {
        if (selectionPollTimer !== null) {
          window.clearTimeout(selectionPollTimer);
          selectionPollTimer = null;
        }
      });
    }
    renderCounts();
    renderButtons();
    renderStatus();
    return {
      setHistory,
      setStatus,
      getPosition,
      setPosition,
      dispose: () => disposer.dispose()
    };
  }
  const MAX_COMPOSED_DEPTH = 64;
  const MAX_LABEL_CHARS = 36;
  const MAX_CLASS_PARTS = 2;
  const NORMAL_SEPARATOR = "›";
  const SHADOW_SEPARATOR = "⬡";
  const ANCHOR_GAP_PX = 10;
  const SAFE_PADDING_PX = 8;
  const PROPERTY_PANEL_WIDTH = 320;
  function truncateLabel(text, maxChars) {
    const t = text.trim();
    if (t.length <= maxChars) return t;
    return `${t.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  function formatElementLabel$2(element) {
    var _a2, _b2;
    const tag = element.tagName.toLowerCase();
    const id = (_a2 = element.id) == null ? void 0 : _a2.trim();
    let suffix = "";
    if (id) {
      suffix = `#${id}`;
    } else {
      const classes = Array.from((_b2 = element.classList) != null ? _b2 : []).map((c) => c.trim()).filter(Boolean).slice(0, MAX_CLASS_PARTS);
      if (classes.length > 0) {
        suffix = `.${classes.join(".")}`;
      }
    }
    const fullLabel = `${tag}${suffix}`;
    return { fullLabel, label: truncateLabel(fullLabel, MAX_LABEL_CHARS) };
  }
  function buildComposedBreadcrumbs(target) {
    var _a2;
    const raw = [];
    let current = target;
    for (let i = 0; current && i < MAX_COMPOSED_DEPTH; i++) {
      const tag = current.tagName.toUpperCase();
      if (tag === "HTML" || tag === "BODY") break;
      const parent = current.parentElement;
      if (parent) {
        raw.push({ element: current, crossToParent: false });
        current = parent;
        continue;
      }
      const rootNode = (_a2 = current.getRootNode) == null ? void 0 : _a2.call(current);
      if (rootNode instanceof ShadowRoot && rootNode.host instanceof Element) {
        raw.push({ element: current, crossToParent: true });
        current = rootNode.host;
        continue;
      }
      raw.push({ element: current, crossToParent: false });
      break;
    }
    return raw.reverse().map(({ element, crossToParent }) => {
      const { label, fullLabel } = formatElementLabel$2(element);
      return {
        element,
        label,
        fullLabel,
        // boundaryBefore: true means there's a Shadow DOM boundary between this item
        // and the previous item in the breadcrumb list
        boundaryBefore: crossToParent
      };
    });
  }
  function createBreadcrumbs(options) {
    var _a2;
    const disposer = new Disposer();
    const dock = (_a2 = options.dock) != null ? _a2 : "top";
    let currentTarget = null;
    let items = [];
    let anchorRect = null;
    let barW = 0;
    let barH = 0;
    const root = document.createElement("nav");
    root.className = "we-breadcrumbs";
    root.dataset.position = dock;
    root.dataset.hidden = "true";
    root.setAttribute("aria-label", "Selection breadcrumbs");
    options.container.append(root);
    disposer.add(() => root.remove());
    function clampNumber2(value, min, max) {
      if (max < min) return min;
      return Math.min(max, Math.max(min, value));
    }
    function getSafeRightX(viewportW) {
      const panelReserved = 16 + PROPERTY_PANEL_WIDTH + 16;
      return viewportW - panelReserved;
    }
    function measureBarDimensions() {
      const rect = root.getBoundingClientRect();
      barW = rect.width;
      barH = rect.height;
    }
    function updatePosition() {
      if (!currentTarget) return;
      if (!anchorRect) return;
      if (!(barW > 0 && barH > 0)) return;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const safeRightX = getSafeRightX(viewportW);
      const maxLeft = Math.min(viewportW - SAFE_PADDING_PX - barW, safeRightX - barW);
      const left = clampNumber2(anchorRect.left, SAFE_PADDING_PX, maxLeft);
      const aboveTop = anchorRect.top - ANCHOR_GAP_PX - barH;
      const belowTop = anchorRect.top + anchorRect.height + ANCHOR_GAP_PX;
      const preferredTop = aboveTop >= SAFE_PADDING_PX ? aboveTop : belowTop;
      const top = clampNumber2(preferredTop, SAFE_PADDING_PX, viewportH - SAFE_PADDING_PX - barH);
      root.style.left = `${Math.round(left)}px`;
      root.style.top = `${Math.round(top)}px`;
    }
    function render() {
      root.textContent = "";
      if (!currentTarget) {
        root.dataset.hidden = "true";
        return;
      }
      root.dataset.hidden = "false";
      const frag = document.createDocumentFragment();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i > 0) {
          const sep = document.createElement("span");
          const isShadowBoundary = item.boundaryBefore;
          sep.className = isShadowBoundary ? "we-crumb-sep we-crumb-sep--shadow" : "we-crumb-sep";
          sep.textContent = isShadowBoundary ? SHADOW_SEPARATOR : NORMAL_SEPARATOR;
          sep.setAttribute("aria-hidden", "true");
          frag.append(sep);
        }
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "we-crumb";
        btn.dataset.index = String(i);
        btn.textContent = item.label;
        btn.title = item.fullLabel;
        if (i === items.length - 1) {
          btn.classList.add("we-crumb--current");
          btn.setAttribute("aria-current", "page");
        }
        frag.append(btn);
      }
      root.append(frag);
      measureBarDimensions();
      updatePosition();
    }
    disposer.listen(root, "click", (event) => {
      var _a3;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest("button.we-crumb");
      if (!(btn instanceof HTMLButtonElement)) return;
      event.preventDefault();
      const rawIndex = (_a3 = btn.dataset.index) != null ? _a3 : "";
      const index = Number(rawIndex);
      if (!Number.isInteger(index) || index < 0) return;
      const item = items[index];
      if (!item) return;
      if (item.element.isConnected) {
        options.onSelect(item.element);
      }
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element;
      items = element ? buildComposedBreadcrumbs(element) : [];
      render();
    }
    function setAnchorRect(rect) {
      if (disposer.isDisposed) return;
      anchorRect = rect;
      updatePosition();
    }
    return {
      setTarget,
      setAnchorRect,
      dispose: () => disposer.dispose()
    };
  }
  function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
  }
  function hasAffix(value) {
    if (value === null || value === void 0) return false;
    return typeof value === "string" ? value.trim().length > 0 : true;
  }
  function joinClassNames(...parts) {
    return parts.filter(isNonEmptyString).join(" ");
  }
  function createInputContainer(options) {
    const {
      ariaLabel,
      type = "text",
      inputMode,
      prefix,
      suffix,
      rootClassName,
      inputClassName,
      autocomplete = "off",
      spellcheck = false,
      placeholder
    } = options;
    const root = document.createElement("div");
    root.className = joinClassNames("we-input-container", rootClassName);
    let prefixEl = null;
    const input = document.createElement("input");
    input.type = type;
    input.className = joinClassNames("we-input-container__input", inputClassName);
    input.setAttribute("autocomplete", autocomplete);
    input.spellcheck = spellcheck;
    input.setAttribute("aria-label", ariaLabel);
    if (inputMode) {
      input.inputMode = inputMode;
    }
    if (placeholder !== void 0) {
      input.placeholder = placeholder;
    }
    let suffixEl = null;
    function updateAffix(kind, content, existingEl) {
      if (!hasAffix(content)) {
        if (existingEl) {
          existingEl.remove();
        }
        return null;
      }
      const el = existingEl != null ? existingEl : document.createElement("span");
      el.className = `we-input-container__${kind}`;
      el.textContent = "";
      if (typeof content === "string") {
        el.textContent = content;
      } else {
        el.append(content);
      }
      return el;
    }
    if (hasAffix(prefix)) {
      prefixEl = updateAffix("prefix", prefix, null);
      if (prefixEl) root.append(prefixEl);
    }
    root.append(input);
    if (hasAffix(suffix)) {
      suffixEl = updateAffix("suffix", suffix, null);
      if (suffixEl) root.append(suffixEl);
    }
    return {
      root,
      input,
      setPrefix(content) {
        const newEl = updateAffix("prefix", content, prefixEl);
        if (newEl && !prefixEl) {
          root.insertBefore(newEl, input);
        }
        prefixEl = newEl;
      },
      setSuffix(content) {
        const newEl = updateAffix("suffix", content, suffixEl);
        if (newEl && !suffixEl) {
          root.append(newEl);
        }
        suffixEl = newEl;
      },
      getSuffixText() {
        var _a2;
        if (!suffixEl) return null;
        const text = (_a2 = suffixEl.textContent) == null ? void 0 : _a2.trim();
        return text || null;
      }
    };
  }
  const LENGTH_KEYWORDS = /* @__PURE__ */ new Set([
    "auto",
    "inherit",
    "initial",
    "unset",
    "none",
    "fit-content",
    "min-content",
    "max-content",
    "revert",
    "revert-layer"
  ]);
  const LENGTH_FUNCTION_REGEX = /\b(?:calc|var|clamp|min|max|fit-content)\s*\(/i;
  const NUMBER_WITH_UNIT_REGEX = /^(-?(?:\d+|\d*\.\d+|\.\d+))\s*([a-zA-Z%]+)$/;
  const PURE_NUMBER_REGEX = /^-?(?:\d+|\d*\.\d+|\.\d+)$/;
  const TRAILING_DOT_NUMBER_REGEX = /^-?\d+\.$/;
  function hasExplicitUnit(raw) {
    var _a2;
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const token = (_a2 = trimmed.split(/\s+/)[0]) != null ? _a2 : "";
    return /^-?(?:\d+|\d*\.\d+)([a-zA-Z%]+)$/.test(token);
  }
  function formatLengthForDisplay(raw) {
    var _a2, _b2;
    const trimmed = raw.trim();
    if (!trimmed) {
      return { value: "", suffix: "px" };
    }
    const lower = trimmed.toLowerCase();
    if (LENGTH_KEYWORDS.has(lower)) {
      return { value: trimmed, suffix: null };
    }
    if (LENGTH_FUNCTION_REGEX.test(trimmed)) {
      return { value: trimmed, suffix: null };
    }
    const unitMatch = trimmed.match(NUMBER_WITH_UNIT_REGEX);
    if (unitMatch) {
      const value = (_a2 = unitMatch[1]) != null ? _a2 : "";
      const suffix = (_b2 = unitMatch[2]) != null ? _b2 : "";
      return { value, suffix: suffix || null };
    }
    if (PURE_NUMBER_REGEX.test(trimmed)) {
      return { value: trimmed, suffix: "px" };
    }
    if (TRAILING_DOT_NUMBER_REGEX.test(trimmed)) {
      return { value: trimmed.slice(0, -1), suffix: "px" };
    }
    return { value: trimmed, suffix: null };
  }
  function combineLengthValue(inputValue, suffix) {
    const trimmed = inputValue.trim();
    if (!trimmed) return "";
    const lower = trimmed.toLowerCase();
    if (LENGTH_KEYWORDS.has(lower)) return trimmed;
    if (LENGTH_FUNCTION_REGEX.test(trimmed)) return trimmed;
    if (NUMBER_WITH_UNIT_REGEX.test(trimmed)) return trimmed;
    if (TRAILING_DOT_NUMBER_REGEX.test(trimmed)) {
      const normalized = trimmed.slice(0, -1);
      return suffix ? `${normalized}${suffix}` : `${normalized}px`;
    }
    if (PURE_NUMBER_REGEX.test(trimmed)) {
      return suffix ? `${trimmed}${suffix}` : `${trimmed}px`;
    }
    return trimmed;
  }
  const DEFAULT_STEP = 1;
  const DEFAULT_SHIFT_STEP = 10;
  const DEFAULT_ALT_STEP = 0.1;
  const DEFAULT_ALLOWED_UNITS = [
    "",
    "px",
    "%",
    "rem",
    "em",
    "vh",
    "vw",
    "vmin",
    "vmax"
  ];
  const MAX_FRACTION_DIGITS = 10;
  function countFractionDigits(raw) {
    const dotIndex = raw.indexOf(".");
    if (dotIndex < 0) return 0;
    return Math.max(0, raw.length - dotIndex - 1);
  }
  function countStepDigits(step) {
    if (!Number.isFinite(step)) return 0;
    const raw = String(step);
    if (raw.includes("e") || raw.includes("E")) return 0;
    return countFractionDigits(raw);
  }
  function clampDigits(digits) {
    if (!Number.isFinite(digits)) return 0;
    return Math.max(0, Math.min(MAX_FRACTION_DIGITS, Math.trunc(digits)));
  }
  function formatNumber(value, digits) {
    const d = clampDigits(digits);
    const fixed = value.toFixed(d);
    if (d === 0) return fixed;
    return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }
  const NUMBER_REGEX = /^(-?(?:(?:\d+\.\d+)|(?:\d+\.)|(?:\d+)|(?:\.\d+)))$/;
  function parseNumberValue(raw) {
    var _a2;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(NUMBER_REGEX);
    if (!match) return null;
    const numRaw = (_a2 = match[1]) != null ? _a2 : "";
    const normalized = numRaw.endsWith(".") ? numRaw.slice(0, -1) : numRaw;
    const value = Number(normalized);
    if (!Number.isFinite(value)) return null;
    return { value, digits: countFractionDigits(normalized) };
  }
  const CSS_LENGTH_REGEX = /^(-?(?:(?:\d+\.\d+)|(?:\d+\.)|(?:\d+)|(?:\.\d+)))\s*([a-zA-Z%]*)$/;
  function parseCssLengthValue(raw, allowedUnits) {
    var _a2, _b2;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(CSS_LENGTH_REGEX);
    if (!match) return null;
    const numRaw = (_a2 = match[1]) != null ? _a2 : "";
    const unit = ((_b2 = match[2]) != null ? _b2 : "").toLowerCase();
    if (!allowedUnits.includes(unit)) return null;
    const normalized = numRaw.endsWith(".") ? numRaw.slice(0, -1) : numRaw;
    const value = Number(normalized);
    if (!Number.isFinite(value)) return null;
    return { value, digits: countFractionDigits(normalized), unit };
  }
  function wireNumberStepping(disposer, input, options) {
    const {
      mode,
      step: baseStep = DEFAULT_STEP,
      shiftStep = DEFAULT_SHIFT_STEP,
      altStep = DEFAULT_ALT_STEP,
      min,
      max,
      integer = false,
      allowedUnits = DEFAULT_ALLOWED_UNITS
    } = options;
    disposer.listen(input, "keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (event.metaKey || event.ctrlKey) return;
      if (input.disabled || input.readOnly) return;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      let delta;
      if (event.altKey) {
        delta = altStep;
      } else if (event.shiftKey) {
        delta = shiftStep;
      } else {
        delta = baseStep;
      }
      if (!Number.isFinite(delta) || delta === 0) return;
      const source = (input.value || input.placeholder || "").trim();
      let parsed = null;
      let unit = "";
      if (mode === "number") {
        parsed = parseNumberValue(source);
        if (!parsed && !source) {
          parsed = { value: 0, digits: 0 };
        }
      } else {
        const cssResult = parseCssLengthValue(source, allowedUnits);
        if (cssResult) {
          parsed = cssResult;
          unit = cssResult.unit;
        } else if (!source) {
          parsed = { value: 0, digits: 0 };
          unit = "";
        }
      }
      if (!parsed) return;
      const digits = integer ? 0 : Math.max(parsed.digits, countStepDigits(delta));
      let next = parsed.value + direction * delta;
      if (typeof min === "number") next = Math.max(min, next);
      if (typeof max === "number") next = Math.min(max, next);
      if (integer) next = Math.round(next);
      const formatted = formatNumber(next, digits);
      const nextRaw = mode === "css-length" ? `${formatted}${unit}` : formatted;
      event.preventDefault();
      input.value = nextRaw;
      try {
        input.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
      }
    });
  }
  const SIZE_MODE_OPTIONS = [
    { value: "fixed", label: "Fixed" },
    { value: "fit", label: "Fit" },
    { value: "fill", label: "Fill" }
  ];
  const FIT_KEYWORDS = ["auto", "fit-content", "max-content", "min-content"];
  function isElementFocused(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$9(element, property) {
    try {
      const style = element.style;
      if (!style || typeof style.getPropertyValue !== "function") return "";
      return style.getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$8(element, property) {
    try {
      const computed = window.getComputedStyle(element);
      return computed.getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function getBoundingRectPx(element, property) {
    try {
      const rect = element.getBoundingClientRect();
      const value = property === "width" ? rect.width : rect.height;
      if (!Number.isFinite(value)) return "0px";
      const rounded = Math.round(value * 100) / 100;
      return `${rounded}px`;
    } catch (e) {
      return "0px";
    }
  }
  function inferSizeMode(value) {
    const trimmed = value.trim().toLowerCase();
    if (!trimmed) return "fixed";
    if (trimmed === "100%") return "fill";
    for (const keyword of FIT_KEYWORDS) {
      if (trimmed === keyword || trimmed.startsWith(`${keyword}(`)) {
        return "fit";
      }
    }
    return "fixed";
  }
  function getFitValue(property, currentValue) {
    var _a2;
    const trimmed = currentValue.trim().toLowerCase();
    for (const keyword of FIT_KEYWORDS) {
      if (trimmed === keyword || trimmed.startsWith(`${keyword}(`)) {
        return currentValue.trim();
      }
    }
    try {
      if (typeof CSS !== "undefined" && ((_a2 = CSS.supports) == null ? void 0 : _a2.call(CSS, property, "fit-content"))) {
        return "fit-content";
      }
    } catch (e) {
    }
    return "auto";
  }
  function createModeSelect(ariaLabel) {
    const select = document.createElement("select");
    select.className = "we-select we-size-mode-select";
    select.setAttribute("aria-label", ariaLabel);
    for (const { value, label } of SIZE_MODE_OPTIONS) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    }
    return select;
  }
  function createSizeControl(options) {
    const { container, transactionManager } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    const root = document.createElement("div");
    root.className = "we-field-group";
    function createSizeField(property, prefix) {
      const column = document.createElement("div");
      column.className = "we-size-field";
      const modeSelect = createModeSelect(`${property} mode`);
      const inputContainer = createInputContainer({
        ariaLabel: property.charAt(0).toUpperCase() + property.slice(1),
        inputMode: "decimal",
        prefix,
        suffix: "px"
      });
      wireNumberStepping(disposer, inputContainer.input, { mode: "css-length" });
      column.append(modeSelect, inputContainer.root);
      return {
        property,
        column,
        modeSelect,
        input: inputContainer.input,
        container: inputContainer,
        lastFixedValue: "",
        handle: null
      };
    }
    const widthField = createSizeField("width", "W");
    const heightField = createSizeField("height", "H");
    const row = document.createElement("div");
    row.className = "we-field-row";
    row.append(widthField.column, heightField.column);
    root.append(row);
    container.append(root);
    disposer.add(() => root.remove());
    const fields = {
      width: widthField,
      height: heightField
    };
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      commitTransaction("width");
      commitTransaction("height");
    }
    function updateInputVisibility(field, mode) {
      field.container.root.hidden = mode !== "fixed";
    }
    function getFixedValueCandidate(field, target) {
      const cached = field.lastFixedValue.trim();
      if (cached && inferSizeMode(cached) === "fixed") {
        return cached;
      }
      const computed = readComputedValue$8(target, field.property);
      if (computed && inferSizeMode(computed) === "fixed") {
        return computed;
      }
      return getBoundingRectPx(target, field.property);
    }
    function syncField(property, force = false) {
      const field = fields[property];
      const target = currentTarget;
      if (!target || !target.isConnected) {
        field.modeSelect.value = "fixed";
        field.modeSelect.disabled = true;
        updateInputVisibility(field, "fixed");
        field.input.value = "";
        field.input.placeholder = "";
        field.input.disabled = true;
        field.container.setSuffix("px");
        return;
      }
      field.modeSelect.disabled = false;
      field.input.disabled = false;
      if (!force) {
        const isEditing = field.handle !== null || isElementFocused(field.input) || isElementFocused(field.modeSelect);
        if (isEditing) return;
      }
      const inlineValue = readInlineValue$9(target, property);
      const displayValue = inlineValue || readComputedValue$8(target, property);
      const mode = inferSizeMode(inlineValue || displayValue);
      field.modeSelect.value = mode;
      updateInputVisibility(field, mode);
      if (mode === "fixed") {
        const candidate = inlineValue || displayValue;
        if (candidate && inferSizeMode(candidate) === "fixed") {
          field.lastFixedValue = candidate;
        }
      }
      if (mode === "fixed") {
        const formatted = formatLengthForDisplay(displayValue);
        field.input.value = formatted.value;
        field.input.placeholder = "";
        field.container.setSuffix(formatted.suffix);
      }
    }
    function syncAllFields() {
      syncField("width");
      syncField("height");
    }
    function wireModeSelect(property) {
      const field = fields[property];
      const select = field.modeSelect;
      const handleModeChange = () => {
        const target = currentTarget;
        if (!target || !target.isConnected) return;
        const mode = select.value;
        const previousMode = inferSizeMode(
          readInlineValue$9(target, property) || readComputedValue$8(target, property)
        );
        if (previousMode === "fixed" && mode !== "fixed") {
          const suffix = field.container.getSuffixText();
          const combined = combineLengthValue(field.input.value, suffix);
          if (combined) field.lastFixedValue = combined;
        }
        updateInputVisibility(field, mode);
        const handle = beginTransaction(property);
        if (!handle) return;
        switch (mode) {
          case "fit": {
            const currentValue = readInlineValue$9(target, property) || readComputedValue$8(target, property);
            handle.set(getFitValue(property, currentValue));
            break;
          }
          case "fill":
            handle.set("100%");
            break;
          case "fixed": {
            const fixedValue = getFixedValueCandidate(field, target);
            field.lastFixedValue = fixedValue;
            handle.set(fixedValue);
            const formatted = formatLengthForDisplay(fixedValue);
            field.input.value = formatted.value;
            field.container.setSuffix(formatted.suffix);
            break;
          }
        }
      };
      disposer.listen(select, "input", handleModeChange);
      disposer.listen(select, "change", handleModeChange);
      disposer.listen(select, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireInput(property) {
      const field = fields[property];
      const input = field.input;
      disposer.listen(input, "input", () => {
        const handle = beginTransaction(property);
        if (!handle) return;
        const suffix = field.container.getSuffixText();
        const combined = combineLengthValue(input.value, suffix);
        handle.set(combined);
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    wireModeSelect("width");
    wireModeSelect("height");
    wireInput("width");
    wireInput("height");
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) {
        commitAllTransactions();
        fields.width.lastFixedValue = "";
        fields.height.lastFixedValue = "";
      }
      currentTarget = element;
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return {
      setTarget,
      refresh,
      dispose
    };
  }
  const SVG_NS$6 = "http://www.w3.org/2000/svg";
  const SPACING_PROPERTIES = [
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left"
  ];
  const EDGE_ICON_PATHS = {
    // Padding icons: horizontal line with vertical segment pointing inward
    "padding-top": "M2 4h11M7.5 4v3.5",
    "padding-right": "M4 2v11M4 7.5h3.5",
    "padding-bottom": "M2 11h11M7.5 11v-3.5",
    "padding-left": "M11 2v11M11 7.5h-3.5",
    // Margin icons: line with segment pointing outward
    "margin-top": "M2 4h11M7.5 4v-3",
    "margin-right": "M11 2v11M11 7.5h3",
    "margin-bottom": "M2 11h11M7.5 11v3",
    "margin-left": "M4 2v11M4 7.5h-3"
  };
  function formatAriaLabel(property) {
    const [box, edge] = property.split("-");
    return `${box.charAt(0).toUpperCase()}${box.slice(1)} ${edge}`;
  }
  function isInputFocused(input) {
    try {
      const rootNode = input.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        return rootNode.activeElement === input;
      }
      return document.activeElement === input;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$8(element, property) {
    try {
      const style = element.style;
      if (!style || typeof style.getPropertyValue !== "function") return "";
      return style.getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$7(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function createEdgeIcon(pathD) {
    const svg = document.createElementNS(SVG_NS$6, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS$6, "path");
    path.setAttribute("d", pathD);
    path.setAttribute("stroke", "currentColor");
    svg.append(path);
    return svg;
  }
  function createSpacingControl(options) {
    const { container, transactionManager } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    function createField(property) {
      const inputContainer = createInputContainer({
        ariaLabel: formatAriaLabel(property),
        inputMode: "decimal",
        prefix: createEdgeIcon(EDGE_ICON_PATHS[property]),
        suffix: "px"
      });
      wireNumberStepping(disposer, inputContainer.input, { mode: "css-length" });
      return {
        property,
        input: inputContainer.input,
        container: inputContainer,
        handle: null
      };
    }
    const fields = /* @__PURE__ */ Object.create(null);
    for (const property of SPACING_PROPERTIES) {
      fields[property] = createField(property);
    }
    function createSection2(title, properties) {
      const section = document.createElement("div");
      section.className = "we-spacing-section";
      const header = document.createElement("div");
      header.className = "we-spacing-header";
      header.textContent = title;
      section.append(header);
      const grid = document.createElement("div");
      grid.className = "we-spacing-grid";
      grid.append(fields[properties[0]].container.root);
      grid.append(fields[properties[1]].container.root);
      grid.append(fields[properties[2]].container.root);
      grid.append(fields[properties[3]].container.root);
      section.append(grid);
      return section;
    }
    const root = document.createElement("div");
    root.className = "we-field-group";
    root.append(
      createSection2("Padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]),
      createSection2("Margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"])
    );
    container.append(root);
    disposer.add(() => root.remove());
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const prop of SPACING_PROPERTIES) {
        commitTransaction(prop);
      }
    }
    function syncField(property, force = false) {
      const field = fields[property];
      const target = currentTarget;
      if (!target || !target.isConnected) {
        field.input.value = "";
        field.input.placeholder = "";
        field.input.disabled = true;
        field.container.setSuffix("px");
        return;
      }
      field.input.disabled = false;
      const isEditing = field.handle !== null || isInputFocused(field.input);
      if (isEditing && !force) return;
      const inlineValue = readInlineValue$8(target, property);
      const displayValue = inlineValue || readComputedValue$7(target, property);
      const formatted = formatLengthForDisplay(displayValue);
      field.input.value = formatted.value;
      field.input.placeholder = "";
      field.container.setSuffix(formatted.suffix);
    }
    function syncAllFields() {
      for (const prop of SPACING_PROPERTIES) {
        syncField(prop);
      }
    }
    function wireField(property) {
      const field = fields[property];
      const input = field.input;
      disposer.listen(input, "input", () => {
        const handle = beginTransaction(property);
        if (!handle) return;
        const suffix = field.container.getSuffixText();
        handle.set(combineLengthValue(input.value, suffix));
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    for (const prop of SPACING_PROPERTIES) {
      wireField(prop);
    }
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  function cloneForDom(node) {
    try {
      return node.cloneNode(true);
    } catch (e) {
      return node;
    }
  }
  function findSelectedIndex(items, value) {
    if (value === null) return -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].value === value) return i;
    }
    return -1;
  }
  function findFirstEnabledIndex(buttons) {
    for (let i = 0; i < buttons.length; i++) {
      if (!buttons[i].disabled) return i;
    }
    return -1;
  }
  function findLastEnabledIndex(buttons) {
    for (let i = buttons.length - 1; i >= 0; i--) {
      if (!buttons[i].disabled) return i;
    }
    return -1;
  }
  function createIconButtonGroup(options) {
    var _a2, _b2, _c, _d;
    const { container, ariaLabel, items, onChange } = options;
    const disposer = new Disposer();
    let isDisabled = Boolean(options.disabled);
    let currentValue = null;
    const root = document.createElement("div");
    root.className = "we-icon-button-group";
    root.setAttribute("role", "radiogroup");
    root.setAttribute("aria-label", ariaLabel);
    const columns = Math.max(1, (_a2 = options.columns) != null ? _a2 : items.length);
    root.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
    container.append(root);
    disposer.add(() => root.remove());
    const buttons = [];
    function syncDisabled() {
      root.setAttribute("aria-disabled", String(isDisabled));
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const item = items[i];
        btn.disabled = isDisabled || Boolean(item.disabled);
      }
    }
    function syncSelection() {
      const selectedIndex = findSelectedIndex(items, currentValue);
      const tabIndex = selectedIndex >= 0 && !buttons[selectedIndex].disabled ? selectedIndex : findFirstEnabledIndex(buttons);
      for (let i = 0; i < buttons.length; i++) {
        const btn = buttons[i];
        const item = items[i];
        const selected = currentValue !== null && item.value === currentValue;
        btn.setAttribute("aria-checked", selected ? "true" : "false");
        btn.dataset.selected = selected ? "true" : "false";
        btn.tabIndex = i === tabIndex ? 0 : -1;
      }
    }
    function setValueInternal(next, emit) {
      const nextIndex = findSelectedIndex(items, next);
      if (next !== null && nextIndex < 0) next = null;
      const changed = next !== currentValue;
      currentValue = next;
      syncSelection();
      if (emit && changed && currentValue !== null) {
        onChange == null ? void 0 : onChange(currentValue);
      }
    }
    function getActiveIndex() {
      const rootNode = root.getRootNode();
      const active = rootNode instanceof ShadowRoot ? rootNode.activeElement : document.activeElement;
      const focusIndex = buttons.findIndex((b) => b === active);
      if (focusIndex >= 0) return focusIndex;
      const selectedIndex = findSelectedIndex(items, currentValue);
      if (selectedIndex >= 0) return selectedIndex;
      const firstEnabled = findFirstEnabledIndex(buttons);
      return firstEnabled >= 0 ? firstEnabled : 0;
    }
    function findEnabledFrom(start, delta) {
      if (delta === 0) return -1;
      for (let i = start; i >= 0 && i < buttons.length; i += delta) {
        if (!buttons[i].disabled) return i;
      }
      return -1;
    }
    function selectByIndex(nextIndex, emit) {
      if (nextIndex < 0 || nextIndex >= items.length) return;
      const btn = buttons[nextIndex];
      if (btn.disabled) return;
      setValueInternal(items[nextIndex].value, emit);
      btn.focus();
    }
    function handleKeyDown(e) {
      if (isDisabled) return;
      if (buttons.length === 0) return;
      const active = getActiveIndex();
      let next = null;
      switch (e.key) {
        case "ArrowLeft":
          next = findEnabledFrom(active - 1, -1);
          break;
        case "ArrowRight":
          next = findEnabledFrom(active + 1, 1);
          break;
        case "ArrowUp":
          next = findEnabledFrom(active - columns, -columns);
          break;
        case "ArrowDown":
          next = findEnabledFrom(active + columns, columns);
          break;
        case "Home":
          next = findFirstEnabledIndex(buttons);
          break;
        case "End":
          next = findLastEnabledIndex(buttons);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          selectByIndex(active, true);
          return;
        default:
          return;
      }
      if (next !== null && next >= 0) {
        e.preventDefault();
        selectByIndex(next, true);
      }
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "we-icon-button-group__btn";
      btn.setAttribute("role", "radio");
      btn.setAttribute("aria-label", item.ariaLabel);
      if (item.title) btn.dataset.tooltip = item.title;
      btn.dataset.value = item.value;
      btn.append(cloneForDom(item.icon));
      disposer.listen(btn, "click", (ev) => {
        ev.preventDefault();
        if (isDisabled || btn.disabled) return;
        setValueInternal(item.value, true);
        btn.focus();
      });
      disposer.listen(btn, "keydown", handleKeyDown);
      buttons.push(btn);
      root.append(btn);
    }
    syncDisabled();
    const initialValue = (_d = (_c = options.value) != null ? _c : (_b2 = items[0]) == null ? void 0 : _b2.value) != null ? _d : null;
    setValueInternal(initialValue, false);
    return {
      root,
      getValue() {
        return currentValue;
      },
      setValue(value) {
        setValueInternal(value, false);
      },
      setDisabled(disabled) {
        isDisabled = disabled;
        syncDisabled();
        syncSelection();
      },
      dispose() {
        disposer.dispose();
      }
    };
  }
  const SVG_NS$5 = "http://www.w3.org/2000/svg";
  const POSITION_VALUES = [
    "static",
    "relative",
    "absolute",
    "fixed",
    "sticky"
  ];
  function createBaseIconSvg$2() {
    const svg = document.createElementNS(SVG_NS$5, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }
  function createIconContainer(svg) {
    const container = document.createElementNS(SVG_NS$5, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    svg.prepend(container);
  }
  function tokenizeTransform(transform) {
    const result2 = [];
    if (!transform || transform === "none") return result2;
    const trimmed = transform.trim();
    let i = 0;
    while (i < trimmed.length) {
      while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
      if (i >= trimmed.length) break;
      const nameStart = i;
      while (i < trimmed.length && /[\w-]/.test(trimmed[i])) i++;
      const name = trimmed.slice(nameStart, i);
      while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
      if (trimmed[i] !== "(") {
        i++;
        continue;
      }
      const argsStart = i + 1;
      let depth = 1;
      i++;
      while (i < trimmed.length && depth > 0) {
        if (trimmed[i] === "(") depth++;
        else if (trimmed[i] === ")") depth--;
        i++;
      }
      const argsEnd = i - 1;
      const args = trimmed.slice(argsStart, argsEnd).trim();
      const original = trimmed.slice(nameStart, i);
      result2.push({
        original,
        name: name.toLowerCase(),
        args
      });
    }
    return result2;
  }
  function parseTransform(transform) {
    const functions = tokenizeTransform(transform);
    let rotateIndex = -1;
    let scaleXIndex = -1;
    let scaleYIndex = -1;
    for (let i = 0; i < functions.length; i++) {
      const fn = functions[i];
      switch (fn.name) {
        case "rotate":
          if (rotateIndex === -1) rotateIndex = i;
          break;
        case "scalex":
          if (scaleXIndex === -1) scaleXIndex = i;
          break;
        case "scaley":
          if (scaleYIndex === -1) scaleYIndex = i;
          break;
      }
    }
    return { functions, rotateIndex, scaleXIndex, scaleYIndex };
  }
  function getRotateValue(state) {
    if (state.rotateIndex < 0) return "";
    return state.functions[state.rotateIndex].args;
  }
  function getScaleXValue(state) {
    if (state.scaleXIndex < 0) return 1;
    const val = parseFloat(state.functions[state.scaleXIndex].args);
    return isNaN(val) ? 1 : val;
  }
  function getScaleYValue(state) {
    if (state.scaleYIndex < 0) return 1;
    const val = parseFloat(state.functions[state.scaleYIndex].args);
    return isNaN(val) ? 1 : val;
  }
  function isFlippedX(state) {
    return getScaleXValue(state) === -1;
  }
  function isFlippedY(state) {
    return getScaleYValue(state) === -1;
  }
  function setRotateValue(state, value) {
    const rotateStr = value.trim();
    if (state.rotateIndex >= 0) {
      if (rotateStr) {
        state.functions[state.rotateIndex] = {
          original: `rotate(${rotateStr})`,
          name: "rotate",
          args: rotateStr
        };
      } else {
        state.functions.splice(state.rotateIndex, 1);
        if (state.scaleXIndex > state.rotateIndex) state.scaleXIndex--;
        if (state.scaleYIndex > state.rotateIndex) state.scaleYIndex--;
        state.rotateIndex = -1;
      }
    } else if (rotateStr) {
      state.rotateIndex = state.functions.length;
      state.functions.push({
        original: `rotate(${rotateStr})`,
        name: "rotate",
        args: rotateStr
      });
    }
  }
  function toggleFlipX(state) {
    const currentVal = getScaleXValue(state);
    if (currentVal === -1) {
      if (state.scaleXIndex >= 0) {
        state.functions.splice(state.scaleXIndex, 1);
        if (state.rotateIndex > state.scaleXIndex) state.rotateIndex--;
        if (state.scaleYIndex > state.scaleXIndex) state.scaleYIndex--;
        state.scaleXIndex = -1;
      }
    } else if (state.scaleXIndex >= 0) {
      state.functions[state.scaleXIndex] = {
        original: "scaleX(-1)",
        name: "scalex",
        args: "-1"
      };
    } else {
      state.scaleXIndex = state.functions.length;
      state.functions.push({
        original: "scaleX(-1)",
        name: "scalex",
        args: "-1"
      });
    }
  }
  function toggleFlipY(state) {
    const currentVal = getScaleYValue(state);
    if (currentVal === -1) {
      if (state.scaleYIndex >= 0) {
        state.functions.splice(state.scaleYIndex, 1);
        if (state.rotateIndex > state.scaleYIndex) state.rotateIndex--;
        if (state.scaleXIndex > state.scaleYIndex) state.scaleXIndex--;
        state.scaleYIndex = -1;
      }
    } else if (state.scaleYIndex >= 0) {
      state.functions[state.scaleYIndex] = {
        original: "scaleY(-1)",
        name: "scaley",
        args: "-1"
      };
    } else {
      state.scaleYIndex = state.functions.length;
      state.functions.push({
        original: "scaleY(-1)",
        name: "scaley",
        args: "-1"
      });
    }
  }
  function composeTransform(state) {
    return state.functions.map((fn) => fn.original).join(" ").trim();
  }
  function extractRotateValue(rotate) {
    if (!rotate) return "";
    const match = rotate.match(/^(-?[\d.]+)/);
    return match ? match[1] : "";
  }
  function extractRotateUnit(rotate) {
    if (!rotate) return "deg";
    const match = rotate.match(/[\d.]+(.*)$/);
    return match && match[1] ? match[1] : "deg";
  }
  function createPositionIcon(position) {
    const svg = createBaseIconSvg$2();
    const addBlock = (x, y, w, h, opacity = 1) => {
      const rect = document.createElementNS(SVG_NS$5, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("rx", "0.5");
      rect.setAttribute("fill", "currentColor");
      if (opacity < 1) rect.setAttribute("opacity", String(opacity));
      svg.append(rect);
    };
    const addLine = (x, y, w) => {
      const line = document.createElementNS(SVG_NS$5, "rect");
      line.setAttribute("x", String(x));
      line.setAttribute("y", String(y));
      line.setAttribute("width", String(w));
      line.setAttribute("height", "1");
      line.setAttribute("rx", "0.5");
      line.setAttribute("fill", "currentColor");
      svg.append(line);
    };
    const addPath = (d, strokeWidth = "1") => {
      const path = document.createElementNS(SVG_NS$5, "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", strokeWidth);
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("fill", "none");
      svg.append(path);
    };
    switch (position) {
      case "static":
        addLine(3.5, 4.5, 8);
        addLine(3.5, 7.5, 8);
        addLine(3.5, 10.5, 8);
        break;
      case "relative": {
        const ghost = document.createElementNS(SVG_NS$5, "rect");
        ghost.setAttribute("x", "3.5");
        ghost.setAttribute("y", "3.5");
        ghost.setAttribute("width", "4");
        ghost.setAttribute("height", "4");
        ghost.setAttribute("rx", "0.5");
        ghost.setAttribute("stroke", "currentColor");
        ghost.setAttribute("stroke-width", "1");
        ghost.setAttribute("stroke-dasharray", "1.5 1");
        ghost.setAttribute("fill", "none");
        ghost.setAttribute("opacity", "0.5");
        svg.append(ghost);
        addBlock(7.5, 7.5, 4, 4);
        addPath("M5.5 7.5L7.5 9.5");
        break;
      }
      case "absolute":
        addPath("M3 5.5H6M8 3V6", "0.8");
        addBlock(6, 6, 5, 5);
        break;
      case "fixed": {
        const pin = document.createElementNS(SVG_NS$5, "circle");
        pin.setAttribute("cx", "7.5");
        pin.setAttribute("cy", "4");
        pin.setAttribute("r", "1.5");
        pin.setAttribute("fill", "currentColor");
        svg.append(pin);
        addPath("M7.5 5.5V8");
        addBlock(4.5, 8, 6, 4);
        break;
      }
      case "sticky": {
        const stickyLine = document.createElementNS(SVG_NS$5, "rect");
        stickyLine.setAttribute("x", "3");
        stickyLine.setAttribute("y", "3");
        stickyLine.setAttribute("width", "9");
        stickyLine.setAttribute("height", "1.5");
        stickyLine.setAttribute("rx", "0.5");
        stickyLine.setAttribute("fill", "currentColor");
        stickyLine.setAttribute("opacity", "0.4");
        svg.append(stickyLine);
        addBlock(4.5, 5, 6, 6);
        break;
      }
    }
    createIconContainer(svg);
    return svg;
  }
  function createRotateIcon() {
    const svg = document.createElementNS(SVG_NS$5, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS$5, "path");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", "M12 7.5a4.5 4.5 0 1 1-1.5-3.4M12 3v3h-3");
    svg.append(path);
    return svg;
  }
  function createFlipXIcon() {
    const svg = createBaseIconSvg$2();
    const leftBlock = document.createElementNS(SVG_NS$5, "rect");
    leftBlock.setAttribute("x", "3.5");
    leftBlock.setAttribute("y", "5");
    leftBlock.setAttribute("width", "3");
    leftBlock.setAttribute("height", "5");
    leftBlock.setAttribute("rx", "0.5");
    leftBlock.setAttribute("fill", "currentColor");
    leftBlock.setAttribute("opacity", "0.4");
    const rightBlock = document.createElementNS(SVG_NS$5, "rect");
    rightBlock.setAttribute("x", "8.5");
    rightBlock.setAttribute("y", "5");
    rightBlock.setAttribute("width", "3");
    rightBlock.setAttribute("height", "5");
    rightBlock.setAttribute("rx", "0.5");
    rightBlock.setAttribute("fill", "currentColor");
    const axis = document.createElementNS(SVG_NS$5, "path");
    axis.setAttribute("d", "M7.5 3V12");
    axis.setAttribute("stroke", "currentColor");
    axis.setAttribute("stroke-width", "1");
    axis.setAttribute("stroke-dasharray", "1.5 1");
    axis.setAttribute("opacity", "0.6");
    svg.append(leftBlock, rightBlock, axis);
    createIconContainer(svg);
    return svg;
  }
  function createFlipYIcon() {
    const svg = createBaseIconSvg$2();
    const topBlock = document.createElementNS(SVG_NS$5, "rect");
    topBlock.setAttribute("x", "5");
    topBlock.setAttribute("y", "3.5");
    topBlock.setAttribute("width", "5");
    topBlock.setAttribute("height", "3");
    topBlock.setAttribute("rx", "0.5");
    topBlock.setAttribute("fill", "currentColor");
    topBlock.setAttribute("opacity", "0.4");
    const bottomBlock = document.createElementNS(SVG_NS$5, "rect");
    bottomBlock.setAttribute("x", "5");
    bottomBlock.setAttribute("y", "8.5");
    bottomBlock.setAttribute("width", "5");
    bottomBlock.setAttribute("height", "3");
    bottomBlock.setAttribute("rx", "0.5");
    bottomBlock.setAttribute("fill", "currentColor");
    const axis = document.createElementNS(SVG_NS$5, "path");
    axis.setAttribute("d", "M3 7.5H12");
    axis.setAttribute("stroke", "currentColor");
    axis.setAttribute("stroke-width", "1");
    axis.setAttribute("stroke-dasharray", "1.5 1");
    axis.setAttribute("opacity", "0.6");
    svg.append(topBlock, bottomBlock, axis);
    createIconContainer(svg);
    return svg;
  }
  function isFieldFocused$6(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        return rootNode.activeElement === el;
      }
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$7(element, property) {
    try {
      const style = element.style;
      if (!style || typeof style.getPropertyValue !== "function") return "";
      return style.getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$6(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function normalizeZIndex(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^-?\d+\.$/.test(trimmed)) return trimmed.slice(0, -1);
    return trimmed;
  }
  function isPositionValue(value) {
    return POSITION_VALUES.includes(value);
  }
  function createPositionControl(options) {
    const { container, transactionManager } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    const root = document.createElement("div");
    root.className = "we-field-group";
    const positionRow = document.createElement("div");
    positionRow.className = "we-field";
    const positionLabel = document.createElement("span");
    positionLabel.className = "we-field-label";
    positionLabel.textContent = "Position";
    const positionMount = document.createElement("div");
    positionMount.className = "we-field-content";
    positionRow.append(positionLabel, positionMount);
    const positionGroup = createIconButtonGroup({
      container: positionMount,
      ariaLabel: "Position type",
      columns: 5,
      items: POSITION_VALUES.map((pos) => ({
        value: pos,
        ariaLabel: pos,
        title: pos,
        icon: createPositionIcon(pos)
      })),
      onChange: (value) => {
        const handle = beginStyleTransaction("position");
        if (handle) handle.set(value);
        commitStyleTransaction("position");
        syncAllFields();
      }
    });
    disposer.add(() => positionGroup.dispose());
    const xyRow = document.createElement("div");
    xyRow.className = "we-field-row";
    const xContainer = createInputContainer({
      ariaLabel: "X (Left)",
      inputMode: "decimal",
      prefix: "X",
      suffix: "px"
    });
    const yContainer = createInputContainer({
      ariaLabel: "Y (Top)",
      inputMode: "decimal",
      prefix: "Y",
      suffix: "px"
    });
    xyRow.append(xContainer.root, yContainer.root);
    wireNumberStepping(disposer, xContainer.input, { mode: "css-length" });
    wireNumberStepping(disposer, yContainer.input, { mode: "css-length" });
    const zRow = document.createElement("div");
    zRow.className = "we-field";
    const zLabel = document.createElement("span");
    zLabel.className = "we-field-label";
    zLabel.textContent = "Z-Index";
    const zContainer = createInputContainer({
      ariaLabel: "Z-Index",
      inputMode: "numeric",
      prefix: "Z",
      suffix: null
    });
    zRow.append(zLabel, zContainer.root);
    wireNumberStepping(disposer, zContainer.input, { mode: "number", integer: true });
    const transformRow = document.createElement("div");
    transformRow.className = "we-field";
    const transformLabel = document.createElement("span");
    transformLabel.className = "we-field-label";
    transformLabel.textContent = "Rotate";
    const transformContent = document.createElement("div");
    transformContent.className = "we-field-content";
    transformContent.style.display = "flex";
    transformContent.style.gap = "4px";
    transformContent.style.alignItems = "center";
    const rotateContainer = createInputContainer({
      ariaLabel: "Rotate",
      inputMode: "decimal",
      prefix: createRotateIcon(),
      suffix: "deg"
    });
    rotateContainer.root.style.flex = "1";
    wireNumberStepping(disposer, rotateContainer.input, { mode: "number", step: 1, shiftStep: 15 });
    const flipXBtn = document.createElement("button");
    flipXBtn.type = "button";
    flipXBtn.className = "we-toggle-btn";
    flipXBtn.setAttribute("aria-label", "Flip horizontal");
    flipXBtn.setAttribute("aria-pressed", "false");
    flipXBtn.dataset.tooltip = "Flip horizontal";
    flipXBtn.append(createFlipXIcon());
    const flipYBtn = document.createElement("button");
    flipYBtn.type = "button";
    flipYBtn.className = "we-toggle-btn";
    flipYBtn.setAttribute("aria-label", "Flip vertical");
    flipYBtn.setAttribute("aria-pressed", "false");
    flipYBtn.dataset.tooltip = "Flip vertical";
    flipYBtn.append(createFlipYIcon());
    transformContent.append(rotateContainer.root, flipXBtn, flipYBtn);
    transformRow.append(transformLabel, transformContent);
    root.append(positionRow, xyRow, zRow, transformRow);
    container.append(root);
    disposer.add(() => root.remove());
    const fields = {
      position: {
        kind: "icon-button-group",
        property: "position",
        group: positionGroup,
        handle: null
      },
      left: {
        kind: "input",
        property: "left",
        input: xContainer.input,
        container: xContainer,
        handle: null
      },
      top: {
        kind: "input",
        property: "top",
        input: yContainer.input,
        container: yContainer,
        handle: null
      },
      "z-index": {
        kind: "input",
        property: "z-index",
        input: zContainer.input,
        container: zContainer,
        handle: null
      },
      transform: {
        kind: "transform",
        rotateInput: rotateContainer.input,
        rotateContainer,
        flipXBtn,
        flipYBtn,
        handle: null,
        cached: { functions: [], rotateIndex: -1, scaleXIndex: -1, scaleYIndex: -1 }
      }
    };
    const STYLE_PROPERTIES = ["position", "left", "top", "z-index"];
    const FIELD_KEYS = ["position", "left", "top", "z-index", "transform"];
    function beginStyleTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.kind === "transform") return null;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitStyleTransaction(property) {
      const field = fields[property];
      if (field.kind === "transform") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackStyleTransaction(property) {
      const field = fields[property];
      if (field.kind === "transform") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function beginTransformTransaction() {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields.transform;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, "transform");
      field.handle = handle;
      const currentTransform = readInlineValue$7(target, "transform") || readComputedValue$6(target, "transform");
      field.cached = parseTransform(currentTransform);
      return handle;
    }
    function commitTransformTransaction() {
      const field = fields.transform;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransformTransaction() {
      const field = fields.transform;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of STYLE_PROPERTIES) commitStyleTransaction(p);
      commitTransformTransaction();
    }
    function syncField(key, force = false) {
      const field = fields[key];
      const target = currentTarget;
      if (field.kind === "icon-button-group") {
        const group = field.group;
        if (!target || !target.isConnected) {
          group.setDisabled(true);
          group.setValue(null);
          return;
        }
        group.setDisabled(false);
        const isEditing = field.handle !== null;
        if (isEditing && !force) return;
        const inline = readInlineValue$7(target, "position");
        const computed = readComputedValue$6(target, "position");
        const raw = (inline || computed).trim();
        group.setValue(isPositionValue(raw) ? raw : "static");
        return;
      }
      if (field.kind === "input") {
        const input = field.input;
        if (!target || !target.isConnected) {
          input.disabled = true;
          input.value = "";
          input.placeholder = "";
          if (field.property === "z-index") {
            field.container.setSuffix(null);
          } else {
            field.container.setSuffix("px");
          }
          return;
        }
        input.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$6(input);
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$7(target, field.property);
        const displayValue = inlineValue || readComputedValue$6(target, field.property);
        if (field.property === "z-index") {
          input.value = displayValue;
          field.container.setSuffix(null);
        } else {
          const formatted = formatLengthForDisplay(displayValue);
          input.value = formatted.value;
          field.container.setSuffix(formatted.suffix);
        }
        input.placeholder = "";
        return;
      }
      if (field.kind === "transform") {
        const { rotateInput, rotateContainer: rotateContainer2, flipXBtn: flipXBtn2, flipYBtn: flipYBtn2 } = field;
        if (!target || !target.isConnected) {
          rotateInput.disabled = true;
          rotateInput.value = "";
          rotateInput.placeholder = "";
          rotateContainer2.setSuffix("deg");
          flipXBtn2.disabled = true;
          flipYBtn2.disabled = true;
          flipXBtn2.setAttribute("aria-pressed", "false");
          flipYBtn2.setAttribute("aria-pressed", "false");
          return;
        }
        rotateInput.disabled = false;
        flipXBtn2.disabled = false;
        flipYBtn2.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$6(rotateInput);
        if (isEditing && !force) return;
        const transformValue = readInlineValue$7(target, "transform") || readComputedValue$6(target, "transform");
        const state = parseTransform(transformValue);
        const rotateArgs = getRotateValue(state);
        const rotateValue = extractRotateValue(rotateArgs);
        const rotateUnit = extractRotateUnit(rotateArgs);
        rotateInput.value = rotateValue;
        rotateContainer2.setSuffix(rotateUnit || "deg");
        flipXBtn2.setAttribute("aria-pressed", isFlippedX(state) ? "true" : "false");
        flipYBtn2.setAttribute("aria-pressed", isFlippedY(state) ? "true" : "false");
      }
    }
    function syncAllFields() {
      for (const key of FIELD_KEYS) syncField(key);
    }
    function wireStyleInput(property) {
      const field = fields[property];
      const input = field.input;
      disposer.listen(input, "input", () => {
        const handle = beginStyleTransaction(property);
        if (!handle) return;
        if (property === "z-index") {
          handle.set(normalizeZIndex(input.value));
        } else {
          const suffix = field.container.getSuffixText();
          handle.set(combineLengthValue(input.value, suffix));
        }
      });
      disposer.listen(input, "blur", () => {
        commitStyleTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitStyleTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackStyleTransaction(property);
          syncField(property, true);
        }
      });
    }
    wireStyleInput("left");
    wireStyleInput("top");
    wireStyleInput("z-index");
    const transformField = fields.transform;
    disposer.listen(transformField.rotateInput, "input", () => {
      const handle = beginTransformTransaction();
      if (!handle) return;
      const value = transformField.rotateInput.value.trim();
      const unit = transformField.rotateContainer.getSuffixText() || "deg";
      const rotateStr = value ? `${value}${unit}` : "";
      setRotateValue(transformField.cached, rotateStr);
      handle.set(composeTransform(transformField.cached));
    });
    disposer.listen(transformField.rotateInput, "blur", () => {
      commitTransformTransaction();
      syncAllFields();
    });
    disposer.listen(transformField.rotateInput, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitTransformTransaction();
        syncAllFields();
        transformField.rotateInput.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        rollbackTransformTransaction();
        syncField("transform", true);
      }
    });
    disposer.listen(transformField.flipXBtn, "click", (e) => {
      e.preventDefault();
      const handle = beginTransformTransaction();
      if (!handle) return;
      toggleFlipX(transformField.cached);
      handle.set(composeTransform(transformField.cached));
      commitTransformTransaction();
      syncAllFields();
    });
    disposer.listen(transformField.flipYBtn, "click", (e) => {
      e.preventDefault();
      const handle = beginTransformTransaction();
      if (!handle) return;
      toggleFlipY(transformField.cached);
      handle.set(composeTransform(transformField.cached));
      commitTransformTransaction();
      syncAllFields();
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) {
        commitAllTransactions();
      }
      currentTarget = element;
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  const SVG_NS$4 = "http://www.w3.org/2000/svg";
  const DISPLAY_VALUES = ["block", "inline", "inline-block", "flex", "grid", "none"];
  const FLEX_DIRECTION_VALUES = ["row", "column", "row-reverse", "column-reverse"];
  const FLEX_WRAP_VALUES = ["nowrap", "wrap", "wrap-reverse"];
  const ALIGNMENT_AXIS_VALUES = ["flex-start", "center", "flex-end"];
  const GRID_DIMENSION_MAX = 12;
  function isFieldFocused$5(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$6(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$5(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function isDisplayValue(value) {
    return DISPLAY_VALUES.includes(value);
  }
  function isFlexDirectionValue(value) {
    return FLEX_DIRECTION_VALUES.includes(value);
  }
  function isAlignmentAxisValue(value) {
    return ALIGNMENT_AXIS_VALUES.includes(value);
  }
  function normalizeDisplayValue(computed) {
    const trimmed = computed.trim();
    if (trimmed === "inline-flex") return "flex";
    if (trimmed === "inline-grid") return "grid";
    return trimmed;
  }
  function clampInt(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, Math.trunc(value)));
  }
  function splitTopLevelTokens(value) {
    const tokens = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "(") depth++;
      if (ch === ")" && depth > 0) depth--;
      if (depth === 0 && /\s/.test(ch)) {
        const t = current.trim();
        if (t) tokens.push(t);
        current = "";
        continue;
      }
      current += ch;
    }
    const tail = current.trim();
    if (tail) tokens.push(tail);
    return tokens;
  }
  function parseRepeatCount(token) {
    const match = token.match(/^repeat\(\s*(\d+)\s*,/i);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  function countGridTracks(raw) {
    var _a2;
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "none") return null;
    const tokens = splitTopLevelTokens(trimmed);
    let count = 0;
    for (const t of tokens) {
      if (/^\[.*\]$/.test(t)) continue;
      count += (_a2 = parseRepeatCount(t)) != null ? _a2 : 1;
    }
    return count > 0 ? count : null;
  }
  function formatGridTemplate(count) {
    const n = clampInt(count, 1, GRID_DIMENSION_MAX);
    return n === 1 ? "1fr" : `repeat(${n}, 1fr)`;
  }
  function createBaseIconSvg$1() {
    const svg = document.createElementNS(SVG_NS$4, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }
  function applyStroke(el, strokeWidth = "1.2") {
    el.setAttribute("stroke", "currentColor");
    el.setAttribute("stroke-width", strokeWidth);
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
  }
  function createDisplayIcon(value) {
    const svg = createBaseIconSvg$1();
    const container = document.createElementNS(SVG_NS$4, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    const addBlock = (x, y, w, h) => {
      const rect = document.createElementNS(SVG_NS$4, "rect");
      rect.setAttribute("x", String(x));
      rect.setAttribute("y", String(y));
      rect.setAttribute("width", String(w));
      rect.setAttribute("height", String(h));
      rect.setAttribute("rx", "0.5");
      rect.setAttribute("fill", "currentColor");
      svg.append(rect);
    };
    const addLine = (x, y, w) => {
      const line = document.createElementNS(SVG_NS$4, "rect");
      line.setAttribute("x", String(x));
      line.setAttribute("y", String(y));
      line.setAttribute("width", String(w));
      line.setAttribute("height", "1");
      line.setAttribute("rx", "0.5");
      line.setAttribute("fill", "currentColor");
      svg.append(line);
    };
    switch (value) {
      case "block":
        addBlock(3.5, 3.5, 8, 3);
        addBlock(3.5, 8.5, 8, 3);
        break;
      case "inline":
        addLine(3.5, 4.5, 8);
        addLine(3.5, 7.5, 5);
        addLine(3.5, 10.5, 6.5);
        break;
      case "inline-block":
        addBlock(3.5, 4.5, 3.5, 6);
        addLine(8, 5.5, 4);
        addLine(8, 8.5, 3);
        break;
      case "flex":
        addBlock(3.5, 4.5, 2.5, 6);
        addBlock(6.5, 4.5, 2.5, 6);
        addBlock(9.5, 4.5, 2.5, 6);
        break;
      case "grid":
        addBlock(3.5, 3.5, 3.5, 3.5);
        addBlock(8, 3.5, 3.5, 3.5);
        addBlock(3.5, 8, 3.5, 3.5);
        addBlock(8, 8, 3.5, 3.5);
        break;
      case "none": {
        const slash = document.createElementNS(SVG_NS$4, "path");
        slash.setAttribute("d", "M4 11L11 4");
        slash.setAttribute("stroke", "currentColor");
        slash.setAttribute("stroke-width", "1.5");
        slash.setAttribute("stroke-linecap", "round");
        svg.append(slash);
        break;
      }
    }
    svg.prepend(container);
    return svg;
  }
  function createFlowIcon(direction) {
    const svg = createBaseIconSvg$1();
    const path = document.createElementNS(SVG_NS$4, "path");
    applyStroke(path, "1.5");
    const DIRECTION_PATHS = {
      row: "M2 7.5H13M10 4.5L13 7.5L10 10.5",
      "row-reverse": "M13 7.5H2M5 4.5L2 7.5L5 10.5",
      column: "M7.5 2V13M4.5 10L7.5 13L10.5 10",
      "column-reverse": "M7.5 13V2M4.5 5L7.5 2L10.5 5"
    };
    path.setAttribute("d", DIRECTION_PATHS[direction]);
    svg.append(path);
    return svg;
  }
  function createHorizontalAlignIcon(value) {
    const svg = createBaseIconSvg$1();
    const container = document.createElementNS(SVG_NS$4, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    const blockX = {
      "flex-start": 3.5,
      // 左对齐
      center: 5.5,
      // 居中对齐
      "flex-end": 7.5
      // 右对齐
    };
    const block1 = document.createElementNS(SVG_NS$4, "rect");
    block1.setAttribute("x", String(blockX[value]));
    block1.setAttribute("y", "4");
    block1.setAttribute("width", "4");
    block1.setAttribute("height", "3");
    block1.setAttribute("rx", "0.5");
    block1.setAttribute("fill", "currentColor");
    const block2 = document.createElementNS(SVG_NS$4, "rect");
    block2.setAttribute("x", String(blockX[value]));
    block2.setAttribute("y", "8");
    block2.setAttribute("width", "4");
    block2.setAttribute("height", "3");
    block2.setAttribute("rx", "0.5");
    block2.setAttribute("fill", "currentColor");
    svg.append(container, block1, block2);
    return svg;
  }
  function createVerticalAlignIcon$1(value) {
    const svg = createBaseIconSvg$1();
    const container = document.createElementNS(SVG_NS$4, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    const blockY = {
      "flex-start": 3.5,
      // 顶部对齐
      center: 5.5,
      // 居中对齐
      "flex-end": 7.5
      // 底部对齐
    };
    const block1 = document.createElementNS(SVG_NS$4, "rect");
    block1.setAttribute("x", "4");
    block1.setAttribute("y", String(blockY[value]));
    block1.setAttribute("width", "3");
    block1.setAttribute("height", "4");
    block1.setAttribute("rx", "0.5");
    block1.setAttribute("fill", "currentColor");
    const block2 = document.createElementNS(SVG_NS$4, "rect");
    block2.setAttribute("x", "8");
    block2.setAttribute("y", String(blockY[value]));
    block2.setAttribute("width", "3");
    block2.setAttribute("height", "4");
    block2.setAttribute("rx", "0.5");
    block2.setAttribute("fill", "currentColor");
    svg.append(container, block1, block2);
    return svg;
  }
  function createGridColumnsIcon() {
    const svg = createBaseIconSvg$1();
    const r1 = document.createElementNS(SVG_NS$4, "rect");
    r1.setAttribute("x", "3");
    r1.setAttribute("y", "4");
    r1.setAttribute("width", "3.5");
    r1.setAttribute("height", "7");
    r1.setAttribute("rx", "1");
    applyStroke(r1);
    const r2 = document.createElementNS(SVG_NS$4, "rect");
    r2.setAttribute("x", "8.5");
    r2.setAttribute("y", "4");
    r2.setAttribute("width", "3.5");
    r2.setAttribute("height", "7");
    r2.setAttribute("rx", "1");
    applyStroke(r2);
    svg.append(r1, r2);
    return svg;
  }
  function createGridRowsIcon() {
    const svg = createBaseIconSvg$1();
    const r1 = document.createElementNS(SVG_NS$4, "rect");
    r1.setAttribute("x", "4");
    r1.setAttribute("y", "3");
    r1.setAttribute("width", "7");
    r1.setAttribute("height", "3.5");
    r1.setAttribute("rx", "1");
    applyStroke(r1);
    const r2 = document.createElementNS(SVG_NS$4, "rect");
    r2.setAttribute("x", "4");
    r2.setAttribute("y", "8.5");
    r2.setAttribute("width", "7");
    r2.setAttribute("height", "3.5");
    r2.setAttribute("rx", "1");
    applyStroke(r2);
    svg.append(r1, r2);
    return svg;
  }
  function createLayoutControl(options) {
    const { container, transactionManager } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    const root = document.createElement("div");
    root.className = "we-field-group";
    const displayRow = document.createElement("div");
    displayRow.className = "we-field";
    const displayLabel = document.createElement("span");
    displayLabel.className = "we-field-label";
    displayLabel.textContent = "Display";
    const displayMount = document.createElement("div");
    displayMount.className = "we-field-content";
    displayRow.append(displayLabel, displayMount);
    const displayGroup = createIconButtonGroup({
      container: displayMount,
      ariaLabel: "Display",
      columns: 6,
      items: DISPLAY_VALUES.map((v) => ({
        value: v,
        ariaLabel: v,
        title: v,
        icon: createDisplayIcon(v)
      })),
      onChange: (value) => {
        const handle = beginTransaction("display");
        if (handle) handle.set(value);
        commitTransaction("display");
        syncAllFields();
      }
    });
    disposer.add(() => displayGroup.dispose());
    const directionRow = document.createElement("div");
    directionRow.className = "we-field";
    const directionLabel = document.createElement("span");
    directionLabel.className = "we-field-label";
    directionLabel.textContent = "Flow";
    const directionMount = document.createElement("div");
    directionMount.className = "we-field-content";
    directionRow.append(directionLabel, directionMount);
    const directionGroup = createIconButtonGroup({
      container: directionMount,
      ariaLabel: "Flex direction",
      columns: 4,
      items: FLEX_DIRECTION_VALUES.map((dir) => ({
        value: dir,
        ariaLabel: dir.replace("-", " "),
        title: dir.replace("-", " "),
        icon: createFlowIcon(dir)
      })),
      onChange: (value) => {
        const handle = beginTransaction("flex-direction");
        if (handle) handle.set(value);
        commitTransaction("flex-direction");
        syncAllFields();
      }
    });
    disposer.add(() => directionGroup.dispose());
    directionGroup.setValue(null);
    const wrapRow = document.createElement("div");
    wrapRow.className = "we-field";
    const wrapLabel = document.createElement("span");
    wrapLabel.className = "we-field-label";
    wrapLabel.textContent = "Wrap";
    const wrapSelect = document.createElement("select");
    wrapSelect.className = "we-select";
    wrapSelect.setAttribute("aria-label", "flex-wrap");
    for (const v of FLEX_WRAP_VALUES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      wrapSelect.append(opt);
    }
    wrapRow.append(wrapLabel, wrapSelect);
    const alignmentRow = document.createElement("div");
    alignmentRow.className = "we-field";
    const alignmentLabel = document.createElement("span");
    alignmentLabel.className = "we-field-label";
    alignmentLabel.textContent = "Align";
    const alignmentMount = document.createElement("div");
    alignmentMount.className = "we-field-content";
    alignmentMount.style.display = "flex";
    alignmentMount.style.gap = "4px";
    alignmentRow.append(alignmentLabel, alignmentMount);
    const justifyWrapper = document.createElement("div");
    justifyWrapper.style.flex = "1";
    justifyWrapper.style.minWidth = "0";
    justifyWrapper.style.display = "flex";
    justifyWrapper.style.flexDirection = "column";
    justifyWrapper.style.gap = "2px";
    const justifyHint = document.createElement("span");
    justifyHint.className = "we-field-hint";
    justifyHint.textContent = "H";
    const justifyMount = document.createElement("div");
    justifyWrapper.append(justifyHint, justifyMount);
    const alignWrapper = document.createElement("div");
    alignWrapper.style.flex = "1";
    alignWrapper.style.minWidth = "0";
    alignWrapper.style.display = "flex";
    alignWrapper.style.flexDirection = "column";
    alignWrapper.style.gap = "2px";
    const alignHint = document.createElement("span");
    alignHint.className = "we-field-hint";
    alignHint.textContent = "V";
    const alignMount = document.createElement("div");
    alignWrapper.append(alignHint, alignMount);
    alignmentMount.append(justifyWrapper, alignWrapper);
    const justifyGroup = createIconButtonGroup({
      container: justifyMount,
      ariaLabel: "Justify content",
      columns: 3,
      items: ALIGNMENT_AXIS_VALUES.map((v) => ({
        value: v,
        ariaLabel: `justify-content: ${v}`,
        title: v,
        icon: createHorizontalAlignIcon(v)
      })),
      onChange: (justifyContent) => {
        var _a2;
        const handle = beginAlignmentTransaction();
        if (!handle) return;
        const alignItems = (_a2 = alignGroup.getValue()) != null ? _a2 : "center";
        handle.set({ "justify-content": justifyContent, "align-items": alignItems });
        commitAlignmentTransaction();
        syncAllFields();
      }
    });
    const alignGroup = createIconButtonGroup({
      container: alignMount,
      ariaLabel: "Align items",
      columns: 3,
      items: ALIGNMENT_AXIS_VALUES.map((v) => ({
        value: v,
        ariaLabel: `align-items: ${v}`,
        title: v,
        icon: createVerticalAlignIcon$1(v)
      })),
      onChange: (alignItems) => {
        var _a2;
        const handle = beginAlignmentTransaction();
        if (!handle) return;
        const justifyContent = (_a2 = justifyGroup.getValue()) != null ? _a2 : "center";
        handle.set({ "justify-content": justifyContent, "align-items": alignItems });
        commitAlignmentTransaction();
        syncAllFields();
      }
    });
    disposer.add(() => justifyGroup.dispose());
    disposer.add(() => alignGroup.dispose());
    justifyGroup.setValue(null);
    alignGroup.setValue(null);
    const gridRow = document.createElement("div");
    gridRow.className = "we-field";
    const gridLabel = document.createElement("span");
    gridLabel.className = "we-field-label";
    gridLabel.textContent = "Grid";
    const gridMount = document.createElement("div");
    gridMount.className = "we-field-content";
    gridMount.style.position = "relative";
    gridRow.append(gridLabel, gridMount);
    const gridPreviewButton = document.createElement("button");
    gridPreviewButton.type = "button";
    gridPreviewButton.className = "we-grid-dimensions-preview";
    gridPreviewButton.setAttribute("aria-label", "Grid dimensions");
    gridPreviewButton.setAttribute("aria-expanded", "false");
    gridPreviewButton.setAttribute("aria-haspopup", "dialog");
    const gridPreviewColsValue = document.createElement("span");
    gridPreviewColsValue.textContent = "1";
    const gridPreviewTimes = document.createElement("span");
    gridPreviewTimes.textContent = " × ";
    const gridPreviewRowsValue = document.createElement("span");
    gridPreviewRowsValue.textContent = "1";
    gridPreviewButton.append(gridPreviewColsValue, gridPreviewTimes, gridPreviewRowsValue);
    const gridPopover = document.createElement("div");
    gridPopover.className = "we-grid-dimensions-popover";
    gridPopover.hidden = true;
    const gridInputs = document.createElement("div");
    gridInputs.className = "we-grid-dimensions-inputs";
    const colsContainer = createInputContainer({
      ariaLabel: "Grid columns",
      inputMode: "numeric",
      prefix: createGridColumnsIcon(),
      suffix: null
    });
    colsContainer.root.style.width = "72px";
    colsContainer.root.style.flex = "0 0 auto";
    const times = document.createElement("span");
    times.className = "we-grid-dimensions-times";
    times.textContent = "×";
    const rowsContainer = createInputContainer({
      ariaLabel: "Grid rows",
      inputMode: "numeric",
      prefix: createGridRowsIcon(),
      suffix: null
    });
    rowsContainer.root.style.width = "72px";
    rowsContainer.root.style.flex = "0 0 auto";
    gridInputs.append(colsContainer.root, times, rowsContainer.root);
    const matrix = document.createElement("div");
    matrix.className = "we-grid-dimensions-matrix";
    matrix.setAttribute("role", "grid");
    const cells = [];
    for (let r = 1; r <= GRID_DIMENSION_MAX; r++) {
      for (let c = 1; c <= GRID_DIMENSION_MAX; c++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "we-grid-dimensions-cell";
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-label", `${c} × ${r}`);
        cells.push(cell);
        matrix.append(cell);
      }
    }
    const tooltip = document.createElement("div");
    tooltip.className = "we-grid-dimensions-tooltip";
    tooltip.hidden = true;
    gridPopover.append(gridInputs, matrix, tooltip);
    gridMount.append(gridPreviewButton, gridPopover);
    wireNumberStepping(disposer, colsContainer.input, {
      mode: "number",
      integer: true,
      min: 1,
      max: GRID_DIMENSION_MAX
    });
    wireNumberStepping(disposer, rowsContainer.input, {
      mode: "number",
      integer: true,
      min: 1,
      max: GRID_DIMENSION_MAX
    });
    const gapRow = document.createElement("div");
    gapRow.className = "we-field";
    const gapLabel = document.createElement("span");
    gapLabel.className = "we-field-label";
    gapLabel.textContent = "Gap";
    const gapMount = document.createElement("div");
    gapMount.className = "we-field-content";
    const gapInputs = document.createElement("div");
    gapInputs.className = "we-grid-gap-inputs";
    const rowGapContainer = createInputContainer({
      ariaLabel: "Row gap",
      inputMode: "decimal",
      prefix: createGridRowsIcon(),
      suffix: "px"
    });
    const columnGapContainer = createInputContainer({
      ariaLabel: "Column gap",
      inputMode: "decimal",
      prefix: createGridColumnsIcon(),
      suffix: "px"
    });
    gapInputs.append(rowGapContainer.root, columnGapContainer.root);
    gapMount.append(gapInputs);
    gapRow.append(gapLabel, gapMount);
    wireNumberStepping(disposer, rowGapContainer.input, { mode: "css-length" });
    wireNumberStepping(disposer, columnGapContainer.input, { mode: "css-length" });
    const gridGapRow = document.createElement("div");
    gridGapRow.className = "we-grid-gap-row";
    gridGapRow.hidden = true;
    gridRow.classList.add("we-grid-gap-col", "we-grid-gap-col--grid");
    gapRow.classList.add("we-grid-gap-col", "we-grid-gap-col--gap");
    gridGapRow.append(gridRow, gapRow);
    root.append(displayRow, directionRow, wrapRow, alignmentRow, gridGapRow);
    container.append(root);
    disposer.add(() => root.remove());
    const fields = {
      display: {
        kind: "display-group",
        property: "display",
        group: displayGroup,
        handle: null,
        row: displayRow
      },
      "flex-direction": {
        kind: "flex-direction-group",
        property: "flex-direction",
        group: directionGroup,
        handle: null,
        row: directionRow
      },
      "flex-wrap": {
        kind: "select",
        property: "flex-wrap",
        element: wrapSelect,
        handle: null,
        row: wrapRow
      },
      alignment: {
        kind: "flex-alignment",
        properties: ["justify-content", "align-items"],
        justifyGroup,
        alignGroup,
        handle: null,
        row: alignmentRow
      },
      "grid-dimensions": {
        kind: "grid-dimensions",
        properties: ["grid-template-columns", "grid-template-rows"],
        previewButton: gridPreviewButton,
        previewColsValue: gridPreviewColsValue,
        previewRowsValue: gridPreviewRowsValue,
        popover: gridPopover,
        colsContainer,
        rowsContainer,
        matrix,
        tooltip,
        cells,
        handle: null,
        row: gridRow
      },
      "row-gap": {
        kind: "input",
        property: "row-gap",
        element: rowGapContainer.input,
        container: rowGapContainer,
        handle: null,
        row: gapRow
      },
      "column-gap": {
        kind: "input",
        property: "column-gap",
        element: columnGapContainer.input,
        container: columnGapContainer,
        handle: null,
        row: gapRow
      }
    };
    const STYLE_PROPS = [
      "display",
      "flex-direction",
      "flex-wrap",
      "row-gap",
      "column-gap"
    ];
    const FIELD_KEYS = [
      "display",
      "flex-direction",
      "flex-wrap",
      "alignment",
      "grid-dimensions",
      "row-gap",
      "column-gap"
    ];
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.kind === "flex-alignment" || field.kind === "grid-dimensions") return null;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      if (field.kind === "flex-alignment" || field.kind === "grid-dimensions") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      if (field.kind === "flex-alignment" || field.kind === "grid-dimensions") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function beginAlignmentTransaction() {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields.alignment;
      if (field.kind !== "flex-alignment") return null;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginMultiStyle(target, [...field.properties]);
      field.handle = handle;
      return handle;
    }
    function commitAlignmentTransaction() {
      const field = fields.alignment;
      if (field.kind !== "flex-alignment") return;
      const handle = field.handle;
      field.handle = null;
      handle == null ? void 0 : handle.commit({ merge: true });
    }
    function beginGridTransaction() {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields["grid-dimensions"];
      if (field.kind !== "grid-dimensions") return null;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginMultiStyle(target, [...field.properties]);
      field.handle = handle;
      return handle;
    }
    function commitGridTransaction() {
      const field = fields["grid-dimensions"];
      if (field.kind !== "grid-dimensions") return;
      const handle = field.handle;
      field.handle = null;
      handle == null ? void 0 : handle.commit({ merge: true });
    }
    function rollbackGridTransaction() {
      const field = fields["grid-dimensions"];
      if (field.kind !== "grid-dimensions") return;
      const handle = field.handle;
      field.handle = null;
      handle == null ? void 0 : handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of STYLE_PROPS) commitTransaction(p);
      commitAlignmentTransaction();
      commitGridTransaction();
    }
    function updateVisibility() {
      var _a2;
      const target = currentTarget;
      const rawDisplay = target ? readInlineValue$6(target, "display") || readComputedValue$5(target, "display") : (_a2 = displayGroup.getValue()) != null ? _a2 : "block";
      const displayValue = normalizeDisplayValue(rawDisplay);
      const trimmed = displayValue.trim();
      const isFlex = trimmed === "flex" || trimmed === "inline-flex";
      const isGrid = trimmed === "grid" || trimmed === "inline-grid";
      const isFlexOrGrid = isFlex || isGrid;
      directionRow.hidden = !isFlex;
      wrapRow.hidden = !isFlex;
      alignmentRow.hidden = !isFlex;
      gridGapRow.hidden = !isFlexOrGrid;
      gridRow.hidden = !isGrid;
      gapRow.hidden = !isFlexOrGrid;
    }
    function syncField(key, force = false) {
      var _a2, _b2, _c, _d, _e, _f;
      const field = fields[key];
      const target = currentTarget;
      if (field.kind === "display-group") {
        const group = field.group;
        if (!target || !target.isConnected) {
          group.setDisabled(true);
          group.setValue(null);
          return;
        }
        group.setDisabled(false);
        const isEditing = field.handle !== null;
        if (isEditing && !force) return;
        const inline = readInlineValue$6(target, "display");
        const computed = readComputedValue$5(target, "display");
        let raw = (inline || computed).trim();
        raw = normalizeDisplayValue(raw);
        group.setValue(isDisplayValue(raw) ? raw : "block");
        return;
      }
      if (field.kind === "flex-direction-group") {
        const group = field.group;
        if (!target || !target.isConnected) {
          group.setDisabled(true);
          group.setValue(null);
          return;
        }
        group.setDisabled(false);
        const isEditing = field.handle !== null;
        if (isEditing && !force) return;
        const inline = readInlineValue$6(target, "flex-direction");
        const computed = readComputedValue$5(target, "flex-direction");
        const raw = (inline || computed).trim();
        group.setValue(isFlexDirectionValue(raw) ? raw : null);
        return;
      }
      if (field.kind === "flex-alignment") {
        if (!target || !target.isConnected) {
          field.justifyGroup.setDisabled(true);
          field.alignGroup.setDisabled(true);
          field.justifyGroup.setValue(null);
          field.alignGroup.setValue(null);
          return;
        }
        field.justifyGroup.setDisabled(false);
        field.alignGroup.setDisabled(false);
        const isEditing = field.handle !== null;
        if (isEditing && !force) return;
        const justifyInline = readInlineValue$6(target, "justify-content");
        const justifyComputed = readComputedValue$5(target, "justify-content");
        const alignInline = readInlineValue$6(target, "align-items");
        const alignComputed = readComputedValue$5(target, "align-items");
        const justifyRaw = (justifyInline || justifyComputed).trim();
        const alignRaw = (alignInline || alignComputed).trim();
        if (isAlignmentAxisValue(justifyRaw) && isAlignmentAxisValue(alignRaw)) {
          field.justifyGroup.setValue(justifyRaw);
          field.alignGroup.setValue(alignRaw);
        } else {
          field.justifyGroup.setValue(null);
          field.alignGroup.setValue(null);
        }
        return;
      }
      if (field.kind === "grid-dimensions") {
        const {
          previewButton,
          popover,
          colsContainer: colsContainer2,
          rowsContainer: rowsContainer2,
          tooltip: tooltip2,
          cells: gridCells
        } = field;
        if (!target || !target.isConnected) {
          previewButton.disabled = true;
          field.previewColsValue.textContent = "—";
          field.previewRowsValue.textContent = "—";
          previewButton.setAttribute("aria-expanded", "false");
          popover.hidden = true;
          colsContainer2.input.disabled = true;
          rowsContainer2.input.disabled = true;
          tooltip2.hidden = true;
          for (const cell of gridCells) {
            cell.dataset.active = "false";
            cell.dataset.selected = "false";
          }
          return;
        }
        previewButton.disabled = false;
        colsContainer2.input.disabled = false;
        rowsContainer2.input.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$5(colsContainer2.input) || isFieldFocused$5(rowsContainer2.input);
        if (isEditing && !force) return;
        const colsRaw = readInlineValue$6(target, "grid-template-columns") || readComputedValue$5(target, "grid-template-columns");
        const rowsRaw = readInlineValue$6(target, "grid-template-rows") || readComputedValue$5(target, "grid-template-rows");
        const cols = clampInt((_a2 = countGridTracks(colsRaw)) != null ? _a2 : 1, 1, GRID_DIMENSION_MAX);
        const rows = clampInt((_b2 = countGridTracks(rowsRaw)) != null ? _b2 : 1, 1, GRID_DIMENSION_MAX);
        colsContainer2.input.value = String(cols);
        rowsContainer2.input.value = String(rows);
        field.previewColsValue.textContent = String(cols);
        field.previewRowsValue.textContent = String(rows);
        previewButton.setAttribute("aria-label", `Grid: ${cols} columns, ${rows} rows`);
        tooltip2.hidden = true;
        for (const cell of gridCells) {
          const c = parseInt((_c = cell.dataset.col) != null ? _c : "0", 10);
          const r = parseInt((_d = cell.dataset.row) != null ? _d : "0", 10);
          const selected = c > 0 && r > 0 && c <= cols && r <= rows;
          cell.dataset.selected = selected ? "true" : "false";
          cell.dataset.active = selected ? "true" : "false";
        }
        return;
      }
      if (field.kind === "input") {
        const input = field.element;
        if (!target || !target.isConnected) {
          input.disabled = true;
          input.value = "";
          input.placeholder = "";
          field.container.setSuffix("px");
          return;
        }
        input.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$5(input);
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$6(target, field.property);
        const displayValue = inlineValue || readComputedValue$5(target, field.property);
        const formatted = formatLengthForDisplay(displayValue);
        input.value = formatted.value;
        field.container.setSuffix(formatted.suffix);
        input.placeholder = "";
        return;
      }
      if (field.kind === "select") {
        const select = field.element;
        if (!target || !target.isConnected) {
          select.disabled = true;
          return;
        }
        select.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$5(select);
        if (isEditing && !force) return;
        const inline = readInlineValue$6(target, field.property);
        const computed = readComputedValue$5(target, field.property);
        const val = inline || computed;
        const hasOption = Array.from(select.options).some((o) => o.value === val);
        select.value = hasOption ? val : (_f = (_e = select.options[0]) == null ? void 0 : _e.value) != null ? _f : "";
      }
    }
    function syncAllFields() {
      for (const key of FIELD_KEYS) syncField(key);
      updateVisibility();
    }
    function wireSelect(property) {
      const field = fields[property];
      if (field.kind !== "select") return;
      const select = field.element;
      const preview = () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(select.value);
      };
      disposer.listen(select, "input", preview);
      disposer.listen(select, "change", preview);
      disposer.listen(select, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireInput(property) {
      const field = fields[property];
      if (field.kind !== "input") return;
      const input = field.element;
      disposer.listen(input, "input", () => {
        const handle = beginTransaction(property);
        if (!handle) return;
        const suffix = field.container.getSuffixText();
        handle.set(combineLengthValue(input.value, suffix));
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    wireSelect("flex-wrap");
    wireInput("row-gap");
    wireInput("column-gap");
    let gridHoverCols = null;
    let gridHoverRows = null;
    function renderGridSelection(field, cols, rows) {
      var _a2, _b2;
      const activeCols = gridHoverCols != null ? gridHoverCols : cols;
      const activeRows = gridHoverRows != null ? gridHoverRows : rows;
      for (const cell of field.cells) {
        const c = parseInt((_a2 = cell.dataset.col) != null ? _a2 : "0", 10);
        const r = parseInt((_b2 = cell.dataset.row) != null ? _b2 : "0", 10);
        const selected = c > 0 && r > 0 && c <= cols && r <= rows;
        const active = c > 0 && r > 0 && c <= activeCols && r <= activeRows;
        cell.dataset.selected = selected ? "true" : "false";
        cell.dataset.active = active ? "true" : "false";
      }
      if (gridHoverCols !== null && gridHoverRows !== null) {
        field.tooltip.textContent = `${gridHoverCols} × ${gridHoverRows}`;
        field.tooltip.hidden = false;
      } else {
        field.tooltip.hidden = true;
      }
    }
    function setGridPopoverOpen(field, open) {
      field.popover.hidden = !open;
      field.previewButton.setAttribute("aria-expanded", open ? "true" : "false");
      gridHoverCols = null;
      gridHoverRows = null;
      const cols = clampInt(
        parseInt(field.colsContainer.input.value || "1", 10) || 1,
        1,
        GRID_DIMENSION_MAX
      );
      const rows = clampInt(
        parseInt(field.rowsContainer.input.value || "1", 10) || 1,
        1,
        GRID_DIMENSION_MAX
      );
      renderGridSelection(field, cols, rows);
    }
    function previewGridDimensions(cols, rows) {
      const handle = beginGridTransaction();
      if (!handle) return;
      handle.set({
        "grid-template-columns": formatGridTemplate(cols),
        "grid-template-rows": formatGridTemplate(rows)
      });
    }
    const gridField = fields["grid-dimensions"];
    if (gridField.kind === "grid-dimensions") {
      disposer.listen(gridField.previewButton, "click", (e) => {
        e.preventDefault();
        setGridPopoverOpen(gridField, gridField.popover.hidden);
        if (!gridField.popover.hidden) {
          gridField.colsContainer.input.focus();
          gridField.colsContainer.input.select();
        }
      });
      const rootNode = gridField.previewButton.getRootNode();
      const clickTarget = rootNode instanceof ShadowRoot ? rootNode : document;
      const handleOutsideClick = (e) => {
        if (gridField.kind !== "grid-dimensions") return;
        if (gridField.popover.hidden) return;
        const target = e.target;
        if (!gridRow.contains(target)) {
          setGridPopoverOpen(gridField, false);
        }
      };
      clickTarget.addEventListener("click", handleOutsideClick, true);
      disposer.add(() => {
        clickTarget.removeEventListener("click", handleOutsideClick, true);
      });
      const wireGridInput = (input) => {
        disposer.listen(input, "input", () => {
          const cols = clampInt(
            parseInt(gridField.colsContainer.input.value || "1", 10) || 1,
            1,
            GRID_DIMENSION_MAX
          );
          const rows = clampInt(
            parseInt(gridField.rowsContainer.input.value || "1", 10) || 1,
            1,
            GRID_DIMENSION_MAX
          );
          renderGridSelection(gridField, cols, rows);
          previewGridDimensions(cols, rows);
        });
        disposer.listen(input, "blur", () => {
          commitGridTransaction();
          syncAllFields();
        });
        disposer.listen(input, "keydown", (ev) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            commitGridTransaction();
            syncAllFields();
            return;
          }
          if (ev.key === "Escape") {
            ev.preventDefault();
            rollbackGridTransaction();
            setGridPopoverOpen(gridField, false);
            syncField("grid-dimensions", true);
          }
        });
      };
      wireGridInput(gridField.colsContainer.input);
      wireGridInput(gridField.rowsContainer.input);
      disposer.listen(gridField.matrix, "mouseover", (e) => {
        var _a2, _b2;
        const el = e.target;
        const cell = el.closest(".we-grid-dimensions-cell");
        if (!cell) return;
        gridHoverCols = clampInt(parseInt((_a2 = cell.dataset.col) != null ? _a2 : "1", 10) || 1, 1, GRID_DIMENSION_MAX);
        gridHoverRows = clampInt(parseInt((_b2 = cell.dataset.row) != null ? _b2 : "1", 10) || 1, 1, GRID_DIMENSION_MAX);
        const cols = clampInt(
          parseInt(gridField.colsContainer.input.value || "1", 10) || 1,
          1,
          GRID_DIMENSION_MAX
        );
        const rows = clampInt(
          parseInt(gridField.rowsContainer.input.value || "1", 10) || 1,
          1,
          GRID_DIMENSION_MAX
        );
        renderGridSelection(gridField, cols, rows);
      });
      disposer.listen(gridField.matrix, "mouseleave", () => {
        gridHoverCols = null;
        gridHoverRows = null;
        const cols = clampInt(
          parseInt(gridField.colsContainer.input.value || "1", 10) || 1,
          1,
          GRID_DIMENSION_MAX
        );
        const rows = clampInt(
          parseInt(gridField.rowsContainer.input.value || "1", 10) || 1,
          1,
          GRID_DIMENSION_MAX
        );
        renderGridSelection(gridField, cols, rows);
      });
      disposer.listen(gridField.matrix, "click", (e) => {
        var _a2, _b2;
        const el = e.target;
        const cell = el.closest(".we-grid-dimensions-cell");
        if (!cell) return;
        const cols = clampInt(parseInt((_a2 = cell.dataset.col) != null ? _a2 : "1", 10) || 1, 1, GRID_DIMENSION_MAX);
        const rows = clampInt(parseInt((_b2 = cell.dataset.row) != null ? _b2 : "1", 10) || 1, 1, GRID_DIMENSION_MAX);
        gridField.colsContainer.input.value = String(cols);
        gridField.rowsContainer.input.value = String(rows);
        previewGridDimensions(cols, rows);
        commitGridTransaction();
        setGridPopoverOpen(gridField, false);
        syncAllFields();
      });
    }
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  const DEFAULT_MAX_VISIBLE = 8;
  const FILTER_DEBOUNCE_MS = 100;
  function createTokenPicker(options) {
    const { container, tokensService, onSelect, maxVisible = DEFAULT_MAX_VISIBLE } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let contextTokens = [];
    let filteredTokens = [];
    let showAllTokens = false;
    let filterText = "";
    let filterTimeoutId = null;
    let selectedIndex = -1;
    const root = document.createElement("div");
    root.className = "we-token-picker";
    root.hidden = true;
    const filterInput = document.createElement("input");
    filterInput.type = "text";
    filterInput.className = "we-token-filter";
    filterInput.placeholder = "Filter tokens...";
    filterInput.autocomplete = "off";
    filterInput.spellcheck = false;
    const toggleRow = document.createElement("div");
    toggleRow.className = "we-token-toggle-row";
    const toggleLabel = document.createElement("label");
    toggleLabel.className = "we-token-toggle-label";
    const toggleCheckbox = document.createElement("input");
    toggleCheckbox.type = "checkbox";
    toggleCheckbox.className = "we-token-toggle-checkbox";
    const toggleText = document.createElement("span");
    toggleText.textContent = "Show all root tokens";
    toggleLabel.append(toggleCheckbox, toggleText);
    toggleRow.append(toggleLabel);
    const listContainer = document.createElement("div");
    listContainer.className = "we-token-list";
    listContainer.style.maxHeight = `${maxVisible * 36}px`;
    const emptyState = document.createElement("div");
    emptyState.className = "we-token-empty";
    emptyState.textContent = "No tokens found";
    emptyState.hidden = true;
    root.append(filterInput, toggleRow, listContainer, emptyState);
    container.append(root);
    disposer.add(() => root.remove());
    function loadTokens() {
      if (!currentTarget || !currentTarget.isConnected) {
        contextTokens = [];
        filteredTokens = [];
        return;
      }
      if (showAllTokens) {
        const root2 = currentTarget.getRootNode();
        const result2 = tokensService.getRootTokens(root2);
        contextTokens = result2.tokens.map((token) => {
          const resolution = tokensService.resolveToken(currentTarget, token.name);
          return {
            token,
            computedValue: resolution.computedValue
          };
        });
      } else {
        const result2 = tokensService.getContextTokens(currentTarget);
        contextTokens = [...result2.tokens];
      }
      applyFilter();
    }
    function applyFilter() {
      const query = filterText.toLowerCase().trim();
      if (!query) {
        filteredTokens = contextTokens;
      } else {
        filteredTokens = contextTokens.filter((ct) => {
          const name = ct.token.name.toLowerCase();
          const value = ct.computedValue.toLowerCase();
          return name.includes(query) || value.includes(query);
        });
      }
      selectedIndex = filteredTokens.length > 0 ? 0 : -1;
      renderList();
    }
    function renderList() {
      listContainer.innerHTML = "";
      if (filteredTokens.length === 0) {
        emptyState.hidden = false;
        listContainer.hidden = true;
        return;
      }
      emptyState.hidden = true;
      listContainer.hidden = false;
      for (let i = 0; i < filteredTokens.length; i++) {
        const ct = filteredTokens[i];
        const item = createTokenItem(ct, i);
        listContainer.append(item);
      }
      updateSelectedHighlight();
    }
    function createTokenItem(ct, index) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "we-token-item";
      item.dataset.index = String(index);
      item.dataset.name = ct.token.name;
      const nameEl = document.createElement("span");
      nameEl.className = "we-token-name";
      nameEl.textContent = ct.token.name;
      const valueEl = document.createElement("span");
      valueEl.className = "we-token-value";
      valueEl.textContent = ct.computedValue || "(unset)";
      const computedLower = ct.computedValue.toLowerCase();
      const isColor = computedLower.startsWith("#") || computedLower.startsWith("rgb") || computedLower.startsWith("hsl") || /^[a-z]+$/.test(computedLower);
      if (isColor && ct.computedValue) {
        const swatch = document.createElement("span");
        swatch.className = "we-token-swatch";
        swatch.style.backgroundColor = ct.computedValue;
        item.append(swatch);
      }
      item.append(nameEl, valueEl);
      return item;
    }
    function updateSelectedHighlight() {
      const items = listContainer.querySelectorAll(".we-token-item");
      items.forEach((item, i) => {
        item.classList.toggle("we-token-item--selected", i === selectedIndex);
      });
      if (selectedIndex >= 0 && selectedIndex < items.length) {
        const selectedItem = items[selectedIndex];
        selectedItem.scrollIntoView({ block: "nearest" });
      }
    }
    function selectToken(index) {
      if (index < 0 || index >= filteredTokens.length) return;
      const ct = filteredTokens[index];
      const cssValue = tokensService.formatCssVar(ct.token.name);
      hide();
      onSelect(ct.token.name, cssValue);
    }
    function selectCurrent() {
      if (selectedIndex >= 0) {
        selectToken(selectedIndex);
      }
    }
    disposer.listen(filterInput, "input", () => {
      filterText = filterInput.value;
      if (filterTimeoutId) {
        clearTimeout(filterTimeoutId);
      }
      filterTimeoutId = setTimeout(() => {
        filterTimeoutId = null;
        applyFilter();
      }, FILTER_DEBOUNCE_MS);
    });
    disposer.listen(filterInput, "keydown", (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (filteredTokens.length > 0) {
            selectedIndex = Math.min(selectedIndex + 1, filteredTokens.length - 1);
            updateSelectedHighlight();
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (filteredTokens.length > 0) {
            selectedIndex = Math.max(selectedIndex - 1, 0);
            updateSelectedHighlight();
          }
          break;
        case "Enter":
          e.preventDefault();
          selectCurrent();
          break;
        case "Escape":
          e.preventDefault();
          hide();
          break;
      }
    });
    disposer.listen(toggleCheckbox, "change", () => {
      showAllTokens = toggleCheckbox.checked;
      loadTokens();
    });
    disposer.listen(listContainer, "click", (e) => {
      var _a2;
      const target = e.target;
      const item = target.closest(".we-token-item");
      if (!item) return;
      const index = parseInt((_a2 = item.dataset.index) != null ? _a2 : "-1", 10);
      if (index >= 0) {
        selectToken(index);
      }
    });
    disposer.listen(root, "mousedown", (e) => {
      e.preventDefault();
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element && element.isConnected ? element : null;
      filterText = "";
      filterInput.value = "";
      if (root.hidden) return;
      loadTokens();
    }
    function show() {
      if (disposer.isDisposed) return;
      if (!root.hidden) return;
      root.hidden = false;
      loadTokens();
      filterInput.focus();
    }
    function hide() {
      if (disposer.isDisposed) return;
      root.hidden = true;
      filterText = "";
      filterInput.value = "";
      selectedIndex = -1;
    }
    function toggle() {
      if (root.hidden) {
        show();
        return true;
      } else {
        hide();
        return false;
      }
    }
    function isVisible() {
      return !root.hidden;
    }
    function refresh() {
      if (disposer.isDisposed) return;
      if (root.hidden) return;
      loadTokens();
    }
    function dispose() {
      if (filterTimeoutId) {
        clearTimeout(filterTimeoutId);
        filterTimeoutId = null;
      }
      currentTarget = null;
      contextTokens = [];
      filteredTokens = [];
      disposer.dispose();
    }
    return {
      setTarget,
      show,
      hide,
      toggle,
      isVisible,
      refresh,
      dispose
    };
  }
  const SVG_NS$3 = "http://www.w3.org/2000/svg";
  const LINK_ICON_PATH = "M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m0-5.656a4 4 0 015.656 0l4 4a4 4 0 11-5.656 5.656l-1.1-1.102";
  function createTokenPill(options) {
    const {
      container,
      ariaLabel,
      tokenName,
      previewColor = null,
      leadingElement = null,
      disabled = false,
      onClick,
      onClear
    } = options;
    const disposer = new Disposer();
    let isDisabled = Boolean(disabled);
    let currentTokenName = String(tokenName);
    let currentPreviewColor = typeof previewColor === "string" ? previewColor : null;
    let currentLeadingElement = leadingElement != null ? leadingElement : null;
    const root = document.createElement("div");
    root.className = "we-token-pill";
    root.dataset.disabled = isDisabled ? "true" : "false";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", ariaLabel);
    const leadingSlot = document.createElement("div");
    leadingSlot.className = "we-token-pill__leading";
    const internalSwatch = document.createElement("div");
    internalSwatch.className = "we-token-pill__swatch";
    internalSwatch.setAttribute("aria-hidden", "true");
    const mainBtn = document.createElement("button");
    mainBtn.type = "button";
    mainBtn.className = "we-token-pill__main";
    mainBtn.setAttribute("aria-label", ariaLabel);
    mainBtn.dataset.tooltip = "Change token";
    const nameEl = document.createElement("span");
    nameEl.className = "we-token-pill__name";
    const linkIcon = document.createElementNS(SVG_NS$3, "svg");
    linkIcon.setAttribute("viewBox", "0 0 24 24");
    linkIcon.setAttribute("fill", "none");
    linkIcon.setAttribute("aria-hidden", "true");
    linkIcon.classList.add("we-token-pill__icon");
    const iconPath = document.createElementNS(SVG_NS$3, "path");
    iconPath.setAttribute("d", LINK_ICON_PATH);
    iconPath.setAttribute("stroke", "currentColor");
    iconPath.setAttribute("stroke-width", "2");
    iconPath.setAttribute("stroke-linecap", "round");
    iconPath.setAttribute("stroke-linejoin", "round");
    linkIcon.append(iconPath);
    mainBtn.append(nameEl, linkIcon);
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "we-token-pill__clear";
    clearBtn.setAttribute("aria-label", "Clear token");
    clearBtn.dataset.tooltip = "Clear token";
    clearBtn.textContent = "×";
    root.append(leadingSlot, mainBtn, clearBtn);
    container.append(root);
    disposer.add(() => root.remove());
    function syncLeading() {
      while (leadingSlot.firstChild) {
        leadingSlot.removeChild(leadingSlot.firstChild);
      }
      if (currentLeadingElement) {
        leadingSlot.append(currentLeadingElement);
      } else {
        internalSwatch.style.backgroundColor = currentPreviewColor != null ? currentPreviewColor : "";
        leadingSlot.append(internalSwatch);
      }
    }
    function syncText() {
      nameEl.textContent = currentTokenName;
    }
    function syncDisabled() {
      root.dataset.disabled = isDisabled ? "true" : "false";
      mainBtn.disabled = isDisabled;
      clearBtn.disabled = isDisabled;
      if (currentLeadingElement instanceof HTMLButtonElement) {
        currentLeadingElement.disabled = isDisabled;
      }
    }
    disposer.listen(mainBtn, "click", (e) => {
      e.preventDefault();
      if (isDisabled) return;
      onClick == null ? void 0 : onClick();
    });
    disposer.listen(clearBtn, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isDisabled) return;
      onClear == null ? void 0 : onClear();
    });
    disposer.listen(root, "keydown", (e) => {
      if (isDisabled) return;
      if (e.key === "Backspace" || e.key === "Delete") {
        const path = e.composedPath();
        if (path.includes(mainBtn) || path.includes(root)) {
          e.preventDefault();
          onClear == null ? void 0 : onClear();
        }
      }
    });
    syncLeading();
    syncText();
    syncDisabled();
    return {
      root,
      setTokenName(name) {
        currentTokenName = String(name != null ? name : "");
        syncText();
      },
      setPreviewColor(color) {
        currentPreviewColor = typeof color === "string" ? color : null;
        if (!currentLeadingElement) {
          internalSwatch.style.backgroundColor = currentPreviewColor != null ? currentPreviewColor : "";
        }
      },
      setLeadingElement(el) {
        currentLeadingElement = el != null ? el : null;
        syncLeading();
        syncDisabled();
      },
      setDisabled(disabled2) {
        isDisabled = Boolean(disabled2);
        syncDisabled();
      },
      focus() {
        try {
          mainBtn.focus();
        } catch (e) {
        }
      },
      dispose() {
        disposer.dispose();
      }
    };
  }
  const DEFAULT_COLOR_HEX = "#000000";
  const TOKEN_BTN_ICON_SVG = `
  <svg class="we-token-btn-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 3a9 9 0 100 18h1a2 2 0 002-2v-1a2 2 0 012-2h1a3 3 0 003-3 10 10 0 00-9-10z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor"/>
    <circle cx="10.5" cy="7.5" r="1" fill="currentColor"/>
    <circle cx="13.5" cy="10.5" r="1" fill="currentColor"/>
  </svg>
`;
  function clampByte$1(n) {
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(255, Math.round(n)));
  }
  function toHexByte$1(n) {
    return clampByte$1(n).toString(16).padStart(2, "0");
  }
  function rgbToHex(rgb) {
    const match = rgb.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (!match) return null;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return null;
    }
    return `#${toHexByte$1(r)}${toHexByte$1(g)}${toHexByte$1(b)}`;
  }
  function normalizeHex(raw) {
    const v = raw.trim().toLowerCase();
    if (!v.startsWith("#")) return null;
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      const r = v[1];
      const g = v[2];
      const b = v[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(0, 7);
    if (/^#[0-9a-f]{4}$/.test(v)) {
      const r = v[1];
      const g = v[2];
      const b = v[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return null;
  }
  function getActiveElement(root) {
    try {
      const rootNode = root.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        return rootNode.activeElement;
      }
    } catch (e) {
    }
    return document.activeElement;
  }
  function createColorField(options) {
    const {
      container,
      ariaLabel,
      onInput,
      onCommit,
      onCancel,
      tokensService,
      getTokenTarget,
      tokenPickerMaxVisible
    } = options;
    const disposer = new Disposer();
    let currentValue = "";
    let currentPlaceholder = "";
    let lastResolvedHex = DEFAULT_COLOR_HEX;
    let isTokenMode = false;
    let isDisabled = false;
    let tokenPill = null;
    let tokenBtn = null;
    let tokenPicker = null;
    const root = document.createElement("div");
    root.className = "we-color-field";
    root.style.position = "relative";
    const swatchBtn = document.createElement("button");
    swatchBtn.type = "button";
    swatchBtn.className = "we-color-swatch";
    swatchBtn.dataset.tooltip = "Pick color";
    swatchBtn.setAttribute("aria-label", `Pick ${ariaLabel}`);
    const nativeInput = document.createElement("input");
    nativeInput.type = "color";
    nativeInput.className = "we-color-native-input";
    nativeInput.value = lastResolvedHex;
    nativeInput.tabIndex = -1;
    const textInput = document.createElement("input");
    textInput.type = "text";
    textInput.className = "we-input we-color-text";
    textInput.autocomplete = "off";
    textInput.spellcheck = false;
    textInput.setAttribute("aria-label", ariaLabel);
    const probe = document.createElement("span");
    probe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;opacity:0";
    probe.setAttribute("aria-hidden", "true");
    swatchBtn.append(nativeInput);
    if (tokensService) {
      tokenBtn = document.createElement("button");
      tokenBtn.type = "button";
      tokenBtn.className = "we-token-btn";
      tokenBtn.setAttribute("aria-label", "Select design token");
      tokenBtn.dataset.tooltip = "Select design token";
      tokenBtn.innerHTML = TOKEN_BTN_ICON_SVG;
    }
    root.append(swatchBtn, textInput);
    if (tokenBtn) {
      root.append(tokenBtn);
    }
    root.append(probe);
    container.append(root);
    disposer.add(() => root.remove());
    if (tokensService) {
      tokenPill = createTokenPill({
        container: root,
        ariaLabel: `${ariaLabel} token`,
        tokenName: "",
        disabled: false,
        onClick: () => toggleTokenPicker(),
        onClear: () => detachToken()
      });
      tokenPill.root.hidden = true;
      disposer.add(() => tokenPill == null ? void 0 : tokenPill.dispose());
    }
    if (tokensService) {
      tokenPicker = createTokenPicker({
        container: root,
        tokensService,
        maxVisible: tokenPickerMaxVisible,
        onSelect: handleTokenSelect
      });
      disposer.add(() => tokenPicker == null ? void 0 : tokenPicker.dispose());
      disposer.listen(document, "click", (e) => {
        if (!(tokenPicker == null ? void 0 : tokenPicker.isVisible())) return;
        const target = e.target;
        if (!root.contains(target)) {
          tokenPicker.hide();
        }
      });
    }
    function getDisplayValue() {
      const value = currentValue.trim();
      const placeholder = currentPlaceholder.trim();
      if (value && /\bvar\s*\(/i.test(value) && placeholder) {
        return placeholder;
      }
      return value || placeholder;
    }
    function resolveDisplayColor(raw) {
      const trimmed = raw.trim();
      if (!trimmed) return { swatch: null, hex: null };
      const hex = normalizeHex(trimmed);
      if (hex) return { swatch: hex, hex };
      try {
        probe.style.backgroundColor = "";
        probe.style.backgroundColor = trimmed;
        if (!probe.style.backgroundColor) return { swatch: null, hex: null };
        const computed = getComputedStyle(probe).backgroundColor;
        const computedHex = rgbToHex(computed);
        return { swatch: computed || null, hex: computedHex };
      } catch (e) {
        return { swatch: null, hex: null };
      }
    }
    function updateSwatch() {
      const display = getDisplayValue();
      const resolved = resolveDisplayColor(display);
      if (resolved.swatch) {
        swatchBtn.style.backgroundColor = resolved.swatch;
      } else {
        swatchBtn.style.backgroundColor = "";
      }
      if (resolved.hex) {
        lastResolvedHex = resolved.hex;
        nativeInput.value = resolved.hex;
      }
    }
    function openPicker() {
      if (nativeInput.disabled) return;
      const display = getDisplayValue();
      const resolved = resolveDisplayColor(display);
      if (resolved.hex) lastResolvedHex = resolved.hex;
      nativeInput.value = lastResolvedHex;
      const showPicker = nativeInput.showPicker;
      if (typeof showPicker === "function") {
        try {
          showPicker.call(nativeInput);
          return;
        } catch (e) {
        }
      }
      try {
        nativeInput.click();
      } catch (e) {
      }
    }
    function parseTokenName() {
      if (!tokensService) return null;
      const ref = tokensService.parseCssVar(currentValue.trim());
      return ref ? ref.name : null;
    }
    function setTokenMode(next, tokenName) {
      var _a2;
      if (!tokensService || !tokenPill) return;
      if (next === isTokenMode) {
        if (next && tokenName) {
          tokenPill.setTokenName(tokenName);
        }
        return;
      }
      isTokenMode = next;
      if (next) {
        const name = (_a2 = tokenName != null ? tokenName : parseTokenName()) != null ? _a2 : "";
        tokenPill.setTokenName(name);
        tokenPill.setLeadingElement(swatchBtn);
        tokenPill.root.hidden = false;
        textInput.hidden = true;
        if (tokenBtn) tokenBtn.hidden = true;
      } else {
        tokenPill.root.hidden = true;
        tokenPill.setLeadingElement(null);
        textInput.hidden = false;
        if (tokenBtn) tokenBtn.hidden = false;
        if (swatchBtn.parentElement !== root) {
          root.insertBefore(swatchBtn, textInput);
        } else if (swatchBtn.nextSibling !== textInput) {
          root.insertBefore(swatchBtn, textInput);
        }
      }
    }
    function syncTokenUi() {
      if (!tokensService || !tokenPill) return;
      const name = parseTokenName();
      setTokenMode(Boolean(name), name != null ? name : void 0);
    }
    function toggleTokenPicker() {
      var _a2;
      if (!tokenPicker || !tokensService) return;
      if (isDisabled) return;
      tokenPicker.setTarget((_a2 = getTokenTarget == null ? void 0 : getTokenTarget()) != null ? _a2 : null);
      tokenPicker.toggle();
    }
    function handleTokenSelect(tokenName, cssValue) {
      currentPlaceholder = "";
      textInput.placeholder = "";
      currentValue = cssValue;
      textInput.value = currentValue;
      updateSwatch();
      onInput == null ? void 0 : onInput(currentValue.trim());
      onCommit == null ? void 0 : onCommit();
      setTokenMode(true, tokenName);
    }
    function detachToken() {
      if (!tokensService || !tokenPill) return;
      if (isDisabled) return;
      tokenPicker == null ? void 0 : tokenPicker.hide();
      const literal = lastResolvedHex || DEFAULT_COLOR_HEX;
      currentPlaceholder = "";
      textInput.placeholder = "";
      currentValue = literal;
      textInput.value = currentValue;
      updateSwatch();
      onInput == null ? void 0 : onInput(currentValue);
      onCommit == null ? void 0 : onCommit();
      setTokenMode(false);
    }
    disposer.listen(swatchBtn, "keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPicker();
      }
    });
    disposer.listen(textInput, "input", () => {
      currentValue = textInput.value;
      updateSwatch();
      onInput == null ? void 0 : onInput(currentValue.trim());
    });
    disposer.listen(textInput, "blur", () => {
      onCommit == null ? void 0 : onCommit();
      syncTokenUi();
    });
    disposer.listen(textInput, "keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onCommit == null ? void 0 : onCommit();
        textInput.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel == null ? void 0 : onCancel();
      }
    });
    disposer.listen(nativeInput, "input", () => {
      currentValue = nativeInput.value;
      textInput.value = currentValue;
      updateSwatch();
      onInput == null ? void 0 : onInput(currentValue);
    });
    disposer.listen(nativeInput, "change", () => {
      onCommit == null ? void 0 : onCommit();
      syncTokenUi();
    });
    if (tokenBtn) {
      disposer.listen(tokenBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleTokenPicker();
      });
    }
    updateSwatch();
    syncTokenUi();
    return {
      setValue(value) {
        currentValue = String(value != null ? value : "");
        textInput.value = currentValue;
        updateSwatch();
        syncTokenUi();
      },
      setPlaceholder(value) {
        currentPlaceholder = String(value != null ? value : "");
        textInput.placeholder = currentPlaceholder;
        updateSwatch();
      },
      setDisabled(disabled) {
        isDisabled = Boolean(disabled);
        swatchBtn.disabled = isDisabled;
        textInput.disabled = isDisabled;
        nativeInput.disabled = isDisabled;
        if (tokenBtn) tokenBtn.disabled = isDisabled;
        tokenPill == null ? void 0 : tokenPill.setDisabled(isDisabled);
        if (isDisabled) tokenPicker == null ? void 0 : tokenPicker.hide();
      },
      isFocused() {
        const active = getActiveElement(root);
        return active instanceof HTMLElement ? root.contains(active) : false;
      },
      dispose() {
        disposer.dispose();
      }
    };
  }
  const GRADIENT_TYPES = [
    { value: "none", label: "None" },
    { value: "linear", label: "Linear" },
    { value: "radial", label: "Radial" }
  ];
  const RADIAL_SHAPES = [
    { value: "ellipse", label: "Ellipse" },
    { value: "circle", label: "Circle" }
  ];
  const DEFAULT_LINEAR_ANGLE = 180;
  const DEFAULT_POSITION = 50;
  const DEFAULT_STOP_1 = { color: "#000000", position: 0 };
  const DEFAULT_STOP_2 = { color: "#ffffff", position: 100 };
  let stopIdCounter = 0;
  function createStopId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (e) {
    }
    stopIdCounter += 1;
    return `stop_${stopIdCounter}_${Date.now()}`;
  }
  function createDefaultStopModels() {
    return [
      { id: createStopId(), color: DEFAULT_STOP_1.color, position: DEFAULT_STOP_1.position },
      { id: createStopId(), color: DEFAULT_STOP_2.color, position: DEFAULT_STOP_2.position }
    ];
  }
  function toStopModels(stops) {
    return stops.map((s) => ({
      id: createStopId(),
      color: s.color,
      position: s.position,
      placeholderColor: s.placeholderColor
    }));
  }
  function reconcileStopModels(prevModels, newStops) {
    if (prevModels.length === newStops.length) {
      return newStops.map((stop, i) => {
        var _a2, _b2;
        return {
          id: (_b2 = (_a2 = prevModels[i]) == null ? void 0 : _a2.id) != null ? _b2 : createStopId(),
          color: stop.color,
          position: stop.position,
          placeholderColor: stop.placeholderColor
        };
      });
    }
    return toStopModels(newStops);
  }
  function getStopPreviewColor(stop) {
    var _a2;
    if (needsColorPlaceholder(stop.color)) {
      const c = (_a2 = stop.placeholderColor) == null ? void 0 : _a2.trim();
      return c ? c : "transparent";
    }
    return stop.color;
  }
  function clampByte(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
  }
  function toHexByte(value) {
    return clampByte(value).toString(16).padStart(2, "0");
  }
  function rgbaToCss(color) {
    const a = clampNumber(color.a, 0, 1);
    if (a >= 1) {
      return `#${toHexByte(color.r)}${toHexByte(color.g)}${toHexByte(color.b)}`;
    }
    const alpha = Math.round(a * 1e3) / 1e3;
    return `rgba(${clampByte(color.r)}, ${clampByte(color.g)}, ${clampByte(color.b)}, ${alpha})`;
  }
  function parseHexColorToRgba(raw) {
    const v = raw.trim().toLowerCase();
    if (!v.startsWith("#")) return null;
    if (/^#[0-9a-f]{3}$/.test(v)) {
      const r = Number.parseInt(v[1] + v[1], 16);
      const g = Number.parseInt(v[2] + v[2], 16);
      const b = Number.parseInt(v[3] + v[3], 16);
      return { r, g, b, a: 1 };
    }
    if (/^#[0-9a-f]{4}$/.test(v)) {
      const r = Number.parseInt(v[1] + v[1], 16);
      const g = Number.parseInt(v[2] + v[2], 16);
      const b = Number.parseInt(v[3] + v[3], 16);
      const a = Number.parseInt(v[4] + v[4], 16) / 255;
      return { r, g, b, a };
    }
    if (/^#[0-9a-f]{6}$/.test(v)) {
      const r = Number.parseInt(v.slice(1, 3), 16);
      const g = Number.parseInt(v.slice(3, 5), 16);
      const b = Number.parseInt(v.slice(5, 7), 16);
      return { r, g, b, a: 1 };
    }
    if (/^#[0-9a-f]{8}$/.test(v)) {
      const r = Number.parseInt(v.slice(1, 3), 16);
      const g = Number.parseInt(v.slice(3, 5), 16);
      const b = Number.parseInt(v.slice(5, 7), 16);
      const a = Number.parseInt(v.slice(7, 9), 16) / 255;
      return { r, g, b, a };
    }
    return null;
  }
  function parseRgbChannel(token) {
    const t = token.trim();
    if (!t) return null;
    if (t.endsWith("%")) {
      const n2 = Number(t.slice(0, -1));
      if (!Number.isFinite(n2)) return null;
      return clampByte(n2 / 100 * 255);
    }
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return clampByte(n);
  }
  function parseAlphaChannel(token) {
    const t = token.trim();
    if (!t) return null;
    if (t.endsWith("%")) {
      const n2 = Number(t.slice(0, -1));
      if (!Number.isFinite(n2)) return null;
      return clampNumber(n2 / 100, 0, 1);
    }
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return clampNumber(n, 0, 1);
  }
  function parseRgbColorToRgba(raw) {
    const trimmed = raw.trim();
    if (!/^rgba?\(/i.test(trimmed)) return null;
    const openIndex = trimmed.indexOf("(");
    const closeIndex = trimmed.lastIndexOf(")");
    if (openIndex < 0 || closeIndex < openIndex) return null;
    const inner = trimmed.slice(openIndex + 1, closeIndex).trim();
    if (!inner) return null;
    let channelsPart = inner;
    let alphaPart = null;
    const slashIndex = inner.indexOf("/");
    if (slashIndex !== -1) {
      channelsPart = inner.slice(0, slashIndex).trim();
      alphaPart = inner.slice(slashIndex + 1).trim();
    }
    const channelTokens = channelsPart.includes(",") ? channelsPart.split(",").map((t) => t.trim()).filter(Boolean) : channelsPart.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    if (channelTokens.length < 3) return null;
    const r = parseRgbChannel(channelTokens[0]);
    const g = parseRgbChannel(channelTokens[1]);
    const b = parseRgbChannel(channelTokens[2]);
    if (r === null || g === null || b === null) return null;
    let a = 1;
    if (!alphaPart && channelTokens.length >= 4) {
      alphaPart = channelTokens[3];
    }
    if (alphaPart) {
      const parsedA = parseAlphaChannel(alphaPart);
      if (parsedA !== null) a = parsedA;
    }
    return { r, g, b, a };
  }
  function lerpNumber(a, b, t) {
    return a + (b - a) * t;
  }
  function interpolateRgba(a, b, t) {
    const clampedT = clampNumber(t, 0, 1);
    return {
      r: lerpNumber(a.r, b.r, clampedT),
      g: lerpNumber(a.g, b.g, clampedT),
      b: lerpNumber(a.b, b.b, clampedT),
      a: lerpNumber(a.a, b.a, clampedT)
    };
  }
  function isFieldFocused$4(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$5(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$4(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function isNoneValue(value) {
    const trimmed = value.trim();
    return !trimmed || trimmed.toLowerCase() === "none";
  }
  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, value));
  }
  function parseNumber$1(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  function parseAngleToken(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*deg$/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  }
  function parsePercentToken(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(-?(?:\d+\.?\d*|\.\d+))\s*%$/);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  }
  function parsePositionX(raw) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    const pct = parsePercentToken(trimmed);
    if (pct !== null) return pct;
    if (trimmed === "center") return 50;
    if (trimmed === "left") return 0;
    if (trimmed === "right") return 100;
    return null;
  }
  function parsePositionY(raw) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return null;
    const pct = parsePercentToken(trimmed);
    if (pct !== null) return pct;
    if (trimmed === "center") return 50;
    if (trimmed === "top") return 0;
    if (trimmed === "bottom") return 100;
    return null;
  }
  function isXKeyword(raw) {
    const lower = raw.trim().toLowerCase();
    return lower === "left" || lower === "right";
  }
  function isYKeyword(raw) {
    const lower = raw.trim().toLowerCase();
    return lower === "top" || lower === "bottom";
  }
  function clampAngle(value) {
    return clampNumber(value, 0, 360);
  }
  function clampPercent(value) {
    return clampNumber(value, 0, 100);
  }
  function splitTopLevel$1(value, separator) {
    const results = [];
    let depth = 0;
    let quote = null;
    let escape = false;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && ch === separator) {
        results.push(value.slice(start, i));
        start = i + 1;
      }
    }
    results.push(value.slice(start));
    return results;
  }
  function tokenizeTopLevel$1(value) {
    const tokens = [];
    let depth = 0;
    let quote = null;
    let escape = false;
    let buffer = "";
    const flush = () => {
      const t = buffer.trim();
      if (t) tokens.push(t);
      buffer = "";
    };
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (escape) {
        buffer += ch;
        escape = false;
        continue;
      }
      if (ch === "\\") {
        buffer += ch;
        escape = true;
        continue;
      }
      if (quote) {
        buffer += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        buffer += ch;
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        buffer += ch;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        buffer += ch;
        continue;
      }
      if (depth === 0 && /\s/.test(ch)) {
        flush();
        continue;
      }
      buffer += ch;
    }
    flush();
    return tokens;
  }
  function parseColorStop(raw) {
    var _a2, _b2;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const tokens = tokenizeTopLevel$1(trimmed);
    if (tokens.length === 0) return null;
    const color = (_a2 = tokens[0]) != null ? _a2 : "";
    if (!color) return null;
    let position = null;
    for (let i = 1; i < tokens.length; i++) {
      const p = parsePercentToken((_b2 = tokens[i]) != null ? _b2 : "");
      if (p !== null) {
        position = p;
        break;
      }
    }
    return { color, position };
  }
  function normalizeStopPositions(stops) {
    var _a2, _b2, _c, _d;
    if (stops.length === 0) return [];
    if (stops.length === 1) {
      return [
        {
          color: stops[0].color.trim() || DEFAULT_STOP_1.color,
          position: clampPercent((_a2 = stops[0].position) != null ? _a2 : 0)
        }
      ];
    }
    const colors = stops.map((s) => s.color.trim() || DEFAULT_STOP_1.color);
    const positions = stops.map(
      (s) => s.position === null ? null : clampPercent(s.position)
    );
    if (positions[0] === null) {
      positions[0] = 0;
    }
    const lastIndex = positions.length - 1;
    if (positions[lastIndex] === null) {
      positions[lastIndex] = 100;
    }
    let maxSoFar = (_b2 = positions[0]) != null ? _b2 : 0;
    for (let i = 1; i < positions.length; i++) {
      const pos = positions[i];
      if (pos !== null) {
        if (pos < maxSoFar) {
          positions[i] = maxSoFar;
        } else {
          maxSoFar = pos;
        }
      }
    }
    let runStart = null;
    for (let i = 0; i < positions.length; i++) {
      if (positions[i] === null) {
        if (runStart === null) {
          runStart = i;
        }
      } else {
        if (runStart !== null) {
          const prevPos = (_c = positions[runStart - 1]) != null ? _c : 0;
          const nextPos = (_d = positions[i]) != null ? _d : 100;
          const runLength = i - runStart + 1;
          for (let j = runStart; j < i; j++) {
            const t = (j - runStart + 1) / runLength;
            positions[j] = prevPos + (nextPos - prevPos) * t;
          }
          runStart = null;
        }
      }
    }
    return stops.map((_, i) => {
      var _a3;
      return {
        color: colors[i],
        position: clampPercent((_a3 = positions[i]) != null ? _a3 : 0)
      };
    });
  }
  function parseGradientFunctionCall(value) {
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    let kind = null;
    let fnName = "";
    if (lower.startsWith("linear-gradient")) {
      kind = "linear";
      fnName = "linear-gradient";
    } else if (lower.startsWith("radial-gradient")) {
      kind = "radial";
      fnName = "radial-gradient";
    } else {
      return null;
    }
    let i = fnName.length;
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (trimmed[i] !== "(") return null;
    const openIndex = i;
    let depth = 0;
    let quote = null;
    let escape = false;
    for (let j = openIndex; j < trimmed.length; j++) {
      const ch = trimmed[j];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth--;
        if (depth === 0) {
          const trailing = trimmed.slice(j + 1).trim();
          if (trailing) return null;
          const args = trimmed.slice(openIndex + 1, j);
          return { kind, args };
        }
      }
    }
    return null;
  }
  function parseLinearGradient(args) {
    var _a2;
    const parts = splitTopLevel$1(args, ",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const firstPart = (_a2 = parts[0]) != null ? _a2 : "";
    const firstLower = firstPart.toLowerCase();
    if (firstLower.startsWith("to ")) {
      return null;
    }
    const maybeAngle = parseAngleToken(firstPart);
    let angle = DEFAULT_LINEAR_ANGLE;
    let stopStartIndex = 0;
    if (maybeAngle !== null) {
      if (parts.length < 3) return null;
      angle = maybeAngle;
      stopStartIndex = 1;
    }
    const stopParts = parts.slice(stopStartIndex);
    const parsedStops = [];
    for (const raw of stopParts) {
      const stop = parseColorStop(raw);
      if (!stop) return null;
      parsedStops.push(stop);
    }
    if (parsedStops.length < 2) return null;
    return {
      type: "linear",
      angle: clampAngle(angle),
      stops: normalizeStopPositions(parsedStops)
    };
  }
  const UNSUPPORTED_RADIAL_SIZE_KEYWORDS = /* @__PURE__ */ new Set([
    "closest-side",
    "farthest-side",
    "closest-corner",
    "farthest-corner"
  ]);
  function parseRadialGradient(args) {
    var _a2, _b2, _c;
    const parts = splitTopLevel$1(args, ",").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    let shape = "ellipse";
    let position = null;
    let stopStartIndex = 0;
    const first = (_a2 = parts[0]) != null ? _a2 : "";
    const tokens = tokenizeTopLevel$1(first);
    const lowerTokens = tokens.map((t) => t.toLowerCase());
    for (const token of lowerTokens) {
      if (UNSUPPORTED_RADIAL_SIZE_KEYWORDS.has(token)) {
        return null;
      }
    }
    const atIndex = lowerTokens.indexOf("at");
    const hasAt = atIndex >= 0;
    const hasCircle = lowerTokens.includes("circle");
    const hasEllipse = lowerTokens.includes("ellipse");
    const hasShape = hasCircle || hasEllipse;
    if (hasShape || hasAt) {
      stopStartIndex = 1;
      if (hasCircle) shape = "circle";
      else if (hasEllipse) shape = "ellipse";
      if (hasAt) {
        const token1 = (_b2 = tokens[atIndex + 1]) != null ? _b2 : "";
        const token2 = (_c = tokens[atIndex + 2]) != null ? _c : "";
        let x = null;
        let y = null;
        if (isYKeyword(token1)) {
          y = parsePositionY(token1);
          x = token2 ? parsePositionX(token2) : null;
        } else if (isXKeyword(token1)) {
          x = parsePositionX(token1);
          y = token2 ? parsePositionY(token2) : null;
        } else {
          x = parsePositionX(token1);
          y = token2 ? parsePositionY(token2) : null;
        }
        position = {
          x: clampPercent(x != null ? x : DEFAULT_POSITION),
          y: clampPercent(y != null ? y : DEFAULT_POSITION)
        };
      }
    }
    const stopParts = parts.slice(stopStartIndex);
    const parsedStops = [];
    for (const raw of stopParts) {
      const stop = parseColorStop(raw);
      if (!stop) return null;
      parsedStops.push(stop);
    }
    if (parsedStops.length < 2) return null;
    return {
      type: "radial",
      shape,
      position,
      stops: normalizeStopPositions(parsedStops)
    };
  }
  function parseGradient(value) {
    const fn = parseGradientFunctionCall(value);
    if (!fn) return null;
    return fn.kind === "linear" ? parseLinearGradient(fn.args) : parseRadialGradient(fn.args);
  }
  function needsColorPlaceholder(value) {
    return /\bvar\s*\(/i.test(value);
  }
  function buildPlaceholderMapping(inlineStops, computedStops) {
    if (inlineStops.length === 0 || computedStops.length === 0) {
      return [];
    }
    return inlineStops.map((inlineStop) => {
      let nearestStop = computedStops[0];
      let minDistance = Math.abs(nearestStop.position - inlineStop.position);
      for (let i = 1; i < computedStops.length; i++) {
        const candidate = computedStops[i];
        const distance = Math.abs(candidate.position - inlineStop.position);
        if (distance < minDistance) {
          nearestStop = candidate;
          minDistance = distance;
        }
      }
      return nearestStop.color;
    });
  }
  function createGradientControl(options) {
    var _a2, _b2;
    const {
      container,
      transactionManager,
      tokensService,
      property: cssProperty = "background-image",
      allowNone = true
    } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentType = allowNone ? "none" : "linear";
    let currentStops = createDefaultStopModels();
    let selectedStopId = (_b2 = (_a2 = currentStops[0]) == null ? void 0 : _a2.id) != null ? _b2 : null;
    let thumbDrag = null;
    let thumbKeyboard = null;
    let backgroundHandle = null;
    const root = document.createElement("div");
    root.className = "we-field-group";
    function createInputRow(labelText, ariaLabel) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "we-input";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.inputMode = "decimal";
      input.setAttribute("aria-label", ariaLabel);
      row.append(label, input);
      return { row, input };
    }
    function createSelectRow(labelText, ariaLabel, values) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const select = document.createElement("select");
      select.className = "we-select";
      select.setAttribute("aria-label", ariaLabel);
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v.value;
        opt.textContent = v.label;
        select.append(opt);
      }
      row.append(label, select);
      return { row, select };
    }
    const gradientTypeOptions = allowNone ? GRADIENT_TYPES : GRADIENT_TYPES.filter((t) => t.value !== "none");
    const { row: typeRow, select: typeSelect } = createSelectRow(
      "Type",
      "Gradient Type",
      gradientTypeOptions
    );
    const gradientBarRow = document.createElement("div");
    gradientBarRow.className = "we-gradient-bar-row";
    const gradientBar = document.createElement("div");
    gradientBar.className = "we-gradient-bar";
    gradientBar.setAttribute("aria-label", "Gradient preview");
    const gradientThumbs = document.createElement("div");
    gradientThumbs.className = "we-gradient-bar-thumbs";
    gradientBar.append(gradientThumbs);
    gradientBarRow.append(gradientBar);
    const { row: angleRow, input: angleInput } = createInputRow("Angle", "Gradient Angle (deg)");
    angleInput.placeholder = String(DEFAULT_LINEAR_ANGLE);
    const { row: shapeRow, select: shapeSelect } = createSelectRow(
      "Shape",
      "Radial Gradient Shape",
      RADIAL_SHAPES
    );
    const { row: posXRow, input: posXInput } = createInputRow("Position X", "Radial Position X (%)");
    const { row: posYRow, input: posYInput } = createInputRow("Position Y", "Radial Position Y (%)");
    const stopsHeaderRow = document.createElement("div");
    stopsHeaderRow.className = "we-gradient-stops-header";
    const stopsHeaderLabel = document.createElement("span");
    stopsHeaderLabel.className = "we-gradient-stops-title";
    stopsHeaderLabel.textContent = "Stops";
    const stopsAddBtn = document.createElement("button");
    stopsAddBtn.type = "button";
    stopsAddBtn.className = "we-icon-btn we-gradient-stops-add";
    stopsAddBtn.setAttribute("aria-label", "Add stop");
    stopsAddBtn.disabled = false;
    stopsAddBtn.textContent = "+";
    stopsHeaderRow.append(stopsHeaderLabel, stopsAddBtn);
    const stopsList = document.createElement("div");
    stopsList.className = "we-gradient-stops-list";
    stopsList.setAttribute("role", "list");
    root.append(
      typeRow,
      gradientBarRow,
      angleRow,
      shapeRow,
      posXRow,
      posYRow,
      stopsHeaderRow,
      stopsList
    );
    container.append(root);
    disposer.add(() => root.remove());
    wireNumberStepping(disposer, angleInput, {
      mode: "number",
      min: 0,
      max: 360,
      step: 1,
      shiftStep: 15,
      altStep: 0.1
    });
    wireNumberStepping(disposer, posXInput, {
      mode: "number",
      min: 0,
      max: 100,
      step: 1,
      shiftStep: 10,
      altStep: 0.1
    });
    wireNumberStepping(disposer, posYInput, {
      mode: "number",
      min: 0,
      max: 100,
      step: 1,
      shiftStep: 10,
      altStep: 0.1
    });
    const selectedStopPosHost = document.createElement("div");
    const selectedStopPosInput = document.createElement("input");
    selectedStopPosInput.type = "text";
    selectedStopPosInput.className = "we-gradient-stop-pos-input";
    selectedStopPosInput.autocomplete = "off";
    selectedStopPosInput.spellcheck = false;
    selectedStopPosInput.inputMode = "decimal";
    selectedStopPosInput.placeholder = "0";
    selectedStopPosInput.setAttribute("aria-label", "Selected Stop Position (%)");
    selectedStopPosHost.append(selectedStopPosInput);
    wireNumberStepping(disposer, selectedStopPosInput, {
      mode: "number",
      min: 0,
      max: 100,
      step: 1,
      shiftStep: 10
    });
    function commitSelectedStopPosition() {
      sortCurrentStopsByPosition();
      if (backgroundHandle) {
        previewGradient();
        commitTransaction();
      }
      syncAllFields();
    }
    function cancelSelectedStopPosition() {
      rollbackTransaction();
      syncAllFields(true);
    }
    disposer.listen(selectedStopPosInput, "input", () => {
      const id = selectedStopId;
      if (!id) return;
      const parsed = parseNumber$1(selectedStopPosInput.value);
      if (parsed === null) return;
      setStopPositionById(id, parsed);
      previewGradient();
    });
    disposer.listen(selectedStopPosInput, "blur", commitSelectedStopPosition);
    disposer.listen(selectedStopPosInput, "keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        commitSelectedStopPosition();
        selectedStopPosInput.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelSelectedStopPosition();
      }
    });
    const selectedStopColorHost = document.createElement("div");
    const selectedStopColorField = createColorField({
      container: selectedStopColorHost,
      ariaLabel: "Selected Stop Color",
      tokensService,
      getTokenTarget: () => currentTarget,
      onInput: (value) => {
        var _a3;
        const id = selectedStopId;
        if (!id) return;
        const index = currentStops.findIndex((s) => s.id === id);
        if (index < 0) return;
        currentStops[index].color = value;
        selectedStopColorField.setPlaceholder(
          needsColorPlaceholder(value) ? (_a3 = currentStops[index].placeholderColor) != null ? _a3 : "" : ""
        );
        previewGradient();
      },
      onCommit: () => {
        commitTransaction();
        syncAllFields();
      },
      onCancel: () => {
        rollbackTransaction();
        syncAllFields(true);
      }
    });
    disposer.add(() => selectedStopColorField.dispose());
    function beginTransaction() {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      if (backgroundHandle) return backgroundHandle;
      backgroundHandle = transactionManager.beginStyle(target, cssProperty);
      return backgroundHandle;
    }
    function commitTransaction() {
      const handle = backgroundHandle;
      backgroundHandle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction() {
      const handle = backgroundHandle;
      backgroundHandle = null;
      if (handle) handle.rollback();
    }
    function setStopPositionById(stopId, position) {
      const index = currentStops.findIndex((s) => s.id === stopId);
      if (index < 0) return;
      const clamped = clampPercent(position);
      currentStops[index].position = clamped;
    }
    function restoreStopPositions(snapshot) {
      for (const stop of currentStops) {
        const savedPos = snapshot.get(stop.id);
        if (savedPos !== void 0) {
          stop.position = savedPos;
        }
      }
    }
    function endThumbDrag(commit) {
      const session = thumbDrag;
      if (!session) return;
      thumbDrag = null;
      gradientBar.classList.remove("we-gradient-bar--dragging");
      session.thumbElement.classList.remove("we-gradient-thumb--dragging");
      try {
        session.thumbElement.releasePointerCapture(session.pointerId);
      } catch (e) {
      }
      if (commit) {
        sortCurrentStopsByPosition();
        previewGradient();
        commitTransaction();
        syncAllFields();
      } else {
        restoreStopPositions(session.initialPositions);
        rollbackTransaction();
        syncAllFields(true);
      }
    }
    function calculatePositionFromPointer(clientX) {
      const rect = gradientBar.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      const relativeX = clientX - rect.left;
      const rawPercent = relativeX / rect.width * 100;
      return clampPercent(rawPercent);
    }
    function startThumbKeyboardSession(stopId, thumbElement) {
      if (thumbDrag) return;
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      if ((thumbKeyboard == null ? void 0 : thumbKeyboard.stopId) === stopId) return;
      if (thumbKeyboard) {
        endThumbKeyboard(true);
      }
      const initialPositions = /* @__PURE__ */ new Map();
      for (const stop of currentStops) {
        initialPositions.set(stop.id, stop.position);
      }
      thumbKeyboard = { stopId, initialPositions, thumbElement };
      beginTransaction();
    }
    function endThumbKeyboard(commit) {
      const session = thumbKeyboard;
      if (!session) return;
      thumbKeyboard = null;
      if (commit) {
        sortCurrentStopsByPosition();
        previewGradient();
        commitTransaction();
        syncAllFields();
      } else {
        restoreStopPositions(session.initialPositions);
        rollbackTransaction();
        syncAllFields(true);
      }
    }
    function handleThumbFocus(event) {
      if (thumbDrag) return;
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      const thumb = event.currentTarget;
      const stopId = thumb.dataset.stopId;
      if (!stopId) return;
      if (selectedStopId !== stopId) {
        selectedStopId = stopId;
        updateGradientBar({ preserveThumbs: true });
      }
    }
    function handleThumbBlur(event) {
      const session = thumbKeyboard;
      if (!session) return;
      const thumb = event.currentTarget;
      if (thumb !== session.thumbElement) return;
      endThumbKeyboard(true);
    }
    function handleThumbKeyDown(event) {
      if (event.metaKey || event.ctrlKey) return;
      if (thumbDrag) return;
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      const thumb = event.currentTarget;
      const stopId = thumb.dataset.stopId;
      if (!stopId) return;
      if (event.key === "Escape") {
        const session = thumbKeyboard;
        if (!session || session.stopId !== stopId) return;
        event.preventDefault();
        event.stopPropagation();
        endThumbKeyboard(false);
        return;
      }
      const isArrow = event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown";
      if (!isArrow) return;
      event.preventDefault();
      event.stopPropagation();
      const sign = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
      const step = event.shiftKey ? 10 : 1;
      const delta = sign * step;
      selectedStopId = stopId;
      startThumbKeyboardSession(stopId, thumb);
      const idx = currentStops.findIndex((s) => s.id === stopId);
      if (idx < 0) return;
      setStopPositionById(stopId, currentStops[idx].position + delta);
      previewGradient();
    }
    function syncThumbSliderAria(thumb, position) {
      const clamped = clampPercent(position);
      const rounded = Math.round(clamped * 100) / 100;
      const value = Object.is(rounded, -0) ? 0 : rounded;
      thumb.setAttribute("role", "slider");
      thumb.setAttribute("aria-label", "Gradient stop position");
      thumb.setAttribute("aria-valuemin", "0");
      thumb.setAttribute("aria-valuemax", "100");
      thumb.setAttribute("aria-valuenow", String(value));
      thumb.setAttribute("aria-valuetext", `${value}%`);
      thumb.setAttribute("aria-orientation", "horizontal");
    }
    const stopColorProbe = document.createElement("div");
    stopColorProbe.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;opacity:0";
    root.append(stopColorProbe);
    disposer.add(() => stopColorProbe.remove());
    function resolveCssColorToRgba(raw) {
      const trimmed = raw.trim();
      if (!trimmed) return null;
      const lower = trimmed.toLowerCase();
      if (lower === "transparent") {
        return { r: 0, g: 0, b: 0, a: 0 };
      }
      const fromHex = parseHexColorToRgba(trimmed);
      if (fromHex) return fromHex;
      const fromRgb = parseRgbColorToRgba(trimmed);
      if (fromRgb) return fromRgb;
      try {
        stopColorProbe.style.color = "";
        stopColorProbe.style.color = trimmed;
        if (!stopColorProbe.style.color) return null;
        const computed = getComputedStyle(stopColorProbe).color;
        return parseRgbColorToRgba(computed);
      } catch (e) {
        return null;
      }
    }
    function sortCurrentStopsByPosition() {
      if (currentStops.length <= 1) return;
      const indexed = currentStops.map((stop, index) => ({ stop, index }));
      indexed.sort((a, b) => a.stop.position - b.stop.position || a.index - b.index);
      currentStops = indexed.map((entry) => entry.stop);
    }
    function interpolateNewStopColor(position) {
      const clamped = clampPercent(position);
      const models = currentStops.length >= 2 ? currentStops : createDefaultStopModels();
      if (models.length === 0) return DEFAULT_STOP_1.color;
      const sorted = models.slice().sort((a, b) => a.position - b.position);
      let left = sorted[0];
      let right = sorted[sorted.length - 1];
      for (const stop of sorted) {
        if (stop.position <= clamped) left = stop;
        if (stop.position >= clamped) {
          right = stop;
          break;
        }
      }
      const leftRgba = resolveCssColorToRgba(getStopPreviewColor(left));
      const rightRgba = resolveCssColorToRgba(getStopPreviewColor(right));
      if (!leftRgba && !rightRgba) {
        return left.color.trim() || DEFAULT_STOP_1.color;
      }
      if (!leftRgba) return rgbaToCss(rightRgba);
      if (!rightRgba) return rgbaToCss(leftRgba);
      const span = right.position - left.position;
      if (!Number.isFinite(span) || span <= 0) {
        return rgbaToCss(leftRgba);
      }
      const t = clampNumber((clamped - left.position) / span, 0, 1);
      return rgbaToCss(interpolateRgba(leftRgba, rightRgba, t));
    }
    function getSuggestedAddStopPosition() {
      const selectedId = selectedStopId;
      if (!selectedId) return DEFAULT_POSITION;
      const models = currentStops.length >= 2 ? currentStops : createDefaultStopModels();
      const sorted = models.slice().sort((a, b) => a.position - b.position);
      const index = sorted.findIndex((s) => s.id === selectedId);
      if (index < 0) return DEFAULT_POSITION;
      const current = sorted[index];
      const next = sorted[index + 1];
      const prev = sorted[index - 1];
      if (next) return clampPercent((current.position + next.position) / 2);
      if (prev) return clampPercent((prev.position + current.position) / 2);
      return DEFAULT_POSITION;
    }
    function pickClosestStopId(position) {
      if (currentStops.length === 0) return null;
      let best = currentStops[0];
      let bestDistance = Math.abs(best.position - position);
      for (let i = 1; i < currentStops.length; i++) {
        const candidate = currentStops[i];
        const distance = Math.abs(candidate.position - position);
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
          continue;
        }
        if (distance === bestDistance) {
          const candidateOnRight = candidate.position >= position;
          const bestOnRight = best.position >= position;
          if (candidateOnRight && !bestOnRight) {
            best = candidate;
          }
        }
      }
      return best.id;
    }
    function addStopAtPosition(position, opts = {}) {
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      const clamped = clampPercent(position);
      const newStop = {
        id: createStopId(),
        position: clamped,
        color: interpolateNewStopColor(clamped)
      };
      currentStops.push(newStop);
      selectedStopId = newStop.id;
      sortCurrentStopsByPosition();
      previewGradient();
      commitTransaction();
      if (opts.focusColor) {
        queueMicrotask(() => {
          const input = selectedStopColorHost.querySelector("input.we-color-text");
          input == null ? void 0 : input.focus();
        });
      }
    }
    function removeStopById(stopId) {
      var _a3, _b3;
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      if (currentStops.length <= 2) return;
      const index = currentStops.findIndex((s) => s.id === stopId);
      if (index < 0) return;
      const removed = currentStops[index];
      currentStops.splice(index, 1);
      if (selectedStopId === stopId) {
        selectedStopId = pickClosestStopId(removed.position);
        if (!selectedStopId) {
          selectedStopId = (_b3 = (_a3 = currentStops[0]) == null ? void 0 : _a3.id) != null ? _b3 : null;
        }
      }
      sortCurrentStopsByPosition();
      previewGradient();
      commitTransaction();
    }
    function isTextInputLike(target) {
      return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLElement && target.isContentEditable;
    }
    function updateGradientBar(options2 = {}) {
      var _a3, _b3, _c, _d;
      const refreshStopsList = (_a3 = options2.refreshStopsList) != null ? _a3 : true;
      const preserveThumbs = (_b3 = options2.preserveThumbs) != null ? _b3 : false;
      if (currentType === "none") {
        gradientBar.style.backgroundImage = "none";
        gradientThumbs.textContent = "";
        if (refreshStopsList) updateStopsList([], [], []);
        return;
      }
      const stops = collectCurrentStops();
      if (stops.length === 0) {
        gradientBar.style.backgroundImage = "none";
        gradientThumbs.textContent = "";
        if (refreshStopsList) updateStopsList([], [], []);
        return;
      }
      const previewStops = stops.map((stop, i) => {
        var _a4;
        const model = currentStops[i];
        const previewColor = needsColorPlaceholder(stop.color) ? ((_a4 = model == null ? void 0 : model.placeholderColor) == null ? void 0 : _a4.trim()) || "transparent" : stop.color;
        return { color: previewColor, position: stop.position };
      });
      gradientBar.style.backgroundImage = buildPreviewBarCss(previewStops);
      const models = currentStops.length >= 2 ? currentStops : createDefaultStopModels();
      if (!selectedStopId || !models.some((s) => s.id === selectedStopId)) {
        selectedStopId = (_d = (_c = models[0]) == null ? void 0 : _c.id) != null ? _d : null;
      }
      if (preserveThumbs) {
        const existingThumbs = gradientThumbs.querySelectorAll(".we-gradient-thumb");
        for (const thumb of existingThumbs) {
          const stopId = thumb.dataset.stopId;
          if (!stopId) continue;
          const modelIndex = models.findIndex((m) => m.id === stopId);
          if (modelIndex < 0) continue;
          const stop = stops[modelIndex];
          const preview = previewStops[modelIndex];
          if (!stop || !preview) continue;
          thumb.style.left = `${clampPercent(stop.position)}%`;
          thumb.style.backgroundColor = preview.color;
          syncThumbSliderAria(thumb, stop.position);
          const isActive = stopId === selectedStopId;
          thumb.classList.toggle("we-gradient-thumb--active", isActive);
        }
      } else {
        gradientThumbs.textContent = "";
        for (let i = 0; i < stops.length; i++) {
          const model = models[i];
          const stop = stops[i];
          const preview = previewStops[i];
          if (!model || !stop || !preview) continue;
          const thumb = document.createElement("button");
          thumb.type = "button";
          thumb.className = model.id === selectedStopId ? "we-gradient-thumb we-gradient-thumb--active" : "we-gradient-thumb";
          thumb.dataset.stopId = model.id;
          thumb.style.left = `${clampPercent(stop.position)}%`;
          thumb.style.backgroundColor = preview.color;
          syncThumbSliderAria(thumb, stop.position);
          thumb.addEventListener("pointerdown", handleThumbPointerDown);
          thumb.addEventListener("keydown", handleThumbKeyDown);
          thumb.addEventListener("focus", handleThumbFocus);
          thumb.addEventListener("blur", handleThumbBlur);
          gradientThumbs.append(thumb);
        }
      }
      if (refreshStopsList && !preserveThumbs) {
        updateStopsList(models, stops, previewStops);
      }
    }
    function handleThumbPointerDown(event) {
      if (thumbDrag) return;
      if (currentType === "none") return;
      if (typeSelect.disabled) return;
      if (event.button !== 0) return;
      if (!event.isPrimary) return;
      const thumb = event.currentTarget;
      const stopId = thumb.dataset.stopId;
      if (!stopId) return;
      if (thumbKeyboard) {
        thumbKeyboard = null;
      }
      event.preventDefault();
      event.stopPropagation();
      selectedStopId = stopId;
      const initialPositions = /* @__PURE__ */ new Map();
      for (const stop of currentStops) {
        initialPositions.set(stop.id, stop.position);
      }
      thumbDrag = {
        stopId,
        pointerId: event.pointerId,
        initialPositions,
        thumbElement: thumb
      };
      gradientBar.classList.add("we-gradient-bar--dragging");
      thumb.classList.add("we-gradient-thumb--dragging");
      try {
        thumb.setPointerCapture(event.pointerId);
      } catch (e) {
      }
      beginTransaction();
      updateGradientBar({ preserveThumbs: true, refreshStopsList: false });
    }
    function handleThumbPointerMove(event) {
      const session = thumbDrag;
      if (!session) return;
      if (event.pointerId !== session.pointerId) return;
      const newPosition = calculatePositionFromPointer(event.clientX);
      setStopPositionById(session.stopId, newPosition);
      previewGradient();
    }
    function handleThumbPointerUp(event) {
      const session = thumbDrag;
      if (!session) return;
      if (event.pointerId !== session.pointerId) return;
      endThumbDrag(true);
    }
    function handleThumbPointerCancel(event) {
      const session = thumbDrag;
      if (!session) return;
      if (event.pointerId !== session.pointerId) return;
      endThumbDrag(false);
    }
    function handleDragKeyDown(event) {
      if (!thumbDrag) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
        endThumbDrag(false);
      }
    }
    const DRAG_LISTENER_OPTIONS = { capture: true, passive: false };
    disposer.listen(window, "pointermove", handleThumbPointerMove, DRAG_LISTENER_OPTIONS);
    disposer.listen(window, "pointerup", handleThumbPointerUp, DRAG_LISTENER_OPTIONS);
    disposer.listen(window, "pointercancel", handleThumbPointerCancel, DRAG_LISTENER_OPTIONS);
    disposer.listen(window, "keydown", handleDragKeyDown, DRAG_LISTENER_OPTIONS);
    function updateStopsList(models, stops, previewStops) {
      var _a3;
      stopsList.textContent = "";
      if (currentType === "none") return;
      if (models.length === 0 || stops.length === 0) return;
      const formatPercentValue = (value) => {
        const clamped = clampPercent(value);
        const rounded = Math.round(clamped * 100) / 100;
        return Object.is(rounded, -0) ? 0 : rounded;
      };
      const formatPercentLabel = (value) => `${formatPercentValue(value)}%`;
      const rows = stops.map((stop, index) => ({
        index,
        stop,
        model: models[index],
        preview: previewStops[index]
      })).filter((r) => Boolean(r.model && r.preview)).sort((a, b) => a.stop.position - b.stop.position || a.index - b.index);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const r = rows[rowIndex];
        const model = r.model;
        const stop = r.stop;
        const preview = r.preview;
        const isActive = model.id === selectedStopId;
        const row = document.createElement("div");
        row.className = isActive ? "we-gradient-stop-row we-gradient-stop-row--active" : "we-gradient-stop-row";
        row.dataset.stopId = model.id;
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        row.setAttribute("aria-label", `Select stop at ${formatPercentLabel(stop.position)}`);
        const pos = document.createElement("div");
        pos.className = "we-gradient-stop-pos";
        const posStatic = document.createElement("span");
        posStatic.className = "we-gradient-stop-pos-static";
        posStatic.textContent = formatPercentLabel(stop.position);
        const posEditor = document.createElement("div");
        posEditor.className = "we-gradient-stop-pos-editor";
        if (isActive) {
          posEditor.append(selectedStopPosHost);
          if (!isPositionInputFocused()) {
            selectedStopPosInput.value = String(formatPercentValue(stop.position));
          }
        }
        pos.append(posStatic, posEditor);
        const color = document.createElement("div");
        color.className = "we-gradient-stop-color";
        const colorStatic = document.createElement("button");
        colorStatic.type = "button";
        colorStatic.className = "we-gradient-stop-color-static";
        colorStatic.tabIndex = -1;
        colorStatic.setAttribute("aria-label", "Select stop");
        const swatch = document.createElement("span");
        swatch.className = "we-gradient-stop-swatch";
        swatch.style.backgroundColor = preview.color;
        const text = document.createElement("span");
        text.className = "we-gradient-stop-color-text";
        text.textContent = stop.color.trim() || DEFAULT_STOP_1.color;
        colorStatic.append(swatch, text);
        const colorEditor = document.createElement("div");
        colorEditor.className = "we-gradient-stop-color-editor";
        if (isActive) {
          colorEditor.append(selectedStopColorHost);
          if (!selectedStopColorField.isFocused()) {
            selectedStopColorField.setValue(stop.color);
            selectedStopColorField.setPlaceholder(
              needsColorPlaceholder(stop.color) ? (_a3 = model.placeholderColor) != null ? _a3 : "" : ""
            );
          }
        }
        color.append(colorStatic, colorEditor);
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "we-icon-btn we-gradient-stop-remove";
        removeBtn.setAttribute("aria-label", "Remove stop");
        const canRemove = !typeSelect.disabled && models.length > 2;
        removeBtn.disabled = !canRemove;
        removeBtn.textContent = "–";
        removeBtn.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          removeStopById(model.id);
        });
        const focusSelectedPosInput = () => {
          queueMicrotask(() => {
            selectedStopPosInput.focus();
            selectedStopPosInput.select();
          });
        };
        const focusSelectedColorField = () => {
          queueMicrotask(() => {
            const input = selectedStopColorHost.querySelector("input.we-color-text");
            input == null ? void 0 : input.focus();
          });
        };
        const selectThisRow = (opts) => {
          selectedStopId = model.id;
          updateGradientBar();
          if (opts == null ? void 0 : opts.focusColor) focusSelectedColorField();
          if (opts == null ? void 0 : opts.focusPosition) focusSelectedPosInput();
        };
        row.addEventListener("click", (event) => {
          if (model.id === selectedStopId) return;
          event.preventDefault();
          selectThisRow();
        });
        row.addEventListener("keydown", (event) => {
          var _a4;
          if (isTextInputLike(event.target)) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            event.stopPropagation();
            const nextIndex = event.key === "ArrowUp" ? Math.max(0, rowIndex - 1) : Math.min(rows.length - 1, rowIndex + 1);
            if (nextIndex === rowIndex) return;
            const nextModel = (_a4 = rows[nextIndex]) == null ? void 0 : _a4.model;
            if (!nextModel) return;
            selectedStopId = nextModel.id;
            updateGradientBar();
            queueMicrotask(() => {
              const nextRow = stopsList.querySelector(
                `.we-gradient-stop-row[data-stop-id="${nextModel.id}"]`
              );
              nextRow == null ? void 0 : nextRow.focus();
            });
            return;
          }
          if (model.id !== selectedStopId && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            selectThisRow();
          }
        });
        posStatic.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (model.id === selectedStopId) {
            focusSelectedPosInput();
            return;
          }
          selectThisRow({ focusPosition: true });
        });
        colorStatic.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (model.id === selectedStopId) {
            focusSelectedColorField();
            return;
          }
          selectThisRow({ focusColor: true });
        });
        row.append(pos, color, removeBtn);
        stopsList.append(row);
      }
    }
    function updateRowVisibility() {
      gradientBarRow.hidden = currentType === "none";
      angleRow.hidden = currentType !== "linear";
      shapeRow.hidden = currentType !== "radial";
      posXRow.hidden = currentType !== "radial";
      posYRow.hidden = currentType !== "radial";
      stopsHeaderRow.hidden = currentType === "none";
      stopsList.hidden = currentType === "none";
      stopsAddBtn.disabled = typeSelect.disabled || currentType === "none";
    }
    function setAllDisabled(disabled) {
      typeSelect.disabled = disabled;
      angleInput.disabled = disabled;
      shapeSelect.disabled = disabled;
      posXInput.disabled = disabled;
      posYInput.disabled = disabled;
      stopsAddBtn.disabled = disabled;
      selectedStopPosInput.disabled = disabled || currentType === "none";
      selectedStopColorField.setDisabled(disabled || currentType === "none");
    }
    function resetDefaults(options2 = {}) {
      var _a3, _b3;
      angleInput.value = String(DEFAULT_LINEAR_ANGLE);
      shapeSelect.value = "ellipse";
      posXInput.value = "";
      posYInput.value = "";
      currentStops = createDefaultStopModels();
      selectedStopId = (_b3 = (_a3 = currentStops[0]) == null ? void 0 : _a3.id) != null ? _b3 : null;
      if (!options2.skipPreview) {
        updateGradientBar();
      }
    }
    function isPositionInputFocused() {
      return isFieldFocused$4(selectedStopPosInput);
    }
    function isEditing() {
      return backgroundHandle !== null || isFieldFocused$4(typeSelect) || isFieldFocused$4(angleInput) || isFieldFocused$4(shapeSelect) || isFieldFocused$4(posXInput) || isFieldFocused$4(posYInput) || isPositionInputFocused() || selectedStopColorField.isFocused();
    }
    function formatStopList(stops) {
      return stops.map((s) => {
        const color = s.color.trim() || DEFAULT_STOP_1.color;
        const pos = clampPercent(s.position);
        return `${color} ${pos}%`;
      }).join(", ");
    }
    function buildElementGradientCss(stops) {
      var _a3, _b3, _c;
      if (currentType === "none" || stops.length === 0) {
        return "none";
      }
      const stopsText = formatStopList(stops);
      if (currentType === "linear") {
        const angle = clampAngle((_a3 = parseNumber$1(angleInput.value)) != null ? _a3 : DEFAULT_LINEAR_ANGLE);
        return `linear-gradient(${angle}deg, ${stopsText})`;
      }
      const shape = shapeSelect.value || "ellipse";
      const rawX = posXInput.value.trim();
      const rawY = posYInput.value.trim();
      const hasPosition = Boolean(rawX || rawY);
      if (!hasPosition) {
        return `radial-gradient(${shape}, ${stopsText})`;
      }
      const x = clampPercent((_b3 = parseNumber$1(rawX)) != null ? _b3 : DEFAULT_POSITION);
      const y = clampPercent((_c = parseNumber$1(rawY)) != null ? _c : DEFAULT_POSITION);
      return `radial-gradient(${shape} at ${x}% ${y}%, ${stopsText})`;
    }
    function buildPreviewBarCss(stops) {
      if (stops.length === 0) {
        return "linear-gradient(90deg, transparent, transparent)";
      }
      const stopsText = formatStopList(stops);
      return `linear-gradient(90deg, ${stopsText})`;
    }
    function collectCurrentStops() {
      const baseStops = currentStops.length >= 2 ? currentStops : createDefaultStopModels();
      return baseStops.map((s) => ({
        color: s.color.trim() || DEFAULT_STOP_1.color,
        position: clampPercent(s.position)
      }));
    }
    function buildGradientValue() {
      if (currentType === "none") return "none";
      const stops = collectCurrentStops();
      return buildElementGradientCss(stops);
    }
    function previewGradient() {
      if (disposer.isDisposed) return;
      const isDragging = thumbDrag !== null;
      const isKeyboardStepping = thumbKeyboard !== null;
      const isEditingStopFields = selectedStopColorField.isFocused() || isPositionInputFocused();
      updateGradientBar({
        preserveThumbs: isDragging || isKeyboardStepping,
        refreshStopsList: isDragging || isKeyboardStepping ? false : !isEditingStopFields
      });
      const target = currentTarget;
      if (!target || !target.isConnected) return;
      const handle = beginTransaction();
      if (!handle) return;
      handle.set(buildGradientValue());
    }
    function syncAllFields(force = false) {
      var _a3, _b3, _c;
      const target = currentTarget;
      if (!target || !target.isConnected) {
        setAllDisabled(true);
        const defaultType = allowNone ? "none" : "linear";
        currentType = defaultType;
        typeSelect.value = defaultType;
        resetDefaults();
        updateRowVisibility();
        updateGradientBar();
        return;
      }
      setAllDisabled(false);
      if (isEditing() && !force) return;
      const inlineValue = readInlineValue$5(target, cssProperty);
      const needsComputed = !inlineValue || /\bvar\s*\(/i.test(inlineValue);
      const computedValue = needsComputed ? readComputedValue$4(target, cssProperty) : "";
      const inlineParsed = !isNoneValue(inlineValue) ? parseGradient(inlineValue) : null;
      const computedParsed = !isNoneValue(computedValue) ? parseGradient(computedValue) : null;
      let parsed = null;
      let source = "none";
      if (inlineValue.trim()) {
        if (isNoneValue(inlineValue)) {
          parsed = null;
          source = "none";
        } else if (inlineParsed) {
          parsed = inlineParsed;
          source = "inline";
        } else {
          parsed = null;
          source = "none";
        }
      } else {
        if (isNoneValue(computedValue)) {
          parsed = null;
          source = "none";
        } else if (computedParsed) {
          parsed = computedParsed;
          source = "computed";
        } else {
          parsed = null;
          source = "none";
        }
      }
      resetDefaults({ skipPreview: true });
      if (!parsed) {
        const defaultType = allowNone ? "none" : "linear";
        currentType = defaultType;
        typeSelect.value = defaultType;
        updateRowVisibility();
        updateGradientBar();
        return;
      }
      const rawStops = parsed.stops.length >= 2 ? parsed.stops.slice() : [__spreadValues({}, DEFAULT_STOP_1), __spreadValues({}, DEFAULT_STOP_2)];
      const hasVarInInline = source === "inline" && needsColorPlaceholder(inlineValue);
      if (hasVarInInline && computedParsed) {
        const placeholderColors = buildPlaceholderMapping(rawStops, computedParsed.stops);
        for (let i = 0; i < rawStops.length; i++) {
          rawStops[i].placeholderColor = (_a3 = placeholderColors[i]) != null ? _a3 : "";
        }
      }
      currentStops = reconcileStopModels(currentStops, rawStops);
      if (!selectedStopId || !currentStops.some((s) => s.id === selectedStopId)) {
        selectedStopId = (_c = (_b3 = currentStops[0]) == null ? void 0 : _b3.id) != null ? _c : null;
      }
      if (parsed.type === "linear") {
        currentType = "linear";
        typeSelect.value = "linear";
        angleInput.value = String(parsed.angle);
      } else {
        currentType = "radial";
        typeSelect.value = "radial";
        shapeSelect.value = parsed.shape;
        if (parsed.position) {
          posXInput.value = String(parsed.position.x);
          posYInput.value = String(parsed.position.y);
        } else {
          posXInput.value = "";
          posYInput.value = "";
        }
      }
      updateRowVisibility();
      updateGradientBar();
    }
    function wireTextInput(input) {
      disposer.listen(input, "input", previewGradient);
      disposer.listen(input, "blur", () => {
        commitTransaction();
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction();
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction();
          syncAllFields(true);
        }
      });
    }
    function wireSelect(select, onPreview) {
      const preview = () => {
        onPreview == null ? void 0 : onPreview();
        previewGradient();
      };
      disposer.listen(select, "input", preview);
      disposer.listen(select, "change", preview);
      disposer.listen(select, "blur", () => {
        commitTransaction();
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction();
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction();
          syncAllFields(true);
        }
      });
    }
    wireSelect(typeSelect, () => {
      currentType = typeSelect.value;
      updateRowVisibility();
    });
    wireSelect(shapeSelect);
    wireTextInput(angleInput);
    wireTextInput(posXInput);
    wireTextInput(posYInput);
    disposer.listen(stopsAddBtn, "click", (event) => {
      event.preventDefault();
      if (stopsAddBtn.disabled) return;
      addStopAtPosition(getSuggestedAddStopPosition(), { focusColor: true });
    });
    disposer.listen(gradientBar, "dblclick", (event) => {
      if (thumbDrag) return;
      if (currentType === "none" || typeSelect.disabled) return;
      const path = event.composedPath();
      if (path.some((el) => el instanceof HTMLElement && el.classList.contains("we-gradient-thumb"))) {
        return;
      }
      event.preventDefault();
      addStopAtPosition(calculatePositionFromPointer(event.clientX), { focusColor: true });
    });
    disposer.listen(root, "keydown", (event) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (thumbDrag) return;
      if (currentType === "none" || typeSelect.disabled) return;
      const id = selectedStopId;
      if (!id) return;
      if (isTextInputLike(event.target)) return;
      const path = event.composedPath();
      if (!path.includes(stopsList) && !path.includes(gradientBar)) return;
      event.preventDefault();
      event.stopPropagation();
      removeStopById(id);
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitTransaction();
      currentTarget = element;
      syncAllFields(true);
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitTransaction();
      currentTarget = null;
      disposer.dispose();
    }
    typeSelect.value = currentType;
    resetDefaults();
    updateRowVisibility();
    syncAllFields(true);
    return { setTarget, refresh, dispose };
  }
  const SVG_NS$2 = "http://www.w3.org/2000/svg";
  const FONT_WEIGHT_VALUES = ["100", "200", "300", "400", "500", "600", "700", "800", "900"];
  const TEXT_ALIGN_VALUES = ["left", "center", "right", "justify"];
  const VERTICAL_ALIGN_VALUES = ["baseline", "middle", "top", "bottom"];
  const TEXT_COLOR_TYPE_VALUES = ["solid", "gradient"];
  const FONT_FAMILY_PRESET_VALUES = [
    "inherit",
    "system-ui",
    "sans-serif",
    "serif",
    "monospace"
  ];
  const FONT_FAMILY_CUSTOM_VALUE = "custom";
  function createBaseIconSvg() {
    const svg = document.createElementNS(SVG_NS$2, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return svg;
  }
  function createTextAlignIcon(value) {
    const svg = createBaseIconSvg();
    const container = document.createElementNS(SVG_NS$2, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    const lineConfigs = {
      left: [
        [3.5, 8],
        // 长行
        [3.5, 5],
        // 短行
        [3.5, 6.5]
        // 中行
      ],
      center: [
        [3.5, 8],
        // 长行居中
        [5, 5],
        // 短行居中
        [4.25, 6.5]
        // 中行居中
      ],
      right: [
        [3.5, 8],
        // 长行
        [6.5, 5],
        // 短行靠右
        [5.5, 6.5]
        // 中行靠右
      ],
      justify: [
        [3.5, 8],
        // 全宽
        [3.5, 8],
        // 全宽
        [3.5, 8]
        // 全宽
      ]
    };
    const yPositions = [4.5, 7.5, 10.5];
    const configs = lineConfigs[value];
    configs.forEach(([x, width], index) => {
      const line = document.createElementNS(SVG_NS$2, "rect");
      line.setAttribute("x", String(x));
      line.setAttribute("y", String(yPositions[index] - 0.5));
      line.setAttribute("width", String(width));
      line.setAttribute("height", "1");
      line.setAttribute("rx", "0.5");
      line.setAttribute("fill", "currentColor");
      svg.append(line);
    });
    svg.prepend(container);
    return svg;
  }
  function createVerticalAlignIcon(value) {
    const svg = createBaseIconSvg();
    const container = document.createElementNS(SVG_NS$2, "rect");
    container.setAttribute("x", "2");
    container.setAttribute("y", "2");
    container.setAttribute("width", "11");
    container.setAttribute("height", "11");
    container.setAttribute("rx", "1.5");
    container.setAttribute("stroke", "currentColor");
    container.setAttribute("stroke-width", "1");
    container.setAttribute("stroke-dasharray", "2 1");
    container.setAttribute("fill", "none");
    container.setAttribute("opacity", "0.5");
    const blockY = {
      top: 3.5,
      // 顶部对齐
      middle: 5.5,
      // 居中对齐
      bottom: 7.5,
      // 底部对齐
      baseline: 6.5
      // baseline 稍微偏下
    };
    const block1 = document.createElementNS(SVG_NS$2, "rect");
    block1.setAttribute("x", "4");
    block1.setAttribute("y", String(blockY[value]));
    block1.setAttribute("width", "3");
    block1.setAttribute("height", "4");
    block1.setAttribute("rx", "0.5");
    block1.setAttribute("fill", "currentColor");
    const block2 = document.createElementNS(SVG_NS$2, "rect");
    block2.setAttribute("x", "8");
    block2.setAttribute("y", String(blockY[value]));
    block2.setAttribute("width", "3");
    block2.setAttribute("height", "4");
    block2.setAttribute("rx", "0.5");
    block2.setAttribute("fill", "currentColor");
    svg.append(container, block1, block2);
    if (value === "baseline") {
      const baselinePath = document.createElementNS(SVG_NS$2, "path");
      baselinePath.setAttribute("d", "M3 10H12");
      baselinePath.setAttribute("stroke", "currentColor");
      baselinePath.setAttribute("stroke-width", "1");
      baselinePath.setAttribute("stroke-dasharray", "1.5 1");
      svg.append(baselinePath);
    }
    return svg;
  }
  function isTextAlignValue(value) {
    return TEXT_ALIGN_VALUES.includes(value);
  }
  function isVerticalAlignValue(value) {
    return VERTICAL_ALIGN_VALUES.includes(value);
  }
  function isFieldFocused$3(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$4(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$3(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function isGradientBackgroundValue(raw) {
    return /\b(?:linear|radial|conic)-gradient\s*\(/i.test(raw.trim());
  }
  function isTransparentTextFillColor(raw) {
    const v = raw.trim().toLowerCase();
    if (!v) return false;
    if (v === "transparent") return true;
    if (/^rgba\([^)]*,\s*0\s*\)$/.test(v)) return true;
    return false;
  }
  function inferTextColorType(target) {
    const bgImage = readInlineValue$4(target, "background-image") || readComputedValue$3(target, "background-image");
    const bgClip = readInlineValue$4(target, "-webkit-background-clip") || readComputedValue$3(target, "-webkit-background-clip");
    const textFill = readInlineValue$4(target, "-webkit-text-fill-color") || readComputedValue$3(target, "-webkit-text-fill-color");
    const hasGradientBg = bgImage && bgImage.toLowerCase() !== "none" && isGradientBackgroundValue(bgImage);
    const hasClipText = bgClip.toLowerCase().includes("text");
    const hasTransparentFill = isTransparentTextFillColor(textFill);
    return hasGradientBg && hasClipText && hasTransparentFill ? "gradient" : "solid";
  }
  function createTypographyControl(options) {
    const { container, transactionManager, tokensService } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentTextColorType = "solid";
    const root = document.createElement("div");
    root.className = "we-field-group";
    const fontFamilyRow = document.createElement("div");
    fontFamilyRow.className = "we-field";
    const fontFamilyLabel = document.createElement("span");
    fontFamilyLabel.className = "we-field-label";
    fontFamilyLabel.textContent = "Font";
    const fontFamilyControls = document.createElement("div");
    fontFamilyControls.className = "we-field-content";
    fontFamilyControls.style.display = "flex";
    fontFamilyControls.style.flexDirection = "column";
    fontFamilyControls.style.gap = "4px";
    const fontFamilySelect = document.createElement("select");
    fontFamilySelect.className = "we-select";
    fontFamilySelect.setAttribute("aria-label", "Font Family");
    for (const v of FONT_FAMILY_PRESET_VALUES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      fontFamilySelect.append(opt);
    }
    const customFontOpt = document.createElement("option");
    customFontOpt.value = FONT_FAMILY_CUSTOM_VALUE;
    customFontOpt.textContent = "Custom…";
    fontFamilySelect.append(customFontOpt);
    const fontFamilyCustomContainer = createInputContainer({
      ariaLabel: "Custom Font Family",
      prefix: null,
      suffix: null,
      placeholder: "e.g. Inter, system-ui"
    });
    fontFamilyCustomContainer.root.style.display = "none";
    fontFamilyCustomContainer.input.disabled = true;
    fontFamilyControls.append(fontFamilySelect, fontFamilyCustomContainer.root);
    fontFamilyRow.append(fontFamilyLabel, fontFamilyControls);
    const fontSizeRow = document.createElement("div");
    fontSizeRow.className = "we-field";
    const fontSizeLabel = document.createElement("span");
    fontSizeLabel.className = "we-field-label";
    fontSizeLabel.textContent = "Size";
    const fontSizeContainer = createInputContainer({
      ariaLabel: "Font Size",
      inputMode: "decimal",
      prefix: null,
      suffix: "px"
    });
    fontSizeRow.append(fontSizeLabel, fontSizeContainer.root);
    const fontWeightRow = document.createElement("div");
    fontWeightRow.className = "we-field";
    const fontWeightLabel = document.createElement("span");
    fontWeightLabel.className = "we-field-label";
    fontWeightLabel.textContent = "Weight";
    const fontWeightSelect = document.createElement("select");
    fontWeightSelect.className = "we-select";
    fontWeightSelect.setAttribute("aria-label", "Font Weight");
    for (const v of FONT_WEIGHT_VALUES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      fontWeightSelect.append(opt);
    }
    fontWeightRow.append(fontWeightLabel, fontWeightSelect);
    const lineHeightRow = document.createElement("div");
    lineHeightRow.className = "we-field";
    const lineHeightLabel = document.createElement("span");
    lineHeightLabel.className = "we-field-label";
    lineHeightLabel.textContent = "Line Height";
    const lineHeightContainer = createInputContainer({
      ariaLabel: "Line Height",
      inputMode: "decimal",
      prefix: null,
      suffix: null
      // Will be set dynamically based on value
    });
    lineHeightRow.append(lineHeightLabel, lineHeightContainer.root);
    const letterSpacingRow = document.createElement("div");
    letterSpacingRow.className = "we-field";
    const letterSpacingLabel = document.createElement("span");
    letterSpacingLabel.className = "we-field-label";
    letterSpacingLabel.textContent = "Spacing";
    const letterSpacingContainer = createInputContainer({
      ariaLabel: "Letter Spacing",
      inputMode: "decimal",
      prefix: null,
      suffix: "px"
    });
    letterSpacingRow.append(letterSpacingLabel, letterSpacingContainer.root);
    wireNumberStepping(disposer, fontSizeContainer.input, { mode: "css-length" });
    wireNumberStepping(disposer, lineHeightContainer.input, {
      mode: "css-length",
      step: 0.1,
      shiftStep: 1,
      altStep: 0.01
    });
    wireNumberStepping(disposer, letterSpacingContainer.input, {
      mode: "css-length",
      step: 0.1,
      shiftStep: 1,
      altStep: 0.01
    });
    const textAlignRow = document.createElement("div");
    textAlignRow.className = "we-field";
    const textAlignLabel = document.createElement("span");
    textAlignLabel.className = "we-field-label";
    textAlignLabel.textContent = "Text Align";
    const textAlignMount = document.createElement("div");
    textAlignMount.className = "we-field-content";
    textAlignRow.append(textAlignLabel, textAlignMount);
    const verticalAlignRow = document.createElement("div");
    verticalAlignRow.className = "we-field";
    const verticalAlignLabel = document.createElement("span");
    verticalAlignLabel.className = "we-field-label";
    verticalAlignLabel.textContent = "Vertical Align";
    const verticalAlignMount = document.createElement("div");
    verticalAlignMount.className = "we-field-content";
    verticalAlignRow.append(verticalAlignLabel, verticalAlignMount);
    const textColorTypeRow = document.createElement("div");
    textColorTypeRow.className = "we-field";
    const textColorTypeLabel = document.createElement("span");
    textColorTypeLabel.className = "we-field-label";
    textColorTypeLabel.textContent = "Type";
    const textColorTypeSelect = document.createElement("select");
    textColorTypeSelect.className = "we-select";
    textColorTypeSelect.setAttribute("aria-label", "Text Color Type");
    for (const v of TEXT_COLOR_TYPE_VALUES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      textColorTypeSelect.append(opt);
    }
    textColorTypeRow.append(textColorTypeLabel, textColorTypeSelect);
    const colorRow = document.createElement("div");
    colorRow.className = "we-field";
    const colorLabel = document.createElement("span");
    colorLabel.className = "we-field-label";
    colorLabel.textContent = "Color";
    const colorFieldContainer = document.createElement("div");
    colorFieldContainer.style.minWidth = "0";
    colorRow.append(colorLabel, colorFieldContainer);
    const textGradientMount = document.createElement("div");
    const sizeAndWeightRow = document.createElement("div");
    sizeAndWeightRow.className = "we-field-row";
    fontSizeRow.style.flex = "1";
    fontSizeRow.style.minWidth = "0";
    fontWeightRow.style.flex = "1";
    fontWeightRow.style.minWidth = "0";
    sizeAndWeightRow.append(fontSizeRow, fontWeightRow);
    const lineHeightAndSpacingRow = document.createElement("div");
    lineHeightAndSpacingRow.className = "we-field-row";
    lineHeightRow.style.flex = "1";
    lineHeightRow.style.minWidth = "0";
    letterSpacingRow.style.flex = "1";
    letterSpacingRow.style.minWidth = "0";
    lineHeightAndSpacingRow.append(lineHeightRow, letterSpacingRow);
    root.append(
      fontFamilyRow,
      sizeAndWeightRow,
      lineHeightAndSpacingRow,
      textAlignRow,
      verticalAlignRow,
      textColorTypeRow,
      colorRow,
      textGradientMount
    );
    container.append(root);
    disposer.add(() => root.remove());
    const textAlignGroup = createIconButtonGroup({
      container: textAlignMount,
      ariaLabel: "Text Align",
      columns: 4,
      items: TEXT_ALIGN_VALUES.map((v) => ({
        value: v,
        ariaLabel: `text-align: ${v}`,
        title: v.charAt(0).toUpperCase() + v.slice(1),
        icon: createTextAlignIcon(v)
      })),
      onChange: (value) => {
        const handle = beginTransaction("text-align");
        if (handle) handle.set(value);
        commitTransaction("text-align");
        syncAllFields();
      }
    });
    disposer.add(() => textAlignGroup.dispose());
    const verticalAlignGroup = createIconButtonGroup({
      container: verticalAlignMount,
      ariaLabel: "Vertical Align",
      columns: 4,
      items: VERTICAL_ALIGN_VALUES.map((v) => ({
        value: v,
        ariaLabel: `vertical-align: ${v}`,
        title: v.charAt(0).toUpperCase() + v.slice(1),
        icon: createVerticalAlignIcon(v)
      })),
      onChange: (value) => {
        const handle = beginTransaction("vertical-align");
        if (handle) handle.set(value);
        commitTransaction("vertical-align");
        syncAllFields();
      }
    });
    disposer.add(() => verticalAlignGroup.dispose());
    const textColorField = createColorField({
      container: colorFieldContainer,
      ariaLabel: "Text Color",
      tokensService,
      getTokenTarget: () => currentTarget,
      onInput: (value) => {
        const handle = beginTransaction("color");
        if (handle) handle.set(value);
      },
      onCommit: () => {
        commitTransaction("color");
        syncAllFields();
      },
      onCancel: () => {
        rollbackTransaction("color");
        syncField("color", true);
      }
    });
    disposer.add(() => textColorField.dispose());
    const textGradientControl = createGradientControl({
      container: textGradientMount,
      transactionManager,
      tokensService,
      property: "background-image",
      // Disable 'none' option since transparent text-fill-color with no background
      // would make text invisible
      allowNone: false
    });
    disposer.add(() => textGradientControl.dispose());
    const fields = {
      "font-family": {
        kind: "font-family",
        property: "font-family",
        select: fontFamilySelect,
        custom: fontFamilyCustomContainer,
        controlsContainer: fontFamilyControls,
        handle: null
      },
      "font-size": {
        kind: "standard",
        property: "font-size",
        element: fontSizeContainer.input,
        container: fontSizeContainer,
        handle: null
      },
      "font-weight": {
        kind: "standard",
        property: "font-weight",
        element: fontWeightSelect,
        handle: null
      },
      "line-height": {
        kind: "standard",
        property: "line-height",
        element: lineHeightContainer.input,
        container: lineHeightContainer,
        handle: null
      },
      "letter-spacing": {
        kind: "standard",
        property: "letter-spacing",
        element: letterSpacingContainer.input,
        container: letterSpacingContainer,
        handle: null
      },
      "text-align": {
        kind: "text-align",
        property: "text-align",
        group: textAlignGroup,
        handle: null
      },
      "vertical-align": {
        kind: "vertical-align",
        property: "vertical-align",
        group: verticalAlignGroup,
        handle: null
      },
      color: { kind: "color", property: "color", field: textColorField, handle: null }
    };
    const PROPS = [
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "letter-spacing",
      "text-align",
      "vertical-align",
      "color"
    ];
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of PROPS) commitTransaction(p);
    }
    function updateTextColorTypeVisibility() {
      colorRow.hidden = currentTextColorType !== "solid";
      textGradientMount.hidden = currentTextColorType !== "gradient";
    }
    function setTextColorType(type) {
      const target = currentTarget;
      currentTextColorType = type;
      textColorTypeSelect.value = type;
      updateTextColorTypeVisibility();
      if (!target || !target.isConnected) return;
      commitTransaction("color");
      const handle = transactionManager.beginMultiStyle(target, [
        "background-image",
        "-webkit-background-clip",
        "-webkit-text-fill-color"
      ]);
      if (!handle) return;
      if (type === "solid") {
        handle.set({
          "background-image": "",
          "-webkit-background-clip": "",
          "-webkit-text-fill-color": ""
        });
      } else {
        const inlineBg = readInlineValue$4(target, "background-image");
        const computedBg = readComputedValue$3(target, "background-image");
        const currentBg = inlineBg || computedBg;
        const hasValidGradient = currentBg && isGradientBackgroundValue(currentBg);
        const gradientValue = hasValidGradient ? currentBg : "linear-gradient(90deg, #000000, #ffffff)";
        handle.set({
          "background-image": gradientValue,
          "-webkit-background-clip": "text",
          "-webkit-text-fill-color": "transparent"
        });
      }
      handle.commit({ merge: true });
    }
    disposer.listen(textColorTypeSelect, "change", () => {
      const type = textColorTypeSelect.value;
      setTextColorType(type);
      textGradientControl.refresh();
      syncAllFields();
    });
    function syncField(property, force = false) {
      var _a2, _b2, _c;
      const field = fields[property];
      const target = currentTarget;
      if (field.kind === "font-family") {
        const presetValues = FONT_FAMILY_PRESET_VALUES;
        if (!target || !target.isConnected) {
          field.select.disabled = true;
          field.select.value = (_a2 = presetValues[0]) != null ? _a2 : "inherit";
          field.custom.input.disabled = true;
          field.custom.input.value = "";
          field.custom.root.style.display = "none";
          return;
        }
        field.select.disabled = false;
        const isEditing2 = field.handle !== null || isFieldFocused$3(field.select) || isFieldFocused$3(field.custom.input);
        if (isEditing2 && !force) return;
        const inlineValue = readInlineValue$4(target, property);
        const displayValue = inlineValue || readComputedValue$3(target, property);
        const normalized = displayValue.trim().toLowerCase();
        if (presetValues.includes(normalized)) {
          field.select.value = normalized;
          field.custom.root.style.display = "none";
          field.custom.input.disabled = true;
        } else {
          field.select.value = FONT_FAMILY_CUSTOM_VALUE;
          field.custom.root.style.display = "";
          field.custom.input.disabled = false;
          field.custom.input.value = displayValue;
        }
        return;
      }
      if (field.kind === "text-align") {
        const group = field.group;
        if (!target || !target.isConnected) {
          group.setDisabled(true);
          group.setValue(null);
          return;
        }
        group.setDisabled(false);
        const isEditing2 = field.handle !== null;
        if (isEditing2 && !force) return;
        const inlineValue = readInlineValue$4(target, property);
        const computedValue = readComputedValue$3(target, property);
        const raw = (inlineValue || computedValue).trim();
        group.setValue(isTextAlignValue(raw) ? raw : "left");
        return;
      }
      if (field.kind === "vertical-align") {
        const group = field.group;
        if (!target || !target.isConnected) {
          group.setDisabled(true);
          group.setValue(null);
          return;
        }
        group.setDisabled(false);
        const isEditing2 = field.handle !== null;
        if (isEditing2 && !force) return;
        const inlineValue = readInlineValue$4(target, property);
        const computedValue = readComputedValue$3(target, property);
        const raw = (inlineValue || computedValue).trim();
        group.setValue(isVerticalAlignValue(raw) ? raw : "baseline");
        return;
      }
      if (field.kind === "color") {
        const colorField = field.field;
        if (!target || !target.isConnected) {
          colorField.setDisabled(true);
          colorField.setValue("");
          colorField.setPlaceholder("");
          return;
        }
        colorField.setDisabled(false);
        const isEditing2 = field.handle !== null || colorField.isFocused();
        if (isEditing2 && !force) return;
        const inlineValue = readInlineValue$4(target, property);
        const computedValue = readComputedValue$3(target, property);
        if (inlineValue) {
          colorField.setValue(inlineValue);
          colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : "");
        } else {
          colorField.setValue(computedValue);
          colorField.setPlaceholder("");
        }
        return;
      }
      const el = field.element;
      if (!target || !target.isConnected) {
        el.disabled = true;
        if (el instanceof HTMLInputElement) {
          el.value = "";
          el.placeholder = "";
          if (field.container) {
            if (property === "font-size" || property === "letter-spacing") {
              field.container.setSuffix("px");
            } else if (property === "line-height") {
              field.container.setSuffix(null);
            }
          }
        }
        return;
      }
      el.disabled = false;
      const isEditing = field.handle !== null || isFieldFocused$3(el);
      if (el instanceof HTMLInputElement) {
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$4(target, property);
        const displayValue = inlineValue || readComputedValue$3(target, property);
        if (field.container) {
          if (property === "font-size" || property === "letter-spacing") {
            const formatted = formatLengthForDisplay(displayValue);
            el.value = formatted.value;
            field.container.setSuffix(formatted.suffix);
          } else if (property === "line-height") {
            if (hasExplicitUnit(displayValue)) {
              const formatted = formatLengthForDisplay(displayValue);
              el.value = formatted.value;
              field.container.setSuffix(formatted.suffix);
            } else {
              el.value = displayValue;
              field.container.setSuffix(null);
            }
          } else {
            el.value = displayValue;
          }
        } else {
          el.value = displayValue;
        }
        el.placeholder = "";
      } else {
        const inline = readInlineValue$4(target, property);
        const computed = readComputedValue$3(target, property);
        if (isEditing && !force) return;
        const val = inline || computed;
        const hasOption = Array.from(el.options).some((o) => o.value === val);
        el.value = hasOption ? val : (_c = (_b2 = el.options[0]) == null ? void 0 : _b2.value) != null ? _c : "";
      }
    }
    function syncAllFields() {
      for (const p of PROPS) syncField(p);
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      textColorTypeSelect.disabled = !hasTarget;
      updateTextColorTypeVisibility();
    }
    function wireSelect(property) {
      const field = fields[property];
      if (field.kind !== "standard") return;
      const select = field.element;
      const preview = () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(select.value);
      };
      disposer.listen(select, "input", preview);
      disposer.listen(select, "change", preview);
      disposer.listen(select, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireInput(property, normalize = (v) => v.trim()) {
      const field = fields[property];
      if (field.kind !== "standard") return;
      const input = field.element;
      disposer.listen(input, "input", () => {
        var _a2, _b2;
        const handle = beginTransaction(property);
        if (!handle) return;
        const suffix = (_b2 = (_a2 = field.container) == null ? void 0 : _a2.getSuffixText()) != null ? _b2 : null;
        handle.set(normalize(input.value, suffix));
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireFontFamily() {
      const field = fields["font-family"];
      if (field.kind !== "font-family") return;
      const { select, custom, controlsContainer } = field;
      const updateCustomVisibility = () => {
        const isCustom = select.value === FONT_FAMILY_CUSTOM_VALUE;
        custom.root.style.display = isCustom ? "" : "none";
        custom.input.disabled = !isCustom;
        if (isCustom) custom.input.focus();
      };
      const previewSelect = () => {
        updateCustomVisibility();
        if (select.value === FONT_FAMILY_CUSTOM_VALUE) return;
        const handle = beginTransaction("font-family");
        if (handle) handle.set(select.value);
      };
      disposer.listen(select, "input", previewSelect);
      disposer.listen(select, "change", previewSelect);
      disposer.listen(custom.input, "input", () => {
        const handle = beginTransaction("font-family");
        if (handle) handle.set(custom.input.value.trim());
      });
      disposer.listen(controlsContainer, "focusout", (e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && controlsContainer.contains(next)) return;
        commitTransaction("font-family");
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction("font-family");
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction("font-family");
          syncField("font-family", true);
        }
      });
      disposer.listen(custom.input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction("font-family");
          syncAllFields();
          custom.input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction("font-family");
          syncField("font-family", true);
        }
      });
    }
    wireFontFamily();
    wireInput("font-size", combineLengthValue);
    wireSelect("font-weight");
    wireInput("line-height", (v, suffix) => {
      const trimmed = v.trim();
      if (!trimmed) return "";
      if (/[a-zA-Z%]/.test(trimmed)) return trimmed;
      return suffix ? `${trimmed}${suffix}` : trimmed;
    });
    wireInput("letter-spacing", combineLengthValue);
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      if (element && element.isConnected) {
        currentTextColorType = inferTextColorType(element);
      } else {
        currentTextColorType = "solid";
      }
      textColorTypeSelect.value = currentTextColorType;
      updateTextColorTypeVisibility();
      textGradientControl.setTarget(element);
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      const target = currentTarget;
      if (target && target.isConnected) {
        const inferredType = inferTextColorType(target);
        if (inferredType !== currentTextColorType) {
          currentTextColorType = inferredType;
          textColorTypeSelect.value = inferredType;
        }
      }
      textGradientControl.refresh();
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  function createSliderInput(options) {
    const {
      sliderAriaLabel,
      inputAriaLabel,
      min,
      max,
      step,
      inputMode = "decimal",
      inputWidthPx = 72
    } = options;
    const root = document.createElement("div");
    root.className = "we-slider-input";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "we-slider-input__slider";
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(min);
    slider.setAttribute("aria-label", sliderAriaLabel);
    function updateSliderProgress() {
      const value = parseFloat(slider.value);
      const minVal = parseFloat(slider.min);
      const maxVal = parseFloat(slider.max);
      const percent = (value - minVal) / (maxVal - minVal) * 100;
      slider.style.setProperty("--progress", `${percent}%`);
    }
    updateSliderProgress();
    slider.addEventListener("input", updateSliderProgress);
    const inputContainer = createInputContainer({
      ariaLabel: inputAriaLabel,
      inputMode,
      prefix: null,
      suffix: null,
      rootClassName: "we-slider-input__number"
    });
    inputContainer.root.style.width = `${inputWidthPx}px`;
    inputContainer.root.style.flex = "0 0 auto";
    root.append(slider, inputContainer.root);
    function setDisabled(disabled) {
      slider.disabled = disabled;
      inputContainer.input.disabled = disabled;
    }
    function setSliderDisabled(disabled) {
      slider.disabled = disabled;
    }
    function setValue(value) {
      const stringValue = String(value);
      slider.value = stringValue;
      inputContainer.input.value = stringValue;
      updateSliderProgress();
    }
    function setSliderValue(value) {
      slider.value = String(value);
      updateSliderProgress();
    }
    return {
      root,
      slider,
      input: inputContainer.input,
      inputContainer,
      setDisabled,
      setSliderDisabled,
      setValue,
      setSliderValue
    };
  }
  const OVERFLOW_VALUES = ["visible", "hidden", "scroll", "auto"];
  const BOX_SIZING_VALUES = ["content-box", "border-box"];
  function isFieldFocused$2(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function normalizeOpacity(raw) {
    return raw.trim();
  }
  const OPACITY_NUMBER_REGEX = /^-?(?:(?:\d+\.\d+)|(?:\d+\.)|(?:\d+)|(?:\.\d+))$/;
  function clampOpacity(value) {
    if (!Number.isFinite(value)) return 1;
    const clamped = Math.min(1, Math.max(0, value));
    return Object.is(clamped, -0) ? 0 : clamped;
  }
  function parseOpacityNumber(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (!OPACITY_NUMBER_REGEX.test(trimmed)) return null;
    const normalized = trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
    const value = Number(normalized);
    if (!Number.isFinite(value)) return null;
    return value;
  }
  function readInlineValue$3(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$2(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function createAppearanceControl(options) {
    const { container, transactionManager } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    const root = document.createElement("div");
    root.className = "we-field-group";
    function createSelectRow(labelText, ariaLabel, values) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const select = document.createElement("select");
      select.className = "we-select";
      select.setAttribute("aria-label", ariaLabel);
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
      row.append(label, select);
      return { row, select };
    }
    const { row: overflowRow, select: overflowSelect } = createSelectRow(
      "Overflow",
      "Overflow",
      OVERFLOW_VALUES
    );
    const { row: boxSizingRow, select: boxSizingSelect } = createSelectRow(
      "Box Sizing",
      "Box Sizing",
      BOX_SIZING_VALUES
    );
    const opacityRow = document.createElement("div");
    opacityRow.className = "we-field";
    const opacityLabel = document.createElement("span");
    opacityLabel.className = "we-field-label";
    opacityLabel.textContent = "Opacity";
    const opacityMount = document.createElement("div");
    opacityMount.className = "we-field-content";
    opacityRow.append(opacityLabel, opacityMount);
    const opacityControl = createSliderInput({
      sliderAriaLabel: "Opacity slider",
      inputAriaLabel: "Opacity value",
      min: 0,
      max: 1,
      step: 0.01,
      inputMode: "decimal",
      inputWidthPx: 72
    });
    opacityMount.append(opacityControl.root);
    wireNumberStepping(disposer, opacityControl.input, {
      mode: "number",
      min: 0,
      max: 1,
      step: 0.01,
      shiftStep: 0.1,
      altStep: 1e-3
    });
    root.append(overflowRow, boxSizingRow, opacityRow);
    container.appendChild(root);
    disposer.add(() => root.remove());
    const fields = {
      overflow: { kind: "select", property: "overflow", element: overflowSelect, handle: null },
      "box-sizing": {
        kind: "select",
        property: "box-sizing",
        element: boxSizingSelect,
        handle: null
      },
      opacity: { kind: "opacity", property: "opacity", control: opacityControl, handle: null }
    };
    const PROPS = ["overflow", "box-sizing", "opacity"];
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of PROPS) commitTransaction(p);
    }
    function syncField(property, force = false) {
      var _a2, _b2, _c;
      const field = fields[property];
      const target = currentTarget;
      if (field.kind === "opacity") {
        const { slider, input } = field.control;
        if (!target || !target.isConnected) {
          field.control.setDisabled(true);
          slider.value = "0";
          input.value = "";
          input.placeholder = "";
          return;
        }
        field.control.setDisabled(false);
        const isEditing = field.handle !== null || isFieldFocused$2(slider) || isFieldFocused$2(input);
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$3(target, property);
        const computedValue = readComputedValue$2(target, property);
        const displayValue = inlineValue || computedValue;
        input.value = displayValue;
        input.placeholder = "";
        const inlineNumeric = parseOpacityNumber(displayValue);
        const computedNumeric = parseOpacityNumber(computedValue);
        if (inlineValue && inlineNumeric === null) {
          field.control.setSliderDisabled(true);
          if (computedNumeric !== null) {
            field.control.setSliderValue(clampOpacity(computedNumeric));
          }
          return;
        }
        const numeric = (_a2 = inlineNumeric != null ? inlineNumeric : computedNumeric) != null ? _a2 : 1;
        field.control.setSliderDisabled(false);
        field.control.setSliderValue(clampOpacity(numeric));
      } else {
        const select = field.element;
        if (!target || !target.isConnected) {
          select.disabled = true;
          return;
        }
        select.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$2(select);
        if (isEditing && !force) return;
        const inline = readInlineValue$3(target, property);
        const computed = readComputedValue$2(target, property);
        const val = inline || computed;
        const hasOption = Array.from(select.options).some((o) => o.value === val);
        select.value = hasOption ? val : (_c = (_b2 = select.options[0]) == null ? void 0 : _b2.value) != null ? _c : "";
      }
    }
    function syncAllFields() {
      for (const p of PROPS) syncField(p);
    }
    function wireOpacity() {
      const field = fields.opacity;
      if (field.kind !== "opacity") return;
      const { slider, input } = field.control;
      const commit = () => {
        const raw = normalizeOpacity(input.value);
        const numeric = parseOpacityNumber(raw);
        if (numeric !== null) {
          const clamped = clampOpacity(numeric);
          const clampedStr = String(clamped);
          if (raw !== clampedStr) {
            input.value = clampedStr;
            const handle = field.handle;
            if (handle) handle.set(clampedStr);
          }
        }
        commitTransaction("opacity");
        syncAllFields();
      };
      disposer.listen(slider, "input", () => {
        if (slider.disabled) return;
        input.value = slider.value;
        const handle = beginTransaction("opacity");
        if (handle) handle.set(normalizeOpacity(slider.value));
      });
      disposer.listen(slider, "change", commit);
      disposer.listen(slider, "blur", commit);
      disposer.listen(slider, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction("opacity");
          syncAllFields();
          slider.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction("opacity");
          syncField("opacity", true);
        }
      });
      disposer.listen(input, "input", () => {
        const raw = normalizeOpacity(input.value);
        const handle = beginTransaction("opacity");
        if (handle) handle.set(raw);
        const numeric = parseOpacityNumber(raw);
        if (numeric === null) {
          field.control.setSliderDisabled(raw.length > 0);
          return;
        }
        field.control.setSliderDisabled(false);
        field.control.setSliderValue(clampOpacity(numeric));
      });
      disposer.listen(input, "blur", commit);
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction("opacity");
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction("opacity");
          syncField("opacity", true);
        }
      });
    }
    function wireSelect(property) {
      const field = fields[property];
      if (field.kind !== "select") return;
      const select = field.element;
      const preview = () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(select.value);
      };
      disposer.listen(select, "input", preview);
      disposer.listen(select, "change", preview);
      disposer.listen(select, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    wireSelect("overflow");
    wireSelect("box-sizing");
    wireOpacity();
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  const SVG_NS$1 = "http://www.w3.org/2000/svg";
  const BORDER_STYLE_VALUES = ["solid", "dashed", "dotted", "none"];
  const BORDER_COLOR_TYPE_VALUES = ["solid", "gradient"];
  const BORDER_EDGE_VALUES = ["all", "top", "right", "bottom", "left"];
  const BORDER_RADIUS_CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"];
  const BORDER_RADIUS_CORNER_PROPERTIES = {
    "top-left": "border-top-left-radius",
    "top-right": "border-top-right-radius",
    "bottom-right": "border-bottom-right-radius",
    "bottom-left": "border-bottom-left-radius"
  };
  const BORDER_RADIUS_TRANSACTION_PROPERTIES = [
    "border-radius",
    "border-top-left-radius",
    "border-top-right-radius",
    "border-bottom-right-radius",
    "border-bottom-left-radius"
  ];
  function isFieldFocused$1(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$2(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue$1(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function inferBorderColorType(borderImageSource) {
    const trimmed = borderImageSource.trim().toLowerCase();
    if (!trimmed || trimmed === "none") return "solid";
    if (/\b(?:linear|radial|conic)-gradient\s*\(/i.test(trimmed)) return "gradient";
    return "solid";
  }
  function createBorderEdgeIcon(edge) {
    const svg = document.createElementNS(SVG_NS$1, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const outline = document.createElementNS(SVG_NS$1, "rect");
    outline.setAttribute("x", "3.5");
    outline.setAttribute("y", "3.5");
    outline.setAttribute("width", "8");
    outline.setAttribute("height", "8");
    outline.setAttribute("stroke", "currentColor");
    outline.setAttribute("stroke-width", "1");
    outline.setAttribute("opacity", "0.4");
    svg.appendChild(outline);
    const highlight = document.createElementNS(SVG_NS$1, "path");
    highlight.setAttribute("stroke", "currentColor");
    highlight.setAttribute("stroke-width", "2");
    highlight.setAttribute("stroke-linecap", "round");
    switch (edge) {
      case "all":
        highlight.setAttribute("d", "M3.5 3.5h8v8h-8z");
        break;
      case "top":
        highlight.setAttribute("d", "M3.5 3.5h8");
        break;
      case "right":
        highlight.setAttribute("d", "M11.5 3.5v8");
        break;
      case "bottom":
        highlight.setAttribute("d", "M3.5 11.5h8");
        break;
      case "left":
        highlight.setAttribute("d", "M3.5 3.5v8");
        break;
    }
    svg.appendChild(highlight);
    return svg;
  }
  function createEditCornersIcon() {
    const svg = document.createElementNS(SVG_NS$1, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS$1, "path");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("d", "M4 6V4H6 M9 4H11V6 M11 9V11H9 M6 11H4V9");
    svg.appendChild(path);
    return svg;
  }
  function createCornerIcon(corner) {
    const svg = document.createElementNS(SVG_NS$1, "svg");
    svg.setAttribute("viewBox", "0 0 15 15");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS$1, "path");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    switch (corner) {
      case "top-left":
        path.setAttribute("d", "M11 4H6Q4 4 4 6V11");
        break;
      case "top-right":
        path.setAttribute("d", "M4 4H9Q11 4 11 6V11");
        break;
      case "bottom-right":
        path.setAttribute("d", "M11 4V9Q11 11 9 11H4");
        break;
      case "bottom-left":
        path.setAttribute("d", "M4 4V9Q4 11 6 11H11");
        break;
    }
    svg.appendChild(path);
    return svg;
  }
  function createBorderControl(options) {
    const { container, transactionManager, tokensService } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentBorderEdge = "all";
    let currentColorType = "solid";
    const root = document.createElement("div");
    root.className = "we-field-group";
    function createSelectRow(labelText, ariaLabel, values) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const select = document.createElement("select");
      select.className = "we-select";
      select.setAttribute("aria-label", ariaLabel);
      for (const v of values) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        select.appendChild(opt);
      }
      row.append(label, select);
      return { row, select };
    }
    function createColorRow(labelText) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const colorFieldContainer = document.createElement("div");
      colorFieldContainer.style.flex = "1";
      colorFieldContainer.style.minWidth = "0";
      row.append(label, colorFieldContainer);
      return { row, colorFieldContainer };
    }
    const borderEdgeRow = document.createElement("div");
    borderEdgeRow.className = "we-field";
    const borderEdgeLabel = document.createElement("span");
    borderEdgeLabel.className = "we-field-label";
    borderEdgeLabel.textContent = "Edge";
    const borderEdgeMount = document.createElement("div");
    borderEdgeMount.style.flex = "1";
    borderEdgeRow.append(borderEdgeLabel, borderEdgeMount);
    const borderWidthRow = document.createElement("div");
    borderWidthRow.className = "we-field";
    const borderWidthLabel = document.createElement("span");
    borderWidthLabel.className = "we-field-label";
    borderWidthLabel.textContent = "Width";
    const borderWidthContainer = createInputContainer({
      ariaLabel: "Border Width",
      inputMode: "decimal",
      prefix: null,
      suffix: "px"
    });
    borderWidthRow.append(borderWidthLabel, borderWidthContainer.root);
    const borderWidthInput = borderWidthContainer.input;
    const { row: borderStyleRow, select: borderStyleSelect } = createSelectRow(
      "Style",
      "Border Style",
      BORDER_STYLE_VALUES
    );
    const { row: colorTypeRow, select: colorTypeSelect } = createSelectRow(
      "Type",
      "Border Color Type",
      BORDER_COLOR_TYPE_VALUES
    );
    const { row: borderColorRow, colorFieldContainer: borderColorContainer } = createColorRow("Color");
    const borderGradientMount = document.createElement("div");
    const borderRadiusRow = document.createElement("div");
    borderRadiusRow.className = "we-field";
    const borderRadiusLabel = document.createElement("span");
    borderRadiusLabel.className = "we-field-label";
    borderRadiusLabel.textContent = "Radius";
    const borderRadiusControl = document.createElement("div");
    borderRadiusControl.className = "we-radius-control";
    const borderRadiusUnifiedRow = document.createElement("div");
    borderRadiusUnifiedRow.className = "we-field-row";
    const borderRadiusUnified = createInputContainer({
      ariaLabel: "Border Radius",
      inputMode: "decimal",
      prefix: null,
      suffix: "px"
    });
    borderRadiusUnified.root.style.flex = "1";
    const borderRadiusToggleButton = document.createElement("button");
    borderRadiusToggleButton.type = "button";
    borderRadiusToggleButton.className = "we-toggle-btn";
    borderRadiusToggleButton.setAttribute("aria-label", "Edit corners");
    borderRadiusToggleButton.setAttribute("aria-pressed", "false");
    borderRadiusToggleButton.dataset.tooltip = "Edit corners";
    borderRadiusToggleButton.append(createEditCornersIcon());
    borderRadiusUnifiedRow.append(borderRadiusUnified.root, borderRadiusToggleButton);
    const borderRadiusCornersGrid = document.createElement("div");
    borderRadiusCornersGrid.className = "we-radius-corners-grid";
    borderRadiusCornersGrid.hidden = true;
    const borderRadiusCorners = {
      "top-left": createInputContainer({
        ariaLabel: "Top-left radius",
        inputMode: "decimal",
        prefix: createCornerIcon("top-left"),
        suffix: "px"
      }),
      "top-right": createInputContainer({
        ariaLabel: "Top-right radius",
        inputMode: "decimal",
        prefix: createCornerIcon("top-right"),
        suffix: "px"
      }),
      "bottom-left": createInputContainer({
        ariaLabel: "Bottom-left radius",
        inputMode: "decimal",
        prefix: createCornerIcon("bottom-left"),
        suffix: "px"
      }),
      "bottom-right": createInputContainer({
        ariaLabel: "Bottom-right radius",
        inputMode: "decimal",
        prefix: createCornerIcon("bottom-right"),
        suffix: "px"
      })
    };
    borderRadiusCornersGrid.append(
      borderRadiusCorners["top-left"].root,
      borderRadiusCorners["top-right"].root,
      borderRadiusCorners["bottom-left"].root,
      borderRadiusCorners["bottom-right"].root
    );
    borderRadiusControl.append(borderRadiusUnifiedRow);
    borderRadiusRow.append(borderRadiusLabel, borderRadiusControl);
    const borderRadiusField = {
      kind: "border-radius",
      property: "border-radius",
      root: borderRadiusRow,
      unified: borderRadiusUnified,
      toggleButton: borderRadiusToggleButton,
      cornersGrid: borderRadiusCornersGrid,
      corners: borderRadiusCorners,
      handle: null,
      expanded: false,
      mode: null,
      cornersMaterialized: false
    };
    const widthAndRadiusRow = document.createElement("div");
    widthAndRadiusRow.className = "we-field-row";
    borderWidthRow.style.flex = "1";
    borderWidthRow.style.minWidth = "0";
    borderRadiusRow.style.flex = "1";
    borderRadiusRow.style.minWidth = "0";
    widthAndRadiusRow.append(borderWidthRow, borderRadiusRow);
    wireNumberStepping(disposer, borderWidthInput, { mode: "css-length" });
    wireNumberStepping(disposer, borderRadiusUnified.input, { mode: "css-length" });
    for (const corner of BORDER_RADIUS_CORNERS) {
      wireNumberStepping(disposer, borderRadiusCorners[corner].input, { mode: "css-length" });
    }
    root.append(
      borderEdgeRow,
      widthAndRadiusRow,
      borderRadiusCornersGrid,
      borderStyleRow,
      colorTypeRow,
      borderColorRow,
      borderGradientMount
    );
    container.appendChild(root);
    disposer.add(() => root.remove());
    const borderEdgeGroup = createIconButtonGroup({
      container: borderEdgeMount,
      ariaLabel: "Border edge",
      columns: 5,
      value: currentBorderEdge,
      items: BORDER_EDGE_VALUES.map((edge) => ({
        value: edge,
        ariaLabel: edge,
        title: edge.charAt(0).toUpperCase() + edge.slice(1),
        icon: createBorderEdgeIcon(edge)
      })),
      onChange: (edge) => {
        if (edge === currentBorderEdge) return;
        commitTransaction("border-width");
        commitTransaction("border-style");
        commitTransaction("border-color");
        currentBorderEdge = edge;
        syncAllFields();
      }
    });
    disposer.add(() => borderEdgeGroup.dispose());
    const borderColorField = createColorField({
      container: borderColorContainer,
      ariaLabel: "Border Color",
      tokensService,
      getTokenTarget: () => currentTarget,
      onInput: (value) => {
        const handle = beginTransaction("border-color");
        if (handle) handle.set(value);
      },
      onCommit: () => {
        commitTransaction("border-color");
        syncAllFields();
      },
      onCancel: () => {
        rollbackTransaction("border-color");
        syncField("border-color", true);
      }
    });
    disposer.add(() => borderColorField.dispose());
    const borderGradientControl = createGradientControl({
      container: borderGradientMount,
      transactionManager,
      tokensService,
      property: "border-image-source",
      allowNone: true
    });
    disposer.add(() => borderGradientControl.dispose());
    const fields = {
      "border-width": {
        kind: "text",
        property: "border-width",
        element: borderWidthInput,
        handle: null
      },
      "border-style": {
        kind: "select",
        property: "border-style",
        element: borderStyleSelect,
        handle: null
      },
      "border-color": {
        kind: "color",
        property: "border-color",
        field: borderColorField,
        handle: null
      },
      "border-radius": borderRadiusField
    };
    const PROPS = [
      "border-width",
      "border-style",
      "border-color",
      "border-radius"
    ];
    function resolveBorderProperty(kind) {
      if (currentBorderEdge === "all") return `border-${kind}`;
      return `border-${currentBorderEdge}-${kind}`;
    }
    function resolveCssProperty(property) {
      if (property === "border-width") return resolveBorderProperty("width");
      if (property === "border-style") return resolveBorderProperty("style");
      if (property === "border-color") return resolveBorderProperty("color");
      return property;
    }
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.kind === "border-radius") return null;
      if (field.handle) return field.handle;
      const cssProperty = resolveCssProperty(property);
      const handle = transactionManager.beginStyle(target, cssProperty);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      if (field.kind === "border-radius") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      if (field.kind === "border-radius") return;
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function beginBorderRadiusTransaction() {
      if (disposer.isDisposed) return null;
      const field = fields["border-radius"];
      if (field.kind !== "border-radius") return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      if (field.handle) return field.handle;
      const handle = transactionManager.beginMultiStyle(target, [
        ...BORDER_RADIUS_TRANSACTION_PROPERTIES
      ]);
      field.handle = handle;
      field.mode = null;
      field.cornersMaterialized = false;
      return handle;
    }
    function commitBorderRadiusTransaction() {
      const field = fields["border-radius"];
      if (field.kind !== "border-radius") return;
      const handle = field.handle;
      field.handle = null;
      field.mode = null;
      field.cornersMaterialized = false;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackBorderRadiusTransaction() {
      const field = fields["border-radius"];
      if (field.kind !== "border-radius") return;
      const handle = field.handle;
      field.handle = null;
      field.mode = null;
      field.cornersMaterialized = false;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of PROPS) commitTransaction(p);
      commitBorderRadiusTransaction();
    }
    function updateColorTypeVisibility() {
      borderColorRow.hidden = currentColorType !== "solid";
      borderGradientMount.hidden = currentColorType !== "gradient";
    }
    function updateEdgeSelectorState() {
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      if (currentColorType === "gradient") {
        if (currentBorderEdge !== "all") {
          commitTransaction("border-width");
          commitTransaction("border-style");
          commitTransaction("border-color");
          currentBorderEdge = "all";
        }
        borderEdgeGroup.setValue("all");
      }
      borderEdgeGroup.setDisabled(!hasTarget || currentColorType === "gradient");
    }
    function setColorType(type) {
      const target = currentTarget;
      currentColorType = type;
      colorTypeSelect.value = type;
      updateColorTypeVisibility();
      updateEdgeSelectorState();
      if (!target || !target.isConnected) return;
      const handle = transactionManager.beginMultiStyle(target, [
        "border-image-source",
        "border-image-slice"
      ]);
      if (!handle) return;
      if (type === "solid") {
        handle.set({
          "border-image-source": "none",
          "border-image-slice": ""
        });
      } else {
        const inlineSource = readInlineValue$2(target, "border-image-source");
        const computedSource = readComputedValue$1(target, "border-image-source");
        const currentSource = inlineSource || computedSource;
        const hasValidGradient = currentSource && currentSource.trim() && currentSource.trim().toLowerCase() !== "none" && /\b(?:linear|radial|conic)-gradient\s*\(/i.test(currentSource);
        const gradientValue = hasValidGradient ? currentSource : "linear-gradient(90deg, #000000, #ffffff)";
        handle.set({
          "border-image-source": gradientValue,
          "border-image-slice": "1"
        });
      }
      handle.commit({ merge: true });
    }
    disposer.listen(colorTypeSelect, "change", () => {
      const type = colorTypeSelect.value;
      setColorType(type);
      borderGradientControl.refresh();
      syncAllFields();
    });
    function syncField(property, force = false) {
      var _a2, _b2;
      const field = fields[property];
      const target = currentTarget;
      const cssProperty = resolveCssProperty(property);
      if (field.kind === "border-radius") {
        const hasTarget = Boolean(target && target.isConnected);
        field.unified.input.disabled = !hasTarget;
        field.toggleButton.disabled = !hasTarget;
        for (const corner of BORDER_RADIUS_CORNERS) {
          field.corners[corner].input.disabled = !hasTarget;
        }
        if (!hasTarget || !target) {
          field.unified.input.value = "";
          field.unified.input.placeholder = "";
          field.unified.setSuffix("px");
          for (const corner of BORDER_RADIUS_CORNERS) {
            field.corners[corner].input.value = "";
            field.corners[corner].input.placeholder = "";
            field.corners[corner].setSuffix("px");
          }
          return;
        }
        const isCornerFocused = BORDER_RADIUS_CORNERS.some(
          (c) => isFieldFocused$1(field.corners[c].input)
        );
        const isEditing = field.handle !== null || isFieldFocused$1(field.unified.input) || isCornerFocused;
        if (isEditing && !force) return;
        const inlineUnified = readInlineValue$2(target, "border-radius");
        if (inlineUnified) {
          const formatted = formatLengthForDisplay(inlineUnified);
          field.unified.input.value = formatted.value;
          field.unified.setSuffix(formatted.suffix);
        } else {
          const tl = readComputedValue$1(target, BORDER_RADIUS_CORNER_PROPERTIES["top-left"]);
          const tr = readComputedValue$1(target, BORDER_RADIUS_CORNER_PROPERTIES["top-right"]);
          const br = readComputedValue$1(target, BORDER_RADIUS_CORNER_PROPERTIES["bottom-right"]);
          const bl = readComputedValue$1(target, BORDER_RADIUS_CORNER_PROPERTIES["bottom-left"]);
          const displayValue = tl === tr && tl === br && tl === bl ? tl : readComputedValue$1(target, "border-radius");
          const formatted = formatLengthForDisplay(displayValue);
          field.unified.input.value = formatted.value;
          field.unified.setSuffix(formatted.suffix);
        }
        field.unified.input.placeholder = "";
        for (const corner of BORDER_RADIUS_CORNERS) {
          const propName = BORDER_RADIUS_CORNER_PROPERTIES[corner];
          const inlineValue = readInlineValue$2(target, propName);
          const computedValue = readComputedValue$1(target, propName);
          const displayValue = inlineValue || computedValue;
          const formatted = formatLengthForDisplay(displayValue);
          field.corners[corner].input.value = formatted.value;
          field.corners[corner].input.placeholder = "";
          field.corners[corner].setSuffix(formatted.suffix);
        }
        return;
      }
      if (field.kind === "text") {
        const input = field.element;
        if (!target || !target.isConnected) {
          input.disabled = true;
          input.value = "";
          input.placeholder = "";
          if (property === "border-width") borderWidthContainer.setSuffix("px");
          return;
        }
        input.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$1(input);
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$2(target, cssProperty);
        const computedValue = readComputedValue$1(target, cssProperty);
        if (property === "border-width") {
          const formatted = formatLengthForDisplay(inlineValue || computedValue);
          input.value = formatted.value;
          borderWidthContainer.setSuffix(formatted.suffix);
        } else {
          input.value = inlineValue || computedValue;
        }
        input.placeholder = "";
      } else if (field.kind === "select") {
        const select = field.element;
        if (!target || !target.isConnected) {
          select.disabled = true;
          return;
        }
        select.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused$1(select);
        if (isEditing && !force) return;
        const inline = readInlineValue$2(target, cssProperty);
        const computed = readComputedValue$1(target, cssProperty);
        const val = inline || computed;
        const hasOption = Array.from(select.options).some((o) => o.value === val);
        select.value = hasOption ? val : (_b2 = (_a2 = select.options[0]) == null ? void 0 : _a2.value) != null ? _b2 : "";
      } else {
        const colorField = field.field;
        if (!target || !target.isConnected) {
          colorField.setDisabled(true);
          colorField.setValue("");
          colorField.setPlaceholder("");
          return;
        }
        colorField.setDisabled(false);
        const isEditing = field.handle !== null || colorField.isFocused();
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$2(target, cssProperty);
        const computedValue = readComputedValue$1(target, cssProperty);
        if (inlineValue) {
          colorField.setValue(inlineValue);
          colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : "");
        } else {
          colorField.setValue(computedValue);
          colorField.setPlaceholder("");
        }
      }
    }
    function syncAllFields() {
      for (const p of PROPS) syncField(p);
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      colorTypeSelect.disabled = !hasTarget;
      updateColorTypeVisibility();
      updateEdgeSelectorState();
    }
    function wireTextInput(property) {
      const field = fields[property];
      if (field.kind !== "text") return;
      const input = field.element;
      const getNextValue = () => combineLengthValue(input.value, borderWidthContainer.getSuffixText());
      disposer.listen(input, "input", () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(getNextValue());
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireSelect(property) {
      const field = fields[property];
      if (field.kind !== "select") return;
      const select = field.element;
      const preview = () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(select.value);
      };
      disposer.listen(select, "input", preview);
      disposer.listen(select, "change", preview);
      disposer.listen(select, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(select, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          select.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    function wireBorderRadiusControl() {
      const field = fields["border-radius"];
      if (field.kind !== "border-radius") return;
      const setExpanded = (expanded) => {
        field.expanded = expanded;
        field.cornersGrid.hidden = !expanded;
        field.toggleButton.setAttribute("aria-pressed", expanded ? "true" : "false");
      };
      setExpanded(false);
      disposer.listen(field.toggleButton, "click", () => {
        setExpanded(!field.expanded);
      });
      const previewUnified = () => {
        const handle = beginBorderRadiusTransaction();
        if (!handle) return;
        field.mode = "unified";
        field.cornersMaterialized = false;
        const v = combineLengthValue(field.unified.input.value, field.unified.getSuffixText());
        handle.set({
          "border-top-left-radius": "",
          "border-top-right-radius": "",
          "border-bottom-right-radius": "",
          "border-bottom-left-radius": "",
          "border-radius": ""
        });
        handle.set({
          "border-radius": v
        });
      };
      const previewCorner = (corner) => {
        const target = currentTarget;
        if (!target || !target.isConnected) return;
        const handle = beginBorderRadiusTransaction();
        if (!handle) return;
        const cornerProp = BORDER_RADIUS_CORNER_PROPERTIES[corner];
        const container2 = field.corners[corner];
        const next = combineLengthValue(container2.input.value, container2.getSuffixText());
        if (field.mode !== "corners" || !field.cornersMaterialized) {
          const initialValues = {
            "border-radius": "",
            "border-top-left-radius": readInlineValue$2(target, "border-top-left-radius") || readComputedValue$1(target, "border-top-left-radius"),
            "border-top-right-radius": readInlineValue$2(target, "border-top-right-radius") || readComputedValue$1(target, "border-top-right-radius"),
            "border-bottom-right-radius": readInlineValue$2(target, "border-bottom-right-radius") || readComputedValue$1(target, "border-bottom-right-radius"),
            "border-bottom-left-radius": readInlineValue$2(target, "border-bottom-left-radius") || readComputedValue$1(target, "border-bottom-left-radius")
          };
          initialValues[cornerProp] = next;
          handle.set(initialValues);
          field.mode = "corners";
          field.cornersMaterialized = true;
          return;
        }
        handle.set({ "border-radius": "", [cornerProp]: next });
      };
      disposer.listen(field.unified.input, "input", previewUnified);
      for (const corner of BORDER_RADIUS_CORNERS) {
        disposer.listen(field.corners[corner].input, "input", () => previewCorner(corner));
      }
      disposer.listen(field.root, "focusout", (e) => {
        const next = e.relatedTarget;
        if (next instanceof Node && field.root.contains(next)) return;
        commitBorderRadiusTransaction();
        syncAllFields();
      });
      const wireKeydown = (input) => {
        disposer.listen(input, "keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitBorderRadiusTransaction();
            syncAllFields();
            input.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            rollbackBorderRadiusTransaction();
            syncField("border-radius", true);
          }
        });
      };
      wireKeydown(field.unified.input);
      for (const corner of BORDER_RADIUS_CORNERS) {
        wireKeydown(field.corners[corner].input);
      }
    }
    wireTextInput("border-width");
    wireSelect("border-style");
    wireBorderRadiusControl();
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      if (element && element.isConnected) {
        const borderImageSource = readInlineValue$2(element, "border-image-source") || readComputedValue$1(element, "border-image-source");
        currentColorType = inferBorderColorType(borderImageSource);
      } else {
        currentColorType = "solid";
      }
      colorTypeSelect.value = currentColorType;
      if (currentColorType === "gradient") {
        currentBorderEdge = "all";
        borderEdgeGroup.setValue("all");
      }
      borderGradientControl.setTarget(element);
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      const target = currentTarget;
      if (target && target.isConnected) {
        const borderImageSource = readInlineValue$2(target, "border-image-source") || readComputedValue$1(target, "border-image-source");
        const inferredType = inferBorderColorType(borderImageSource);
        if (inferredType !== currentColorType) {
          currentColorType = inferredType;
          colorTypeSelect.value = inferredType;
          if (inferredType === "gradient") {
            currentBorderEdge = "all";
            borderEdgeGroup.setValue("all");
          }
        }
      }
      borderGradientControl.refresh();
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  const BACKGROUND_TYPE_VALUES = ["solid", "gradient", "image"];
  function isFieldFocused(el) {
    try {
      const rootNode = el.getRootNode();
      if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
      return document.activeElement === el;
    } catch (e) {
      return false;
    }
  }
  function readInlineValue$1(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function readComputedValue(element, property) {
    try {
      return window.getComputedStyle(element).getPropertyValue(property).trim();
    } catch (e) {
      return "";
    }
  }
  function inferBackgroundType(bgImage) {
    const trimmed = bgImage.trim().toLowerCase();
    if (!trimmed || trimmed === "none") return "solid";
    if (/\b(?:linear|radial|conic)-gradient\s*\(/i.test(trimmed)) return "gradient";
    if (/\burl\s*\(/i.test(trimmed)) return "image";
    return "solid";
  }
  function extractUrlFromBackgroundImage(raw) {
    var _a2, _b2;
    const match = raw.trim().match(/\burl\(\s*(['"]?)(.*?)\1\s*\)/i);
    return (_b2 = (_a2 = match == null ? void 0 : match[2]) == null ? void 0 : _a2.trim()) != null ? _b2 : "";
  }
  function normalizeBackgroundImageUrl(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return "";
    if (/^none$/i.test(trimmed)) return "none";
    if (/^url\s*\(/i.test(trimmed)) return trimmed;
    const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `url("${escaped}")`;
  }
  function createBackgroundControl(options) {
    const { container, transactionManager, tokensService } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentBackgroundType = "solid";
    const root = document.createElement("div");
    root.className = "we-field-group";
    function createInputRow(labelText, ariaLabel) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "we-input";
      input.autocomplete = "off";
      input.setAttribute("aria-label", ariaLabel);
      row.append(label, input);
      return { row, input };
    }
    function createColorRow(labelText) {
      const row = document.createElement("div");
      row.className = "we-field";
      const label = document.createElement("span");
      label.className = "we-field-label";
      label.textContent = labelText;
      const colorFieldContainer = document.createElement("div");
      colorFieldContainer.style.flex = "1";
      colorFieldContainer.style.minWidth = "0";
      row.append(label, colorFieldContainer);
      return { row, colorFieldContainer };
    }
    const bgTypeRow = document.createElement("div");
    bgTypeRow.className = "we-field";
    const bgTypeLabel = document.createElement("span");
    bgTypeLabel.className = "we-field-label";
    bgTypeLabel.textContent = "Type";
    const bgTypeSelect = document.createElement("select");
    bgTypeSelect.className = "we-select";
    bgTypeSelect.setAttribute("aria-label", "Background Type");
    for (const v of BACKGROUND_TYPE_VALUES) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
      bgTypeSelect.appendChild(opt);
    }
    bgTypeRow.append(bgTypeLabel, bgTypeSelect);
    const { row: bgColorRow, colorFieldContainer: bgColorContainer } = createColorRow("Color");
    const bgGradientMount = document.createElement("div");
    const { row: bgImageRow, input: bgImageInput } = createInputRow("URL", "Background Image URL");
    bgImageInput.placeholder = "https://...";
    bgImageInput.spellcheck = false;
    root.append(bgTypeRow, bgColorRow, bgGradientMount, bgImageRow);
    container.appendChild(root);
    disposer.add(() => root.remove());
    const gradientControl = createGradientControl({
      container: bgGradientMount,
      transactionManager,
      tokensService
    });
    disposer.add(() => gradientControl.dispose());
    const bgColorField = createColorField({
      container: bgColorContainer,
      ariaLabel: "Background Color",
      tokensService,
      getTokenTarget: () => currentTarget,
      onInput: (value) => {
        const handle = beginTransaction("background-color");
        if (handle) handle.set(value);
      },
      onCommit: () => {
        commitTransaction("background-color");
        syncAllFields();
      },
      onCancel: () => {
        rollbackTransaction("background-color");
        syncField("background-color", true);
      }
    });
    disposer.add(() => bgColorField.dispose());
    const fields = {
      "background-color": {
        kind: "color",
        property: "background-color",
        field: bgColorField,
        handle: null
      },
      "background-image": {
        kind: "text",
        property: "background-image",
        element: bgImageInput,
        handle: null
      }
    };
    const PROPS = ["background-color", "background-image"];
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      const field = fields[property];
      if (field.handle) return field.handle;
      const handle = transactionManager.beginStyle(target, property);
      field.handle = handle;
      return handle;
    }
    function commitTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction(property) {
      const field = fields[property];
      const handle = field.handle;
      field.handle = null;
      if (handle) handle.rollback();
    }
    function commitAllTransactions() {
      for (const p of PROPS) commitTransaction(p);
    }
    function updateBackgroundVisibility() {
      bgColorRow.hidden = currentBackgroundType !== "solid";
      bgGradientMount.hidden = currentBackgroundType !== "gradient";
      bgImageRow.hidden = currentBackgroundType !== "image";
    }
    function setBackgroundType(type) {
      const target = currentTarget;
      currentBackgroundType = type;
      bgTypeSelect.value = type;
      updateBackgroundVisibility();
      if (!target || !target.isConnected) return;
      if (type === "solid") {
        commitTransaction("background-image");
        const handle = transactionManager.beginStyle(target, "background-image");
        if (handle) {
          handle.set("none");
          handle.commit({ merge: true });
        }
      }
    }
    disposer.listen(bgTypeSelect, "change", () => {
      const type = bgTypeSelect.value;
      setBackgroundType(type);
      gradientControl.refresh();
      syncAllFields();
    });
    function syncField(property, force = false) {
      const field = fields[property];
      const target = currentTarget;
      if (field.kind === "text") {
        const input = field.element;
        if (!target || !target.isConnected) {
          input.disabled = true;
          input.value = "";
          input.placeholder = "";
          return;
        }
        input.disabled = false;
        const isEditing = field.handle !== null || isFieldFocused(input);
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$1(target, property);
        const computedValue = readComputedValue(target, property);
        const displayValue = inlineValue || computedValue;
        if (property === "background-image") {
          input.value = extractUrlFromBackgroundImage(displayValue);
        } else {
          input.value = displayValue;
        }
        input.placeholder = "";
      } else {
        const colorField = field.field;
        if (!target || !target.isConnected) {
          colorField.setDisabled(true);
          colorField.setValue("");
          colorField.setPlaceholder("");
          return;
        }
        colorField.setDisabled(false);
        const isEditing = field.handle !== null || colorField.isFocused();
        if (isEditing && !force) return;
        const inlineValue = readInlineValue$1(target, property);
        const computedValue = readComputedValue(target, property);
        if (inlineValue) {
          colorField.setValue(inlineValue);
          colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : "");
        } else {
          colorField.setValue(computedValue);
          colorField.setPlaceholder("");
        }
      }
    }
    function syncAllFields() {
      for (const p of PROPS) syncField(p);
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      bgTypeSelect.disabled = !hasTarget;
      updateBackgroundVisibility();
    }
    function wireTextInput(property) {
      const field = fields[property];
      if (field.kind !== "text") return;
      const input = field.element;
      const normalize = normalizeBackgroundImageUrl;
      disposer.listen(input, "input", () => {
        const handle = beginTransaction(property);
        if (handle) handle.set(normalize(input.value));
      });
      disposer.listen(input, "blur", () => {
        commitTransaction(property);
        syncAllFields();
      });
      disposer.listen(input, "keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commitTransaction(property);
          syncAllFields();
          input.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          rollbackTransaction(property);
          syncField(property, true);
        }
      });
    }
    wireTextInput("background-image");
    function setTarget(element) {
      if (disposer.isDisposed) return;
      if (element !== currentTarget) commitAllTransactions();
      currentTarget = element;
      if (element && element.isConnected) {
        const bgImage = readInlineValue$1(element, "background-image") || readComputedValue(element, "background-image");
        currentBackgroundType = inferBackgroundType(bgImage);
        bgTypeSelect.value = currentBackgroundType;
      } else {
        currentBackgroundType = "solid";
        bgTypeSelect.value = "solid";
      }
      gradientControl.setTarget(element);
      updateBackgroundVisibility();
      syncAllFields();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      gradientControl.refresh();
      syncAllFields();
    }
    function dispose() {
      commitAllTransactions();
      currentTarget = null;
      disposer.dispose();
    }
    updateBackgroundVisibility();
    syncAllFields();
    return { setTarget, refresh, dispose };
  }
  const LENGTH_TOKEN_REGEX = /^-?(?:\d+\.?\d*|\.\d+)(?:[a-zA-Z%]+)?$/;
  function isCssFunctionToken(token) {
    return /^[a-zA-Z_-]+\s*\(/.test(token);
  }
  function normalizeLength(raw) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") return "";
    if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return `${trimmed}px`;
    if (/^-?\d+\.$/.test(trimmed)) return `${trimmed.slice(0, -1)}px`;
    return trimmed;
  }
  function readInlineValue(element, property) {
    var _a2, _b2, _c;
    try {
      const style = element.style;
      return (_c = (_b2 = (_a2 = style == null ? void 0 : style.getPropertyValue) == null ? void 0 : _a2.call(style, property)) == null ? void 0 : _b2.trim()) != null ? _c : "";
    } catch (e) {
      return "";
    }
  }
  function splitTopLevel(value, separator) {
    const results = [];
    let depth = 0;
    let quote = null;
    let escape = false;
    let start = 0;
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        continue;
      }
      if (depth === 0 && ch === separator) {
        results.push(value.slice(start, i));
        start = i + 1;
      }
    }
    results.push(value.slice(start));
    return results;
  }
  function tokenizeTopLevel(value) {
    const tokens = [];
    let depth = 0;
    let quote = null;
    let escape = false;
    let buffer = "";
    const flush = () => {
      const t = buffer.trim();
      if (t) tokens.push(t);
      buffer = "";
    };
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (escape) {
        buffer += ch;
        escape = false;
        continue;
      }
      if (ch === "\\") {
        buffer += ch;
        escape = true;
        continue;
      }
      if (quote) {
        buffer += ch;
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        buffer += ch;
        quote = ch;
        continue;
      }
      if (ch === "(") {
        depth++;
        buffer += ch;
        continue;
      }
      if (ch === ")") {
        depth = Math.max(0, depth - 1);
        buffer += ch;
        continue;
      }
      if (depth === 0 && /\s/.test(ch)) {
        flush();
        continue;
      }
      buffer += ch;
    }
    flush();
    return tokens;
  }
  function parseBoxShadow(raw) {
    var _a2, _b2, _c, _d, _e, _f;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") return null;
    const first = (_b2 = (_a2 = splitTopLevel(trimmed, ",")[0]) == null ? void 0 : _a2.trim()) != null ? _b2 : "";
    if (!first || first.toLowerCase() === "none") return null;
    const tokens = tokenizeTopLevel(first);
    if (tokens.length === 0) return null;
    let inset = false;
    const lengthTokens = [];
    const otherTokens = [];
    for (const token of tokens) {
      if (/^inset$/i.test(token)) {
        inset = true;
        continue;
      }
      if (LENGTH_TOKEN_REGEX.test(token)) {
        lengthTokens.push(token);
      } else if (isCssFunctionToken(token) && lengthTokens.length < 4) {
        lengthTokens.push(token);
      } else {
        otherTokens.push(token);
      }
    }
    if (lengthTokens.length < 2) return null;
    return {
      inset,
      offsetX: (_c = lengthTokens[0]) != null ? _c : "",
      offsetY: (_d = lengthTokens[1]) != null ? _d : "",
      blurRadius: (_e = lengthTokens[2]) != null ? _e : "",
      spreadRadius: (_f = lengthTokens[3]) != null ? _f : "",
      color: otherTokens.join(" ").trim()
    };
  }
  function formatBoxShadow(input) {
    const offsetX = normalizeLength(input.offsetX);
    const offsetY = normalizeLength(input.offsetY);
    const blurRadius = normalizeLength(input.blurRadius);
    const spreadRadius = normalizeLength(input.spreadRadius);
    const color = input.color.trim();
    if (!offsetX && !offsetY && !blurRadius && !spreadRadius && !color) return "";
    const parts = [];
    if (input.inset) parts.push("inset");
    parts.push(offsetX || "0px", offsetY || "0px");
    if (blurRadius || spreadRadius) parts.push(blurRadius || "0px");
    if (spreadRadius) parts.push(spreadRadius);
    if (color) parts.push(color);
    return parts.join(" ");
  }
  function findCssFunction(value, fnName) {
    const src = value;
    const lower = src.toLowerCase();
    const needle = fnName.toLowerCase();
    let searchIndex = 0;
    while (searchIndex < src.length) {
      const found = lower.indexOf(needle, searchIndex);
      if (found < 0) return null;
      if (found > 0) {
        const prevChar = src[found - 1];
        if (/[a-zA-Z0-9_-]/.test(prevChar)) {
          searchIndex = found + needle.length;
          continue;
        }
      }
      let i = found + needle.length;
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== "(") {
        searchIndex = found + needle.length;
        continue;
      }
      const openIndex = i;
      let depth = 0;
      let quote = null;
      let escape = false;
      for (let j = openIndex; j < src.length; j++) {
        const ch = src[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (quote) {
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          quote = ch;
          continue;
        }
        if (ch === "(") {
          depth++;
          continue;
        }
        if (ch === ")") {
          depth--;
          if (depth === 0) {
            return {
              start: found,
              end: j + 1,
              args: src.slice(openIndex + 1, j)
            };
          }
          continue;
        }
      }
      return null;
    }
    return null;
  }
  function parseBlurRadius(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") return "";
    const match = findCssFunction(trimmed, "blur");
    return match ? match.args.trim() : "";
  }
  function upsertBlurFunction(existing, radius) {
    const base = existing.trim().toLowerCase() === "none" ? "" : existing.trim();
    const match = base ? findCssFunction(base, "blur") : null;
    const normalizedRadius = normalizeLength(radius);
    if (!normalizedRadius) {
      if (!match) return base;
      const left2 = base.slice(0, match.start).trimEnd();
      const right2 = base.slice(match.end).trimStart();
      if (left2 && right2) return `${left2} ${right2}`.trim();
      return (left2 || right2).trim();
    }
    const replacement = `blur(${normalizedRadius})`;
    if (!match) {
      if (!base) return replacement;
      return `${base} ${replacement}`.trim();
    }
    const left = base.slice(0, match.start).trimEnd();
    const right = base.slice(match.end).trimStart();
    const parts = [];
    if (left) parts.push(left);
    parts.push(replacement);
    if (right) parts.push(right);
    return parts.join(" ");
  }
  const SVG_NS = "http://www.w3.org/2000/svg";
  const BOX_SHADOW_PROPERTY = "box-shadow";
  const EFFECT_TYPE_OPTIONS = [
    { value: "drop-shadow", label: "Drop Shadow", category: "shadow" },
    { value: "inner-shadow", label: "Inner Shadow", category: "shadow" },
    { value: "layer-blur", label: "Layer Blur", category: "blur" },
    { value: "backdrop-blur", label: "Backdrop Blur", category: "blur" }
  ];
  let shadowItemIdCounter = 0;
  function createShadowItemId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (e) {
    }
    shadowItemIdCounter += 1;
    return `shadow_${shadowItemIdCounter}_${Date.now()}`;
  }
  function isShadowEffect(item) {
    return item.type === "drop-shadow" || item.type === "inner-shadow";
  }
  function isBlurEffect(item) {
    return item.type === "layer-blur" || item.type === "backdrop-blur";
  }
  function createDefaultShadowEffect() {
    return {
      id: createShadowItemId(),
      enabled: true,
      type: "drop-shadow",
      kind: "parsed",
      inset: false,
      offsetX: "0px",
      offsetY: "4px",
      blurRadius: "12px",
      spreadRadius: "0px",
      color: "rgba(0, 0, 0, 0.15)"
    };
  }
  function createDefaultBlurEffect(type) {
    return {
      id: createShadowItemId(),
      enabled: true,
      type,
      kind: "parsed",
      radius: "8px"
    };
  }
  function getEffectItemLabel(item) {
    const option = EFFECT_TYPE_OPTIONS.find((o) => o.value === item.type);
    if (option) return option.label;
    if (item.kind === "raw") return "Custom Effect";
    return "Unknown Effect";
  }
  function effectItemKey(item) {
    if (item.kind === "raw") return `raw:${item.property}:${item.rawText.trim()}`;
    if (isShadowEffect(item)) {
      const css = formatBoxShadow({
        inset: item.inset,
        offsetX: item.offsetX,
        offsetY: item.offsetY,
        blurRadius: item.blurRadius,
        spreadRadius: item.spreadRadius,
        color: item.color
      });
      return `shadow:${item.type}:${css.toLowerCase()}`;
    }
    return `blur:${item.type}:${item.radius}`;
  }
  function parseBoxShadowToEffects(raw) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.toLowerCase() === "none") return [];
    const segments = splitTopLevel(trimmed, ",").map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const seg of segments) {
      const parsed = parseBoxShadow(seg);
      if (parsed) {
        out.push({
          id: createShadowItemId(),
          enabled: true,
          type: parsed.inset ? "inner-shadow" : "drop-shadow",
          kind: "parsed",
          inset: parsed.inset,
          offsetX: parsed.offsetX,
          offsetY: parsed.offsetY,
          blurRadius: parsed.blurRadius,
          spreadRadius: parsed.spreadRadius,
          color: parsed.color
        });
      } else {
        out.push({
          id: createShadowItemId(),
          enabled: true,
          type: "raw",
          kind: "raw",
          property: "box-shadow",
          rawText: seg
        });
      }
    }
    return out;
  }
  function parseFilterBlurToEffect(raw, type) {
    const radius = parseBlurRadius(raw);
    if (!radius) return null;
    return {
      id: createShadowItemId(),
      enabled: true,
      type,
      kind: "parsed",
      radius
    };
  }
  function formatEffectsToBoxShadow(items) {
    const parts = items.filter(
      (item) => item.enabled && (isShadowEffect(item) || item.kind === "raw" && item.property === "box-shadow")
    ).map((item) => {
      if (item.kind === "raw") return item.rawText.trim();
      if (isShadowEffect(item)) {
        return formatBoxShadow({
          inset: item.inset,
          offsetX: item.offsetX,
          offsetY: item.offsetY,
          blurRadius: item.blurRadius,
          spreadRadius: item.spreadRadius,
          color: item.color
        });
      }
      return "";
    }).map((s) => s.trim()).filter(Boolean);
    return parts.join(", ");
  }
  function getBlurEffectByType(items, type) {
    const item = items.find((i) => i.type === type && i.enabled);
    return item && isBlurEffect(item) ? item : null;
  }
  function reconcileEffectItems(prevItems, nextEnabledItems) {
    var _a2;
    const usedIds = /* @__PURE__ */ new Set();
    const pool = /* @__PURE__ */ new Map();
    for (const item of prevItems) {
      const key = effectItemKey(item);
      const queue = (_a2 = pool.get(key)) != null ? _a2 : [];
      queue.push(item);
      pool.set(key, queue);
    }
    const reconciledEnabled = nextEnabledItems.map((item) => {
      const key = effectItemKey(item);
      const queue = pool.get(key);
      const match = queue == null ? void 0 : queue.shift();
      if (match) {
        usedIds.add(match.id);
        return __spreadProps(__spreadValues({}, item), { id: match.id, enabled: true });
      }
      return item;
    });
    const remainingHidden = prevItems.filter((item) => !item.enabled && !usedIds.has(item.id));
    return [...reconciledEnabled, ...remainingHidden];
  }
  function createSvgIcon(pathD, viewBox = "0 0 24 24") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", pathD);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }
  function createPlusIcon() {
    return createSvgIcon("M12 5v14M5 12h14");
  }
  function createTrashIcon() {
    return createSvgIcon("M9 6h6M10 6l.5-1.5h3L14 6M7 6l1 14h8l1-14");
  }
  function createAdjustIcon() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("fill", "none");
    svg.setAttribute("aria-hidden", "true");
    const lines = document.createElementNS(SVG_NS, "path");
    lines.setAttribute("d", "M4 5H16 M4 10H16 M4 15H16");
    lines.setAttribute("stroke", "currentColor");
    lines.setAttribute("stroke-width", "2");
    lines.setAttribute("stroke-linecap", "round");
    lines.setAttribute("stroke-linejoin", "round");
    svg.append(lines);
    const knobs = [
      [7, 5],
      [13, 10],
      [9, 15]
    ];
    for (const [cx, cy] of knobs) {
      const circle = document.createElementNS(SVG_NS, "circle");
      circle.setAttribute("cx", String(cx));
      circle.setAttribute("cy", String(cy));
      circle.setAttribute("r", "1.6");
      circle.setAttribute("fill", "none");
      circle.setAttribute("stroke", "currentColor");
      circle.setAttribute("stroke-width", "2");
      svg.append(circle);
    }
    return svg;
  }
  function createEyeIcon(enabled) {
    if (enabled) {
      const svg = document.createElementNS(SVG_NS, "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("aria-hidden", "true");
      const outline = document.createElementNS(SVG_NS, "path");
      outline.setAttribute("d", "M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z");
      outline.setAttribute("stroke", "currentColor");
      outline.setAttribute("stroke-width", "2");
      outline.setAttribute("stroke-linecap", "round");
      outline.setAttribute("stroke-linejoin", "round");
      const iris = document.createElementNS(SVG_NS, "circle");
      iris.setAttribute("cx", "12");
      iris.setAttribute("cy", "12");
      iris.setAttribute("r", "3");
      iris.setAttribute("stroke", "currentColor");
      iris.setAttribute("stroke-width", "2");
      svg.append(outline, iris);
      return svg;
    }
    return createSvgIcon(
      "M3 3l18 18M10.6 10.6A3 3 0 0012 15a3 3 0 002.4-4.4M9.5 5.8A10.7 10.7 0 0112 5c6 0 9.5 7 9.5 7a17.4 17.4 0 01-3.1 4.1M6.2 6.2A17.8 17.8 0 002.5 12s3.5 7 9.5 7c1 0 1.9-.2 2.8-.5"
    );
  }
  function createIconButton(ariaLabel) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "we-effects-icon-btn";
    btn.setAttribute("aria-label", ariaLabel);
    return btn;
  }
  function getViewTypeForItem(item) {
    if (item.kind === "raw") return "raw";
    if (isShadowEffect(item)) return "shadow";
    if (isBlurEffect(item)) return "blur";
    return "raw";
  }
  function createEffectsControl(options) {
    const { container, transactionManager, tokensService, headerActionsContainer } = options;
    const disposer = new Disposer();
    const perTargetItems = /* @__PURE__ */ new WeakMap();
    let currentTarget = null;
    let currentItems = [];
    let itemsById = /* @__PURE__ */ new Map();
    let openItemId = null;
    let activeHandle = null;
    let activeProperty = null;
    const root = document.createElement("div");
    root.className = "we-field-group we-effects";
    container.append(root);
    disposer.add(() => root.remove());
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "we-effects-icon-btn";
    addBtn.setAttribute("aria-label", "Add effect");
    addBtn.append(createPlusIcon());
    if (headerActionsContainer) {
      headerActionsContainer.insertBefore(addBtn, headerActionsContainer.firstChild);
      disposer.add(() => addBtn.remove());
    } else {
      const toolbar = document.createElement("div");
      toolbar.className = "we-effects-toolbar";
      toolbar.append(addBtn);
      root.append(toolbar);
    }
    const list = document.createElement("div");
    list.className = "we-effects-list";
    root.append(list);
    const views = /* @__PURE__ */ new Map();
    function setCurrentItems(next) {
      currentItems = next;
      itemsById = new Map(next.map((i) => [i.id, i]));
      const target = currentTarget;
      if (target) perTargetItems.set(target, next);
    }
    function getItem(id) {
      var _a2;
      return (_a2 = itemsById.get(id)) != null ? _a2 : null;
    }
    function beginTransaction(property) {
      if (disposer.isDisposed) return null;
      const target = currentTarget;
      if (!target || !target.isConnected) return null;
      if (activeHandle && activeProperty === property) return activeHandle;
      if (activeHandle) activeHandle.commit({ merge: true });
      activeHandle = transactionManager.beginStyle(target, property);
      activeProperty = property;
      return activeHandle;
    }
    function commitTransaction() {
      const handle = activeHandle;
      activeHandle = null;
      activeProperty = null;
      if (handle) handle.commit({ merge: true });
    }
    function rollbackTransaction() {
      const handle = activeHandle;
      activeHandle = null;
      activeProperty = null;
      if (handle) handle.rollback();
    }
    function isEditing() {
      return activeHandle !== null || openItemId !== null;
    }
    function previewCurrentItems() {
      const target = currentTarget;
      if (!target || !target.isConnected) return;
      const shadowHandle = beginTransaction(BOX_SHADOW_PROPERTY);
      if (shadowHandle) {
        shadowHandle.set(formatEffectsToBoxShadow(currentItems));
      }
      const layerBlur = getBlurEffectByType(currentItems, "layer-blur");
      if (layerBlur) {
        const filterHandle = beginTransaction("filter");
        if (filterHandle) {
          const existing = readInlineValue(target, "filter");
          filterHandle.set(upsertBlurFunction(existing, layerBlur.radius));
        }
      }
      const backdropBlur = getBlurEffectByType(currentItems, "backdrop-blur");
      if (backdropBlur) {
        const backdropHandle = beginTransaction("backdrop-filter");
        if (backdropHandle) {
          const existing = readInlineValue(target, "backdrop-filter");
          backdropHandle.set(upsertBlurFunction(existing, backdropBlur.radius));
        }
      }
    }
    function applyCurrentItemsDiscrete() {
      var _a2, _b2;
      const target = currentTarget;
      if (!target || !target.isConnected) return;
      commitTransaction();
      transactionManager.applyStyle(
        target,
        BOX_SHADOW_PROPERTY,
        formatEffectsToBoxShadow(currentItems),
        {
          merge: false
        }
      );
      const layerBlur = getBlurEffectByType(currentItems, "layer-blur");
      const existingFilter = readInlineValue(target, "filter");
      transactionManager.applyStyle(
        target,
        "filter",
        upsertBlurFunction(existingFilter, (_a2 = layerBlur == null ? void 0 : layerBlur.radius) != null ? _a2 : ""),
        {
          merge: false
        }
      );
      const backdropBlur = getBlurEffectByType(currentItems, "backdrop-blur");
      const existingBackdrop = readInlineValue(target, "backdrop-filter");
      transactionManager.applyStyle(
        target,
        "backdrop-filter",
        upsertBlurFunction(existingBackdrop, (_b2 = backdropBlur == null ? void 0 : backdropBlur.radius) != null ? _b2 : ""),
        {
          merge: false
        }
      );
    }
    function closePopover(opts) {
      var _a2, _b2;
      const commit = (_a2 = opts == null ? void 0 : opts.commit) != null ? _a2 : false;
      const rollback = (_b2 = opts == null ? void 0 : opts.rollback) != null ? _b2 : false;
      if (rollback) rollbackTransaction();
      else if (commit) commitTransaction();
      const wasOpen = openItemId !== null;
      openItemId = null;
      for (const view of views.values()) view.setOpen(false);
      if (wasOpen && !rollback) {
        syncFromTarget(true);
      }
    }
    function setPopoverOpen(id) {
      if (id === openItemId) {
        closePopover({ commit: true });
        return;
      }
      closePopover({ commit: true });
      if (!id) return;
      const view = views.get(id);
      if (!view) return;
      openItemId = id;
      for (const [vid, v] of views) v.setOpen(vid === id);
      view.focusFirst();
    }
    function setLengthInput(containerRef, raw) {
      const formatted = formatLengthForDisplay(raw);
      containerRef.input.value = formatted.value;
      containerRef.setSuffix(formatted.suffix);
    }
    function createEffectItemWithType(prev, nextType) {
      var _a2, _b2, _c, _d, _e, _f;
      if (prev.kind === "raw") return null;
      if (nextType === "layer-blur" || nextType === "backdrop-blur") {
        const base2 = createDefaultBlurEffect(nextType);
        const mappedRadius = isBlurEffect(prev) ? prev.radius : isShadowEffect(prev) ? prev.blurRadius : base2.radius;
        return __spreadProps(__spreadValues({}, base2), {
          id: prev.id,
          enabled: prev.enabled,
          radius: mappedRadius || base2.radius
        });
      }
      const base = createDefaultShadowEffect();
      const shadowPrev = isShadowEffect(prev) ? prev : null;
      const blurPrev = isBlurEffect(prev) ? prev : null;
      const mappedBlurRadius = (_b2 = (_a2 = shadowPrev == null ? void 0 : shadowPrev.blurRadius) != null ? _a2 : blurPrev == null ? void 0 : blurPrev.radius) != null ? _b2 : base.blurRadius;
      return __spreadProps(__spreadValues({}, base), {
        id: prev.id,
        enabled: prev.enabled,
        type: nextType,
        inset: nextType === "inner-shadow",
        offsetX: (_c = shadowPrev == null ? void 0 : shadowPrev.offsetX) != null ? _c : base.offsetX,
        offsetY: (_d = shadowPrev == null ? void 0 : shadowPrev.offsetY) != null ? _d : base.offsetY,
        blurRadius: mappedBlurRadius || base.blurRadius,
        spreadRadius: (_e = shadowPrev == null ? void 0 : shadowPrev.spreadRadius) != null ? _e : base.spreadRadius,
        color: (_f = shadowPrev == null ? void 0 : shadowPrev.color) != null ? _f : base.color
      });
    }
    function updateEffectItemType(id, nextType) {
      var _a2;
      const prev = getItem(id);
      if (!prev || prev.kind === "raw") return;
      if (prev.type === nextType) return;
      const nextItem = createEffectItemWithType(prev, nextType);
      if (!nextItem) return;
      let nextItems = currentItems.map((it) => it.id === id ? nextItem : it);
      if (nextItem.type === "layer-blur" || nextItem.type === "backdrop-blur") {
        nextItems = nextItems.filter((it) => it.id === id || it.type !== nextItem.type);
      }
      setCurrentItems(nextItems);
      renderList();
      applyCurrentItemsDiscrete();
      if (openItemId === id) {
        (_a2 = views.get(id)) == null ? void 0 : _a2.focusFirst();
      }
    }
    function createItemView(item) {
      const itemDisposer = new Disposer();
      const wrap = document.createElement("div");
      wrap.className = "we-effects-item-wrap";
      const row = document.createElement("div");
      row.className = "we-effects-item";
      row.dataset.enabled = item.enabled ? "true" : "false";
      row.dataset.open = "false";
      const adjustBtn = createIconButton("Adjust effect");
      adjustBtn.append(createAdjustIcon());
      const nameBtn = document.createElement("button");
      nameBtn.type = "button";
      nameBtn.className = "we-effects-name";
      const eyeBtn = createIconButton("Toggle visibility");
      const deleteBtn = createIconButton("Remove effect");
      deleteBtn.append(createTrashIcon());
      row.append(adjustBtn, nameBtn, eyeBtn, deleteBtn);
      const popover = document.createElement("div");
      popover.className = "we-effects-popover";
      popover.hidden = true;
      wrap.append(row, popover);
      itemDisposer.listen(adjustBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPopoverOpen(item.id);
      });
      itemDisposer.listen(nameBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPopoverOpen(item.id);
      });
      itemDisposer.listen(eyeBtn, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const it = getItem(item.id);
        if (!it) return;
        it.enabled = !it.enabled;
        row.dataset.enabled = it.enabled ? "true" : "false";
        eyeBtn.replaceChildren(createEyeIcon(it.enabled));
        applyCurrentItemsDiscrete();
      });
      itemDisposer.listen(deleteBtn, "click", (e) => {
        var _a2;
        e.preventDefault();
        e.stopPropagation();
        if (openItemId === item.id) closePopover({ commit: true });
        setCurrentItems(currentItems.filter((i) => i.id !== item.id));
        (_a2 = views.get(item.id)) == null ? void 0 : _a2.dispose();
        views.delete(item.id);
        renderList();
        applyCurrentItemsDiscrete();
      });
      if (item.kind === "raw") {
        const content2 = document.createElement("div");
        content2.className = "we-effects-popover-content";
        const field = document.createElement("div");
        field.className = "we-field";
        const label = document.createElement("span");
        label.className = "we-field-label";
        label.textContent = "Value";
        const input = document.createElement("input");
        input.type = "text";
        input.className = "we-input";
        input.autocomplete = "off";
        input.spellcheck = false;
        input.setAttribute("aria-label", "Shadow value");
        field.append(label, input);
        content2.append(field);
        popover.append(content2);
        itemDisposer.listen(input, "input", () => {
          const it = getItem(item.id);
          if (!it || it.kind !== "raw") return;
          it.rawText = input.value;
          previewCurrentItems();
        });
        itemDisposer.listen(input, "blur", () => {
          commitTransaction();
        });
        itemDisposer.listen(input, "keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitTransaction();
            input.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            closePopover({ rollback: true });
            syncFromTarget(true);
          }
        });
        const view2 = {
          id: item.id,
          viewType: "raw",
          root: wrap,
          row,
          adjustBtn,
          nameBtn,
          eyeBtn,
          deleteBtn,
          popover,
          rawInput: input,
          disposer: itemDisposer,
          setOpen(open) {
            row.dataset.open = open ? "true" : "false";
            popover.hidden = !open;
          },
          focusFirst() {
            input.focus();
            input.select();
          },
          sync(next) {
            row.dataset.enabled = next.enabled ? "true" : "false";
            nameBtn.textContent = getEffectItemLabel(next);
            eyeBtn.replaceChildren(createEyeIcon(next.enabled));
            if (next.kind === "raw") input.value = next.rawText;
          },
          dispose() {
            itemDisposer.dispose();
            wrap.remove();
          }
        };
        return view2;
      }
      if (isBlurEffect(item)) {
        const content2 = document.createElement("div");
        content2.className = "we-effects-popover-content";
        const typeField2 = document.createElement("div");
        typeField2.className = "we-field";
        const typeLabel2 = document.createElement("span");
        typeLabel2.className = "we-field-label";
        typeLabel2.textContent = "Type";
        const typeSelect2 = document.createElement("select");
        typeSelect2.className = "we-select";
        typeSelect2.setAttribute("aria-label", "Effect type");
        for (const v of EFFECT_TYPE_OPTIONS) {
          const opt = document.createElement("option");
          opt.value = v.value;
          opt.textContent = v.label;
          typeSelect2.append(opt);
        }
        typeField2.append(typeLabel2, typeSelect2);
        const radiusField = document.createElement("div");
        radiusField.className = "we-field";
        const radiusLabel = document.createElement("span");
        radiusLabel.className = "we-field-label";
        radiusLabel.textContent = "Blur";
        const radiusInput = createInputContainer({
          ariaLabel: "Blur radius",
          inputMode: "decimal",
          suffix: "px"
        });
        radiusField.append(radiusLabel, radiusInput.root);
        content2.append(typeField2, radiusField);
        popover.append(content2);
        wireNumberStepping(itemDisposer, radiusInput.input, {
          mode: "css-length",
          min: 0,
          step: 1,
          shiftStep: 10,
          altStep: 0.1
        });
        itemDisposer.listen(radiusInput.input, "input", () => {
          const it = getItem(item.id);
          if (!it || !isBlurEffect(it)) return;
          it.radius = combineLengthValue(radiusInput.input.value, radiusInput.getSuffixText());
          previewCurrentItems();
        });
        itemDisposer.listen(radiusInput.input, "blur", () => {
          commitTransaction();
          syncFromTarget(true);
        });
        itemDisposer.listen(radiusInput.input, "keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitTransaction();
            syncFromTarget(true);
            radiusInput.input.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            closePopover({ rollback: true });
            syncFromTarget(true);
          }
        });
        const onTypeChange2 = () => {
          updateEffectItemType(item.id, typeSelect2.value);
        };
        itemDisposer.listen(typeSelect2, "input", onTypeChange2);
        itemDisposer.listen(typeSelect2, "change", onTypeChange2);
        const view2 = {
          id: item.id,
          viewType: "blur",
          root: wrap,
          row,
          adjustBtn,
          nameBtn,
          eyeBtn,
          deleteBtn,
          popover,
          disposer: itemDisposer,
          typeSelect: typeSelect2,
          radiusInput,
          setOpen(open) {
            row.dataset.open = open ? "true" : "false";
            popover.hidden = !open;
          },
          focusFirst() {
            radiusInput.input.focus();
            radiusInput.input.select();
          },
          sync(next) {
            row.dataset.enabled = next.enabled ? "true" : "false";
            nameBtn.textContent = getEffectItemLabel(next);
            eyeBtn.replaceChildren(createEyeIcon(next.enabled));
            if (!isBlurEffect(next)) return;
            typeSelect2.value = next.type;
            setLengthInput(radiusInput, next.radius);
          },
          dispose() {
            itemDisposer.dispose();
            wrap.remove();
          }
        };
        return view2;
      }
      const content = document.createElement("div");
      content.className = "we-effects-popover-content";
      const typeField = document.createElement("div");
      typeField.className = "we-field";
      const typeLabel = document.createElement("span");
      typeLabel.className = "we-field-label";
      typeLabel.textContent = "Type";
      const typeSelect = document.createElement("select");
      typeSelect.className = "we-select";
      typeSelect.setAttribute("aria-label", "Effect type");
      for (const v of EFFECT_TYPE_OPTIONS) {
        const opt = document.createElement("option");
        opt.value = v.value;
        opt.textContent = v.label;
        typeSelect.append(opt);
      }
      typeField.append(typeLabel, typeSelect);
      const xyRow = document.createElement("div");
      xyRow.className = "we-field-row";
      const x = createInputContainer({
        ariaLabel: "Shadow offset X",
        inputMode: "decimal",
        prefix: "X",
        suffix: "px"
      });
      const y = createInputContainer({
        ariaLabel: "Shadow offset Y",
        inputMode: "decimal",
        prefix: "Y",
        suffix: "px"
      });
      xyRow.append(x.root, y.root);
      const blurRow = document.createElement("div");
      blurRow.className = "we-field-row";
      const blur = createInputContainer({
        ariaLabel: "Shadow blur radius",
        inputMode: "decimal",
        prefix: "B",
        suffix: "px"
      });
      const spread = createInputContainer({
        ariaLabel: "Shadow spread radius",
        inputMode: "decimal",
        prefix: "S",
        suffix: "px"
      });
      blurRow.append(blur.root, spread.root);
      const colorFieldRow = document.createElement("div");
      colorFieldRow.className = "we-field";
      const colorLabel = document.createElement("span");
      colorLabel.className = "we-field-label";
      colorLabel.textContent = "Color";
      const colorMount = document.createElement("div");
      colorMount.style.minWidth = "0";
      colorFieldRow.append(colorLabel, colorMount);
      content.append(typeField, xyRow, blurRow, colorFieldRow);
      popover.append(content);
      wireNumberStepping(itemDisposer, x.input, { mode: "css-length" });
      wireNumberStepping(itemDisposer, y.input, { mode: "css-length" });
      wireNumberStepping(itemDisposer, blur.input, {
        mode: "css-length",
        min: 0,
        step: 1,
        shiftStep: 10,
        altStep: 0.1
      });
      wireNumberStepping(itemDisposer, spread.input, {
        mode: "css-length",
        step: 1,
        shiftStep: 10,
        altStep: 0.1
      });
      const colorField = createColorField({
        container: colorMount,
        ariaLabel: "Shadow color",
        tokensService,
        getTokenTarget: () => currentTarget,
        onInput: (value) => {
          const it = getItem(item.id);
          if (!it || !isShadowEffect(it)) return;
          it.color = value;
          previewCurrentItems();
        },
        onCommit: () => {
          commitTransaction();
        },
        onCancel: () => {
          rollbackTransaction();
          syncFromTarget(true);
        }
      });
      itemDisposer.add(() => colorField.dispose());
      const wireShadowLengthField = (containerRef, key) => {
        itemDisposer.listen(containerRef.input, "input", () => {
          const it = getItem(item.id);
          if (!it || !isShadowEffect(it)) return;
          const next = combineLengthValue(containerRef.input.value, containerRef.getSuffixText());
          it[key] = next;
          previewCurrentItems();
        });
        itemDisposer.listen(containerRef.input, "blur", () => {
          commitTransaction();
          syncFromTarget(true);
        });
        itemDisposer.listen(containerRef.input, "keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitTransaction();
            syncFromTarget(true);
            containerRef.input.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            rollbackTransaction();
            syncFromTarget(true);
          }
        });
      };
      wireShadowLengthField(x, "offsetX");
      wireShadowLengthField(y, "offsetY");
      wireShadowLengthField(blur, "blurRadius");
      wireShadowLengthField(spread, "spreadRadius");
      const onTypeChange = () => {
        updateEffectItemType(item.id, typeSelect.value);
      };
      itemDisposer.listen(typeSelect, "input", onTypeChange);
      itemDisposer.listen(typeSelect, "change", onTypeChange);
      const view = {
        id: item.id,
        viewType: "shadow",
        root: wrap,
        row,
        adjustBtn,
        nameBtn,
        eyeBtn,
        deleteBtn,
        popover,
        disposer: itemDisposer,
        typeSelect,
        offsetX: x,
        offsetY: y,
        blur,
        spread,
        colorField,
        setOpen(open) {
          row.dataset.open = open ? "true" : "false";
          popover.hidden = !open;
        },
        focusFirst() {
          typeSelect.focus();
        },
        sync(next) {
          row.dataset.enabled = next.enabled ? "true" : "false";
          nameBtn.textContent = getEffectItemLabel(next);
          eyeBtn.replaceChildren(createEyeIcon(next.enabled));
          if (!isShadowEffect(next)) return;
          typeSelect.value = next.type;
          setLengthInput(x, next.offsetX);
          setLengthInput(y, next.offsetY);
          setLengthInput(blur, next.blurRadius);
          setLengthInput(spread, next.spreadRadius);
          colorField.setValue(next.color);
        },
        dispose() {
          itemDisposer.dispose();
          wrap.remove();
        }
      };
      return view;
    }
    function renderList() {
      const ids = new Set(currentItems.map((i) => i.id));
      for (const [id, view] of Array.from(views.entries())) {
        if (!ids.has(id)) {
          if (openItemId === id) openItemId = null;
          view.dispose();
          views.delete(id);
        }
      }
      for (const item of currentItems) {
        const existing = views.get(item.id);
        const expectedViewType = getViewTypeForItem(item);
        if (!existing || existing.viewType !== expectedViewType) {
          existing == null ? void 0 : existing.dispose();
          views.set(item.id, createItemView(item));
        }
        const view = views.get(item.id);
        view.sync(item);
        view.setOpen(openItemId === item.id);
        list.append(view.root);
      }
    }
    function syncFromTarget(force = false) {
      var _a2;
      const target = currentTarget;
      if (!target || !target.isConnected) {
        addBtn.disabled = true;
        setCurrentItems([]);
        closePopover({ commit: true });
        renderList();
        return;
      }
      addBtn.disabled = false;
      if (!force && isEditing()) return;
      const boxShadowInline = readInlineValue(target, BOX_SHADOW_PROPERTY);
      const shadowEffects = parseBoxShadowToEffects(boxShadowInline);
      const filterInline = readInlineValue(target, "filter");
      const layerBlur = parseFilterBlurToEffect(filterInline, "layer-blur");
      const backdropInline = readInlineValue(target, "backdrop-filter");
      const backdropBlur = parseFilterBlurToEffect(backdropInline, "backdrop-blur");
      const nextEnabled = [
        ...shadowEffects,
        ...layerBlur ? [layerBlur] : [],
        ...backdropBlur ? [backdropBlur] : []
      ];
      const prev = (_a2 = perTargetItems.get(target)) != null ? _a2 : [];
      setCurrentItems(reconcileEffectItems(prev, nextEnabled));
      renderList();
    }
    disposer.listen(addBtn, "click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = currentTarget;
      if (!target || !target.isConnected) return;
      closePopover({ commit: true });
      const newEffect = createDefaultShadowEffect();
      const next = [...currentItems, newEffect];
      setCurrentItems(next);
      renderList();
      applyCurrentItemsDiscrete();
      setPopoverOpen(newEffect.id);
    });
    const handleClickOutside = (e) => {
      const openId = openItemId;
      if (!openId) return;
      const view = views.get(openId);
      if (!view) return;
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      const clickedInside = path.length > 0 ? path.includes(view.root) : (() => {
        const node = e.target;
        return !!(node && view.root.contains(node));
      })();
      if (clickedInside) return;
      closePopover({ commit: true });
    };
    const doc = root.ownerDocument;
    doc.addEventListener("click", handleClickOutside, true);
    disposer.add(() => doc.removeEventListener("click", handleClickOutside, true));
    const handleEscape = (e) => {
      if (e.key !== "Escape") return;
      if (!openItemId) return;
      e.preventDefault();
      e.stopPropagation();
      closePopover({ rollback: true });
      syncFromTarget(true);
    };
    root.addEventListener("keydown", handleEscape, true);
    disposer.add(() => root.removeEventListener("keydown", handleEscape, true));
    function setTarget(element) {
      var _a2;
      if (disposer.isDisposed) return;
      if (element !== currentTarget) {
        commitTransaction();
        closePopover({ commit: true });
      }
      currentTarget = element;
      if (element && element.isConnected) {
        setCurrentItems((_a2 = perTargetItems.get(element)) != null ? _a2 : []);
      } else {
        setCurrentItems([]);
      }
      syncFromTarget(true);
    }
    function refresh() {
      if (disposer.isDisposed) return;
      syncFromTarget(false);
    }
    function dispose() {
      commitTransaction();
      currentTarget = null;
      for (const view of views.values()) view.dispose();
      views.clear();
      disposer.dispose();
    }
    syncFromTarget(true);
    return { setTarget, refresh, dispose };
  }
  const MAX_ANCESTORS = 10;
  const MAX_CHILDREN = 20;
  const MAX_CLASSES = 2;
  const MAX_TEXT_LENGTH = 20;
  function formatElementLabel$1(element) {
    var _a2, _b2, _c, _d;
    const tag = element.tagName.toLowerCase();
    const htmlEl = element;
    let label = tag;
    const id = (_a2 = htmlEl.id) == null ? void 0 : _a2.trim();
    if (id) {
      label += `#${id}`;
    }
    const classes = Array.from((_b2 = element.classList) != null ? _b2 : []).slice(0, MAX_CLASSES).filter(Boolean);
    if (classes.length > 0) {
      label += `.${classes.join(".")}`;
    }
    if (!element.children.length) {
      const text = (_d = (_c = element.textContent) == null ? void 0 : _c.trim()) != null ? _d : "";
      if (text.length > 0 && text.length <= MAX_TEXT_LENGTH) {
        label += ` "${text}"`;
      } else if (text.length > MAX_TEXT_LENGTH) {
        label += ` "${text.slice(0, MAX_TEXT_LENGTH - 3)}..."`;
      }
    }
    return label;
  }
  function getAncestorChain(element) {
    const ancestors = [];
    let current = element.parentElement;
    while (current && ancestors.length < MAX_ANCESTORS) {
      if (current === document.body || current === document.documentElement) {
        ancestors.unshift(current);
        break;
      }
      if (current.shadowRoot) {
        break;
      }
      ancestors.unshift(current);
      current = current.parentElement;
    }
    return ancestors;
  }
  function getDirectChildren(element) {
    return Array.from(element.children).slice(0, MAX_CHILDREN);
  }
  function buildTreeNodes(target) {
    if (!target || !target.isConnected) {
      return [];
    }
    const nodes = [];
    const ancestors = getAncestorChain(target);
    for (let i = 0; i < ancestors.length; i++) {
      nodes.push({
        element: ancestors[i],
        label: formatElementLabel$1(ancestors[i]),
        depth: i,
        isSelected: false,
        isAncestor: true,
        isChild: false
      });
    }
    const selectedDepth = ancestors.length;
    nodes.push({
      element: target,
      label: formatElementLabel$1(target),
      depth: selectedDepth,
      isSelected: true,
      isAncestor: false,
      isChild: false
    });
    const children = getDirectChildren(target);
    for (const child of children) {
      nodes.push({
        element: child,
        label: formatElementLabel$1(child),
        depth: selectedDepth + 1,
        isSelected: false,
        isAncestor: false,
        isChild: true
      });
    }
    return nodes;
  }
  function createComponentsTree(options) {
    const { container, onSelect } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    const root = document.createElement("div");
    root.className = "we-tree";
    const emptyState = document.createElement("div");
    emptyState.className = "we-tree-empty";
    emptyState.textContent = "Select an element to view its DOM hierarchy.";
    const treeList = document.createElement("div");
    treeList.className = "we-tree-list";
    treeList.setAttribute("role", "tree");
    root.append(emptyState, treeList);
    container.append(root);
    disposer.add(() => root.remove());
    function render() {
      const nodes = buildTreeNodes(currentTarget);
      const hasTarget = nodes.length > 0;
      emptyState.hidden = hasTarget;
      treeList.hidden = !hasTarget;
      if (!hasTarget) {
        treeList.innerHTML = "";
        return;
      }
      treeList.innerHTML = "";
      for (const node of nodes) {
        const item = document.createElement("div");
        item.className = "we-tree-item";
        item.setAttribute("role", "treeitem");
        item.style.paddingLeft = `${8 + node.depth * 16}px`;
        if (node.isSelected) {
          item.classList.add("we-tree-item--selected");
          item.setAttribute("aria-selected", "true");
        }
        if (node.isAncestor) {
          item.classList.add("we-tree-item--ancestor");
        }
        if (node.isChild) {
          item.classList.add("we-tree-item--child");
        }
        if (node.depth > 0) {
          const indent = document.createElement("span");
          indent.className = "we-tree-indent";
          indent.textContent = node.isChild ? "└" : "├";
          item.append(indent);
        }
        const icon = document.createElement("span");
        icon.className = "we-tree-icon";
        icon.textContent = "◇";
        item.append(icon);
        const label = document.createElement("span");
        label.className = "we-tree-label";
        label.textContent = node.label;
        item.append(label);
        disposer.listen(item, "click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (node.element.isConnected && onSelect) {
            onSelect(node.element);
          }
        });
        disposer.listen(item, "mouseenter", () => {
          if (node.element.isConnected) {
            node.element.classList.add("we-tree-hover-highlight");
          }
        });
        disposer.listen(item, "mouseleave", () => {
          node.element.classList.remove("we-tree-hover-highlight");
        });
        treeList.append(item);
      }
    }
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element;
      render();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      render();
    }
    function dispose() {
      currentTarget = null;
      disposer.dispose();
    }
    render();
    return {
      setTarget,
      refresh,
      dispose
    };
  }
  const MAX_SUGGESTIONS = 8;
  const MAX_SUGGESTION_CACHE = 400;
  function normalizeClassList$2(input) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of input != null ? input : []) {
      const token = String(raw != null ? raw : "").trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }
  function isSameStringList$1(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function splitTokens(raw) {
    return String(raw != null ? raw : "").split(/\s+/).map((t) => t.trim()).filter(Boolean);
  }
  function readElementClasses$1(element) {
    var _a2;
    try {
      const list = element.classList;
      if (list && typeof list[Symbol.iterator] === "function") {
        return Array.from(list).filter(Boolean);
      }
    } catch (e) {
    }
    try {
      const raw = (_a2 = element.getAttribute("class")) != null ? _a2 : "";
      return raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function createClassEditor(options) {
    const { container, onClassChange, getSuggestions } = options;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentClasses = [];
    let isComposing = false;
    const root = document.createElement("div");
    root.className = "we-class-editor";
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Class editor");
    const chipsContainer = document.createElement("div");
    chipsContainer.className = "we-class-chips";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "we-input we-class-input";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = "Add class";
    input.setAttribute("aria-label", "Add class");
    const suggestionsContainer = document.createElement("div");
    suggestionsContainer.className = "we-class-suggestions";
    suggestionsContainer.hidden = true;
    root.append(chipsContainer, input, suggestionsContainer);
    container.append(root);
    disposer.add(() => root.remove());
    function renderChips() {
      chipsContainer.innerHTML = "";
      for (const cls of currentClasses) {
        const chip = document.createElement("span");
        chip.className = "we-class-chip";
        const text = document.createElement("span");
        text.className = "we-class-chip-text";
        text.textContent = cls;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "we-class-chip-remove";
        removeBtn.textContent = "×";
        removeBtn.dataset.action = "remove";
        removeBtn.dataset.value = cls;
        removeBtn.setAttribute("aria-label", `Remove class ${cls}`);
        chip.append(text, removeBtn);
        chipsContainer.append(chip);
      }
    }
    function hideSuggestions() {
      suggestionsContainer.hidden = true;
      suggestionsContainer.innerHTML = "";
    }
    function renderSuggestions() {
      var _a2;
      if (input.disabled) {
        hideSuggestions();
        return;
      }
      const prefix = input.value.trim();
      if (!prefix) {
        hideSuggestions();
        return;
      }
      const allSuggestions = (_a2 = getSuggestions == null ? void 0 : getSuggestions()) != null ? _a2 : [];
      if (!Array.isArray(allSuggestions) || allSuggestions.length === 0) {
        hideSuggestions();
        return;
      }
      const existingSet = new Set(currentClasses);
      const seenSet = /* @__PURE__ */ new Set();
      const filtered = [];
      for (const raw of allSuggestions) {
        const s = String(raw != null ? raw : "").trim();
        if (!s) continue;
        if (existingSet.has(s)) continue;
        if (!s.startsWith(prefix)) continue;
        if (seenSet.has(s)) continue;
        seenSet.add(s);
        filtered.push(s);
        if (filtered.length >= MAX_SUGGESTIONS) break;
      }
      if (filtered.length === 0) {
        hideSuggestions();
        return;
      }
      suggestionsContainer.hidden = false;
      suggestionsContainer.innerHTML = "";
      for (const suggestion of filtered) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "we-class-suggestion";
        btn.textContent = suggestion;
        btn.dataset.action = "suggestion";
        btn.dataset.value = suggestion;
        suggestionsContainer.append(btn);
      }
    }
    function setClassesInternal(classes) {
      currentClasses = normalizeClassList$2(classes);
      renderChips();
      renderSuggestions();
    }
    function commitClassList(next) {
      if (!currentTarget || !currentTarget.isConnected) return;
      const normalized = normalizeClassList$2(next);
      if (isSameStringList$1(normalized, currentClasses)) {
        renderSuggestions();
        return;
      }
      currentClasses = normalized;
      renderChips();
      renderSuggestions();
      onClassChange(currentClasses.slice());
    }
    function addTokens(tokens) {
      if (!tokens.length) return;
      const next = currentClasses.slice();
      const seenSet = new Set(next);
      for (const raw of tokens) {
        const t = String(raw != null ? raw : "").trim();
        if (!t) continue;
        if (seenSet.has(t)) continue;
        seenSet.add(t);
        next.push(t);
      }
      commitClassList(next);
    }
    function removeToken(token) {
      const t = String(token != null ? token : "").trim();
      if (!t) return;
      const next = currentClasses.filter((c) => c !== t);
      commitClassList(next);
    }
    function removeLastToken() {
      if (currentClasses.length === 0) return;
      commitClassList(currentClasses.slice(0, -1));
    }
    function commitInputTokens() {
      const tokens = splitTokens(input.value);
      if (tokens.length === 0) return;
      addTokens(tokens);
      input.value = "";
      renderSuggestions();
    }
    disposer.listen(suggestionsContainer, "mousedown", (e) => {
      e.preventDefault();
    });
    disposer.listen(chipsContainer, "click", (e) => {
      var _a2, _b2;
      const target = e.target;
      const btn = (_a2 = target == null ? void 0 : target.closest) == null ? void 0 : _a2.call(target, 'button[data-action="remove"]');
      const value = (_b2 = btn == null ? void 0 : btn.dataset) == null ? void 0 : _b2.value;
      if (!btn || !value) return;
      e.preventDefault();
      removeToken(value);
    });
    disposer.listen(suggestionsContainer, "click", (e) => {
      var _a2, _b2;
      const target = e.target;
      const btn = (_a2 = target == null ? void 0 : target.closest) == null ? void 0 : _a2.call(target, 'button[data-action="suggestion"]');
      const value = (_b2 = btn == null ? void 0 : btn.dataset) == null ? void 0 : _b2.value;
      if (!btn || !value) return;
      e.preventDefault();
      addTokens([value]);
      input.value = "";
      renderSuggestions();
      input.focus();
    });
    disposer.listen(input, "compositionstart", () => {
      isComposing = true;
    });
    disposer.listen(input, "compositionend", () => {
      isComposing = false;
      renderSuggestions();
    });
    disposer.listen(input, "input", () => {
      renderSuggestions();
    });
    disposer.listen(input, "blur", () => {
      hideSuggestions();
    });
    disposer.listen(input, "paste", () => {
      window.setTimeout(() => {
        if (disposer.isDisposed) return;
        const tokens = splitTokens(input.value);
        if (tokens.length > 1) {
          commitInputTokens();
        } else {
          renderSuggestions();
        }
      }, 0);
    });
    disposer.listen(input, "keydown", (e) => {
      if (input.disabled) return;
      if (e.key === "Enter") {
        if (isComposing) return;
        e.preventDefault();
        commitInputTokens();
        return;
      }
      if (e.key === " ") {
        if (isComposing) return;
        if (input.value.trim()) {
          e.preventDefault();
          commitInputTokens();
        }
        return;
      }
      if (e.key === "Backspace") {
        if (!input.value && currentClasses.length > 0) {
          e.preventDefault();
          removeLastToken();
        }
        return;
      }
      if (e.key === "Escape") {
        if (!suggestionsContainer.hidden) {
          e.preventDefault();
          hideSuggestions();
        } else if (input.value) {
          e.preventDefault();
          input.value = "";
          renderSuggestions();
        }
      }
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element && element.isConnected ? element : null;
      input.value = "";
      hideSuggestions();
      input.disabled = !currentTarget;
      if (!currentTarget) {
        setClassesInternal([]);
        return;
      }
      setClassesInternal(readElementClasses$1(currentTarget));
    }
    function setClasses(classes) {
      if (disposer.isDisposed) return;
      setClassesInternal(classes);
    }
    function refresh() {
      if (disposer.isDisposed) return;
      const target = currentTarget;
      if (!target || !target.isConnected) {
        setTarget(null);
        return;
      }
      setClassesInternal(readElementClasses$1(target));
    }
    function dispose() {
      currentTarget = null;
      currentClasses = [];
      disposer.dispose();
    }
    setTarget(null);
    return {
      setTarget,
      setClasses,
      refresh,
      dispose
    };
  }
  function normalizeTagName$1(tagName) {
    return String(tagName != null ? tagName : "").trim().toLowerCase();
  }
  function normalizePropertyName$2(property) {
    return String(property != null ? property : "").trim();
  }
  function createCssDefaultsProvider() {
    let disposed = false;
    let probeRoot = null;
    const probeByTag = /* @__PURE__ */ new Map();
    const cacheByTag = /* @__PURE__ */ new Map();
    function ensureProbeRoot() {
      var _a2, _b2;
      if (disposed) return null;
      if (typeof document === "undefined") return null;
      if ((_a2 = probeRoot == null ? void 0 : probeRoot.host) == null ? void 0 : _a2.isConnected) return probeRoot;
      const mountPoint = (_b2 = document.documentElement) != null ? _b2 : document.body;
      if (!mountPoint) return null;
      const host = document.createElement("div");
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "all: initial;display: block;position: fixed;left: -100000px;top: 0;width: 100px;height: 100px;overflow: hidden;pointer-events: none;contain: layout style paint;z-index: -1;visibility: hidden;";
      const shadow = host.attachShadow({ mode: "open" });
      const container = document.createElement("div");
      container.style.cssText = "all: initial; display: block;";
      shadow.append(container);
      mountPoint.append(host);
      probeRoot = { host, shadow, container };
      return probeRoot;
    }
    function ensureProbeElement(tagName) {
      const tag = normalizeTagName$1(tagName);
      if (!tag) return null;
      const existing = probeByTag.get(tag);
      if (existing == null ? void 0 : existing.isConnected) return existing;
      const root = ensureProbeRoot();
      if (!root) return null;
      let probe;
      try {
        probe = document.createElement(tag);
      } catch (e) {
        probe = document.createElement("div");
      }
      root.container.append(probe);
      probeByTag.set(tag, probe);
      return probe;
    }
    function ensureBaselineValues(tagName, properties) {
      var _a2, _b2;
      const tag = normalizeTagName$1(tagName);
      if (!tag) return;
      const list = (properties != null ? properties : []).map((p) => normalizePropertyName$2(p)).filter(Boolean);
      if (list.length === 0) return;
      const perTag = (_a2 = cacheByTag.get(tag)) != null ? _a2 : /* @__PURE__ */ new Map();
      if (!cacheByTag.has(tag)) cacheByTag.set(tag, perTag);
      const missing = [];
      for (const prop of list) {
        if (!perTag.has(prop)) missing.push(prop);
      }
      if (missing.length === 0) return;
      const probe = ensureProbeElement(tag);
      if (!probe) return;
      let computed = null;
      try {
        computed = window.getComputedStyle(probe);
      } catch (e) {
        computed = null;
      }
      if (!computed) {
        for (const prop of missing) perTag.set(prop, "");
        return;
      }
      for (const prop of missing) {
        let value = "";
        try {
          value = String((_b2 = computed.getPropertyValue(prop)) != null ? _b2 : "").trim();
        } catch (e) {
          value = "";
        }
        perTag.set(prop, value);
      }
    }
    function getBaselineValue(tagName, property) {
      var _a2, _b2;
      const tag = normalizeTagName$1(tagName);
      const prop = normalizePropertyName$2(property);
      if (!tag || !prop) return "";
      ensureBaselineValues(tag, [prop]);
      return (_b2 = (_a2 = cacheByTag.get(tag)) == null ? void 0 : _a2.get(prop)) != null ? _b2 : "";
    }
    function dispose() {
      var _a2;
      disposed = true;
      try {
        (_a2 = probeRoot == null ? void 0 : probeRoot.host) == null ? void 0 : _a2.remove();
      } catch (e) {
      }
      probeRoot = null;
      probeByTag.clear();
      cacheByTag.clear();
    }
    return {
      ensureBaselineValues,
      getBaselineValue,
      dispose
    };
  }
  const ZERO_SPEC = [0, 0, 0, 0];
  function compareSpecificity(a, b) {
    for (let i = 0; i < 4; i++) {
      if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
  }
  function splitSelectorList(input) {
    const out = [];
    let start = 0;
    let depthParen = 0;
    let depthBrack = 0;
    let quote = null;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "[") depthBrack += 1;
      else if (ch === "]" && depthBrack > 0) depthBrack -= 1;
      else if (ch === "(") depthParen += 1;
      else if (ch === ")" && depthParen > 0) depthParen -= 1;
      if (ch === "," && depthParen === 0 && depthBrack === 0) {
        const part = input.slice(start, i).trim();
        if (part) out.push(part);
        start = i + 1;
      }
    }
    const tail = input.slice(start).trim();
    if (tail) out.push(tail);
    return out;
  }
  function maxSpecificity(list) {
    let best = ZERO_SPEC;
    for (const s of list) if (compareSpecificity(s, best) > 0) best = s;
    return best;
  }
  function computeSelectorSpecificity(selector) {
    let ids = 0;
    let classes = 0;
    let types = 0;
    let expectType = true;
    for (let i = 0; i < selector.length; i++) {
      const ch = selector[i];
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "[") {
        classes += 1;
        i = consumeBracket(selector, i);
        expectType = false;
        continue;
      }
      if (isCombinatorOrWhitespace(selector, i)) {
        i = consumeWhitespaceAndCombinators(selector, i);
        expectType = true;
        continue;
      }
      if (ch === "#") {
        ids += 1;
        i = consumeIdent(selector, i + 1) - 1;
        expectType = false;
        continue;
      }
      if (ch === ".") {
        classes += 1;
        i = consumeIdent(selector, i + 1) - 1;
        expectType = false;
        continue;
      }
      if (ch === ":") {
        const isPseudoEl = selector[i + 1] === ":";
        if (isPseudoEl) {
          types += 1;
          const nameStart2 = i + 2;
          const nameEnd2 = consumeIdent(selector, nameStart2);
          const name2 = selector.slice(nameStart2, nameEnd2).toLowerCase();
          i = nameEnd2 - 1;
          if (selector[i + 1] === "(" && name2 === "slotted") {
            const { content, endIndex } = consumeParenFunction(selector, i + 1);
            const maxArg = maxSpecificity(splitSelectorList(content).map(computeSelectorSpecificity));
            ids += maxArg[1];
            classes += maxArg[2];
            types += maxArg[3];
            i = endIndex;
          }
          expectType = false;
          continue;
        }
        const nameStart = i + 1;
        const nameEnd = consumeIdent(selector, nameStart);
        const name = selector.slice(nameStart, nameEnd).toLowerCase();
        if (LEGACY_PSEUDO_ELEMENTS.has(name)) {
          types += 1;
          i = nameEnd - 1;
          expectType = false;
          continue;
        }
        if (selector[nameEnd] === "(") {
          const { content, endIndex } = consumeParenFunction(selector, nameEnd);
          i = endIndex;
          if (name === "where") {
            expectType = false;
            continue;
          }
          if (name === "is" || name === "not" || name === "has") {
            const maxArg = maxSpecificity(splitSelectorList(content).map(computeSelectorSpecificity));
            ids += maxArg[1];
            classes += maxArg[2];
            types += maxArg[3];
            expectType = false;
            continue;
          }
          if (name === "nth-child" || name === "nth-last-child") {
            classes += 1;
            const ofSelectors = extractNthOfSelectorList(content);
            if (ofSelectors) {
              const maxArg = maxSpecificity(
                splitSelectorList(ofSelectors).map(computeSelectorSpecificity)
              );
              ids += maxArg[1];
              classes += maxArg[2];
              types += maxArg[3];
            }
            expectType = false;
            continue;
          }
          classes += 1;
          expectType = false;
          continue;
        }
        classes += 1;
        i = nameEnd - 1;
        expectType = false;
        continue;
      }
      if (expectType) {
        if (ch === "*") {
          expectType = false;
          continue;
        }
        if (isIdentStart(ch)) {
          types += 1;
          i = consumeIdent(selector, i + 1) - 1;
          expectType = false;
          continue;
        }
      }
    }
    return [0, ids, classes, types];
  }
  function computeMatchedRuleSpecificity(element, selectorText) {
    const selectors = splitSelectorList(selectorText);
    let bestSel = null;
    let bestSpec = ZERO_SPEC;
    for (const sel of selectors) {
      try {
        if (!element.matches(sel)) continue;
        const spec = computeSelectorSpecificity(sel);
        if (!bestSel || compareSpecificity(spec, bestSpec) > 0) {
          bestSel = sel;
          bestSpec = spec;
        }
      } catch (e) {
      }
    }
    return bestSel ? { matchedSelector: bestSel, specificity: bestSpec } : null;
  }
  const LEGACY_PSEUDO_ELEMENTS = /* @__PURE__ */ new Set([
    "before",
    "after",
    "first-line",
    "first-letter",
    "selection",
    "backdrop",
    "placeholder"
  ]);
  function isIdentStart(ch) {
    return /[a-zA-Z_]/.test(ch) || ch.charCodeAt(0) >= 128;
  }
  function consumeIdent(s, start) {
    let i = start;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (/[a-zA-Z0-9_-]/.test(ch) || ch.charCodeAt(0) >= 128) continue;
      break;
    }
    return i;
  }
  function consumeBracket(s, openIndex) {
    let depth = 1;
    let quote = null;
    for (let i = openIndex + 1; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "[") depth += 1;
      else if (ch === "]") {
        depth -= 1;
        if (depth === 0) return i;
      }
    }
    return s.length - 1;
  }
  function consumeParenFunction(s, openParenIndex) {
    let depth = 1;
    let quote = null;
    for (let i = openParenIndex + 1; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "[") i = consumeBracket(s, i);
      else if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) return { content: s.slice(openParenIndex + 1, i), endIndex: i };
      }
    }
    return { content: s.slice(openParenIndex + 1), endIndex: s.length - 1 };
  }
  function isCombinatorOrWhitespace(s, i) {
    const ch = s[i];
    return /\s/.test(ch) || ch === ">" || ch === "+" || ch === "~" || ch === "|";
  }
  function consumeWhitespaceAndCombinators(s, i) {
    let j = i;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === "|" && s[j + 1] === "|") return j + 1;
    if (s[j] === ">" || s[j] === "+" || s[j] === "~" || s[j] === "|") return j;
    return j - 1;
  }
  function extractNthOfSelectorList(content) {
    let depthParen = 0;
    let depthBrack = 0;
    let quote = null;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === "[") depthBrack += 1;
      else if (ch === "]" && depthBrack > 0) depthBrack -= 1;
      else if (ch === "(") depthParen += 1;
      else if (ch === ")" && depthParen > 0) depthParen -= 1;
      if (depthParen === 0 && depthBrack === 0) {
        if (isOfTokenAt(content, i)) return content.slice(i + 2).trimStart();
      }
    }
    return null;
  }
  function isOfTokenAt(s, i) {
    if (s[i] !== "o" || s[i + 1] !== "f") return false;
    const prev = s[i - 1];
    const next = s[i + 2];
    const prevOk = prev === void 0 || /\s/.test(prev);
    const nextOk = next === void 0 || /\s/.test(next);
    return prevOk && nextOk;
  }
  const INHERITED_PROPERTIES = /* @__PURE__ */ new Set([
    // Color & appearance
    "color",
    "color-scheme",
    "caret-color",
    "accent-color",
    // Typography / fonts
    "font",
    "font-family",
    "font-feature-settings",
    "font-kerning",
    "font-language-override",
    "font-optical-sizing",
    "font-palette",
    "font-size",
    "font-size-adjust",
    "font-stretch",
    "font-style",
    "font-synthesis",
    "font-synthesis-small-caps",
    "font-synthesis-style",
    "font-synthesis-weight",
    "font-variant",
    "font-variant-alternates",
    "font-variant-caps",
    "font-variant-east-asian",
    "font-variant-emoji",
    "font-variant-ligatures",
    "font-variant-numeric",
    "font-variant-position",
    "font-variation-settings",
    "font-weight",
    "letter-spacing",
    "line-height",
    "text-rendering",
    "text-size-adjust",
    "text-transform",
    "text-indent",
    "text-align",
    "text-align-last",
    "text-justify",
    "text-shadow",
    "text-emphasis-color",
    "text-emphasis-position",
    "text-emphasis-style",
    "text-underline-position",
    "tab-size",
    "white-space",
    "word-break",
    "overflow-wrap",
    "word-spacing",
    "hyphens",
    "line-break",
    // Writing / bidi
    "direction",
    "unicode-bidi",
    "writing-mode",
    "text-orientation",
    "text-combine-upright",
    // Lists
    "list-style",
    "list-style-image",
    "list-style-position",
    "list-style-type",
    // Tables
    "border-collapse",
    "border-spacing",
    "caption-side",
    "empty-cells",
    // Visibility / interaction
    "cursor",
    "visibility",
    "pointer-events",
    "user-select",
    // Quotes & pagination
    "quotes",
    "orphans",
    "widows",
    // SVG
    "fill",
    "fill-opacity",
    "fill-rule",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-miterlimit",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-opacity",
    "paint-order",
    "shape-rendering",
    "image-rendering",
    "color-interpolation",
    "color-interpolation-filters",
    "color-rendering",
    "dominant-baseline",
    "alignment-baseline",
    "baseline-shift",
    "text-anchor",
    "stop-color",
    "stop-opacity",
    "flood-color",
    "flood-opacity",
    "lighting-color",
    "marker",
    "marker-start",
    "marker-mid",
    "marker-end"
  ]);
  function isInheritableProperty(property) {
    const p = String(property || "").trim();
    if (!p) return false;
    if (p.startsWith("--")) return true;
    return INHERITED_PROPERTIES.has(p.toLowerCase());
  }
  const SHORTHAND_TO_LONGHANDS = {
    // Spacing
    margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
    padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
    inset: ["top", "right", "bottom", "left"],
    // Border
    border: [
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width",
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style",
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color"
    ],
    "border-width": [
      "border-top-width",
      "border-right-width",
      "border-bottom-width",
      "border-left-width"
    ],
    "border-style": [
      "border-top-style",
      "border-right-style",
      "border-bottom-style",
      "border-left-style"
    ],
    "border-color": [
      "border-top-color",
      "border-right-color",
      "border-bottom-color",
      "border-left-color"
    ],
    "border-top": ["border-top-width", "border-top-style", "border-top-color"],
    "border-right": ["border-right-width", "border-right-style", "border-right-color"],
    "border-bottom": ["border-bottom-width", "border-bottom-style", "border-bottom-color"],
    "border-left": ["border-left-width", "border-left-style", "border-left-color"],
    "border-radius": [
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius"
    ],
    outline: ["outline-color", "outline-style", "outline-width"],
    // Background
    background: [
      "background-attachment",
      "background-clip",
      "background-color",
      "background-image",
      "background-origin",
      "background-position",
      "background-repeat",
      "background-size"
    ],
    // Font
    font: [
      "font-style",
      "font-variant",
      "font-weight",
      "font-stretch",
      "font-size",
      "line-height",
      "font-family"
    ],
    // Flexbox
    flex: ["flex-grow", "flex-shrink", "flex-basis"],
    "flex-flow": ["flex-direction", "flex-wrap"],
    // Alignment
    "place-content": ["align-content", "justify-content"],
    "place-items": ["align-items", "justify-items"],
    "place-self": ["align-self", "justify-self"],
    // Gaps
    gap: ["row-gap", "column-gap"],
    "grid-gap": ["row-gap", "column-gap"],
    // Overflow
    overflow: ["overflow-x", "overflow-y"],
    // Grid
    "grid-area": ["grid-row-start", "grid-column-start", "grid-row-end", "grid-column-end"],
    "grid-row": ["grid-row-start", "grid-row-end"],
    "grid-column": ["grid-column-start", "grid-column-end"],
    "grid-template": ["grid-template-rows", "grid-template-columns", "grid-template-areas"],
    // Text
    "text-emphasis": ["text-emphasis-style", "text-emphasis-color"],
    "text-decoration": [
      "text-decoration-line",
      "text-decoration-style",
      "text-decoration-color",
      "text-decoration-thickness"
    ],
    // Animations / transitions
    transition: [
      "transition-property",
      "transition-duration",
      "transition-timing-function",
      "transition-delay"
    ],
    animation: [
      "animation-name",
      "animation-duration",
      "animation-timing-function",
      "animation-delay",
      "animation-iteration-count",
      "animation-direction",
      "animation-fill-mode",
      "animation-play-state"
    ],
    // Multi-column
    columns: ["column-width", "column-count"],
    "column-rule": ["column-rule-width", "column-rule-style", "column-rule-color"],
    // Lists
    "list-style": ["list-style-position", "list-style-image", "list-style-type"]
  };
  function expandToLonghands(property) {
    var _a2;
    const raw = String(property || "").trim();
    if (!raw) return [];
    if (raw.startsWith("--")) return [raw];
    const p = raw.toLowerCase();
    return (_a2 = SHORTHAND_TO_LONGHANDS[p]) != null ? _a2 : [p];
  }
  function normalizePropertyName$1(property) {
    const raw = String(property || "").trim();
    if (!raw) return "";
    if (raw.startsWith("--")) return raw;
    return raw.toLowerCase();
  }
  function compareSourceOrder(a, b) {
    if (a[0] !== b[0]) return a[0] > b[0] ? 1 : -1;
    if (a[1] !== b[1]) return a[1] > b[1] ? 1 : -1;
    if (a[2] !== b[2]) return a[2] > b[2] ? 1 : -1;
    return 0;
  }
  function compareCascade(a, b) {
    if (a.important !== b.important) return a.important ? 1 : -1;
    const spec = compareSpecificity(a.specificity, b.specificity);
    if (spec !== 0) return spec;
    return compareSourceOrder(a.sourceOrder, b.sourceOrder);
  }
  function computeOverrides(candidates) {
    const winners = /* @__PURE__ */ new Map();
    for (const cand of candidates) {
      for (const longhand of cand.affects) {
        const cur = winners.get(longhand);
        if (!cur || compareCascade(cand, cur) > 0) winners.set(longhand, cand);
      }
    }
    const declStatus = /* @__PURE__ */ new Map();
    for (const cand of candidates) declStatus.set(cand.id, "overridden");
    for (const [, winner] of winners) declStatus.set(winner.id, "active");
    return { winners, declStatus };
  }
  const CONTAINER_RULE = (_a = globalThis.CSSRule) == null ? void 0 : _a.CONTAINER_RULE;
  const SCOPE_RULE = (_b = globalThis.CSSRule) == null ? void 0 : _b.SCOPE_RULE;
  function isSheetApplicable(sheet) {
    var _a2, _b2, _c;
    if (sheet.disabled) return false;
    try {
      const mediaText = (_c = (_b2 = (_a2 = sheet.media) == null ? void 0 : _a2.mediaText) == null ? void 0 : _b2.trim()) != null ? _c : "";
      if (!mediaText || mediaText.toLowerCase() === "all") return true;
      return window.matchMedia(mediaText).matches;
    } catch (e) {
      return true;
    }
  }
  function describeStyleSheet(sheet, fallbackIndex) {
    var _a2, _b2;
    const href = typeof sheet.href === "string" ? sheet.href : void 0;
    if (href) {
      const file = (_b2 = (_a2 = href.split("/").pop()) == null ? void 0 : _a2.split("?")[0]) != null ? _b2 : href;
      return { url: href, label: file };
    }
    const ownerNode = sheet.ownerNode;
    if (ownerNode && ownerNode.nodeType === Node.ELEMENT_NODE) {
      const el = ownerNode;
      if (el.tagName === "STYLE") return { label: `<style #${fallbackIndex}>` };
      if (el.tagName === "LINK") return { label: `<link #${fallbackIndex}>` };
    }
    return { label: `<constructed #${fallbackIndex}>` };
  }
  function safeReadCssRules(sheet) {
    try {
      return sheet.cssRules;
    } catch (e) {
      return null;
    }
  }
  function evalMediaRule(rule, warnings) {
    var _a2, _b2, _c;
    try {
      const mediaText = (_c = (_b2 = (_a2 = rule.media) == null ? void 0 : _a2.mediaText) == null ? void 0 : _b2.trim()) != null ? _c : "";
      if (!mediaText || mediaText.toLowerCase() === "all") return true;
      return window.matchMedia(mediaText).matches;
    } catch (e) {
      warnings.push(`Failed to evaluate @media rule: ${String(e)}`);
      return false;
    }
  }
  function evalSupportsRule(rule, warnings) {
    var _a2, _b2;
    try {
      const cond = (_b2 = (_a2 = rule.conditionText) == null ? void 0 : _a2.trim()) != null ? _b2 : "";
      if (!cond) return true;
      if (typeof (CSS == null ? void 0 : CSS.supports) !== "function") return true;
      return CSS.supports(cond);
    } catch (e) {
      warnings.push(`Failed to evaluate @supports rule: ${String(e)}`);
      return false;
    }
  }
  function createRuleIndexForRoot(root, rootId) {
    var _a2, _b2, _c;
    const warnings = [];
    const flatRules = [];
    let rulesScanned = 0;
    const docOrShadow = root;
    const styleSheets = [];
    try {
      for (const s of Array.from((_a2 = docOrShadow.styleSheets) != null ? _a2 : [])) {
        if (s && s instanceof CSSStyleSheet) styleSheets.push(s);
      }
    } catch (e) {
    }
    try {
      const adopted = Array.from((_b2 = docOrShadow.adoptedStyleSheets) != null ? _b2 : []);
      for (const s of adopted) if (s && s instanceof CSSStyleSheet) styleSheets.push(s);
    } catch (e) {
    }
    let order = 0;
    function walkRuleList(list, ctx) {
      var _a3, _b3, _c2, _d, _e, _f;
      for (const rule of Array.from(list)) {
        rulesScanned += 1;
        if (CONTAINER_RULE && rule.type === CONTAINER_RULE) {
          warnings.push("Skipped @container rules (not evaluated in CSSOM collector)");
          continue;
        }
        if (SCOPE_RULE && rule.type === SCOPE_RULE) {
          warnings.push("Skipped @scope rules (not evaluated in CSSOM collector)");
          continue;
        }
        if (rule.type === CSSRule.IMPORT_RULE) {
          const importRule = rule;
          try {
            const mediaText = (_c2 = (_b3 = (_a3 = importRule.media) == null ? void 0 : _a3.mediaText) == null ? void 0 : _b3.trim()) != null ? _c2 : "";
            if (mediaText && mediaText.toLowerCase() !== "all" && !window.matchMedia(mediaText).matches) {
              continue;
            }
          } catch (e) {
          }
          const imported = importRule.styleSheet;
          if (imported) {
            if (ctx.stack.has(imported)) {
              const src = describeStyleSheet(imported, ctx.sheetIndex);
              warnings.push(`Detected @import cycle, skipping: ${(_d = src.url) != null ? _d : src.label}`);
              continue;
            }
            ctx.stack.add(imported);
            try {
              if (!isSheetApplicable(imported)) {
                continue;
              }
              const cssRules = safeReadCssRules(imported);
              const src = describeStyleSheet(imported, ctx.sheetIndex);
              if (!cssRules) {
                warnings.push(
                  `Skipped @import stylesheet (cannot access cssRules, likely cross-origin): ${(_e = src.url) != null ? _e : src.label}`
                );
                continue;
              }
              walkRuleList(cssRules, {
                sheetIndex: ctx.sheetIndex,
                sourceForRules: src,
                topSheet: imported,
                stack: ctx.stack
              });
            } finally {
              ctx.stack.delete(imported);
            }
          }
          continue;
        }
        if (rule.type === CSSRule.MEDIA_RULE) {
          if (evalMediaRule(rule, warnings)) {
            walkRuleList(rule.cssRules, ctx);
          }
          continue;
        }
        if (rule.type === CSSRule.SUPPORTS_RULE) {
          if (evalSupportsRule(rule, warnings)) {
            walkRuleList(rule.cssRules, ctx);
          }
          continue;
        }
        if (rule.type === CSSRule.STYLE_RULE) {
          const styleRule = rule;
          flatRules.push({
            sheetIndex: ctx.sheetIndex,
            order: order++,
            selectorText: (_f = styleRule.selectorText) != null ? _f : "",
            style: styleRule.style,
            source: ctx.sourceForRules
          });
          continue;
        }
        const anyRule = rule;
        if (anyRule.cssRules && typeof anyRule.cssRules.length === "number") {
          try {
            walkRuleList(anyRule.cssRules, ctx);
          } catch (e) {
          }
        }
      }
    }
    for (let sheetIndex = 0; sheetIndex < styleSheets.length; sheetIndex++) {
      const sheet = styleSheets[sheetIndex];
      if (!isSheetApplicable(sheet)) continue;
      const sheetSource = describeStyleSheet(sheet, sheetIndex);
      const cssRules = safeReadCssRules(sheet);
      if (!cssRules) {
        warnings.push(
          `Skipped stylesheet (cannot access cssRules, likely cross-origin): ${(_c = sheetSource.url) != null ? _c : sheetSource.label}`
        );
        continue;
      }
      const recursionStack = /* @__PURE__ */ new Set();
      recursionStack.add(sheet);
      walkRuleList(cssRules, {
        sheetIndex,
        sourceForRules: sheetSource,
        topSheet: sheet,
        stack: recursionStack
      });
    }
    return {
      root,
      rootId,
      flatRules,
      warnings,
      stats: { styleSheets: styleSheets.length, rulesScanned }
    };
  }
  function readStyleDecls(style) {
    var _a2, _b2, _c;
    const out = [];
    const len = Number((_a2 = style == null ? void 0 : style.length) != null ? _a2 : 0);
    for (let i = 0; i < len; i++) {
      let prop = "";
      try {
        prop = style.item(i);
      } catch (e) {
        prop = "";
      }
      prop = normalizePropertyName$1(prop);
      if (!prop) continue;
      let value = "";
      let important = false;
      try {
        value = (_b2 = style.getPropertyValue(prop)) != null ? _b2 : "";
        important = String((_c = style.getPropertyPriority(prop)) != null ? _c : "") === "important";
      } catch (e) {
        value = "";
        important = false;
      }
      out.push({ property: prop, value: String(value).trim(), important, declIndex: i });
    }
    return out;
  }
  function canReadInlineStyle(element) {
    const anyEl = element;
    return !!anyEl.style && typeof anyEl.style.getPropertyValue === "function" && typeof anyEl.style.getPropertyPriority === "function";
  }
  function formatElementLabel(element, maxClasses = 2) {
    var _a2, _b2;
    const tag = element.tagName.toLowerCase();
    const id = (_a2 = element.id) == null ? void 0 : _a2.trim();
    if (id) return `${tag}#${id}`;
    const classes = Array.from((_b2 = element.classList) != null ? _b2 : []).slice(0, maxClasses).filter(Boolean);
    if (classes.length) return `${tag}.${classes.join(".")}`;
    return tag;
  }
  function getElementRoot(element) {
    var _a2, _b2, _c;
    try {
      const root = (_a2 = element.getRootNode) == null ? void 0 : _a2.call(element);
      return root instanceof ShadowRoot ? root : (_b2 = element.ownerDocument) != null ? _b2 : document;
    } catch (e) {
      return (_c = element.ownerDocument) != null ? _c : document;
    }
  }
  function getParentElementOrHost$1(element) {
    var _a2;
    if (element.parentElement) return element.parentElement;
    try {
      const root = (_a2 = element.getRootNode) == null ? void 0 : _a2.call(element);
      if (root instanceof ShadowRoot) return root.host;
    } catch (e) {
    }
    return null;
  }
  function collectForElement(element, index, elementId, options) {
    const warnings = [];
    const matchedRules = [];
    const candidates = [];
    const rootType = index.root instanceof ShadowRoot ? "shadow" : "document";
    let inlineRule = null;
    if (options.includeInline && canReadInlineStyle(element)) {
      const declsRaw = readStyleDecls(element.style);
      const decls = [];
      for (const d of declsRaw) {
        const affects = expandToLonghands(d.property);
        if (!options.declFilter({ property: d.property, affects })) continue;
        const declId = `inline:${elementId}:${d.declIndex}`;
        decls.push({
          id: declId,
          name: d.property,
          value: d.value,
          important: d.important,
          affects,
          status: "overridden"
        });
        candidates.push({
          id: declId,
          important: d.important,
          specificity: [1, 0, 0, 0],
          sourceOrder: [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, d.declIndex],
          property: d.property,
          value: d.value,
          affects,
          ownerRuleId: `inline:${elementId}`,
          ownerElementId: elementId
        });
      }
      inlineRule = {
        id: `inline:${elementId}`,
        origin: "inline",
        selector: "element.style",
        matchedSelector: "element.style",
        specificity: [1, 0, 0, 0],
        source: { label: "element.style" },
        order: Number.MAX_SAFE_INTEGER,
        decls
      };
    }
    for (const flat of index.flatRules) {
      const match = computeMatchedRuleSpecificity(element, flat.selectorText);
      if (!match) continue;
      const declsRaw = readStyleDecls(flat.style);
      const decls = [];
      const ruleId = `rule:${index.rootId}:${flat.sheetIndex}:${flat.order}`;
      for (const d of declsRaw) {
        const affects = expandToLonghands(d.property);
        if (!options.declFilter({ property: d.property, affects })) continue;
        const declId = `${ruleId}:${d.declIndex}`;
        decls.push({
          id: declId,
          name: d.property,
          value: d.value,
          important: d.important,
          affects,
          status: "overridden"
        });
        candidates.push({
          id: declId,
          important: d.important,
          specificity: match.specificity,
          sourceOrder: [flat.sheetIndex, flat.order, d.declIndex],
          property: d.property,
          value: d.value,
          affects,
          ownerRuleId: ruleId,
          ownerElementId: elementId
        });
      }
      if (decls.length === 0) continue;
      matchedRules.push({
        id: ruleId,
        origin: "rule",
        selector: flat.selectorText,
        matchedSelector: match.matchedSelector,
        specificity: match.specificity,
        source: flat.source,
        order: flat.order,
        decls
      });
    }
    matchedRules.sort((a, b) => {
      var _a2, _b2;
      const sa = (_a2 = a.specificity) != null ? _a2 : ZERO_SPEC;
      const sb = (_b2 = b.specificity) != null ? _b2 : ZERO_SPEC;
      const spec = compareSpecificity(sb, sa);
      if (spec !== 0) return spec;
      return b.order - a.order;
    });
    return {
      element,
      elementId,
      root: index.root,
      rootType,
      inlineRule,
      matchedRules,
      candidates,
      warnings,
      stats: { matchedRules: matchedRules.length }
    };
  }
  function collectCssPanelSnapshot(element, options = {}) {
    var _a2, _b2;
    const warnings = [];
    const maxDepth = Number.isFinite(options.maxInheritanceDepth) ? Math.max(0, options.maxInheritanceDepth) : 10;
    const elementIds = /* @__PURE__ */ new WeakMap();
    let nextElementId = 1;
    const rootIds = /* @__PURE__ */ new WeakMap();
    let nextRootId = 1;
    const indexCache = /* @__PURE__ */ new WeakMap();
    const indexList = [];
    function getElementId(el) {
      const existing = elementIds.get(el);
      if (existing) return existing;
      const id = nextElementId++;
      elementIds.set(el, id);
      return id;
    }
    function getIndex(root) {
      var _a3;
      const cached = indexCache.get(root);
      if (cached) return cached;
      const rootId = (_a3 = rootIds.get(root)) != null ? _a3 : (() => {
        const v = nextRootId++;
        rootIds.set(root, v);
        return v;
      })();
      const idx = createRuleIndexForRoot(root, rootId);
      indexCache.set(root, idx);
      indexList.push(idx);
      return idx;
    }
    if (!element || !element.isConnected) {
      return {
        target: { label: formatElementLabel(element), root: "document" },
        warnings: ["Target element is not connected; snapshot may be incomplete."],
        stats: { roots: 0, styleSheets: 0, rulesScanned: 0, matchedRules: 0 },
        sections: []
      };
    }
    const targetRoot = getElementRoot(element);
    const targetIndex = getIndex(targetRoot);
    warnings.push(...targetIndex.warnings);
    const targetCollected = collectForElement(element, targetIndex, getElementId(element), {
      includeInline: true,
      declFilter: () => true
    });
    const targetOverrides = computeOverrides(targetCollected.candidates);
    const targetDeclStatus = targetOverrides.declStatus;
    if (targetCollected.inlineRule) {
      for (const d of targetCollected.inlineRule.decls) {
        d.status = (_a2 = targetDeclStatus.get(d.id)) != null ? _a2 : "overridden";
      }
    }
    for (const rule of targetCollected.matchedRules) {
      for (const d of rule.decls) d.status = (_b2 = targetDeclStatus.get(d.id)) != null ? _b2 : "overridden";
    }
    const ancestors = [];
    let cur = getParentElementOrHost$1(element);
    while (cur && ancestors.length < maxDepth) {
      ancestors.push(cur);
      cur = getParentElementOrHost$1(cur);
    }
    const inheritableLonghands = /* @__PURE__ */ new Set();
    for (const cand of targetCollected.candidates) {
      for (const lh of cand.affects) if (isInheritableProperty(lh)) inheritableLonghands.add(lh);
    }
    const ancestorData = [];
    for (const a of ancestors) {
      const aRoot = getElementRoot(a);
      const aIndex = getIndex(aRoot);
      warnings.push(...aIndex.warnings);
      const aCollected = collectForElement(a, aIndex, getElementId(a), {
        includeInline: true,
        declFilter: ({ affects }) => affects.some(isInheritableProperty)
      });
      const filteredCandidates = [];
      for (const cand of aCollected.candidates) {
        const affects = cand.affects.filter(isInheritableProperty);
        if (affects.length === 0) continue;
        const next = __spreadProps(__spreadValues({}, cand), { affects });
        filteredCandidates.push(next);
        for (const lh of affects) inheritableLonghands.add(lh);
      }
      const aOverrides = computeOverrides(filteredCandidates);
      if (aCollected.inlineRule) {
        aCollected.inlineRule.decls = aCollected.inlineRule.decls.map((d) => __spreadProps(__spreadValues({}, d), { affects: d.affects.filter(isInheritableProperty) })).filter((d) => d.affects.length > 0);
        if (aCollected.inlineRule.decls.length === 0) aCollected.inlineRule = null;
      }
      aCollected.matchedRules = aCollected.matchedRules.map((r) => __spreadProps(__spreadValues({}, r), {
        decls: r.decls.map((d) => __spreadProps(__spreadValues({}, d), { affects: d.affects.filter(isInheritableProperty) })).filter((d) => d.affects.length > 0)
      })).filter((r) => r.decls.length > 0);
      if (!aCollected.inlineRule && aCollected.matchedRules.length === 0) continue;
      ancestorData.push({
        ancestor: a,
        label: formatElementLabel(a),
        collected: __spreadProps(__spreadValues({}, aCollected), { candidates: filteredCandidates }),
        overrides: aOverrides
      });
    }
    const finalInheritedDeclIds = /* @__PURE__ */ new Set();
    for (const longhand of inheritableLonghands) {
      if (targetOverrides.winners.has(longhand)) continue;
      for (const a of ancestorData) {
        const win = a.overrides.winners.get(longhand);
        if (win) {
          finalInheritedDeclIds.add(win.id);
          break;
        }
      }
    }
    for (const a of ancestorData) {
      if (a.collected.inlineRule) {
        for (const d of a.collected.inlineRule.decls) {
          d.status = finalInheritedDeclIds.has(d.id) ? "active" : "overridden";
        }
      }
      for (const r of a.collected.matchedRules) {
        for (const d of r.decls) d.status = finalInheritedDeclIds.has(d.id) ? "active" : "overridden";
      }
    }
    const sections = [];
    sections.push({
      kind: "inline",
      title: "element.style",
      rules: targetCollected.inlineRule ? [targetCollected.inlineRule] : []
    });
    sections.push({
      kind: "matched",
      title: "Matched CSS Rules",
      rules: targetCollected.matchedRules
    });
    for (const a of ancestorData) {
      const rules = [];
      if (a.collected.inlineRule) rules.push(a.collected.inlineRule);
      rules.push(...a.collected.matchedRules);
      sections.push({
        kind: "inherited",
        title: `Inherited from ${a.label}`,
        inheritedFrom: { label: a.label },
        rules
      });
    }
    let totalStyleSheets = 0;
    let totalRulesScanned = 0;
    const rootsSeen = /* @__PURE__ */ new Set();
    for (const idx of indexList) {
      rootsSeen.add(idx.rootId);
      totalStyleSheets += idx.stats.styleSheets;
      totalRulesScanned += idx.stats.rulesScanned;
    }
    const dedupWarnings = Array.from(/* @__PURE__ */ new Set([...warnings, ...targetCollected.warnings]));
    return {
      target: {
        label: formatElementLabel(element),
        root: targetRoot instanceof ShadowRoot ? "shadow" : "document"
      },
      warnings: dedupWarnings,
      stats: {
        roots: rootsSeen.size,
        styleSheets: totalStyleSheets,
        rulesScanned: totalRulesScanned,
        matchedRules: targetCollected.stats.matchedRules
      },
      sections
    };
  }
  function formatSpecificity(spec) {
    if (!spec) return "";
    return `(${spec[0]}, ${spec[1]}, ${spec[2]}, ${spec[3]})`;
  }
  function readElementClasses(element) {
    var _a2;
    try {
      const list = element.classList;
      if (list && typeof list[Symbol.iterator] === "function") {
        return Array.from(list).filter(Boolean);
      }
    } catch (e) {
    }
    try {
      const raw = (_a2 = element.getAttribute("class")) != null ? _a2 : "";
      return raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function applyClassListToElement$1(element, classes) {
    const seen = /* @__PURE__ */ new Set();
    const normalized = [];
    for (const raw of classes != null ? classes : []) {
      const token = String(raw != null ? raw : "").trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      normalized.push(token);
    }
    const value = normalized.join(" ").trim();
    try {
      if (value) {
        element.setAttribute("class", value);
      } else {
        element.removeAttribute("class");
      }
    } catch (e) {
    }
  }
  function unescapeCssIdentifier(input) {
    var _a2;
    const s = String(input != null ? input : "");
    let out = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch !== "\\") {
        out += ch;
        continue;
      }
      if (i >= s.length - 1) break;
      let j = i + 1;
      let hex = "";
      while (j < s.length && hex.length < 6 && /[0-9a-fA-F]/.test(s[j])) {
        hex += s[j];
        j += 1;
      }
      if (hex.length > 0) {
        const codePoint = Number.parseInt(hex, 16);
        if (Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 1114111) {
          out += String.fromCodePoint(codePoint);
          if (j < s.length && /\s/.test(s[j])) j += 1;
          i = j - 1;
          continue;
        }
      }
      out += (_a2 = s[j]) != null ? _a2 : "";
      i = j;
    }
    return out;
  }
  function consumeClassIdent(selector, start) {
    for (let i = start; i < selector.length; i++) {
      const ch = selector[i];
      if (ch === "\\") {
        const next = i + 1;
        if (next >= selector.length) {
          return selector.length;
        }
        if (/[0-9a-fA-F]/.test(selector[next])) {
          let j = next;
          let hexCount = 0;
          while (j < selector.length && hexCount < 6 && /[0-9a-fA-F]/.test(selector[j])) {
            j += 1;
            hexCount += 1;
          }
          if (j < selector.length && /\s/.test(selector[j])) {
            j += 1;
          }
          i = j - 1;
        } else {
          i = next;
        }
        continue;
      }
      if (/\s/.test(ch) || ch === "." || ch === "#" || ch === ":" || ch === "[" || ch === "]" || ch === "(" || ch === ")" || ch === "," || ch === ">" || ch === "+" || ch === "~" || ch === "|") {
        return i;
      }
    }
    return selector.length;
  }
  function extractClassNamesFromSelector(selector) {
    const out = [];
    const s = String(selector != null ? selector : "");
    let bracketDepth = 0;
    let quote = null;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (quote) {
        if (ch === "\\") {
          i += 1;
          continue;
        }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === "[") {
        bracketDepth += 1;
        continue;
      }
      if (ch === "]") {
        bracketDepth = Math.max(0, bracketDepth - 1);
        continue;
      }
      if (bracketDepth > 0) continue;
      if (ch !== ".") continue;
      const start = i + 1;
      if (start >= s.length) continue;
      const end = consumeClassIdent(s, start);
      const raw = s.slice(start, end);
      const cls = unescapeCssIdentifier(raw).trim();
      if (cls) out.push(cls);
      i = end - 1;
    }
    return out;
  }
  function collectClassSuggestions(snapshot) {
    var _a2;
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const section of snapshot.sections) {
      for (const rule of section.rules) {
        const selector = (_a2 = rule.matchedSelector) != null ? _a2 : rule.selector;
        for (const cls of extractClassNamesFromSelector(selector)) {
          if (!cls) continue;
          if (seen.has(cls)) continue;
          seen.add(cls);
          out.push(cls);
          if (out.length >= MAX_SUGGESTION_CACHE) return out;
        }
      }
    }
    return out;
  }
  function isDesignToken(declName) {
    return declName.trim().startsWith("--");
  }
  const GLOBAL_SELECTORS = /* @__PURE__ */ new Set(["*", "html", "body", ":root", ":where(*)", ":is(*)"]);
  function isGlobalSelector(selector) {
    const normalized = selector.trim().toLowerCase();
    if (GLOBAL_SELECTORS.has(normalized)) return true;
    const parts = normalized.split(/\s*,\s*/);
    return parts.every((part) => {
      const tokens = part.split(/\s+/).filter(Boolean);
      return tokens.every((t) => GLOBAL_SELECTORS.has(t) || t === ">" || t === "+" || t === "~");
    });
  }
  function getDeclAffectedProperties(decl) {
    if (Array.isArray(decl.affects)) {
      const affects = decl.affects;
      if (affects && affects.length > 0) return affects;
    }
    return [decl.name];
  }
  function collectBaselineProperties(snapshot) {
    const out = /* @__PURE__ */ new Set();
    for (const section of snapshot.sections) {
      for (const rule of section.rules) {
        for (const decl of rule.decls) {
          if (decl.status !== "active") continue;
          if (isDesignToken(decl.name)) continue;
          for (const prop of getDeclAffectedProperties(decl)) {
            const name = String(prop != null ? prop : "").trim();
            if (name) out.add(name);
          }
        }
      }
    }
    return Array.from(out);
  }
  function isDefaultValueDecl(decl, ctx) {
    var _a2;
    if (decl.status !== "active") return false;
    if (!ctx.computedStyle) return false;
    const props = getDeclAffectedProperties(decl);
    let hasComparable = false;
    for (const propRaw of props) {
      const prop = String(propRaw != null ? propRaw : "").trim();
      if (!prop) continue;
      let computed = "";
      try {
        computed = String((_a2 = ctx.computedStyle.getPropertyValue(prop)) != null ? _a2 : "").trim();
      } catch (e) {
        computed = "";
      }
      const baseline = ctx.defaults.getBaselineValue(ctx.tagName, prop);
      if (computed || baseline) hasComparable = true;
      if (computed !== baseline) return false;
    }
    return hasComparable;
  }
  function shouldRenderDecl(decl, ctx) {
    if (isDesignToken(decl.name)) return false;
    if (isDefaultValueDecl(decl, ctx)) return false;
    return true;
  }
  function shouldFilterGlobalSelector(selector, tagName) {
    if (!isGlobalSelector(selector)) return false;
    const tag = tagName.toLowerCase();
    if (tag === "html" || tag === "body") return false;
    return true;
  }
  function createRuleBlock(rule, disposer, ctx) {
    var _a2, _b2;
    const matchedSelector = (_a2 = rule.matchedSelector) != null ? _a2 : rule.selector;
    if (rule.origin === "rule" && shouldFilterGlobalSelector(matchedSelector, ctx.tagName)) {
      return null;
    }
    const visibleDecls = rule.decls.filter((decl) => shouldRenderDecl(decl, ctx));
    if (visibleDecls.length === 0) return null;
    const block = document.createElement("div");
    block.className = "we-css-rule";
    block.dataset.ruleId = rule.id;
    block.dataset.origin = rule.origin;
    const header = document.createElement("div");
    header.className = "we-css-rule-header";
    const selector = document.createElement("span");
    selector.className = "we-css-rule-selector";
    selector.textContent = (_b2 = rule.matchedSelector) != null ? _b2 : rule.selector;
    selector.title = rule.selector;
    header.append(selector);
    if (rule.source) {
      const source = document.createElement("span");
      source.className = "we-css-rule-source";
      source.textContent = rule.source.label;
      if (rule.source.url) {
        source.title = rule.source.url;
      }
      header.append(source);
    }
    if (rule.origin === "rule" && rule.specificity) {
      const specBadge = document.createElement("span");
      specBadge.className = "we-css-rule-spec";
      specBadge.textContent = formatSpecificity(rule.specificity);
      specBadge.title = "Specificity (inline, id, class, type)";
      header.append(specBadge);
    }
    block.append(header);
    const declsContainer = document.createElement("div");
    declsContainer.className = "we-css-decls";
    for (const decl of visibleDecls) {
      const declEl = createDeclaration(decl);
      declsContainer.append(declEl);
    }
    block.append(declsContainer);
    return block;
  }
  function createDeclaration(decl) {
    const el = document.createElement("div");
    el.className = "we-css-decl";
    el.dataset.status = decl.status;
    const name = document.createElement("span");
    name.className = "we-css-decl-name";
    name.textContent = decl.name;
    const colon = document.createElement("span");
    colon.className = "we-css-decl-colon";
    colon.textContent = ": ";
    const valueContainer = document.createElement("span");
    valueContainer.className = "we-css-decl-value-container";
    const value = document.createElement("span");
    value.className = "we-css-decl-value";
    value.textContent = decl.value;
    valueContainer.append(value);
    if (decl.important) {
      const imp = document.createElement("span");
      imp.className = "we-css-decl-important";
      imp.textContent = "!important";
      valueContainer.append(imp);
    }
    const semi = document.createElement("span");
    semi.className = "we-css-decl-semi";
    semi.textContent = ";";
    el.append(name, colon, valueContainer, semi);
    return el;
  }
  function hasRenderableRule(rule, ctx) {
    var _a2;
    const matchedSelector = (_a2 = rule.matchedSelector) != null ? _a2 : rule.selector;
    if (rule.origin === "rule" && shouldFilterGlobalSelector(matchedSelector, ctx.tagName)) {
      return false;
    }
    return rule.decls.some((decl) => shouldRenderDecl(decl, ctx));
  }
  function hasRenderableDecls(section, ctx) {
    return section.rules.some((rule) => hasRenderableRule(rule, ctx));
  }
  function createSection(section, disposer, ctx) {
    if (!hasRenderableDecls(section, ctx)) return null;
    const el = document.createElement("div");
    el.className = "we-css-section";
    el.dataset.kind = section.kind;
    if (section.kind === "inherited") {
      const header = document.createElement("div");
      header.className = "we-css-section-header";
      const title = document.createElement("span");
      title.className = "we-css-section-title";
      title.textContent = section.title;
      header.append(title);
      el.append(header);
    }
    const rulesContainer = document.createElement("div");
    rulesContainer.className = "we-css-section-rules";
    for (const rule of section.rules) {
      const ruleEl = createRuleBlock(rule, disposer, ctx);
      if (ruleEl) rulesContainer.append(ruleEl);
    }
    if (rulesContainer.childElementCount === 0) return null;
    el.append(rulesContainer);
    return el;
  }
  function createCssPanel(options) {
    const { container, transactionManager, onClassChange } = options;
    const disposer = new Disposer();
    const defaultsProvider = createCssDefaultsProvider();
    disposer.add(() => defaultsProvider.dispose());
    let currentTarget = null;
    let snapshot = null;
    let classSuggestions = [];
    let classEditor = null;
    let isVisible = false;
    let needsRefresh = false;
    const root = document.createElement("div");
    root.className = "we-css-panel";
    const classEditorMount = document.createElement("div");
    classEditorMount.className = "we-css-class-editor-mount";
    const infoBar = document.createElement("div");
    infoBar.className = "we-css-info";
    infoBar.hidden = true;
    const emptyState = document.createElement("div");
    emptyState.className = "we-css-empty";
    emptyState.textContent = "No styles";
    const warningsContainer = document.createElement("div");
    warningsContainer.className = "we-css-warnings";
    warningsContainer.hidden = true;
    const sectionsContainer = document.createElement("div");
    sectionsContainer.className = "we-css-sections";
    classEditor = createClassEditor({
      container: classEditorMount,
      onClassChange: (nextClasses) => {
        const target = currentTarget;
        if (!target || !target.isConnected) return;
        const beforeClasses = readElementClasses(target);
        if (transactionManager) {
          transactionManager.recordClass(target, beforeClasses, nextClasses);
        } else {
          applyClassListToElement$1(target, nextClasses);
        }
        classEditor == null ? void 0 : classEditor.setClasses(readElementClasses(target));
        onClassChange == null ? void 0 : onClassChange();
        collectAndRender();
      },
      getSuggestions: () => classSuggestions
    });
    root.append(classEditorMount, infoBar, warningsContainer, emptyState, sectionsContainer);
    container.append(root);
    disposer.add(() => root.remove());
    function renderSnapshot() {
      sectionsContainer.innerHTML = "";
      warningsContainer.innerHTML = "";
      if (!snapshot) {
        emptyState.hidden = false;
        emptyState.textContent = "Select an element to view styles";
        infoBar.hidden = true;
        warningsContainer.hidden = true;
        return;
      }
      const tagName = currentTarget ? currentTarget.tagName.toLowerCase() : "";
      let computedStyle = null;
      try {
        if (currentTarget == null ? void 0 : currentTarget.isConnected) {
          computedStyle = window.getComputedStyle(currentTarget);
        }
      } catch (e) {
        computedStyle = null;
      }
      const filterCtx = {
        defaults: defaultsProvider,
        tagName,
        computedStyle
      };
      if (computedStyle && tagName) {
        defaultsProvider.ensureBaselineValues(tagName, collectBaselineProperties(snapshot));
      }
      const hasRules = snapshot.sections.some((section) => hasRenderableDecls(section, filterCtx));
      if (!hasRules) {
        emptyState.hidden = false;
        emptyState.textContent = "No CSS rules matched";
        infoBar.hidden = true;
      } else {
        emptyState.hidden = true;
        const { stats } = snapshot;
        infoBar.textContent = `${stats.matchedRules} rules matched (${stats.styleSheets} stylesheets, ${stats.rulesScanned} rules scanned)`;
        infoBar.hidden = false;
      }
      if (snapshot.warnings.length > 0) {
        warningsContainer.hidden = false;
        for (const warning of snapshot.warnings.slice(0, 5)) {
          const warningEl = document.createElement("div");
          warningEl.className = "we-css-warning";
          warningEl.textContent = warning;
          warningsContainer.append(warningEl);
        }
        if (snapshot.warnings.length > 5) {
          const more = document.createElement("div");
          more.className = "we-css-warning-more";
          more.textContent = `...and ${snapshot.warnings.length - 5} more warnings`;
          warningsContainer.append(more);
        }
      } else {
        warningsContainer.hidden = true;
      }
      for (const section of snapshot.sections) {
        const sectionEl = createSection(section, disposer, filterCtx);
        if (sectionEl) sectionsContainer.append(sectionEl);
      }
    }
    function collectAndRender() {
      if (!isVisible) {
        needsRefresh = true;
        return;
      }
      if (!currentTarget || !currentTarget.isConnected) {
        snapshot = null;
        classSuggestions = [];
        classEditor == null ? void 0 : classEditor.setTarget(null);
        renderSnapshot();
        return;
      }
      snapshot = collectCssPanelSnapshot(currentTarget, {
        maxInheritanceDepth: 0
      });
      classSuggestions = snapshot ? collectClassSuggestions(snapshot) : [];
      renderSnapshot();
      needsRefresh = false;
    }
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element;
      classEditor == null ? void 0 : classEditor.setTarget(element);
      collectAndRender();
    }
    function refresh() {
      if (disposer.isDisposed) return;
      classEditor == null ? void 0 : classEditor.refresh();
      collectAndRender();
    }
    function setVisible(visible) {
      if (disposer.isDisposed) return;
      isVisible = visible;
      if (visible && needsRefresh) {
        collectAndRender();
      }
    }
    function dispose() {
      currentTarget = null;
      snapshot = null;
      classEditor == null ? void 0 : classEditor.dispose();
      classEditor = null;
      classSuggestions = [];
      isVisible = false;
      needsRefresh = false;
      disposer.dispose();
    }
    renderSnapshot();
    return {
      setTarget,
      refresh,
      setVisible,
      dispose
    };
  }
  const MAX_DOM_DEPTH = 15;
  const MAX_FIBER_DEPTH = 40;
  function asRecord(value) {
    if (value && typeof value === "object") {
      return value;
    }
    return null;
  }
  function readString(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed || void 0;
    }
    return void 0;
  }
  function readNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : void 0;
  }
  function readComponentName(value) {
    var _a2, _b2;
    if (!value) return void 0;
    if (typeof value === "function") {
      const fn = value;
      return (_a2 = readString(fn.displayName)) != null ? _a2 : readString(fn.name);
    }
    const rec = asRecord(value);
    if (rec) {
      return (_b2 = readString(rec.displayName)) != null ? _b2 : readString(rec.name);
    }
    return void 0;
  }
  function extractReactDebugSource(fiber) {
    var _a2, _b2;
    let current = fiber;
    for (let i = 0; i < MAX_FIBER_DEPTH && current; i++) {
      const rec = asRecord(current);
      if (!rec) break;
      const src = asRecord(rec._debugSource);
      const file = readString(src == null ? void 0 : src.fileName);
      if (file) {
        const componentName = (_a2 = readComponentName(rec.elementType)) != null ? _a2 : readComponentName(rec.type);
        return {
          file,
          line: readNumber(src == null ? void 0 : src.lineNumber),
          column: readNumber(src == null ? void 0 : src.columnNumber),
          componentName
        };
      }
      const owner = asRecord(rec._debugOwner);
      const ownerSrc = asRecord(owner == null ? void 0 : owner._debugSource);
      const ownerFile = readString(ownerSrc == null ? void 0 : ownerSrc.fileName);
      if (ownerFile) {
        const componentName = (_b2 = readComponentName(owner == null ? void 0 : owner.elementType)) != null ? _b2 : readComponentName(owner == null ? void 0 : owner.type);
        return {
          file: ownerFile,
          line: readNumber(ownerSrc == null ? void 0 : ownerSrc.lineNumber),
          column: readNumber(ownerSrc == null ? void 0 : ownerSrc.columnNumber),
          componentName
        };
      }
      current = rec.return;
    }
    return null;
  }
  function findReactDebugSource(element) {
    try {
      let node = element;
      for (let depth = 0; depth < MAX_DOM_DEPTH && node; depth++) {
        const rec = node;
        for (const key of Object.keys(rec)) {
          if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
            const source = extractReactDebugSource(rec[key]);
            if (source) return source;
          }
        }
        node = node.parentElement;
      }
    } catch (e) {
    }
    return null;
  }
  function parseVInspector(value) {
    if (typeof value !== "string") return null;
    const raw = value.trim();
    if (!raw) return null;
    const match = raw.match(/:(\d+)(?::(\d+))?$/);
    if (!match) {
      return { file: raw };
    }
    const file = raw.slice(0, match.index).trim();
    if (!file) return null;
    const line = Number.parseInt(match[1], 10);
    const columnRaw = match[2] ? Number.parseInt(match[2], 10) : void 0;
    return {
      file,
      line: Number.isFinite(line) && line > 0 ? line : void 0,
      column: columnRaw !== void 0 && Number.isFinite(columnRaw) && columnRaw > 0 ? columnRaw : void 0
    };
  }
  function findInspectorLocation(element) {
    try {
      let node = element;
      for (let depth = 0; depth < MAX_DOM_DEPTH && node; depth++) {
        if (typeof node.getAttribute === "function") {
          const attr = node.getAttribute("data-v-inspector");
          if (attr) {
            const parsed = parseVInspector(attr);
            if (parsed == null ? void 0 : parsed.file) return parsed;
          }
        }
        node = node.parentElement;
      }
    } catch (e) {
    }
    return null;
  }
  function findVueDebugSource(element) {
    try {
      const inspector = findInspectorLocation(element);
      if (inspector == null ? void 0 : inspector.file) {
        let componentName;
        let node2 = element;
        for (let depth = 0; depth < MAX_DOM_DEPTH && node2; depth++) {
          const rec = node2;
          const inst = asRecord(rec.__vueParentComponent);
          const typeRec = asRecord(inst == null ? void 0 : inst.type);
          componentName = readString(typeRec == null ? void 0 : typeRec.name);
          if (componentName) break;
          node2 = node2.parentElement;
        }
        return __spreadProps(__spreadValues({}, inspector), {
          componentName
        });
      }
      let node = element;
      for (let depth = 0; depth < MAX_DOM_DEPTH && node; depth++) {
        const rec = node;
        const inst = asRecord(rec.__vueParentComponent);
        const typeRec = asRecord(inst == null ? void 0 : inst.type);
        const file = readString(typeRec == null ? void 0 : typeRec.__file);
        if (file) {
          return {
            file,
            componentName: readString(typeRec == null ? void 0 : typeRec.name)
          };
        }
        node = node.parentElement;
      }
    } catch (e) {
    }
    return null;
  }
  function findDebugSource(element) {
    const react = findReactDebugSource(element);
    if (react) return react;
    const vue = findVueDebugSource(element);
    if (vue) return vue;
    return null;
  }
  const DEFAULT_MAX_CANDIDATES = 5;
  const FINGERPRINT_TEXT_MAX_LENGTH = 32;
  const FINGERPRINT_MAX_CLASSES = 8;
  const UNIQUE_DATA_ATTRS = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-cy",
    "name",
    "title",
    "alt",
    "aria-label"
    // Phase 2.9: added for better accessibility-based matching
  ];
  const MAX_CLASS_COMBO_DEPTH = 3;
  const ANCHOR_DATA_ATTRS = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-cy"
  ];
  const MAX_SELECTOR_CLASS_COUNT = 24;
  const MAX_ANCHOR_DEPTH = 20;
  function cssEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    const str = String(value);
    const len = str.length;
    if (len === 0) return "";
    let result2 = "";
    const firstCodeUnit = str.charCodeAt(0);
    for (let i = 0; i < len; i++) {
      const codeUnit = str.charCodeAt(i);
      if (codeUnit === 0) {
        result2 += "�";
        continue;
      }
      if (codeUnit >= 1 && codeUnit <= 31 || codeUnit === 127 || i === 0 && codeUnit >= 48 && codeUnit <= 57 || i === 1 && codeUnit >= 48 && codeUnit <= 57 && firstCodeUnit === 45) {
        result2 += `\\${codeUnit.toString(16)} `;
        continue;
      }
      if (i === 0 && len === 1 && codeUnit === 45) {
        result2 += `\\${str.charAt(i)}`;
        continue;
      }
      const isAsciiAlnum = codeUnit >= 48 && codeUnit <= 57 || // 0-9
      codeUnit >= 65 && codeUnit <= 90 || // A-Z
      codeUnit >= 97 && codeUnit <= 122;
      const isSafe = isAsciiAlnum || codeUnit === 45 || codeUnit === 95;
      if (isSafe) {
        result2 += str.charAt(i);
      } else {
        result2 += `\\${str.charAt(i)}`;
      }
    }
    return result2;
  }
  function getQueryRoot(element) {
    var _a2;
    const root = (_a2 = element.getRootNode) == null ? void 0 : _a2.call(element);
    return root instanceof ShadowRoot ? root : document;
  }
  function safeQuerySelector(root, selector) {
    try {
      return root.querySelector(selector);
    } catch (e) {
      return null;
    }
  }
  function isUnique(root, selector) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }
  function tryIdSelector(element, root) {
    var _a2;
    const id = (_a2 = element.id) == null ? void 0 : _a2.trim();
    if (!id) return null;
    const selector = `#${cssEscape(id)}`;
    return isUnique(root, selector) ? selector : null;
  }
  function collectDataAttrSelectors(element, root, max) {
    var _a2;
    const out = [];
    if (max <= 0) return out;
    const tag = element.tagName.toLowerCase();
    for (const attr of UNIQUE_DATA_ATTRS) {
      if (out.length >= max) break;
      const value = (_a2 = element.getAttribute(attr)) == null ? void 0 : _a2.trim();
      if (!value) continue;
      const attrOnly = `[${attr}="${cssEscape(value)}"]`;
      if (isUnique(root, attrOnly)) {
        out.push(attrOnly);
        continue;
      }
      const withTag = `${tag}${attrOnly}`;
      if (isUnique(root, withTag)) {
        out.push(withTag);
      }
    }
    return out;
  }
  function collectClassSelectors(element, root, max) {
    const out = [];
    if (max <= 0) return out;
    const tag = element.tagName.toLowerCase();
    const classes = Array.from(element.classList).filter((c) => c && /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(c)).slice(0, MAX_SELECTOR_CLASS_COUNT);
    if (classes.length === 0) return out;
    const uniqueSingle = /* @__PURE__ */ new Map();
    for (const cls of classes) {
      if (out.length >= max) return out;
      const sel = `.${cssEscape(cls)}`;
      const unique = isUnique(root, sel);
      uniqueSingle.set(cls, unique);
      if (unique) out.push(sel);
    }
    for (const cls of classes) {
      if (out.length >= max) return out;
      if (uniqueSingle.get(cls) === true) continue;
      const sel = `${tag}.${cssEscape(cls)}`;
      if (isUnique(root, sel)) out.push(sel);
    }
    const limit = Math.min(classes.length, MAX_CLASS_COMBO_DEPTH);
    for (let i = 0; i < limit; i++) {
      for (let j = i + 1; j < limit; j++) {
        if (out.length >= max) return out;
        const a = classes[i];
        const b = classes[j];
        const pair = `.${cssEscape(a)}.${cssEscape(b)}`;
        if (isUnique(root, pair)) {
          out.push(pair);
          continue;
        }
        const withTag = `${tag}${pair}`;
        if (isUnique(root, withTag)) out.push(withTag);
      }
    }
    if (limit >= 3 && out.length < max) {
      const triple = `.${cssEscape(classes[0])}.${cssEscape(classes[1])}.${cssEscape(classes[2])}`;
      if (isUnique(root, triple)) {
        out.push(triple);
      } else {
        const withTag = `${tag}${triple}`;
        if (out.length < max && isUnique(root, withTag)) out.push(withTag);
      }
    }
    return out;
  }
  function buildPathSelector(element, root) {
    const segments = [];
    let current = element;
    const isDocument = root instanceof Document;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      if (isDocument && tag === "body") break;
      let selector = tag;
      const parent = current.parentElement;
      const parentNode = current.parentNode;
      let siblings;
      if (parent) {
        siblings = Array.from(parent.children);
      } else if (parentNode instanceof ShadowRoot || parentNode instanceof Document) {
        siblings = Array.from(parentNode.children);
      } else {
        siblings = [];
      }
      const sameTagSiblings = siblings.filter((s) => s.tagName === current.tagName);
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
      segments.unshift(selector);
      current = parent;
      if (!parent && parentNode === root) break;
    }
    const path = segments.join(" > ");
    return isDocument ? `body > ${path}` : path || "*";
  }
  function buildRelativePathSelector(ancestor, target, root) {
    const segments = [];
    let current = target;
    for (let depth = 0; current && current !== ancestor && depth < MAX_ANCHOR_DEPTH; depth++) {
      const tag = current.tagName.toLowerCase();
      let selector = tag;
      const parent = current.parentElement;
      const parentNode = current.parentNode;
      let siblings;
      if (parent) {
        siblings = Array.from(parent.children);
      } else if (parentNode instanceof ShadowRoot || parentNode instanceof Document) {
        siblings = Array.from(parentNode.children);
      } else {
        siblings = [];
      }
      const sameTagSiblings = siblings.filter((s) => s.tagName === current.tagName);
      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
      segments.unshift(selector);
      if (!parent) {
        if (parentNode === root) break;
        break;
      }
      current = parent;
    }
    if (current !== ancestor) return null;
    return segments.join(" > ") || null;
  }
  function tryAnchorSelector(element, root) {
    var _a2;
    const idSel = tryIdSelector(element, root);
    if (idSel) return idSel;
    const tag = element.tagName.toLowerCase();
    for (const attr of ANCHOR_DATA_ATTRS) {
      const value = (_a2 = element.getAttribute(attr)) == null ? void 0 : _a2.trim();
      if (!value) continue;
      const attrOnly = `[${attr}="${cssEscape(value)}"]`;
      if (isUnique(root, attrOnly)) return attrOnly;
      const withTag = `${tag}${attrOnly}`;
      if (isUnique(root, withTag)) return withTag;
    }
    return null;
  }
  function buildAnchorRelPathSelector(element, root) {
    let current = element.parentElement;
    for (let depth = 0; current && depth < MAX_ANCHOR_DEPTH; depth++) {
      const tag = current.tagName.toUpperCase();
      if (tag === "HTML" || tag === "BODY") break;
      const anchor = tryAnchorSelector(current, root);
      if (anchor) {
        const rel = buildRelativePathSelector(current, element, root);
        if (!rel) {
          current = current.parentElement;
          continue;
        }
        const composed = `${anchor} ${rel}`;
        if (!isUnique(root, composed)) {
          current = current.parentElement;
          continue;
        }
        const found = safeQuerySelector(root, composed);
        if (found === element) return composed;
      }
      current = current.parentElement;
    }
    return null;
  }
  function getShadowHostChain(element) {
    var _a2;
    const chain = [];
    let current = element;
    while (true) {
      const root = (_a2 = current.getRootNode) == null ? void 0 : _a2.call(current);
      if (!(root instanceof ShadowRoot)) break;
      const host = root.host;
      if (!(host instanceof Element)) break;
      const hostRoot = getQueryRoot(host);
      const hostSelector = generateCssSelector(host, { root: hostRoot });
      if (!hostSelector) break;
      chain.unshift(hostSelector);
      current = host;
    }
    return chain.length > 0 ? chain : void 0;
  }
  function normalizeText$2(text, maxLength) {
    return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
  }
  function computeFingerprint(element) {
    var _a2, _b2, _c, _d;
    const parts = [];
    const tag = (_b2 = (_a2 = element.tagName) == null ? void 0 : _a2.toLowerCase()) != null ? _b2 : "unknown";
    parts.push(tag);
    const id = (_c = element.id) == null ? void 0 : _c.trim();
    if (id) {
      parts.push(`id=${id}`);
    }
    const classes = Array.from(element.classList).slice(0, FINGERPRINT_MAX_CLASSES);
    if (classes.length > 0) {
      parts.push(`class=${classes.join(".")}`);
    }
    const text = normalizeText$2((_d = element.textContent) != null ? _d : "", FINGERPRINT_TEXT_MAX_LENGTH);
    if (text) {
      parts.push(`text=${text}`);
    }
    return parts.join("|");
  }
  function computeDomPath(element) {
    const path = [];
    let current = element;
    while (current) {
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(current);
        if (index >= 0) path.unshift(index);
        current = parent;
        continue;
      }
      const parentNode = current.parentNode;
      if (parentNode instanceof ShadowRoot || parentNode instanceof Document) {
        const children = Array.from(parentNode.children);
        const index = children.indexOf(current);
        if (index >= 0) path.unshift(index);
      }
      break;
    }
    return path;
  }
  function generateSelectorCandidates(element, options = {}) {
    var _a2, _b2;
    const root = (_a2 = options.root) != null ? _a2 : getQueryRoot(element);
    const maxCandidates = Math.max(1, (_b2 = options.maxCandidates) != null ? _b2 : DEFAULT_MAX_CANDIDATES);
    const candidates = [];
    const push = (selector, limit = maxCandidates) => {
      if (!selector) return;
      if (candidates.length >= limit) return;
      const s = selector.trim();
      if (!s || candidates.includes(s)) return;
      candidates.push(s);
    };
    const anchorCandidate = maxCandidates >= DEFAULT_MAX_CANDIDATES ? buildAnchorRelPathSelector(element, root) : null;
    const tailReserved = 1 + (anchorCandidate ? 1 : 0);
    const headLimit = Math.max(1, maxCandidates - tailReserved);
    push(tryIdSelector(element, root), headLimit);
    for (const sel of collectDataAttrSelectors(element, root, headLimit - candidates.length)) {
      push(sel, headLimit);
    }
    for (const sel of collectClassSelectors(element, root, headLimit - candidates.length)) {
      push(sel, headLimit);
    }
    push(buildPathSelector(element, root));
    push(anchorCandidate);
    return candidates.slice(0, maxCandidates);
  }
  function generateCssSelector(element, options = {}) {
    var _a2;
    return (_a2 = generateSelectorCandidates(element, options)[0]) != null ? _a2 : "";
  }
  function createElementLocator(element) {
    var _a2;
    const root = getQueryRoot(element);
    const debugSource = (_a2 = findDebugSource(element)) != null ? _a2 : void 0;
    return {
      selectors: generateSelectorCandidates(element, { root, maxCandidates: DEFAULT_MAX_CANDIDATES }),
      fingerprint: computeFingerprint(element),
      path: computeDomPath(element),
      shadowHostChain: getShadowHostChain(element),
      debugSource
    };
  }
  function isSelectorUnique(root, selector) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch (e) {
      return false;
    }
  }
  function verifyFingerprint(element, fingerprint) {
    const currentFingerprint = computeFingerprint(element);
    const storedParts = fingerprint.split("|");
    const currentParts = currentFingerprint.split("|");
    if (storedParts[0] !== currentParts[0]) return false;
    const storedId = storedParts.find((p) => p.startsWith("id="));
    const currentId = currentParts.find((p) => p.startsWith("id="));
    if (storedId && storedId !== currentId) return false;
    return true;
  }
  function locateElement(locator, rootDocument = document) {
    var _a2, _b2;
    let doc = rootDocument;
    if ((_a2 = locator.frameChain) == null ? void 0 : _a2.length) {
      for (const frameSelector of locator.frameChain) {
        const frame = safeQuerySelector(doc, frameSelector);
        if (!(frame instanceof HTMLIFrameElement)) return null;
        const contentDoc = frame.contentDocument;
        if (!contentDoc) return null;
        doc = contentDoc;
      }
    }
    let queryRoot = doc;
    if ((_b2 = locator.shadowHostChain) == null ? void 0 : _b2.length) {
      for (const hostSelector of locator.shadowHostChain) {
        if (!isSelectorUnique(queryRoot, hostSelector)) return null;
        const host = safeQuerySelector(queryRoot, hostSelector);
        if (!host) return null;
        const shadowRoot = host.shadowRoot;
        if (!shadowRoot) return null;
        queryRoot = shadowRoot;
      }
    }
    for (const selector of locator.selectors) {
      if (!isSelectorUnique(queryRoot, selector)) continue;
      const element = safeQuerySelector(queryRoot, selector);
      if (!element) continue;
      if (locator.fingerprint && !verifyFingerprint(element, locator.fingerprint)) {
        continue;
      }
      return element;
    }
    return null;
  }
  function locatorKey(locator) {
    var _a2, _b2, _c, _d;
    const selectors = locator.selectors.join("|");
    const shadow = (_b2 = (_a2 = locator.shadowHostChain) == null ? void 0 : _a2.join(">")) != null ? _b2 : "";
    const frame = (_d = (_c = locator.frameChain) == null ? void 0 : _c.join(">")) != null ? _d : "";
    return `frame:${frame}|shadow:${shadow}|sel:${selectors}`;
  }
  const WRITE_DEBOUNCE_MS = 250;
  const DANGEROUS_PROP_KEYS = /* @__PURE__ */ new Set([
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__"
  ]);
  function isDangerousPropKey(key) {
    return DANGEROUS_PROP_KEYS.has(String(key != null ? key : "").trim());
  }
  function formatFramework(framework, version) {
    if (framework === "react") {
      const trimmedVersion = version == null ? void 0 : version.trim();
      return trimmedVersion ? `React ${trimmedVersion}` : "React";
    }
    if (framework === "vue") {
      const trimmedVersion = version == null ? void 0 : version.trim();
      return trimmedVersion ? `Vue ${trimmedVersion}` : "Vue";
    }
    return "Unknown";
  }
  function formatHookStatus(hookStatus) {
    return hookStatus ? String(hookStatus) : "";
  }
  function formatDebugSource(source) {
    if (!source || typeof source !== "object") return "";
    const rec = source;
    const file = typeof rec.file === "string" ? rec.file.trim() : "";
    if (!file) return "";
    const lineRaw = Number(rec.line);
    const columnRaw = Number(rec.column);
    const line = Number.isFinite(lineRaw) && lineRaw > 0 ? lineRaw : void 0;
    const column = Number.isFinite(columnRaw) && columnRaw > 0 ? columnRaw : void 0;
    if (!line) return file;
    return column ? `${file}:${line}:${column}` : `${file}:${line}`;
  }
  function formatSerializedValue(value) {
    var _a2, _b2, _c, _d;
    switch (value.kind) {
      case "null":
        return "null";
      case "undefined":
        return "undefined";
      case "boolean":
        return value.value ? "true" : "false";
      case "number":
        if (value.special) return value.special;
        if (typeof value.value === "number") return String(value.value);
        return "NaN";
      case "string":
        return value.truncated ? `"${value.value}…"` : JSON.stringify(value.value);
      case "bigint":
        return `${value.value}n`;
      case "symbol":
        return `Symbol(${value.description})`;
      case "function":
        return `ƒ ${(_a2 = value.name) != null ? _a2 : "(anonymous)"}`;
      case "react_element":
        return value.display;
      case "dom_element": {
        const tag = String((_b2 = value.tagName) != null ? _b2 : "").toLowerCase() || "element";
        const id = value.id ? `#${value.id}` : "";
        const cls = value.className ? `.${String(value.className).split(/\s+/).filter(Boolean).slice(0, 2).join(".")}` : "";
        return `<${tag}${id}${cls}>`;
      }
      case "date":
        return value.value;
      case "regexp":
        return `/${value.source}/${value.flags}`;
      case "error":
        return `${value.name}: ${value.message}`;
      case "circular":
        return `[Circular #${value.refId}]`;
      case "max_depth":
        return value.preview;
      case "array":
        return `Array(${value.length})`;
      case "object":
        return `${(_c = value.name) != null ? _c : "Object"} {…}`;
      case "map":
        return `Map(${value.size})`;
      case "set":
        return `Set(${value.size})`;
      case "unknown":
        return value.preview;
      default:
        return String((_d = value.kind) != null ? _d : "unknown");
    }
  }
  function canRenderEditableNumber(value) {
    if (value.special) return false;
    if (typeof value.value !== "number") return false;
    return Number.isFinite(value.value);
  }
  function parseNumberInput(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: false };
    if (/^-?\d+\.$/.test(trimmed)) {
      const n = Number(trimmed.slice(0, -1));
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
      const n = Number(trimmed);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    return { ok: false };
  }
  function mergeResponseData(prev, next) {
    var _a2, _b2, _c, _d;
    if (!next) return prev;
    if (!prev) return next;
    return __spreadProps(__spreadValues(__spreadValues({}, prev), next), {
      capabilities: (_a2 = next.capabilities) != null ? _a2 : prev.capabilities,
      props: (_b2 = next.props) != null ? _b2 : prev.props,
      meta: __spreadValues(__spreadValues({}, (_c = prev.meta) != null ? _c : {}), (_d = next.meta) != null ? _d : {})
    });
  }
  function buildStatusLine(loading, data, error) {
    if (loading) return "Loading…";
    if (!data) {
      return error ? `Error • ${error}` : "Waiting for selection…";
    }
    const parts = [];
    const caps = data.capabilities;
    if (caps) {
      parts.push(`read: ${caps.canRead ? "yes" : "no"}`);
      parts.push(`write: ${caps.canWrite ? "yes" : "no"}`);
    } else {
      parts.push("read: unknown");
      parts.push("write: unknown");
    }
    const hook = formatHookStatus(data.hookStatus);
    if (hook) parts.push(`hook: ${hook}`);
    if (data.needsRefresh) parts.push("needs refresh");
    if (error) parts.push("error");
    return parts.join(" • ");
  }
  function getCanWrite(data) {
    var _a2;
    return Boolean((_a2 = data == null ? void 0 : data.capabilities) == null ? void 0 : _a2.canWrite) && !(data == null ? void 0 : data.needsRefresh);
  }
  function getCanRead(data) {
    var _a2;
    return Boolean((_a2 = data == null ? void 0 : data.capabilities) == null ? void 0 : _a2.canRead);
  }
  function findPropEntry(data, key) {
    var _a2;
    const props = data == null ? void 0 : data.props;
    if (!props || !Array.isArray(props.entries)) return null;
    return (_a2 = props.entries.find((e) => e.key === key)) != null ? _a2 : null;
  }
  function setInputFromEntry(entry, input) {
    var _a2;
    input.classList.remove("we-props-input--invalid");
    if (entry.value.kind === "string") {
      input.value = (_a2 = entry.value.value) != null ? _a2 : "";
      return;
    }
    if (entry.value.kind === "number") {
      if (typeof entry.value.value === "number" && Number.isFinite(entry.value.value)) {
        input.value = String(entry.value.value);
      } else if (entry.value.special) {
        input.value = entry.value.special;
      } else {
        input.value = "";
      }
      return;
    }
    if (entry.value.kind === "boolean") {
      input.checked = Boolean(entry.value.value);
    }
  }
  function updateLocalPrimitiveSnapshot(data, key, value) {
    var _a2;
    if (!((_a2 = data == null ? void 0 : data.props) == null ? void 0 : _a2.entries)) return;
    const entry = data.props.entries.find((e) => e.key === key);
    if (!entry) return;
    if (typeof value === "string") {
      entry.value = { kind: "string", value };
      entry.editable = true;
      return;
    }
    if (typeof value === "number") {
      entry.value = { kind: "number", value };
      entry.editable = true;
      return;
    }
    entry.value = { kind: "boolean", value };
    entry.editable = true;
  }
  function createPropsPanel(options) {
    const { container, propsBridge } = options;
    const disposer = new Disposer();
    const tooltip = document.createElement("div");
    tooltip.className = "we-tooltip";
    tooltip.hidden = true;
    const rootNode = container.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      rootNode.appendChild(tooltip);
    } else {
      document.body.appendChild(tooltip);
    }
    disposer.add(() => tooltip.remove());
    function showTooltip(el) {
      const text = el.getAttribute("data-tip");
      if (!text) {
        tooltip.hidden = true;
        return;
      }
      const rect = el.getBoundingClientRect();
      tooltip.textContent = text;
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.bottom + 4}px`;
      tooltip.hidden = false;
    }
    function hideTooltip() {
      tooltip.hidden = true;
    }
    let currentTarget = null;
    let currentLocator = null;
    let isVisible = false;
    let needsFetchOnVisible = false;
    let loading = false;
    let sessionId = 0;
    let lastData = null;
    let lastError = null;
    const pendingWrites = /* @__PURE__ */ new Map();
    const root = document.createElement("div");
    root.className = "we-props-panel";
    const meta = document.createElement("div");
    meta.className = "we-props-meta";
    const metaTitleRow = document.createElement("div");
    metaTitleRow.className = "we-props-meta-title";
    const titleLeft = document.createElement("div");
    titleLeft.className = "we-props-title-left";
    const componentEl = document.createElement("div");
    componentEl.className = "we-props-component";
    componentEl.textContent = "Props";
    const frameworkEl = document.createElement("span");
    frameworkEl.className = "we-props-badge";
    frameworkEl.textContent = "Unknown";
    titleLeft.append(componentEl, frameworkEl);
    const titleActions = document.createElement("div");
    titleActions.className = "we-props-title-actions";
    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "we-props-action-btn";
    refreshBtn.dataset.tip = "Refresh";
    refreshBtn.setAttribute("aria-label", "Refresh props");
    refreshBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M11.5 7C11.5 9.48528 9.48528 11.5 7 11.5C4.51472 11.5 2.5 9.48528 2.5 7C2.5 4.51472 4.51472 2.5 7 2.5C8.5 2.5 9.83 3.25 10.6 4.4M10.6 2V4.4H8.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "we-props-action-btn";
    resetBtn.dataset.tip = "Reset";
    resetBtn.setAttribute("aria-label", "Reset props changes");
    resetBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 5.5H8.5C10.1569 5.5 11.5 6.84315 11.5 8.5C11.5 10.1569 10.1569 11.5 8.5 11.5H7M3 5.5L5.5 3M3 5.5L5.5 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
    titleActions.append(refreshBtn, resetBtn);
    metaTitleRow.append(titleLeft, titleActions);
    const statusEl = document.createElement("div");
    statusEl.className = "we-props-status";
    const warningEl = document.createElement("div");
    warningEl.className = "we-props-warning";
    warningEl.hidden = true;
    const errorEl = document.createElement("div");
    errorEl.className = "we-props-error";
    errorEl.hidden = true;
    const sourceRow = document.createElement("div");
    sourceRow.className = "we-props-source";
    sourceRow.hidden = true;
    const sourceLabelEl = document.createElement("span");
    sourceLabelEl.className = "we-props-source-label";
    sourceLabelEl.textContent = "Source";
    const sourcePathEl = document.createElement("span");
    sourcePathEl.className = "we-props-source-path";
    sourcePathEl.title = "";
    const openSourceBtn = document.createElement("button");
    openSourceBtn.type = "button";
    openSourceBtn.className = "we-props-source-btn";
    openSourceBtn.dataset.tip = "Open in VSCode";
    openSourceBtn.setAttribute("aria-label", "Open in VSCode");
    openSourceBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.5 2.5H9.5V8.5M9 3L3 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
    sourceRow.append(sourceLabelEl, sourcePathEl, openSourceBtn);
    meta.append(metaTitleRow, statusEl, warningEl, errorEl, sourceRow);
    const list = document.createElement("div");
    list.className = "we-props-list";
    const emptyState = document.createElement("div");
    emptyState.className = "we-props-empty";
    emptyState.textContent = "Select an element to view props.";
    const rows = document.createElement("div");
    rows.className = "we-props-rows";
    list.append(emptyState, rows);
    root.append(meta, list);
    container.append(root);
    disposer.add(() => root.remove());
    function clearAllPendingWrites() {
      for (const [, entry] of pendingWrites) {
        clearTimeout(entry.timeoutId);
      }
      pendingWrites.clear();
    }
    function flushAllPendingWrites() {
      if (pendingWrites.size === 0) return;
      const keys = [...pendingWrites.keys()];
      for (const key of keys) {
        const entry = pendingWrites.get(key);
        if (!entry) continue;
        clearTimeout(entry.timeoutId);
        pendingWrites.delete(key);
        void commitWrite(key, entry.value);
      }
    }
    disposer.add(clearAllPendingWrites);
    function cancelPendingWrite(key) {
      const existing = pendingWrites.get(key);
      if (!existing) return;
      clearTimeout(existing.timeoutId);
      pendingWrites.delete(key);
    }
    function flushPendingWrite(key) {
      const existing = pendingWrites.get(key);
      if (!existing) return;
      clearTimeout(existing.timeoutId);
      pendingWrites.delete(key);
      void commitWrite(key, existing.value);
    }
    function scheduleWrite(key, value) {
      cancelPendingWrite(key);
      const timeoutId = window.setTimeout(() => {
        pendingWrites.delete(key);
        void commitWrite(key, value);
      }, WRITE_DEBOUNCE_MS);
      pendingWrites.set(key, { timeoutId, value });
    }
    function renderMeta() {
      var _a2;
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      const framework = lastData == null ? void 0 : lastData.framework;
      const frameworkVersion = lastData == null ? void 0 : lastData.frameworkVersion;
      const componentName = lastData == null ? void 0 : lastData.componentName;
      componentEl.textContent = componentName || "Props";
      frameworkEl.textContent = formatFramework(framework, frameworkVersion);
      statusEl.textContent = hasTarget ? buildStatusLine(loading, lastData, lastError) : "Select an element to view props.";
      warningEl.hidden = true;
      warningEl.textContent = "";
      if (hasTarget) {
        if (lastData == null ? void 0 : lastData.needsRefresh) {
          warningEl.hidden = false;
          warningEl.textContent = "A page refresh is required for full props inspection/editing.";
        } else if ((lastData == null ? void 0 : lastData.hookStatus) === "RENDERERS_NO_EDITING") {
          warningEl.hidden = false;
          warningEl.textContent = "Editing is unavailable (likely a production build without overrideProps).";
        } else if ((_a2 = lastData == null ? void 0 : lastData.props) == null ? void 0 : _a2.truncated) {
          warningEl.hidden = false;
          warningEl.textContent = "Props list is truncated.";
        }
      }
      errorEl.hidden = !lastError;
      errorEl.textContent = lastError != null ? lastError : "";
      const sourceText = hasTarget ? formatDebugSource(lastData == null ? void 0 : lastData.debugSource) : "";
      sourceRow.hidden = !sourceText;
      sourcePathEl.textContent = sourceText;
      sourcePathEl.title = sourceText;
      openSourceBtn.disabled = !sourceText || loading;
      const hookStatus = lastData == null ? void 0 : lastData.hookStatus;
      const canBenefitFromEarlyInjection = hookStatus === "HOOK_MISSING" || hookStatus === "HOOK_PRESENT_NO_RENDERERS";
      const showEnableReload = (lastData == null ? void 0 : lastData.needsRefresh) && canBenefitFromEarlyInjection;
      refreshBtn.dataset.tip = showEnableReload ? "Enable & Reload" : "Refresh";
      refreshBtn.disabled = !hasTarget || loading;
      resetBtn.disabled = !hasTarget || loading || !getCanWrite(lastData);
    }
    function renderList() {
      var _a2, _b2;
      rows.innerHTML = "";
      const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
      const data = lastData;
      if (!hasTarget) {
        emptyState.hidden = false;
        emptyState.classList.remove("we-loading");
        emptyState.textContent = "Select an element to view props.";
        return;
      }
      if (loading) {
        emptyState.hidden = false;
        emptyState.classList.add("we-loading");
        emptyState.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="animation: we-spin 0.8s linear infinite;">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-dasharray="20 14" />
      </svg><span>Loading props…</span>`;
        return;
      }
      emptyState.classList.remove("we-loading");
      const canRead = getCanRead(data);
      if (!canRead) {
        emptyState.hidden = false;
        const hook = data == null ? void 0 : data.hookStatus;
        if ((data == null ? void 0 : data.needsRefresh) || hook === "HOOK_MISSING" || hook === "HOOK_PRESENT_NO_RENDERERS") {
          emptyState.textContent = "Props inspection is not ready. Refresh the page in development mode.";
        } else if (hook === "RENDERERS_NO_EDITING") {
          emptyState.textContent = "Props inspection/editing is unavailable in this build.";
        } else {
          emptyState.textContent = "Props inspection is not available for this element.";
        }
        return;
      }
      const props = data == null ? void 0 : data.props;
      if (!props || !Array.isArray(props.entries) || props.entries.length === 0) {
        emptyState.hidden = false;
        emptyState.textContent = (data == null ? void 0 : data.framework) === "vue" ? "No props or attrs found." : "No props found.";
        return;
      }
      emptyState.hidden = true;
      const canWrite = getCanWrite(data);
      const disableEdits = !canWrite || loading;
      const isVue = (data == null ? void 0 : data.framework) === "vue";
      const entries = props.entries;
      const hasAttrs = isVue && entries.some((e) => e.source === "attrs");
      const groups = hasAttrs ? [
        { title: "Props", entries: entries.filter((e) => e.source !== "attrs") },
        { title: "Attrs", entries: entries.filter((e) => e.source === "attrs") }
      ].filter((g) => g.entries.length > 0) : [{ title: "", entries }];
      for (const group of groups) {
        if (group.title) {
          const groupHeader = document.createElement("div");
          groupHeader.className = "we-props-group";
          groupHeader.textContent = group.title;
          rows.append(groupHeader);
        }
        for (const entry of group.entries) {
          const row = document.createElement("div");
          row.className = "we-props-row";
          const keyEl = document.createElement("div");
          keyEl.className = "we-props-key";
          keyEl.textContent = entry.key;
          const valueEl = document.createElement("div");
          valueEl.className = "we-props-value";
          const keyIsDangerous = isDangerousPropKey(entry.key);
          const entryEditable = Boolean(entry.editable) && !keyIsDangerous;
          const rawEnumValues = Array.isArray(entry.enumValues) ? entry.enumValues : [];
          const filteredEnumValues = rawEnumValues.filter(
            (v) => typeof v === "string" && v.trim().length > 0
          );
          const hasEnumValues = entryEditable && entry.value.kind === "string" && filteredEnumValues.length > 0;
          if (hasEnumValues) {
            const select = document.createElement("select");
            select.className = "we-select we-props-input";
            select.disabled = disableEdits;
            select.dataset.propKey = entry.key;
            select.dataset.propKind = "enum";
            select.setAttribute("aria-label", `Select prop ${entry.key}`);
            const currentValue = (_a2 = entry.value.value) != null ? _a2 : "";
            const seen = /* @__PURE__ */ new Set();
            if (currentValue && !filteredEnumValues.includes(currentValue)) {
              const opt = document.createElement("option");
              opt.value = currentValue;
              opt.textContent = `${currentValue} (current)`;
              select.append(opt);
              seen.add(currentValue);
            }
            for (const v of filteredEnumValues) {
              if (seen.has(v)) continue;
              seen.add(v);
              const opt = document.createElement("option");
              opt.value = v;
              opt.textContent = v;
              select.append(opt);
            }
            if (currentValue && seen.has(currentValue)) {
              select.value = currentValue;
            }
            valueEl.append(select);
          } else if (entryEditable && entry.value.kind === "boolean") {
            const label = document.createElement("label");
            label.className = "we-props-bool";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "we-props-checkbox";
            checkbox.checked = Boolean(entry.value.value);
            checkbox.disabled = disableEdits;
            checkbox.dataset.propKey = entry.key;
            checkbox.dataset.propKind = "boolean";
            checkbox.setAttribute("aria-label", `Toggle prop ${entry.key}`);
            const text = document.createElement("span");
            text.textContent = checkbox.checked ? "true" : "false";
            text.dataset.weBoolText = "1";
            label.append(checkbox, text);
            valueEl.append(label);
          } else if (entryEditable && entry.value.kind === "string") {
            const input = document.createElement("input");
            input.type = "text";
            input.className = "we-input we-props-input";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.value = (_b2 = entry.value.value) != null ? _b2 : "";
            input.disabled = disableEdits;
            input.dataset.propKey = entry.key;
            input.dataset.propKind = "string";
            input.setAttribute("aria-label", `Edit prop ${entry.key}`);
            valueEl.append(input);
          } else if (entryEditable && entry.value.kind === "number" && canRenderEditableNumber(entry.value)) {
            const input = document.createElement("input");
            input.type = "text";
            input.inputMode = "decimal";
            input.className = "we-input we-props-input";
            input.autocomplete = "off";
            input.spellcheck = false;
            input.value = String(entry.value.value);
            input.disabled = disableEdits;
            input.dataset.propKey = entry.key;
            input.dataset.propKind = "number";
            input.setAttribute("aria-label", `Edit prop ${entry.key}`);
            valueEl.append(input);
          } else {
            valueEl.classList.add("we-props-value--readonly");
            valueEl.textContent = keyIsDangerous ? `${formatSerializedValue(entry.value)} (blocked)` : formatSerializedValue(entry.value);
          }
          row.append(keyEl, valueEl);
          rows.append(row);
        }
      }
    }
    function renderAll() {
      renderMeta();
      renderList();
    }
    function probeAndRead() {
      return __async(this, null, function* () {
        var _a2, _b2, _c, _d;
        if (disposer.isDisposed) return;
        if (!isVisible) {
          needsFetchOnVisible = true;
          return;
        }
        const target = currentTarget;
        const locator = currentLocator;
        if (!target || !target.isConnected || !locator) {
          lastData = null;
          lastError = null;
          loading = false;
          needsFetchOnVisible = false;
          renderAll();
          return;
        }
        const localSession = sessionId;
        loading = true;
        lastError = null;
        renderAll();
        try {
          const probeResult = yield propsBridge.probe(locator);
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastData = mergeResponseData(lastData, probeResult.data);
          if (!probeResult.ok) {
            lastError = (_a2 = probeResult.error) != null ? _a2 : "Props probe failed";
          }
          const canRead = Boolean((_c = (_b2 = probeResult.data) == null ? void 0 : _b2.capabilities) == null ? void 0 : _c.canRead);
          if (canRead) {
            const readResult = yield propsBridge.read(locator);
            if (disposer.isDisposed || localSession !== sessionId) return;
            lastData = mergeResponseData(lastData, readResult.data);
            if (!readResult.ok) {
              lastError = (_d = readResult.error) != null ? _d : "Props read failed";
            }
          }
        } catch (err) {
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastError = err instanceof Error ? err.message : String(err);
        } finally {
          if (!disposer.isDisposed && localSession === sessionId) {
            loading = false;
            needsFetchOnVisible = false;
            renderAll();
          }
        }
      });
    }
    function commitWrite(key, value) {
      return __async(this, null, function* () {
        var _a2;
        if (disposer.isDisposed) return;
        const target = currentTarget;
        const locator = currentLocator;
        if (!target || !target.isConnected || !locator) return;
        if (isDangerousPropKey(key)) {
          lastError = "Blocked prop key (security)";
          renderMeta();
          return;
        }
        const localSession = sessionId;
        const canWrite = getCanWrite(lastData);
        if (!canWrite) {
          lastError = "Props editing is not available for this element.";
          renderMeta();
          return;
        }
        try {
          const result2 = yield propsBridge.write(locator, [key], value);
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastData = mergeResponseData(lastData, result2.data);
          if (!result2.ok) {
            lastError = (_a2 = result2.error) != null ? _a2 : "Props write failed";
            renderMeta();
            return;
          }
          lastError = null;
          updateLocalPrimitiveSnapshot(lastData, key, value);
          renderMeta();
        } catch (err) {
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastError = err instanceof Error ? err.message : String(err);
          renderMeta();
        }
      });
    }
    function resetOverrides() {
      return __async(this, null, function* () {
        var _a2;
        if (disposer.isDisposed) return;
        const target = currentTarget;
        const locator = currentLocator;
        if (!target || !target.isConnected || !locator) return;
        const localSession = sessionId;
        clearAllPendingWrites();
        loading = true;
        lastError = null;
        renderAll();
        try {
          const result2 = yield propsBridge.reset(locator);
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastData = mergeResponseData(lastData, result2.data);
          if (!result2.ok) {
            lastError = (_a2 = result2.error) != null ? _a2 : "Props reset failed";
          }
        } catch (err) {
          if (disposer.isDisposed || localSession !== sessionId) return;
          lastError = err instanceof Error ? err.message : String(err);
        } finally {
          if (!disposer.isDisposed && localSession === sessionId) {
            loading = false;
            renderMeta();
            void probeAndRead();
          }
        }
      });
    }
    function registerEarlyInjectionAndReload() {
      return __async(this, null, function* () {
        var _a2, _b2;
        if (disposer.isDisposed) return;
        if (typeof chrome === "undefined" || !((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) {
          lastError = "Chrome runtime API not available";
          renderMeta();
          return;
        }
        const confirmed = window.confirm(
          "Props editing requires early injection to capture React renderers before they initialize.\n\nThis will:\n• Register a content script for this site\n• Reload the page immediately\n\nAfter reload, enable the editor again to access full Props functionality.\n\nContinue?"
        );
        if (!confirmed) return;
        try {
          const resp = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_PROPS_REGISTER_EARLY_INJECTION
          });
          if (!(resp == null ? void 0 : resp.success)) {
            lastError = (_b2 = resp == null ? void 0 : resp.error) != null ? _b2 : "Failed to register early injection";
            renderMeta();
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          renderMeta();
        }
      });
    }
    function openSourceInVSCode() {
      return __async(this, null, function* () {
        var _a2, _b2;
        if (disposer.isDisposed) return;
        const debugSource = lastData == null ? void 0 : lastData.debugSource;
        if (!debugSource || !formatDebugSource(debugSource)) return;
        if (typeof chrome === "undefined" || !((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) {
          lastError = "Chrome runtime API not available";
          renderMeta();
          return;
        }
        try {
          const resp = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_OPEN_SOURCE,
            payload: { debugSource }
          });
          if ((resp == null ? void 0 : resp.success) === false) {
            lastError = (_b2 = resp == null ? void 0 : resp.error) != null ? _b2 : "Failed to open source in VSCode";
            renderMeta();
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          renderMeta();
        }
      });
    }
    const bindTooltip = (el) => {
      disposer.listen(el, "mouseenter", () => showTooltip(el));
      disposer.listen(el, "mouseleave", hideTooltip);
    };
    bindTooltip(refreshBtn);
    bindTooltip(resetBtn);
    bindTooltip(openSourceBtn);
    disposer.listen(refreshBtn, "click", (e) => {
      e.preventDefault();
      clearAllPendingWrites();
      const hookStatus = lastData == null ? void 0 : lastData.hookStatus;
      const canBenefitFromEarlyInjection = hookStatus === "HOOK_MISSING" || hookStatus === "HOOK_PRESENT_NO_RENDERERS";
      if ((lastData == null ? void 0 : lastData.needsRefresh) && canBenefitFromEarlyInjection) {
        void registerEarlyInjectionAndReload();
        return;
      }
      void probeAndRead();
    });
    disposer.listen(resetBtn, "click", (e) => {
      e.preventDefault();
      void resetOverrides();
    });
    disposer.listen(openSourceBtn, "click", (e) => {
      e.preventDefault();
      void openSourceInVSCode();
    });
    disposer.listen(rows, "input", (e) => {
      var _a2, _b2;
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.disabled) return;
      if (target.type === "checkbox") return;
      const key = (_a2 = target.dataset.propKey) != null ? _a2 : "";
      const kind = (_b2 = target.dataset.propKind) != null ? _b2 : "";
      if (!key || !kind) return;
      if (isDangerousPropKey(key)) return;
      const ie = e;
      if (ie.isComposing) return;
      if (kind === "string") {
        scheduleWrite(key, target.value);
        return;
      }
      if (kind === "number") {
        const parsed = parseNumberInput(target.value);
        if (!target.value.trim()) {
          cancelPendingWrite(key);
          target.classList.remove("we-props-input--invalid");
          return;
        }
        if (!parsed.ok) {
          cancelPendingWrite(key);
          target.classList.add("we-props-input--invalid");
          return;
        }
        target.classList.remove("we-props-input--invalid");
        scheduleWrite(key, parsed.value);
      }
    });
    disposer.listen(rows, "change", (e) => {
      var _a2, _b2, _c, _d, _e;
      const target = e.target;
      if (!target) return;
      if (target instanceof HTMLSelectElement) {
        if (target.disabled) return;
        const key2 = (_a2 = target.dataset.propKey) != null ? _a2 : "";
        const kind2 = (_b2 = target.dataset.propKind) != null ? _b2 : "";
        if (!key2 || kind2 !== "enum") return;
        if (isDangerousPropKey(key2)) return;
        void commitWrite(key2, target.value);
        return;
      }
      if (!(target instanceof HTMLInputElement)) return;
      if (target.disabled) return;
      if (target.type !== "checkbox") return;
      const key = (_c = target.dataset.propKey) != null ? _c : "";
      const kind = (_d = target.dataset.propKind) != null ? _d : "";
      if (!key || kind !== "boolean") return;
      if (isDangerousPropKey(key)) return;
      const label = target.closest(".we-props-bool");
      const text = (_e = label == null ? void 0 : label.querySelector) == null ? void 0 : _e.call(label, 'span[data-we-bool-text="1"]');
      if (text) text.textContent = target.checked ? "true" : "false";
      void commitWrite(key, target.checked);
    });
    disposer.listen(rows, "keydown", (e) => {
      var _a2, _b2;
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.disabled) return;
      const key = (_a2 = target.dataset.propKey) != null ? _a2 : "";
      const kind = (_b2 = target.dataset.propKind) != null ? _b2 : "";
      if (!key || !kind) return;
      if (e.key === "Enter") {
        if (e.isComposing) return;
        e.preventDefault();
        flushPendingWrite(key);
        try {
          target.blur();
        } catch (e2) {
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelPendingWrite(key);
        const entry = findPropEntry(lastData, key);
        if (!entry) return;
        setInputFromEntry(entry, target);
      }
    });
    disposer.listen(rows, "focusout", (e) => {
      var _a2, _b2;
      const target = e.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.disabled) return;
      const key = (_a2 = target.dataset.propKey) != null ? _a2 : "";
      const kind = (_b2 = target.dataset.propKind) != null ? _b2 : "";
      if (!key) return;
      if (kind === "number") {
        const parsed = parseNumberInput(target.value);
        if (!target.value.trim() || !parsed.ok) {
          cancelPendingWrite(key);
          target.classList.remove("we-props-input--invalid");
          const entry = findPropEntry(lastData, key);
          if (entry) setInputFromEntry(entry, target);
          return;
        }
      }
      flushPendingWrite(key);
    });
    function setTarget(element) {
      if (disposer.isDisposed) return;
      flushAllPendingWrites();
      sessionId += 1;
      currentTarget = element && element.isConnected ? element : null;
      currentLocator = currentTarget ? createElementLocator(currentTarget) : null;
      lastData = null;
      lastError = null;
      loading = false;
      needsFetchOnVisible = false;
      renderAll();
      if (isVisible) {
        void probeAndRead();
      } else {
        needsFetchOnVisible = true;
      }
    }
    function refresh() {
      if (disposer.isDisposed) return;
      clearAllPendingWrites();
      void probeAndRead();
    }
    function setVisible(visible) {
      if (disposer.isDisposed) return;
      isVisible = visible;
      if (visible && needsFetchOnVisible) {
        void probeAndRead();
      }
    }
    function dispose() {
      currentTarget = null;
      currentLocator = null;
      lastData = null;
      lastError = null;
      loading = false;
      needsFetchOnVisible = false;
      disposer.dispose();
    }
    renderAll();
    return {
      setTarget,
      refresh,
      setVisible,
      dispose
    };
  }
  const CONTROL_GROUPS = [
    { id: "position", label: "Position", collapsible: true },
    { id: "layout", label: "Layout", collapsible: true },
    { id: "size", label: "Size", collapsible: true },
    { id: "spacing", label: "Spacing", collapsible: true },
    { id: "typography", label: "Typography", collapsible: true },
    { id: "appearance", label: "Appearance", collapsible: true },
    { id: "border", label: "Border", collapsible: true },
    { id: "background", label: "Background", collapsible: true },
    { id: "effects", label: "Effects", collapsible: false }
  ];
  let groupIdSeq = 0;
  function formatTargetLabel(element) {
    var _a2, _b2;
    const tag = element.tagName.toLowerCase();
    const htmlEl = element;
    const id = (_a2 = htmlEl.id) == null ? void 0 : _a2.trim();
    if (id) {
      return `${tag}#${id}`;
    }
    const classes = Array.from((_b2 = element.classList) != null ? _b2 : []).slice(0, 2);
    if (classes.length > 0) {
      return `${tag}.${classes.join(".")}`;
    }
    return tag;
  }
  function createControlGroup(groupId, label, disposer, opts) {
    var _a2;
    const uniqueId = `we_group_${groupId}_${++groupIdSeq}`;
    const collapsible = (_a2 = opts == null ? void 0 : opts.collapsible) != null ? _a2 : true;
    let collapsed = false;
    const root = document.createElement("section");
    root.className = "we-group";
    root.dataset.group = groupId;
    root.dataset.collapsed = "false";
    const header = document.createElement("div");
    header.className = "we-group-header";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = label;
    let toggleEl;
    if (collapsible) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "we-group-toggle";
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.setAttribute("aria-controls", uniqueId);
      toggleBtn.append(labelSpan, createChevronIcon());
      disposer.listen(toggleBtn, "click", (event) => {
        event.preventDefault();
        toggle();
      });
      toggleEl = toggleBtn;
    } else {
      const staticLabel = document.createElement("div");
      staticLabel.className = "we-group-toggle we-group-toggle--static";
      staticLabel.append(labelSpan);
      toggleEl = staticLabel;
    }
    const headerActions = document.createElement("div");
    headerActions.className = "we-group-header-actions";
    header.append(toggleEl, headerActions);
    const body = document.createElement("div");
    body.className = "we-group-body";
    body.id = uniqueId;
    root.append(header, body);
    function setCollapsed(value) {
      if (!collapsible) return;
      collapsed = value;
      root.dataset.collapsed = collapsed ? "true" : "false";
      toggleEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    function isCollapsed() {
      return collapsed;
    }
    function toggle() {
      if (!collapsible) return;
      setCollapsed(!collapsed);
    }
    return {
      root,
      body,
      headerActions,
      setCollapsed,
      isCollapsed,
      toggle
    };
  }
  function createPropertyPanel(options) {
    var _a2, _b2;
    const disposer = new Disposer();
    let currentTarget = null;
    let currentTab = (_a2 = options.defaultTab) != null ? _a2 : "design";
    let minimized = false;
    let floatingPosition = (_b2 = options.initialPosition) != null ? _b2 : null;
    const controlGroups = /* @__PURE__ */ new Map();
    const controls = [];
    let componentsTree = null;
    let cssPanel = null;
    let propsPanel = null;
    let sizeControl = null;
    let positionControl = null;
    let spacingControl = null;
    let styleObserver = null;
    let styleObserverTarget = null;
    let styleObserverRafId = null;
    const root = document.createElement("aside");
    root.className = "we-panel we-prop-panel";
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-label", "Properties");
    root.dataset.tab = currentTab;
    root.dataset.empty = "true";
    root.dataset.minimized = "false";
    root.dataset.dragged = floatingPosition ? "true" : "false";
    const header = document.createElement("header");
    header.className = "we-header";
    const dragHandle = document.createElement("button");
    dragHandle.type = "button";
    dragHandle.className = "we-drag-handle";
    dragHandle.setAttribute("aria-label", "Drag property panel");
    dragHandle.dataset.tooltip = "Drag";
    dragHandle.append(createGripIcon());
    const targetLabel = document.createElement("div");
    targetLabel.className = "we-prop-target";
    targetLabel.hidden = true;
    const tabsContainer = document.createElement("div");
    tabsContainer.className = "we-prop-tabs";
    tabsContainer.setAttribute("role", "tablist");
    tabsContainer.setAttribute("aria-label", "Property tabs");
    const designTabBtn = document.createElement("button");
    designTabBtn.type = "button";
    designTabBtn.className = "we-tab";
    designTabBtn.setAttribute("role", "tab");
    designTabBtn.dataset.tab = "design";
    designTabBtn.textContent = "Design";
    const cssTabBtn = document.createElement("button");
    cssTabBtn.type = "button";
    cssTabBtn.className = "we-tab";
    cssTabBtn.setAttribute("role", "tab");
    cssTabBtn.dataset.tab = "css";
    cssTabBtn.textContent = "CSS";
    const propsTabBtn = document.createElement("button");
    propsTabBtn.type = "button";
    propsTabBtn.className = "we-tab";
    propsTabBtn.setAttribute("role", "tab");
    propsTabBtn.dataset.tab = "props";
    propsTabBtn.textContent = "Props";
    const domTabBtn = document.createElement("button");
    domTabBtn.type = "button";
    domTabBtn.className = "we-tab";
    domTabBtn.setAttribute("role", "tab");
    domTabBtn.dataset.tab = "dom";
    domTabBtn.textContent = "DOM";
    tabsContainer.append(designTabBtn, cssTabBtn, propsTabBtn, domTabBtn);
    const minimizeBtn = document.createElement("button");
    minimizeBtn.type = "button";
    minimizeBtn.className = "we-icon-btn we-minimize-btn";
    minimizeBtn.setAttribute("aria-label", "Minimize property panel");
    minimizeBtn.dataset.tooltip = "Minimize";
    minimizeBtn.append(createChevronUpIcon());
    header.append(dragHandle, tabsContainer, minimizeBtn, targetLabel);
    const body = document.createElement("div");
    body.className = "we-prop-body";
    const emptyState = document.createElement("div");
    emptyState.className = "we-prop-empty";
    emptyState.textContent = "Select an element to view and edit its properties.";
    const designPanel = document.createElement("div");
    designPanel.className = "we-prop-tab-content";
    designPanel.dataset.tabContent = "design";
    for (const { id, label, collapsible } of CONTROL_GROUPS) {
      const group = createControlGroup(id, label, disposer, { collapsible });
      controlGroups.set(id, group);
      designPanel.append(group.root);
    }
    const cssPanelContainer = document.createElement("div");
    cssPanelContainer.className = "we-prop-tab-content";
    cssPanelContainer.dataset.tabContent = "css";
    const propsPanelContainer = document.createElement("div");
    propsPanelContainer.className = "we-prop-tab-content";
    propsPanelContainer.dataset.tabContent = "props";
    const domPanel = document.createElement("div");
    domPanel.className = "we-prop-tab-content";
    domPanel.dataset.tabContent = "dom";
    body.append(emptyState, designPanel, cssPanelContainer, propsPanelContainer, domPanel);
    root.append(header, body);
    options.container.append(root);
    disposer.add(() => root.remove());
    const CLAMP_MARGIN_PX = 16;
    function clampToViewport(position) {
      const rect = root.getBoundingClientRect();
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      const margin = CLAMP_MARGIN_PX;
      const maxLeft = Math.max(margin, viewportW - margin - rect.width);
      const maxTop = Math.max(margin, viewportH - margin - rect.height);
      const left = Number.isFinite(position.left) ? position.left : 0;
      const top = Number.isFinite(position.top) ? position.top : 0;
      return {
        left: Math.round(Math.min(maxLeft, Math.max(margin, left))),
        top: Math.round(Math.min(maxTop, Math.max(margin, top)))
      };
    }
    function syncFloatingPositionStyles() {
      root.dataset.dragged = floatingPosition ? "true" : "false";
      if (!floatingPosition || minimized) {
        root.style.left = "";
        root.style.top = "";
        root.style.right = "";
        root.style.bottom = "";
        return;
      }
      root.style.left = `${floatingPosition.left}px`;
      root.style.top = `${floatingPosition.top}px`;
      root.style.right = "auto";
      root.style.bottom = "auto";
    }
    function setPosition(position) {
      var _a3;
      floatingPosition = position ? clampToViewport(position) : null;
      syncFloatingPositionStyles();
      (_a3 = options.onPositionChange) == null ? void 0 : _a3.call(options, floatingPosition);
    }
    function getPosition() {
      return floatingPosition;
    }
    disposer.add(
      installFloatingDrag({
        handleEl: dragHandle,
        targetEl: root,
        clampMargin: CLAMP_MARGIN_PX,
        onPositionChange: (pos) => setPosition(pos)
      })
    );
    if (floatingPosition !== null) {
      setPosition(floatingPosition);
    } else {
      syncFloatingPositionStyles();
    }
    function initializeControls() {
      const sizeGroup = controlGroups.get("size");
      if (sizeGroup) {
        sizeControl = createSizeControl({
          container: sizeGroup.body,
          transactionManager: options.transactionManager
        });
        controls.push(sizeControl);
      }
      const spacingGroup = controlGroups.get("spacing");
      if (spacingGroup) {
        spacingControl = createSpacingControl({
          container: spacingGroup.body,
          transactionManager: options.transactionManager
        });
        controls.push(spacingControl);
      }
      const positionGroup = controlGroups.get("position");
      if (positionGroup) {
        positionControl = createPositionControl({
          container: positionGroup.body,
          transactionManager: options.transactionManager
        });
        controls.push(positionControl);
      }
      const layoutGroup = controlGroups.get("layout");
      if (layoutGroup) {
        const layoutControl = createLayoutControl({
          container: layoutGroup.body,
          transactionManager: options.transactionManager
        });
        controls.push(layoutControl);
      }
      const typographyGroup = controlGroups.get("typography");
      if (typographyGroup) {
        const typographyControl = createTypographyControl({
          container: typographyGroup.body,
          transactionManager: options.transactionManager,
          tokensService: options.tokensService
        });
        controls.push(typographyControl);
      }
      const appearanceGroup = controlGroups.get("appearance");
      if (appearanceGroup) {
        const appearanceControl = createAppearanceControl({
          container: appearanceGroup.body,
          transactionManager: options.transactionManager
        });
        controls.push(appearanceControl);
      }
      const borderGroup = controlGroups.get("border");
      if (borderGroup) {
        const borderControl = createBorderControl({
          container: borderGroup.body,
          transactionManager: options.transactionManager,
          tokensService: options.tokensService
        });
        controls.push(borderControl);
      }
      const backgroundGroup = controlGroups.get("background");
      if (backgroundGroup) {
        const backgroundControl = createBackgroundControl({
          container: backgroundGroup.body,
          transactionManager: options.transactionManager,
          tokensService: options.tokensService
        });
        controls.push(backgroundControl);
      }
      const effectsGroup = controlGroups.get("effects");
      if (effectsGroup) {
        const effectsControl = createEffectsControl({
          container: effectsGroup.body,
          transactionManager: options.transactionManager,
          tokensService: options.tokensService,
          headerActionsContainer: effectsGroup.headerActions
        });
        controls.push(effectsControl);
      }
    }
    initializeControls();
    componentsTree = createComponentsTree({
      container: domPanel,
      onSelect: (element) => {
        options.onSelectElement(element);
      }
    });
    cssPanel = createCssPanel({
      container: cssPanelContainer,
      transactionManager: options.transactionManager,
      onClassChange: () => {
        if (currentTarget) {
          targetLabel.textContent = formatTargetLabel(currentTarget);
        }
      }
    });
    propsPanel = createPropsPanel({
      container: propsPanelContainer,
      propsBridge: options.propsBridge
    });
    disposer.listen(designTabBtn, "click", (event) => {
      event.preventDefault();
      setTab("design");
    });
    disposer.listen(cssTabBtn, "click", (event) => {
      event.preventDefault();
      setTab("css");
    });
    disposer.listen(propsTabBtn, "click", (event) => {
      event.preventDefault();
      setTab("props");
    });
    disposer.listen(domTabBtn, "click", (event) => {
      event.preventDefault();
      setTab("dom");
    });
    disposer.listen(minimizeBtn, "click", (event) => {
      event.preventDefault();
      setMinimized(!minimized);
    });
    function setMinimized(value) {
      minimized = value;
      root.dataset.minimized = minimized ? "true" : "false";
      body.hidden = minimized;
      tabsContainer.hidden = minimized;
      minimizeBtn.setAttribute(
        "aria-label",
        minimized ? "Expand property panel" : "Minimize property panel"
      );
      minimizeBtn.dataset.tooltip = minimized ? "Expand" : "Minimize";
      if (!minimized && floatingPosition) {
        setPosition(floatingPosition);
      } else {
        syncFloatingPositionStyles();
      }
    }
    function renderTabs() {
      root.dataset.tab = currentTab;
      designTabBtn.setAttribute("aria-selected", currentTab === "design" ? "true" : "false");
      cssTabBtn.setAttribute("aria-selected", currentTab === "css" ? "true" : "false");
      propsTabBtn.setAttribute("aria-selected", currentTab === "props" ? "true" : "false");
      domTabBtn.setAttribute("aria-selected", currentTab === "dom" ? "true" : "false");
      const hasTarget = currentTarget !== null;
      designPanel.hidden = !hasTarget || currentTab !== "design";
      cssPanelContainer.hidden = !hasTarget || currentTab !== "css";
      propsPanelContainer.hidden = !hasTarget || currentTab !== "props";
      domPanel.hidden = !hasTarget || currentTab !== "dom";
      cssPanel == null ? void 0 : cssPanel.setVisible(hasTarget && currentTab === "css");
      propsPanel == null ? void 0 : propsPanel.setVisible(hasTarget && currentTab === "props");
    }
    function renderEmptyState() {
      const hasTarget = currentTarget !== null;
      root.dataset.empty = hasTarget ? "false" : "true";
      emptyState.hidden = hasTarget;
      if (!hasTarget) {
        targetLabel.textContent = "";
      }
      renderTabs();
    }
    function updateControls() {
      for (const control of controls) {
        control.setTarget(currentTarget);
      }
      componentsTree == null ? void 0 : componentsTree.setTarget(currentTarget);
      cssPanel == null ? void 0 : cssPanel.setTarget(currentTarget);
      propsPanel == null ? void 0 : propsPanel.setTarget(currentTarget);
    }
    function cancelStyleObserverRaf() {
      if (styleObserverRafId !== null) {
        cancelAnimationFrame(styleObserverRafId);
        styleObserverRafId = null;
      }
    }
    function scheduleLiveStyleRefresh() {
      if (disposer.isDisposed) return;
      if (styleObserverRafId !== null) return;
      styleObserverRafId = requestAnimationFrame(() => {
        styleObserverRafId = null;
        if (disposer.isDisposed) return;
        if (!currentTarget || !currentTarget.isConnected) return;
        sizeControl == null ? void 0 : sizeControl.refresh();
        positionControl == null ? void 0 : positionControl.refresh();
        spacingControl == null ? void 0 : spacingControl.refresh();
      });
    }
    function disconnectStyleObserver() {
      cancelStyleObserverRaf();
      if (styleObserver) {
        try {
          styleObserver.disconnect();
        } catch (e) {
        }
      }
      styleObserver = null;
      styleObserverTarget = null;
    }
    function connectStyleObserver(target) {
      disconnectStyleObserver();
      if (!target || !target.isConnected) return;
      if (typeof MutationObserver === "undefined") return;
      styleObserverTarget = target;
      styleObserver = new MutationObserver(() => {
        if (disposer.isDisposed) return;
        if (styleObserverTarget !== currentTarget) return;
        scheduleLiveStyleRefresh();
      });
      try {
        styleObserver.observe(target, {
          attributes: true,
          attributeFilter: ["style"]
        });
      } catch (e) {
        disconnectStyleObserver();
      }
    }
    disposer.add(disconnectStyleObserver);
    function setTarget(element) {
      if (disposer.isDisposed) return;
      currentTarget = element;
      if (element) {
        targetLabel.textContent = formatTargetLabel(element);
      }
      renderEmptyState();
      updateControls();
      connectStyleObserver(currentTarget);
    }
    function setTab(tab) {
      if (disposer.isDisposed) return;
      currentTab = tab;
      renderTabs();
    }
    function getTab() {
      return currentTab;
    }
    function refresh() {
      if (disposer.isDisposed) return;
      if (currentTarget) {
        targetLabel.textContent = formatTargetLabel(currentTarget);
      }
      for (const control of controls) {
        control.refresh();
      }
      componentsTree == null ? void 0 : componentsTree.refresh();
      cssPanel == null ? void 0 : cssPanel.refresh();
      propsPanel == null ? void 0 : propsPanel.refresh();
    }
    function dispose() {
      componentsTree == null ? void 0 : componentsTree.dispose();
      componentsTree = null;
      cssPanel == null ? void 0 : cssPanel.dispose();
      cssPanel = null;
      propsPanel == null ? void 0 : propsPanel.dispose();
      propsPanel = null;
      for (const control of controls) {
        control.dispose();
      }
      controls.length = 0;
      controlGroups.clear();
      currentTarget = null;
      disposer.dispose();
    }
    renderEmptyState();
    return {
      setTarget,
      setTab,
      getTab,
      refresh,
      getPosition,
      setPosition,
      dispose
    };
  }
  class PropsError extends Error {
    constructor(message, data) {
      super(message);
      __publicField(this, "data");
      this.name = "PropsError";
      this.data = data;
    }
  }
  const EVENT_NAME = {
    REQUEST: "web-editor-props:request",
    RESPONSE: "web-editor-props:response",
    CLEANUP: "web-editor-props:cleanup"
  };
  const PROTOCOL_VERSION = 1;
  const DEFAULT_TIMEOUT_MS = 2500;
  const MIN_TIMEOUT_MS = 200;
  function createRequestId() {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
      }
    } catch (e) {
    }
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function encodePropValue(value) {
    if (value === void 0) return { $we: "undefined" };
    return value;
  }
  function isObject(value) {
    return value !== null && typeof value === "object";
  }
  function normalizeErrorMessage(err) {
    if (err instanceof Error) return err.message || String(err);
    return String(err);
  }
  function isEditablePrimitive(value) {
    if (value === null || value === void 0) return true;
    const t = typeof value;
    if (t === "string" || t === "boolean") return true;
    if (t === "number") return Number.isFinite(value);
    return false;
  }
  const DANGEROUS_KEYS = /* @__PURE__ */ new Set([
    "__proto__",
    "constructor",
    "prototype",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__"
  ]);
  function hasDangerousKey(path) {
    return path.some((seg) => typeof seg === "string" && DANGEROUS_KEYS.has(seg));
  }
  function createPropsBridge(options = {}) {
    var _a2;
    const defaultTimeoutMs = Math.max(MIN_TIMEOUT_MS, (_a2 = options.defaultTimeoutMs) != null ? _a2 : DEFAULT_TIMEOUT_MS);
    const pending = /* @__PURE__ */ new Map();
    let disposed = false;
    function assertActive() {
      if (disposed) {
        throw new PropsError("PropsBridge is disposed");
      }
    }
    function clearPending(error) {
      for (const [requestId, entry] of pending) {
        clearTimeout(entry.timeoutId);
        entry.resolve({ ok: false, error });
        pending.delete(requestId);
      }
    }
    function onResponse(event) {
      var _a3;
      if (disposed) return;
      const detail = event.detail;
      if (!isObject(detail)) return;
      if (detail.v !== PROTOCOL_VERSION) return;
      const requestId = typeof detail.requestId === "string" ? detail.requestId : "";
      if (!requestId) return;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      clearTimeout(entry.timeoutId);
      const success = Boolean(detail.success);
      const data = (_a3 = detail.data) != null ? _a3 : void 0;
      const error = typeof detail.error === "string" ? detail.error : void 0;
      entry.resolve({
        ok: success,
        data,
        error: success ? void 0 : error || "Props agent error"
      });
    }
    window.addEventListener(EVENT_NAME.RESPONSE, onResponse);
    function sendRequest(request, timeoutMs) {
      assertActive();
      const { requestId } = request;
      if (!requestId) {
        return Promise.resolve({ ok: false, error: "requestId is required" });
      }
      if (pending.has(requestId)) {
        return Promise.resolve({ ok: false, error: `Duplicate requestId: ${requestId}` });
      }
      return new Promise((resolve) => {
        const timeoutId = window.setTimeout(() => {
          pending.delete(requestId);
          resolve({
            ok: false,
            error: `Props agent timeout after ${timeoutMs}ms (op=${request.op})`
          });
        }, timeoutMs);
        pending.set(requestId, { resolve, timeoutId });
        try {
          window.dispatchEvent(new CustomEvent(EVENT_NAME.REQUEST, { detail: request }));
        } catch (err) {
          clearTimeout(timeoutId);
          pending.delete(requestId);
          resolve({
            ok: false,
            error: `Failed to dispatch props request: ${normalizeErrorMessage(err)}`
          });
        }
      });
    }
    function probe(locator, timeoutMs) {
      return __async(this, null, function* () {
        const request = {
          v: PROTOCOL_VERSION,
          requestId: createRequestId(),
          op: "probe",
          locator
        };
        return sendRequest(request, Math.max(MIN_TIMEOUT_MS, timeoutMs != null ? timeoutMs : defaultTimeoutMs));
      });
    }
    function read(locator, timeoutMs) {
      return __async(this, null, function* () {
        const request = {
          v: PROTOCOL_VERSION,
          requestId: createRequestId(),
          op: "read",
          locator
        };
        return sendRequest(request, Math.max(MIN_TIMEOUT_MS, timeoutMs != null ? timeoutMs : defaultTimeoutMs));
      });
    }
    function write(locator, path, value, timeoutMs) {
      return __async(this, null, function* () {
        if (!Array.isArray(path) || path.length === 0) {
          return { ok: false, error: "prop path is required" };
        }
        if (hasDangerousKey(path)) {
          return { ok: false, error: "Invalid prop path: contains dangerous key" };
        }
        if (!isEditablePrimitive(value)) {
          return { ok: false, error: "Only primitive prop values are supported" };
        }
        const request = {
          v: PROTOCOL_VERSION,
          requestId: createRequestId(),
          op: "write",
          locator,
          payload: {
            propPath: path,
            propValue: encodePropValue(value)
          }
        };
        return sendRequest(request, Math.max(MIN_TIMEOUT_MS, timeoutMs != null ? timeoutMs : defaultTimeoutMs));
      });
    }
    function reset(locator, timeoutMs) {
      return __async(this, null, function* () {
        const request = {
          v: PROTOCOL_VERSION,
          requestId: createRequestId(),
          op: "reset",
          locator
        };
        return sendRequest(request, Math.max(MIN_TIMEOUT_MS, timeoutMs != null ? timeoutMs : defaultTimeoutMs));
      });
    }
    function cleanup(timeoutMs) {
      return __async(this, null, function* () {
        if (disposed) return;
        const ms = Math.max(MIN_TIMEOUT_MS, timeoutMs != null ? timeoutMs : 800);
        try {
          const request = {
            v: PROTOCOL_VERSION,
            requestId: createRequestId(),
            op: "cleanup"
          };
          yield sendRequest(request, ms);
        } catch (e) {
        } finally {
          try {
            window.dispatchEvent(new CustomEvent(EVENT_NAME.CLEANUP));
          } catch (e) {
          }
          dispose();
        }
      });
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      try {
        window.removeEventListener(EVENT_NAME.RESPONSE, onResponse);
      } catch (e) {
      }
      clearPending("PropsBridge disposed");
    }
    function isDisposedFn() {
      return disposed;
    }
    return {
      probe,
      read,
      write,
      reset,
      cleanup,
      dispose,
      isDisposed: isDisposedFn
    };
  }
  const CANVAS_ATTR = "data-mcp-canvas";
  const CANVAS_ATTR_VALUE = "overlay";
  const HOVER_ANIMATION_DURATION_MS = 100;
  const BOX_STYLES = {
    hover: {
      strokeColor: WEB_EDITOR_V2_COLORS.hover,
      fillColor: `${WEB_EDITOR_V2_COLORS.hover}15`,
      // 15 = ~8% opacity
      lineWidth: 2,
      dashPattern: [6, 4]
    },
    selection: {
      strokeColor: WEB_EDITOR_V2_COLORS.selected,
      fillColor: `${WEB_EDITOR_V2_COLORS.selected}20`,
      // 20 = ~12% opacity
      lineWidth: 2,
      dashPattern: []
    },
    dragGhost: {
      strokeColor: WEB_EDITOR_V2_COLORS.selectionBorder,
      fillColor: WEB_EDITOR_V2_COLORS.dragGhost,
      lineWidth: 2,
      dashPattern: [8, 6]
    }
  };
  function isFinitePositive(value) {
    return Number.isFinite(value) && value > 0;
  }
  function isValidRect$2(rect) {
    if (!rect) return false;
    return Number.isFinite(rect.left) && Number.isFinite(rect.top) && isFinitePositive(rect.width) && isFinitePositive(rect.height);
  }
  function isValidLine(line) {
    if (!line) return false;
    return Number.isFinite(line.x1) && Number.isFinite(line.y1) && Number.isFinite(line.x2) && Number.isFinite(line.y2);
  }
  function clamp$1(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function lerpRect(from, to, t) {
    return {
      left: lerp(from.left, to.left, t),
      top: lerp(from.top, to.top, t),
      width: lerp(from.width, to.width, t),
      height: lerp(from.height, to.height, t)
    };
  }
  function buildRoundedRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }
  function createCanvasOverlay(options) {
    const { container } = options;
    const disposer = new Disposer();
    const existing = container.querySelector(
      `canvas[${CANVAS_ATTR}="${CANVAS_ATTR_VALUE}"]`
    );
    if (existing) {
      existing.remove();
    }
    const canvas = document.createElement("canvas");
    canvas.setAttribute(CANVAS_ATTR, CANVAS_ATTR_VALUE);
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      pointerEvents: "none",
      display: "block"
    });
    container.append(canvas);
    disposer.add(() => canvas.remove());
    const ctxOrNull = canvas.getContext("2d", {
      alpha: true,
      desynchronized: true
      // Lower latency on supported browsers
    });
    if (!ctxOrNull) {
      disposer.dispose();
      throw new Error(`${WEB_EDITOR_V2_LOG_PREFIX} Failed to get canvas 2D context`);
    }
    const ctx = ctxOrNull;
    let hoverRect = null;
    let hoverAnimation = null;
    let selectionRect = null;
    let dragGhostRect = null;
    let insertionLine = null;
    let guideLines = null;
    let distanceLabels = null;
    let viewportWidth = 1;
    let viewportHeight = 1;
    let devicePixelRatio = 1;
    let dirty = true;
    let rafId = null;
    function cancelRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    disposer.add(cancelRaf);
    function scheduleRaf() {
      if (rafId !== null || disposer.isDisposed) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        render();
      });
    }
    function updateCanvasSize() {
      const nextDpr = Math.max(1, window.devicePixelRatio || 1);
      const cssWidth = Math.max(1, viewportWidth);
      const cssHeight = Math.max(1, viewportHeight);
      const pixelWidth = Math.round(cssWidth * nextDpr);
      const pixelHeight = Math.round(cssHeight * nextDpr);
      const needsResize = canvas.width !== pixelWidth || canvas.height !== pixelHeight || Math.abs(devicePixelRatio - nextDpr) > 1e-3;
      if (!needsResize) return false;
      devicePixelRatio = nextDpr;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      return true;
    }
    function clearCanvas() {
      updateCanvasSize();
      ctx.clearRect(0, 0, viewportWidth, viewportHeight);
    }
    function drawBox(rect, style) {
      if (!isValidRect$2(rect)) return;
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      if (w <= 0 || h <= 0) return;
      const x = Math.round(rect.left) + 0.5;
      const y = Math.round(rect.top) + 0.5;
      ctx.save();
      ctx.lineWidth = style.lineWidth;
      ctx.strokeStyle = style.strokeColor;
      ctx.fillStyle = style.fillColor;
      ctx.setLineDash(style.dashPattern);
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    function drawInsertionLine(line) {
      if (!isValidLine(line)) return;
      ctx.save();
      ctx.lineWidth = WEB_EDITOR_V2_INSERTION_LINE_WIDTH;
      ctx.strokeStyle = WEB_EDITOR_V2_COLORS.insertionLine;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      const x1 = Math.round(line.x1) + 0.5;
      const y1 = Math.round(line.y1) + 0.5;
      const x2 = Math.round(line.x2) + 0.5;
      const y2 = Math.round(line.y2) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    }
    function drawGuideLines(lines) {
      if (!lines || lines.length === 0) return;
      ctx.save();
      ctx.lineWidth = WEB_EDITOR_V2_GUIDE_LINE_WIDTH;
      ctx.strokeStyle = WEB_EDITOR_V2_COLORS.guideLine;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      ctx.beginPath();
      for (const line of lines) {
        if (!isValidLine(line)) continue;
        const x1 = Math.round(line.x1) + 0.5;
        const y1 = Math.round(line.y1) + 0.5;
        const x2 = Math.round(line.x2) + 0.5;
        const y2 = Math.round(line.y2) + 0.5;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      ctx.restore();
    }
    function drawDistanceLabels(labels) {
      if (!labels || labels.length === 0) return;
      ctx.save();
      ctx.lineWidth = WEB_EDITOR_V2_DISTANCE_LINE_WIDTH;
      ctx.strokeStyle = WEB_EDITOR_V2_COLORS.guideLine;
      ctx.setLineDash([]);
      ctx.lineCap = "round";
      const tick = WEB_EDITOR_V2_DISTANCE_TICK_SIZE;
      ctx.beginPath();
      for (const label of labels) {
        const line = label.line;
        if (!isValidLine(line)) continue;
        const x1 = Math.round(line.x1) + 0.5;
        const y1 = Math.round(line.y1) + 0.5;
        const x2 = Math.round(line.x2) + 0.5;
        const y2 = Math.round(line.y2) + 0.5;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (label.axis === "x") {
          ctx.moveTo(x1, y1 - tick);
          ctx.lineTo(x1, y1 + tick);
          ctx.moveTo(x2, y2 - tick);
          ctx.lineTo(x2, y2 + tick);
        } else {
          ctx.moveTo(x1 - tick, y1);
          ctx.lineTo(x1 + tick, y1);
          ctx.moveTo(x2 - tick, y2);
          ctx.lineTo(x2 + tick, y2);
        }
      }
      ctx.stroke();
      ctx.font = WEB_EDITOR_V2_DISTANCE_LABEL_FONT;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const label of labels) {
        const line = label.line;
        if (!isValidLine(line)) continue;
        const metrics = ctx.measureText(label.text);
        const textWidth = metrics.width;
        const ascent = Number.isFinite(metrics.actualBoundingBoxAscent) ? metrics.actualBoundingBoxAscent : 8;
        const descent = Number.isFinite(metrics.actualBoundingBoxDescent) ? metrics.actualBoundingBoxDescent : 3;
        const textHeight = ascent + descent;
        const pillWidth = Math.ceil(textWidth + WEB_EDITOR_V2_DISTANCE_LABEL_PADDING_X * 2);
        const pillHeight = Math.ceil(textHeight + WEB_EDITOR_V2_DISTANCE_LABEL_PADDING_Y * 2);
        const midX = (line.x1 + line.x2) / 2;
        const midY = (line.y1 + line.y2) / 2;
        const offset = WEB_EDITOR_V2_DISTANCE_LABEL_OFFSET;
        let pillX = midX - pillWidth / 2;
        let pillY = midY - pillHeight / 2;
        if (label.axis === "x") {
          pillY = midY - pillHeight / 2 - offset;
          if (pillY < 0) {
            pillY = midY + offset - pillHeight / 2;
          }
        } else {
          pillX = midX + offset - pillWidth / 2;
          if (pillX + pillWidth > viewportWidth) {
            pillX = midX - offset - pillWidth / 2;
          }
        }
        const maxPillX = Math.max(2, viewportWidth - pillWidth - 2);
        const maxPillY = Math.max(2, viewportHeight - pillHeight - 2);
        pillX = clamp$1(pillX, 2, maxPillX);
        pillY = clamp$1(pillY, 2, maxPillY);
        ctx.save();
        ctx.fillStyle = WEB_EDITOR_V2_COLORS.distanceLabelBg;
        ctx.strokeStyle = WEB_EDITOR_V2_COLORS.distanceLabelBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        buildRoundedRectPath(
          ctx,
          pillX,
          pillY,
          pillWidth,
          pillHeight,
          WEB_EDITOR_V2_DISTANCE_LABEL_RADIUS
        );
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = WEB_EDITOR_V2_COLORS.distanceLabelText;
        ctx.fillText(label.text, pillX + pillWidth / 2, pillY + pillHeight / 2);
        ctx.restore();
      }
      ctx.restore();
    }
    function markDirty() {
      if (disposer.isDisposed) return;
      dirty = true;
      scheduleRaf();
    }
    function render() {
      if (disposer.isDisposed || !dirty) return;
      cancelRaf();
      dirty = false;
      const now = performance.now();
      let hoverRectToRender = hoverRect;
      if (hoverAnimation) {
        const elapsed = now - hoverAnimation.startTime;
        const progress = clamp$1(elapsed / hoverAnimation.durationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        hoverRectToRender = lerpRect(hoverAnimation.start, hoverAnimation.end, easedProgress);
        if (progress >= 1) {
          hoverAnimation = null;
        } else {
          dirty = true;
        }
      }
      clearCanvas();
      drawBox(hoverRectToRender, BOX_STYLES.hover);
      drawBox(selectionRect, BOX_STYLES.selection);
      drawBox(dragGhostRect, BOX_STYLES.dragGhost);
      drawInsertionLine(insertionLine);
      drawGuideLines(guideLines);
      drawDistanceLabels(distanceLabels);
      if (dirty) {
        scheduleRaf();
      }
    }
    function setHoverRect(rect, options2) {
      const shouldAnimate = (options2 == null ? void 0 : options2.animate) === true;
      if (!shouldAnimate) {
        hoverAnimation = null;
        hoverRect = rect;
        markDirty();
        return;
      }
      const now = performance.now();
      let fromRect = hoverRect;
      if (hoverAnimation) {
        const elapsed = now - hoverAnimation.startTime;
        const progress = clamp$1(elapsed / hoverAnimation.durationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        fromRect = lerpRect(hoverAnimation.start, hoverAnimation.end, easedProgress);
      }
      if (!isValidRect$2(fromRect) || !isValidRect$2(rect)) {
        hoverAnimation = null;
        hoverRect = rect;
        markDirty();
        return;
      }
      hoverAnimation = {
        start: __spreadValues({}, fromRect),
        end: __spreadValues({}, rect),
        startTime: now,
        durationMs: HOVER_ANIMATION_DURATION_MS
      };
      hoverRect = rect;
      markDirty();
    }
    function setSelectionRect(rect) {
      selectionRect = rect;
      markDirty();
    }
    function setDragGhostRect(rect) {
      dragGhostRect = rect;
      markDirty();
    }
    function setInsertionLine(line) {
      insertionLine = line;
      markDirty();
    }
    function setGuideLines(lines) {
      guideLines = lines && lines.length > 0 ? lines : null;
      markDirty();
    }
    function setDistanceLabels(labels) {
      distanceLabels = labels && labels.length > 0 ? labels : null;
      markDirty();
    }
    function clear() {
      hoverRect = null;
      hoverAnimation = null;
      selectionRect = null;
      dragGhostRect = null;
      insertionLine = null;
      guideLines = null;
      distanceLabels = null;
      markDirty();
    }
    try {
      const rect = container.getBoundingClientRect();
      viewportWidth = Math.max(1, rect.width);
      viewportHeight = Math.max(1, rect.height);
    } catch (error) {
      console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} Initial size measurement failed:`, error);
    }
    disposer.observeResize(container, (entries) => {
      const entry = entries[0];
      const rect = entry == null ? void 0 : entry.contentRect;
      if (!rect) return;
      const nextWidth = Math.max(1, rect.width);
      const nextHeight = Math.max(1, rect.height);
      if (Math.abs(nextWidth - viewportWidth) < 0.5 && Math.abs(nextHeight - viewportHeight) < 0.5) {
        return;
      }
      viewportWidth = nextWidth;
      viewportHeight = nextHeight;
      markDirty();
    });
    markDirty();
    return {
      canvas,
      markDirty,
      render,
      clear,
      setHoverRect,
      setSelectionRect,
      setDragGhostRect,
      setInsertionLine,
      setGuideLines,
      setDistanceLabels,
      dispose: () => disposer.dispose()
    };
  }
  function isFiniteNumber$2(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function isValidRect$1(rect) {
    if (!rect) return false;
    return isFiniteNumber$2(rect.left) && isFiniteNumber$2(rect.top) && isFiniteNumber$2(rect.width) && isFiniteNumber$2(rect.height) && rect.width > 0.5 && rect.height > 0.5;
  }
  function readElementRect(element) {
    try {
      const r = element.getBoundingClientRect();
      const rect = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height
      };
      return isValidRect$1(rect) ? rect : null;
    } catch (e) {
      return null;
    }
  }
  function rectRight(r) {
    return r.left + r.width;
  }
  function rectBottom(r) {
    return r.top + r.height;
  }
  function rectCenterX(r) {
    return r.left + r.width / 2;
  }
  function rectCenterY(r) {
    return r.top + r.height / 2;
  }
  function getRectXValue(rect, type) {
    switch (type) {
      case "left":
        return rect.left;
      case "center":
        return rectCenterX(rect);
      case "right":
        return rectRight(rect);
    }
  }
  function getRectYValue(rect, type) {
    switch (type) {
      case "top":
        return rect.top;
      case "middle":
        return rectCenterY(rect);
      case "bottom":
        return rectBottom(rect);
    }
  }
  function createEmptyAnchors() {
    return { x: [], y: [] };
  }
  function collectSiblingAnchors(target) {
    const parent = target.parentElement;
    if (!parent) return createEmptyAnchors();
    const targetRect = readElementRect(target);
    const refX = targetRect ? rectCenterX(targetRect) : 0;
    const refY = targetRect ? rectCenterY(targetRect) : 0;
    const children = parent.children;
    const childCount = children.length;
    let targetIndex = -1;
    for (let i = 0; i < childCount; i++) {
      if (children[i] === target) {
        targetIndex = i;
        break;
      }
    }
    if (targetIndex === -1) return createEmptyAnchors();
    const candidates = [];
    let scanned = 0;
    let leftOffset = 1;
    let rightOffset = 1;
    while (scanned < WEB_EDITOR_V2_SNAP_MAX_SIBLINGS_SCAN) {
      const leftIndex = targetIndex - leftOffset;
      const rightIndex = targetIndex + rightOffset;
      const canGoLeft = leftIndex >= 0;
      const canGoRight = rightIndex < childCount;
      if (!canGoLeft && !canGoRight) break;
      if (canGoLeft) {
        const child = children[leftIndex];
        const rect = readElementRect(child);
        if (rect) {
          const dx = rectCenterX(rect) - refX;
          const dy = rectCenterY(rect) - refY;
          candidates.push({ rect, distanceSquared: dx * dx + dy * dy });
        }
        scanned++;
        leftOffset++;
      }
      if (canGoRight && scanned < WEB_EDITOR_V2_SNAP_MAX_SIBLINGS_SCAN) {
        const child = children[rightIndex];
        const rect = readElementRect(child);
        if (rect) {
          const dx = rectCenterX(rect) - refX;
          const dy = rectCenterY(rect) - refY;
          candidates.push({ rect, distanceSquared: dx * dx + dy * dy });
        }
        scanned++;
        rightOffset++;
      }
    }
    candidates.sort((a, b) => a.distanceSquared - b.distanceSquared);
    const selected = candidates.slice(0, WEB_EDITOR_V2_SNAP_MAX_ANCHOR_ELEMENTS);
    const xAnchors = [];
    const yAnchors = [];
    for (const { rect } of selected) {
      xAnchors.push({ type: "left", value: rect.left, source: "sibling", sourceRect: rect });
      xAnchors.push({
        type: "center",
        value: rectCenterX(rect),
        source: "sibling",
        sourceRect: rect
      });
      xAnchors.push({ type: "right", value: rectRight(rect), source: "sibling", sourceRect: rect });
      yAnchors.push({ type: "top", value: rect.top, source: "sibling", sourceRect: rect });
      yAnchors.push({
        type: "middle",
        value: rectCenterY(rect),
        source: "sibling",
        sourceRect: rect
      });
      yAnchors.push({ type: "bottom", value: rectBottom(rect), source: "sibling", sourceRect: rect });
    }
    return { x: xAnchors, y: yAnchors };
  }
  function collectViewportAnchors() {
    const viewportWidth = Math.max(1, window.innerWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || 1);
    return {
      x: [
        { type: "left", value: 0, source: "viewport" },
        { type: "center", value: viewportWidth / 2, source: "viewport" },
        { type: "right", value: viewportWidth, source: "viewport" }
      ],
      y: [
        { type: "top", value: 0, source: "viewport" },
        { type: "middle", value: viewportHeight / 2, source: "viewport" },
        { type: "bottom", value: viewportHeight, source: "viewport" }
      ]
    };
  }
  function mergeAnchors(...collections) {
    const x = [];
    const y = [];
    for (const collection of collections) {
      x.push(...collection.x);
      y.push(...collection.y);
    }
    return { x, y };
  }
  function applyXSnap(rect, fixedEdge, type, value, minSize) {
    const left = rect.left;
    const right = rectRight(rect);
    if (fixedEdge === "left") {
      if (type === "right") {
        const width = value - left;
        if (!isFiniteNumber$2(width) || width < minSize) return null;
        return { left, top: rect.top, width, height: rect.height };
      }
      if (type === "center") {
        const width = (value - left) * 2;
        if (!isFiniteNumber$2(width) || width < minSize) return null;
        return { left, top: rect.top, width, height: rect.height };
      }
      return rect;
    }
    if (fixedEdge === "right") {
      if (type === "left") {
        const width = right - value;
        if (!isFiniteNumber$2(width) || width < minSize) return null;
        return { left: value, top: rect.top, width, height: rect.height };
      }
      if (type === "center") {
        const nextLeft = 2 * value - right;
        const width = right - nextLeft;
        if (!isFiniteNumber$2(width) || width < minSize) return null;
        return { left: nextLeft, top: rect.top, width, height: rect.height };
      }
      return rect;
    }
    return rect;
  }
  function applyYSnap(rect, fixedEdge, type, value, minSize) {
    const top = rect.top;
    const bottom = rectBottom(rect);
    if (fixedEdge === "top") {
      if (type === "bottom") {
        const height = value - top;
        if (!isFiniteNumber$2(height) || height < minSize) return null;
        return { left: rect.left, top, width: rect.width, height };
      }
      if (type === "middle") {
        const height = (value - top) * 2;
        if (!isFiniteNumber$2(height) || height < minSize) return null;
        return { left: rect.left, top, width: rect.width, height };
      }
      return rect;
    }
    if (fixedEdge === "bottom") {
      if (type === "top") {
        const height = bottom - value;
        if (!isFiniteNumber$2(height) || height < minSize) return null;
        return { left: rect.left, top: value, width: rect.width, height };
      }
      if (type === "middle") {
        const nextTop = 2 * value - bottom;
        const height = bottom - nextTop;
        if (!isFiniteNumber$2(height) || height < minSize) return null;
        return { left: rect.left, top: nextTop, width: rect.width, height };
      }
      return rect;
    }
    return rect;
  }
  function findBestXSnap(rect, fixedEdge, anchors, allowedTypes, threshold, minSize) {
    let best = null;
    for (const anchor of anchors) {
      if (!allowedTypes.includes(anchor.type)) continue;
      const currentValue = getRectXValue(rect, anchor.type);
      const distance = Math.abs(anchor.value - currentValue);
      if (distance > threshold) continue;
      const snappedRect = applyXSnap(rect, fixedEdge, anchor.type, anchor.value, minSize);
      if (!snappedRect) continue;
      const isBetter = !best || distance < best.distance || distance === best.distance && anchor.source === "sibling" && best.anchor.source !== "sibling";
      if (isBetter) {
        best = { distance, anchor, snappedRect };
      }
    }
    return best;
  }
  function findBestYSnap(rect, fixedEdge, anchors, allowedTypes, threshold, minSize) {
    let best = null;
    for (const anchor of anchors) {
      if (!allowedTypes.includes(anchor.type)) continue;
      const currentValue = getRectYValue(rect, anchor.type);
      const distance = Math.abs(anchor.value - currentValue);
      if (distance > threshold) continue;
      const snappedRect = applyYSnap(rect, fixedEdge, anchor.type, anchor.value, minSize);
      if (!snappedRect) continue;
      const isBetter = !best || distance < best.distance || distance === best.distance && anchor.source === "sibling" && best.anchor.source !== "sibling";
      if (isBetter) {
        best = { distance, anchor, snappedRect };
      }
    }
    return best;
  }
  function buildGuideLines(snappedRect, lockX, lockY, viewport) {
    const guides = [];
    const viewportWidth = Math.max(1, viewport.width);
    const viewportHeight = Math.max(1, viewport.height);
    if (lockX) {
      const x = lockX.value;
      if (lockX.source === "viewport" || !lockX.sourceRect) {
        guides.push({ x1: x, y1: 0, x2: x, y2: viewportHeight });
      } else {
        const sourceRect = lockX.sourceRect;
        const y1 = Math.min(sourceRect.top, snappedRect.top);
        const y2 = Math.max(rectBottom(sourceRect), rectBottom(snappedRect));
        guides.push({ x1: x, y1, x2: x, y2 });
      }
    }
    if (lockY) {
      const y = lockY.value;
      if (lockY.source === "viewport" || !lockY.sourceRect) {
        guides.push({ x1: 0, y1: y, x2: viewportWidth, y2: y });
      } else {
        const sourceRect = lockY.sourceRect;
        const x1 = Math.min(sourceRect.left, snappedRect.left);
        const x2 = Math.max(rectRight(sourceRect), rectRight(snappedRect));
        guides.push({ x1, y1: y, x2, y2: y });
      }
    }
    return guides;
  }
  function computeResizeSnap(params) {
    var _a2, _b2;
    const { rect, resize, anchors, thresholdPx, hysteresisPx, minSizePx, viewport } = params;
    if (!isValidRect$1(rect)) {
      return { snappedRect: rect, guideLines: [], lockX: null, lockY: null };
    }
    const fixedEdgeX = resize.hasWest ? "right" : resize.hasEast ? "left" : null;
    const fixedEdgeY = resize.hasNorth ? "bottom" : resize.hasSouth ? "top" : null;
    const allowedXTypes = fixedEdgeX === "left" ? ["right", "center"] : fixedEdgeX === "right" ? ["left", "center"] : [];
    const allowedYTypes = fixedEdgeY === "top" ? ["bottom", "middle"] : fixedEdgeY === "bottom" ? ["top", "middle"] : [];
    let snappedRect = __spreadValues({}, rect);
    let lockX = params.lockX;
    let lockY = params.lockY;
    if (fixedEdgeX) {
      if (lockX) {
        if (!allowedXTypes.includes(lockX.type)) {
          lockX = null;
        } else {
          const currentValue = getRectXValue(snappedRect, lockX.type);
          const distance = Math.abs(lockX.value - currentValue);
          const canApply = applyXSnap(snappedRect, fixedEdgeX, lockX.type, lockX.value, minSizePx);
          if (distance > thresholdPx + hysteresisPx || !canApply) {
            lockX = null;
          }
        }
      }
      if (lockX) {
        const applied = applyXSnap(snappedRect, fixedEdgeX, lockX.type, lockX.value, minSizePx);
        if (applied) snappedRect = applied;
      } else {
        const best = findBestXSnap(
          snappedRect,
          fixedEdgeX,
          anchors.x,
          allowedXTypes,
          thresholdPx,
          minSizePx
        );
        if (best) {
          lockX = {
            type: best.anchor.type,
            value: best.anchor.value,
            source: best.anchor.source,
            sourceRect: (_a2 = best.anchor.sourceRect) != null ? _a2 : null
          };
          snappedRect = best.snappedRect;
        }
      }
    } else {
      lockX = null;
    }
    if (fixedEdgeY) {
      if (lockY) {
        if (!allowedYTypes.includes(lockY.type)) {
          lockY = null;
        } else {
          const currentValue = getRectYValue(snappedRect, lockY.type);
          const distance = Math.abs(lockY.value - currentValue);
          const canApply = applyYSnap(snappedRect, fixedEdgeY, lockY.type, lockY.value, minSizePx);
          if (distance > thresholdPx + hysteresisPx || !canApply) {
            lockY = null;
          }
        }
      }
      if (lockY) {
        const applied = applyYSnap(snappedRect, fixedEdgeY, lockY.type, lockY.value, minSizePx);
        if (applied) snappedRect = applied;
      } else {
        const best = findBestYSnap(
          snappedRect,
          fixedEdgeY,
          anchors.y,
          allowedYTypes,
          thresholdPx,
          minSizePx
        );
        if (best) {
          lockY = {
            type: best.anchor.type,
            value: best.anchor.value,
            source: best.anchor.source,
            sourceRect: (_b2 = best.anchor.sourceRect) != null ? _b2 : null
          };
          snappedRect = best.snappedRect;
        }
      }
    } else {
      lockY = null;
    }
    const guideLines = buildGuideLines(snappedRect, lockX, lockY, viewport);
    return { snappedRect, guideLines, lockX, lockY };
  }
  function shouldShowGap(gap, minGap) {
    return isFiniteNumber$2(gap) && gap > 0 && gap >= minGap;
  }
  function formatDistanceText(px) {
    const rounded = Math.round(px);
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    return `${normalized}px`;
  }
  function clamp(value, min, max) {
    if (!isFiniteNumber$2(value)) return min;
    return Math.min(max, Math.max(min, value));
  }
  function computeDistanceLabels(params) {
    const { rect, lockX, lockY, viewport, minGapPx } = params;
    if (!isValidRect$1(rect)) return [];
    const viewportWidth = isFiniteNumber$2(viewport.width) ? Math.max(1, viewport.width) : 1;
    const viewportHeight = isFiniteNumber$2(viewport.height) ? Math.max(1, viewport.height) : 1;
    const minGap = Math.max(0, minGapPx);
    const labels = [];
    if (lockX && lockX.source === "sibling" && lockX.sourceRect) {
      const other = lockX.sourceRect;
      const gapAbove = rect.top - rectBottom(other);
      const gapBelow = other.top - rectBottom(rect);
      if (shouldShowGap(gapAbove, minGap)) {
        labels.push({
          kind: "sibling",
          axis: "y",
          value: Math.round(gapAbove),
          text: formatDistanceText(gapAbove),
          line: { x1: lockX.value, y1: rectBottom(other), x2: lockX.value, y2: rect.top }
        });
      } else if (shouldShowGap(gapBelow, minGap)) {
        labels.push({
          kind: "sibling",
          axis: "y",
          value: Math.round(gapBelow),
          text: formatDistanceText(gapBelow),
          line: { x1: lockX.value, y1: rectBottom(rect), x2: lockX.value, y2: other.top }
        });
      }
    }
    if (lockY && lockY.source === "sibling" && lockY.sourceRect) {
      const other = lockY.sourceRect;
      const gapLeft = rect.left - rectRight(other);
      const gapRight = other.left - rectRight(rect);
      if (shouldShowGap(gapLeft, minGap)) {
        labels.push({
          kind: "sibling",
          axis: "x",
          value: Math.round(gapLeft),
          text: formatDistanceText(gapLeft),
          line: { x1: rectRight(other), y1: lockY.value, x2: rect.left, y2: lockY.value }
        });
      } else if (shouldShowGap(gapRight, minGap)) {
        labels.push({
          kind: "sibling",
          axis: "x",
          value: Math.round(gapRight),
          text: formatDistanceText(gapRight),
          line: { x1: rectRight(rect), y1: lockY.value, x2: other.left, y2: lockY.value }
        });
      }
    }
    if (lockX && lockX.source === "viewport") {
      const y = clamp(rectCenterY(rect), 0, viewportHeight);
      const leftGap = rect.left;
      const rightGap = viewportWidth - rectRight(rect);
      const addLeft = () => {
        if (!shouldShowGap(leftGap, minGap)) return false;
        labels.push({
          kind: "viewport",
          axis: "x",
          value: Math.round(leftGap),
          text: formatDistanceText(leftGap),
          line: { x1: 0, y1: y, x2: rect.left, y2: y }
        });
        return true;
      };
      const addRight = () => {
        if (!shouldShowGap(rightGap, minGap)) return false;
        labels.push({
          kind: "viewport",
          axis: "x",
          value: Math.round(rightGap),
          text: formatDistanceText(rightGap),
          line: { x1: rectRight(rect), y1: y, x2: viewportWidth, y2: y }
        });
        return true;
      };
      if (lockX.type === "center") {
        addLeft();
        addRight();
      } else if (lockX.type === "left") {
        if (!addLeft()) addRight();
      } else {
        if (!addRight()) addLeft();
      }
    }
    if (lockY && lockY.source === "viewport") {
      const x = clamp(rectCenterX(rect), 0, viewportWidth);
      const topGap = rect.top;
      const bottomGap = viewportHeight - rectBottom(rect);
      const addTop = () => {
        if (!shouldShowGap(topGap, minGap)) return false;
        labels.push({
          kind: "viewport",
          axis: "y",
          value: Math.round(topGap),
          text: formatDistanceText(topGap),
          line: { x1: x, y1: 0, x2: x, y2: rect.top }
        });
        return true;
      };
      const addBottom = () => {
        if (!shouldShowGap(bottomGap, minGap)) return false;
        labels.push({
          kind: "viewport",
          axis: "y",
          value: Math.round(bottomGap),
          text: formatDistanceText(bottomGap),
          line: { x1: x, y1: rectBottom(rect), x2: x, y2: viewportHeight }
        });
        return true;
      };
      if (lockY.type === "middle") {
        addTop();
        addBottom();
      } else if (lockY.type === "top") {
        if (!addTop()) addBottom();
      } else {
        if (!addBottom()) addTop();
      }
    }
    return labels;
  }
  const MIN_BORDER_BOX_SIZE_PX = 1;
  const RESIZE_DRAG_THRESHOLD_PX = 3;
  const HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const CURSOR_BY_DIR = {
    n: "ns-resize",
    s: "ns-resize",
    e: "ew-resize",
    w: "ew-resize",
    ne: "nesw-resize",
    sw: "nesw-resize",
    nw: "nwse-resize",
    se: "nwse-resize"
  };
  function isFiniteNumber$1(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function isValidRect(rect) {
    if (!rect) return false;
    return isFiniteNumber$1(rect.left) && isFiniteNumber$1(rect.top) && isFiniteNumber$1(rect.width) && isFiniteNumber$1(rect.height) && rect.width > 0.5 && rect.height > 0.5;
  }
  function clampMin(value, min) {
    if (!Number.isFinite(value)) return min;
    return value < min ? min : value;
  }
  function parsePx(value) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "auto" || trimmed === "none") return null;
    const match = trimmed.match(/^(-?\d+(?:\.\d+)?)px$/);
    if (match) {
      const num2 = Number(match[1]);
      return Number.isFinite(num2) ? num2 : null;
    }
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  function formatPx(value) {
    if (!Number.isFinite(value)) return "0px";
    const rounded = Math.round(value * 100) / 100;
    const normalized = Object.is(rounded, -0) ? 0 : rounded;
    return `${normalized}px`;
  }
  function getResizeMode(position) {
    const p = position.trim().toLowerCase();
    if (p === "fixed") return "fixed";
    if (p === "absolute") return "absolute";
    if (p === "relative" || p === "sticky") return "relative";
    return "static";
  }
  function dirHasWest(dir) {
    return dir === "w" || dir === "nw" || dir === "sw";
  }
  function dirHasEast(dir) {
    return dir === "e" || dir === "ne" || dir === "se";
  }
  function dirHasNorth(dir) {
    return dir === "n" || dir === "nw" || dir === "ne";
  }
  function dirHasSouth(dir) {
    return dir === "s" || dir === "sw" || dir === "se";
  }
  function readViewportRect(element) {
    try {
      const r = element.getBoundingClientRect();
      if (!Number.isFinite(r.left) || !Number.isFinite(r.top) || !Number.isFinite(r.width) || !Number.isFinite(r.height)) {
        return null;
      }
      return {
        left: r.left,
        top: r.top,
        width: Math.max(0, r.width),
        height: Math.max(0, r.height)
      };
    } catch (e) {
      return null;
    }
  }
  function safeGetComputedStyle(element) {
    try {
      return window.getComputedStyle(element);
    } catch (e) {
      return null;
    }
  }
  function sumStylePx(style, propA, propB) {
    var _a2, _b2;
    const a = (_a2 = parsePx(style.getPropertyValue(propA))) != null ? _a2 : 0;
    const b = (_b2 = parsePx(style.getPropertyValue(propB))) != null ? _b2 : 0;
    return a + b;
  }
  function readBoxExtras(style) {
    const boxSizingRaw = style.getPropertyValue("box-sizing").trim();
    const boxSizing = boxSizingRaw === "border-box" ? "border-box" : "content-box";
    const paddingX = sumStylePx(style, "padding-left", "padding-right");
    const paddingY = sumStylePx(style, "padding-top", "padding-bottom");
    const borderX = sumStylePx(style, "border-left-width", "border-right-width");
    const borderY = sumStylePx(style, "border-top-width", "border-bottom-width");
    return {
      boxSizing,
      horizontalExtras: paddingX + borderX,
      verticalExtras: paddingY + borderY
    };
  }
  function borderBoxToCssSize(borderBoxPx, extrasPx, boxSizing) {
    if (boxSizing === "border-box") return borderBoxPx;
    return Math.max(0, borderBoxPx - extrasPx);
  }
  function computeAbsoluteOrigin(target) {
    var _a2, _b2;
    try {
      const op = target.offsetParent;
      if (op instanceof HTMLElement) {
        const rect = op.getBoundingClientRect();
        const style = safeGetComputedStyle(op);
        const borderLeft = style ? (_a2 = parsePx(style.getPropertyValue("border-left-width"))) != null ? _a2 : 0 : 0;
        const borderTop = style ? (_b2 = parsePx(style.getPropertyValue("border-top-width"))) != null ? _b2 : 0 : 0;
        return {
          originX: rect.left + borderLeft,
          originY: rect.top + borderTop,
          scrollLeft: op.scrollLeft,
          scrollTop: op.scrollTop
        };
      }
    } catch (e) {
    }
    return { originX: 0, originY: 0, scrollLeft: 0, scrollTop: 0 };
  }
  function stopEvent(event) {
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  }
  function createHandlesController(options) {
    const disposer = new Disposer();
    const { container, canvasOverlay, transactionManager, positionTracker } = options;
    const layer = document.createElement("div");
    layer.className = "we-handles-layer";
    layer.setAttribute("aria-hidden", "true");
    container.append(layer);
    disposer.add(() => layer.remove());
    const frame = document.createElement("div");
    frame.className = "we-selection-frame";
    frame.hidden = true;
    layer.append(frame);
    const sizeHud = document.createElement("div");
    sizeHud.className = "we-size-hud";
    sizeHud.hidden = true;
    frame.append(sizeHud);
    const handleEls = /* @__PURE__ */ new Map();
    for (const dir of HANDLE_DIRS) {
      const el = document.createElement("div");
      el.className = "we-resize-handle";
      el.dataset.dir = dir;
      el.tabIndex = -1;
      frame.append(el);
      handleEls.set(dir, el);
    }
    let currentTarget = null;
    let currentSelectionRect = null;
    let session = null;
    let rafId = null;
    function cancelRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    disposer.add(cancelRaf);
    function renderSelectionRect(rect) {
      const shouldShow = !!currentTarget && isValidRect(rect);
      if (!shouldShow) {
        frame.hidden = true;
        return;
      }
      frame.hidden = false;
      frame.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
      frame.style.width = `${rect.width}px`;
      frame.style.height = `${rect.height}px`;
    }
    function setHud(text) {
      if (!text) {
        sizeHud.hidden = true;
        sizeHud.textContent = "";
        return;
      }
      sizeHud.hidden = false;
      sizeHud.textContent = text;
    }
    function restoreBodyStyles(s) {
      document.body.style.cursor = s.prevBodyCursor;
      document.body.style.userSelect = s.prevBodyUserSelect;
    }
    function cancelSession(reason) {
      const s = session;
      if (!s) return;
      cancelRaf();
      session = null;
      if (s.tx) {
        try {
          s.tx.rollback();
        } catch (error) {
          console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} Resize rollback failed:`, error);
        }
      }
      try {
        restoreBodyStyles(s);
      } catch (e) {
      }
      try {
        canvasOverlay.setGuideLines(null);
        canvasOverlay.setDistanceLabels(null);
        canvasOverlay.render();
      } catch (e) {
      }
      setHud(null);
      renderSelectionRect(currentSelectionRect);
      try {
        positionTracker.forceUpdate();
      } catch (e) {
      }
      if (reason) {
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Resize cancelled (${reason})`);
      }
    }
    function commitSession() {
      const s = session;
      if (!s) return;
      cancelRaf();
      session = null;
      if (s.tx) {
        try {
          s.tx.commit({ merge: false });
        } catch (error) {
          console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} Resize commit failed:`, error);
          try {
            s.tx.rollback();
          } catch (e) {
          }
        }
      }
      try {
        restoreBodyStyles(s);
      } catch (e) {
      }
      try {
        canvasOverlay.setGuideLines(null);
        canvasOverlay.setDistanceLabels(null);
        canvasOverlay.render();
      } catch (e) {
      }
      setHud(null);
      try {
        positionTracker.forceUpdate();
      } catch (e) {
      }
    }
    function scheduleFrame() {
      if (rafId !== null || disposer.isDisposed) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateFrame();
      });
    }
    function updateFrame() {
      const s = session;
      if (!s) return;
      if (!s.target.isConnected) {
        cancelSession("target_disconnected");
        return;
      }
      const dx = s.lastClientX - s.startClientX;
      const dy = s.lastClientY - s.startClientY;
      if (!s.hasPassedThreshold) {
        if (Math.hypot(dx, dy) < RESIZE_DRAG_THRESHOLD_PX) {
          return;
        }
        s.hasPassedThreshold = true;
        const startedTx = transactionManager.beginMultiStyle(s.target, Array.from(s.properties));
        if (!startedTx) {
          cancelSession("tx_unavailable");
          return;
        }
        s.tx = startedTx;
        try {
          const siblingAnchors = collectSiblingAnchors(s.target);
          const viewportAnchors = collectViewportAnchors();
          s.anchors = mergeAnchors(siblingAnchors, viewportAnchors);
        } catch (e) {
          s.anchors = null;
        }
      }
      const tx = s.tx;
      if (!tx) {
        cancelSession("tx_missing");
        return;
      }
      let nextWidthBorderBox = s.startRect.width;
      let nextHeightBorderBox = s.startRect.height;
      if (s.affectsWidth) {
        if (dirHasEast(s.dir)) {
          nextWidthBorderBox = clampMin(s.startRect.width + dx, MIN_BORDER_BOX_SIZE_PX);
        }
        if (dirHasWest(s.dir)) {
          nextWidthBorderBox = clampMin(s.startRect.width - dx, MIN_BORDER_BOX_SIZE_PX);
        }
      }
      if (s.affectsHeight) {
        if (dirHasSouth(s.dir)) {
          nextHeightBorderBox = clampMin(s.startRect.height + dy, MIN_BORDER_BOX_SIZE_PX);
        }
        if (dirHasNorth(s.dir)) {
          nextHeightBorderBox = clampMin(s.startRect.height - dy, MIN_BORDER_BOX_SIZE_PX);
        }
      }
      const proposedLeftDelta = s.hasWest ? s.startRect.width - nextWidthBorderBox : 0;
      const proposedTopDelta = s.hasNorth ? s.startRect.height - nextHeightBorderBox : 0;
      const proposedRect = {
        left: s.startRect.left + proposedLeftDelta,
        top: s.startRect.top + proposedTopDelta,
        width: nextWidthBorderBox,
        height: nextHeightBorderBox
      };
      let finalRect = proposedRect;
      if (s.anchors) {
        const hasEast = dirHasEast(s.dir);
        const hasSouth = dirHasSouth(s.dir);
        const snapResult = computeResizeSnap({
          rect: proposedRect,
          resize: {
            hasWest: s.hasWest,
            hasEast,
            hasNorth: s.hasNorth,
            hasSouth
          },
          anchors: s.anchors,
          thresholdPx: WEB_EDITOR_V2_SNAP_THRESHOLD_PX,
          hysteresisPx: WEB_EDITOR_V2_SNAP_HYSTERESIS_PX,
          minSizePx: MIN_BORDER_BOX_SIZE_PX,
          lockX: s.lockX,
          lockY: s.lockY,
          viewport: {
            width: window.innerWidth || 1,
            height: window.innerHeight || 1
          }
        });
        s.lockX = snapResult.lockX;
        s.lockY = snapResult.lockY;
        finalRect = snapResult.snappedRect;
        const distanceLabels = computeDistanceLabels({
          rect: finalRect,
          lockX: s.lockX,
          lockY: s.lockY,
          minGapPx: WEB_EDITOR_V2_DISTANCE_LABEL_MIN_PX,
          viewport: {
            width: window.innerWidth || 1,
            height: window.innerHeight || 1
          }
        });
        const hasGuides = snapResult.guideLines.length > 0;
        const hasDistanceLabels = distanceLabels.length > 0;
        if (hasGuides || s.hadGuidesLastFrame || hasDistanceLabels || s.hadDistanceLabelsLastFrame) {
          try {
            canvasOverlay.setGuideLines(hasGuides ? snapResult.guideLines : null);
            canvasOverlay.setDistanceLabels(hasDistanceLabels ? distanceLabels : null);
            canvasOverlay.render();
          } catch (e) {
          }
          s.hadGuidesLastFrame = hasGuides;
          s.hadDistanceLabelsLastFrame = hasDistanceLabels;
        }
        nextWidthBorderBox = finalRect.width;
        nextHeightBorderBox = finalRect.height;
      }
      const leftEdgeDelta = finalRect.left - s.startRect.left;
      const topEdgeDelta = finalRect.top - s.startRect.top;
      renderSelectionRect(finalRect);
      setHud(`${Math.round(finalRect.width)} × ${Math.round(finalRect.height)}`);
      const styles = {};
      if (s.affectsWidth) {
        const widthCssPx = borderBoxToCssSize(
          nextWidthBorderBox,
          s.extras.horizontalExtras,
          s.extras.boxSizing
        );
        styles.width = formatPx(widthCssPx);
      }
      if (s.affectsHeight) {
        const heightCssPx = borderBoxToCssSize(
          nextHeightBorderBox,
          s.extras.verticalExtras,
          s.extras.boxSizing
        );
        styles.height = formatPx(heightCssPx);
      }
      if (s.mode === "absolute" || s.mode === "fixed") {
        if (s.affectsWidth) {
          styles.left = formatPx(s.startPosX + leftEdgeDelta);
          styles.right = "";
        }
        if (s.affectsHeight) {
          styles.top = formatPx(s.startPosY + topEdgeDelta);
          styles.bottom = "";
        }
      } else if (s.mode === "relative") {
        if (s.affectsWidth && s.hasWest) {
          styles.left = formatPx(s.startPosX + leftEdgeDelta);
        }
        if (s.affectsHeight && s.hasNorth) {
          styles.top = formatPx(s.startPosY + topEdgeDelta);
        }
      } else {
        if (s.affectsWidth && s.hasWest) {
          styles["margin-left"] = formatPx(s.startPosX + leftEdgeDelta);
        }
        if (s.affectsHeight && s.hasNorth) {
          styles["margin-top"] = formatPx(s.startPosY + topEdgeDelta);
        }
      }
      try {
        tx.set(styles);
      } catch (error) {
        console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} Resize preview apply failed:`, error);
        cancelSession("apply_failed");
      }
    }
    function startResize(dir, handleEl, event) {
      var _a2, _b2, _c, _d;
      if (disposer.isDisposed) return;
      if (event.button !== 0) return;
      const target = currentTarget;
      if (!target || !target.isConnected) return;
      if (session) cancelSession("restart");
      const computed = safeGetComputedStyle(target);
      if (!computed) return;
      const transform = computed.getPropertyValue("transform").trim();
      if (transform && transform !== "none") {
        console.warn(
          `${WEB_EDITOR_V2_LOG_PREFIX} Resize handles do not support transformed elements yet`
        );
        return;
      }
      const position = computed.getPropertyValue("position");
      const mode = getResizeMode(position);
      const hasWest = dirHasWest(dir);
      const hasNorth = dirHasNorth(dir);
      const affectsWidth = hasWest || dirHasEast(dir);
      const affectsHeight = hasNorth || dirHasSouth(dir);
      const marginLeftRaw = computed.getPropertyValue("margin-left").trim().toLowerCase();
      const marginTopRaw = computed.getPropertyValue("margin-top").trim().toLowerCase();
      const marginLeftPx = (_a2 = parsePx(marginLeftRaw)) != null ? _a2 : 0;
      const marginTopPx = (_b2 = parsePx(marginTopRaw)) != null ? _b2 : 0;
      if (mode === "static") {
        if (hasWest && marginLeftRaw === "auto") {
          console.warn(
            `${WEB_EDITOR_V2_LOG_PREFIX} Resize from west is disabled when margin-left is auto`
          );
          return;
        }
        if (hasNorth && marginTopRaw === "auto") {
          console.warn(
            `${WEB_EDITOR_V2_LOG_PREFIX} Resize from north is disabled when margin-top is auto`
          );
          return;
        }
      }
      const rect = isValidRect(currentSelectionRect) ? currentSelectionRect : readViewportRect(target);
      if (!rect || !isValidRect(rect)) return;
      const properties = [];
      if (affectsWidth) {
        properties.push("width");
        if (mode === "absolute" || mode === "fixed") {
          properties.push("left", "right");
        } else if (mode === "relative") {
          if (hasWest) properties.push("left");
        } else {
          if (hasWest) properties.push("margin-left");
        }
      }
      if (affectsHeight) {
        properties.push("height");
        if (mode === "absolute" || mode === "fixed") {
          properties.push("top", "bottom");
        } else if (mode === "relative") {
          if (hasNorth) properties.push("top");
        } else {
          if (hasNorth) properties.push("margin-top");
        }
      }
      let absOrigin = null;
      let startPosX = 0;
      let startPosY = 0;
      if (mode === "absolute") {
        absOrigin = computeAbsoluteOrigin(target);
        startPosX = affectsWidth ? rect.left - marginLeftPx - absOrigin.originX + absOrigin.scrollLeft : 0;
        startPosY = affectsHeight ? rect.top - marginTopPx - absOrigin.originY + absOrigin.scrollTop : 0;
      } else if (mode === "fixed") {
        absOrigin = { originX: 0, originY: 0, scrollLeft: 0, scrollTop: 0 };
        startPosX = affectsWidth ? rect.left - marginLeftPx : 0;
        startPosY = affectsHeight ? rect.top - marginTopPx : 0;
      } else if (mode === "relative") {
        startPosX = affectsWidth && hasWest ? (_c = parsePx(computed.getPropertyValue("left"))) != null ? _c : 0 : 0;
        startPosY = affectsHeight && hasNorth ? (_d = parsePx(computed.getPropertyValue("top"))) != null ? _d : 0 : 0;
      } else {
        startPosX = affectsWidth && hasWest ? marginLeftPx : 0;
        startPosY = affectsHeight && hasNorth ? marginTopPx : 0;
      }
      const extras = readBoxExtras(computed);
      const prevBodyCursor = document.body.style.cursor;
      const prevBodyUserSelect = document.body.style.userSelect;
      session = {
        pointerId: event.pointerId,
        dir,
        handleEl,
        target,
        mode,
        properties,
        tx: null,
        hasPassedThreshold: false,
        affectsWidth,
        affectsHeight,
        hasWest,
        hasNorth,
        // Snap state (Phase 4.2 & 4.3) - initialized to null, populated after threshold
        anchors: null,
        lockX: null,
        lockY: null,
        hadGuidesLastFrame: false,
        hadDistanceLabelsLastFrame: false,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        startRect: rect,
        startPosX,
        startPosY,
        absOrigin,
        extras,
        prevBodyCursor,
        prevBodyUserSelect
      };
      try {
        handleEl.setPointerCapture(event.pointerId);
      } catch (e) {
      }
      document.body.style.cursor = CURSOR_BY_DIR[dir];
      document.body.style.userSelect = "none";
      stopEvent(event);
      renderSelectionRect(rect);
      scheduleFrame();
    }
    function handlePointerMove(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      stopEvent(event);
      s.lastClientX = event.clientX;
      s.lastClientY = event.clientY;
      scheduleFrame();
    }
    function handlePointerUp(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      stopEvent(event);
      s.lastClientX = event.clientX;
      s.lastClientY = event.clientY;
      commitSession();
    }
    function handlePointerCancel(event) {
      const s = session;
      if (!s) return;
      if (event.pointerId !== s.pointerId) return;
      stopEvent(event);
      cancelSession(event.type);
    }
    function handleKeyDown(event) {
      if (!session) return;
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
      cancelSession("escape");
    }
    function handleWindowBlur() {
      if (!session) return;
      cancelSession("blur");
    }
    function handleVisibilityChange() {
      if (!session) return;
      if (document.visibilityState !== "visible") {
        cancelSession("visibilitychange");
      }
    }
    for (const [dir, el] of handleEls) {
      disposer.listen(el, "pointerdown", (event) => startResize(dir, el, event));
      disposer.listen(el, "pointermove", handlePointerMove);
      disposer.listen(el, "pointerup", handlePointerUp);
      disposer.listen(el, "pointercancel", handlePointerCancel);
      disposer.listen(el, "lostpointercapture", handlePointerCancel);
    }
    disposer.listen(document, "keydown", handleKeyDown, { capture: true });
    disposer.listen(window, "blur", handleWindowBlur);
    disposer.listen(document, "visibilitychange", handleVisibilityChange);
    function setTarget(target) {
      if (disposer.isDisposed) return;
      if (session) cancelSession("target_change");
      if (target instanceof HTMLElement && target.isConnected) {
        currentTarget = target;
      } else {
        currentTarget = null;
      }
      renderSelectionRect(currentSelectionRect);
    }
    function setSelectionRect(rect) {
      if (disposer.isDisposed) return;
      currentSelectionRect = isValidRect(rect) ? rect : null;
      if (!currentTarget || !currentTarget.isConnected) {
        frame.hidden = true;
        return;
      }
      if (session && !currentSelectionRect) {
        cancelSession("rect_lost");
        return;
      }
      if (!session) {
        renderSelectionRect(currentSelectionRect);
      }
    }
    function dispose() {
      cancelSession("dispose");
      currentTarget = null;
      currentSelectionRect = null;
      disposer.dispose();
    }
    renderSelectionRect(null);
    return { setTarget, setSelectionRect, dispose };
  }
  function isDocumentOrShadowRoot(value) {
    return value instanceof Document || value instanceof ShadowRoot;
  }
  function isDisallowedDragElement(element) {
    var _a2;
    const tag = (_a2 = element.tagName) == null ? void 0 : _a2.toUpperCase();
    return tag === "HTML" || tag === "BODY" || tag === "HEAD";
  }
  function toViewportRect$1(rect) {
    const { left, top, width, height } = rect;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    return {
      left,
      top,
      width: Math.max(0, width),
      height: Math.max(0, height)
    };
  }
  function getHitElementsFromRoot(root, clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return [];
    try {
      if (typeof root.elementsFromPoint === "function") {
        return root.elementsFromPoint(clientX, clientY);
      }
    } catch (e) {
    }
    try {
      const el = root.elementFromPoint(clientX, clientY);
      return el ? [el] : [];
    } catch (e) {
      return [];
    }
  }
  function getContainerAxis(parent) {
    try {
      const style = window.getComputedStyle(parent);
      const display = style.display;
      if (display === "grid" || display === "inline-grid") return null;
      if (display === "flex" || display === "inline-flex") {
        const wrap = style.flexWrap;
        if (wrap === "wrap" || wrap === "wrap-reverse") return null;
        const dir = style.flexDirection;
        switch (dir) {
          case "row":
            return { axis: "x", reverse: false };
          case "row-reverse":
            return { axis: "x", reverse: true };
          case "column":
            return { axis: "y", reverse: false };
          case "column-reverse":
            return { axis: "y", reverse: true };
          default:
            return { axis: "y", reverse: false };
        }
      }
      return { axis: "y", reverse: false };
    } catch (e) {
      return null;
    }
  }
  function chooseSideWithHysteresis(clientPos, rect, prevSide, axis, reverse) {
    const mid = axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
    const effectivePos = reverse ? -clientPos : clientPos;
    const effectiveMid = reverse ? -mid : mid;
    if (!prevSide) {
      return effectivePos < effectiveMid ? "before" : "after";
    }
    if (prevSide === "before") {
      return effectivePos > effectiveMid + WEB_EDITOR_V2_DRAG_HYSTERESIS_PX ? "after" : "before";
    }
    return effectivePos < effectiveMid - WEB_EDITOR_V2_DRAG_HYSTERESIS_PX ? "before" : "after";
  }
  function isNoopMove(draggedElement, parent, referenceNode) {
    if (draggedElement.parentNode !== parent) return false;
    if (referenceNode === draggedElement) return true;
    if (referenceNode === draggedElement.nextSibling) return true;
    if (referenceNode === null && draggedElement.nextSibling === null) return true;
    return false;
  }
  function isValidDropTarget(el, draggedElement, draggedRoot, isOverlayElement) {
    var _a2;
    if (!el.isConnected) return false;
    if (isOverlayElement(el)) return false;
    if (el === draggedElement) return false;
    if (isDisallowedDragElement(el)) return false;
    if (draggedElement.contains(el)) return false;
    if (!el.parentElement) return false;
    const root = (_a2 = el.getRootNode) == null ? void 0 : _a2.call(el);
    if (!isDocumentOrShadowRoot(root)) return false;
    if (root !== draggedRoot) return false;
    return true;
  }
  function createDragReorderController(options) {
    const disposer = new Disposer();
    const { canvasOverlay, isOverlayElement, positionTracker, transactionManager, uiRoot } = options;
    let state = null;
    let rafId = null;
    function cancelRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    disposer.add(cancelRaf);
    function setUiPointerEventsEnabled(enabled, s) {
      uiRoot.style.pointerEvents = enabled ? s.uiPointerEventsBefore : "none";
    }
    function clearVisuals() {
      canvasOverlay.setDragGhostRect(null);
      canvasOverlay.setInsertionLine(null);
      canvasOverlay.render();
    }
    function cleanup() {
      const s = state;
      if (!s) return;
      cancelRaf();
      setUiPointerEventsEnabled(true, s);
      clearVisuals();
      state = null;
    }
    function computeInsertPosition(s) {
      const hits = getHitElementsFromRoot(s.draggedRoot, s.lastClientX, s.lastClientY).slice(
        0,
        WEB_EDITOR_V2_DRAG_MAX_HIT_ELEMENTS
      );
      const target = hits.find(
        (el) => isValidDropTarget(el, s.draggedElement, s.draggedRoot, isOverlayElement)
      );
      if (!target) return null;
      const parent = target.parentElement;
      if (!parent) return null;
      const container = getContainerAxis(parent);
      if (!container) return null;
      let rect;
      try {
        rect = target.getBoundingClientRect();
      } catch (e) {
        return null;
      }
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0.5 || rect.height <= 0.5) {
        return null;
      }
      const prevSide = s.preview && s.preview.target === target ? s.preview.side : null;
      const clientPos = container.axis === "x" ? s.lastClientX : s.lastClientY;
      const side = chooseSideWithHysteresis(
        clientPos,
        rect,
        prevSide,
        container.axis,
        container.reverse
      );
      const referenceNode = side === "before" ? target : target.nextSibling;
      const noop = isNoopMove(s.draggedElement, parent, referenceNode);
      let indicatorLine;
      if (container.axis === "x") {
        const beforeX = container.reverse ? rect.left + rect.width : rect.left;
        const afterX = container.reverse ? rect.left : rect.left + rect.width;
        const x = side === "before" ? beforeX : afterX;
        indicatorLine = {
          x1: x,
          y1: rect.top,
          x2: x,
          y2: rect.top + rect.height
        };
      } else {
        const beforeY = container.reverse ? rect.top + rect.height : rect.top;
        const afterY = container.reverse ? rect.top : rect.top + rect.height;
        const y = side === "before" ? beforeY : afterY;
        indicatorLine = {
          x1: rect.left,
          y1: y,
          x2: rect.left + rect.width,
          y2: y
        };
      }
      return { target, parent, side, referenceNode, isNoop: noop, indicatorLine };
    }
    function updateFrame() {
      var _a2, _b2;
      rafId = null;
      const s = state;
      if (!s) return;
      if (!s.draggedElement.isConnected) {
        s.moveHandle.cancel();
        cleanup();
        return;
      }
      const ghostRect = {
        left: s.lastClientX - s.pointerOffsetX,
        top: s.lastClientY - s.pointerOffsetY,
        width: s.startRect.width,
        height: s.startRect.height
      };
      s.preview = computeInsertPosition(s);
      canvasOverlay.setDragGhostRect(ghostRect);
      canvasOverlay.setInsertionLine((_b2 = (_a2 = s.preview) == null ? void 0 : _a2.indicatorLine) != null ? _b2 : null);
      canvasOverlay.render();
    }
    function scheduleUpdate() {
      if (disposer.isDisposed) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(updateFrame);
    }
    function applyDomMove(draggedElement, insert) {
      var _a2, _b2;
      const parent = insert.parent;
      if (!parent.isConnected) return false;
      if (draggedElement === parent) return false;
      if (draggedElement.contains(parent)) return false;
      const rootA = (_a2 = draggedElement.getRootNode) == null ? void 0 : _a2.call(draggedElement);
      const rootB = (_b2 = parent.getRootNode) == null ? void 0 : _b2.call(parent);
      if (!isDocumentOrShadowRoot(rootA) || !isDocumentOrShadowRoot(rootB) || rootA !== rootB) {
        return false;
      }
      if (!insert.target.isConnected) return false;
      if (insert.target.parentElement !== parent) return false;
      const ref = insert.side === "before" ? insert.target : insert.target.nextSibling;
      if (isNoopMove(draggedElement, parent, ref)) return true;
      try {
        parent.insertBefore(draggedElement, ref);
        return true;
      } catch (error) {
        console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} DOM move failed:`, error);
        return false;
      }
    }
    function onDragStart(ev) {
      var _a2;
      if (disposer.isDisposed) return false;
      if (state) {
        state.moveHandle.cancel();
        cleanup();
      }
      const draggedElement = ev.draggedElement;
      if (!draggedElement || !(draggedElement instanceof Element)) return false;
      if (!draggedElement.isConnected) return false;
      if (isDisallowedDragElement(draggedElement)) return false;
      const rawRoot = (_a2 = draggedElement.getRootNode) == null ? void 0 : _a2.call(draggedElement);
      const draggedRoot = isDocumentOrShadowRoot(rawRoot) ? rawRoot : document;
      let rect;
      try {
        rect = draggedElement.getBoundingClientRect();
      } catch (e) {
        return false;
      }
      const startRect = toViewportRect$1(rect);
      if (!startRect || startRect.width <= 0.5 || startRect.height <= 0.5) return false;
      const moveHandle = transactionManager.beginMove(draggedElement);
      if (!moveHandle) return false;
      const prevPointerEvents = uiRoot.style.pointerEvents;
      state = {
        pointerId: ev.pointerId,
        draggedElement,
        draggedRoot,
        startRect,
        pointerOffsetX: ev.startClientX - startRect.left,
        pointerOffsetY: ev.startClientY - startRect.top,
        lastClientX: ev.clientX,
        lastClientY: ev.clientY,
        preview: null,
        uiPointerEventsBefore: prevPointerEvents,
        moveHandle
      };
      setUiPointerEventsEnabled(false, state);
      scheduleUpdate();
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Drag started`);
      return true;
    }
    function onDragMove(ev) {
      const s = state;
      if (!s) return;
      if (ev.pointerId !== s.pointerId) return;
      s.lastClientX = ev.clientX;
      s.lastClientY = ev.clientY;
      scheduleUpdate();
    }
    function onDragEnd(ev) {
      const s = state;
      if (!s) return;
      if (ev.pointerId !== s.pointerId) return;
      s.lastClientX = ev.clientX;
      s.lastClientY = ev.clientY;
      cancelRaf();
      const insert = computeInsertPosition(s);
      if (!insert || insert.isNoop) {
        s.moveHandle.cancel();
        cleanup();
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Drag cancelled (no-op or no target)`);
        return;
      }
      const ok = applyDomMove(s.draggedElement, insert);
      if (!ok) {
        s.moveHandle.cancel();
        cleanup();
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Drag failed (DOM move error)`);
        return;
      }
      s.moveHandle.commit(s.draggedElement);
      positionTracker.forceUpdate();
      cleanup();
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Drag completed`);
    }
    function onDragCancel(_ev) {
      const s = state;
      if (!s) return;
      s.moveHandle.cancel();
      cleanup();
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Drag cancelled`);
    }
    disposer.add(() => {
      const s = state;
      if (!s) return;
      s.moveHandle.cancel();
      cleanup();
    });
    return {
      onDragStart,
      onDragMove,
      onDragEnd,
      onDragCancel,
      dispose: () => disposer.dispose()
    };
  }
  const CAPTURE_OPTIONS = {
    capture: true,
    passive: false
  };
  const BLOCKED_POINTER_EVENTS = [
    "pointerup",
    "pointercancel",
    "pointerover",
    "pointerout",
    "pointerenter",
    "pointerleave"
  ];
  const BLOCKED_MOUSE_EVENTS = [
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "auxclick",
    "mouseover",
    "mouseout",
    "mouseenter",
    "mouseleave"
  ];
  const BLOCKED_KEYBOARD_EVENTS = ["keyup", "keypress"];
  const BLOCKED_TOUCH_EVENTS = ["touchstart", "touchmove", "touchend", "touchcancel"];
  function createEventController(options) {
    const {
      isOverlayElement,
      onHover,
      onSelect,
      onDeselect,
      onStartEdit,
      findTargetForSelect,
      getSelectedElement,
      onStartDrag,
      onDragMove,
      onDragEnd,
      onDragCancel
    } = options;
    const disposer = new Disposer();
    const hasPointerEvents = typeof PointerEvent !== "undefined";
    let mode = "hover";
    let lastHoveredElement = null;
    let editingElement = null;
    let dragCandidate = null;
    let draggingPointerId = null;
    let draggingIsPointerOrigin = false;
    let suppressModeChangeDragCancel = false;
    let hasPointerPosition = false;
    let lastClientX = 0;
    let lastClientY = 0;
    let hoverRafId = null;
    function isEventFromEditorUi(event) {
      try {
        if (typeof event.composedPath === "function") {
          return event.composedPath().some((node) => isOverlayElement(node));
        }
      } catch (e) {
      }
      return isOverlayElement(event.target);
    }
    function isEventFromEditingElement(event) {
      const el = editingElement;
      if (!el) return false;
      try {
        if (typeof event.composedPath === "function") {
          return event.composedPath().some((node) => node === el);
        }
      } catch (e) {
      }
      const target = event.target;
      return target instanceof Node && el.contains(target);
    }
    function blockPageEvent(event) {
      if (event.cancelable) {
        event.preventDefault();
      }
      event.stopImmediatePropagation();
      event.stopPropagation();
    }
    function extractModifiers(event) {
      return {
        alt: event.altKey,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        meta: event.metaKey
      };
    }
    function getEventPointerId(event) {
      return event instanceof PointerEvent ? event.pointerId : 0;
    }
    function shouldProcessAsPrimaryPointer(event) {
      if (hasPointerEvents && !(event instanceof PointerEvent)) return false;
      return true;
    }
    function isEventWithinElement(event, element) {
      try {
        if (typeof event.composedPath === "function") {
          return event.composedPath().some((node) => node === element);
        }
      } catch (e) {
      }
      const target = event.target;
      return target instanceof Node && element.contains(target);
    }
    function clearDragState() {
      dragCandidate = null;
      draggingPointerId = null;
      draggingIsPointerOrigin = false;
    }
    function cancelDragging(reason) {
      if (mode !== "dragging") return;
      clearDragState();
      try {
        onDragCancel == null ? void 0 : onDragCancel({ reason });
      } catch (e) {
      }
      suppressModeChangeDragCancel = true;
      setMode("selecting");
    }
    function endDragging(pointerId, clientX, clientY) {
      if (mode !== "dragging") return;
      if (draggingPointerId === null || draggingPointerId !== pointerId) return;
      clearDragState();
      try {
        onDragEnd == null ? void 0 : onDragEnd({ pointerId, clientX, clientY });
      } catch (e) {
      }
      suppressModeChangeDragCancel = true;
      setMode("selecting");
    }
    function getTargetElementAtFast(clientX, clientY) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return null;
      }
      const element = document.elementFromPoint(clientX, clientY);
      if (!element) return null;
      if (isOverlayElement(element)) return null;
      return element;
    }
    function getTargetElementForSelection(event, clientX, clientY, modifiers) {
      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        return null;
      }
      if (findTargetForSelect) {
        const target = findTargetForSelect(clientX, clientY, modifiers, event);
        if (target && isOverlayElement(target)) return null;
        return target;
      }
      return getTargetElementAtFast(clientX, clientY);
    }
    function cancelHoverRaf() {
      if (hoverRafId !== null) {
        cancelAnimationFrame(hoverRafId);
        hoverRafId = null;
      }
    }
    disposer.add(cancelHoverRaf);
    function commitHoverUpdate(forceUpdate = false) {
      hoverRafId = null;
      if (disposer.isDisposed) return;
      if (mode !== "hover" && mode !== "selecting") return;
      if (!hasPointerPosition) return;
      const nextElement = getTargetElementAtFast(lastClientX, lastClientY);
      if (!forceUpdate && nextElement === lastHoveredElement) return;
      lastHoveredElement = nextElement;
      onHover(nextElement);
    }
    function scheduleHoverUpdate(forceUpdate = false) {
      if (hoverRafId !== null) return;
      if (disposer.isDisposed) return;
      hoverRafId = requestAnimationFrame(() => {
        commitHoverUpdate(forceUpdate);
      });
    }
    function setMode(nextMode) {
      if (disposer.isDisposed) return;
      if (mode === nextMode) return;
      const prevMode = mode;
      mode = nextMode;
      if (prevMode === "editing" && nextMode !== "editing") {
        editingElement = null;
      }
      if (prevMode === "selecting" && nextMode !== "selecting") {
        dragCandidate = null;
      }
      if (prevMode === "dragging" && nextMode !== "dragging") {
        const shouldNotify = !suppressModeChangeDragCancel;
        suppressModeChangeDragCancel = false;
        clearDragState();
        if (shouldNotify) {
          try {
            onDragCancel == null ? void 0 : onDragCancel({ reason: "mode_change" });
          } catch (e) {
          }
        }
      } else {
        suppressModeChangeDragCancel = false;
      }
      if (prevMode === "hover" && nextMode !== "hover") {
        cancelHoverRaf();
        lastHoveredElement = null;
      }
      if (nextMode === "hover" && prevMode !== "hover") {
        lastHoveredElement = null;
        clearDragState();
        onDeselect();
        if (hasPointerPosition) {
          scheduleHoverUpdate(true);
        }
      }
    }
    function handlePointerMove(event) {
      var _a2;
      if (mode === "editing" && isEventFromEditingElement(event)) {
        return;
      }
      if (isEventFromEditorUi(event)) {
        if (mode === "hover" && lastHoveredElement !== null) {
          lastHoveredElement = null;
          onHover(null);
        }
        return;
      }
      blockPageEvent(event);
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      hasPointerPosition = true;
      if (mode === "dragging" && shouldProcessAsPrimaryPointer(event)) {
        const pointerId = getEventPointerId(event);
        const isPointerEvent = event instanceof PointerEvent;
        if (draggingIsPointerOrigin !== isPointerEvent) return;
        if (draggingPointerId !== null && pointerId === draggingPointerId) {
          onDragMove == null ? void 0 : onDragMove({ pointerId, clientX: event.clientX, clientY: event.clientY });
        }
        return;
      }
      if (mode === "selecting" && dragCandidate && shouldProcessAsPrimaryPointer(event)) {
        const pointerId = getEventPointerId(event);
        if (pointerId !== dragCandidate.pointerId) return;
        const isPointerEvent = event instanceof PointerEvent;
        if (dragCandidate.isPointerEventOrigin !== isPointerEvent) return;
        const dx = event.clientX - dragCandidate.startClientX;
        const dy = event.clientY - dragCandidate.startClientY;
        if (Math.hypot(dx, dy) < WEB_EDITOR_V2_DRAG_THRESHOLD_PX) return;
        const startEvent = {
          pointerId,
          draggedElement: dragCandidate.selectedElement,
          startClientX: dragCandidate.startClientX,
          startClientY: dragCandidate.startClientY,
          clientX: event.clientX,
          clientY: event.clientY,
          modifiers: dragCandidate.modifiers
        };
        const wasPointerOrigin = dragCandidate.isPointerEventOrigin;
        dragCandidate = null;
        const started = (_a2 = onStartDrag == null ? void 0 : onStartDrag(startEvent)) != null ? _a2 : false;
        if (!started) return;
        draggingPointerId = pointerId;
        draggingIsPointerOrigin = wasPointerOrigin;
        setMode("dragging");
        onDragMove == null ? void 0 : onDragMove({ pointerId, clientX: event.clientX, clientY: event.clientY });
        return;
      }
      if (mode !== "hover" && mode !== "selecting") return;
      scheduleHoverUpdate();
    }
    function handlePointerDown(event) {
      var _a2;
      if (mode === "editing" && isEventFromEditingElement(event)) return;
      if (isEventFromEditorUi(event)) return;
      blockPageEvent(event);
      lastClientX = event.clientX;
      lastClientY = event.clientY;
      hasPointerPosition = true;
      if (event.button !== 0) return;
      const modifiers = extractModifiers(event);
      if (mode === "selecting") {
        if (!shouldProcessAsPrimaryPointer(event)) return;
        const selected = (_a2 = getSelectedElement == null ? void 0 : getSelectedElement()) != null ? _a2 : null;
        const target2 = getTargetElementForSelection(event, event.clientX, event.clientY, modifiers);
        if (target2 && target2 !== selected) {
          dragCandidate = null;
          onSelect(target2, modifiers);
          return;
        }
        if (onStartDrag && selected && selected.isConnected && isEventWithinElement(event, selected)) {
          const isPointerOrigin = event instanceof PointerEvent;
          dragCandidate = {
            pointerId: getEventPointerId(event),
            startClientX: event.clientX,
            startClientY: event.clientY,
            modifiers,
            selectedElement: selected,
            isPointerEventOrigin: isPointerOrigin
          };
        }
        return;
      }
      if (mode === "dragging") {
        return;
      }
      if (mode === "editing") {
        const target2 = getTargetElementForSelection(event, event.clientX, event.clientY, modifiers);
        setMode("selecting");
        if (target2) {
          onSelect(target2, modifiers);
        }
        return;
      }
      if (mode !== "hover") return;
      const target = getTargetElementForSelection(event, event.clientX, event.clientY, modifiers);
      if (!target) return;
      setMode("selecting");
      onSelect(target, modifiers);
    }
    function handleDoubleClick(event) {
      if (mode === "editing" && isEventFromEditingElement(event)) {
        return;
      }
      if (isEventFromEditorUi(event)) return;
      blockPageEvent(event);
      if (event.button !== 0) return;
      if (!onStartEdit) return;
      const modifiers = extractModifiers(event);
      const target = getTargetElementForSelection(event, event.clientX, event.clientY, modifiers);
      if (!target) return;
      const started = onStartEdit(target, modifiers);
      if (!started) return;
      editingElement = target;
      setMode("editing");
    }
    function handleKeyDown(event) {
      if (mode === "editing" && isEventFromEditingElement(event)) {
        return;
      }
      if (isEventFromEditorUi(event)) return;
      blockPageEvent(event);
      if (event.key === "Escape") {
        if (mode === "dragging") {
          cancelDragging("escape");
          return;
        }
        if (mode === "selecting") {
          dragCandidate = null;
          setMode("hover");
        }
      }
    }
    function handlePointerUp(event) {
      if (mode === "editing" && isEventFromEditingElement(event)) return;
      if (isEventFromEditorUi(event)) return;
      blockPageEvent(event);
      if (!shouldProcessAsPrimaryPointer(event)) {
        return;
      }
      const pointerId = getEventPointerId(event);
      const isPointerEvent = event instanceof PointerEvent;
      if (mode === "selecting" && dragCandidate && dragCandidate.pointerId === pointerId && dragCandidate.isPointerEventOrigin === isPointerEvent) {
        dragCandidate = null;
      }
      if (mode === "dragging" && draggingIsPointerOrigin === isPointerEvent) {
        endDragging(pointerId, event.clientX, event.clientY);
      }
    }
    function handlePointerCancel(event) {
      if (mode === "editing" && isEventFromEditingElement(event)) return;
      if (isEventFromEditorUi(event)) return;
      blockPageEvent(event);
      const pointerId = event.pointerId;
      if (dragCandidate && dragCandidate.pointerId === pointerId && dragCandidate.isPointerEventOrigin) {
        dragCandidate = null;
      }
      if (mode !== "dragging") return;
      if (!draggingIsPointerOrigin) return;
      if (draggingPointerId === null || draggingPointerId !== pointerId) return;
      cancelDragging("pointercancel");
    }
    function handleBlockedEvent(event) {
      if (isEventFromEditorUi(event)) return;
      if (mode === "editing" && isEventFromEditingElement(event)) return;
      if (event.type === "dblclick") {
        handleDoubleClick(event);
        return;
      }
      if (event.type === "pointerup" || event.type === "mouseup") {
        handlePointerUp(event);
        return;
      }
      if (event.type === "pointercancel") {
        handlePointerCancel(event);
        return;
      }
      blockPageEvent(event);
    }
    if (hasPointerEvents) {
      disposer.listen(document, "pointermove", handlePointerMove, CAPTURE_OPTIONS);
      disposer.listen(document, "pointerdown", handlePointerDown, CAPTURE_OPTIONS);
      for (const eventType of BLOCKED_POINTER_EVENTS) {
        disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
      }
    }
    disposer.listen(document, "mousemove", handlePointerMove, CAPTURE_OPTIONS);
    disposer.listen(document, "mousedown", handlePointerDown, CAPTURE_OPTIONS);
    for (const eventType of BLOCKED_MOUSE_EVENTS) {
      disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
    }
    disposer.listen(document, "keydown", handleKeyDown, CAPTURE_OPTIONS);
    for (const eventType of BLOCKED_KEYBOARD_EVENTS) {
      disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
    }
    for (const eventType of BLOCKED_TOUCH_EVENTS) {
      disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
    }
    function handleWindowBlur() {
      if (mode === "selecting" && dragCandidate) {
        dragCandidate = null;
      }
      if (mode === "dragging") {
        cancelDragging("blur");
      }
    }
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        if (mode === "selecting" && dragCandidate) {
          dragCandidate = null;
        }
        if (mode === "dragging") {
          cancelDragging("visibilitychange");
        }
      }
    }
    disposer.listen(window, "blur", handleWindowBlur);
    disposer.listen(document, "visibilitychange", handleVisibilityChange);
    disposer.add(() => {
      if (mode === "dragging") {
        try {
          onDragCancel == null ? void 0 : onDragCancel({ reason: "dispose" });
        } catch (e) {
        }
      }
      clearDragState();
    });
    return {
      getMode: () => mode,
      setMode,
      dispose: () => disposer.dispose()
    };
  }
  const PASSIVE_LISTENER = { passive: true };
  const RECT_EPSILON$1 = 0.5;
  const SELECTION_MUTATION_OPTIONS = {
    childList: true,
    subtree: true
  };
  function toViewportRect(domRect) {
    const { left, top, width, height } = domRect;
    if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
      return null;
    }
    return {
      left,
      top,
      width: Math.max(0, width),
      height: Math.max(0, height)
    };
  }
  function approximatelyEqual$1(a, b) {
    return Math.abs(a - b) < RECT_EPSILON$1;
  }
  function rectApproximatelyEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return approximatelyEqual$1(a.left, b.left) && approximatelyEqual$1(a.top, b.top) && approximatelyEqual$1(a.width, b.width) && approximatelyEqual$1(a.height, b.height);
  }
  function trackedRectsEqual(a, b) {
    return rectApproximatelyEqual(a.hover, b.hover) && rectApproximatelyEqual(a.selection, b.selection);
  }
  function createPositionTracker(options) {
    const { onPositionUpdate } = options;
    const disposer = new Disposer();
    let hoverElement = null;
    let selectionElement = null;
    let lastRects = { hover: null, selection: null };
    let rafId = null;
    function cancelRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    disposer.add(cancelRaf);
    function scheduleUpdate() {
      if (disposer.isDisposed) return;
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateIfChanged();
      });
    }
    let selectionObservers = new Disposer();
    disposer.add(() => selectionObservers.dispose());
    function resetSelectionObservers() {
      var _a2, _b2;
      selectionObservers.dispose();
      selectionObservers = new Disposer();
      const target = selectionElement;
      if (!target) return;
      selectionObservers.observeResize(target, () => {
        if (disposer.isDisposed) return;
        if (selectionElement !== target) return;
        scheduleUpdate();
      });
      const mutationCallback = () => {
        if (disposer.isDisposed) return;
        if (selectionElement !== target) return;
        scheduleUpdate();
      };
      const rootNode = (_a2 = target.getRootNode) == null ? void 0 : _a2.call(target);
      if (rootNode instanceof ShadowRoot) {
        selectionObservers.observeMutation(rootNode, mutationCallback, SELECTION_MUTATION_OPTIONS);
      }
      const body = (_b2 = document.body) != null ? _b2 : document.documentElement;
      if (body) {
        selectionObservers.observeMutation(body, mutationCallback, SELECTION_MUTATION_OPTIONS);
      }
    }
    function resolveConnected(element) {
      if (!element) return null;
      return element.isConnected ? element : null;
    }
    function readElementRect2(element) {
      if (!element) return null;
      try {
        return toViewportRect(element.getBoundingClientRect());
      } catch (e) {
        return null;
      }
    }
    function computeRects() {
      const resolvedHover = resolveConnected(hoverElement);
      const resolvedSelection = resolveConnected(selectionElement);
      if (hoverElement && !resolvedHover) {
        hoverElement = null;
      }
      if (selectionElement && !resolvedSelection) {
        selectionElement = null;
        resetSelectionObservers();
      }
      if (resolvedHover && resolvedSelection && resolvedHover === resolvedSelection) {
        const rect = readElementRect2(resolvedHover);
        return { hover: rect, selection: rect };
      }
      return {
        hover: readElementRect2(resolvedHover),
        selection: readElementRect2(resolvedSelection)
      };
    }
    function updateIfChanged() {
      if (disposer.isDisposed) return;
      const nextRects = computeRects();
      if (trackedRectsEqual(nextRects, lastRects)) return;
      lastRects = nextRects;
      onPositionUpdate(nextRects);
    }
    function handleViewportChange() {
      if (!hoverElement && !selectionElement && !lastRects.hover && !lastRects.selection) {
        return;
      }
      scheduleUpdate();
    }
    disposer.listen(window, "scroll", handleViewportChange, PASSIVE_LISTENER);
    disposer.listen(document, "scroll", handleViewportChange, __spreadProps(__spreadValues({}, PASSIVE_LISTENER), { capture: true }));
    disposer.listen(window, "resize", handleViewportChange, PASSIVE_LISTENER);
    function setHoverElement(element) {
      if (disposer.isDisposed) return;
      if (hoverElement === element) return;
      hoverElement = element;
      scheduleUpdate();
    }
    function setSelectionElement(element) {
      if (disposer.isDisposed) return;
      if (selectionElement === element) return;
      selectionElement = element;
      resetSelectionObservers();
      scheduleUpdate();
    }
    function forceUpdate() {
      if (disposer.isDisposed) return;
      cancelRaf();
      updateIfChanged();
    }
    return {
      setHoverElement,
      setSelectionElement,
      forceUpdate,
      dispose: () => disposer.dispose()
    };
  }
  const MAX_HIT_ELEMENTS = 8;
  const MAX_ANCESTOR_DEPTH = 6;
  const MAX_CANDIDATES = 60;
  const RECT_EPSILON = 0.5;
  const INTERACTIVE_TAGS = /* @__PURE__ */ new Set([
    "A",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "LABEL",
    "SUMMARY",
    "DETAILS"
  ]);
  const INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "option",
    "combobox",
    "textbox"
  ]);
  const WRAPPER_TAGS = /* @__PURE__ */ new Set([
    "DIV",
    "SPAN",
    "SECTION",
    "ARTICLE",
    "MAIN",
    "HEADER",
    "FOOTER",
    "NAV",
    "ASIDE"
  ]);
  function parseNumber(value) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }
  function isTransparentColor(value) {
    const v = value.trim().toLowerCase();
    if (v === "transparent") return true;
    const rgba = v.match(/^rgba?\((.+)\)$/);
    if (rgba) {
      const parts = rgba[1].split(",").map((p) => p.trim());
      if (parts.length >= 4) {
        const alpha = Number.parseFloat(parts[3]);
        return Number.isFinite(alpha) && alpha <= 0.01;
      }
      return false;
    }
    const hsla = v.match(/^hsla?\((.+)\)$/);
    if (hsla) {
      const parts = hsla[1].split(",").map((p) => p.trim());
      if (parts.length >= 4) {
        const alpha = Number.parseFloat(parts[3]);
        return Number.isFinite(alpha) && alpha <= 0.01;
      }
      return false;
    }
    return false;
  }
  function hasDirectNonWhitespaceText(element) {
    var _a2;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && ((_a2 = node.textContent) == null ? void 0 : _a2.trim())) {
        return true;
      }
    }
    return false;
  }
  function getParentElementOrHost(element) {
    var _a2;
    if (element.parentElement) return element.parentElement;
    try {
      const root = (_a2 = element.getRootNode) == null ? void 0 : _a2.call(element);
      if (root instanceof ShadowRoot) {
        return root.host;
      }
    } catch (e) {
    }
    return null;
  }
  function getHitElementsAtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    try {
      if (typeof document.elementsFromPoint === "function") {
        return document.elementsFromPoint(x, y);
      }
    } catch (e) {
    }
    const el = document.elementFromPoint(x, y);
    return el ? [el] : [];
  }
  function getViewportArea() {
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);
    return w * h;
  }
  function readRect(element) {
    try {
      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top)) return null;
      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
      return rect;
    } catch (e) {
      return null;
    }
  }
  function isEffectivelyInvisible(style, rect) {
    if (style.display === "none") return true;
    if (style.visibility === "hidden" || style.visibility === "collapse") return true;
    if (parseNumber(style.opacity) <= 0.01) return true;
    const contentVisibility = style.contentVisibility;
    if (contentVisibility === "hidden") return true;
    if (rect.width <= RECT_EPSILON || rect.height <= RECT_EPSILON) return true;
    return false;
  }
  function getVisualBoundaryScore(element, style) {
    let points = 0;
    const reasons = [];
    if (!isTransparentColor(style.backgroundColor) || style.backgroundImage !== "none") {
      points += 2;
      reasons.push("visual:background:+2");
    }
    const borderWidths = [
      parseNumber(style.borderTopWidth),
      parseNumber(style.borderRightWidth),
      parseNumber(style.borderBottomWidth),
      parseNumber(style.borderLeftWidth)
    ];
    const hasBorder = borderWidths.some((w) => w > RECT_EPSILON) && (style.borderTopStyle !== "none" || style.borderRightStyle !== "none" || style.borderBottomStyle !== "none" || style.borderLeftStyle !== "none");
    if (hasBorder) {
      points += 3;
      reasons.push("visual:border:+3");
    }
    if (style.boxShadow && style.boxShadow !== "none") {
      points += 2;
      reasons.push("visual:shadow:+2");
    }
    if (style.outlineStyle !== "none" && parseNumber(style.outlineWidth) > RECT_EPSILON) {
      points += 1;
      reasons.push("visual:outline:+1");
    }
    const tag = element.tagName.toUpperCase();
    if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "SVG") {
      points += 2;
      reasons.push("visual:media:+2");
    }
    if (element instanceof SVGElement && tag !== "SVG") {
      points -= 1;
      reasons.push("visual:svg-sub:-1");
    }
    return { points, reasons };
  }
  function getInteractivityScore(element, style) {
    var _a2, _b2;
    let points = 0;
    const reasons = [];
    const tag = element.tagName.toUpperCase();
    if (INTERACTIVE_TAGS.has(tag)) {
      points += 6;
      reasons.push(`type:${tag.toLowerCase()}:+6`);
    }
    const role = (_b2 = (_a2 = element.getAttribute("role")) == null ? void 0 : _a2.toLowerCase()) != null ? _b2 : "";
    if (role && INTERACTIVE_ROLES.has(role)) {
      points += 4;
      reasons.push(`role:${role}:+4`);
    }
    if (element instanceof HTMLAnchorElement && element.href) {
      points += 2;
      reasons.push("attr:href:+2");
    }
    if (element instanceof HTMLElement) {
      if (element.isContentEditable) {
        points += 5;
        reasons.push("attr:contenteditable:+5");
      }
      if (element.tabIndex >= 0) {
        points += 2;
        reasons.push("focusable:+2");
      }
    }
    if (style.cursor === "pointer") {
      points += 2;
      reasons.push("cursor:pointer:+2");
    }
    return { points, reasons };
  }
  function getSizeScore(rect, viewportArea) {
    let points = 0;
    const reasons = [];
    const area = rect.width * rect.height;
    if (!Number.isFinite(area) || area <= 0) {
      points -= 6;
      reasons.push("size:invalid:-6");
      return { points, reasons };
    }
    if (rect.width < 4 || rect.height < 4) {
      points -= 6;
      reasons.push("size:tiny:-6");
    } else if (area < 16 * 16) {
      points -= 4;
      reasons.push("size:small:-4");
    } else if (area < 44 * 44) {
      points -= 1;
      reasons.push("size:below-tap-target:-1");
    }
    const ratio = viewportArea > 0 ? area / viewportArea : 0;
    if (ratio > 0.85) {
      points -= 8;
      reasons.push("size:huge:-8");
    } else if (ratio > 0.6) {
      points -= 4;
      reasons.push("size:very-large:-4");
    }
    return { points, reasons };
  }
  function hasMeaningfulPadding(style) {
    return parseNumber(style.paddingTop) > RECT_EPSILON || parseNumber(style.paddingRight) > RECT_EPSILON || parseNumber(style.paddingBottom) > RECT_EPSILON || parseNumber(style.paddingLeft) > RECT_EPSILON;
  }
  function isWrapperOnly(element, style, visualScore, interactivityScore) {
    if (style.display === "contents") return true;
    if (interactivityScore > 0) return false;
    const tag = element.tagName.toUpperCase();
    if (!WRAPPER_TAGS.has(tag)) return false;
    if (element.children.length !== 1) return false;
    if (hasDirectNonWhitespaceText(element)) return false;
    if (visualScore > 0) return false;
    if (hasMeaningfulPadding(style)) return false;
    return true;
  }
  function compareMeta(a, b) {
    if (a.hitOrder !== b.hitOrder) return a.hitOrder - b.hitOrder;
    return a.depthFromHit - b.depthFromHit;
  }
  function createSelectionEngine(options) {
    const disposer = new Disposer();
    const { isOverlayElement } = options;
    function scoreElement(element, styleCache, viewportArea) {
      if (!element.isConnected) return null;
      if (isOverlayElement(element)) return null;
      const tag = element.tagName.toUpperCase();
      if (tag === "HTML" || tag === "BODY") return null;
      const rect = readRect(element);
      if (!rect) return null;
      let style = styleCache.get(element);
      if (!style) {
        style = window.getComputedStyle(element);
        styleCache.set(element, style);
      }
      if (isEffectivelyInvisible(style, rect)) return null;
      const reasons = [];
      let score = 0;
      const interactivity = getInteractivityScore(element, style);
      score += interactivity.points;
      reasons.push(...interactivity.reasons);
      const visual = getVisualBoundaryScore(element, style);
      score += visual.points;
      reasons.push(...visual.reasons);
      const size = getSizeScore(rect, viewportArea);
      score += size.points;
      reasons.push(...size.reasons);
      const wrapperOnly = isWrapperOnly(element, style, visual.points, interactivity.points);
      if (wrapperOnly) {
        score -= 8;
        reasons.push("wrapperOnly:-8");
      }
      if (tag === "SPAN" && interactivity.points === 0 && visual.points === 0) {
        score -= 2;
        reasons.push("inline:span:-2");
      }
      const area = rect.width * rect.height;
      const ratio = viewportArea > 0 ? area / viewportArea : 0;
      if (style.position === "fixed" && ratio > 0.3) {
        score -= 2;
        reasons.push("position:fixed-large:-2");
      }
      return { element, score, reasons, wrapperOnly };
    }
    function getCandidatesAtPoint(x, y) {
      const hit = getHitElementsAtPoint(x, y);
      if (hit.length === 0) return [];
      const map = /* @__PURE__ */ new Map();
      function addCandidate(element, meta) {
        if (isOverlayElement(element)) return;
        if (map.size >= MAX_CANDIDATES && !map.has(element)) return;
        const prev = map.get(element);
        if (!prev || compareMeta(meta, prev) < 0) {
          map.set(element, meta);
        }
      }
      const limit = Math.min(hit.length, MAX_HIT_ELEMENTS);
      for (let i = 0; i < limit; i++) {
        const el = hit[i];
        addCandidate(el, { hitOrder: i, depthFromHit: 0 });
        let current = el;
        for (let depth = 1; depth <= MAX_ANCESTOR_DEPTH; depth++) {
          current = current ? getParentElementOrHost(current) : null;
          if (!current) break;
          addCandidate(current, { hitOrder: i, depthFromHit: depth });
        }
      }
      const viewportArea = getViewportArea();
      const styleCache = /* @__PURE__ */ new Map();
      const scored = [];
      for (const [element, meta] of map) {
        const candidate = scoreElement(element, styleCache, viewportArea);
        if (!candidate) continue;
        scored.push(__spreadValues(__spreadValues({}, candidate), meta));
      }
      scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return compareMeta(a, b);
      });
      return scored.map((_a2) => {
        var _b2 = _a2, { hitOrder: _, depthFromHit: __ } = _b2, c = __objRest(_b2, ["hitOrder", "depthFromHit"]);
        return c;
      });
    }
    function getParentCandidate(current) {
      let parent = getParentElementOrHost(current);
      if (!parent) return null;
      const styleCache = /* @__PURE__ */ new Map();
      while (parent) {
        if (isOverlayElement(parent)) return null;
        const tag = parent.tagName.toUpperCase();
        if (tag === "HTML" || tag === "BODY") return null;
        const rect = readRect(parent);
        if (!rect) {
          parent = getParentElementOrHost(parent);
          continue;
        }
        let style = styleCache.get(parent);
        if (!style) {
          style = window.getComputedStyle(parent);
          styleCache.set(parent, style);
        }
        if (isEffectivelyInvisible(style, rect)) {
          parent = getParentElementOrHost(parent);
          continue;
        }
        const interactivity = getInteractivityScore(parent, style);
        const visual = getVisualBoundaryScore(parent, style);
        if (!isWrapperOnly(parent, style, visual.points, interactivity.points)) {
          return parent;
        }
        parent = getParentElementOrHost(parent);
      }
      return null;
    }
    function findBestTarget(x, y, modifiers) {
      var _a2, _b2, _c;
      const candidates = getCandidatesAtPoint(x, y);
      const best = (_b2 = (_a2 = candidates[0]) == null ? void 0 : _a2.element) != null ? _b2 : null;
      if (!best) return null;
      if (modifiers.alt) {
        return (_c = getParentCandidate(best)) != null ? _c : best;
      }
      return best;
    }
    function getComposedPathElements(event) {
      try {
        const path = typeof event.composedPath === "function" ? event.composedPath() : null;
        if (!Array.isArray(path) || path.length === 0) return [];
        const elements = [];
        for (const node of path) {
          if (!(node instanceof Element)) continue;
          if (isOverlayElement(node)) continue;
          const tag = node.tagName.toUpperCase();
          if (tag === "HTML" || tag === "BODY") continue;
          elements.push(node);
        }
        return elements;
      } catch (e) {
        return [];
      }
    }
    function extractClientPoint(event) {
      const e = event;
      const x = typeof e.clientX === "number" ? e.clientX : Number.NaN;
      const y = typeof e.clientY === "number" ? e.clientY : Number.NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    }
    const MAX_INNERMOST_SCAN = 32;
    function findInnermostVisible(pathElements) {
      const viewportArea = getViewportArea();
      const styleCache = /* @__PURE__ */ new Map();
      const limit = Math.min(pathElements.length, MAX_INNERMOST_SCAN);
      for (let i = 0; i < limit; i++) {
        const element = pathElements[i];
        const candidate = scoreElement(element, styleCache, viewportArea);
        if (candidate) return candidate.element;
      }
      return null;
    }
    function findBestTargetFromEvent(event, modifiers) {
      var _a2, _b2, _c;
      const pathElements = getComposedPathElements(event);
      const point = extractClientPoint(event);
      if (modifiers.ctrl || modifiers.meta) {
        const innermost = findInnermostVisible(pathElements);
        if (innermost) return innermost;
        return point ? findBestTarget(point.x, point.y, modifiers) : null;
      }
      const directHit = (_a2 = pathElements[0]) != null ? _a2 : point ? getHitElementsAtPoint(point.x, point.y)[0] : null;
      if (!directHit) {
        return point ? findBestTarget(point.x, point.y, modifiers) : null;
      }
      const viewportArea = getViewportArea();
      const styleCache = /* @__PURE__ */ new Map();
      const directCandidate = scoreElement(directHit, styleCache, viewportArea);
      let base;
      if (directCandidate && !directCandidate.wrapperOnly) {
        base = directHit;
      } else {
        base = (_b2 = getParentCandidate(directHit)) != null ? _b2 : directHit;
      }
      if (modifiers.alt) {
        return (_c = getParentCandidate(base)) != null ? _c : base;
      }
      return base;
    }
    return {
      findBestTarget,
      findBestTargetFromEvent,
      getCandidatesAtPoint,
      getParentCandidate,
      dispose: () => disposer.dispose()
    };
  }
  const elementKeyCache = /* @__PURE__ */ new WeakMap();
  const shadowHostKeyCache = /* @__PURE__ */ new WeakMap();
  let autoKeyCounter = 0;
  let shadowHostCounter = 0;
  let cachedFrameContext;
  const LABEL_ATTR_PRIORITY = [
    "data-testid",
    "data-test-id",
    "data-test",
    "data-qa",
    "data-cy",
    "name",
    "aria-label",
    "title",
    "alt"
  ];
  const MAX_LABEL_ATTR_VALUE_LENGTH = 48;
  const MAX_TEXT_LABEL_LENGTH = 64;
  function normalizeTagName(element) {
    const raw = (element == null ? void 0 : element.tagName) ? String(element.tagName) : "";
    const tag = raw.toLowerCase().trim();
    return tag || "unknown";
  }
  function normalizeAttrValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }
  function normalizeText$1(value) {
    return String(value != null ? value : "").replace(/\s+/g, " ").trim();
  }
  function truncate$1(value, maxLength) {
    const str = String(value != null ? value : "");
    if (str.length <= maxLength) return str;
    return str.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
  }
  function getFrameContextPrefix() {
    if (cachedFrameContext !== void 0) return cachedFrameContext;
    let context = "";
    try {
      const frameEl = window.frameElement;
      if (frameEl instanceof HTMLIFrameElement) {
        const tag = normalizeTagName(frameEl);
        const id = normalizeAttrValue(frameEl.id || frameEl.getAttribute("id"));
        if (id) {
          context = `${tag}#${id}`;
        } else {
          const name = normalizeAttrValue(frameEl.name || frameEl.getAttribute("name"));
          if (name) {
            context = `${tag}[name="${truncate$1(name, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
          } else {
            const src = normalizeAttrValue(frameEl.getAttribute("src") || frameEl.src);
            context = src ? `${tag}[src="${truncate$1(src, MAX_LABEL_ATTR_VALUE_LENGTH)}"]` : tag;
          }
        }
      }
    } catch (e) {
      context = "";
    }
    cachedFrameContext = context;
    return context;
  }
  function getStableShadowHostKey(host) {
    const cached = shadowHostKeyCache.get(host);
    if (cached) return cached;
    const tag = normalizeTagName(host);
    const id = normalizeAttrValue(host.id || host.getAttribute("id"));
    const key = id ? `${tag}#${id}` : `${tag}_h${++shadowHostCounter}`;
    shadowHostKeyCache.set(host, key);
    return key;
  }
  function computeShadowContextPrefix(element, _shadowHostChain) {
    var _a2;
    const hosts = [];
    let current = element;
    while (true) {
      let root;
      try {
        root = (_a2 = current.getRootNode) == null ? void 0 : _a2.call(current);
      } catch (e) {
        root = null;
      }
      if (!(root instanceof ShadowRoot)) break;
      const host = root.host;
      if (!(host instanceof Element)) break;
      hosts.unshift(getStableShadowHostKey(host));
      current = host;
    }
    return hosts.length > 0 ? hosts.join(">") : "";
  }
  function readBestLabelAttribute(element) {
    for (const attr of LABEL_ATTR_PRIORITY) {
      const value = normalizeAttrValue(element.getAttribute(attr));
      if (value) return { attr, value };
    }
    return null;
  }
  function generateStableElementKey(element, shadowHostChain) {
    const cached = elementKeyCache.get(element);
    if (cached) return cached;
    const tag = normalizeTagName(element);
    const id = normalizeAttrValue(element.id || element.getAttribute("id"));
    const baseKey = id ? `${tag}#${id}` : `${tag}_${++autoKeyCounter}`;
    const parts = [];
    const frame = getFrameContextPrefix();
    if (frame) parts.push(`frame:${frame}`);
    const shadow = computeShadowContextPrefix(element);
    if (shadow) parts.push(`shadow:${shadow}`);
    parts.push(baseKey);
    const fullKey = parts.join("|");
    elementKeyCache.set(element, fullKey);
    return fullKey;
  }
  function generateElementLabel(element) {
    var _a2;
    const tag = normalizeTagName(element);
    const id = normalizeAttrValue(element.id || element.getAttribute("id"));
    if (id) return `${tag}#${id}`;
    const bestAttr = readBestLabelAttribute(element);
    if (bestAttr) {
      return `${tag}[${bestAttr.attr}="${truncate$1(bestAttr.value, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
    }
    const role = normalizeAttrValue(element.getAttribute("role"));
    if (role) {
      return `${tag}[role="${truncate$1(role, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
    }
    if (element instanceof HTMLInputElement) {
      const type = normalizeAttrValue(element.getAttribute("type") || element.type);
      if (type && type !== "text") {
        return `${tag}[type="${truncate$1(type, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
      }
      const placeholder = normalizeAttrValue(
        element.getAttribute("placeholder") || element.placeholder
      );
      if (placeholder) {
        return `${tag}[placeholder="${truncate$1(placeholder, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
      }
    }
    if (element instanceof HTMLIFrameElement) {
      const src = normalizeAttrValue(element.getAttribute("src") || element.src);
      if (src) {
        return `${tag}[src="${truncate$1(src, MAX_LABEL_ATTR_VALUE_LENGTH)}"]`;
      }
    }
    const text = normalizeText$1((_a2 = element.textContent) != null ? _a2 : "");
    if (text) return `${tag}("${truncate$1(text, MAX_TEXT_LABEL_LENGTH)}")`;
    return tag;
  }
  function generateFullElementLabel(element, shadowHostChain) {
    const baseLabel = generateElementLabel(element);
    const shadow = computeShadowContextPrefix(element);
    if (shadow) {
      return `${shadow} >> ${baseLabel}`;
    }
    return baseLabel;
  }
  const DEFAULT_MAX_HISTORY = 100;
  const DEFAULT_MERGE_WINDOW_MS = 800;
  const KEYBIND_OPTIONS = {
    capture: true,
    passive: false
  };
  function normalizePropertyName(property) {
    const p = property.trim();
    if (!p) return "";
    if (p.startsWith("--")) return p;
    if (p.includes("-")) return p.toLowerCase();
    return p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).toLowerCase();
  }
  function getInlineStyle(element) {
    const htmlElement = element;
    const style = htmlElement.style;
    if (!style) return null;
    if (typeof style.getPropertyValue !== "function") return null;
    if (typeof style.setProperty !== "function") return null;
    if (typeof style.removeProperty !== "function") return null;
    return style;
  }
  function readStyleValue(style, property) {
    const prop = normalizePropertyName(property);
    if (!prop) return "";
    return style.getPropertyValue(prop).trim();
  }
  function writeStyleValue(style, property, value) {
    const prop = normalizePropertyName(property);
    if (!prop) return;
    const v = value.trim();
    if (!v) {
      style.removeProperty(prop);
    } else {
      style.setProperty(prop, v);
    }
  }
  function applyStylesSnapshot(element, styles) {
    if (!styles) return;
    const inlineStyle = getInlineStyle(element);
    if (!inlineStyle) return;
    for (const [property, value] of Object.entries(styles)) {
      writeStyleValue(inlineStyle, property, value);
    }
  }
  function normalizeClassList$1(input) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of input != null ? input : []) {
      const token = String(raw != null ? raw : "").trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }
  function isSameStringList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  function readClassList(element) {
    var _a2;
    try {
      const list = element.classList;
      if (list && typeof list[Symbol.iterator] === "function") {
        return Array.from(list).filter(Boolean);
      }
    } catch (e) {
    }
    try {
      const raw = (_a2 = element.getAttribute("class")) != null ? _a2 : "";
      return raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    } catch (e) {
      return [];
    }
  }
  function applyClassListToElement(element, classes) {
    const normalized = normalizeClassList$1(classes);
    const value = normalized.join(" ").trim();
    try {
      if (value) {
        element.setAttribute("class", value);
      } else {
        element.removeAttribute("class");
      }
    } catch (e) {
    }
  }
  function readInlineStyleMap(element) {
    const style = getInlineStyle(element);
    if (!style) return void 0;
    const result2 = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style.item(i);
      if (!prop) continue;
      const value = style.getPropertyValue(prop).trim();
      if (value) {
        result2[prop] = value;
      }
    }
    return Object.keys(result2).length > 0 ? result2 : void 0;
  }
  function parseSingleRootElement(html) {
    const trimmed = String(html != null ? html : "").trim();
    if (!trimmed) return null;
    try {
      const template = document.createElement("template");
      template.innerHTML = trimmed;
      const firstChild = template.content.firstElementChild;
      if (!firstChild || template.content.childElementCount !== 1) {
        return null;
      }
      return firstChild;
    } catch (e) {
      return null;
    }
  }
  function stripIdsFromSubtree(root) {
    try {
      root.removeAttribute("id");
      const descendantsWithId = root.querySelectorAll("[id]");
      for (const el of Array.from(descendantsWithId)) {
        el.removeAttribute("id");
      }
    } catch (e) {
    }
  }
  function insertElementAtPosition(parent, element, position) {
    var _a2;
    if (!parent.isConnected) return false;
    let reference = null;
    if (position.anchorLocator) {
      const anchor = locateElement(position.anchorLocator);
      if (anchor && anchor.parentElement === parent) {
        reference = position.anchorPosition === "before" ? anchor : anchor.nextSibling;
      }
    }
    if (!reference) {
      const children = Array.from(parent.children);
      const index = Math.max(0, Math.min(position.insertIndex, children.length));
      reference = (_a2 = children[index]) != null ? _a2 : null;
    }
    try {
      parent.insertBefore(element, reference);
      return true;
    } catch (e) {
      return false;
    }
  }
  function wrapElementWithContainer(target, wrapperTag, wrapperStyles) {
    const parent = target.parentElement;
    if (!parent) return null;
    const tag = String(wrapperTag || "div").toLowerCase();
    const wrapper = document.createElement(tag);
    if (wrapperStyles) {
      applyStylesSnapshot(wrapper, wrapperStyles);
    }
    try {
      parent.insertBefore(wrapper, target);
      wrapper.appendChild(target);
      return wrapper;
    } catch (e) {
      return null;
    }
  }
  function unwrapSingleChildContainer(wrapper) {
    const parent = wrapper.parentElement;
    if (!parent) return null;
    if (wrapper.childElementCount !== 1) return null;
    const child = wrapper.firstElementChild;
    if (!child) return null;
    try {
      parent.insertBefore(child, wrapper);
      wrapper.remove();
      return child;
    } catch (e) {
      return null;
    }
  }
  function buildInsertAfterPosition(target) {
    const parent = target.parentElement;
    if (!parent) return null;
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(target);
    if (index < 0) return null;
    return {
      parentLocator: createElementLocator(parent),
      insertIndex: index + 1,
      anchorLocator: createElementLocator(target),
      anchorPosition: "after"
    };
  }
  let transactionSeq = 0;
  function generateTransactionId(timestamp) {
    transactionSeq += 1;
    return `tx_${timestamp.toString(36)}_${transactionSeq.toString(36)}`;
  }
  function createStyleTransactionFromStyles(id, locator, beforeStyles, afterStyles, timestamp, elementKey) {
    const beforeSnapshot = {
      locator,
      styles: beforeStyles
    };
    const afterSnapshot = {
      locator,
      styles: afterStyles
    };
    return {
      id,
      type: "style",
      targetLocator: locator,
      elementKey,
      before: beforeSnapshot,
      after: afterSnapshot,
      timestamp,
      merged: false
    };
  }
  function createStyleTransaction(id, locator, property, beforeValue, afterValue, timestamp, elementKey) {
    const prop = normalizePropertyName(property);
    return createStyleTransactionFromStyles(
      id,
      locator,
      { [prop]: beforeValue },
      { [prop]: afterValue },
      timestamp,
      elementKey
    );
  }
  function createTextTransaction(id, locator, beforeText, afterText, timestamp, elementKey) {
    const beforeSnapshot = {
      locator,
      text: beforeText
    };
    const afterSnapshot = {
      locator,
      text: afterText
    };
    return {
      id,
      type: "text",
      targetLocator: locator,
      elementKey,
      before: beforeSnapshot,
      after: afterSnapshot,
      timestamp,
      merged: false
    };
  }
  function createClassTransaction(id, beforeLocator, afterLocator, beforeClasses, afterClasses, timestamp, elementKey) {
    const beforeSnapshot = {
      locator: beforeLocator,
      classes: beforeClasses
    };
    const afterSnapshot = {
      locator: afterLocator,
      classes: afterClasses
    };
    return {
      id,
      type: "class",
      targetLocator: afterLocator,
      elementKey,
      before: beforeSnapshot,
      after: afterSnapshot,
      timestamp,
      merged: false
    };
  }
  function createMoveTransaction(id, beforeLocator, afterLocator, moveData, timestamp, elementKey) {
    const beforeSnapshot = {
      locator: beforeLocator
    };
    const afterSnapshot = {
      locator: afterLocator
    };
    return {
      id,
      type: "move",
      targetLocator: afterLocator,
      elementKey,
      before: beforeSnapshot,
      after: afterSnapshot,
      moveData,
      timestamp,
      merged: false
    };
  }
  function createStructureTransaction(id, targetLocator, beforeLocator, afterLocator, structureData, timestamp, elementKey) {
    const beforeSnapshot = { locator: beforeLocator };
    const afterSnapshot = { locator: afterLocator };
    return {
      id,
      type: "structure",
      targetLocator,
      elementKey,
      before: beforeSnapshot,
      after: afterSnapshot,
      structureData,
      timestamp,
      merged: false
    };
  }
  function isDisallowedStructureTarget(element) {
    var _a2;
    const tag = (_a2 = element.tagName) == null ? void 0 : _a2.toUpperCase();
    return tag === "HTML" || tag === "BODY" || tag === "HEAD";
  }
  function isDisallowedStructureContainer(element) {
    var _a2;
    const tag = (_a2 = element.tagName) == null ? void 0 : _a2.toUpperCase();
    return tag === "HTML" || tag === "HEAD";
  }
  function isDisallowedMoveElement(element) {
    var _a2;
    const tag = (_a2 = element.tagName) == null ? void 0 : _a2.toUpperCase();
    return tag === "HTML" || tag === "BODY" || tag === "HEAD";
  }
  function buildMoveOperationData(element) {
    const parent = element.parentElement;
    if (!parent) return null;
    const siblings = Array.from(parent.children);
    const insertIndex = siblings.indexOf(element);
    if (insertIndex < 0) return null;
    const parentLocator = createElementLocator(parent);
    const next = element.nextElementSibling;
    if (next) {
      return {
        parentLocator,
        insertIndex,
        anchorLocator: createElementLocator(next),
        anchorPosition: "before"
      };
    }
    const prev = element.previousElementSibling;
    if (prev) {
      return {
        parentLocator,
        insertIndex,
        anchorLocator: createElementLocator(prev),
        anchorPosition: "after"
      };
    }
    return {
      parentLocator,
      insertIndex,
      anchorPosition: "before"
    };
  }
  function applyMoveOperation(target, op) {
    var _a2, _b2, _c;
    if (!target.isConnected) return false;
    if (isDisallowedMoveElement(target)) return false;
    const parent = locateElement(op.parentLocator);
    if (!parent) return false;
    if (!parent.isConnected) return false;
    const targetRoot = (_a2 = target.getRootNode) == null ? void 0 : _a2.call(target);
    const parentRoot = (_b2 = parent.getRootNode) == null ? void 0 : _b2.call(parent);
    if (targetRoot && parentRoot && targetRoot !== parentRoot) return false;
    if (target === parent || target.contains(parent)) return false;
    let reference = null;
    if (op.anchorLocator) {
      const anchor = locateElement(op.anchorLocator);
      if (anchor && anchor !== target && anchor.parentElement === parent) {
        reference = op.anchorPosition === "before" ? anchor : anchor.nextSibling;
        if (reference === target) {
          reference = target.nextSibling;
        }
      }
    }
    if (!reference) {
      const children = Array.from(parent.children);
      const existingIndex = children.indexOf(target);
      if (existingIndex !== -1) {
        children.splice(existingIndex, 1);
      }
      const index = Math.max(0, Math.min(op.insertIndex, children.length));
      reference = (_c = children[index]) != null ? _c : null;
    }
    try {
      parent.insertBefore(target, reference);
      return true;
    } catch (e) {
      return false;
    }
  }
  function getSingleStyleProperty(tx) {
    const keys = /* @__PURE__ */ new Set();
    if (tx.before.styles) {
      for (const k of Object.keys(tx.before.styles)) keys.add(k);
    }
    if (tx.after.styles) {
      for (const k of Object.keys(tx.after.styles)) keys.add(k);
    }
    return keys.size === 1 ? Array.from(keys)[0] : null;
  }
  function canMerge(prev, next, mergeWindowMs) {
    if (prev.type !== "style" || next.type !== "style") return false;
    if (Math.abs(next.timestamp - prev.timestamp) > mergeWindowMs) return false;
    if (locatorKey(prev.targetLocator) !== locatorKey(next.targetLocator)) return false;
    const prevProp = getSingleStyleProperty(prev);
    const nextProp = getSingleStyleProperty(next);
    if (!prevProp || !nextProp || prevProp !== nextProp) return false;
    return true;
  }
  function mergeInto(prev, next) {
    var _a2;
    const prop = getSingleStyleProperty(prev);
    if (!prop) return false;
    const nextValue = (_a2 = next.after.styles) == null ? void 0 : _a2[prop];
    if (nextValue === void 0) return false;
    if (!prev.after.styles) prev.after.styles = {};
    prev.after.styles[prop] = nextValue;
    prev.timestamp = next.timestamp;
    prev.merged = true;
    return true;
  }
  function applyStructureTransaction(tx, direction) {
    var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
    const data = tx.structureData;
    if (!data) return false;
    const isRedo = direction === "redo";
    switch (data.action) {
      case "wrap": {
        if (isRedo) {
          const target = (_b2 = (_a2 = locateElement(tx.before.locator)) != null ? _a2 : locateElement(tx.targetLocator)) != null ? _b2 : locateElement(tx.after.locator);
          if (!target || !target.isConnected) return false;
          if (isDisallowedStructureTarget(target)) return false;
          const parent = target.parentElement;
          if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return false;
          const wrapper2 = wrapElementWithContainer(
            target,
            (_c = data.wrapperTag) != null ? _c : "div",
            data.wrapperStyles
          );
          if (!wrapper2 || !wrapper2.isConnected) return false;
          const wrapperLocator = createElementLocator(wrapper2);
          tx.after.locator = wrapperLocator;
          tx.targetLocator = wrapperLocator;
          return true;
        }
        const wrapper = (_d = locateElement(tx.after.locator)) != null ? _d : locateElement(tx.targetLocator);
        if (!wrapper || !wrapper.isConnected) return false;
        if (isDisallowedStructureTarget(wrapper)) return false;
        const child = unwrapSingleChildContainer(wrapper);
        if (!child || !child.isConnected) return false;
        tx.before.locator = createElementLocator(child);
        return true;
      }
      case "unwrap": {
        if (isRedo) {
          const wrapper2 = (_h = (_f = locateElement(tx.before.locator)) != null ? _f : (_e = locateElement(tx.after.locator)) == null ? void 0 : _e.parentElement) != null ? _h : (_g = locateElement(tx.targetLocator)) == null ? void 0 : _g.parentElement;
          if (!wrapper2 || !wrapper2.isConnected) return false;
          if (isDisallowedStructureTarget(wrapper2)) return false;
          const child2 = unwrapSingleChildContainer(wrapper2);
          if (!child2 || !child2.isConnected) return false;
          const childLocator = createElementLocator(child2);
          tx.after.locator = childLocator;
          tx.targetLocator = childLocator;
          return true;
        }
        const child = (_i = locateElement(tx.after.locator)) != null ? _i : locateElement(tx.targetLocator);
        if (!child || !child.isConnected) return false;
        if (isDisallowedStructureTarget(child)) return false;
        const parent = child.parentElement;
        if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return false;
        const wrapper = wrapElementWithContainer(child, (_j = data.wrapperTag) != null ? _j : "div", data.wrapperStyles);
        if (!wrapper || !wrapper.isConnected) return false;
        tx.before.locator = createElementLocator(wrapper);
        return true;
      }
      case "delete": {
        if (isRedo) {
          const target = (_k = locateElement(tx.before.locator)) != null ? _k : locateElement(tx.targetLocator);
          if (!target || !target.isConnected) return false;
          if (isDisallowedStructureTarget(target)) return false;
          target.remove();
          return true;
        }
        if (!data.position || !data.html) return false;
        const parent = locateElement(data.position.parentLocator);
        if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return false;
        const element = parseSingleRootElement(data.html);
        if (!element) return false;
        if (!insertElementAtPosition(parent, element, data.position)) return false;
        const locator = createElementLocator(element);
        tx.before.locator = locator;
        tx.targetLocator = locator;
        return true;
      }
      case "duplicate": {
        if (isRedo) {
          if (!data.position || !data.html) return false;
          const parent = locateElement(data.position.parentLocator);
          if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return false;
          const element = parseSingleRootElement(data.html);
          if (!element) return false;
          if (!insertElementAtPosition(parent, element, data.position)) return false;
          const locator = createElementLocator(element);
          tx.after.locator = locator;
          tx.targetLocator = locator;
          return true;
        }
        const clone = (_l = locateElement(tx.after.locator)) != null ? _l : locateElement(tx.targetLocator);
        if (!clone || !clone.isConnected) return false;
        if (isDisallowedStructureTarget(clone)) return false;
        clone.remove();
        return true;
      }
      default:
        return false;
    }
  }
  function applyTransaction(tx, direction) {
    var _a2, _b2, _c, _d, _e;
    if (tx.type === "move") {
      const moveData = tx.moveData;
      if (!moveData) return false;
      const primaryLocator = direction === "undo" ? tx.after.locator : tx.before.locator;
      const fallbackLocator = direction === "undo" ? tx.before.locator : tx.after.locator;
      const target2 = (_b2 = (_a2 = locateElement(primaryLocator)) != null ? _a2 : locateElement(fallbackLocator)) != null ? _b2 : locateElement(tx.targetLocator);
      if (!target2) return false;
      const op = direction === "undo" ? moveData.from : moveData.to;
      return applyMoveOperation(target2, op);
    }
    if (tx.type === "class") {
      const primaryLocator = direction === "undo" ? tx.after.locator : tx.before.locator;
      const fallbackLocator = direction === "undo" ? tx.before.locator : tx.after.locator;
      const target2 = (_d = (_c = locateElement(primaryLocator)) != null ? _c : locateElement(fallbackLocator)) != null ? _d : locateElement(tx.targetLocator);
      if (!target2) return false;
      const snapshot2 = direction === "undo" ? tx.before : tx.after;
      const classes = Array.isArray(snapshot2.classes) ? snapshot2.classes : [];
      applyClassListToElement(target2, classes);
      return true;
    }
    if (tx.type === "structure") {
      return applyStructureTransaction(tx, direction);
    }
    if (tx.type !== "style" && tx.type !== "text") return true;
    const target = locateElement(tx.targetLocator);
    if (!target) {
      return false;
    }
    const snapshot = direction === "undo" ? tx.before : tx.after;
    if (tx.type === "style") {
      applyStylesSnapshot(target, snapshot.styles);
      return true;
    }
    if (tx.type === "text") {
      target.textContent = (_e = snapshot.text) != null ? _e : "";
      return true;
    }
    return true;
  }
  function createTransactionManager(options = {}) {
    var _a2, _b2, _c;
    const disposer = new Disposer();
    const maxHistory = Math.max(1, (_a2 = options.maxHistory) != null ? _a2 : DEFAULT_MAX_HISTORY);
    const mergeWindowMs = Math.max(0, (_b2 = options.mergeWindowMs) != null ? _b2 : DEFAULT_MERGE_WINDOW_MS);
    const now = (_c = options.now) != null ? _c : (() => Date.now());
    const undoStack = [];
    const redoStack = [];
    function emit(action, transaction) {
      var _a3;
      (_a3 = options.onChange) == null ? void 0 : _a3.call(options, {
        action,
        transaction,
        undoCount: undoStack.length,
        redoCount: redoStack.length
      });
    }
    function enforceMaxHistory() {
      if (undoStack.length > maxHistory) {
        undoStack.splice(0, undoStack.length - maxHistory);
      }
    }
    function pushTransaction(tx, allowMerge) {
      const hadRedo = redoStack.length > 0;
      if (hadRedo) {
        redoStack.length = 0;
      }
      if (!hadRedo && allowMerge && undoStack.length > 0) {
        const last = undoStack[undoStack.length - 1];
        if (canMerge(last, tx, mergeWindowMs) && mergeInto(last, tx)) {
          emit("merge", last);
          return;
        }
      }
      undoStack.push(tx);
      enforceMaxHistory();
      emit("push", tx);
    }
    function recordStyle(locator, property, beforeValue, afterValue, recordOptions) {
      if (disposer.isDisposed) return null;
      const prop = normalizePropertyName(property);
      if (!prop) return null;
      const before = beforeValue.trim();
      const after = afterValue.trim();
      if (before === after) return null;
      const id = generateTransactionId(now());
      const tx = createStyleTransaction(id, locator, prop, before, after, now());
      pushTransaction(tx, (recordOptions == null ? void 0 : recordOptions.merge) !== false);
      return tx;
    }
    function recordText(target, beforeText, afterText) {
      if (disposer.isDisposed) return null;
      const before = String(beforeText != null ? beforeText : "");
      const after = String(afterText != null ? afterText : "");
      if (before === after) return null;
      const locator = createElementLocator(target);
      const timestamp = now();
      const id = generateTransactionId(timestamp);
      const elementKey = generateStableElementKey(target, locator.shadowHostChain);
      const tx = createTextTransaction(id, locator, before, after, timestamp, elementKey);
      pushTransaction(tx, false);
      return tx;
    }
    function recordClass(target, beforeClasses, afterClasses) {
      if (disposer.isDisposed) return null;
      if (!target.isConnected) return null;
      const domClasses = normalizeClassList$1(readClassList(target));
      const beforeInput = normalizeClassList$1(beforeClasses);
      const after = normalizeClassList$1(afterClasses);
      const before = isSameStringList(beforeInput, domClasses) ? beforeInput : domClasses;
      if (isSameStringList(before, after)) return null;
      const timestamp = now();
      const id = generateTransactionId(timestamp);
      const beforeLocator = createElementLocator(target);
      const elementKey = generateStableElementKey(target, beforeLocator.shadowHostChain);
      applyClassListToElement(target, after);
      const afterLocator = createElementLocator(target);
      const tx = createClassTransaction(
        id,
        beforeLocator,
        afterLocator,
        before,
        after,
        timestamp,
        elementKey
      );
      pushTransaction(tx, false);
      return tx;
    }
    function applyStructure(target, input) {
      var _a3, _b3, _c2, _d;
      if (disposer.isDisposed) return null;
      if (!target.isConnected) return null;
      if (isDisallowedStructureTarget(target)) return null;
      const action = input == null ? void 0 : input.action;
      const timestamp = now();
      const id = generateTransactionId(timestamp);
      if (action === "wrap") {
        const parent = target.parentElement;
        if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return null;
        const beforeLocator = createElementLocator(target);
        const wrapper = wrapElementWithContainer(
          target,
          (_a3 = input.wrapperTag) != null ? _a3 : "div",
          input.wrapperStyles
        );
        if (!wrapper || !wrapper.isConnected) return null;
        const wrapperLocator = createElementLocator(wrapper);
        const elementKey = generateStableElementKey(wrapper, wrapperLocator.shadowHostChain);
        const structureData = {
          action: "wrap",
          wrapperTag: (_b3 = input.wrapperTag) != null ? _b3 : "div",
          wrapperStyles: input.wrapperStyles
        };
        const tx = createStructureTransaction(
          id,
          wrapperLocator,
          beforeLocator,
          wrapperLocator,
          structureData,
          timestamp,
          elementKey
        );
        pushTransaction(tx, false);
        return tx;
      }
      if (action === "unwrap") {
        const wrapper = target;
        const parent = wrapper.parentElement;
        if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return null;
        if (wrapper.childElementCount !== 1) return null;
        const beforeLocator = createElementLocator(wrapper);
        const wrapperTag = wrapper.tagName.toLowerCase();
        const wrapperStyles = readInlineStyleMap(wrapper);
        const child = unwrapSingleChildContainer(wrapper);
        if (!child || !child.isConnected) return null;
        const childLocator = createElementLocator(child);
        const elementKey = generateStableElementKey(child, childLocator.shadowHostChain);
        const structureData = {
          action: "unwrap",
          wrapperTag,
          wrapperStyles
        };
        const tx = createStructureTransaction(
          id,
          childLocator,
          beforeLocator,
          childLocator,
          structureData,
          timestamp,
          elementKey
        );
        pushTransaction(tx, false);
        return tx;
      }
      if (action === "delete") {
        const position = buildMoveOperationData(target);
        if (!position) return null;
        const html = String((_c2 = target.outerHTML) != null ? _c2 : "").trim();
        if (!html) return null;
        const beforeLocator = createElementLocator(target);
        const elementKey = generateStableElementKey(target, beforeLocator.shadowHostChain);
        const afterLocator = position.parentLocator;
        try {
          target.remove();
        } catch (e) {
          return null;
        }
        const structureData = {
          action: "delete",
          position,
          html
        };
        const tx = createStructureTransaction(
          id,
          beforeLocator,
          beforeLocator,
          afterLocator,
          structureData,
          timestamp,
          elementKey
        );
        pushTransaction(tx, false);
        return tx;
      }
      if (action === "duplicate") {
        const parent = target.parentElement;
        if (!parent || !parent.isConnected || isDisallowedStructureContainer(parent)) return null;
        const position = buildInsertAfterPosition(target);
        if (!position) return null;
        const beforeLocator = createElementLocator(target);
        const clone = target.cloneNode(true);
        stripIdsFromSubtree(clone);
        try {
          parent.insertBefore(clone, target.nextSibling);
        } catch (e) {
          return null;
        }
        const html = String((_d = clone.outerHTML) != null ? _d : "").trim();
        if (!html) return null;
        const cloneLocator = createElementLocator(clone);
        const elementKey = generateStableElementKey(clone, cloneLocator.shadowHostChain);
        const structureData = {
          action: "duplicate",
          position,
          html
        };
        const tx = createStructureTransaction(
          id,
          cloneLocator,
          beforeLocator,
          cloneLocator,
          structureData,
          timestamp,
          elementKey
        );
        pushTransaction(tx, false);
        return tx;
      }
      return null;
    }
    function beginMove(target) {
      if (disposer.isDisposed) return null;
      if (!target.isConnected) return null;
      if (isDisallowedMoveElement(target)) return null;
      const from = buildMoveOperationData(target);
      if (!from) return null;
      const startedAt = now();
      const id = generateTransactionId(startedAt);
      const beforeLocator = createElementLocator(target);
      let completed = false;
      function commit(targetAfterMove) {
        if (completed || disposer.isDisposed) return null;
        completed = true;
        if (!targetAfterMove.isConnected) return null;
        if (isDisallowedMoveElement(targetAfterMove)) return null;
        const to = buildMoveOperationData(targetAfterMove);
        if (!to) return null;
        const sameParent = locatorKey(from.parentLocator) === locatorKey(to.parentLocator);
        const sameIndex = from.insertIndex === to.insertIndex;
        const sameAnchorPos = from.anchorPosition === to.anchorPosition;
        const sameAnchor = !from.anchorLocator && !to.anchorLocator || from.anchorLocator && to.anchorLocator && locatorKey(from.anchorLocator) === locatorKey(to.anchorLocator);
        if (sameParent && sameIndex && sameAnchor && sameAnchorPos) {
          return null;
        }
        const afterLocator = createElementLocator(targetAfterMove);
        const elementKey = generateStableElementKey(targetAfterMove, afterLocator.shadowHostChain);
        const moveData = { from, to };
        const tx = createMoveTransaction(
          id,
          beforeLocator,
          afterLocator,
          moveData,
          now(),
          elementKey
        );
        pushTransaction(tx, false);
        return tx;
      }
      function cancel() {
        if (completed || disposer.isDisposed) return;
        completed = true;
      }
      return {
        id,
        beforeLocator,
        from,
        commit,
        cancel
      };
    }
    function beginStyle(target, property) {
      if (disposer.isDisposed) return null;
      const inlineStyleOrNull = getInlineStyle(target);
      if (!inlineStyleOrNull) return null;
      const inlineStyle = inlineStyleOrNull;
      const prop = normalizePropertyName(property);
      if (!prop) return null;
      const locator = createElementLocator(target);
      const beforeValue = readStyleValue(inlineStyle, prop);
      const id = generateTransactionId(now());
      const elementKey = generateStableElementKey(target, locator.shadowHostChain);
      let completed = false;
      function set(value) {
        if (completed || disposer.isDisposed) return;
        writeStyleValue(inlineStyle, prop, value);
      }
      function commit(commitOptions) {
        if (completed || disposer.isDisposed) return null;
        completed = true;
        const afterValue = readStyleValue(inlineStyle, prop);
        if (afterValue === beforeValue) return null;
        const tx = createStyleTransaction(
          id,
          locator,
          prop,
          beforeValue,
          afterValue,
          now(),
          elementKey
        );
        pushTransaction(tx, (commitOptions == null ? void 0 : commitOptions.merge) !== false);
        return tx;
      }
      function rollback() {
        if (completed || disposer.isDisposed) return;
        completed = true;
        writeStyleValue(inlineStyle, prop, beforeValue);
        emit("rollback", null);
      }
      return {
        id,
        property: prop,
        targetLocator: locator,
        set,
        commit,
        rollback
      };
    }
    function beginMultiStyle(target, properties) {
      if (disposer.isDisposed) return null;
      const inlineStyleOrNull = getInlineStyle(target);
      if (!inlineStyleOrNull) return null;
      const inlineStyle = inlineStyleOrNull;
      const normalizedProps = Array.from(
        new Set(
          properties.map((p) => normalizePropertyName(String(p))).filter((p) => !!p)
        )
      );
      if (normalizedProps.length === 0) return null;
      const trackedProps = new Set(normalizedProps);
      const locator = createElementLocator(target);
      const startedAt = now();
      const id = generateTransactionId(startedAt);
      const elementKey = generateStableElementKey(target, locator.shadowHostChain);
      const beforeValues = {};
      for (const prop of normalizedProps) {
        beforeValues[prop] = readStyleValue(inlineStyle, prop);
      }
      let completed = false;
      function set(values) {
        if (completed || disposer.isDisposed) return;
        for (const [rawKey, rawVal] of Object.entries(values)) {
          const prop = normalizePropertyName(rawKey);
          if (!prop || !trackedProps.has(prop)) continue;
          writeStyleValue(inlineStyle, prop, String(rawVal != null ? rawVal : ""));
        }
      }
      function commit(commitOptions) {
        var _a3;
        if (completed || disposer.isDisposed) return null;
        completed = true;
        const beforeStyles = {};
        const afterStyles = {};
        for (const prop of normalizedProps) {
          const beforeVal = (_a3 = beforeValues[prop]) != null ? _a3 : "";
          const afterVal = readStyleValue(inlineStyle, prop);
          if (afterVal === beforeVal) continue;
          beforeStyles[prop] = beforeVal;
          afterStyles[prop] = afterVal;
        }
        if (Object.keys(beforeStyles).length === 0) return null;
        const tx = createStyleTransactionFromStyles(
          id,
          locator,
          beforeStyles,
          afterStyles,
          now(),
          elementKey
        );
        pushTransaction(tx, (commitOptions == null ? void 0 : commitOptions.merge) === true);
        return tx;
      }
      function rollback() {
        var _a3;
        if (completed || disposer.isDisposed) return;
        completed = true;
        for (const prop of normalizedProps) {
          writeStyleValue(inlineStyle, prop, (_a3 = beforeValues[prop]) != null ? _a3 : "");
        }
        emit("rollback", null);
      }
      return {
        id,
        properties: normalizedProps,
        targetLocator: locator,
        set,
        commit,
        rollback
      };
    }
    function applyStyle(target, property, value, applyOptions) {
      const handle = beginStyle(target, property);
      if (!handle) return null;
      handle.set(value);
      return handle.commit(applyOptions);
    }
    function undo() {
      var _a3;
      if (disposer.isDisposed) return null;
      const tx = undoStack.pop();
      if (!tx) return null;
      const success = applyTransaction(tx, "undo");
      if (!success) {
        undoStack.push(tx);
        (_a3 = options.onApplyError) == null ? void 0 : _a3.call(options, new Error(`Failed to locate element for undo: ${tx.id}`));
        return null;
      }
      redoStack.push(tx);
      emit("undo", tx);
      return tx;
    }
    function redo() {
      var _a3;
      if (disposer.isDisposed) return null;
      const tx = redoStack.pop();
      if (!tx) return null;
      const success = applyTransaction(tx, "redo");
      if (!success) {
        redoStack.push(tx);
        (_a3 = options.onApplyError) == null ? void 0 : _a3.call(options, new Error(`Failed to locate element for redo: ${tx.id}`));
        return null;
      }
      undoStack.push(tx);
      enforceMaxHistory();
      emit("redo", tx);
      return tx;
    }
    function canUndo() {
      return undoStack.length > 0;
    }
    function canRedo() {
      return redoStack.length > 0;
    }
    function getUndoStack() {
      return undoStack.slice();
    }
    function getRedoStack() {
      return redoStack.slice();
    }
    function clear() {
      undoStack.length = 0;
      redoStack.length = 0;
      emit("clear", null);
    }
    if (options.enableKeyBindings) {
      disposer.listen(
        window,
        "keydown",
        (event) => {
          var _a3;
          if ((_a3 = options.isEventFromEditorUi) == null ? void 0 : _a3.call(options, event)) return;
          const isMod = event.metaKey || event.ctrlKey;
          if (!isMod || event.altKey) return;
          const key = event.key.toLowerCase();
          if (key === "z") {
            if (event.shiftKey) {
              redo();
            } else {
              undo();
            }
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          } else if (key === "y") {
            redo();
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
          }
        },
        KEYBIND_OPTIONS
      );
    }
    function dispose() {
      undoStack.length = 0;
      redoStack.length = 0;
      disposer.dispose();
    }
    return {
      beginStyle,
      beginMultiStyle,
      beginMove,
      applyStyle,
      recordStyle,
      recordText,
      recordClass,
      applyStructure,
      undo,
      redo,
      canUndo,
      canRedo,
      getUndoStack,
      getRedoStack,
      clear,
      dispose
    };
  }
  const TEXT_PREVIEW_MAX_LENGTH = 96;
  const FALLBACK_LABEL_MAX_LENGTH = 64;
  const APPLICABLE_TX_TYPES = /* @__PURE__ */ new Set(["style", "text", "class"]);
  function normalizeKey(value) {
    return String(value != null ? value : "").trim();
  }
  function normalizeStyleValue(value) {
    return String(value != null ? value : "").trim();
  }
  function normalizePreviewText(value) {
    return String(value != null ? value : "").replace(/\s+/g, " ").trim();
  }
  function truncate(value, maxLength) {
    const str = String(value != null ? value : "");
    if (str.length <= maxLength) return str;
    return str.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
  }
  function normalizeClassList(input) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of input != null ? input : []) {
      const token = String(raw != null ? raw : "").trim();
      if (!token) continue;
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
    return out;
  }
  function safeLocateElement(locator) {
    if (typeof document === "undefined") return null;
    try {
      return locateElement(locator);
    } catch (e) {
      return null;
    }
  }
  function buildFallbackLabels(locator, elementKey) {
    var _a2, _b2, _c;
    let label = "";
    const fingerprint = normalizeKey(locator.fingerprint);
    if (fingerprint) {
      const parts = fingerprint.split("|").map((p) => p.trim()).filter(Boolean);
      const tag = (_a2 = parts[0]) != null ? _a2 : "element";
      const idPart = parts.find((p) => p.startsWith("id="));
      const id = idPart ? idPart.slice("id=".length).trim() : "";
      label = id ? `${tag}#${id}` : tag;
    } else if (Array.isArray(locator.selectors) && locator.selectors.length > 0) {
      label = truncate(normalizeKey(locator.selectors[0]), FALLBACK_LABEL_MAX_LENGTH) || "element";
    } else {
      label = truncate(elementKey, FALLBACK_LABEL_MAX_LENGTH) || "element";
    }
    const prefixParts = [];
    const frame = ((_b2 = locator.frameChain) != null ? _b2 : []).join(">").trim();
    const shadow = ((_c = locator.shadowHostChain) != null ? _c : []).join(">").trim();
    if (frame) prefixParts.push(frame);
    if (shadow) prefixParts.push(shadow);
    const fullLabel = prefixParts.length ? `${prefixParts.join(">")} >> ${label}` : label;
    return { label, fullLabel };
  }
  function resolveLabels(locator, elementKey) {
    const element = safeLocateElement(locator);
    if (!element) return buildFallbackLabels(locator, elementKey);
    return {
      label: generateElementLabel(element),
      fullLabel: generateFullElementLabel(element, locator.shadowHostChain)
    };
  }
  function inferChangeType(hasStyle, hasText, hasClass) {
    const count = Number(hasStyle) + Number(hasText) + Number(hasClass);
    if (count > 1) return "mixed";
    if (hasStyle) return "style";
    if (hasText) return "text";
    if (hasClass) return "class";
    return "mixed";
  }
  function computeStyleNetEffect(txs) {
    var _a2, _b2, _c, _d;
    const firstBeforeByProp = /* @__PURE__ */ new Map();
    const lastAfterByProp = /* @__PURE__ */ new Map();
    for (const tx of txs) {
      if (tx.type !== "style") continue;
      const beforeRaw = (_a2 = tx.before.styles) != null ? _a2 : {};
      const afterRaw = (_b2 = tx.after.styles) != null ? _b2 : {};
      const keys = /* @__PURE__ */ new Set([...Object.keys(beforeRaw), ...Object.keys(afterRaw)]);
      for (const rawProp of keys) {
        const prop = String(rawProp != null ? rawProp : "").trim();
        if (!prop) continue;
        const b = normalizeStyleValue(beforeRaw[prop]);
        const a = normalizeStyleValue(afterRaw[prop]);
        if (!firstBeforeByProp.has(prop)) {
          firstBeforeByProp.set(prop, b);
        }
        lastAfterByProp.set(prop, a);
      }
    }
    if (firstBeforeByProp.size === 0 && lastAfterByProp.size === 0) {
      return null;
    }
    const before = {};
    const after = {};
    const allProps = /* @__PURE__ */ new Set([...firstBeforeByProp.keys(), ...lastAfterByProp.keys()]);
    for (const prop of allProps) {
      const b = (_c = firstBeforeByProp.get(prop)) != null ? _c : "";
      const a = (_d = lastAfterByProp.get(prop)) != null ? _d : "";
      if (b === a) continue;
      before[prop] = b;
      after[prop] = a;
    }
    const changedProps = Array.from(/* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    if (changedProps.length === 0) return null;
    let added = 0;
    let removed = 0;
    let modified = 0;
    for (const prop of changedProps) {
      const b = normalizeStyleValue(before[prop]);
      const a = normalizeStyleValue(after[prop]);
      if (!b && a) added += 1;
      else if (b && !a) removed += 1;
      else modified += 1;
    }
    return { before, after, added, removed, modified, details: changedProps };
  }
  function computeTextNetEffect(txs) {
    var _a2, _b2;
    let before;
    let after;
    for (const tx of txs) {
      if (tx.type !== "text") continue;
      if (before === void 0) {
        before = String((_a2 = tx.before.text) != null ? _a2 : "");
      }
      after = String((_b2 = tx.after.text) != null ? _b2 : "");
    }
    if (before === void 0 || after === void 0) return null;
    if (before === after) return null;
    const beforePreview = truncate(normalizePreviewText(before), TEXT_PREVIEW_MAX_LENGTH);
    const afterPreview = truncate(normalizePreviewText(after), TEXT_PREVIEW_MAX_LENGTH);
    return { before, after, beforePreview, afterPreview };
  }
  function computeClassNetEffect(txs) {
    let beforeRaw;
    let afterRaw;
    for (const tx of txs) {
      if (tx.type !== "class") continue;
      if (!beforeRaw) {
        beforeRaw = normalizeClassList(tx.before.classes);
      }
      afterRaw = normalizeClassList(tx.after.classes);
    }
    if (!beforeRaw || !afterRaw) return null;
    const beforeSet = new Set(beforeRaw);
    const afterSet = new Set(afterRaw);
    const added = Array.from(afterSet).filter((c) => !beforeSet.has(c)).sort();
    const removed = Array.from(beforeSet).filter((c) => !afterSet.has(c)).sort();
    if (added.length === 0 && removed.length === 0) return null;
    const before = Array.from(beforeSet).sort();
    const after = Array.from(afterSet).sort();
    return { before, after, added, removed };
  }
  function aggregateTransactionsByElement(transactions) {
    var _a2, _b2;
    const indexed = transactions.map((tx, index) => ({ tx, index }));
    indexed.sort((a, b) => {
      var _a3, _b3;
      const at = Number((_a3 = a.tx.timestamp) != null ? _a3 : 0);
      const bt = Number((_b3 = b.tx.timestamp) != null ? _b3 : 0);
      if (at !== bt) return at - bt;
      return a.index - b.index;
    });
    const groups = /* @__PURE__ */ new Map();
    for (const { tx } of indexed) {
      if (!APPLICABLE_TX_TYPES.has(tx.type)) continue;
      const rawElementKey = normalizeKey(tx.elementKey);
      let key;
      if (rawElementKey) {
        key = rawElementKey;
      } else {
        try {
          key = locatorKey(tx.targetLocator);
        } catch (e) {
          key = `unknown:${tx.id}`;
        }
      }
      const list = groups.get(key);
      if (list) {
        list.push(tx);
      } else {
        groups.set(key, [tx]);
      }
    }
    const summaries = [];
    for (const [elementKey, txs] of groups.entries()) {
      if (txs.length === 0) continue;
      const lastTx = txs[txs.length - 1];
      const locator = (_b2 = (_a2 = lastTx.after) == null ? void 0 : _a2.locator) != null ? _b2 : lastTx.targetLocator;
      const style = computeStyleNetEffect(txs);
      const text = computeTextNetEffect(txs);
      const cls = computeClassNetEffect(txs);
      const hasStyle = style !== null;
      const hasText = text !== null;
      const hasClass = cls !== null;
      if (!hasStyle && !hasText && !hasClass) continue;
      const { label, fullLabel } = resolveLabels(locator, elementKey);
      const netEffect = {
        elementKey,
        locator
      };
      if (style) {
        netEffect.styleChanges = { before: style.before, after: style.after };
      }
      if (text) {
        netEffect.textChange = { before: text.before, after: text.after };
      }
      if (cls) {
        netEffect.classChanges = { before: cls.before, after: cls.after };
      }
      const changes = {};
      if (style) {
        changes.style = {
          added: style.added,
          removed: style.removed,
          modified: style.modified,
          details: style.details
        };
      }
      if (text) {
        changes.text = {
          beforePreview: text.beforePreview,
          afterPreview: text.afterPreview
        };
      }
      if (cls) {
        changes.class = {
          added: cls.added,
          removed: cls.removed
        };
      }
      const updatedAt = txs.reduce((max, tx) => {
        var _a3;
        const ts = Number((_a3 = tx.timestamp) != null ? _a3 : 0);
        return Number.isFinite(ts) ? Math.max(max, ts) : max;
      }, 0);
      const type = inferChangeType(hasStyle, hasText, hasClass);
      summaries.push({
        elementKey,
        label,
        fullLabel,
        locator,
        type,
        changes,
        transactionIds: txs.map((tx) => tx.id),
        netEffect,
        updatedAt,
        debugSource: locator.debugSource
      });
    }
    summaries.sort((a, b) => b.updatedAt - a.updatedAt || a.label.localeCompare(b.label));
    return summaries;
  }
  const DEFAULT_POLL_INTERVAL = 2e3;
  const DEFAULT_TIMEOUT = 12e4;
  const TERMINAL_STATUSES = [
    "completed",
    "failed",
    "error",
    "timeout",
    "cancelled"
  ];
  function isTerminalStatus(status) {
    return TERMINAL_STATUSES.includes(status);
  }
  function getStatusMessage(status) {
    switch (status) {
      case "pending":
        return "Waiting...";
      case "starting":
        return "Starting Agent...";
      case "running":
        return "Running...";
      case "locating":
        return "Locating code...";
      case "applying":
        return "Applying changes...";
      case "completed":
        return "Completed";
      case "failed":
      case "error":
        return "Failed";
      case "timeout":
        return "Timed out";
      case "cancelled":
        return "Cancelled";
      default:
        return "";
    }
  }
  class ExecutionTracker {
    constructor(options = {}) {
      __publicField(this, "disposer", new Disposer());
      __publicField(this, "executions", /* @__PURE__ */ new Map());
      __publicField(this, "pollTimers", /* @__PURE__ */ new Map());
      __publicField(this, "pollInterval");
      __publicField(this, "timeout");
      __publicField(this, "onStatusChange");
      var _a2, _b2;
      this.pollInterval = (_a2 = options.pollInterval) != null ? _a2 : DEFAULT_POLL_INTERVAL;
      this.timeout = (_b2 = options.timeout) != null ? _b2 : DEFAULT_TIMEOUT;
      this.onStatusChange = options.onStatusChange;
      this.disposer.add(() => this.stopAllPolling());
    }
    /**
     * Track a new execution by requestId
     */
    track(requestId, sessionId) {
      const now = Date.now();
      const state = {
        requestId,
        sessionId,
        status: "pending",
        message: getStatusMessage("pending"),
        startedAt: now,
        updatedAt: now
      };
      this.executions.set(requestId, state);
      this.startPolling(requestId);
      return state;
    }
    /**
     * Get current state for a request
     */
    getState(requestId) {
      return this.executions.get(requestId);
    }
    /**
     * Cancel tracking for a request.
     * Sends a real cancel request to the background to abort the execution on the server.
     * @returns Promise that resolves when cancel is complete (or fails silently)
     */
    cancel(requestId) {
      return __async(this, null, function* () {
        const state = this.executions.get(requestId);
        if (!state) return;
        this.stopPolling(requestId);
        if (isTerminalStatus(state.status)) return;
        this.updateState(requestId, {
          status: "cancelled",
          message: "Cancelling..."
        });
        try {
          const response = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_CANCEL_EXECUTION,
            payload: {
              sessionId: state.sessionId,
              requestId: state.requestId
            }
          });
          if (response == null ? void 0 : response.success) {
            this.updateState(requestId, {
              status: "cancelled",
              message: "Cancelled by user"
            });
          } else {
            console.warn("[ExecutionTracker] Cancel request failed:", response == null ? void 0 : response.error);
            this.updateState(requestId, {
              status: "cancelled",
              message: "Cancelled (server may still be running)"
            });
          }
        } catch (error) {
          console.warn("[ExecutionTracker] Cancel request error:", error);
          this.updateState(requestId, {
            status: "cancelled",
            message: "Cancelled by user"
          });
        }
      });
    }
    /**
     * Manually update status (for background message handler)
     */
    updateFromBackground(requestId, update) {
      this.updateState(requestId, update);
    }
    /**
     * Clean up
     */
    dispose() {
      this.disposer.dispose();
      this.executions.clear();
    }
    // ===========================================================================
    // Private Methods
    // ===========================================================================
    startPolling(requestId) {
      const timeoutTimer = window.setTimeout(() => {
        const state = this.executions.get(requestId);
        if (state && !isTerminalStatus(state.status)) {
          this.updateState(requestId, {
            status: "timeout",
            message: "Execution timed out"
          });
          this.stopPolling(requestId);
        }
      }, this.timeout);
      this.disposer.add(() => window.clearTimeout(timeoutTimer));
      const poll = () => __async(this, null, function* () {
        const state = this.executions.get(requestId);
        if (!state || isTerminalStatus(state.status)) {
          this.stopPolling(requestId);
          return;
        }
        try {
          const result2 = yield this.queryStatus(requestId, state.sessionId);
          if (result2) {
            this.updateState(requestId, result2);
            if (isTerminalStatus(result2.status)) {
              this.stopPolling(requestId);
              return;
            }
          }
        } catch (e) {
        }
        if (!this.disposer.isDisposed) {
          const timer = window.setTimeout(poll, this.pollInterval);
          this.pollTimers.set(requestId, timer);
        }
      });
      const initialTimer = window.setTimeout(poll, 500);
      this.pollTimers.set(requestId, initialTimer);
    }
    stopPolling(requestId) {
      const timer = this.pollTimers.get(requestId);
      if (timer !== void 0) {
        window.clearTimeout(timer);
        this.pollTimers.delete(requestId);
      }
    }
    stopAllPolling() {
      for (const timer of this.pollTimers.values()) {
        window.clearTimeout(timer);
      }
      this.pollTimers.clear();
    }
    updateState(requestId, update) {
      var _a2;
      const state = this.executions.get(requestId);
      if (!state) return;
      const newState = __spreadProps(__spreadValues(__spreadValues({}, state), update), {
        updatedAt: Date.now()
      });
      if (update.status && !update.message) {
        newState.message = getStatusMessage(update.status);
      }
      this.executions.set(requestId, newState);
      (_a2 = this.onStatusChange) == null ? void 0 : _a2.call(this, newState);
    }
    queryStatus(requestId, sessionId) {
      return __async(this, null, function* () {
        try {
          const response = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_STATUS_QUERY,
            requestId,
            sessionId
          });
          if (response == null ? void 0 : response.status) {
            return {
              status: response.status,
              message: response.message,
              result: response.result
            };
          }
        } catch (e) {
        }
        return null;
      });
    }
  }
  function createExecutionTracker(options) {
    return new ExecutionTracker(options);
  }
  const DEFAULT_PX_EPSILON = 0.5;
  const DEFAULT_MATRIX_EPSILON = 1e-3;
  const PX_VALUE_REGEX = /(-?\d*\.?\d+(?:e[+-]?\d+)?)px/gi;
  const MATRIX_NUMBER_REGEX = /-?\d*\.?\d+(?:e[+-]?\d+)?/gi;
  function normalizeText(text) {
    return String(text != null ? text : "").replace(/\s+/g, " ").trim();
  }
  function readComputedMap(element, properties) {
    var _a2;
    const result2 = {};
    const uniqueProps = [];
    const seen = /* @__PURE__ */ new Set();
    for (const raw of properties) {
      const prop = String(raw != null ? raw : "").trim();
      if (!prop || seen.has(prop)) continue;
      seen.add(prop);
      uniqueProps.push(prop);
    }
    let computed = null;
    try {
      computed = window.getComputedStyle(element);
    } catch (e) {
      computed = null;
    }
    for (const property of uniqueProps) {
      let value = "";
      try {
        value = (_a2 = computed == null ? void 0 : computed.getPropertyValue(property)) != null ? _a2 : "";
      } catch (e) {
        value = "";
      }
      result2[property] = normalizeCssValue(value);
    }
    return result2;
  }
  function compareComputed(expected, actual, options = {}) {
    var _a2, _b2;
    const pxEps = Number.isFinite(options.pxEpsilon) ? options.pxEpsilon : DEFAULT_PX_EPSILON;
    const matrixEps = Number.isFinite(options.matrixEpsilon) ? options.matrixEpsilon : DEFAULT_MATRIX_EPSILON;
    const diffs = [];
    for (const property of Object.keys(expected)) {
      const exp = normalizeCssValue((_a2 = expected[property]) != null ? _a2 : "");
      const act = normalizeCssValue((_b2 = actual[property]) != null ? _b2 : "");
      const { match, reason } = compareSingleValue(exp, act, pxEps, matrixEps);
      diffs.push({ property, expected: exp, actual: act, match, reason });
    }
    const matches = diffs.every((d) => d.match);
    return { matches, diffs };
  }
  function normalizeCssValue(raw) {
    return String(raw != null ? raw : "").replace(/\s+/g, " ").replace(/,\s+/g, ",").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
  }
  function approximatelyEqual(a, b, epsilon) {
    return Math.abs(a - b) <= epsilon;
  }
  function isMatrixValue(value) {
    const lower = value.toLowerCase();
    return lower.startsWith("matrix(") || lower.startsWith("matrix3d(");
  }
  function extractMatrixNumbers(value) {
    if (!isMatrixValue(value)) return null;
    const matches = value.match(MATRIX_NUMBER_REGEX);
    if (!matches || matches.length === 0) return null;
    const nums = [];
    for (const m of matches) {
      const n = Number(m);
      if (!Number.isFinite(n)) return null;
      nums.push(n);
    }
    return nums.length > 0 ? nums : null;
  }
  function extractPxNumbers(value) {
    const nums = [];
    PX_VALUE_REGEX.lastIndex = 0;
    let match;
    while ((match = PX_VALUE_REGEX.exec(value)) !== null) {
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return null;
      nums.push(n);
    }
    return nums.length > 0 ? nums : null;
  }
  function pxValueShape(value) {
    PX_VALUE_REGEX.lastIndex = 0;
    return normalizeCssValue(value).replace(PX_VALUE_REGEX, "#px");
  }
  function compareMatrixWithEpsilon(expected, actual, epsilon) {
    const expNums = extractMatrixNumbers(expected);
    const actNums = extractMatrixNumbers(actual);
    if (!expNums || !actNums) return false;
    if (expNums.length !== actNums.length) return false;
    const expKind = expected.toLowerCase().startsWith("matrix3d(") ? "matrix3d" : "matrix";
    const actKind = actual.toLowerCase().startsWith("matrix3d(") ? "matrix3d" : "matrix";
    if (expKind !== actKind) return false;
    for (let i = 0; i < expNums.length; i++) {
      if (!approximatelyEqual(expNums[i], actNums[i], epsilon)) return false;
    }
    return true;
  }
  function comparePxWithEpsilon(expected, actual, epsilon) {
    const expNums = extractPxNumbers(expected);
    const actNums = extractPxNumbers(actual);
    if (!expNums || !actNums) return false;
    if (expNums.length !== actNums.length) return false;
    if (pxValueShape(expected) !== pxValueShape(actual)) return false;
    for (let i = 0; i < expNums.length; i++) {
      if (!approximatelyEqual(expNums[i], actNums[i], epsilon)) return false;
    }
    return true;
  }
  function compareSingleValue(expected, actual, pxEpsilon, matrixEpsilon) {
    if (expected === actual) {
      return { match: true, reason: "exact" };
    }
    if (isMatrixValue(expected) && isMatrixValue(actual)) {
      if (compareMatrixWithEpsilon(expected, actual, matrixEpsilon)) {
        return { match: true, reason: "matrix_epsilon" };
      }
    }
    const expHasPx = PX_VALUE_REGEX.test(expected);
    PX_VALUE_REGEX.lastIndex = 0;
    const actHasPx = PX_VALUE_REGEX.test(actual);
    PX_VALUE_REGEX.lastIndex = 0;
    if (expHasPx && actHasPx) {
      if (comparePxWithEpsilon(expected, actual, pxEpsilon)) {
        return { match: true, reason: "px_epsilon" };
      }
    }
    return { match: false, reason: "string" };
  }
  const DEFAULT_QUIET_WINDOW_MS = 300;
  const DEFAULT_SETTLE_DEADLINE_MS = 8e3;
  const DEFAULT_NO_SIGNAL_DEADLINE_MS = 2e3;
  const DEFAULT_RELAXED_LOCATE_MAX_ELEMENTS = 200;
  const DEFAULT_GEOMETRIC_MAX_CANDIDATES = 16;
  const HEAD_MUTATION_OPTIONS = {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true
  };
  const DOM_MUTATION_OPTIONS = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "id"],
    characterData: true
    // Needed for text content changes
  };
  const TERMINAL_EXEC_STATUSES = /* @__PURE__ */ new Set(["completed", "failed", "error", "timeout", "cancelled"]);
  const RELAXED_CONFIDENCE_THRESHOLD = 8;
  const GEOMETRIC_CONFIDENCE_THRESHOLD = 6;
  function safeReadRect(element) {
    try {
      const r = element.getBoundingClientRect();
      if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) return null;
      if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) return null;
      return r;
    } catch (e) {
      return null;
    }
  }
  function rectCenter(rect) {
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  function safeElementsFromPoint(x, y) {
    try {
      const els = document.elementsFromPoint(x, y);
      return Array.isArray(els) ? els.filter((e) => e instanceof Element) : [];
    } catch (e) {
      try {
        const el = document.elementFromPoint(x, y);
        return el ? [el] : [];
      } catch (e2) {
        return [];
      }
    }
  }
  function safeQuerySelectorAll(root, selector, maxCount) {
    try {
      const list = root.querySelectorAll(selector);
      const out = [];
      const limit = Math.min(maxCount, list.length);
      for (let i = 0; i < limit; i++) out.push(list[i]);
      return out;
    } catch (e) {
      return [];
    }
  }
  function isHtmlOrBody(element) {
    var _a2, _b2, _c;
    const tag = (_c = (_b2 = (_a2 = element.tagName) == null ? void 0 : _a2.toUpperCase) == null ? void 0 : _b2.call(_a2)) != null ? _c : "";
    return tag === "HTML" || tag === "BODY";
  }
  function isValidCandidate(element, isOverlayElement) {
    if (!element.isConnected) return false;
    if (isHtmlOrBody(element)) return false;
    if (isOverlayElement == null ? void 0 : isOverlayElement(element)) return false;
    return true;
  }
  function parseFingerprint(raw) {
    const parts = String(raw != null ? raw : "").trim().split("|").filter(Boolean);
    const tag = parts[0] || "unknown";
    let id;
    let classes = [];
    let text;
    for (const part of parts.slice(1)) {
      if (part.startsWith("id=")) id = part.slice(3) || void 0;
      else if (part.startsWith("class=")) classes = part.slice(6).split(".").filter(Boolean);
      else if (part.startsWith("text=")) text = part.slice(5) || void 0;
    }
    return { tag, id, classes, text };
  }
  function intersectCount(a, b) {
    if (!a.length || !b.length) return 0;
    const set = new Set(b);
    return a.filter((item) => set.has(item)).length;
  }
  function commonPrefixLength(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i++;
    return i;
  }
  function scoreCandidate(params) {
    var _a2, _b2;
    const { element, expected, locator, anchorCenter } = params;
    const candidateFp = parseFingerprint(computeFingerprint(element));
    if (candidateFp.tag !== expected.tag) return -Infinity;
    if (expected.id && candidateFp.id !== expected.id) return -Infinity;
    let score = 0;
    if (expected.id) score += 12;
    score += Math.min(8, intersectCount(expected.classes, candidateFp.classes) * 2);
    if (expected.text) {
      const expectedText = normalizeText(expected.text);
      const actualText = normalizeText((_a2 = element.textContent) != null ? _a2 : "");
      if (actualText.includes(expectedText)) score += 4;
    }
    if ((_b2 = locator.path) == null ? void 0 : _b2.length) {
      const path = computeDomPath(element);
      const prefix = commonPrefixLength(locator.path, path);
      score += prefix / locator.path.length * 6;
      if (prefix === locator.path.length && path.length === locator.path.length) score += 2;
    }
    if (anchorCenter && Number.isFinite(anchorCenter.x)) {
      const rect = safeReadRect(element);
      if (rect) {
        const c = rectCenter(rect);
        const dist = Math.hypot(c.x - anchorCenter.x, c.y - anchorCenter.y);
        score += Math.max(0, 6 - dist / 50);
      }
    }
    return score;
  }
  function relaxedLocate(params) {
    var _a2;
    const { locator, expected, isOverlayElement, maxElements, anchorCenter } = params;
    let best = null;
    let scanned = 0;
    if (expected.id) {
      const byId = document.getElementById(expected.id);
      if (byId && isValidCandidate(byId, isOverlayElement)) {
        const score = scoreCandidate({ element: byId, expected, locator, anchorCenter });
        if (Number.isFinite(score)) best = { element: byId, score };
      }
    }
    for (const selector of (_a2 = locator.selectors) != null ? _a2 : []) {
      if (scanned >= maxElements) break;
      const remaining = maxElements - scanned;
      if (remaining <= 0) break;
      const elements = safeQuerySelectorAll(document, selector, remaining);
      for (const element of elements) {
        scanned++;
        if (!isValidCandidate(element, isOverlayElement)) continue;
        const score = scoreCandidate({ element, expected, locator, anchorCenter });
        if (!Number.isFinite(score)) continue;
        if (!best || score > best.score) {
          best = { element, score };
        }
      }
    }
    return best;
  }
  function geometricLocate(params) {
    const { expected, locator, anchorCenter, isOverlayElement, selectionEngine, maxCandidates } = params;
    const candidates = [];
    if (selectionEngine) {
      try {
        for (const c of selectionEngine.getCandidatesAtPoint(anchorCenter.x, anchorCenter.y)) {
          candidates.push(c.element);
          if (candidates.length >= maxCandidates) break;
        }
      } catch (e) {
      }
    }
    if (candidates.length === 0) {
      for (const el of safeElementsFromPoint(anchorCenter.x, anchorCenter.y)) {
        candidates.push(el);
        if (candidates.length >= maxCandidates) break;
      }
    }
    let best = null;
    const seen = /* @__PURE__ */ new Set();
    for (const element of candidates) {
      if (seen.has(element)) continue;
      seen.add(element);
      if (!isValidCandidate(element, isOverlayElement)) continue;
      const score = scoreCandidate({ element, expected, locator, anchorCenter });
      if (!Number.isFinite(score)) continue;
      if (!best || score > best.score) best = { element, score };
    }
    return best;
  }
  function collectStyleProperties(tx) {
    var _a2, _b2;
    const set = /* @__PURE__ */ new Set();
    for (const key of Object.keys((_a2 = tx.before.styles) != null ? _a2 : {})) set.add(key);
    for (const key of Object.keys((_b2 = tx.after.styles) != null ? _b2 : {})) set.add(key);
    return Array.from(set).filter(Boolean);
  }
  function createHmrConsistencyVerifier(options) {
    var _a2, _b2, _c, _d, _e;
    const disposer = new Disposer();
    const now = () => Date.now();
    const quietWindowMs = Math.max(0, (_a2 = options.quietWindowMs) != null ? _a2 : DEFAULT_QUIET_WINDOW_MS);
    const settleDeadlineMs = Math.max(0, (_b2 = options.settleDeadlineMs) != null ? _b2 : DEFAULT_SETTLE_DEADLINE_MS);
    const noSignalDeadlineMs = Math.max(
      0,
      (_c = options.noSignalDeadlineMs) != null ? _c : DEFAULT_NO_SIGNAL_DEADLINE_MS
    );
    const relaxedLocateMaxElements = Math.max(
      1,
      (_d = options.relaxedLocateMaxElements) != null ? _d : DEFAULT_RELAXED_LOCATE_MAX_ELEMENTS
    );
    const geometricMaxCandidates = Math.max(
      1,
      (_e = options.geometricMaxCandidates) != null ? _e : DEFAULT_GEOMETRIC_MAX_CANDIDATES
    );
    let sessionSeq = 0;
    let active = null;
    let lastResult = null;
    disposer.add(() => finalizeActive("skipped", "disposed"));
    function setToolbar(status, message) {
      var _a3;
      (_a3 = options.setToolbarStatus) == null ? void 0 : _a3.call(options, status, message);
    }
    function buildResult(session, params) {
      var _a3, _b3, _c2, _d2, _e2, _f, _g;
      const finalizedAt = now();
      return {
        outcome: params.outcome,
        reason: params.reason,
        requestId: session == null ? void 0 : session.requestId,
        sessionId: session == null ? void 0 : session.sessionId,
        txId: (_a3 = session == null ? void 0 : session.txId) != null ? _a3 : "",
        txTimestamp: (_b3 = session == null ? void 0 : session.txTimestamp) != null ? _b3 : 0,
        txType: (_c2 = session == null ? void 0 : session.txType) != null ? _c2 : "style",
        resolved: params.resolved,
        style: params.style,
        text: params.text,
        signals: {
          hadRelevantMutation: (_d2 = session == null ? void 0 : session.signals.hadRelevantMutation) != null ? _d2 : false,
          hadElementDisconnect: (_e2 = session == null ? void 0 : session.signals.hadElementDisconnect) != null ? _e2 : false
        },
        timing: {
          startedAt: (_f = session == null ? void 0 : session.startedAt) != null ? _f : finalizedAt,
          executionCompletedAt: (_g = session == null ? void 0 : session.executionCompletedAt) != null ? _g : void 0,
          finalizedAt
        }
      };
    }
    function emitAndStore(result2) {
      var _a3;
      lastResult = result2;
      (_a3 = options.onResult) == null ? void 0 : _a3.call(options, result2);
    }
    function clearTimers(s) {
      if (s.timers.quietTimer !== null) {
        window.clearTimeout(s.timers.quietTimer);
        s.timers.quietTimer = null;
      }
      if (s.timers.deadlineTimer !== null) {
        window.clearTimeout(s.timers.deadlineTimer);
        s.timers.deadlineTimer = null;
      }
      if (s.timers.noSignalTimer !== null) {
        window.clearTimeout(s.timers.noSignalTimer);
        s.timers.noSignalTimer = null;
      }
    }
    function finalizeActive(outcome, reason, extra) {
      const s = active;
      if (!s) return;
      const result2 = buildResult(s, {
        outcome,
        reason,
        resolved: extra == null ? void 0 : extra.resolved,
        style: extra == null ? void 0 : extra.style,
        text: extra == null ? void 0 : extra.text
      });
      clearTimers(s);
      s.disposer.dispose();
      active = null;
      const hadTakenControl = s.phase === "settling" || s.phase === "verifying";
      if (extra == null ? void 0 : extra.toolbar) {
        setToolbar(extra.toolbar.status, extra.toolbar.message);
      } else if (outcome === "skipped" && hadTakenControl) {
        setToolbar("idle");
      }
      emitAndStore(result2);
    }
    function isLatestTxStillSame(txId, txTimestamp) {
      try {
        const undo = options.transactionManager.getUndoStack();
        if (undo.length === 0) return false;
        const latest = undo[undo.length - 1];
        return latest.id === txId && latest.timestamp === txTimestamp;
      } catch (e) {
        return false;
      }
    }
    function isMutationFromOverlay(record) {
      if (!options.isOverlayElement) return false;
      const t = record.target;
      if (t instanceof Element && options.isOverlayElement(t)) return true;
      if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return nodes.some((n) => {
          var _a3;
          return n instanceof Element && ((_a3 = options.isOverlayElement) == null ? void 0 : _a3.call(options, n));
        });
      }
      return false;
    }
    function isDomMutationRelevant(record, target) {
      if (!target) return false;
      if (isMutationFromOverlay(record)) return false;
      const recTarget = record.target;
      if (record.type === "characterData") {
        if (recTarget instanceof Text) {
          const parent = recTarget.parentElement;
          if (parent && (parent === target || parent.contains(target) || target.contains(parent))) {
            return true;
          }
        }
        return false;
      }
      if (!(recTarget instanceof Element)) return false;
      if (record.type === "attributes") {
        try {
          return recTarget === target || recTarget.contains(target) || target.contains(recTarget);
        } catch (e) {
          return false;
        }
      }
      if (record.type === "childList") {
        try {
          if (recTarget === target || recTarget.contains(target) || target.contains(recTarget))
            return true;
        } catch (e) {
        }
        for (const n of record.removedNodes) {
          if (n === target) return true;
          if (n instanceof Element) {
            try {
              if (n.contains(target)) return true;
            } catch (e) {
            }
          }
        }
      }
      return false;
    }
    function scheduleVerify(s, reason) {
      if (s.disposer.isDisposed) return;
      if (s.phase !== "settling") return;
      if (s.timers.quietTimer !== null) {
        window.clearTimeout(s.timers.quietTimer);
        s.timers.quietTimer = null;
      }
      s.timers.quietTimer = window.setTimeout(() => {
        s.timers.quietTimer = null;
        void runVerify(`quiet:${reason}`);
      }, quietWindowMs);
    }
    function markMutationSignal(s) {
      s.signals.hadRelevantMutation = true;
      scheduleVerify(s, "mutation");
    }
    function enterSettling(s) {
      var _a3, _b3, _c2;
      if (s.disposer.isDisposed) return;
      if (s.phase === "settling" || s.phase === "verifying") return;
      s.phase = "settling";
      s.executionCompletedAt = now();
      setToolbar("verifying", "Waiting for HMR…");
      const head = document.head;
      if (head) {
        s.disposer.observeMutation(
          head,
          () => {
            if ((active == null ? void 0 : active.key) !== s.key || active.phase !== "settling") return;
            markMutationSignal(active);
          },
          HEAD_MUTATION_OPTIONS
        );
      }
      const targetRootNode = (_b3 = (_a3 = s.originalElement) == null ? void 0 : _a3.getRootNode) == null ? void 0 : _b3.call(_a3);
      const domTarget = targetRootNode instanceof ShadowRoot ? targetRootNode : (_c2 = document.body) != null ? _c2 : document.documentElement;
      if (domTarget) {
        s.disposer.observeMutation(
          domTarget,
          (records) => {
            if ((active == null ? void 0 : active.key) !== s.key || active.phase !== "settling") return;
            const el = active.originalElement;
            if (el && !el.isConnected) active.signals.hadElementDisconnect = true;
            if (records.some((r) => isDomMutationRelevant(r, el))) {
              markMutationSignal(active);
            }
          },
          DOM_MUTATION_OPTIONS
        );
      }
      s.timers.deadlineTimer = window.setTimeout(() => {
        if ((active == null ? void 0 : active.key) !== s.key) return;
        finalizeActive("uncertain", "timeout waiting for HMR", {
          toolbar: { status: "uncertain", message: "Uncertain (timeout)" }
        });
      }, settleDeadlineMs);
      s.timers.noSignalTimer = window.setTimeout(() => {
        if ((active == null ? void 0 : active.key) !== s.key || active.phase !== "settling") return;
        void runVerify("no_signal");
      }, noSignalDeadlineMs);
      scheduleVerify(s, "initial");
    }
    function resolveTarget(s) {
      const isOvl = options.isOverlayElement;
      const current = s.originalElement;
      if (current && isValidCandidate(current, isOvl)) {
        return { element: current, source: "current", confidence: "high" };
      }
      const strict = locateElement(s.locator);
      if (strict && isValidCandidate(strict, isOvl)) {
        return { element: strict, source: "strict", confidence: "high" };
      }
      const expected = parseFingerprint(s.locator.fingerprint);
      const relaxedBest = relaxedLocate({
        locator: s.locator,
        expected,
        isOverlayElement: isOvl,
        maxElements: relaxedLocateMaxElements,
        anchorCenter: s.anchorCenter
      });
      if (relaxedBest && isValidCandidate(relaxedBest.element, isOvl)) {
        if (relaxedBest.score >= RELAXED_CONFIDENCE_THRESHOLD) {
          return {
            element: relaxedBest.element,
            source: "relaxed",
            confidence: "medium",
            score: relaxedBest.score
          };
        }
      }
      if (s.anchorCenter) {
        const geoBest = geometricLocate({
          expected,
          locator: s.locator,
          anchorCenter: s.anchorCenter,
          isOverlayElement: isOvl,
          selectionEngine: options.selectionEngine,
          maxCandidates: geometricMaxCandidates
        });
        if (geoBest && isValidCandidate(geoBest.element, isOvl)) {
          if (geoBest.score >= GEOMETRIC_CONFIDENCE_THRESHOLD) {
            return {
              element: geoBest.element,
              source: "geometric",
              confidence: "low",
              score: geoBest.score
            };
          }
        }
      }
      return null;
    }
    function maybeReselect(s, element) {
      var _a3, _b3;
      if (!options.onReselect) return;
      const selected = (_b3 = (_a3 = options.getSelectedElement) == null ? void 0 : _a3.call(options)) != null ? _b3 : null;
      if (selected === element) return;
      s.flags.suppressNextSelectionChange = true;
      options.onReselect(element);
    }
    function verifyStyle(s, element) {
      const spec = s.expectedStyle;
      if (!(spec == null ? void 0 : spec.computed)) return { ok: false };
      const actual = readComputedMap(element, spec.properties);
      const result2 = compareComputed(spec.computed, actual);
      return { ok: true, style: result2 };
    }
    function verifyText(s, element) {
      var _a3;
      const expected = s.expectedText;
      if (expected === null) return { ok: false };
      const actual = normalizeText((_a3 = element.textContent) != null ? _a3 : "");
      return { ok: true, text: { expected, actual, match: expected === actual } };
    }
    function runVerify(trigger) {
      return __async(this, null, function* () {
        const s = active;
        if (!s || s.disposer.isDisposed || s.phase !== "settling" || s.flags.verifying) return;
        s.flags.verifying = true;
        s.phase = "verifying";
        setToolbar("verifying", "Verifying…");
        try {
          if (!isLatestTxStillSame(s.txId, s.txTimestamp)) {
            finalizeActive("skipped", "skipped: new edits detected");
            return;
          }
          if (s.flags.selectionChanged) {
            finalizeActive("skipped", "skipped: selection changed");
            return;
          }
          if (s.originalElement && !s.originalElement.isConnected) {
            s.signals.hadElementDisconnect = true;
          }
          const resolved = resolveTarget(s);
          if (!resolved) {
            finalizeActive("lost", `lost: unable to locate target (${trigger})`, {
              toolbar: { status: "lost", message: "Target lost" }
            });
            return;
          }
          maybeReselect(s, resolved.element);
          const resolvedMeta = {
            source: resolved.source,
            confidence: resolved.confidence,
            score: resolved.score
          };
          const hasHmrSignal = s.signals.hadRelevantMutation || s.signals.hadElementDisconnect;
          if (resolved.confidence === "low") {
            finalizeActive("uncertain", `uncertain: low confidence resolution (${resolved.source})`, {
              resolved: resolvedMeta,
              toolbar: { status: "uncertain", message: "Uncertain (low confidence)" }
            });
            return;
          }
          if (s.txType === "style") {
            const check = verifyStyle(s, resolved.element);
            if (!check.ok || !check.style) {
              finalizeActive("uncertain", "uncertain: missing computed baseline", {
                resolved: resolvedMeta,
                toolbar: { status: "uncertain", message: "Uncertain (no baseline)" }
              });
              return;
            }
            const mismatches = check.style.diffs.filter((d) => !d.match);
            if (mismatches.length > 0) {
              finalizeActive("mismatch", `mismatch: ${mismatches.length} property mismatch`, {
                resolved: resolvedMeta,
                style: check.style,
                toolbar: { status: "mismatch", message: `Mismatch (${mismatches.length})` }
              });
              return;
            }
            if (!hasHmrSignal) {
              finalizeActive("uncertain", "uncertain: no HMR signal observed", {
                resolved: resolvedMeta,
                style: check.style,
                toolbar: { status: "uncertain", message: "Uncertain (no HMR signal)" }
              });
              return;
            }
            finalizeActive("verified", "verified", {
              resolved: resolvedMeta,
              style: check.style,
              toolbar: { status: "verified", message: "Verified" }
            });
            return;
          }
          if (s.txType === "text") {
            const check = verifyText(s, resolved.element);
            if (!check.ok || !check.text) {
              finalizeActive("uncertain", "uncertain: missing text baseline", {
                resolved: resolvedMeta,
                toolbar: { status: "uncertain", message: "Uncertain (no baseline)" }
              });
              return;
            }
            if (!check.text.match) {
              finalizeActive("mismatch", "mismatch: text differs from expected", {
                resolved: resolvedMeta,
                text: check.text,
                toolbar: { status: "mismatch", message: "Mismatch (text)" }
              });
              return;
            }
            if (!hasHmrSignal) {
              finalizeActive("uncertain", "uncertain: no HMR signal observed", {
                resolved: resolvedMeta,
                text: check.text,
                toolbar: { status: "uncertain", message: "Uncertain (no HMR signal)" }
              });
              return;
            }
            finalizeActive("verified", "verified", {
              resolved: resolvedMeta,
              text: check.text,
              toolbar: { status: "verified", message: "Verified" }
            });
            return;
          }
          finalizeActive("skipped", `skipped: tx type "${s.txType}" not supported`);
        } finally {
          if ((active == null ? void 0 : active.key) === s.key) {
            active.flags.verifying = false;
          }
        }
      });
    }
    function start(args) {
      var _a3, _b3;
      const { tx, requestId, sessionId, element } = args;
      if (tx.type !== "style" && tx.type !== "text") return;
      finalizeActive("skipped", "skipped: superseded by new apply");
      const key = `hmr_${now().toString(36)}_${(++sessionSeq).toString(36)}`;
      const sessionDisposer = new Disposer();
      const el = (element == null ? void 0 : element.isConnected) ? element : null;
      const anchorRect = el ? safeReadRect(el) : null;
      const anchorCenter = anchorRect ? rectCenter(anchorRect) : null;
      let expectedStyle = null;
      let expectedText = null;
      if (tx.type === "style") {
        const properties = collectStyleProperties(tx);
        const computed = el ? readComputedMap(el, properties) : null;
        expectedStyle = computed ? { properties, computed } : null;
      } else if (tx.type === "text") {
        const baseline = el ? (_a3 = el.textContent) != null ? _a3 : "" : (_b3 = tx.after.text) != null ? _b3 : "";
        expectedText = normalizeText(baseline);
      }
      active = {
        key,
        phase: "executing",
        requestId: (requestId == null ? void 0 : requestId.trim()) || void 0,
        sessionId: (sessionId == null ? void 0 : sessionId.trim()) || void 0,
        txId: tx.id,
        txTimestamp: tx.timestamp,
        txType: tx.type,
        locator: tx.targetLocator,
        originalElement: el,
        expectedStyle,
        expectedText,
        anchorRect,
        anchorCenter,
        startedAt: now(),
        executionCompletedAt: null,
        signals: { hadRelevantMutation: false, hadElementDisconnect: false },
        flags: { verifying: false, selectionChanged: false, suppressNextSelectionChange: false },
        timers: { quietTimer: null, deadlineTimer: null, noSignalTimer: null },
        disposer: sessionDisposer
      };
      if (!isLatestTxStillSame(tx.id, tx.timestamp)) {
        finalizeActive("skipped", "skipped: transaction no longer latest");
      }
    }
    function onExecutionStatus(state) {
      const s = active;
      if (!s || s.disposer.isDisposed) return;
      if (s.requestId && state.requestId !== s.requestId) return;
      if (!TERMINAL_EXEC_STATUSES.has(state.status)) return;
      if (state.status === "completed") {
        enterSettling(s);
      } else {
        finalizeActive("skipped", `skipped: execution ${state.status}`);
      }
    }
    function onTransactionChange(_event) {
      const s = active;
      if (!s || s.disposer.isDisposed) return;
      if (!isLatestTxStillSame(s.txId, s.txTimestamp)) {
        finalizeActive("skipped", "skipped: new edits detected");
      }
    }
    function onSelectionChange(element) {
      const s = active;
      if (!s || s.disposer.isDisposed) return;
      if (s.flags.suppressNextSelectionChange) {
        s.flags.suppressNextSelectionChange = false;
        return;
      }
      const expected = s.originalElement;
      if (element === null && expected) {
        s.flags.selectionChanged = true;
        finalizeActive("skipped", "skipped: selection cleared");
        return;
      }
      if (expected && element && element !== expected) {
        s.flags.selectionChanged = true;
        finalizeActive("skipped", "skipped: selection changed");
      }
    }
    function getSnapshot() {
      var _a3;
      const s = active;
      return {
        phase: (_a3 = s == null ? void 0 : s.phase) != null ? _a3 : "idle",
        activeRequestId: s == null ? void 0 : s.requestId,
        activeTxId: s == null ? void 0 : s.txId,
        lastResult
      };
    }
    function dispose() {
      disposer.dispose();
      setToolbar("idle");
    }
    return {
      start,
      onExecutionStatus,
      onTransactionChange,
      onSelectionChange,
      getSnapshot,
      dispose
    };
  }
  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }
  function bytesToMb(bytes) {
    return bytes / (1024 * 1024);
  }
  function formatMb(bytes, digits) {
    const mb = bytesToMb(bytes);
    return Number.isFinite(mb) ? mb.toFixed(digits) : "N/A";
  }
  function readPerformanceMemory() {
    try {
      const perf = performance;
      const memory = perf.memory;
      if (!memory) return null;
      const used = memory.usedJSHeapSize;
      const limit = memory.jsHeapSizeLimit;
      const total = memory.totalJSHeapSize;
      if (!isFiniteNumber(used)) return null;
      if (!isFiniteNumber(limit)) return null;
      if (!isFiniteNumber(total)) return null;
      return {
        usedJSHeapSize: used,
        totalJSHeapSize: total,
        jsHeapSizeLimit: limit
      };
    } catch (e) {
      return null;
    }
  }
  function createPerfMonitor(options) {
    var _a2, _b2;
    const disposer = new Disposer();
    const container = options.container;
    const fpsUiIntervalMs = Math.max(
      100,
      Math.floor(options.fpsUiIntervalMs)
    );
    const memorySampleIntervalMs = Math.max(
      250,
      Math.floor(options.memorySampleIntervalMs)
    );
    const root = document.createElement("div");
    root.className = "we-perf-hud";
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
    const fpsEl = document.createElement("div");
    fpsEl.className = "we-perf-hud-line";
    fpsEl.textContent = "FPS: --";
    const heapEl = document.createElement("div");
    heapEl.className = "we-perf-hud-line";
    heapEl.textContent = "Heap: --";
    root.append(fpsEl, heapEl);
    container.append(root);
    disposer.add(() => root.remove());
    let enabled = false;
    let rafId = null;
    let frameCount = 0;
    let lastFpsUiTime = 0;
    let lastMemorySampleTime = 0;
    let lastFpsText = (_a2 = fpsEl.textContent) != null ? _a2 : "";
    let lastHeapText = (_b2 = heapEl.textContent) != null ? _b2 : "";
    function cancelRaf() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }
    disposer.add(cancelRaf);
    function setText(el, next, cache) {
      if (cache === "fps") {
        if (next === lastFpsText) return;
        lastFpsText = next;
      } else {
        if (next === lastHeapText) return;
        lastHeapText = next;
      }
      el.textContent = next;
    }
    function updateHeapText() {
      const memory = readPerformanceMemory();
      if (!memory) {
        setText(heapEl, "Heap: N/A", "heap");
        return;
      }
      const used = formatMb(memory.usedJSHeapSize, 1);
      const limit = formatMb(memory.jsHeapSizeLimit, 0);
      setText(heapEl, `Heap: ${used} / ${limit} MB`, "heap");
    }
    function resetSampling(now) {
      frameCount = 0;
      lastFpsUiTime = now;
      lastMemorySampleTime = now - memorySampleIntervalMs;
      setText(fpsEl, "FPS: --", "fps");
      updateHeapText();
    }
    function scheduleNextFrame() {
      if (disposer.isDisposed) return;
      if (!enabled) return;
      if (rafId !== null) return;
      if (document.visibilityState !== "visible") return;
      rafId = requestAnimationFrame(onFrame);
    }
    function onFrame(now) {
      rafId = null;
      if (disposer.isDisposed) return;
      if (!enabled) return;
      if (document.visibilityState !== "visible") return;
      frameCount += 1;
      const fpsElapsed = now - lastFpsUiTime;
      if (fpsElapsed >= fpsUiIntervalMs) {
        const fps = fpsElapsed > 0 ? frameCount * 1e3 / fpsElapsed : 0;
        const rounded = Math.max(0, Math.round(fps));
        setText(fpsEl, `FPS: ${rounded}`, "fps");
        frameCount = 0;
        lastFpsUiTime = now;
      }
      if (now - lastMemorySampleTime >= memorySampleIntervalMs) {
        lastMemorySampleTime = now;
        updateHeapText();
      }
      scheduleNextFrame();
    }
    function handleVisibilityChange() {
      if (!enabled) return;
      if (document.visibilityState !== "visible") {
        cancelRaf();
        return;
      }
      resetSampling(performance.now());
      scheduleNextFrame();
    }
    disposer.listen(document, "visibilitychange", handleVisibilityChange);
    function setEnabled(next) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled) {
        root.hidden = true;
        cancelRaf();
        return;
      }
      root.hidden = false;
      if (document.visibilityState !== "visible") {
        return;
      }
      resetSampling(performance.now());
      scheduleNextFrame();
    }
    function toggle() {
      setEnabled(!enabled);
      return enabled;
    }
    return {
      isEnabled: () => enabled,
      setEnabled,
      toggle,
      dispose: () => {
        enabled = false;
        root.hidden = true;
        disposer.dispose();
      }
    };
  }
  const DEFAULT_MAX_DECLARATIONS_PER_TOKEN = 50;
  const DEFAULT_MAX_INLINE_DEPTH = 8;
  function createTokenDetector(options = {}) {
    var _a2, _b2;
    const maxDeclarationsPerToken = Math.max(
      1,
      Math.floor((_a2 = options.maxDeclarationsPerToken) != null ? _a2 : DEFAULT_MAX_DECLARATIONS_PER_TOKEN)
    );
    const defaultInlineDepth = Math.max(
      0,
      Math.floor((_b2 = options.maxInlineDepth) != null ? _b2 : DEFAULT_MAX_INLINE_DEPTH)
    );
    function safeReadCssRules2(sheet) {
      try {
        return sheet.cssRules;
      } catch (e) {
        return null;
      }
    }
    function isSheetApplicable2(sheet) {
      var _a3, _b3, _c;
      if (sheet.disabled) return false;
      try {
        const mediaText = (_c = (_b3 = (_a3 = sheet.media) == null ? void 0 : _a3.mediaText) == null ? void 0 : _b3.trim()) != null ? _c : "";
        if (!mediaText || mediaText.toLowerCase() === "all") return true;
        return window.matchMedia(mediaText).matches;
      } catch (e) {
        return true;
      }
    }
    function describeStyleSheet2(sheet, fallbackIndex) {
      var _a3, _b3;
      const href = typeof sheet.href === "string" ? sheet.href : void 0;
      if (href) {
        const file = (_b3 = (_a3 = href.split("/").pop()) == null ? void 0 : _a3.split("?")[0]) != null ? _b3 : href;
        return { url: href, label: file };
      }
      const ownerNode = sheet.ownerNode;
      if ((ownerNode == null ? void 0 : ownerNode.nodeType) === Node.ELEMENT_NODE) {
        const el = ownerNode;
        const tag = el.tagName.toLowerCase();
        return { label: `<${tag} #${fallbackIndex}>` };
      }
      return { label: `<constructed #${fallbackIndex}>` };
    }
    function evalMediaRule2(rule, warnings) {
      var _a3, _b3, _c;
      try {
        const mediaText = (_c = (_b3 = (_a3 = rule.media) == null ? void 0 : _a3.mediaText) == null ? void 0 : _b3.trim()) != null ? _c : "";
        if (!mediaText || mediaText.toLowerCase() === "all") return true;
        return window.matchMedia(mediaText).matches;
      } catch (e) {
        warnings.push(`Failed to evaluate @media: ${String(e)}`);
        return false;
      }
    }
    function evalSupportsRule2(rule, warnings) {
      var _a3, _b3;
      try {
        const cond = (_b3 = (_a3 = rule.conditionText) == null ? void 0 : _a3.trim()) != null ? _b3 : "";
        if (!cond) return true;
        if (typeof (CSS == null ? void 0 : CSS.supports) !== "function") return true;
        return CSS.supports(cond);
      } catch (e) {
        warnings.push(`Failed to evaluate @supports: ${String(e)}`);
        return false;
      }
    }
    function extractCustomProperties(style) {
      var _a3, _b3, _c;
      const results = [];
      const len = Number((_a3 = style == null ? void 0 : style.length) != null ? _a3 : 0);
      for (let i = 0; i < len; i++) {
        let name = "";
        try {
          name = String((_b3 = style.item(i)) != null ? _b3 : "").trim();
        } catch (e) {
          continue;
        }
        if (!name.startsWith("--")) continue;
        let value = "";
        let important = false;
        try {
          value = String((_c = style.getPropertyValue(name)) != null ? _c : "").trim();
          important = style.getPropertyPriority(name) === "important";
        } catch (e) {
        }
        results.push({ name, value, important });
      }
      return results;
    }
    function collectRootIndex(root) {
      var _a3, _b3, _c;
      const rootType = root instanceof ShadowRoot ? "shadow" : "document";
      const warnings = [];
      const tokens = /* @__PURE__ */ new Map();
      let rulesScanned = 0;
      let totalDeclarations = 0;
      let order = 0;
      function addDeclaration(decl) {
        var _a4;
        const list = (_a4 = tokens.get(decl.name)) != null ? _a4 : [];
        if (list.length >= maxDeclarationsPerToken) return;
        list.push(__spreadProps(__spreadValues({}, decl), { order: order++ }));
        tokens.set(decl.name, list);
        totalDeclarations++;
      }
      function walkRules(rules, context) {
        var _a4, _b4, _c2, _d, _e, _f;
        for (const rule of Array.from(rules)) {
          rulesScanned++;
          if (rule.type === CSSRule.IMPORT_RULE) {
            const importRule = rule;
            const imported = importRule.styleSheet;
            if (imported && !context.visited.has(imported)) {
              try {
                const importMedia = (_c2 = (_b4 = (_a4 = importRule.media) == null ? void 0 : _a4.mediaText) == null ? void 0 : _b4.trim()) != null ? _c2 : "";
                if (importMedia && importMedia.toLowerCase() !== "all") {
                  if (!window.matchMedia(importMedia).matches) {
                    continue;
                  }
                }
              } catch (e) {
              }
              if (!isSheetApplicable2(imported)) continue;
              const importedRules = safeReadCssRules2(imported);
              const importSource = describeStyleSheet2(imported, context.sheetIndex);
              if (!importedRules) {
                warnings.push(
                  `Skipped @import (cross-origin): ${(_d = importSource.url) != null ? _d : importSource.label}`
                );
                continue;
              }
              context.visited.add(imported);
              try {
                walkRules(importedRules, __spreadProps(__spreadValues({}, context), {
                  source: importSource
                }));
              } finally {
                context.visited.delete(imported);
              }
            }
            continue;
          }
          if (rule.type === CSSRule.MEDIA_RULE) {
            if (evalMediaRule2(rule, warnings)) {
              walkRules(rule.cssRules, context);
            }
            continue;
          }
          if (rule.type === CSSRule.SUPPORTS_RULE) {
            if (evalSupportsRule2(rule, warnings)) {
              walkRules(rule.cssRules, context);
            }
            continue;
          }
          if (rule.type === CSSRule.STYLE_RULE) {
            const styleRule = rule;
            const selectorText = String((_e = styleRule.selectorText) != null ? _e : "").trim() || void 0;
            const customProps = extractCustomProperties(styleRule.style);
            for (const prop of customProps) {
              addDeclaration({
                name: prop.name,
                value: prop.value,
                important: prop.important,
                origin: "rule",
                rootType,
                styleSheet: context.source,
                selectorText
              });
            }
            continue;
          }
          const anyRule = rule;
          if ((_f = anyRule.cssRules) == null ? void 0 : _f.length) {
            try {
              walkRules(anyRule.cssRules, context);
            } catch (e) {
            }
          }
        }
      }
      const docOrShadow = root;
      const styleSheets = [];
      try {
        for (const s of Array.from((_a3 = docOrShadow.styleSheets) != null ? _a3 : [])) {
          if (s instanceof CSSStyleSheet) styleSheets.push(s);
        }
      } catch (e) {
      }
      try {
        const adopted = Array.from((_b3 = docOrShadow.adoptedStyleSheets) != null ? _b3 : []);
        for (const s of adopted) {
          if (s instanceof CSSStyleSheet) styleSheets.push(s);
        }
      } catch (e) {
      }
      for (let sheetIndex = 0; sheetIndex < styleSheets.length; sheetIndex++) {
        const sheet = styleSheets[sheetIndex];
        if (!isSheetApplicable2(sheet)) continue;
        const sheetSource = describeStyleSheet2(sheet, sheetIndex);
        const cssRules = safeReadCssRules2(sheet);
        if (!cssRules) {
          warnings.push(`Skipped stylesheet (cross-origin): ${(_c = sheetSource.url) != null ? _c : sheetSource.label}`);
          continue;
        }
        const visited = /* @__PURE__ */ new Set([sheet]);
        walkRules(cssRules, {
          sheetIndex,
          source: sheetSource,
          visited
        });
      }
      const stats = {
        styleSheets: styleSheets.length,
        rulesScanned,
        tokens: tokens.size,
        declarations: totalDeclarations
      };
      return {
        rootType,
        tokens,
        warnings: [...new Set(warnings)],
        // Deduplicate
        stats
      };
    }
    function getParentElementOrHost2(element) {
      var _a3;
      if (element.parentElement) return element.parentElement;
      try {
        const root = (_a3 = element.getRootNode) == null ? void 0 : _a3.call(element);
        if (root instanceof ShadowRoot) return root.host;
      } catch (e) {
      }
      return null;
    }
    function collectInlineTokenNames(element, options2) {
      var _a3, _b3, _c;
      const maxDepth = Math.max(0, Math.floor((_a3 = options2 == null ? void 0 : options2.maxDepth) != null ? _a3 : defaultInlineDepth));
      const result2 = /* @__PURE__ */ new Set();
      let current = element;
      let depth = 0;
      while (current && depth <= maxDepth) {
        depth++;
        try {
          const style = current.style;
          if (style) {
            const len = Number((_b3 = style.length) != null ? _b3 : 0);
            for (let i = 0; i < len; i++) {
              const name = String((_c = style.item(i)) != null ? _c : "").trim();
              if (name.startsWith("--")) {
                result2.add(name);
              }
            }
          }
        } catch (e) {
        }
        current = getParentElementOrHost2(current);
      }
      return result2;
    }
    return {
      collectRootIndex,
      collectInlineTokenNames
    };
  }
  function createTokenResolver(options = {}) {
    const enableProbe = Boolean(options.enableProbe);
    function formatCssVar(name, fallback) {
      const fb = typeof fallback === "string" ? fallback.trim() : "";
      return fb ? `var(${name}, ${fb})` : `var(${name})`;
    }
    function parseCssVar(value) {
      const raw = String(value != null ? value : "").trim();
      if (!raw.toLowerCase().startsWith("var(")) return null;
      let depth = 0;
      let endIndex = -1;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth--;
          if (depth === 0) {
            endIndex = i;
            break;
          }
        }
      }
      if (endIndex < 0 || endIndex !== raw.length - 1) return null;
      const inner = raw.slice(4, endIndex).trim();
      if (!inner) return null;
      let commaIndex = -1;
      depth = 0;
      for (let i = 0; i < inner.length; i++) {
        const ch = inner[i];
        if (ch === "(") {
          depth++;
        } else if (ch === ")") {
          depth = Math.max(0, depth - 1);
        } else if (ch === "," && depth === 0) {
          commaIndex = i;
          break;
        }
      }
      const nameStr = (commaIndex >= 0 ? inner.slice(0, commaIndex) : inner).trim();
      const fallbackStr = commaIndex >= 0 ? inner.slice(commaIndex + 1).trim() : "";
      if (!nameStr.startsWith("--")) return null;
      const name = nameStr;
      return fallbackStr ? { name, fallback: fallbackStr } : { name };
    }
    function extractCssVarNames(value) {
      var _a2;
      const results = [];
      const str = String(value != null ? value : "");
      const regex = /var\(\s*(--[\w-]+)/g;
      let match;
      while (match = regex.exec(str)) {
        const name = (_a2 = match[1]) == null ? void 0 : _a2.trim();
        if (name == null ? void 0 : name.startsWith("--")) {
          results.push(name);
        }
      }
      return results;
    }
    function readComputedValue2(element, name) {
      try {
        const computed = window.getComputedStyle(element);
        return computed.getPropertyValue(name).trim();
      } catch (e) {
        return "";
      }
    }
    function resolveToken(element, name) {
      const computedValue = readComputedValue2(element, name);
      return {
        token: name,
        computedValue,
        availability: computedValue ? "available" : "unset"
      };
    }
    function resolveTokenForProperty(element, name, cssProperty, options2 = {}) {
      const cssValue = formatCssVar(name, options2.fallback);
      const method = enableProbe && options2.preview ? "probe" : "computed";
      let resolvedValue;
      if (method === "computed" && options2.preview) {
        resolvedValue = readComputedValue2(element, name) || void 0;
      }
      return {
        token: name,
        cssProperty,
        cssValue,
        resolvedValue,
        method
      };
    }
    return {
      formatCssVar,
      parseCssVar,
      extractCssVarNames,
      readComputedValue: readComputedValue2,
      resolveToken,
      resolveTokenForProperty
    };
  }
  function createDesignTokensService(options = {}) {
    var _a2, _b2, _c, _d, _e;
    const disposer = new Disposer();
    const getNow = (_a2 = options.now) != null ? _a2 : (() => performance.now());
    const cacheMaxAgeMs = Math.max(0, Math.floor((_b2 = options.cacheMaxAgeMs) != null ? _b2 : 0));
    const observeHead = options.observeHead !== false;
    const observeShadowRoots = Boolean(options.observeShadowRoots);
    const maxInlineDepth = Math.max(0, Math.floor((_c = options.maxInlineDepth) != null ? _c : 8));
    const detector = (_d = options.detector) != null ? _d : createTokenDetector(options.detectorOptions);
    const resolver = (_e = options.resolver) != null ? _e : createTokenResolver(options.resolverOptions);
    const rootCache = /* @__PURE__ */ new WeakMap();
    const observedRoots = /* @__PURE__ */ new WeakSet();
    const invalidationListeners = /* @__PURE__ */ new Set();
    function getRootType(root) {
      return root instanceof ShadowRoot ? "shadow" : "document";
    }
    function emitInvalidation(root, reason) {
      const event = {
        root,
        rootType: getRootType(root),
        reason,
        timestamp: getNow()
      };
      for (const handler of invalidationListeners) {
        try {
          handler(event);
        } catch (e) {
        }
      }
    }
    function getElementRoot2(element) {
      var _a3, _b3, _c2;
      try {
        const root = (_a3 = element.getRootNode) == null ? void 0 : _a3.call(element);
        if (root instanceof ShadowRoot) return root;
        return (_b3 = element.ownerDocument) != null ? _b3 : document;
      } catch (e) {
        return (_c2 = element.ownerDocument) != null ? _c2 : document;
      }
    }
    function ensureObserved(root) {
      if (observedRoots.has(root)) return;
      observedRoots.add(root);
      if (root instanceof ShadowRoot) {
        if (!observeShadowRoots) return;
        disposer.observeMutation(root, () => invalidateRoot(root, "shadow_mutation"), {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true
        });
        return;
      }
      if (!observeHead) return;
      const head = root.head;
      if (!head) return;
      disposer.observeMutation(head, () => invalidateRoot(root, "head_mutation"), {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true
      });
    }
    function getOrCollectIndex(root) {
      const cached = rootCache.get(root);
      if (cached) {
        if (cacheMaxAgeMs > 0) {
          const age = getNow() - cached.collectedAt;
          if (age >= cacheMaxAgeMs) {
            invalidateRoot(root, "ttl");
          } else {
            return cached.index;
          }
        } else {
          return cached.index;
        }
      }
      const index = detector.collectRootIndex(root);
      rootCache.set(root, { index, collectedAt: getNow() });
      return index;
    }
    function invalidateRoot(root, reason = "manual") {
      rootCache.delete(root);
      emitInvalidation(root, reason);
    }
    function toDesignToken(name, declarations) {
      const sorted = [...declarations].sort((a, b) => a.order - b.order);
      return { name, kind: "unknown", declarations: sorted };
    }
    function getRootTokens(root, options2 = {}) {
      ensureObserved(root);
      const index = getOrCollectIndex(root);
      const tokens = [];
      for (const [name, declarations] of index.tokens) {
        tokens.push(toDesignToken(name, declarations));
      }
      if (options2.sortByName !== false) {
        tokens.sort((a, b) => a.name.localeCompare(b.name));
      }
      return {
        tokens,
        warnings: index.warnings,
        stats: index.stats
      };
    }
    function getContextTokens(element, options2 = {}) {
      var _a3, _b3;
      const root = getElementRoot2(element);
      ensureObserved(root);
      const index = getOrCollectIndex(root);
      const candidateNames = /* @__PURE__ */ new Set();
      for (const name of index.tokens.keys()) {
        candidateNames.add(name);
      }
      const includeInline = options2.includeInlineAncestors !== false;
      if (includeInline) {
        const inlineDepth = (_a3 = options2.inlineMaxDepth) != null ? _a3 : maxInlineDepth;
        const inlineNames = detector.collectInlineTokenNames(element, {
          maxDepth: inlineDepth
        });
        for (const name of inlineNames) {
          candidateNames.add(name);
        }
      }
      const results = [];
      let computedStyle = null;
      try {
        computedStyle = window.getComputedStyle(element);
      } catch (e) {
      }
      if (computedStyle) {
        for (const name of candidateNames) {
          let computedValue = "";
          try {
            computedValue = computedStyle.getPropertyValue(name).trim();
          } catch (e) {
          }
          if (!computedValue) continue;
          const declarations = (_b3 = index.tokens.get(name)) != null ? _b3 : [];
          results.push({
            token: toDesignToken(name, declarations),
            computedValue
          });
        }
      }
      if (options2.sortByName !== false) {
        results.sort((a, b) => a.token.name.localeCompare(b.token.name));
      }
      return {
        tokens: results,
        warnings: index.warnings,
        stats: index.stats
      };
    }
    function resolveToken(element, name) {
      return resolver.resolveToken(element, name);
    }
    function resolveTokenForProperty(element, name, cssProperty, options2) {
      return resolver.resolveTokenForProperty(element, name, cssProperty, options2);
    }
    function formatCssVar(name, fallback) {
      return resolver.formatCssVar(name, fallback);
    }
    function parseCssVar(value) {
      return resolver.parseCssVar(value);
    }
    function extractCssVarNames(value) {
      return resolver.extractCssVarNames(value);
    }
    function applyTokenToStyle(transactionManager, target, cssProperty, tokenName, options2) {
      const value = formatCssVar(tokenName, options2 == null ? void 0 : options2.fallback);
      return transactionManager.applyStyle(target, cssProperty, value, {
        merge: options2 == null ? void 0 : options2.merge
      });
    }
    function onInvalidation(handler) {
      invalidationListeners.add(handler);
      return () => invalidationListeners.delete(handler);
    }
    function dispose() {
      invalidationListeners.clear();
      disposer.dispose();
    }
    return {
      getRootTokens,
      getContextTokens,
      resolveToken,
      resolveTokenForProperty,
      formatCssVar,
      parseCssVar,
      extractCssVarNames,
      invalidateRoot,
      onInvalidation,
      applyTokenToStyle,
      dispose
    };
  }
  function createWebEditorV2() {
    const state = {
      active: false,
      shadowHost: null,
      canvasOverlay: null,
      handlesController: null,
      eventController: null,
      positionTracker: null,
      selectionEngine: null,
      dragReorderController: null,
      transactionManager: null,
      executionTracker: null,
      hmrConsistencyVerifier: null,
      toolbar: null,
      breadcrumbs: null,
      propertyPanel: null,
      propsBridge: null,
      tokensService: null,
      perfMonitor: null,
      perfHotkeyCleanup: null,
      hoveredElement: null,
      pendingHoverTransition: false,
      selectedElement: null,
      applyingSnapshot: null,
      toolbarPosition: null,
      propertyPanelPosition: null,
      uiResizeCleanup: null
    };
    const DEFAULT_MODIFIERS = {
      alt: false,
      shift: false,
      ctrl: false,
      meta: false
    };
    let editSession = null;
    function isTextEditTarget(element) {
      if (!(element instanceof HTMLElement)) return false;
      if (element instanceof HTMLInputElement) return false;
      if (element instanceof HTMLTextAreaElement) return false;
      if (element.childElementCount > 0) return false;
      return true;
    }
    function restoreEditTarget(session) {
      const { element, beforeContentEditable, beforeSpellcheck } = session;
      if (beforeContentEditable === null) {
        element.removeAttribute("contenteditable");
      } else {
        element.setAttribute("contenteditable", beforeContentEditable);
      }
      element.spellcheck = beforeSpellcheck;
      element.removeEventListener("keydown", session.keydownHandler, true);
      element.removeEventListener("blur", session.blurHandler, true);
    }
    function commitEdit() {
      var _a2, _b2;
      const session = editSession;
      if (!session) return;
      editSession = null;
      const element = session.element;
      const afterText = (_a2 = element.textContent) != null ? _a2 : "";
      element.textContent = afterText;
      restoreEditTarget(session);
      if (session.beforeText !== afterText) {
        (_b2 = state.transactionManager) == null ? void 0 : _b2.recordText(element, session.beforeText, afterText);
      }
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Text edit committed`);
    }
    function cancelEdit() {
      const session = editSession;
      if (!session) return;
      editSession = null;
      session.element.textContent = session.beforeText;
      restoreEditTarget(session);
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Text edit cancelled`);
    }
    function startEdit(element, modifiers) {
      var _a2;
      if (!isTextEditTarget(element)) return false;
      if (!element.isConnected) return false;
      if (state.selectedElement !== element) {
        handleSelect(element, modifiers);
      }
      if ((editSession == null ? void 0 : editSession.element) === element) return true;
      if (editSession) {
        commitEdit();
      }
      const beforeText = (_a2 = element.textContent) != null ? _a2 : "";
      const beforeContentEditable = element.getAttribute("contenteditable");
      const beforeSpellcheck = element.spellcheck;
      const keydownHandler = (ev) => {
        var _a3;
        if (ev.key !== "Escape") return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.stopImmediatePropagation();
        cancelEdit();
        (_a3 = state.eventController) == null ? void 0 : _a3.setMode("selecting");
      };
      const blurHandler = () => {
        var _a3;
        commitEdit();
        (_a3 = state.eventController) == null ? void 0 : _a3.setMode("selecting");
      };
      element.addEventListener("keydown", keydownHandler, true);
      element.addEventListener("blur", blurHandler, true);
      element.setAttribute("contenteditable", "true");
      element.spellcheck = false;
      try {
        element.focus({ preventScroll: true });
      } catch (e) {
        try {
          element.focus();
        } catch (e2) {
        }
      }
      editSession = {
        element,
        beforeText,
        beforeContentEditable,
        beforeSpellcheck,
        keydownHandler,
        blurHandler
      };
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Text edit started`);
      return true;
    }
    function handleHover(element) {
      const prevElement = state.hoveredElement;
      state.hoveredElement = element;
      const shouldAnimate = prevElement !== null && element !== null && prevElement !== element;
      state.pendingHoverTransition = shouldAnimate;
      if (state.positionTracker) {
        state.positionTracker.setHoverElement(element);
        state.positionTracker.forceUpdate();
      }
    }
    function handleSelect(element, modifiers) {
      var _a2, _b2, _c, _d;
      if (editSession && editSession.element !== element) {
        commitEdit();
      }
      state.selectedElement = element;
      state.hoveredElement = null;
      if (state.positionTracker) {
        state.positionTracker.setHoverElement(null);
        state.positionTracker.setSelectionElement(element);
        state.positionTracker.forceUpdate();
      }
      (_a2 = state.breadcrumbs) == null ? void 0 : _a2.setTarget(element);
      (_b2 = state.propertyPanel) == null ? void 0 : _b2.setTarget(element);
      (_c = state.handlesController) == null ? void 0 : _c.setTarget(element);
      (_d = state.hmrConsistencyVerifier) == null ? void 0 : _d.onSelectionChange(element);
      broadcastSelectionChanged(element);
      const modInfo = modifiers.alt ? " (Alt: drill-up)" : "";
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Selected${modInfo}:`, element.tagName, element);
    }
    function handleDeselect() {
      var _a2, _b2, _c, _d;
      state.selectedElement = null;
      if (state.positionTracker) {
        state.positionTracker.setSelectionElement(null);
        state.positionTracker.forceUpdate();
      }
      (_a2 = state.breadcrumbs) == null ? void 0 : _a2.setTarget(null);
      (_b2 = state.propertyPanel) == null ? void 0 : _b2.setTarget(null);
      (_c = state.handlesController) == null ? void 0 : _c.setTarget(null);
      (_d = state.hmrConsistencyVerifier) == null ? void 0 : _d.onSelectionChange(null);
      broadcastSelectionChanged(null);
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Deselected`);
    }
    function handlePositionUpdate(rects) {
      var _a2, _b2;
      (_a2 = state.breadcrumbs) == null ? void 0 : _a2.setAnchorRect(rects.selection);
      const animateHover = state.pendingHoverTransition;
      state.pendingHoverTransition = false;
      if (!state.canvasOverlay) return;
      state.canvasOverlay.setHoverRect(rects.hover, { animate: animateHover });
      state.canvasOverlay.setSelectionRect(rects.selection);
      (_b2 = state.handlesController) == null ? void 0 : _b2.setSelectionRect(rects.selection);
      state.canvasOverlay.render();
    }
    const TX_CHANGED_BROADCAST_DEBOUNCE_MS = 100;
    let txChangedBroadcastTimer = null;
    let pendingTxAction = "push";
    function broadcastTxChanged(action) {
      pendingTxAction = action;
      const shouldBroadcastImmediately = action === "clear";
      if (txChangedBroadcastTimer !== null) {
        window.clearTimeout(txChangedBroadcastTimer);
        txChangedBroadcastTimer = null;
      }
      const doBroadcast = () => {
        var _a2;
        const tm = state.transactionManager;
        if (!tm) return;
        const undoStack = tm.getUndoStack();
        const redoStack = tm.getRedoStack();
        const elements = aggregateTransactionsByElement(undoStack);
        const payload = {
          tabId: 0,
          // Will be filled by background script from sender.tab.id
          action: pendingTxAction,
          elements,
          undoCount: undoStack.length,
          redoCount: redoStack.length,
          hasApplicableChanges: elements.length > 0,
          pageUrl: window.location.href
        };
        if (typeof chrome !== "undefined" && ((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) {
          chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TX_CHANGED,
            payload
          }).catch(() => {
          });
        }
      };
      if (shouldBroadcastImmediately) {
        doBroadcast();
      } else {
        txChangedBroadcastTimer = window.setTimeout(doBroadcast, TX_CHANGED_BROADCAST_DEBOUNCE_MS);
      }
    }
    let lastBroadcastedSelectionKey = null;
    function broadcastSelectionChanged(element) {
      var _a2;
      let selected = null;
      if (element) {
        const elementKey = generateStableElementKey(element);
        if (elementKey === lastBroadcastedSelectionKey) return;
        lastBroadcastedSelectionKey = elementKey;
        const locator = createElementLocator(element);
        selected = {
          elementKey,
          locator,
          label: generateElementLabel(element),
          fullLabel: generateFullElementLabel(element),
          tagName: element.tagName.toLowerCase(),
          updatedAt: Date.now()
        };
      } else {
        if (lastBroadcastedSelectionKey === null) return;
        lastBroadcastedSelectionKey = null;
      }
      const payload = {
        tabId: 0,
        // Will be filled by background script from sender.tab.id
        selected,
        pageUrl: window.location.href
      };
      if (typeof chrome !== "undefined" && ((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) {
        chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_SELECTION_CHANGED,
          payload
        }).catch(() => {
        });
      }
    }
    function broadcastEditorCleared() {
      var _a2;
      lastBroadcastedSelectionKey = null;
      if (typeof chrome === "undefined" || !((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) return;
      const pageUrl = window.location.href;
      const txPayload = {
        tabId: 0,
        action: "clear",
        elements: [],
        undoCount: 0,
        redoCount: 0,
        hasApplicableChanges: false,
        pageUrl
      };
      const selectionPayload = {
        tabId: 0,
        selected: null,
        pageUrl
      };
      chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TX_CHANGED,
        payload: txPayload
      }).catch(() => {
      });
      chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_SELECTION_CHANGED,
        payload: selectionPayload
      }).catch(() => {
      });
    }
    function handleTransactionChange(event) {
      var _a2, _b2, _c;
      const { action, undoCount, redoCount } = event;
      console.log(
        `${WEB_EDITOR_V2_LOG_PREFIX} Transaction: ${action} (undo: ${undoCount}, redo: ${redoCount})`
      );
      (_a2 = state.toolbar) == null ? void 0 : _a2.setHistory(undoCount, redoCount);
      if (action === "undo" || action === "redo") {
        (_b2 = state.propertyPanel) == null ? void 0 : _b2.refresh();
      }
      broadcastTxChanged(action);
      (_c = state.hmrConsistencyVerifier) == null ? void 0 : _c.onTransactionChange(event);
    }
    function applyAllTransactions() {
      return __async(this, null, function* () {
        var _a2;
        const tm = state.transactionManager;
        if (!tm) {
          throw new Error("Transaction manager not ready");
        }
        if (state.applyingSnapshot) {
          throw new Error("Apply already in progress");
        }
        const undoStack = tm.getUndoStack();
        if (undoStack.length === 0) {
          throw new Error("No changes to apply");
        }
        for (const tx of undoStack) {
          if (tx.type === "move") {
            throw new Error("Apply does not support reorder operations yet");
          }
          if (tx.type === "structure") {
            throw new Error("Apply does not support structure operations yet");
          }
          if (tx.type !== "style" && tx.type !== "text" && tx.type !== "class") {
            throw new Error(`Apply does not support "${tx.type}" transactions`);
          }
        }
        const elements = aggregateTransactionsByElement(undoStack);
        if (elements.length === 0) {
          throw new Error("No net changes to apply");
        }
        const latestTx = undoStack[undoStack.length - 1];
        state.applyingSnapshot = {
          txId: latestTx.id,
          txTimestamp: latestTx.timestamp
        };
        try {
          if (typeof chrome === "undefined" || !((_a2 = chrome.runtime) == null ? void 0 : _a2.sendMessage)) {
            throw new Error("Chrome runtime API not available");
          }
          const payload = {
            tabId: 0,
            // Will be filled by background script
            elements,
            excludedKeys: [],
            // TODO: Read from storage if exclude feature is implemented
            pageUrl: window.location.href
          };
          const resp = yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_APPLY_BATCH,
            payload
          });
          const r = resp;
          if (r && r.success === true) {
            const requestId = typeof r.requestId === "string" ? r.requestId : void 0;
            const sessionId = typeof r.sessionId === "string" ? r.sessionId : void 0;
            if (requestId && sessionId && state.executionTracker) {
              state.executionTracker.track(requestId, sessionId);
            }
            tm.clear();
            handleDeselect();
            return { requestId, sessionId };
          }
          const errorMsg = typeof (r == null ? void 0 : r.error) === "string" ? r.error : "Agent request failed";
          throw new Error(errorMsg);
        } finally {
          state.applyingSnapshot = null;
        }
      });
    }
    function revertElement(elementKey) {
      return __async(this, null, function* () {
        var _a2, _b2, _c, _d, _e;
        const key = String(elementKey != null ? elementKey : "").trim();
        if (!key) {
          return { success: false, error: "elementKey is required" };
        }
        const tm = state.transactionManager;
        if (!tm) {
          return { success: false, error: "Transaction manager not ready" };
        }
        if (state.applyingSnapshot) {
          return { success: false, error: "Cannot revert while Apply is in progress" };
        }
        try {
          const undoStack = tm.getUndoStack();
          const summaries = aggregateTransactionsByElement(undoStack);
          const summary = summaries.find((s) => s.elementKey === key);
          if (!summary) {
            return { success: false, error: "Element not found in current changes" };
          }
          const element = locateElement(summary.locator);
          if (!element || !element.isConnected) {
            return { success: false, error: "Failed to locate element for revert" };
          }
          const reverted = {};
          let didRevert = false;
          const classChanges = summary.netEffect.classChanges;
          if (classChanges) {
            const baselineClasses = Array.isArray(classChanges.before) ? classChanges.before : [];
            const beforeClasses = (() => {
              var _a3;
              try {
                const list = element.classList;
                if (list && typeof list[Symbol.iterator] === "function") {
                  return Array.from(list).filter(Boolean);
                }
              } catch (e) {
              }
              const raw = (_a3 = element.getAttribute("class")) != null ? _a3 : "";
              return raw.split(/\s+/).map((t) => t.trim()).filter(Boolean);
            })();
            const tx = tm.recordClass(element, beforeClasses, baselineClasses);
            if (tx) {
              reverted.class = true;
              didRevert = true;
            }
          }
          const textChange = summary.netEffect.textChange;
          if (textChange) {
            const baselineText = String((_a2 = textChange.before) != null ? _a2 : "");
            const beforeText = (_b2 = element.textContent) != null ? _b2 : "";
            if (beforeText !== baselineText) {
              element.textContent = baselineText;
              const tx = tm.recordText(element, beforeText, baselineText);
              if (tx) {
                reverted.text = true;
                didRevert = true;
              }
            }
          }
          const styleChanges = summary.netEffect.styleChanges;
          if (styleChanges) {
            const before = (_c = styleChanges.before) != null ? _c : {};
            const after = (_d = styleChanges.after) != null ? _d : {};
            const properties = Array.from(/* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])).map((p) => String(p != null ? p : "").trim()).filter(Boolean);
            if (properties.length > 0) {
              const handle = tm.beginMultiStyle(element, properties);
              if (handle) {
                handle.set(before);
                const tx = handle.commit({ merge: false });
                if (tx) {
                  reverted.style = true;
                  didRevert = true;
                }
              }
            }
          }
          if (!didRevert) {
            return { success: false, error: "No changes were reverted" };
          }
          (_e = state.propertyPanel) == null ? void 0 : _e.refresh();
          return { success: true, reverted };
        } catch (error) {
          console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Revert element failed:`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
          };
        }
      });
    }
    function clearSelection() {
      if (!state.selectedElement) {
        return;
      }
      if (state.eventController) {
        state.eventController.setMode("hover");
        if (state.selectedElement) {
          handleDeselect();
        }
      } else {
        handleDeselect();
      }
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Selection cleared (from sidepanel)`);
    }
    function handleTransactionError(error) {
      console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Transaction apply error:`, error);
    }
    function start() {
      var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
      if (state.active) {
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Already active`);
        return;
      }
      try {
        state.shadowHost = mountShadowHost({});
        const elements = state.shadowHost.getElements();
        if (!(elements == null ? void 0 : elements.overlayRoot)) {
          throw new Error("Shadow host overlayRoot not available");
        }
        state.canvasOverlay = createCanvasOverlay({
          container: elements.overlayRoot
        });
        state.perfMonitor = createPerfMonitor({
          container: elements.overlayRoot,
          fpsUiIntervalMs: 500,
          memorySampleIntervalMs: 1e3
        });
        const perfHotkeyHandler = (event) => {
          if (event.repeat) return;
          const isMod = event.metaKey || event.ctrlKey;
          if (!isMod) return;
          if (!event.shiftKey) return;
          if (event.altKey) return;
          const key = (event.key || "").toLowerCase();
          if (key !== "p") return;
          const monitor = state.perfMonitor;
          if (!monitor) return;
          monitor.toggle();
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        };
        const hotkeyOptions = { capture: true, passive: false };
        window.addEventListener("keydown", perfHotkeyHandler, hotkeyOptions);
        state.perfHotkeyCleanup = () => {
          window.removeEventListener("keydown", perfHotkeyHandler, hotkeyOptions);
        };
        state.selectionEngine = createSelectionEngine({
          isOverlayElement: state.shadowHost.isOverlayElement
        });
        state.positionTracker = createPositionTracker({
          onPositionUpdate: handlePositionUpdate
        });
        state.transactionManager = createTransactionManager({
          enableKeyBindings: true,
          // Include both Shadow UI events and events from editing element
          // This prevents Ctrl/Cmd+Z from triggering global undo while editing text
          isEventFromEditorUi: (event) => {
            var _a3;
            if ((_a3 = state.shadowHost) == null ? void 0 : _a3.isEventFromUi(event)) return true;
            const session = editSession;
            if (session == null ? void 0 : session.element) {
              try {
                const path = typeof event.composedPath === "function" ? event.composedPath() : null;
                if (path == null ? void 0 : path.some((node) => node === session.element)) return true;
              } catch (e) {
                const target = event.target;
                if (target instanceof Node && session.element.contains(target)) return true;
              }
            }
            return false;
          },
          onChange: handleTransactionChange,
          onApplyError: handleTransactionError
        });
        state.handlesController = createHandlesController({
          container: elements.overlayRoot,
          canvasOverlay: state.canvasOverlay,
          transactionManager: state.transactionManager,
          positionTracker: state.positionTracker
        });
        state.dragReorderController = createDragReorderController({
          isOverlayElement: state.shadowHost.isOverlayElement,
          uiRoot: elements.uiRoot,
          canvasOverlay: state.canvasOverlay,
          positionTracker: state.positionTracker,
          transactionManager: state.transactionManager
        });
        state.eventController = createEventController({
          isOverlayElement: state.shadowHost.isOverlayElement,
          onHover: handleHover,
          onSelect: handleSelect,
          onDeselect: handleDeselect,
          onStartEdit: startEdit,
          findTargetForSelect: (_x, _y, modifiers, event) => {
            var _a3, _b3;
            return (_b3 = (_a3 = state.selectionEngine) == null ? void 0 : _a3.findBestTargetFromEvent(event, modifiers)) != null ? _b3 : null;
          },
          getSelectedElement: () => state.selectedElement,
          onStartDrag: (ev) => {
            var _a3, _b3;
            return (_b3 = (_a3 = state.dragReorderController) == null ? void 0 : _a3.onDragStart(ev)) != null ? _b3 : false;
          },
          onDragMove: (ev) => {
            var _a3;
            return (_a3 = state.dragReorderController) == null ? void 0 : _a3.onDragMove(ev);
          },
          onDragEnd: (ev) => {
            var _a3;
            return (_a3 = state.dragReorderController) == null ? void 0 : _a3.onDragEnd(ev);
          },
          onDragCancel: (ev) => {
            var _a3;
            return (_a3 = state.dragReorderController) == null ? void 0 : _a3.onDragCancel(ev);
          }
        });
        state.executionTracker = createExecutionTracker({
          onStatusChange: (execState) => {
            var _a3, _b3, _c2, _d2, _e2;
            const verifierPhase = (_b3 = (_a3 = state.hmrConsistencyVerifier) == null ? void 0 : _a3.getSnapshot().phase) != null ? _b3 : "idle";
            const verifierActive = verifierPhase !== "idle";
            if (!verifierActive || execState.status !== "completed") {
              const statusMap = {
                pending: "applying",
                starting: "starting",
                running: "running",
                locating: "locating",
                applying: "applying",
                completed: "completed",
                failed: "failed",
                error: "failed",
                // Server may return 'error', treat same as 'failed'
                timeout: "timeout",
                cancelled: "cancelled"
              };
              const toolbarStatus = (_c2 = statusMap[execState.status]) != null ? _c2 : "running";
              (_d2 = state.toolbar) == null ? void 0 : _d2.setStatus(toolbarStatus, execState.message);
            }
            (_e2 = state.hmrConsistencyVerifier) == null ? void 0 : _e2.onExecutionStatus(execState);
          }
        });
        state.hmrConsistencyVerifier = createHmrConsistencyVerifier({
          transactionManager: state.transactionManager,
          getSelectedElement: () => state.selectedElement,
          onReselect: (element) => handleSelect(element, DEFAULT_MODIFIERS),
          onDeselect: handleDeselect,
          setToolbarStatus: (status, message) => {
            var _a3;
            return (_a3 = state.toolbar) == null ? void 0 : _a3.setStatus(status, message);
          },
          isOverlayElement: (_a2 = state.shadowHost) == null ? void 0 : _a2.isOverlayElement,
          selectionEngine: (_b2 = state.selectionEngine) != null ? _b2 : void 0
        });
        state.toolbar = createToolbar({
          container: elements.uiRoot,
          dock: "top",
          initialPosition: state.toolbarPosition,
          onPositionChange: (position) => {
            state.toolbarPosition = position;
          },
          getApplyBlockReason: () => {
            const tm = state.transactionManager;
            if (!tm) return void 0;
            const undoStack = tm.getUndoStack();
            if (undoStack.length === 0) return void 0;
            for (const tx of undoStack) {
              if (tx.type === "move") {
                return "Apply does not support reorder operations yet";
              }
              if (tx.type === "structure") {
                return "Apply does not support structure operations yet";
              }
              if (tx.type !== "style" && tx.type !== "text" && tx.type !== "class") {
                return `Apply does not support "${tx.type}" transactions`;
              }
            }
            return void 0;
          },
          getSelectedElement: () => state.selectedElement,
          onStructure: (data) => {
            const target = state.selectedElement;
            if (!target) return;
            const tm = state.transactionManager;
            if (!tm) return;
            const tx = tm.applyStructure(target, data);
            if (!tx) return;
            if (data.action === "delete") {
              handleDeselect();
            } else {
              const newTarget = locateElement(tx.targetLocator);
              if (newTarget && newTarget.isConnected) {
                handleSelect(newTarget, DEFAULT_MODIFIERS);
              }
            }
          },
          onApply: applyAllTransactions,
          onUndo: () => {
            var _a3;
            return (_a3 = state.transactionManager) == null ? void 0 : _a3.undo();
          },
          onRedo: () => {
            var _a3;
            return (_a3 = state.transactionManager) == null ? void 0 : _a3.redo();
          },
          onRequestClose: () => stop()
        });
        state.toolbar.setHistory(
          state.transactionManager.getUndoStack().length,
          state.transactionManager.getRedoStack().length
        );
        state.breadcrumbs = createBreadcrumbs({
          container: elements.uiRoot,
          dock: "top",
          onSelect: (element) => {
            if (element.isConnected) {
              handleSelect(element, DEFAULT_MODIFIERS);
            }
          }
        });
        state.propsBridge = createPropsBridge({});
        state.tokensService = createDesignTokensService();
        state.propertyPanel = createPropertyPanel({
          container: elements.uiRoot,
          transactionManager: state.transactionManager,
          propsBridge: state.propsBridge,
          tokensService: state.tokensService,
          initialPosition: state.propertyPanelPosition,
          onPositionChange: (position) => {
            state.propertyPanelPosition = position;
          },
          defaultTab: "design",
          onSelectElement: (element) => {
            if (element.isConnected) {
              handleSelect(element, DEFAULT_MODIFIERS);
            }
          },
          onRequestClose: () => stop()
        });
        let uiResizeRafId = null;
        const clampFloatingUi = () => {
          const toolbarPos = state.toolbarPosition;
          const panelPos = state.propertyPanelPosition;
          if (state.toolbar && toolbarPos) {
            state.toolbar.setPosition(toolbarPos);
          }
          if (state.propertyPanel && panelPos) {
            state.propertyPanel.setPosition(panelPos);
          }
        };
        const onWindowResize = () => {
          if (!state.active) return;
          if (uiResizeRafId !== null) return;
          uiResizeRafId = window.requestAnimationFrame(() => {
            uiResizeRafId = null;
            clampFloatingUi();
          });
        };
        window.addEventListener("resize", onWindowResize, { passive: true });
        state.uiResizeCleanup = () => {
          window.removeEventListener("resize", onWindowResize);
          if (uiResizeRafId !== null) {
            window.cancelAnimationFrame(uiResizeRafId);
            uiResizeRafId = null;
          }
        };
        clampFloatingUi();
        state.active = true;
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Started`);
      } catch (error) {
        (_c = state.uiResizeCleanup) == null ? void 0 : _c.call(state);
        state.uiResizeCleanup = null;
        (_d = state.propertyPanel) == null ? void 0 : _d.dispose();
        state.propertyPanel = null;
        (_e = state.tokensService) == null ? void 0 : _e.dispose();
        state.tokensService = null;
        (_f = state.propsBridge) == null ? void 0 : _f.dispose();
        state.propsBridge = null;
        (_g = state.breadcrumbs) == null ? void 0 : _g.dispose();
        state.breadcrumbs = null;
        (_h = state.toolbar) == null ? void 0 : _h.dispose();
        state.toolbar = null;
        (_i = state.eventController) == null ? void 0 : _i.dispose();
        state.eventController = null;
        (_j = state.dragReorderController) == null ? void 0 : _j.dispose();
        state.dragReorderController = null;
        (_k = state.handlesController) == null ? void 0 : _k.dispose();
        state.handlesController = null;
        (_l = state.transactionManager) == null ? void 0 : _l.dispose();
        state.transactionManager = null;
        (_m = state.positionTracker) == null ? void 0 : _m.dispose();
        state.positionTracker = null;
        (_n = state.selectionEngine) == null ? void 0 : _n.dispose();
        state.selectionEngine = null;
        (_o = state.perfHotkeyCleanup) == null ? void 0 : _o.call(state);
        state.perfHotkeyCleanup = null;
        (_p = state.perfMonitor) == null ? void 0 : _p.dispose();
        state.perfMonitor = null;
        (_q = state.canvasOverlay) == null ? void 0 : _q.dispose();
        state.canvasOverlay = null;
        (_r = state.shadowHost) == null ? void 0 : _r.dispose();
        state.shadowHost = null;
        state.hoveredElement = null;
        state.selectedElement = null;
        state.applyingSnapshot = null;
        state.active = false;
        console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Failed to start:`, error);
      }
    }
    function stop() {
      var _a2, _b2, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r;
      if (!state.active) {
        return;
      }
      state.active = false;
      if (txChangedBroadcastTimer !== null) {
        window.clearTimeout(txChangedBroadcastTimer);
        txChangedBroadcastTimer = null;
      }
      try {
        if (editSession) {
          commitEdit();
        }
        (_a2 = state.uiResizeCleanup) == null ? void 0 : _a2.call(state);
        state.uiResizeCleanup = null;
        (_b2 = state.propertyPanel) == null ? void 0 : _b2.dispose();
        state.propertyPanel = null;
        (_c = state.tokensService) == null ? void 0 : _c.dispose();
        state.tokensService = null;
        void ((_d = state.propsBridge) == null ? void 0 : _d.cleanup());
        state.propsBridge = null;
        (_e = state.breadcrumbs) == null ? void 0 : _e.dispose();
        state.breadcrumbs = null;
        (_f = state.toolbar) == null ? void 0 : _f.dispose();
        state.toolbar = null;
        (_g = state.eventController) == null ? void 0 : _g.dispose();
        state.eventController = null;
        (_h = state.dragReorderController) == null ? void 0 : _h.dispose();
        state.dragReorderController = null;
        (_i = state.handlesController) == null ? void 0 : _i.dispose();
        state.handlesController = null;
        (_j = state.executionTracker) == null ? void 0 : _j.dispose();
        state.executionTracker = null;
        (_k = state.hmrConsistencyVerifier) == null ? void 0 : _k.dispose();
        state.hmrConsistencyVerifier = null;
        (_l = state.transactionManager) == null ? void 0 : _l.dispose();
        state.transactionManager = null;
        (_m = state.positionTracker) == null ? void 0 : _m.dispose();
        state.positionTracker = null;
        (_n = state.selectionEngine) == null ? void 0 : _n.dispose();
        state.selectionEngine = null;
        (_o = state.perfHotkeyCleanup) == null ? void 0 : _o.call(state);
        state.perfHotkeyCleanup = null;
        (_p = state.perfMonitor) == null ? void 0 : _p.dispose();
        state.perfMonitor = null;
        (_q = state.canvasOverlay) == null ? void 0 : _q.dispose();
        state.canvasOverlay = null;
        (_r = state.shadowHost) == null ? void 0 : _r.dispose();
        state.shadowHost = null;
        state.hoveredElement = null;
        state.selectedElement = null;
        state.applyingSnapshot = null;
        console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Stopped`);
      } catch (error) {
        console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Error during cleanup:`, error);
        state.propertyPanel = null;
        state.propsBridge = null;
        state.breadcrumbs = null;
        state.toolbar = null;
        state.eventController = null;
        state.dragReorderController = null;
        state.handlesController = null;
        state.transactionManager = null;
        state.positionTracker = null;
        state.selectionEngine = null;
        state.perfHotkeyCleanup = null;
        state.perfMonitor = null;
        state.canvasOverlay = null;
        state.shadowHost = null;
        state.hoveredElement = null;
        state.selectedElement = null;
        state.applyingSnapshot = null;
      } finally {
        broadcastEditorCleared();
      }
    }
    function toggle() {
      if (state.active) {
        stop();
      } else {
        start();
      }
      return state.active;
    }
    function getState() {
      return {
        active: state.active,
        version: WEB_EDITOR_V2_VERSION
      };
    }
    return {
      start,
      stop,
      toggle,
      getState,
      revertElement,
      clearSelection
    };
  }
  const WEB_EDITOR_V2_ACTIONS = {
    /** Check if V2 editor is injected and get status */
    PING: "web_editor_ping_v2",
    /** Toggle V2 editor on/off */
    TOGGLE: "web_editor_toggle_v2",
    /** Start V2 editor */
    START: "web_editor_start_v2",
    /** Stop V2 editor */
    STOP: "web_editor_stop_v2",
    /** Highlight an element (from sidepanel hover) */
    HIGHLIGHT_ELEMENT: "web_editor_highlight_element_v2",
    /** Revert an element to its original state (Phase 2 - Selective Undo) */
    REVERT_ELEMENT: "web_editor_revert_element_v2",
    /** Clear selection (from sidepanel after send) */
    CLEAR_SELECTION: "web_editor_clear_selection_v2"
  };
  function isV2Request(request) {
    if (!request || typeof request !== "object") return false;
    const action = request.action;
    return action === WEB_EDITOR_V2_ACTIONS.PING || action === WEB_EDITOR_V2_ACTIONS.TOGGLE || action === WEB_EDITOR_V2_ACTIONS.START || action === WEB_EDITOR_V2_ACTIONS.STOP;
  }
  function isHighlightRequest(request) {
    if (!request || typeof request !== "object") return false;
    const r = request;
    if (r.action !== WEB_EDITOR_V2_ACTIONS.HIGHLIGHT_ELEMENT) return false;
    if (r.mode !== "hover" && r.mode !== "clear") return false;
    if (r.mode === "clear") return true;
    const hasSelector = typeof r.selector === "string" && r.selector.trim().length > 0;
    const hasLocator = r.locator !== null && typeof r.locator === "object";
    return hasSelector || hasLocator;
  }
  function isRevertRequest(request) {
    if (!request || typeof request !== "object") return false;
    const r = request;
    return r.action === WEB_EDITOR_V2_ACTIONS.REVERT_ELEMENT && typeof r.elementKey === "string" && r.elementKey.trim().length > 0;
  }
  function isClearSelectionRequest(request) {
    if (!request || typeof request !== "object") return false;
    const r = request;
    return r.action === WEB_EDITOR_V2_ACTIONS.CLEAR_SELECTION;
  }
  let currentHighlightOverlay = null;
  function clearHighlight() {
    if (currentHighlightOverlay && currentHighlightOverlay.parentNode) {
      currentHighlightOverlay.parentNode.removeChild(currentHighlightOverlay);
    }
    currentHighlightOverlay = null;
  }
  function showHighlight(element) {
    clearHighlight();
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.setAttribute("data-web-editor-highlight", "true");
    overlay.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    background-color: rgba(59, 130, 246, 0.15);
    border: 2px solid rgba(59, 130, 246, 0.8);
    border-radius: 4px;
    pointer-events: none;
    z-index: 2147483646;
    box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
    transition: all 0.15s ease;
  `;
    document.body.appendChild(overlay);
    currentHighlightOverlay = overlay;
  }
  function findElementBySelector(selector) {
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }
  function installMessageListener(api) {
    const listener = (request, _sender, sendResponse) => {
      if (isHighlightRequest(request)) {
        if (request.mode === "clear") {
          clearHighlight();
          sendResponse({ success: true });
        } else {
          let element = null;
          if (request.locator) {
            try {
              element = locateElement(request.locator);
            } catch (e) {
              element = null;
            }
          }
          if (!element && typeof request.selector === "string") {
            element = findElementBySelector(request.selector);
          }
          if (element) {
            showHighlight(element);
            sendResponse({ success: true });
          } else {
            sendResponse({ success: false, error: "Element not found" });
          }
        }
        return false;
      }
      if (isRevertRequest(request)) {
        (() => __async(null, null, function* () {
          try {
            const result2 = yield api.revertElement(request.elementKey);
            sendResponse(result2);
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }))();
        return true;
      }
      if (isClearSelectionRequest(request)) {
        api.clearSelection();
        sendResponse({ success: true });
        return false;
      }
      if (!isV2Request(request)) {
        return false;
      }
      switch (request.action) {
        case WEB_EDITOR_V2_ACTIONS.PING: {
          const response = {
            status: "pong",
            active: api.getState().active,
            version: 2
          };
          sendResponse(response);
          return false;
        }
        case WEB_EDITOR_V2_ACTIONS.TOGGLE: {
          const response = {
            active: api.toggle()
          };
          sendResponse(response);
          return false;
        }
        case WEB_EDITOR_V2_ACTIONS.START: {
          api.start();
          const response = {
            active: true
          };
          sendResponse(response);
          return false;
        }
        case WEB_EDITOR_V2_ACTIONS.STOP: {
          api.stop();
          const response = {
            active: false
          };
          sendResponse(response);
          return false;
        }
        default:
          return false;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      clearHighlight();
    };
  }
  const definition = defineUnlistedScript(() => {
    if (window !== window.top) {
      return;
    }
    if (window.__MCP_WEB_EDITOR_V2__) {
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Already installed, skipping initialization`);
      return;
    }
    const api = createWebEditorV2();
    window.__MCP_WEB_EDITOR_V2__ = api;
    installMessageListener(api);
    console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Installed successfully`);
  });
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
      return yield definition.main();
    } catch (err) {
      logger.error(
        `The unlisted script "${"web-editor-v2"}" crashed on startup!`,
        err
      );
      throw err;
    }
  }))();
  return result;
})();
webEditorV2;