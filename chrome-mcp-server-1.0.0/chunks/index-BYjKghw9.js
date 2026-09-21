var NativeMessageType = /* @__PURE__ */ ((NativeMessageType2) => {
  NativeMessageType2["START"] = "start";
  NativeMessageType2["STARTED"] = "started";
  NativeMessageType2["STOP"] = "stop";
  NativeMessageType2["STOPPED"] = "stopped";
  NativeMessageType2["PING"] = "ping";
  NativeMessageType2["PONG"] = "pong";
  NativeMessageType2["ERROR"] = "error";
  NativeMessageType2["PROCESS_DATA"] = "process_data";
  NativeMessageType2["PROCESS_DATA_RESPONSE"] = "process_data_response";
  NativeMessageType2["CALL_TOOL"] = "call_tool";
  NativeMessageType2["CALL_TOOL_RESPONSE"] = "call_tool_response";
  NativeMessageType2["SERVER_STARTED"] = "server_started";
  NativeMessageType2["SERVER_STOPPED"] = "server_stopped";
  NativeMessageType2["ERROR_FROM_NATIVE_HOST"] = "error_from_native_host";
  NativeMessageType2["CONNECT_NATIVE"] = "connectNative";
  NativeMessageType2["ENSURE_NATIVE"] = "ensure_native";
  NativeMessageType2["PING_NATIVE"] = "ping_native";
  NativeMessageType2["DISCONNECT_NATIVE"] = "disconnect_native";
  return NativeMessageType2;
})(NativeMessageType || {});
var TOOL_NAMES = {
  BROWSER: {
    GET_WINDOWS_AND_TABS: "get_windows_and_tabs",
    SEARCH_TABS_CONTENT: "search_tabs_content",
    NAVIGATE: "chrome_navigate",
    SCREENSHOT: "chrome_screenshot",
    CLOSE_TABS: "chrome_close_tabs",
    SWITCH_TAB: "chrome_switch_tab",
    WEB_FETCHER: "chrome_get_web_content",
    CLICK: "chrome_click_element",
    FILL: "chrome_fill_or_select",
    REQUEST_ELEMENT_SELECTION: "chrome_request_element_selection",
    GET_INTERACTIVE_ELEMENTS: "chrome_get_interactive_elements",
    NETWORK_CAPTURE: "chrome_network_capture",
    // Legacy tool names (kept for internal use, not exposed in TOOL_SCHEMAS)
    NETWORK_CAPTURE_START: "chrome_network_capture_start",
    NETWORK_CAPTURE_STOP: "chrome_network_capture_stop",
    NETWORK_REQUEST: "chrome_network_request",
    NETWORK_DEBUGGER_START: "chrome_network_debugger_start",
    NETWORK_DEBUGGER_STOP: "chrome_network_debugger_stop",
    KEYBOARD: "chrome_keyboard",
    HISTORY: "chrome_history",
    BOOKMARK_SEARCH: "chrome_bookmark_search",
    BOOKMARK_ADD: "chrome_bookmark_add",
    BOOKMARK_DELETE: "chrome_bookmark_delete",
    INJECT_SCRIPT: "chrome_inject_script",
    SEND_COMMAND_TO_INJECT_SCRIPT: "chrome_send_command_to_inject_script",
    JAVASCRIPT: "chrome_javascript",
    CONSOLE: "chrome_console",
    FILE_UPLOAD: "chrome_upload_file",
    READ_PAGE: "chrome_read_page",
    COMPUTER: "chrome_computer",
    HANDLE_DIALOG: "chrome_handle_dialog",
    HANDLE_DOWNLOAD: "chrome_handle_download",
    USERSCRIPT: "chrome_userscript",
    PERFORMANCE_START_TRACE: "performance_start_trace",
    PERFORMANCE_STOP_TRACE: "performance_stop_trace",
    PERFORMANCE_ANALYZE_INSIGHT: "performance_analyze_insight",
    GIF_RECORDER: "chrome_gif_recorder"
  },
  RECORD_REPLAY: {
    FLOW_RUN: "record_replay_flow_run",
    LIST_PUBLISHED: "record_replay_list_published"
  }
};
var EDGE_LABELS = {
  DEFAULT: "default",
  TRUE: "true",
  FALSE: "false",
  ON_ERROR: "onError"
};
var RR_STEP_TYPES = {
  SCRIPT: "script"
};
function ensureTarget(t) {
  return t && typeof t === "object" ? t : { candidates: [] };
}
function topoOrder(nodes, edges) {
  const id2n = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
  const nexts = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) nexts.get(e.from).push(e.to);
  const q = nodes.filter((n) => (indeg.get(n.id) || 0) === 0).map((n) => n.id);
  const out = [];
  while (q.length) {
    const id = q.shift();
    const n = id2n.get(id);
    if (!n) continue;
    out.push(n);
    for (const v of nexts.get(id)) {
      indeg.set(v, (indeg.get(v) || 0) - 1);
      if ((indeg.get(v) || 0) === 0) q.push(v);
    }
  }
  return out.length === nodes.length ? out : nodes.slice();
}
function mapStepToNodeConfig(step) {
  if (!step || typeof step !== "object") return {};
  const src = step;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === "id" || k === "type") continue;
    out[k] = v;
  }
  const target = out["target"];
  if (target) out["target"] = ensureTarget(target);
  const start = out["start"];
  if (start) out["start"] = ensureTarget(start);
  const end = out["end"];
  if (end) out["end"] = ensureTarget(end);
  return out;
}
function stepsToNodes(steps) {
  const arr = [];
  steps.forEach((step, i) => {
    const obj = step && typeof step === "object" ? step : {};
    const idValue = obj["id"];
    const typeValue = obj["type"];
    const id = typeof idValue === "string" && idValue ? idValue : `n_${i}`;
    const type = typeof typeValue === "string" && typeValue ? typeValue : RR_STEP_TYPES.SCRIPT;
    arr.push({ id, type, config: mapStepToNodeConfig(step) });
  });
  return arr;
}
var STEP_TYPES = {
  CLICK: "click",
  DBLCLICK: "dblclick",
  FILL: "fill",
  TRIGGER_EVENT: "triggerEvent",
  SET_ATTRIBUTE: "setAttribute",
  SCREENSHOT: "screenshot",
  SWITCH_FRAME: "switchFrame",
  LOOP_ELEMENTS: "loopElements",
  KEY: "key",
  SCROLL: "scroll",
  DRAG: "drag",
  WAIT: "wait",
  ASSERT: "assert",
  SCRIPT: "script",
  IF: "if",
  FOREACH: "foreach",
  WHILE: "while",
  NAVIGATE: "navigate",
  HTTP: "http",
  EXTRACT: "extract",
  OPEN_TAB: "openTab",
  SWITCH_TAB: "switchTab",
  CLOSE_TAB: "closeTab",
  HANDLE_DOWNLOAD: "handleDownload",
  EXECUTE_FLOW: "executeFlow",
  // UI-only helpers
  TRIGGER: "trigger",
  DELAY: "delay"
};
var REG = /* @__PURE__ */ new Map();
function registerNodeSpec(spec) {
  REG.set(spec.type, spec);
}
function getNodeSpec(type) {
  return REG.get(type);
}
function listNodeSpecs() {
  return Array.from(REG.values());
}
function registerBuiltinSpecs() {
  const nav = {
    type: STEP_TYPES.NAVIGATE,
    version: 1,
    display: { label: "导航", iconClass: "icon-navigate", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "url",
        label: "URL",
        type: "string",
        required: true,
        placeholder: "https://example.com",
        help: "目标地址，支持变量模板 {var}",
        default: ""
      }
    ],
    defaults: { url: "" },
    validate: (cfg) => {
      const errs = [];
      if (!cfg || !cfg.url || String(cfg.url).trim() === "") errs.push("URL 必填");
      return errs;
    }
  };
  registerNodeSpec(nav);
  registerNodeSpec({
    type: STEP_TYPES.CLICK,
    version: 1,
    display: { label: "点击", iconClass: "icon-click", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "target",
        label: "目标",
        type: "json",
        widget: "targetlocator",
        help: "选择或输入元素选择器"
      },
      {
        key: "before",
        label: "执行前",
        type: "object",
        fields: [
          { key: "scrollIntoView", label: "滚动到可见", type: "boolean", default: true },
          { key: "waitForSelector", label: "等待选择器", type: "boolean", default: true }
        ]
      },
      {
        key: "after",
        label: "执行后",
        type: "object",
        fields: [
          { key: "waitForNavigation", label: "等待导航完成", type: "boolean", default: false },
          { key: "waitForNetworkIdle", label: "等待网络空闲", type: "boolean", default: false }
        ]
      }
    ],
    defaults: { before: { scrollIntoView: true, waitForSelector: true }, after: {} }
  });
  registerNodeSpec({
    type: STEP_TYPES.DBLCLICK,
    version: 1,
    display: { label: "双击", iconClass: "icon-click", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "target", label: "目标", type: "json", widget: "targetlocator" },
      {
        key: "before",
        label: "执行前",
        type: "object",
        fields: [
          { key: "scrollIntoView", label: "滚动到可见", type: "boolean", default: true },
          { key: "waitForSelector", label: "等待选择器", type: "boolean", default: true }
        ]
      },
      {
        key: "after",
        label: "执行后",
        type: "object",
        fields: [
          { key: "waitForNavigation", label: "等待导航完成", type: "boolean", default: false },
          { key: "waitForNetworkIdle", label: "等待网络空闲", type: "boolean", default: false }
        ]
      }
    ],
    defaults: { before: { scrollIntoView: true, waitForSelector: true }, after: {} }
  });
  registerNodeSpec({
    type: STEP_TYPES.FILL,
    version: 1,
    display: { label: "填充", iconClass: "icon-fill", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "target", label: "目标", type: "json", widget: "targetlocator" },
      { key: "value", label: "输入值", type: "string", required: true, help: "支持 {var} 模板" }
    ],
    defaults: { value: "" }
  });
  registerNodeSpec({
    type: STEP_TYPES.KEY,
    version: 1,
    display: { label: "键盘", iconClass: "icon-key", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "keys",
        label: "按键序列",
        type: "string",
        widget: "keysequence",
        required: true,
        help: "如 Backspace Enter 或 cmd+a"
      },
      { key: "target", label: "焦点目标(可选)", type: "json", widget: "targetlocator" }
    ],
    defaults: { keys: "" }
  });
  registerNodeSpec({
    type: STEP_TYPES.SCROLL,
    version: 1,
    display: { label: "滚动", iconClass: "icon-scroll", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "mode",
        label: "模式",
        type: "select",
        options: [
          { label: "元素", value: "element" },
          { label: "偏移", value: "offset" },
          { label: "容器", value: "container" }
        ],
        default: "offset"
      },
      { key: "target", label: "目标(当元素/容器)", type: "json", widget: "targetlocator" },
      {
        key: "offset",
        label: "偏移",
        type: "object",
        fields: [
          { key: "x", label: "X", type: "number" },
          { key: "y", label: "Y", type: "number" }
        ]
      }
    ],
    defaults: { mode: "offset", offset: { x: 0, y: 300 } }
  });
  registerNodeSpec({
    type: STEP_TYPES.DRAG,
    version: 1,
    display: { label: "拖拽", iconClass: "icon-drag", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "start", label: "起点", type: "json", widget: "targetlocator" },
      { key: "end", label: "终点", type: "json", widget: "targetlocator" },
      {
        key: "path",
        label: "路径坐标",
        type: "array",
        item: {
          key: "p",
          label: "点",
          type: "object",
          fields: [
            { key: "x", label: "X", type: "number" },
            { key: "y", label: "Y", type: "number" }
          ]
        }
      }
    ],
    defaults: {}
  });
  registerNodeSpec({
    type: STEP_TYPES.WAIT,
    version: 1,
    display: { label: "等待", iconClass: "icon-wait", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "condition",
        label: "条件(JSON)",
        type: "json",
        help: '如 {"sleep":1000} 或 {"text":"Hello","appear":true}'
      }
    ],
    defaults: { condition: { sleep: 500 } }
  });
  registerNodeSpec({
    type: STEP_TYPES.ASSERT,
    version: 1,
    display: { label: "断言", iconClass: "icon-assert", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }, { label: "onError" }] },
    schema: [
      {
        key: "assert",
        label: "断言(JSON)",
        type: "json",
        help: '如 {"exists":"#id"} / {"visible":".btn"}'
      },
      {
        key: "failStrategy",
        label: "失败策略",
        type: "select",
        options: [
          { label: "停止", value: "stop" },
          { label: "警告", value: "warn" },
          { label: "重试", value: "retry" }
        ],
        default: "stop"
      }
    ],
    defaults: { assert: {} }
  });
  registerNodeSpec({
    type: STEP_TYPES.HTTP,
    version: 1,
    display: { label: "HTTP", iconClass: "icon-http", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "method",
        label: "方法",
        type: "select",
        options: ["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({
          label: m,
          value: m
        })),
        default: "GET"
      },
      { key: "url", label: "URL", type: "string", required: true },
      { key: "headers", label: "请求头(JSON)", type: "json" },
      { key: "body", label: "请求体(JSON)", type: "json" },
      { key: "formData", label: "表单(JSON)", type: "json" },
      { key: "saveAs", label: "保存为变量", type: "string" },
      { key: "assign", label: "映射(JSON)", type: "json" }
    ],
    defaults: { method: "GET" }
  });
  registerNodeSpec({
    type: STEP_TYPES.EXTRACT,
    version: 1,
    display: { label: "提取", iconClass: "icon-extract", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "selector", label: "选择器", type: "string", widget: "selector" },
      {
        key: "attr",
        label: "属性",
        type: "select",
        options: [
          { label: "文本(text)", value: "text" },
          { label: "文本(textContent)", value: "textContent" },
          { label: "自定义属性名", value: "attr" }
        ]
      },
      { key: "js", label: "自定义JS", type: "string", help: "在页面中执行并返回值" },
      { key: "saveAs", label: "保存变量", type: "string", required: true }
    ],
    defaults: { saveAs: "" }
  });
  registerNodeSpec({
    type: STEP_TYPES.SCREENSHOT,
    version: 1,
    display: { label: "截图", iconClass: "icon-screenshot", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "selector", label: "目标选择器", type: "string" },
      { key: "fullPage", label: "整页截图", type: "boolean", default: false },
      { key: "saveAs", label: "保存变量", type: "string" }
    ],
    defaults: { fullPage: false }
  });
  registerNodeSpec({
    type: STEP_TYPES.TRIGGER_EVENT,
    version: 1,
    display: { label: "触发事件", iconClass: "icon-trigger", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "target", label: "目标", type: "json", widget: "targetlocator" },
      { key: "event", label: "事件类型", type: "string", required: true },
      { key: "bubbles", label: "冒泡", type: "boolean", default: true },
      { key: "cancelable", label: "可取消", type: "boolean", default: false }
    ],
    defaults: { event: "" }
  });
  registerNodeSpec({
    type: STEP_TYPES.SET_ATTRIBUTE,
    version: 1,
    display: { label: "设置属性", iconClass: "icon-attr", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "target", label: "目标", type: "json", widget: "targetlocator" },
      { key: "name", label: "属性名", type: "string", required: true },
      { key: "value", label: "属性值", type: "string" },
      { key: "remove", label: "移除属性", type: "boolean", default: false }
    ],
    defaults: { remove: false }
  });
  registerNodeSpec({
    type: STEP_TYPES.LOOP_ELEMENTS,
    version: 1,
    display: { label: "循环元素", iconClass: "icon-loop", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "selector", label: "选择器", type: "string", required: true },
      { key: "saveAs", label: "列表变量名", type: "string", default: "elements" },
      { key: "itemVar", label: "项变量名", type: "string", default: "item" },
      { key: "subflowId", label: "子流程ID", type: "string", required: true }
    ],
    defaults: { saveAs: "elements", itemVar: "item" }
  });
  registerNodeSpec({
    type: STEP_TYPES.SWITCH_FRAME,
    version: 1,
    display: { label: "切换Frame", iconClass: "icon-frame", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "frame",
        label: "frame定位",
        type: "object",
        fields: [
          { key: "index", label: "索引", type: "number" },
          { key: "urlContains", label: "URL包含", type: "string" }
        ]
      }
    ],
    defaults: {}
  });
  registerNodeSpec({
    type: STEP_TYPES.HANDLE_DOWNLOAD,
    version: 1,
    display: { label: "下载处理", iconClass: "icon-download", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "filenameContains", label: "文件名包含", type: "string" },
      { key: "waitForComplete", label: "等待完成", type: "boolean", default: true },
      { key: "timeoutMs", label: "超时(ms)", type: "number", default: 6e4 },
      { key: "saveAs", label: "保存变量", type: "string" }
    ],
    defaults: { waitForComplete: true, timeoutMs: 6e4 }
  });
  registerNodeSpec({
    type: STEP_TYPES.SCRIPT,
    version: 1,
    display: { label: "脚本", iconClass: "icon-script", category: "Tools" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "world",
        label: "执行上下文",
        type: "select",
        options: [
          { label: "ISOLATED", value: "ISOLATED" },
          { label: "MAIN", value: "MAIN" }
        ],
        default: "ISOLATED"
      },
      { key: "code", label: "脚本代码", type: "string", widget: "code", required: true },
      {
        key: "when",
        label: "执行时机",
        type: "select",
        options: [
          { label: "before", value: "before" },
          { label: "after", value: "after" }
        ],
        default: "after"
      },
      { key: "assign", label: "映射(JSON)", type: "json" },
      { key: "saveAs", label: "保存变量", type: "string" }
    ],
    defaults: { world: "ISOLATED", when: "after" }
  });
  registerNodeSpec({
    type: STEP_TYPES.OPEN_TAB,
    version: 1,
    display: { label: "打开标签", iconClass: "icon-openTab", category: "Tabs" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "url", label: "URL", type: "string" },
      { key: "newWindow", label: "新窗口", type: "boolean", default: false }
    ],
    defaults: { newWindow: false }
  });
  registerNodeSpec({
    type: "executeFlow",
    version: 1,
    display: { label: "执行子流程", iconClass: "icon-exec", category: "Flow" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "flowId", label: "流程ID", type: "string", required: true },
      { key: "inline", label: "内联执行", type: "boolean", default: false },
      { key: "args", label: "参数(JSON)", type: "json" }
    ],
    defaults: { inline: false }
  });
  registerNodeSpec({
    type: STEP_TYPES.SWITCH_TAB,
    version: 1,
    display: { label: "切换标签", iconClass: "icon-switchTab", category: "Tabs" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "tabId", label: "TabId", type: "number" },
      { key: "urlContains", label: "URL包含", type: "string" },
      { key: "titleContains", label: "标题包含", type: "string" }
    ],
    defaults: {}
  });
  registerNodeSpec({
    type: STEP_TYPES.CLOSE_TAB,
    version: 1,
    display: { label: "关闭标签", iconClass: "icon-closeTab", category: "Tabs" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "tabIds",
        label: "TabIds",
        type: "array",
        item: { key: "id", label: "id", type: "number" }
      },
      { key: "url", label: "URL", type: "string" }
    ],
    defaults: {}
  });
  registerNodeSpec({
    type: STEP_TYPES.IF,
    version: 1,
    display: { label: "条件", iconClass: "icon-if", category: "Logic" },
    ports: { inputs: 1, outputs: "any" },
    schema: [
      {
        key: "condition",
        label: "条件表达式(JSON)",
        type: "json",
        help: '如 {"expression":"vars.a>0"} 等'
      },
      {
        key: "branches",
        label: "分支",
        type: "array",
        item: {
          key: "b",
          label: "case",
          type: "object",
          fields: [
            { key: "id", label: "ID", type: "string" },
            { key: "name", label: "名称", type: "string" },
            { key: "expr", label: "表达式", type: "string" }
          ]
        }
      },
      { key: "else", label: "启用 else", type: "boolean", default: true }
    ],
    defaults: { else: true }
  });
  registerNodeSpec({
    type: STEP_TYPES.FOREACH,
    version: 1,
    display: { label: "循环", iconClass: "icon-foreach", category: "Logic" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "listVar", label: "列表变量", type: "string", required: true },
      { key: "itemVar", label: "项变量", type: "string", default: "item" },
      { key: "subflowId", label: "子流程ID", type: "string", required: true },
      {
        key: "concurrency",
        label: "并发数",
        type: "number",
        default: 1,
        help: "并发执行子流程（浅拷贝变量，不自动合并）"
      }
    ],
    defaults: { itemVar: "item" }
  });
  registerNodeSpec({
    type: STEP_TYPES.WHILE,
    version: 1,
    display: { label: "循环", iconClass: "icon-while", category: "Logic" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      { key: "condition", label: "条件(JSON)", type: "json" },
      { key: "subflowId", label: "子流程ID", type: "string", required: true },
      { key: "maxIterations", label: "最大次数", type: "number", default: 100 }
    ],
    defaults: { maxIterations: 100 }
  });
  registerNodeSpec({
    type: STEP_TYPES.DELAY,
    version: 1,
    display: { label: "延迟", iconClass: "icon-delay", category: "Actions" },
    ports: { inputs: 1, outputs: [{ label: "default" }] },
    schema: [
      {
        key: "sleep",
        label: "延迟",
        type: "number",
        widget: "duration",
        required: true,
        default: 1e3
      }
    ],
    defaults: { sleep: 1e3 }
  });
  registerNodeSpec({
    type: STEP_TYPES.TRIGGER,
    version: 1,
    display: { label: "触发器", iconClass: "icon-trigger", category: "Flow" },
    ports: { inputs: 0, outputs: [{ label: "default" }] },
    schema: [
      { key: "enabled", label: "启用", type: "boolean", default: true },
      { key: "description", label: "描述", type: "string" },
      {
        key: "modes",
        label: "模式",
        type: "object",
        fields: [
          { key: "manual", label: "手动", type: "boolean", default: true },
          { key: "url", label: "URL 触发", type: "boolean", default: false },
          { key: "contextMenu", label: "右键菜单", type: "boolean", default: false },
          { key: "command", label: "快捷键", type: "boolean", default: false },
          { key: "dom", label: "DOM 事件", type: "boolean", default: false },
          { key: "schedule", label: "定时", type: "boolean", default: false }
        ]
      },
      {
        key: "url",
        label: "URL 规则",
        type: "object",
        fields: [
          {
            key: "rules",
            label: "规则列表",
            type: "array",
            item: {
              key: "rule",
              label: "规则",
              type: "object",
              fields: [
                {
                  key: "kind",
                  label: "类型",
                  type: "select",
                  options: [
                    { label: "URL", value: "url" },
                    { label: "域名", value: "domain" },
                    { label: "路径", value: "path" }
                  ],
                  default: "url"
                },
                { key: "value", label: "值", type: "string" }
              ]
            }
          }
        ]
      },
      {
        key: "contextMenu",
        label: "右键菜单",
        type: "object",
        fields: [
          { key: "title", label: "标题", type: "string", default: "运行工作流" },
          { key: "enabled", label: "启用", type: "boolean", default: false }
        ]
      },
      {
        key: "command",
        label: "快捷键",
        type: "object",
        fields: [
          { key: "commandKey", label: "快捷键", type: "string" },
          { key: "enabled", label: "启用", type: "boolean", default: false }
        ]
      },
      {
        key: "dom",
        label: "DOM 事件",
        type: "object",
        fields: [
          { key: "selector", label: "选择器", type: "string" },
          { key: "appear", label: "出现", type: "boolean", default: true },
          { key: "once", label: "一次", type: "boolean", default: true },
          { key: "debounceMs", label: "防抖(ms)", type: "number", default: 800 },
          { key: "enabled", label: "启用", type: "boolean", default: false }
        ]
      },
      {
        key: "schedules",
        label: "定时",
        type: "array",
        item: {
          key: "sched",
          label: "计划",
          type: "object",
          fields: [
            { key: "id", label: "ID", type: "string" },
            {
              key: "type",
              label: "类型",
              type: "select",
              options: [
                { label: "一次", value: "once" },
                { label: "间隔", value: "interval" },
                { label: "每日", value: "daily" }
              ]
            },
            { key: "when", label: "时间(ISO/cron)", type: "string" },
            { key: "enabled", label: "启用", type: "boolean", default: true }
          ]
        }
      }
    ],
    defaults: { enabled: true }
  });
}
export {
  EDGE_LABELS as E,
  NativeMessageType as N,
  STEP_TYPES as S,
  TOOL_NAMES as T,
  getNodeSpec as g,
  listNodeSpecs as l,
  registerBuiltinSpecs as r,
  stepsToNodes as s,
  topoOrder as t
};
