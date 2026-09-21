var __defProp = Object.defineProperty;
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
import "./_virtual_wxt-html-plugins-Cyikj0JH.js";
import { d as defineComponent, b as createElementBlock, z as createCommentVNode, e as openBlock, y as createBaseVNode, H as toDisplayString, F as Fragment, O as renderList, X as withModifiers, _ as _export_sfc, n as normalizeClass, A as createBlock, u as unref, L as createVNode, a as computed, r as ref, o as onMounted, K as onUnmounted, Y as withDirectives, a2 as vShow, V as createStaticVNode, G as createTextVNode, M as withCtx, a3 as Transition, a1 as createApp } from "./_plugin-vue_export-helper-DRi44jog.js";
import { N as NativeMessageType } from "./index-BYjKghw9.js";
/* empty css                    */
import { u as useAgentTheme, p as preloadAgentTheme } from "./useAgentTheme-PaQCh03y.js";
import { P as PREDEFINED_MODELS, g as getCacheStats, c as cleanupModelCache, a as clearModelCache, b as getModelInfo } from "./semantic-similarity-engine-wZuaUprX.js";
import { B as BACKGROUND_MESSAGE_TYPES } from "./message-types-DUXLbMdM.js";
import { L as LINKS } from "./constants-Dw2yqhzZ.js";
import "./_commonjsHelpers-D8RWm_os.js";
const fallbackMessages = {
  // Extension metadata
  extensionName: "chrome-mcp-server",
  extensionDescription: "Exposes browser capabilities with your own chrome",
  // Section headers
  nativeServerConfigLabel: "Native Server Configuration",
  semanticEngineLabel: "Semantic Engine",
  embeddingModelLabel: "Embedding Model",
  indexDataManagementLabel: "Index Data Management",
  modelCacheManagementLabel: "Model Cache Management",
  // Status labels
  statusLabel: "Status",
  runningStatusLabel: "Running Status",
  connectionStatusLabel: "Connection Status",
  lastUpdatedLabel: "Last Updated:",
  // Connection states
  connectButton: "Connect",
  disconnectButton: "Disconnect",
  connectingStatus: "Connecting...",
  connectedStatus: "Connected",
  disconnectedStatus: "Disconnected",
  detectingStatus: "Detecting...",
  // Server states
  serviceRunningStatus: "Service Running (Port: {0})",
  serviceNotConnectedStatus: "Service Not Connected",
  connectedServiceNotStartedStatus: "Connected, Service Not Started",
  // Configuration labels
  mcpServerConfigLabel: "MCP Server Configuration",
  connectionPortLabel: "Connection Port",
  refreshStatusButton: "Refresh Status",
  copyConfigButton: "Copy Configuration",
  // Action buttons
  retryButton: "Retry",
  cancelButton: "Cancel",
  confirmButton: "Confirm",
  saveButton: "Save",
  closeButton: "Close",
  resetButton: "Reset",
  // Progress states
  initializingStatus: "Initializing...",
  processingStatus: "Processing...",
  loadingStatus: "Loading...",
  clearingStatus: "Clearing...",
  cleaningStatus: "Cleaning...",
  downloadingStatus: "Downloading...",
  // Semantic engine states
  semanticEngineReadyStatus: "Semantic Engine Ready",
  semanticEngineInitializingStatus: "Semantic Engine Initializing...",
  semanticEngineInitFailedStatus: "Semantic Engine Initialization Failed",
  semanticEngineNotInitStatus: "Semantic Engine Not Initialized",
  initSemanticEngineButton: "Initialize Semantic Engine",
  reinitializeButton: "Reinitialize",
  // Model states
  downloadingModelStatus: "Downloading Model... {0}%",
  switchingModelStatus: "Switching Model...",
  modelLoadedStatus: "Model Loaded",
  modelFailedStatus: "Model Failed to Load",
  // Model descriptions
  lightweightModelDescription: "Lightweight Multilingual Model",
  betterThanSmallDescription: "Slightly larger than e5-small, but better performance",
  multilingualModelDescription: "Multilingual Semantic Model",
  // Performance levels
  fastPerformance: "Fast",
  balancedPerformance: "Balanced",
  accuratePerformance: "Accurate",
  // Error messages
  networkErrorMessage: "Network connection error, please check network and retry",
  modelCorruptedErrorMessage: "Model file corrupted or incomplete, please retry download",
  unknownErrorMessage: "Unknown error, please check if your network can access HuggingFace",
  permissionDeniedErrorMessage: "Permission denied",
  timeoutErrorMessage: "Operation timed out",
  // Data statistics
  indexedPagesLabel: "Indexed Pages",
  indexSizeLabel: "Index Size",
  activeTabsLabel: "Active Tabs",
  vectorDocumentsLabel: "Vector Documents",
  cacheSizeLabel: "Cache Size",
  cacheEntriesLabel: "Cache Entries",
  // Data management
  clearAllDataButton: "Clear All Data",
  clearAllCacheButton: "Clear All Cache",
  cleanExpiredCacheButton: "Clean Expired Cache",
  exportDataButton: "Export Data",
  importDataButton: "Import Data",
  // Dialog titles
  confirmClearDataTitle: "Confirm Clear Data",
  settingsTitle: "Settings",
  aboutTitle: "About",
  helpTitle: "Help",
  // Dialog messages
  clearDataWarningMessage: "This operation will clear all indexed webpage content and vector data, including:",
  clearDataList1: "All webpage text content index",
  clearDataList2: "Vector embedding data",
  clearDataList3: "Search history and cache",
  clearDataIrreversibleWarning: "This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.",
  confirmClearButton: "Confirm Clear",
  // Cache states
  cacheDetailsLabel: "Cache Details",
  noCacheDataMessage: "No cache data",
  loadingCacheInfoStatus: "Loading cache information...",
  processingCacheStatus: "Processing cache...",
  expiredLabel: "Expired",
  // Browser integration
  bookmarksBarLabel: "Bookmarks Bar",
  newTabLabel: "New Tab",
  currentPageLabel: "Current Page",
  // Accessibility
  menuLabel: "Menu",
  navigationLabel: "Navigation",
  mainContentLabel: "Main Content",
  // Future features
  languageSelectorLabel: "Language",
  themeLabel: "Theme",
  lightTheme: "Light",
  darkTheme: "Dark",
  autoTheme: "Auto",
  advancedSettingsLabel: "Advanced Settings",
  debugModeLabel: "Debug Mode",
  verboseLoggingLabel: "Verbose Logging",
  // Notifications
  successNotification: "Operation completed successfully",
  warningNotification: "Warning: Please review before proceeding",
  infoNotification: "Information",
  configCopiedNotification: "Configuration copied to clipboard",
  dataClearedNotification: "Data cleared successfully",
  // Units
  bytesUnit: "bytes",
  kilobytesUnit: "KB",
  megabytesUnit: "MB",
  gigabytesUnit: "GB",
  itemsUnit: "items",
  pagesUnit: "pages",
  // Legacy keys for backwards compatibility
  nativeServerConfig: "Native Server Configuration",
  runningStatus: "Running Status",
  refreshStatus: "Refresh Status",
  lastUpdated: "Last Updated:",
  mcpServerConfig: "MCP Server Configuration",
  connectionPort: "Connection Port",
  connecting: "Connecting...",
  disconnect: "Disconnect",
  connect: "Connect",
  semanticEngine: "Semantic Engine",
  embeddingModel: "Embedding Model",
  retry: "Retry",
  indexDataManagement: "Index Data Management",
  clearing: "Clearing...",
  clearAllData: "Clear All Data",
  copyConfig: "Copy Configuration",
  serviceRunning: "Service Running (Port: {0})",
  connectedServiceNotStarted: "Connected, Service Not Started",
  serviceNotConnected: "Service Not Connected",
  detecting: "Detecting...",
  lightweightModel: "Lightweight Multilingual Model",
  betterThanSmall: "Slightly larger than e5-small, but better performance",
  multilingualModel: "Multilingual Semantic Model",
  fast: "Fast",
  balanced: "Balanced",
  accurate: "Accurate",
  semanticEngineReady: "Semantic Engine Ready",
  semanticEngineInitializing: "Semantic Engine Initializing...",
  semanticEngineInitFailed: "Semantic Engine Initialization Failed",
  semanticEngineNotInit: "Semantic Engine Not Initialized",
  downloadingModel: "Downloading Model... {0}%",
  switchingModel: "Switching Model...",
  networkError: "Network connection error, please check network and retry",
  modelCorrupted: "Model file corrupted or incomplete, please retry download",
  unknownError: "Unknown error, please check if your network can access HuggingFace",
  reinitialize: "Reinitialize",
  initializing: "Initializing...",
  initSemanticEngine: "Initialize Semantic Engine",
  indexedPages: "Indexed Pages",
  indexSize: "Index Size",
  activeTabs: "Active Tabs",
  vectorDocuments: "Vector Documents",
  confirmClearData: "Confirm Clear Data",
  clearDataWarning: "This operation will clear all indexed webpage content and vector data, including:",
  clearDataIrreversible: "This operation is irreversible! After clearing, you need to browse webpages again to rebuild the index.",
  confirmClear: "Confirm Clear",
  cancel: "Cancel",
  confirm: "Confirm",
  processing: "Processing...",
  modelCacheManagement: "Model Cache Management",
  cacheSize: "Cache Size",
  cacheEntries: "Cache Entries",
  cacheDetails: "Cache Details",
  noCacheData: "No cache data",
  loadingCacheInfo: "Loading cache information...",
  processingCache: "Processing cache...",
  cleaning: "Cleaning...",
  cleanExpiredCache: "Clean Expired Cache",
  clearAllCache: "Clear All Cache",
  expired: "Expired",
  bookmarksBar: "Bookmarks Bar"
};
function getMessage(key, substitutions) {
  try {
    if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getMessage) {
      const message = chrome.i18n.getMessage(key, substitutions);
      if (message) {
        return message;
      }
    }
  } catch (error) {
    console.warn(`Failed to get i18n message for key "${key}":`, error);
  }
  let fallback = fallbackMessages[key] || key;
  if (substitutions && substitutions.length > 0) {
    substitutions.forEach((value, index) => {
      fallback = fallback.replace(`{${index}}`, value);
    });
  }
  return fallback;
}
const _hoisted_1$5 = { class: "dialog-content" };
const _hoisted_2$4 = { class: "dialog-header" };
const _hoisted_3$4 = { class: "dialog-icon" };
const _hoisted_4$4 = { class: "dialog-title" };
const _hoisted_5$3 = { class: "dialog-body" };
const _hoisted_6$3 = { class: "dialog-message" };
const _hoisted_7$3 = {
  key: 0,
  class: "dialog-list"
};
const _hoisted_8$3 = {
  key: 1,
  class: "dialog-warning"
};
const _hoisted_9$3 = { class: "dialog-actions" };
const _hoisted_10$3 = ["disabled"];
const _sfc_main$h = /* @__PURE__ */ defineComponent({
  __name: "ConfirmDialog",
  props: {
    visible: { type: Boolean },
    title: {},
    message: {},
    items: {},
    warning: {},
    icon: { default: "⚠️" },
    confirmText: { default: getMessage("confirmButton") },
    cancelText: { default: getMessage("cancelButton") },
    confirmingText: { default: getMessage("processingStatus") },
    isConfirming: { type: Boolean, default: false }
  },
  emits: ["confirm", "cancel"],
  setup(__props) {
    return (_ctx, _cache) => {
      return __props.visible ? (openBlock(), createElementBlock("div", {
        key: 0,
        class: "confirmation-dialog",
        onClick: _cache[2] || (_cache[2] = withModifiers(($event) => _ctx.$emit("cancel"), ["self"]))
      }, [
        createBaseVNode("div", _hoisted_1$5, [
          createBaseVNode("div", _hoisted_2$4, [
            createBaseVNode("span", _hoisted_3$4, toDisplayString(__props.icon), 1),
            createBaseVNode("h3", _hoisted_4$4, toDisplayString(__props.title), 1)
          ]),
          createBaseVNode("div", _hoisted_5$3, [
            createBaseVNode("p", _hoisted_6$3, toDisplayString(__props.message), 1),
            __props.items && __props.items.length > 0 ? (openBlock(), createElementBlock("ul", _hoisted_7$3, [
              (openBlock(true), createElementBlock(Fragment, null, renderList(__props.items, (item) => {
                return openBlock(), createElementBlock("li", { key: item }, toDisplayString(item), 1);
              }), 128))
            ])) : createCommentVNode("", true),
            __props.warning ? (openBlock(), createElementBlock("div", _hoisted_8$3, [
              createBaseVNode("strong", null, toDisplayString(__props.warning), 1)
            ])) : createCommentVNode("", true)
          ]),
          createBaseVNode("div", _hoisted_9$3, [
            createBaseVNode("button", {
              class: "dialog-button cancel-button",
              onClick: _cache[0] || (_cache[0] = ($event) => _ctx.$emit("cancel"))
            }, toDisplayString(__props.cancelText), 1),
            createBaseVNode("button", {
              class: "dialog-button confirm-button",
              disabled: __props.isConfirming,
              onClick: _cache[1] || (_cache[1] = ($event) => _ctx.$emit("confirm"))
            }, toDisplayString(__props.isConfirming ? __props.confirmingText : __props.confirmText), 9, _hoisted_10$3)
          ])
        ])
      ])) : createCommentVNode("", true);
    };
  }
});
const ConfirmDialog = /* @__PURE__ */ _export_sfc(_sfc_main$h, [["__scopeId", "data-v-a9d7431f"]]);
const _hoisted_1$4 = {
  key: 0,
  class: "progress-section"
};
const _hoisted_2$3 = { class: "progress-indicator" };
const _hoisted_3$3 = {
  key: 0,
  class: "spinner"
};
const _hoisted_4$3 = { class: "progress-text" };
const _sfc_main$g = /* @__PURE__ */ defineComponent({
  __name: "ProgressIndicator",
  props: {
    visible: { type: Boolean, default: true },
    text: {},
    showSpinner: { type: Boolean, default: true }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return __props.visible ? (openBlock(), createElementBlock("div", _hoisted_1$4, [
        createBaseVNode("div", _hoisted_2$3, [
          __props.showSpinner ? (openBlock(), createElementBlock("div", _hoisted_3$3)) : createCommentVNode("", true),
          createBaseVNode("span", _hoisted_4$3, toDisplayString(__props.text), 1)
        ])
      ])) : createCommentVNode("", true);
    };
  }
});
const ProgressIndicator = /* @__PURE__ */ _export_sfc(_sfc_main$g, [["__scopeId", "data-v-47bf69ec"]]);
const _sfc_main$f = /* @__PURE__ */ defineComponent({
  __name: "DocumentIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$e = /* @__PURE__ */ defineComponent({
  __name: "DatabaseIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$d = /* @__PURE__ */ defineComponent({
  __name: "BoltIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "1.5",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$c = /* @__PURE__ */ defineComponent({
  __name: "TrashIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "1.5",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$b = /* @__PURE__ */ defineComponent({
  __name: "CheckIcon",
  props: {
    className: { default: "icon-small" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 20 20",
        fill: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "fill-rule": "evenodd",
          d: "M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.052-.143Z",
          "clip-rule": "evenodd"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$a = /* @__PURE__ */ defineComponent({
  __name: "TabIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-16.5 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$9 = /* @__PURE__ */ defineComponent({
  __name: "VectorIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M9 4.5a4.5 4.5 0 0 1 6 0M9 4.5V3a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 3v1.5M9 4.5a4.5 4.5 0 0 0-4.5 4.5v7.5A1.5 1.5 0 0 0 6 18h12a1.5 1.5 0 0 0 1.5-1.5V9a4.5 4.5 0 0 0-4.5-4.5M12 12l2.25 2.25M12 12l-2.25-2.25M12 12v6"
        }, null, -1)
      ])], 2);
    };
  }
});
const _hoisted_1$3 = ["fill"];
const _sfc_main$8 = /* @__PURE__ */ defineComponent({
  __name: "RecordIcon",
  props: {
    className: { default: "icon-default" },
    recording: { type: Boolean, default: false }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 24 24",
        class: normalizeClass(__props.className)
      }, [
        createBaseVNode("circle", {
          cx: "12",
          cy: "12",
          r: "8",
          fill: __props.recording ? "#ef4444" : "currentColor"
        }, null, 8, _hoisted_1$3)
      ], 2);
    };
  }
});
const _sfc_main$7 = /* @__PURE__ */ defineComponent({
  __name: "StopIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        viewBox: "0 0 24 24",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("rect", {
          x: "6",
          y: "6",
          width: "12",
          height: "12",
          rx: "1",
          fill: "currentColor"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$6 = /* @__PURE__ */ defineComponent({
  __name: "WorkflowIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "1.5",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$5 = /* @__PURE__ */ defineComponent({
  __name: "RefreshIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$4 = /* @__PURE__ */ defineComponent({
  __name: "EditIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _sfc_main$3 = /* @__PURE__ */ defineComponent({
  __name: "MarkerIcon",
  props: {
    className: { default: "icon-default" }
  },
  setup(__props) {
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("svg", {
        xmlns: "http://www.w3.org/2000/svg",
        fill: "none",
        viewBox: "0 0 24 24",
        "stroke-width": "2",
        stroke: "currentColor",
        class: normalizeClass(__props.className)
      }, [..._cache[0] || (_cache[0] = [
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"
        }, null, -1),
        createBaseVNode("path", {
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          d: "M6 6h.008v.008H6V6z"
        }, null, -1)
      ])], 2);
    };
  }
});
const _hoisted_1$2 = { class: "model-cache-section" };
const _hoisted_2$2 = { class: "section-title" };
const _hoisted_3$2 = { class: "stats-grid" };
const _hoisted_4$2 = { class: "stats-card" };
const _hoisted_5$2 = { class: "stats-header" };
const _hoisted_6$2 = { class: "stats-label" };
const _hoisted_7$2 = { class: "stats-icon orange" };
const _hoisted_8$2 = { class: "stats-value" };
const _hoisted_9$2 = { class: "stats-card" };
const _hoisted_10$2 = { class: "stats-header" };
const _hoisted_11$2 = { class: "stats-label" };
const _hoisted_12$2 = { class: "stats-icon purple" };
const _hoisted_13$2 = { class: "stats-value" };
const _hoisted_14$2 = {
  key: 0,
  class: "cache-details"
};
const _hoisted_15$2 = { class: "cache-details-title" };
const _hoisted_16$2 = { class: "cache-entries" };
const _hoisted_17$2 = { class: "entry-info" };
const _hoisted_18$2 = { class: "entry-url" };
const _hoisted_19$2 = { class: "entry-details" };
const _hoisted_20$2 = { class: "entry-size" };
const _hoisted_21$2 = { class: "entry-age" };
const _hoisted_22$2 = {
  key: 0,
  class: "entry-expired"
};
const _hoisted_23$2 = {
  key: 1,
  class: "no-cache"
};
const _hoisted_24$2 = {
  key: 2,
  class: "loading-cache"
};
const _hoisted_25$2 = { class: "cache-actions" };
const _hoisted_26$2 = ["disabled"];
const _hoisted_27$2 = { class: "stats-icon" };
const _hoisted_28$2 = ["disabled"];
const _hoisted_29$1 = { class: "stats-icon" };
const _sfc_main$2 = /* @__PURE__ */ defineComponent({
  __name: "ModelCacheManagement",
  props: {
    cacheStats: {},
    isManagingCache: { type: Boolean }
  },
  emits: ["cleanup-cache", "clear-all-cache"],
  setup(__props) {
    const getModelNameFromUrl = (url) => {
      const match = url.match(/huggingface\.co\/([^/]+\/[^/]+)/);
      if (match) {
        return match[1];
      }
      return url.split("/").pop() || url;
    };
    return (_ctx, _cache) => {
      var _a, _b;
      return openBlock(), createElementBlock("div", _hoisted_1$2, [
        createBaseVNode("h2", _hoisted_2$2, toDisplayString(unref(getMessage)("modelCacheManagementLabel")), 1),
        createBaseVNode("div", _hoisted_3$2, [
          createBaseVNode("div", _hoisted_4$2, [
            createBaseVNode("div", _hoisted_5$2, [
              createBaseVNode("p", _hoisted_6$2, toDisplayString(unref(getMessage)("cacheSizeLabel")), 1),
              createBaseVNode("span", _hoisted_7$2, [
                createVNode(unref(_sfc_main$e))
              ])
            ]),
            createBaseVNode("p", _hoisted_8$2, toDisplayString(((_a = __props.cacheStats) == null ? void 0 : _a.totalSizeMB) || 0) + " MB", 1)
          ]),
          createBaseVNode("div", _hoisted_9$2, [
            createBaseVNode("div", _hoisted_10$2, [
              createBaseVNode("p", _hoisted_11$2, toDisplayString(unref(getMessage)("cacheEntriesLabel")), 1),
              createBaseVNode("span", _hoisted_12$2, [
                createVNode(unref(_sfc_main$9))
              ])
            ]),
            createBaseVNode("p", _hoisted_13$2, toDisplayString(((_b = __props.cacheStats) == null ? void 0 : _b.entryCount) || 0), 1)
          ])
        ]),
        __props.cacheStats && __props.cacheStats.entries.length > 0 ? (openBlock(), createElementBlock("div", _hoisted_14$2, [
          createBaseVNode("h3", _hoisted_15$2, toDisplayString(unref(getMessage)("cacheDetailsLabel")), 1),
          createBaseVNode("div", _hoisted_16$2, [
            (openBlock(true), createElementBlock(Fragment, null, renderList(__props.cacheStats.entries, (entry) => {
              return openBlock(), createElementBlock("div", {
                key: entry.url,
                class: "cache-entry"
              }, [
                createBaseVNode("div", _hoisted_17$2, [
                  createBaseVNode("div", _hoisted_18$2, toDisplayString(getModelNameFromUrl(entry.url)), 1),
                  createBaseVNode("div", _hoisted_19$2, [
                    createBaseVNode("span", _hoisted_20$2, toDisplayString(entry.sizeMB) + " MB", 1),
                    createBaseVNode("span", _hoisted_21$2, toDisplayString(entry.age), 1),
                    entry.expired ? (openBlock(), createElementBlock("span", _hoisted_22$2, toDisplayString(unref(getMessage)("expiredLabel")), 1)) : createCommentVNode("", true)
                  ])
                ])
              ]);
            }), 128))
          ])
        ])) : __props.cacheStats && __props.cacheStats.entries.length === 0 ? (openBlock(), createElementBlock("div", _hoisted_23$2, [
          createBaseVNode("p", null, toDisplayString(unref(getMessage)("noCacheDataMessage")), 1)
        ])) : !__props.cacheStats ? (openBlock(), createElementBlock("div", _hoisted_24$2, [
          createBaseVNode("p", null, toDisplayString(unref(getMessage)("loadingCacheInfoStatus")), 1)
        ])) : createCommentVNode("", true),
        __props.isManagingCache ? (openBlock(), createBlock(ProgressIndicator, {
          key: 3,
          visible: __props.isManagingCache,
          text: __props.isManagingCache ? unref(getMessage)("processingCacheStatus") : "",
          showSpinner: true
        }, null, 8, ["visible", "text"])) : createCommentVNode("", true),
        createBaseVNode("div", _hoisted_25$2, [
          createBaseVNode("div", {
            class: "secondary-button",
            disabled: __props.isManagingCache,
            onClick: _cache[0] || (_cache[0] = ($event) => _ctx.$emit("cleanup-cache"))
          }, [
            createBaseVNode("span", _hoisted_27$2, [
              createVNode(unref(_sfc_main$e))
            ]),
            createBaseVNode("span", null, toDisplayString(__props.isManagingCache ? unref(getMessage)("cleaningStatus") : unref(getMessage)("cleanExpiredCacheButton")), 1)
          ], 8, _hoisted_26$2),
          createBaseVNode("div", {
            class: "danger-button",
            disabled: __props.isManagingCache,
            onClick: _cache[1] || (_cache[1] = ($event) => _ctx.$emit("clear-all-cache"))
          }, [
            createBaseVNode("span", _hoisted_29$1, [
              createVNode(unref(_sfc_main$c))
            ]),
            createBaseVNode("span", null, toDisplayString(__props.isManagingCache ? unref(getMessage)("clearingStatus") : unref(getMessage)("clearAllCacheButton")), 1)
          ], 8, _hoisted_28$2)
        ])
      ]);
    };
  }
});
const ModelCacheManagement = /* @__PURE__ */ _export_sfc(_sfc_main$2, [["__scopeId", "data-v-86f9f65f"]]);
const _hoisted_1$1 = { class: "local-model-page" };
const _hoisted_2$1 = { class: "page-header" };
const _hoisted_3$1 = { class: "page-content" };
const _hoisted_4$1 = { class: "section" };
const _hoisted_5$1 = { class: "section-title" };
const _hoisted_6$1 = { class: "semantic-engine-card" };
const _hoisted_7$1 = { class: "semantic-engine-status" };
const _hoisted_8$1 = { class: "status-info" };
const _hoisted_9$1 = { class: "status-text" };
const _hoisted_10$1 = {
  key: 0,
  class: "status-timestamp"
};
const _hoisted_11$1 = ["disabled"];
const _hoisted_12$1 = { class: "section" };
const _hoisted_13$1 = { class: "section-title" };
const _hoisted_14$1 = {
  key: 1,
  class: "error-card"
};
const _hoisted_15$1 = { class: "error-content" };
const _hoisted_16$1 = { class: "error-details" };
const _hoisted_17$1 = { class: "error-title" };
const _hoisted_18$1 = { class: "error-message" };
const _hoisted_19$1 = { class: "error-suggestion" };
const _hoisted_20$1 = ["disabled"];
const _hoisted_21$1 = { class: "model-list" };
const _hoisted_22$1 = ["onClick"];
const _hoisted_23$1 = { class: "model-header" };
const _hoisted_24$1 = { class: "model-info" };
const _hoisted_25$1 = { class: "model-description" };
const _hoisted_26$1 = {
  key: 0,
  class: "check-icon"
};
const _hoisted_27$1 = { class: "model-tags" };
const _hoisted_28$1 = { class: "model-tag performance" };
const _hoisted_29 = { class: "model-tag size" };
const _hoisted_30 = { class: "model-tag dimension" };
const _hoisted_31 = { class: "section" };
const _hoisted_32 = { class: "section-title" };
const _hoisted_33 = { class: "stats-grid" };
const _hoisted_34 = { class: "stats-card" };
const _hoisted_35 = { class: "stats-header" };
const _hoisted_36 = { class: "stats-label" };
const _hoisted_37 = { class: "stats-icon violet" };
const _hoisted_38 = { class: "stats-value" };
const _hoisted_39 = { class: "stats-card" };
const _hoisted_40 = { class: "stats-header" };
const _hoisted_41 = { class: "stats-label" };
const _hoisted_42 = { class: "stats-icon teal" };
const _hoisted_43 = { class: "stats-value" };
const _hoisted_44 = { class: "stats-card" };
const _hoisted_45 = { class: "stats-header" };
const _hoisted_46 = { class: "stats-label" };
const _hoisted_47 = { class: "stats-icon blue" };
const _hoisted_48 = { class: "stats-value" };
const _hoisted_49 = { class: "stats-card" };
const _hoisted_50 = { class: "stats-header" };
const _hoisted_51 = { class: "stats-label" };
const _hoisted_52 = { class: "stats-icon green" };
const _hoisted_53 = { class: "stats-value" };
const _hoisted_54 = ["disabled"];
const _sfc_main$1 = /* @__PURE__ */ defineComponent({
  __name: "LocalModelPage",
  props: {
    semanticEngineStatus: {},
    isSemanticEngineInitializing: { type: Boolean },
    semanticEngineInitProgress: {},
    semanticEngineLastUpdated: {},
    availableModels: {},
    currentModel: {},
    isModelSwitching: { type: Boolean },
    isModelDownloading: { type: Boolean },
    modelDownloadProgress: {},
    modelInitializationStatus: {},
    modelErrorMessage: {},
    modelErrorType: {},
    storageStats: {},
    isClearingData: { type: Boolean },
    clearDataProgress: {},
    cacheStats: {},
    isManagingCache: { type: Boolean }
  },
  emits: ["back", "initializeSemanticEngine", "switchModel", "retryModelInitialization", "showClearConfirmation", "cleanupCache", "clearAllCache"],
  setup(__props) {
    const props = __props;
    const getSemanticEngineStatusClass = () => {
      switch (props.semanticEngineStatus) {
        case "ready":
          return "bg-emerald-500";
        case "initializing":
          return "bg-yellow-500";
        case "error":
          return "bg-red-500";
        case "idle":
        default:
          return "bg-gray-500";
      }
    };
    const getSemanticEngineStatusText = () => {
      switch (props.semanticEngineStatus) {
        case "ready":
          return getMessage("semanticEngineReadyStatus");
        case "initializing":
          return getMessage("semanticEngineInitializingStatus");
        case "error":
          return getMessage("semanticEngineInitFailedStatus");
        case "idle":
        default:
          return getMessage("semanticEngineNotInitStatus");
      }
    };
    const getSemanticEngineButtonText = () => {
      switch (props.semanticEngineStatus) {
        case "ready":
          return getMessage("reinitializeButton");
        case "initializing":
          return getMessage("initializingStatus");
        case "error":
          return getMessage("reinitializeButton");
        case "idle":
        default:
          return getMessage("initSemanticEngineButton");
      }
    };
    const progressText = computed(() => {
      if (props.isModelDownloading) {
        return getMessage("downloadingModelStatus", [props.modelDownloadProgress.toString()]);
      } else if (props.isModelSwitching) {
        return getMessage("switchingModelStatus");
      }
      return "";
    });
    const errorTypeText = computed(() => {
      switch (props.modelErrorType) {
        case "network":
          return getMessage("networkErrorMessage");
        case "file":
          return getMessage("modelCorruptedErrorMessage");
        case "unknown":
        default:
          return getMessage("unknownErrorMessage");
      }
    });
    const getModelDescription = (model) => {
      switch (model.preset) {
        case "multilingual-e5-small":
          return getMessage("lightweightModelDescription");
        case "multilingual-e5-base":
          return getMessage("betterThanSmallDescription");
        default:
          return getMessage("multilingualModelDescription");
      }
    };
    const getPerformanceText = (performance) => {
      switch (performance) {
        case "fast":
          return getMessage("fastPerformance");
        case "balanced":
          return getMessage("balancedPerformance");
        case "accurate":
          return getMessage("accuratePerformance");
        default:
          return performance;
      }
    };
    const formatIndexSize = () => {
      var _a;
      if (!((_a = props.storageStats) == null ? void 0 : _a.indexSize)) return "0 MB";
      const sizeInMB = Math.round(props.storageStats.indexSize / (1024 * 1024));
      return `${sizeInMB} MB`;
    };
    return (_ctx, _cache) => {
      var _a, _b, _c;
      return openBlock(), createElementBlock("div", _hoisted_1$1, [
        createBaseVNode("div", _hoisted_2$1, [
          createBaseVNode("button", {
            class: "back-button",
            onClick: _cache[0] || (_cache[0] = ($event) => _ctx.$emit("back")),
            title: "返回首页"
          }, [..._cache[6] || (_cache[6] = [
            createBaseVNode("svg", {
              viewBox: "0 0 24 24",
              width: "20",
              height: "20",
              fill: "none",
              stroke: "currentColor",
              "stroke-width": "2"
            }, [
              createBaseVNode("path", {
                "stroke-linecap": "round",
                "stroke-linejoin": "round",
                d: "M15 19l-7-7 7-7"
              })
            ], -1),
            createBaseVNode("span", null, "返回", -1)
          ])]),
          _cache[7] || (_cache[7] = createBaseVNode("h2", { class: "page-title" }, "本地模型", -1))
        ]),
        createBaseVNode("div", _hoisted_3$1, [
          createBaseVNode("div", _hoisted_4$1, [
            createBaseVNode("h3", _hoisted_5$1, toDisplayString(unref(getMessage)("semanticEngineLabel")), 1),
            createBaseVNode("div", _hoisted_6$1, [
              createBaseVNode("div", _hoisted_7$1, [
                createBaseVNode("div", _hoisted_8$1, [
                  createBaseVNode("span", {
                    class: normalizeClass(["status-dot", getSemanticEngineStatusClass()])
                  }, null, 2),
                  createBaseVNode("span", _hoisted_9$1, toDisplayString(getSemanticEngineStatusText()), 1)
                ]),
                __props.semanticEngineLastUpdated ? (openBlock(), createElementBlock("div", _hoisted_10$1, toDisplayString(unref(getMessage)("lastUpdatedLabel")) + " " + toDisplayString(new Date(__props.semanticEngineLastUpdated).toLocaleTimeString()), 1)) : createCommentVNode("", true)
              ]),
              __props.isSemanticEngineInitializing ? (openBlock(), createBlock(ProgressIndicator, {
                key: 0,
                visible: __props.isSemanticEngineInitializing,
                text: __props.semanticEngineInitProgress,
                showSpinner: true
              }, null, 8, ["visible", "text"])) : createCommentVNode("", true),
              createBaseVNode("button", {
                class: "primary-action-button",
                disabled: __props.isSemanticEngineInitializing,
                onClick: _cache[1] || (_cache[1] = ($event) => _ctx.$emit("initializeSemanticEngine"))
              }, [
                createVNode(unref(_sfc_main$d)),
                createBaseVNode("span", null, toDisplayString(getSemanticEngineButtonText()), 1)
              ], 8, _hoisted_11$1)
            ])
          ]),
          createBaseVNode("div", _hoisted_12$1, [
            createBaseVNode("h3", _hoisted_13$1, toDisplayString(unref(getMessage)("embeddingModelLabel")), 1),
            __props.isModelSwitching || __props.isModelDownloading ? (openBlock(), createBlock(ProgressIndicator, {
              key: 0,
              visible: __props.isModelSwitching || __props.isModelDownloading,
              text: progressText.value,
              showSpinner: true
            }, null, 8, ["visible", "text"])) : createCommentVNode("", true),
            __props.modelInitializationStatus === "error" ? (openBlock(), createElementBlock("div", _hoisted_14$1, [
              createBaseVNode("div", _hoisted_15$1, [
                _cache[8] || (_cache[8] = createBaseVNode("div", { class: "error-icon" }, "⚠️", -1)),
                createBaseVNode("div", _hoisted_16$1, [
                  createBaseVNode("p", _hoisted_17$1, toDisplayString(unref(getMessage)("semanticEngineInitFailedStatus")), 1),
                  createBaseVNode("p", _hoisted_18$1, toDisplayString(__props.modelErrorMessage || unref(getMessage)("semanticEngineInitFailedStatus")), 1),
                  createBaseVNode("p", _hoisted_19$1, toDisplayString(errorTypeText.value), 1)
                ])
              ]),
              createBaseVNode("button", {
                class: "retry-button",
                onClick: _cache[2] || (_cache[2] = ($event) => _ctx.$emit("retryModelInitialization")),
                disabled: __props.isModelSwitching || __props.isModelDownloading
              }, [
                _cache[9] || (_cache[9] = createBaseVNode("span", null, "🔄", -1)),
                createBaseVNode("span", null, toDisplayString(unref(getMessage)("retryButton")), 1)
              ], 8, _hoisted_20$1)
            ])) : createCommentVNode("", true),
            createBaseVNode("div", _hoisted_21$1, [
              (openBlock(true), createElementBlock(Fragment, null, renderList(__props.availableModels, (model) => {
                return openBlock(), createElementBlock("div", {
                  key: model.preset,
                  class: normalizeClass([
                    "model-card",
                    {
                      selected: __props.currentModel === model.preset,
                      disabled: __props.isModelSwitching || __props.isModelDownloading
                    }
                  ]),
                  onClick: ($event) => !__props.isModelSwitching && !__props.isModelDownloading && _ctx.$emit("switchModel", model.preset)
                }, [
                  createBaseVNode("div", _hoisted_23$1, [
                    createBaseVNode("div", _hoisted_24$1, [
                      createBaseVNode("p", {
                        class: normalizeClass(["model-name", { "selected-text": __props.currentModel === model.preset }])
                      }, toDisplayString(model.preset), 3),
                      createBaseVNode("p", _hoisted_25$1, toDisplayString(getModelDescription(model)), 1)
                    ]),
                    __props.currentModel === model.preset ? (openBlock(), createElementBlock("div", _hoisted_26$1, [
                      createVNode(unref(_sfc_main$b), { class: "text-white" })
                    ])) : createCommentVNode("", true)
                  ]),
                  createBaseVNode("div", _hoisted_27$1, [
                    createBaseVNode("span", _hoisted_28$1, toDisplayString(getPerformanceText(model.performance)), 1),
                    createBaseVNode("span", _hoisted_29, toDisplayString(model.size), 1),
                    createBaseVNode("span", _hoisted_30, toDisplayString(model.dimension) + "D", 1)
                  ])
                ], 10, _hoisted_22$1);
              }), 128))
            ])
          ]),
          createBaseVNode("div", _hoisted_31, [
            createBaseVNode("h3", _hoisted_32, toDisplayString(unref(getMessage)("indexDataManagementLabel")), 1),
            createBaseVNode("div", _hoisted_33, [
              createBaseVNode("div", _hoisted_34, [
                createBaseVNode("div", _hoisted_35, [
                  createBaseVNode("p", _hoisted_36, toDisplayString(unref(getMessage)("indexedPagesLabel")), 1),
                  createBaseVNode("span", _hoisted_37, [
                    createVNode(unref(_sfc_main$f))
                  ])
                ]),
                createBaseVNode("p", _hoisted_38, toDisplayString(((_a = __props.storageStats) == null ? void 0 : _a.indexedPages) || 0), 1)
              ]),
              createBaseVNode("div", _hoisted_39, [
                createBaseVNode("div", _hoisted_40, [
                  createBaseVNode("p", _hoisted_41, toDisplayString(unref(getMessage)("indexSizeLabel")), 1),
                  createBaseVNode("span", _hoisted_42, [
                    createVNode(unref(_sfc_main$e))
                  ])
                ]),
                createBaseVNode("p", _hoisted_43, toDisplayString(formatIndexSize()), 1)
              ]),
              createBaseVNode("div", _hoisted_44, [
                createBaseVNode("div", _hoisted_45, [
                  createBaseVNode("p", _hoisted_46, toDisplayString(unref(getMessage)("activeTabsLabel")), 1),
                  createBaseVNode("span", _hoisted_47, [
                    createVNode(unref(_sfc_main$a))
                  ])
                ]),
                createBaseVNode("p", _hoisted_48, toDisplayString(((_b = __props.storageStats) == null ? void 0 : _b.totalTabs) || 0), 1)
              ]),
              createBaseVNode("div", _hoisted_49, [
                createBaseVNode("div", _hoisted_50, [
                  createBaseVNode("p", _hoisted_51, toDisplayString(unref(getMessage)("vectorDocumentsLabel")), 1),
                  createBaseVNode("span", _hoisted_52, [
                    createVNode(unref(_sfc_main$9))
                  ])
                ]),
                createBaseVNode("p", _hoisted_53, toDisplayString(((_c = __props.storageStats) == null ? void 0 : _c.totalDocuments) || 0), 1)
              ])
            ]),
            __props.isClearingData && __props.clearDataProgress ? (openBlock(), createBlock(ProgressIndicator, {
              key: 0,
              visible: __props.isClearingData,
              text: __props.clearDataProgress,
              showSpinner: true
            }, null, 8, ["visible", "text"])) : createCommentVNode("", true),
            createBaseVNode("button", {
              class: "danger-action-button",
              disabled: __props.isClearingData,
              onClick: _cache[3] || (_cache[3] = ($event) => _ctx.$emit("showClearConfirmation"))
            }, [
              createVNode(unref(_sfc_main$c)),
              createBaseVNode("span", null, toDisplayString(__props.isClearingData ? unref(getMessage)("clearingStatus") : unref(getMessage)("clearAllDataButton")), 1)
            ], 8, _hoisted_54)
          ]),
          createVNode(ModelCacheManagement, {
            "cache-stats": __props.cacheStats,
            "is-managing-cache": __props.isManagingCache,
            onCleanupCache: _cache[4] || (_cache[4] = ($event) => _ctx.$emit("cleanupCache")),
            onClearAllCache: _cache[5] || (_cache[5] = ($event) => _ctx.$emit("clearAllCache"))
          }, null, 8, ["cache-stats", "is-managing-cache"])
        ])
      ]);
    };
  }
});
const LocalModelPage = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["__scopeId", "data-v-106a452f"]]);
const _hoisted_1 = ["data-agent-theme"];
const _hoisted_2 = { class: "home-view" };
const _hoisted_3 = { class: "content" };
const _hoisted_4 = { class: "section" };
const _hoisted_5 = { class: "section-title" };
const _hoisted_6 = { class: "config-card" };
const _hoisted_7 = { class: "status-section" };
const _hoisted_8 = { class: "status-header" };
const _hoisted_9 = { class: "status-label" };
const _hoisted_10 = ["title"];
const _hoisted_11 = { class: "status-info" };
const _hoisted_12 = { class: "status-text" };
const _hoisted_13 = {
  key: 0,
  class: "status-timestamp"
};
const _hoisted_14 = {
  key: 0,
  class: "mcp-config-section"
};
const _hoisted_15 = { class: "mcp-config-header" };
const _hoisted_16 = { class: "mcp-config-label" };
const _hoisted_17 = { class: "mcp-config-content" };
const _hoisted_18 = { class: "mcp-config-json" };
const _hoisted_19 = { class: "port-section" };
const _hoisted_20 = {
  for: "port",
  class: "port-label"
};
const _hoisted_21 = ["value"];
const _hoisted_22 = ["disabled"];
const _hoisted_23 = { class: "section" };
const _hoisted_24 = { class: "rr-icon-buttons" };
const _hoisted_25 = { class: "section" };
const _hoisted_26 = { class: "entry-card" };
const _hoisted_27 = { class: "entry-icon workflow" };
const _hoisted_28 = {
  key: 0,
  class: "coming-soon-toast"
};
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "App",
  setup(__props) {
    const { theme: agentTheme, initTheme } = useAgentTheme();
    const currentView = ref("home");
    const comingSoonToast = ref({ show: false, feature: "" });
    function showComingSoonToast(feature) {
      comingSoonToast.value = { show: true, feature };
      setTimeout(() => {
        comingSoonToast.value = { show: false, feature: "" };
      }, 2e3);
    }
    ref(false);
    const rrFlows = ref([]);
    const rrOnlyBound = ref(false);
    const rrSearch = ref("");
    const currentTabUrl = ref("");
    computed(() => {
      const base = rrOnlyBound.value ? rrFlows.value.filter(isFlowBoundToCurrent) : rrFlows.value;
      const q = rrSearch.value.trim().toLowerCase();
      if (!q) return base;
      return base.filter((f) => {
        var _a, _b;
        const name = String(f.name || "").toLowerCase();
        const domain = String(((_a = f == null ? void 0 : f.meta) == null ? void 0 : _a.domain) || "").toLowerCase();
        const tags = (((_b = f == null ? void 0 : f.meta) == null ? void 0 : _b.tags) || []).join(",").toLowerCase();
        return name.includes(q) || domain.includes(q) || tags.includes(q);
      });
    });
    const loadFlows = () => __async(null, null, function* () {
      try {
        const res = yield chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_LIST_FLOWS });
        if (res && res.success) rrFlows.value = res.flows || [];
      } catch (e) {
      }
    });
    function isFlowBoundToCurrent(flow) {
      var _a;
      try {
        const bindings = ((_a = flow == null ? void 0 : flow.meta) == null ? void 0 : _a.bindings) || [];
        if (!bindings.length) return false;
        if (!currentTabUrl.value) return true;
        const url = new URL(currentTabUrl.value);
        return bindings.some((b) => {
          if (b.type === "domain") return url.hostname.includes(b.value);
          if (b.type === "path") return url.pathname.startsWith(b.value);
          if (b.type === "url") return (url.href || "").startsWith(b.value);
          return false;
        });
      } catch (e) {
        return false;
      }
    }
    const startRecording = () => __async(null, null, function* () {
      showComingSoonToast("录制回放");
      return;
    });
    const stopRecording = () => __async(null, null, function* () {
      showComingSoonToast("录制回放");
      return;
    });
    const nativeConnectionStatus = ref("unknown");
    const isConnecting = ref(false);
    const nativeServerPort = ref(12306);
    const serverStatus = ref({
      isRunning: false,
      lastUpdated: Date.now()
    });
    const showMcpConfig = computed(() => {
      return nativeConnectionStatus.value === "connected" && serverStatus.value.isRunning;
    });
    const copyButtonText = ref(getMessage("copyConfigButton"));
    const mcpConfigJson = computed(() => {
      const port = serverStatus.value.port || nativeServerPort.value;
      const config = {
        mcpServers: {
          "streamable-mcp-server": {
            type: "streamable-http",
            url: `http://127.0.0.1:${port}/mcp`
          }
        }
      };
      return JSON.stringify(config, null, 2);
    });
    const currentModel = ref(null);
    const isModelSwitching = ref(false);
    const modelSwitchProgress = ref("");
    const modelDownloadProgress = ref(0);
    const isModelDownloading = ref(false);
    const modelInitializationStatus = ref(
      "idle"
    );
    const modelErrorMessage = ref("");
    const modelErrorType = ref("");
    const selectedVersion = ref("quantized");
    const storageStats = ref(null);
    const isRefreshingStats = ref(false);
    const isClearingData = ref(false);
    const showClearConfirmation = ref(false);
    const clearDataProgress = ref("");
    const semanticEngineStatus = ref("idle");
    const isSemanticEngineInitializing = ref(false);
    const semanticEngineInitProgress = ref("");
    const semanticEngineLastUpdated = ref(null);
    const isManagingCache = ref(false);
    const cacheStats = ref(null);
    const availableModels = computed(() => {
      return Object.entries(PREDEFINED_MODELS).map(([key, value]) => __spreadValues({
        preset: key
      }, value));
    });
    const getStatusClass = () => {
      if (nativeConnectionStatus.value === "connected") {
        if (serverStatus.value.isRunning) {
          return "bg-emerald-500";
        } else {
          return "bg-yellow-500";
        }
      } else if (nativeConnectionStatus.value === "disconnected") {
        return "bg-red-500";
      } else {
        return "bg-gray-500";
      }
    };
    function openSidepanelAndClose(tab) {
      return __async(this, null, function* () {
        var _a;
        try {
          const current = yield chrome.windows.getCurrent();
          if ((_a = chrome.sidePanel) == null ? void 0 : _a.setOptions) {
            yield chrome.sidePanel.setOptions({
              path: `sidepanel.html?tab=${tab}`,
              enabled: true
            });
          }
          if (chrome.sidePanel && chrome.sidePanel.open) {
            yield chrome.sidePanel.open({ windowId: current.id });
          }
          window.close();
        } catch (e) {
          console.warn(`Failed to open sidepanel (${tab}):`, e);
        }
      });
    }
    function openWorkflowSidepanel() {
      showComingSoonToast("工作流管理");
    }
    function openElementMarkerSidepanel() {
      openSidepanelAndClose("element-markers");
    }
    function openAgentSidepanel() {
      openSidepanelAndClose("agent-chat");
    }
    function toggleWebEditor() {
      return __async(this, null, function* () {
        try {
          yield chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TOGGLE });
        } catch (error) {
          console.warn("切换网页编辑模式失败:", error);
        }
      });
    }
    function toggleElementMarker() {
      return __async(this, null, function* () {
        try {
          const [tab] = yield chrome.tabs.query({ active: true, currentWindow: true });
          if (!(tab == null ? void 0 : tab.id)) {
            console.warn("无法获取当前tab");
            return;
          }
          yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_START,
            tabId: tab.id
          });
        } catch (error) {
          console.warn("开启元素标注失败:", error);
        }
      });
    }
    function openWelcomePage() {
      return __async(this, null, function* () {
        try {
          yield chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
        } catch (e) {
        }
      });
    }
    function openTroubleshooting() {
      return __async(this, null, function* () {
        try {
          yield chrome.tabs.create({ url: LINKS.TROUBLESHOOTING });
        } catch (e) {
        }
      });
    }
    const getStatusText = () => {
      if (nativeConnectionStatus.value === "connected") {
        if (serverStatus.value.isRunning) {
          return getMessage("serviceRunningStatus", [
            (serverStatus.value.port || "Unknown").toString()
          ]);
        } else {
          return getMessage("connectedServiceNotStartedStatus");
        }
      } else if (nativeConnectionStatus.value === "disconnected") {
        return getMessage("serviceNotConnectedStatus");
      } else {
        return getMessage("detectingStatus");
      }
    };
    const loadCacheStats = () => __async(null, null, function* () {
      try {
        cacheStats.value = yield getCacheStats();
      } catch (error) {
        console.error("Failed to get cache stats:", error);
        cacheStats.value = null;
      }
    });
    const cleanupCache = () => __async(null, null, function* () {
      if (isManagingCache.value) return;
      isManagingCache.value = true;
      try {
        yield cleanupModelCache();
        yield loadCacheStats();
      } catch (error) {
        console.error("Failed to cleanup cache:", error);
      } finally {
        isManagingCache.value = false;
      }
    });
    const clearAllCache = () => __async(null, null, function* () {
      if (isManagingCache.value) return;
      isManagingCache.value = true;
      try {
        yield clearModelCache();
        yield loadCacheStats();
      } catch (error) {
        console.error("Failed to clear cache:", error);
      } finally {
        isManagingCache.value = false;
      }
    });
    const saveSemanticEngineState = () => __async(null, null, function* () {
      try {
        const semanticEngineState = {
          status: semanticEngineStatus.value,
          lastUpdated: semanticEngineLastUpdated.value
        };
        yield chrome.storage.local.set({ semanticEngineState });
      } catch (error) {
        console.error("保存语义引擎状态失败:", error);
      }
    });
    const initializeSemanticEngine = () => __async(null, null, function* () {
      if (isSemanticEngineInitializing.value) return;
      const isReinitialization = semanticEngineStatus.value === "ready";
      console.log(
        `🚀 User triggered semantic engine ${isReinitialization ? "reinitialization" : "initialization"}`
      );
      isSemanticEngineInitializing.value = true;
      semanticEngineStatus.value = "initializing";
      semanticEngineInitProgress.value = isReinitialization ? getMessage("semanticEngineInitializingStatus") : getMessage("semanticEngineInitializingStatus");
      semanticEngineLastUpdated.value = Date.now();
      yield saveSemanticEngineState();
      try {
        chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.INITIALIZE_SEMANTIC_ENGINE
        }).catch((error) => {
          console.error("❌ Error sending semantic engine initialization request:", error);
        });
        startSemanticEngineStatusPolling();
        semanticEngineInitProgress.value = isReinitialization ? getMessage("processingStatus") : getMessage("processingStatus");
      } catch (error) {
        console.error("❌ Failed to send initialization request:", error);
        semanticEngineStatus.value = "error";
        semanticEngineInitProgress.value = `Failed to send initialization request: ${(error == null ? void 0 : error.message) || "Unknown error"}`;
        yield saveSemanticEngineState();
        setTimeout(() => {
          semanticEngineInitProgress.value = "";
        }, 5e3);
        isSemanticEngineInitializing.value = false;
        semanticEngineLastUpdated.value = Date.now();
        yield saveSemanticEngineState();
      }
    });
    const checkSemanticEngineStatus = () => __async(null, null, function* () {
      try {
        const response = yield chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.GET_MODEL_STATUS
        });
        if (response && response.success && response.status) {
          const status = response.status;
          if (status.initializationStatus === "ready") {
            semanticEngineStatus.value = "ready";
            semanticEngineLastUpdated.value = Date.now();
            isSemanticEngineInitializing.value = false;
            semanticEngineInitProgress.value = getMessage("semanticEngineReadyStatus");
            yield saveSemanticEngineState();
            stopSemanticEngineStatusPolling();
            setTimeout(() => {
              semanticEngineInitProgress.value = "";
            }, 2e3);
          } else if (status.initializationStatus === "downloading" || status.initializationStatus === "initializing") {
            semanticEngineStatus.value = "initializing";
            isSemanticEngineInitializing.value = true;
            semanticEngineInitProgress.value = getMessage("semanticEngineInitializingStatus");
            semanticEngineLastUpdated.value = Date.now();
            yield saveSemanticEngineState();
          } else if (status.initializationStatus === "error") {
            semanticEngineStatus.value = "error";
            semanticEngineLastUpdated.value = Date.now();
            isSemanticEngineInitializing.value = false;
            semanticEngineInitProgress.value = getMessage("semanticEngineInitFailedStatus");
            yield saveSemanticEngineState();
            stopSemanticEngineStatusPolling();
            setTimeout(() => {
              semanticEngineInitProgress.value = "";
            }, 5e3);
          } else {
            semanticEngineStatus.value = "idle";
            isSemanticEngineInitializing.value = false;
            yield saveSemanticEngineState();
          }
        } else {
          semanticEngineStatus.value = "idle";
          isSemanticEngineInitializing.value = false;
          yield saveSemanticEngineState();
        }
      } catch (error) {
        console.error("Popup: Failed to check semantic engine status:", error);
        semanticEngineStatus.value = "idle";
        isSemanticEngineInitializing.value = false;
        yield saveSemanticEngineState();
      }
    });
    const retryModelInitialization = () => __async(null, null, function* () {
      if (!currentModel.value) return;
      console.log("🔄 Retrying model initialization...");
      modelErrorMessage.value = "";
      modelErrorType.value = "";
      modelInitializationStatus.value = "downloading";
      modelDownloadProgress.value = 0;
      isModelDownloading.value = true;
      yield switchModel(currentModel.value);
    });
    const updatePort = (event) => __async(null, null, function* () {
      const target = event.target;
      const newPort = Number(target.value);
      nativeServerPort.value = newPort;
      yield savePortPreference(newPort);
    });
    const checkNativeConnection = () => __async(null, null, function* () {
      try {
        const response = yield chrome.runtime.sendMessage({ type: "ping_native" });
        nativeConnectionStatus.value = (response == null ? void 0 : response.connected) ? "connected" : "disconnected";
      } catch (error) {
        console.error("检测 Native 连接状态失败:", error);
        nativeConnectionStatus.value = "disconnected";
      }
    });
    const checkServerStatus = () => __async(null, null, function* () {
      try {
        const response = yield chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.GET_SERVER_STATUS
        });
        if ((response == null ? void 0 : response.success) && response.serverStatus) {
          serverStatus.value = response.serverStatus;
        }
        if ((response == null ? void 0 : response.connected) !== void 0) {
          nativeConnectionStatus.value = response.connected ? "connected" : "disconnected";
        }
      } catch (error) {
        console.error("检测服务器状态失败:", error);
      }
    });
    const refreshServerStatus = () => __async(null, null, function* () {
      try {
        const response = yield chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.REFRESH_SERVER_STATUS
        });
        if ((response == null ? void 0 : response.success) && response.serverStatus) {
          serverStatus.value = response.serverStatus;
        }
        if ((response == null ? void 0 : response.connected) !== void 0) {
          nativeConnectionStatus.value = response.connected ? "connected" : "disconnected";
        }
      } catch (error) {
        console.error("刷新服务器状态失败:", error);
      }
    });
    const copyMcpConfig = () => __async(null, null, function* () {
      try {
        yield navigator.clipboard.writeText(mcpConfigJson.value);
        copyButtonText.value = "✅" + getMessage("configCopiedNotification");
        setTimeout(() => {
          copyButtonText.value = getMessage("copyConfigButton");
        }, 2e3);
      } catch (error) {
        console.error("复制配置失败:", error);
        copyButtonText.value = "❌" + getMessage("networkErrorMessage");
        setTimeout(() => {
          copyButtonText.value = getMessage("copyConfigButton");
        }, 2e3);
      }
    });
    const testNativeConnection = () => __async(null, null, function* () {
      if (isConnecting.value) return;
      isConnecting.value = true;
      try {
        if (nativeConnectionStatus.value === "connected") {
          yield chrome.runtime.sendMessage({ type: "disconnect_native" });
          nativeConnectionStatus.value = "disconnected";
        } else {
          console.log(`尝试连接到端口: ${nativeServerPort.value}`);
          const response = yield chrome.runtime.sendMessage({
            type: "connectNative",
            port: nativeServerPort.value
          });
          if (response && response.success) {
            nativeConnectionStatus.value = "connected";
            console.log("连接成功:", response);
            yield savePortPreference(nativeServerPort.value);
          } else {
            nativeConnectionStatus.value = "disconnected";
            console.error("连接失败:", response);
          }
        }
      } catch (error) {
        console.error("测试连接失败:", error);
        nativeConnectionStatus.value = "disconnected";
      } finally {
        isConnecting.value = false;
      }
    });
    const loadModelPreference = () => __async(null, null, function* () {
      try {
        const result = yield chrome.storage.local.get([
          "selectedModel",
          "selectedVersion",
          "modelState",
          "semanticEngineState"
        ]);
        if (result.selectedModel) {
          const storedModel = result.selectedModel;
          console.log("📋 Stored model from storage:", storedModel);
          if (PREDEFINED_MODELS[storedModel]) {
            currentModel.value = storedModel;
            console.log(`✅ Loaded valid model: ${currentModel.value}`);
          } else {
            console.warn(
              `⚠️ Stored model "${storedModel}" not found in PREDEFINED_MODELS, using default`
            );
            currentModel.value = "multilingual-e5-small";
            yield saveModelPreference(currentModel.value);
          }
        } else {
          console.log("⚠️ No model found in storage, using default");
          currentModel.value = "multilingual-e5-small";
          yield saveModelPreference(currentModel.value);
        }
        selectedVersion.value = "quantized";
        console.log("✅ Using quantized version (fixed)");
        yield saveVersionPreference("quantized");
        if (result.modelState) {
          const modelState = result.modelState;
          if (modelState.status === "ready") {
            modelInitializationStatus.value = "ready";
            modelDownloadProgress.value = modelState.downloadProgress || 100;
            isModelDownloading.value = false;
          } else {
            modelInitializationStatus.value = "idle";
            modelDownloadProgress.value = 0;
            isModelDownloading.value = false;
            yield saveModelState();
          }
        } else {
          modelInitializationStatus.value = "idle";
          modelDownloadProgress.value = 0;
          isModelDownloading.value = false;
        }
        if (result.semanticEngineState) {
          const semanticState = result.semanticEngineState;
          if (semanticState.status === "ready") {
            semanticEngineStatus.value = "ready";
            semanticEngineLastUpdated.value = semanticState.lastUpdated || Date.now();
          } else if (semanticState.status === "error") {
            semanticEngineStatus.value = "error";
            semanticEngineLastUpdated.value = semanticState.lastUpdated || Date.now();
          } else {
            semanticEngineStatus.value = "idle";
          }
        } else {
          semanticEngineStatus.value = "idle";
        }
      } catch (error) {
        console.error("❌ 加载模型偏好失败:", error);
      }
    });
    const saveModelPreference = (model) => __async(null, null, function* () {
      try {
        yield chrome.storage.local.set({ selectedModel: model });
      } catch (error) {
        console.error("保存模型偏好失败:", error);
      }
    });
    const saveVersionPreference = (version) => __async(null, null, function* () {
      try {
        yield chrome.storage.local.set({ selectedVersion: version });
      } catch (error) {
        console.error("保存版本偏好失败:", error);
      }
    });
    const savePortPreference = (port) => __async(null, null, function* () {
      try {
        yield chrome.storage.local.set({ nativeServerPort: port });
        console.log(`端口偏好已保存: ${port}`);
      } catch (error) {
        console.error("保存端口偏好失败:", error);
      }
    });
    const loadPortPreference = () => __async(null, null, function* () {
      try {
        const result = yield chrome.storage.local.get(["nativeServerPort"]);
        if (result.nativeServerPort) {
          nativeServerPort.value = result.nativeServerPort;
          console.log(`端口偏好已加载: ${result.nativeServerPort}`);
        }
      } catch (error) {
        console.error("加载端口偏好失败:", error);
      }
    });
    const saveModelState = () => __async(null, null, function* () {
      try {
        const modelState = {
          status: modelInitializationStatus.value,
          downloadProgress: modelDownloadProgress.value,
          isDownloading: isModelDownloading.value,
          lastUpdated: Date.now()
        };
        yield chrome.storage.local.set({ modelState });
      } catch (error) {
        console.error("保存模型状态失败:", error);
      }
    });
    let statusMonitoringInterval = null;
    let semanticEngineStatusPollingInterval = null;
    const startModelStatusMonitoring = () => {
      if (statusMonitoringInterval) {
        clearInterval(statusMonitoringInterval);
      }
      statusMonitoringInterval = setInterval(() => __async(null, null, function* () {
        try {
          const response = yield chrome.runtime.sendMessage({
            type: "get_model_status"
          });
          if (response && response.success) {
            const status = response.status;
            modelInitializationStatus.value = status.initializationStatus || "idle";
            modelDownloadProgress.value = status.downloadProgress || 0;
            isModelDownloading.value = status.isDownloading || false;
            if (status.initializationStatus === "error") {
              modelErrorMessage.value = status.errorMessage || getMessage("modelFailedStatus");
              modelErrorType.value = status.errorType || "unknown";
            } else {
              modelErrorMessage.value = "";
              modelErrorType.value = "";
            }
            yield saveModelState();
            if (status.initializationStatus === "ready" || status.initializationStatus === "error") {
              stopModelStatusMonitoring();
            }
          }
        } catch (error) {
          console.error("获取模型状态失败:", error);
        }
      }), 1e3);
    };
    const stopModelStatusMonitoring = () => {
      if (statusMonitoringInterval) {
        clearInterval(statusMonitoringInterval);
        statusMonitoringInterval = null;
      }
    };
    const startSemanticEngineStatusPolling = () => {
      if (semanticEngineStatusPollingInterval) {
        clearInterval(semanticEngineStatusPollingInterval);
      }
      semanticEngineStatusPollingInterval = setInterval(() => __async(null, null, function* () {
        try {
          yield checkSemanticEngineStatus();
        } catch (error) {
          console.error("Semantic engine status polling failed:", error);
        }
      }), 2e3);
    };
    const stopSemanticEngineStatusPolling = () => {
      if (semanticEngineStatusPollingInterval) {
        clearInterval(semanticEngineStatusPollingInterval);
        semanticEngineStatusPollingInterval = null;
      }
    };
    const refreshStorageStats = () => __async(null, null, function* () {
      if (isRefreshingStats.value) return;
      isRefreshingStats.value = true;
      try {
        console.log("🔄 Refreshing storage statistics...");
        const response = yield chrome.runtime.sendMessage({
          type: "get_storage_stats"
        });
        if (response && response.success) {
          storageStats.value = {
            indexedPages: response.stats.indexedPages || 0,
            totalDocuments: response.stats.totalDocuments || 0,
            totalTabs: response.stats.totalTabs || 0,
            indexSize: response.stats.indexSize || 0,
            isInitialized: response.stats.isInitialized || false
          };
          console.log("✅ Storage stats refreshed:", storageStats.value);
        } else {
          console.error("❌ Failed to get storage stats:", response == null ? void 0 : response.error);
          storageStats.value = {
            indexedPages: 0,
            totalDocuments: 0,
            totalTabs: 0,
            indexSize: 0,
            isInitialized: false
          };
        }
      } catch (error) {
        console.error("❌ Error refreshing storage stats:", error);
        storageStats.value = {
          indexedPages: 0,
          totalDocuments: 0,
          totalTabs: 0,
          indexSize: 0,
          isInitialized: false
        };
      } finally {
        isRefreshingStats.value = false;
      }
    });
    const hideClearDataConfirmation = () => {
      showClearConfirmation.value = false;
    };
    const confirmClearAllData = () => __async(null, null, function* () {
      if (isClearingData.value) return;
      isClearingData.value = true;
      clearDataProgress.value = getMessage("clearingStatus");
      try {
        console.log("🗑️ Starting to clear all data...");
        const response = yield chrome.runtime.sendMessage({
          type: "clear_all_data"
        });
        if (response && response.success) {
          clearDataProgress.value = getMessage("dataClearedNotification");
          console.log("✅ All data cleared successfully");
          yield refreshStorageStats();
          setTimeout(() => {
            clearDataProgress.value = "";
            hideClearDataConfirmation();
          }, 2e3);
        } else {
          throw new Error((response == null ? void 0 : response.error) || "Failed to clear data");
        }
      } catch (error) {
        console.error("❌ Failed to clear all data:", error);
        clearDataProgress.value = `Failed to clear data: ${(error == null ? void 0 : error.message) || "Unknown error"}`;
        setTimeout(() => {
          clearDataProgress.value = "";
        }, 5e3);
      } finally {
        isClearingData.value = false;
      }
    });
    const switchModel = (newModel) => __async(null, null, function* () {
      console.log(`🔄 switchModel called with newModel: ${newModel}`);
      if (isModelSwitching.value) {
        console.log("⏸️ Model switch already in progress, skipping");
        return;
      }
      const isSameModel = newModel === currentModel.value;
      const currentModelInfo = currentModel.value ? getModelInfo(currentModel.value) : getModelInfo("multilingual-e5-small");
      const newModelInfo = getModelInfo(newModel);
      const isDifferentDimension = currentModelInfo.dimension !== newModelInfo.dimension;
      console.log(`📊 Switch analysis:`);
      console.log(`   - Same model: ${isSameModel} (${currentModel.value} -> ${newModel})`);
      console.log(
        `   - Current dimension: ${currentModelInfo.dimension}, New dimension: ${newModelInfo.dimension}`
      );
      console.log(`   - Different dimension: ${isDifferentDimension}`);
      if (isSameModel && !isDifferentDimension) {
        console.log("✅ Same model and dimension - no need to switch");
        return;
      }
      const switchReasons = [];
      if (!isSameModel) switchReasons.push("different model");
      if (isDifferentDimension) switchReasons.push("different dimension");
      console.log(`🚀 Switching model due to: ${switchReasons.join(", ")}`);
      console.log(
        `📋 Model: ${currentModel.value} (${currentModelInfo.dimension}D) -> ${newModel} (${newModelInfo.dimension}D)`
      );
      isModelSwitching.value = true;
      modelSwitchProgress.value = getMessage("switchingModelStatus");
      modelInitializationStatus.value = "downloading";
      modelDownloadProgress.value = 0;
      isModelDownloading.value = true;
      try {
        yield saveModelPreference(newModel);
        yield saveVersionPreference("quantized");
        yield saveModelState();
        modelSwitchProgress.value = getMessage("semanticEngineInitializingStatus");
        startModelStatusMonitoring();
        const response = yield chrome.runtime.sendMessage({
          type: "switch_semantic_model",
          modelPreset: newModel,
          modelVersion: "quantized",
          modelDimension: newModelInfo.dimension,
          previousDimension: currentModelInfo.dimension
        });
        if (response && response.success) {
          currentModel.value = newModel;
          modelSwitchProgress.value = getMessage("successNotification");
          console.log(
            "模型切换成功:",
            newModel,
            "version: quantized",
            "dimension:",
            newModelInfo.dimension
          );
          modelInitializationStatus.value = "ready";
          isModelDownloading.value = false;
          yield saveModelState();
          setTimeout(() => {
            modelSwitchProgress.value = "";
          }, 2e3);
        } else {
          throw new Error((response == null ? void 0 : response.error) || "Model switch failed");
        }
      } catch (error) {
        console.error("模型切换失败:", error);
        modelSwitchProgress.value = `Model switch failed: ${(error == null ? void 0 : error.message) || "Unknown error"}`;
        modelInitializationStatus.value = "error";
        isModelDownloading.value = false;
        const errorMessage = (error == null ? void 0 : error.message) || "未知错误";
        if (errorMessage.includes("network") || errorMessage.includes("fetch") || errorMessage.includes("timeout")) {
          modelErrorType.value = "network";
          modelErrorMessage.value = getMessage("networkErrorMessage");
        } else if (errorMessage.includes("corrupt") || errorMessage.includes("invalid") || errorMessage.includes("format")) {
          modelErrorType.value = "file";
          modelErrorMessage.value = getMessage("modelCorruptedErrorMessage");
        } else {
          modelErrorType.value = "unknown";
          modelErrorMessage.value = errorMessage;
        }
        yield saveModelState();
        setTimeout(() => {
          modelSwitchProgress.value = "";
        }, 8e3);
      } finally {
        isModelSwitching.value = false;
      }
    });
    const setupServerStatusListener = () => {
      const onMessage = (message) => {
        if (message.type === BACKGROUND_MESSAGE_TYPES.SERVER_STATUS_CHANGED && message.payload) {
          serverStatus.value = message.payload;
          console.log("Server status updated:", message.payload);
        }
        if (message.type === BACKGROUND_MESSAGE_TYPES.RR_FLOWS_CHANGED) {
          loadFlows();
        }
      };
      chrome.runtime.onMessage.addListener(onMessage);
      window.__rr_popup_onMessage = onMessage;
    };
    onMounted(() => __async(null, null, function* () {
      yield initTheme();
      yield loadPortPreference();
      yield loadModelPreference();
      yield checkNativeConnection();
      yield checkServerStatus();
      yield refreshStorageStats();
      yield loadCacheStats();
      yield loadFlows();
      try {
        const [tab] = yield chrome.tabs.query({ active: true, currentWindow: true });
        currentTabUrl.value = (tab == null ? void 0 : tab.url) || "";
      } catch (e) {
      }
      yield checkSemanticEngineStatus();
      setupServerStatusListener();
      try {
        const onChanged = (changes, area) => {
          try {
            if (area !== "local") return;
            if (Object.prototype.hasOwnProperty.call(changes || {}, "rr_flows")) loadFlows();
          } catch (e) {
          }
        };
        chrome.storage.onChanged.addListener(onChanged);
        window.__rr_popup_onChanged = onChanged;
      } catch (e) {
      }
    }));
    onUnmounted(() => {
      var _a, _b, _c, _d;
      stopModelStatusMonitoring();
      stopSemanticEngineStatusPolling();
      try {
        const msgFn = window.__rr_popup_onMessage;
        if (msgFn && ((_b = (_a = chrome == null ? void 0 : chrome.runtime) == null ? void 0 : _a.onMessage) == null ? void 0 : _b.removeListener)) {
          chrome.runtime.onMessage.removeListener(msgFn);
        }
      } catch (e) {
      }
      try {
        const fn = window.__rr_popup_onChanged;
        if (fn && ((_d = (_c = chrome == null ? void 0 : chrome.storage) == null ? void 0 : _c.onChanged) == null ? void 0 : _d.removeListener)) {
          chrome.storage.onChanged.removeListener(fn);
        }
      } catch (e) {
      }
    });
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", {
        class: "popup-container agent-theme",
        "data-agent-theme": unref(agentTheme)
      }, [
        withDirectives(createBaseVNode("div", _hoisted_2, [
          _cache[12] || (_cache[12] = createBaseVNode("div", { class: "header" }, [
            createBaseVNode("div", { class: "header-content" }, [
              createBaseVNode("h1", { class: "header-title" }, "Chrome MCP Server")
            ])
          ], -1)),
          createBaseVNode("div", _hoisted_3, [
            createBaseVNode("div", _hoisted_4, [
              createBaseVNode("h2", _hoisted_5, toDisplayString(unref(getMessage)("nativeServerConfigLabel")), 1),
              createBaseVNode("div", _hoisted_6, [
                createBaseVNode("div", _hoisted_7, [
                  createBaseVNode("div", _hoisted_8, [
                    createBaseVNode("p", _hoisted_9, toDisplayString(unref(getMessage)("runningStatusLabel")), 1),
                    createBaseVNode("button", {
                      class: "refresh-status-button",
                      onClick: refreshServerStatus,
                      title: unref(getMessage)("refreshStatusButton")
                    }, [
                      createVNode(unref(_sfc_main$5), { className: "icon-small" })
                    ], 8, _hoisted_10)
                  ]),
                  createBaseVNode("div", _hoisted_11, [
                    createBaseVNode("span", {
                      class: normalizeClass(["status-dot", getStatusClass()])
                    }, null, 2),
                    createBaseVNode("span", _hoisted_12, toDisplayString(getStatusText()), 1)
                  ]),
                  serverStatus.value.lastUpdated ? (openBlock(), createElementBlock("div", _hoisted_13, toDisplayString(unref(getMessage)("lastUpdatedLabel")) + " " + toDisplayString(new Date(serverStatus.value.lastUpdated).toLocaleTimeString()), 1)) : createCommentVNode("", true)
                ]),
                showMcpConfig.value ? (openBlock(), createElementBlock("div", _hoisted_14, [
                  createBaseVNode("div", _hoisted_15, [
                    createBaseVNode("p", _hoisted_16, toDisplayString(unref(getMessage)("mcpServerConfigLabel")), 1),
                    createBaseVNode("button", {
                      class: "copy-config-button",
                      onClick: copyMcpConfig
                    }, toDisplayString(copyButtonText.value), 1)
                  ]),
                  createBaseVNode("div", _hoisted_17, [
                    createBaseVNode("pre", _hoisted_18, toDisplayString(mcpConfigJson.value), 1)
                  ])
                ])) : createCommentVNode("", true),
                createBaseVNode("div", _hoisted_19, [
                  createBaseVNode("label", _hoisted_20, toDisplayString(unref(getMessage)("connectionPortLabel")), 1),
                  createBaseVNode("input", {
                    type: "text",
                    id: "port",
                    value: nativeServerPort.value,
                    onInput: updatePort,
                    class: "port-input"
                  }, null, 40, _hoisted_21)
                ]),
                createBaseVNode("button", {
                  class: "connect-button",
                  disabled: isConnecting.value,
                  onClick: testNativeConnection
                }, [
                  createVNode(unref(_sfc_main$d)),
                  createBaseVNode("span", null, toDisplayString(isConnecting.value ? unref(getMessage)("connectingStatus") : nativeConnectionStatus.value === "connected" ? unref(getMessage)("disconnectButton") : unref(getMessage)("connectButton")), 1)
                ], 8, _hoisted_22)
              ])
            ]),
            createBaseVNode("div", _hoisted_23, [
              _cache[3] || (_cache[3] = createBaseVNode("h2", { class: "section-title" }, "快捷工具", -1)),
              createBaseVNode("div", _hoisted_24, [
                createBaseVNode("button", {
                  class: "rr-icon-btn rr-icon-btn-record rr-icon-btn-coming-soon has-tooltip",
                  onClick: startRecording,
                  "data-tooltip": "录制功能开发中"
                }, [
                  createVNode(unref(_sfc_main$8), { recording: false })
                ]),
                createBaseVNode("button", {
                  class: "rr-icon-btn rr-icon-btn-stop rr-icon-btn-coming-soon has-tooltip",
                  onClick: stopRecording,
                  "data-tooltip": "录制功能开发中"
                }, [
                  createVNode(unref(_sfc_main$7))
                ]),
                createBaseVNode("button", {
                  class: "rr-icon-btn rr-icon-btn-edit has-tooltip",
                  onClick: toggleWebEditor,
                  "data-tooltip": "开启页面编辑模式"
                }, [
                  createVNode(unref(_sfc_main$4))
                ]),
                createBaseVNode("button", {
                  class: "rr-icon-btn rr-icon-btn-marker has-tooltip",
                  onClick: toggleElementMarker,
                  "data-tooltip": "开启元素标注"
                }, [
                  createVNode(unref(_sfc_main$3))
                ])
              ])
            ]),
            createBaseVNode("div", _hoisted_25, [
              _cache[8] || (_cache[8] = createBaseVNode("h2", { class: "section-title" }, "管理入口", -1)),
              createBaseVNode("div", _hoisted_26, [
                createBaseVNode("button", {
                  class: "entry-item",
                  onClick: openAgentSidepanel
                }, [..._cache[4] || (_cache[4] = [
                  createStaticVNode('<div class="entry-icon agent" data-v-df3c7f5b><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" data-v-df3c7f5b></path></svg></div><div class="entry-content" data-v-df3c7f5b><span class="entry-title" data-v-df3c7f5b>智能助手</span><span class="entry-desc" data-v-df3c7f5b>AI Agent 对话与任务</span></div><svg class="entry-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" data-v-df3c7f5b></path></svg>', 3)
                ])]),
                createBaseVNode("button", {
                  class: "entry-item entry-item-coming-soon",
                  onClick: openWorkflowSidepanel
                }, [
                  createBaseVNode("div", _hoisted_27, [
                    createVNode(unref(_sfc_main$6))
                  ]),
                  _cache[5] || (_cache[5] = createStaticVNode('<div class="entry-content" data-v-df3c7f5b><span class="entry-title" data-v-df3c7f5b> 工作流管理 <span class="coming-soon-badge" data-v-df3c7f5b>Coming Soon</span></span><span class="entry-desc" data-v-df3c7f5b>录制与回放自动化流程</span></div><svg class="entry-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" data-v-df3c7f5b></path></svg>', 2))
                ]),
                createBaseVNode("button", {
                  class: "entry-item",
                  onClick: openElementMarkerSidepanel
                }, [..._cache[6] || (_cache[6] = [
                  createStaticVNode('<div class="entry-icon marker" data-v-df3c7f5b><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" data-v-df3c7f5b></path></svg></div><div class="entry-content" data-v-df3c7f5b><span class="entry-title" data-v-df3c7f5b>元素标注管理</span><span class="entry-desc" data-v-df3c7f5b>管理页面元素标注</span></div><svg class="entry-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" data-v-df3c7f5b></path></svg>', 3)
                ])]),
                createBaseVNode("button", {
                  class: "entry-item",
                  onClick: _cache[0] || (_cache[0] = ($event) => currentView.value = "local-model")
                }, [..._cache[7] || (_cache[7] = [
                  createStaticVNode('<div class="entry-icon model" data-v-df3c7f5b><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" data-v-df3c7f5b></path></svg></div><div class="entry-content" data-v-df3c7f5b><span class="entry-title" data-v-df3c7f5b>本地模型</span><span class="entry-desc" data-v-df3c7f5b>语义引擎与模型管理</span></div><svg class="entry-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" data-v-df3c7f5b><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" data-v-df3c7f5b></path></svg>', 3)
                ])])
              ])
            ])
          ]),
          createBaseVNode("div", { class: "footer" }, [
            createBaseVNode("div", { class: "footer-links" }, [
              createBaseVNode("button", {
                class: "footer-link",
                onClick: openWelcomePage,
                title: "View installation guide"
              }, [..._cache[9] || (_cache[9] = [
                createBaseVNode("svg", {
                  class: "w-4 h-4",
                  fill: "none",
                  stroke: "currentColor",
                  viewBox: "0 0 24 24"
                }, [
                  createBaseVNode("path", {
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "stroke-width": "2",
                    d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  })
                ], -1),
                createTextVNode(" Guide ", -1)
              ])]),
              createBaseVNode("button", {
                class: "footer-link",
                onClick: openTroubleshooting,
                title: "Troubleshooting"
              }, [..._cache[10] || (_cache[10] = [
                createBaseVNode("svg", {
                  class: "w-4 h-4",
                  fill: "none",
                  stroke: "currentColor",
                  viewBox: "0 0 24 24"
                }, [
                  createBaseVNode("path", {
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "stroke-width": "2",
                    d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  })
                ], -1),
                createTextVNode(" Docs ", -1)
              ])])
            ]),
            _cache[11] || (_cache[11] = createBaseVNode("p", { class: "footer-text" }, "chrome mcp server for ai", -1))
          ])
        ], 512), [
          [vShow, currentView.value === "home"]
        ]),
        withDirectives(createVNode(LocalModelPage, {
          "semantic-engine-status": semanticEngineStatus.value,
          "is-semantic-engine-initializing": isSemanticEngineInitializing.value,
          "semantic-engine-init-progress": semanticEngineInitProgress.value,
          "semantic-engine-last-updated": semanticEngineLastUpdated.value,
          "available-models": availableModels.value,
          "current-model": currentModel.value,
          "is-model-switching": isModelSwitching.value,
          "is-model-downloading": isModelDownloading.value,
          "model-download-progress": modelDownloadProgress.value,
          "model-initialization-status": modelInitializationStatus.value,
          "model-error-message": modelErrorMessage.value,
          "model-error-type": modelErrorType.value,
          "storage-stats": storageStats.value,
          "is-clearing-data": isClearingData.value,
          "clear-data-progress": clearDataProgress.value,
          "cache-stats": cacheStats.value,
          "is-managing-cache": isManagingCache.value,
          onBack: _cache[1] || (_cache[1] = ($event) => currentView.value = "home"),
          onInitializeSemanticEngine: initializeSemanticEngine,
          onSwitchModel: switchModel,
          onRetryModelInitialization: retryModelInitialization,
          onShowClearConfirmation: _cache[2] || (_cache[2] = ($event) => showClearConfirmation.value = true),
          onCleanupCache: cleanupCache,
          onClearAllCache: clearAllCache
        }, null, 8, ["semantic-engine-status", "is-semantic-engine-initializing", "semantic-engine-init-progress", "semantic-engine-last-updated", "available-models", "current-model", "is-model-switching", "is-model-downloading", "model-download-progress", "model-initialization-status", "model-error-message", "model-error-type", "storage-stats", "is-clearing-data", "clear-data-progress", "cache-stats", "is-managing-cache"]), [
          [vShow, currentView.value === "local-model"]
        ]),
        createVNode(ConfirmDialog, {
          visible: showClearConfirmation.value,
          title: unref(getMessage)("confirmClearDataTitle"),
          message: unref(getMessage)("clearDataWarningMessage"),
          items: [
            unref(getMessage)("clearDataList1"),
            unref(getMessage)("clearDataList2"),
            unref(getMessage)("clearDataList3")
          ],
          warning: unref(getMessage)("clearDataIrreversibleWarning"),
          icon: "⚠️",
          "confirm-text": unref(getMessage)("confirmClearButton"),
          "cancel-text": unref(getMessage)("cancelButton"),
          "confirming-text": unref(getMessage)("clearingStatus"),
          "is-confirming": isClearingData.value,
          onConfirm: confirmClearAllData,
          onCancel: hideClearDataConfirmation
        }, null, 8, ["visible", "title", "message", "items", "warning", "confirm-text", "cancel-text", "confirming-text", "is-confirming"]),
        createVNode(Transition, { name: "toast" }, {
          default: withCtx(() => [
            comingSoonToast.value.show ? (openBlock(), createElementBlock("div", _hoisted_28, [
              _cache[13] || (_cache[13] = createBaseVNode("svg", {
                class: "toast-icon",
                viewBox: "0 0 24 24",
                fill: "none",
                stroke: "currentColor",
                "stroke-width": "2"
              }, [
                createBaseVNode("circle", {
                  cx: "12",
                  cy: "12",
                  r: "10"
                }),
                createBaseVNode("path", {
                  d: "M12 6v6l4 2",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round"
                })
              ], -1)),
              createBaseVNode("span", null, toDisplayString(comingSoonToast.value.feature) + " 功能开发中，敬请期待", 1)
            ])) : createCommentVNode("", true)
          ]),
          _: 1
        })
      ], 8, _hoisted_1);
    };
  }
});
const App = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-df3c7f5b"]]);
preloadAgentTheme().then(() => {
  void chrome.runtime.sendMessage({ type: NativeMessageType.ENSURE_NATIVE }).catch(() => {
  });
  createApp(App).mount("#app");
});
