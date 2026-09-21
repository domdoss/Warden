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
import { r as ref, R as shallowRef, a as computed, K as onUnmounted } from "./_plugin-vue_export-helper-DRi44jog.js";
const RR_V3_PORT_NAME = "rr_v3";
function generateRequestId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function isRpcResponse(msg) {
  return typeof msg === "object" && msg !== null && msg.type === "rr_v3.response";
}
function isRpcEvent(msg) {
  return typeof msg === "object" && msg !== null && msg.type === "rr_v3.event";
}
function createRpcRequest(method, params) {
  return {
    type: "rr_v3.request",
    requestId: generateRequestId(),
    method,
    params
  };
}
function toErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function isRunEvent(value) {
  if (typeof value !== "object" || value === null) return false;
  const obj = value;
  return typeof obj.runId === "string" && typeof obj.type === "string" && typeof obj.seq === "number" && typeof obj.ts === "number";
}
function useRRV3Rpc(options = {}) {
  var _a, _b, _c;
  const DEFAULT_TIMEOUT_MS = (_a = options.requestTimeoutMs) != null ? _a : 12e3;
  const MAX_RECONNECT_ATTEMPTS = (_b = options.maxReconnectAttempts) != null ? _b : 8;
  const BASE_RECONNECT_DELAY_MS = (_c = options.baseReconnectDelayMs) != null ? _c : 500;
  const connected = ref(false);
  const connecting = ref(false);
  const reconnecting = ref(false);
  const reconnectAttempts = ref(0);
  const lastError = ref(null);
  const pendingCount = ref(0);
  const subscribedRunIds = ref([]);
  const port = shallowRef(null);
  const pendingRequests = /* @__PURE__ */ new Map();
  const eventListeners = /* @__PURE__ */ new Set();
  const desiredSubscriptions = /* @__PURE__ */ new Set();
  let connectPromise = null;
  let reconnectTimer = null;
  let manualDisconnect = false;
  const isReady = computed(() => connected.value && port.value !== null);
  function setError(message) {
    var _a2;
    lastError.value = message;
    if (message) (_a2 = options.onError) == null ? void 0 : _a2.call(options, message);
  }
  function setConnected(next) {
    var _a2;
    if (connected.value === next) return;
    connected.value = next;
    (_a2 = options.onConnectionChange) == null ? void 0 : _a2.call(options, next);
  }
  function syncSubscriptionsSnapshot() {
    const arr = Array.from(desiredSubscriptions.values());
    arr.sort((a, b) => {
      if (a === null && b === null) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      return String(a).localeCompare(String(b));
    });
    subscribedRunIds.value = arr;
  }
  function cleanupPendingRequest(entry) {
    if (entry.timeoutId) {
      clearTimeout(entry.timeoutId);
      entry.timeoutId = null;
    }
    if (entry.signal && entry.abortHandler) {
      try {
        entry.signal.removeEventListener("abort", entry.abortHandler);
      } catch (e) {
      }
    }
  }
  function rejectAllPending(reason) {
    const error = new Error(reason);
    for (const [requestId, entry] of pendingRequests) {
      cleanupPendingRequest(entry);
      entry.reject(error);
      pendingRequests.delete(requestId);
    }
    pendingCount.value = 0;
  }
  function rehydrateSubscriptions() {
    return __async(this, null, function* () {
      if (!isReady.value || desiredSubscriptions.size === 0) return;
      for (const runId of desiredSubscriptions) {
        try {
          const params = runId === null ? {} : { runId };
          yield request("rr_v3.subscribe", params).catch(() => {
          });
        } catch (e) {
        }
      }
    });
  }
  function scheduleReconnect() {
    if (manualDisconnect || reconnectTimer) return;
    if (reconnectAttempts.value >= MAX_RECONNECT_ATTEMPTS) {
      reconnecting.value = false;
      setError("RR V3 RPC: max reconnect attempts reached");
      return;
    }
    reconnecting.value = true;
    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts.value);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectAttempts.value += 1;
      void connect().then((ok) => {
        if (!ok) scheduleReconnect();
      });
    }, delay);
  }
  function handlePortDisconnect() {
    var _a2;
    const disconnectReason = (_a2 = chrome.runtime.lastError) == null ? void 0 : _a2.message;
    const reason = disconnectReason ? `RR V3 RPC disconnected: ${disconnectReason}` : "RR V3 RPC disconnected";
    port.value = null;
    setConnected(false);
    connecting.value = false;
    rejectAllPending(reason);
    if (!manualDisconnect) {
      setError(reason);
      scheduleReconnect();
    }
  }
  function handlePortMessage(msg) {
    if (isRpcResponse(msg)) {
      const entry = pendingRequests.get(msg.requestId);
      if (!entry) return;
      pendingRequests.delete(msg.requestId);
      pendingCount.value = pendingRequests.size;
      cleanupPendingRequest(entry);
      if (msg.ok) {
        entry.resolve(msg.result);
      } else {
        entry.reject(new Error(msg.error || `RPC error: ${entry.method}`));
      }
      return;
    }
    if (isRpcEvent(msg)) {
      const event = msg.event;
      if (!isRunEvent(event)) return;
      for (const listener of eventListeners) {
        try {
          listener(event);
        } catch (e) {
          console.error("[useRRV3Rpc] Event listener error:", e);
        }
      }
    }
  }
  function connect() {
    return __async(this, null, function* () {
      if (isReady.value) return true;
      if (connectPromise) return connectPromise;
      connectPromise = (() => __async(null, null, function* () {
        var _a2;
        manualDisconnect = false;
        connecting.value = true;
        setError(null);
        try {
          if (typeof chrome === "undefined" || !((_a2 = chrome.runtime) == null ? void 0 : _a2.connect)) {
            setError("chrome.runtime.connect not available");
            return false;
          }
          const p = chrome.runtime.connect({ name: RR_V3_PORT_NAME });
          port.value = p;
          reconnectAttempts.value = 0;
          reconnecting.value = false;
          if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
          }
          p.onMessage.addListener(handlePortMessage);
          p.onDisconnect.addListener(handlePortDisconnect);
          setConnected(true);
          void rehydrateSubscriptions();
          return true;
        } catch (error) {
          setError(`Connection failed: ${toErrorMessage(error)}`);
          return false;
        } finally {
          connecting.value = false;
          connectPromise = null;
        }
      }))();
      return connectPromise;
    });
  }
  function disconnect(reason) {
    manualDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnecting.value = false;
    const p = port.value;
    port.value = null;
    setConnected(false);
    connecting.value = false;
    rejectAllPending(reason || "RR V3 RPC: client disconnected");
    if (p) {
      try {
        p.onMessage.removeListener(handlePortMessage);
        p.onDisconnect.removeListener(handlePortDisconnect);
        p.disconnect();
      } catch (e) {
      }
    }
  }
  function ensureConnected() {
    return __async(this, null, function* () {
      if (isReady.value) return true;
      return connect();
    });
  }
  function request(_0, _1) {
    return __async(this, arguments, function* (method, params, reqOptions = {}) {
      var _a2;
      const ready = yield ensureConnected();
      const p = port.value;
      if (!ready || !p) {
        throw new Error("RR V3 RPC: not connected");
      }
      const timeoutMs = (_a2 = reqOptions.timeoutMs) != null ? _a2 : DEFAULT_TIMEOUT_MS;
      const { signal } = reqOptions;
      if (signal == null ? void 0 : signal.aborted) {
        throw new Error("RPC request already aborted");
      }
      const req = createRpcRequest(method, params);
      return new Promise((resolve, reject) => {
        const entry = {
          method,
          resolve,
          reject,
          timeoutId: null,
          signal
        };
        const complete = (fn) => {
          pendingRequests.delete(req.requestId);
          pendingCount.value = pendingRequests.size;
          cleanupPendingRequest(entry);
          fn();
        };
        if (timeoutMs > 0) {
          entry.timeoutId = setTimeout(() => {
            complete(() => reject(new Error(`RPC timeout (${timeoutMs}ms): ${method}`)));
          }, timeoutMs);
        }
        if (signal) {
          const onAbort = () => {
            complete(() => reject(new Error("RPC request aborted")));
          };
          entry.abortHandler = onAbort;
          signal.addEventListener("abort", onAbort, { once: true });
        }
        pendingRequests.set(req.requestId, entry);
        pendingCount.value = pendingRequests.size;
        try {
          p.postMessage(req);
        } catch (e) {
          complete(() => reject(new Error(`Failed to send RPC request: ${toErrorMessage(e)}`)));
        }
      });
    });
  }
  function subscribe(runId = null) {
    return __async(this, null, function* () {
      desiredSubscriptions.add(runId);
      syncSubscriptionsSnapshot();
      try {
        const params = runId === null ? {} : { runId };
        yield request("rr_v3.subscribe", params);
        return true;
      } catch (error) {
        setError(toErrorMessage(error));
        return false;
      }
    });
  }
  function unsubscribe(runId = null) {
    return __async(this, null, function* () {
      desiredSubscriptions.delete(runId);
      syncSubscriptionsSnapshot();
      try {
        const params = runId === null ? {} : { runId };
        yield request("rr_v3.unsubscribe", params);
        return true;
      } catch (error) {
        setError(toErrorMessage(error));
        return false;
      }
    });
  }
  function onEvent(listener) {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  }
  onUnmounted(() => {
    disconnect("Component unmounted");
  });
  if (options.autoConnect) {
    void ensureConnected();
  }
  return {
    connected,
    connecting,
    reconnecting,
    reconnectAttempts,
    lastError,
    isReady,
    pendingCount,
    subscribedRunIds,
    connect,
    disconnect,
    ensureConnected,
    request,
    subscribe,
    unsubscribe,
    onEvent
  };
}
const scriptRel = "modulepreload";
const assetsURL = function(dep) {
  return "/" + dep;
};
const seen = {};
const __vitePreload = function preload(baseModule, deps, importerUrl) {
  let promise = Promise.resolve();
  if (deps && deps.length > 0) {
    let allSettled = function(promises$2) {
      return Promise.all(promises$2.map((p) => Promise.resolve(p).then((value$1) => ({
        status: "fulfilled",
        value: value$1
      }), (reason) => ({
        status: "rejected",
        reason
      }))));
    };
    document.getElementsByTagName("link");
    const cspNonceMeta = document.querySelector("meta[property=csp-nonce]");
    const cspNonce = (cspNonceMeta == null ? void 0 : cspNonceMeta.nonce) || (cspNonceMeta == null ? void 0 : cspNonceMeta.getAttribute("nonce"));
    promise = allSettled(deps.map((dep) => {
      dep = assetsURL(dep);
      if (dep in seen) return;
      seen[dep] = true;
      const isCss = dep.endsWith(".css");
      const cssSelector = isCss ? '[rel="stylesheet"]' : "";
      if (document.querySelector(`link[href="${dep}"]${cssSelector}`)) return;
      const link = document.createElement("link");
      link.rel = isCss ? "stylesheet" : scriptRel;
      if (!isCss) link.as = "script";
      link.crossOrigin = "";
      link.href = dep;
      if (cspNonce) link.setAttribute("nonce", cspNonce);
      document.head.appendChild(link);
      if (isCss) return new Promise((res, rej) => {
        link.addEventListener("load", res);
        link.addEventListener("error", () => rej(/* @__PURE__ */ new Error(`Unable to preload CSS for ${dep}`)));
      });
    }));
  }
  function handlePreloadError(err$2) {
    const e$1 = new Event("vite:preloadError", { cancelable: true });
    e$1.payload = err$2;
    window.dispatchEvent(e$1);
    if (!e$1.defaultPrevented) throw err$2;
  }
  return promise.then((res) => {
    for (const item of res || []) {
      if (item.status !== "rejected") continue;
      handlePreloadError(item.reason);
    }
    return baseModule().catch(handlePreloadError);
  });
};
export {
  __vitePreload as _,
  useRRV3Rpc as u
};
