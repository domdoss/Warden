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
import { S as SemanticSimilarityEngine } from "./semantic-similarity-engine-wZuaUprX.js";
import { O as OFFSCREEN_MESSAGE_TYPES, M as MessageTarget, S as SendMessageType, B as BACKGROUND_MESSAGE_TYPES } from "./message-types-DUXLbMdM.js";
import "./_commonjsHelpers-D8RWm_os.js";
var X = { trailer: 59 };
function F(t = 256) {
  let e = 0, s = new Uint8Array(t);
  return { get buffer() {
    return s.buffer;
  }, reset() {
    e = 0;
  }, bytesView() {
    return s.subarray(0, e);
  }, bytes() {
    return s.slice(0, e);
  }, writeByte(r) {
    n(e + 1), s[e] = r, e++;
  }, writeBytes(r, o = 0, i = r.length) {
    n(e + i);
    for (let c = 0; c < i; c++) s[e++] = r[c + o];
  }, writeBytesView(r, o = 0, i = r.byteLength) {
    n(e + i), s.set(r.subarray(o, o + i), e), e += i;
  } };
  function n(r) {
    var o = s.length;
    if (o >= r) return;
    var i = 1024 * 1024;
    r = Math.max(r, o * (o < i ? 2 : 1.125) >>> 0), o != 0 && (r = Math.max(r, 256));
    let c = s;
    s = new Uint8Array(r), e > 0 && s.set(c.subarray(0, e), 0);
  }
}
var O = 12, J = 5003, lt = [0, 1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 2047, 4095, 8191, 16383, 32767, 65535];
function at(t, e, s, n, r = F(512), o = new Uint8Array(256), i = new Int32Array(J), c = new Int32Array(J)) {
  let x = i.length, a = Math.max(2, n);
  o.fill(0), c.fill(0), i.fill(-1);
  let l = 0, f = 0, g = a + 1, h = g, b = false, w = h, _ = (1 << w) - 1, u = 1 << g - 1, k = u + 1, B = u + 2, p = 0, A = s[0], z = 0;
  for (let y = x; y < 65536; y *= 2) ++z;
  z = 8 - z, r.writeByte(a), I(u);
  let d = s.length;
  for (let y = 1; y < d; y++) {
    t: {
      let m = s[y], v = (m << O) + A, M = m << z ^ A;
      if (i[M] === v) {
        A = c[M];
        break t;
      }
      let V = M === 0 ? 1 : x - M;
      for (; i[M] >= 0; ) if (M -= V, M < 0 && (M += x), i[M] === v) {
        A = c[M];
        break t;
      }
      I(A), A = m, B < 1 << O ? (c[M] = B++, i[M] = v) : (i.fill(-1), B = u + 2, b = true, I(u));
    }
  }
  return I(A), I(k), r.writeByte(0), r.bytesView();
  function I(y) {
    for (l &= lt[f], f > 0 ? l |= y << f : l = y, f += w; f >= 8; ) o[p++] = l & 255, p >= 254 && (r.writeByte(p), r.writeBytesView(o, 0, p), p = 0), l >>= 8, f -= 8;
    if ((B > _ || b) && (b ? (w = h, _ = (1 << w) - 1, b = false) : (++w, _ = w === O ? 1 << w : (1 << w) - 1)), y == k) {
      for (; f > 0; ) o[p++] = l & 255, p >= 254 && (r.writeByte(p), r.writeBytesView(o, 0, p), p = 0), l >>= 8, f -= 8;
      p > 0 && (r.writeByte(p), r.writeBytesView(o, 0, p), p = 0);
    }
  }
}
var $ = at;
function D(t, e, s) {
  return t << 8 & 63488 | e << 2 & 992 | s >> 3;
}
function G(t, e, s, n) {
  return t >> 4 | e & 240 | (s & 240) << 4 | (n & 240) << 8;
}
function j(t, e, s) {
  return t >> 4 << 8 | e & 240 | s >> 4;
}
function R(t, e, s) {
  return t < e ? e : t > s ? s : t;
}
function T(t) {
  return t * t;
}
function tt(t, e, s) {
  var n = 0, r = 1e100;
  let o = t[e], i = o.cnt;
  o.ac;
  let x = o.rc, a = o.gc, l = o.bc;
  for (var f = o.fw; f != 0; f = t[f].fw) {
    let h = t[f], b = h.cnt, w = i * b / (i + b);
    if (!(w >= r)) {
      var g = 0;
      g += w * T(h.rc - x), !(g >= r) && (g += w * T(h.gc - a), !(g >= r) && (g += w * T(h.bc - l), !(g >= r) && (r = g, n = f)));
    }
  }
  o.err = r, o.nn = n;
}
function Q() {
  return { ac: 0, rc: 0, gc: 0, bc: 0, cnt: 0, nn: 0, fw: 0, bk: 0, tm: 0, mtm: 0, err: 0 };
}
function ut(t, e) {
  let s = e === "rgb444" ? 4096 : 65536, n = new Array(s), r = t.length;
  if (e === "rgba4444") for (let o = 0; o < r; ++o) {
    let i = t[o], c = i >> 24 & 255, x = i >> 16 & 255, a = i >> 8 & 255, l = i & 255, f = G(l, a, x, c), g = f in n ? n[f] : n[f] = Q();
    g.rc += l, g.gc += a, g.bc += x, g.ac += c, g.cnt++;
  }
  else if (e === "rgb444") for (let o = 0; o < r; ++o) {
    let i = t[o], c = i >> 16 & 255, x = i >> 8 & 255, a = i & 255, l = j(a, x, c), f = l in n ? n[l] : n[l] = Q();
    f.rc += a, f.gc += x, f.bc += c, f.cnt++;
  }
  else for (let o = 0; o < r; ++o) {
    let i = t[o], c = i >> 16 & 255, x = i >> 8 & 255, a = i & 255, l = D(a, x, c), f = l in n ? n[l] : n[l] = Q();
    f.rc += a, f.gc += x, f.bc += c, f.cnt++;
  }
  return n;
}
function H(t, e, s = {}) {
  let { format: n = "rgb565", clearAlpha: r = true, clearAlphaColor: o = 0, clearAlphaThreshold: i = 0, oneBitAlpha: c = false } = s;
  if (!t || !t.buffer) throw new Error("quantize() expected RGBA Uint8Array data");
  if (!(t instanceof Uint8Array) && !(t instanceof Uint8ClampedArray)) throw new Error("quantize() expected RGBA Uint8Array data");
  let x = new Uint32Array(t.buffer), a = s.useSqrt !== false, l = n === "rgba4444", f = ut(x, n), g = f.length, h = g - 1, b = new Uint32Array(g + 1);
  for (var w = 0, u = 0; u < g; ++u) {
    let C = f[u];
    if (C != null) {
      var _ = 1 / C.cnt;
      l && (C.ac *= _), C.rc *= _, C.gc *= _, C.bc *= _, f[w++] = C;
    }
  }
  T(e) / w < 0.022 && (a = false);
  for (var u = 0; u < w - 1; ++u) f[u].fw = u + 1, f[u + 1].bk = u, a && (f[u].cnt = Math.sqrt(f[u].cnt));
  a && (f[u].cnt = Math.sqrt(f[u].cnt));
  var k, B, p;
  for (u = 0; u < w; ++u) {
    tt(f, u);
    var A = f[u].err;
    for (B = ++b[0]; B > 1 && (p = B >> 1, !(f[k = b[p]].err <= A)); B = p) b[B] = k;
    b[B] = u;
  }
  var z = w - e;
  for (u = 0; u < z; ) {
    for (var d; ; ) {
      var I = b[1];
      if (d = f[I], d.tm >= d.mtm && f[d.nn].mtm <= d.tm) break;
      d.mtm == h ? I = b[1] = b[b[0]--] : (tt(f, I), d.tm = u);
      var A = f[I].err;
      for (B = 1; (p = B + B) <= b[0] && (p < b[0] && f[b[p]].err > f[b[p + 1]].err && p++, !(A <= f[k = b[p]].err)); B = p) b[B] = k;
      b[B] = I;
    }
    var y = f[d.nn], m = d.cnt, v = y.cnt, _ = 1 / (m + v);
    l && (d.ac = _ * (m * d.ac + v * y.ac)), d.rc = _ * (m * d.rc + v * y.rc), d.gc = _ * (m * d.gc + v * y.gc), d.bc = _ * (m * d.bc + v * y.bc), d.cnt += y.cnt, d.mtm = ++u, f[y.bk].fw = y.fw, f[y.fw].bk = y.bk, y.mtm = h;
  }
  let M = [];
  var V = 0;
  for (u = 0; ; ++V) {
    let L = R(Math.round(f[u].rc), 0, 255), C = R(Math.round(f[u].gc), 0, 255), Y = R(Math.round(f[u].bc), 0, 255), E = 255;
    if (l) {
      if (E = R(Math.round(f[u].ac), 0, 255), c) {
        let st = typeof c == "number" ? c : 127;
        E = E <= st ? 0 : 255;
      }
      r && E <= i && (L = C = Y = o, E = 0);
    }
    let K = l ? [L, C, Y, E] : [L, C, Y];
    if (xt(M, K) || M.push(K), (u = f[u].fw) == 0) break;
  }
  return M;
}
function xt(t, e) {
  for (let s = 0; s < t.length; s++) {
    let n = t[s], r = n[0] === e[0] && n[1] === e[1] && n[2] === e[2], o = n.length >= 4 && e.length >= 4 ? n[3] === e[3] : true;
    if (r && o) return true;
  }
  return false;
}
function nt(t, e, s = "rgb565") {
  if (!t || !t.buffer) throw new Error("quantize() expected RGBA Uint8Array data");
  if (!(t instanceof Uint8Array) && !(t instanceof Uint8ClampedArray)) throw new Error("quantize() expected RGBA Uint8Array data");
  if (e.length > 256) throw new Error("applyPalette() only works with 256 colors or less");
  let n = new Uint32Array(t.buffer), r = n.length, o = s === "rgb444" ? 4096 : 65536, i = new Uint8Array(r), c = new Array(o);
  if (s === "rgba4444") for (let a = 0; a < r; a++) {
    let l = n[a], f = l >> 24 & 255, g = l >> 16 & 255, h = l >> 8 & 255, b = l & 255, w = G(b, h, g, f), _ = w in c ? c[w] : c[w] = gt(b, h, g, f, e);
    i[a] = _;
  }
  else {
    let a = s === "rgb444" ? j : D;
    for (let l = 0; l < r; l++) {
      let f = n[l], g = f >> 16 & 255, h = f >> 8 & 255, b = f & 255, w = a(b, h, g), _ = w in c ? c[w] : c[w] = bt(b, h, g, e);
      i[l] = _;
    }
  }
  return i;
}
function gt(t, e, s, n, r) {
  let o = 0, i = 1e100;
  for (let c = 0; c < r.length; c++) {
    let x = r[c], a = x[3], l = q(a - n);
    if (l > i) continue;
    let f = x[0];
    if (l += q(f - t), l > i) continue;
    let g = x[1];
    if (l += q(g - e), l > i) continue;
    let h = x[2];
    l += q(h - s), !(l > i) && (i = l, o = c);
  }
  return o;
}
function bt(t, e, s, n) {
  let r = 0, o = 1e100;
  for (let i = 0; i < n.length; i++) {
    let c = n[i], x = c[0], a = q(x - t);
    if (a > o) continue;
    let l = c[1];
    if (a += q(l - e), a > o) continue;
    let f = c[2];
    a += q(f - s), !(a > o) && (o = a, r = i);
  }
  return r;
}
function q(t) {
  return t * t;
}
function ct(t = {}) {
  let { initialCapacity: e = 4096, auto: s = true } = t, n = F(e), r = 5003, o = new Uint8Array(256), i = new Int32Array(r), c = new Int32Array(r), x = false;
  return { reset() {
    n.reset(), x = false;
  }, finish() {
    n.writeByte(X.trailer);
  }, bytes() {
    return n.bytes();
  }, bytesView() {
    return n.bytesView();
  }, get buffer() {
    return n.buffer;
  }, get stream() {
    return n;
  }, writeHeader: a, writeFrame(l, f, g, h = {}) {
    let { transparent: b = false, transparentIndex: w = 0, delay: _ = 0, palette: u = null, repeat: k = 0, colorDepth: B = 8, dispose: p = -1 } = h, A = false;
    if (s ? x || (A = true, a(), x = true) : A = Boolean(h.first), f = Math.max(0, Math.floor(f)), g = Math.max(0, Math.floor(g)), A) {
      if (!u) throw new Error("First frame must include a { palette } option");
      pt(n, f, g, u, B), it(n, u), k >= 0 && dt(n, k);
    }
    let z = Math.round(_ / 10);
    wt(n, p, z, b, w);
    let d = Boolean(u) && !A;
    ht(n, f, g, d ? u : null), d && it(n, u), yt(n, l, f, g, B, o, i, c);
  } };
  function a() {
    ft(n, "GIF89a");
  }
}
function wt(t, e, s, n, r) {
  t.writeByte(33), t.writeByte(249), t.writeByte(4), r < 0 && (r = 0, n = false);
  var o, i;
  n ? (o = 1, i = 2) : (o = 0, i = 0), e >= 0 && (i = e & 7), i <<= 2;
  let c = 0;
  t.writeByte(0 | i | c | o), S(t, s), t.writeByte(r || 0), t.writeByte(0);
}
function pt(t, e, s, n, r = 8) {
  let o = 1, i = 0, c = Z(n.length) - 1, x = o << 7 | r - 1 << 4 | i << 3 | c, a = 0, l = 0;
  S(t, e), S(t, s), t.writeBytes([x, a, l]);
}
function dt(t, e) {
  t.writeByte(33), t.writeByte(255), t.writeByte(11), ft(t, "NETSCAPE2.0"), t.writeByte(3), t.writeByte(1), S(t, e), t.writeByte(0);
}
function it(t, e) {
  let s = 1 << Z(e.length);
  for (let n = 0; n < s; n++) {
    let r = [0, 0, 0];
    n < e.length && (r = e[n]), t.writeByte(r[0]), t.writeByte(r[1]), t.writeByte(r[2]);
  }
}
function ht(t, e, s, n) {
  if (t.writeByte(44), S(t, 0), S(t, 0), S(t, e), S(t, s), n) {
    let r = 0, o = 0, i = Z(n.length) - 1;
    t.writeByte(128 | r | o | 0 | i);
  } else t.writeByte(0);
}
function yt(t, e, s, n, r = 8, o, i, c) {
  $(s, n, e, r, t, o, i, c);
}
function S(t, e) {
  t.writeByte(e & 255), t.writeByte(e >> 8 & 255);
}
function ft(t, e) {
  for (var s = 0; s < e.length; s++) t.writeByte(e.charCodeAt(s));
}
function Z(t) {
  return Math.max(Math.ceil(Math.log2(t)), 1);
}
const state = {
  encoder: null,
  width: 0,
  height: 0,
  frameCount: 0,
  isInitialized: false
};
function initializeEncoder(width, height) {
  state.encoder = ct();
  state.width = width;
  state.height = height;
  state.frameCount = 0;
  state.isInitialized = true;
}
function addFrame(imageData, width, height, delay, maxColors = 256) {
  if (!state.isInitialized || state.width !== width || state.height !== height) {
    initializeEncoder(width, height);
  }
  if (!state.encoder) {
    throw new Error("GIF encoder not initialized");
  }
  const palette = H(imageData, maxColors, { format: "rgb444" });
  const indexedPixels = nt(imageData, palette, "rgb444");
  state.encoder.writeFrame(indexedPixels, width, height, {
    palette,
    delay,
    dispose: 2
    // Restore to background color
  });
  state.frameCount++;
}
function finishEncoding() {
  if (!state.encoder) {
    throw new Error("GIF encoder not initialized");
  }
  state.encoder.finish();
  const bytes = state.encoder.bytes();
  resetEncoder();
  return bytes;
}
function resetEncoder() {
  if (state.encoder) {
    state.encoder.reset();
  }
  state.encoder = null;
  state.width = 0;
  state.height = 0;
  state.frameCount = 0;
  state.isInitialized = false;
}
function isGifMessage(message) {
  if (!message || typeof message !== "object") return false;
  const msg = message;
  if (msg.target !== MessageTarget.Offscreen) return false;
  const gifTypes = [
    OFFSCREEN_MESSAGE_TYPES.GIF_ADD_FRAME,
    OFFSCREEN_MESSAGE_TYPES.GIF_FINISH,
    OFFSCREEN_MESSAGE_TYPES.GIF_RESET
  ];
  return gifTypes.includes(msg.type);
}
function handleGifMessage(message, sendResponse) {
  if (!isGifMessage(message)) {
    return false;
  }
  try {
    switch (message.type) {
      case OFFSCREEN_MESSAGE_TYPES.GIF_ADD_FRAME: {
        const { imageData, width, height, delay, maxColors } = message;
        const clampedData = new Uint8ClampedArray(imageData);
        addFrame(clampedData, width, height, delay, maxColors);
        sendResponse({
          success: true,
          frameCount: state.frameCount
        });
        break;
      }
      case OFFSCREEN_MESSAGE_TYPES.GIF_FINISH: {
        const gifBytes = finishEncoding();
        sendResponse({
          success: true,
          gifData: Array.from(gifBytes),
          byteLength: gifBytes.byteLength
        });
        break;
      }
      case OFFSCREEN_MESSAGE_TYPES.GIF_RESET: {
        resetEncoder();
        sendResponse({ success: true });
        break;
      }
      default:
        sendResponse({ success: false, error: `Unknown GIF message type` });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("GIF encoder error:", errorMessage);
    sendResponse({ success: false, error: errorMessage });
  }
  return true;
}
console.log("GIF encoder module loaded");
const RR_V3_KEEPALIVE_PORT_NAME = "rr_v3_keepalive";
const DEFAULT_KEEPALIVE_PING_INTERVAL_MS = 2e4;
const KEEPALIVE_CONTROL_MESSAGE_TYPE = "rr_v3_keepalive.control";
function isKeepaliveControlMessage(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  if (v.type !== KEEPALIVE_CONTROL_MESSAGE_TYPE) return false;
  return v.command === "start" || v.command === "stop";
}
let initialized = false;
let keepalivePort = null;
let pingTimer = null;
let keepaliveDesired = false;
let reconnectTimer = null;
function isKeepaliveMessage(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  const type = v.type;
  if (type !== "keepalive.ping" && type !== "keepalive.pong" && type !== "keepalive.start" && type !== "keepalive.stop") {
    return false;
  }
  return typeof v.timestamp === "number" && Number.isFinite(v.timestamp);
}
function scheduleReconnect(delayMs = 1e3) {
  if (!initialized) return;
  if (!keepaliveDesired) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!initialized) return;
    if (!keepaliveDesired) return;
    if (!keepalivePort) {
      console.log("[rr-keepalive] Attempting scheduled reconnect...");
      keepalivePort = connectToBackground();
    }
  }, delayMs);
}
function connectToBackground() {
  var _a;
  if (typeof chrome === "undefined" || !((_a = chrome.runtime) == null ? void 0 : _a.connect)) {
    console.warn("[rr-keepalive] chrome.runtime.connect not available");
    return null;
  }
  try {
    const port = chrome.runtime.connect({ name: RR_V3_KEEPALIVE_PORT_NAME });
    port.onMessage.addListener((msg) => {
      if (!isKeepaliveMessage(msg)) return;
      if (msg.type === "keepalive.start") {
        console.log("[rr-keepalive] Received start command via Port");
        startPingLoop();
      } else if (msg.type === "keepalive.stop") {
        console.log("[rr-keepalive] Received stop command via Port");
        stopPingLoop();
      } else if (msg.type === "keepalive.pong") {
        console.debug("[rr-keepalive] Received pong");
      }
    });
    port.onDisconnect.addListener(() => {
      console.log("[rr-keepalive] Port disconnected");
      keepalivePort = null;
      scheduleReconnect(1e3);
    });
    console.log("[rr-keepalive] Connected to background");
    return port;
  } catch (e) {
    console.warn("[rr-keepalive] Failed to connect:", e);
    return null;
  }
}
function sendPing() {
  if (!keepalivePort) {
    keepalivePort = connectToBackground();
  }
  if (!keepalivePort) return;
  const msg = {
    type: "keepalive.ping",
    timestamp: Date.now()
  };
  try {
    keepalivePort.postMessage(msg);
    console.debug("[rr-keepalive] Sent ping");
  } catch (e) {
    console.warn("[rr-keepalive] Failed to send ping:", e);
    keepalivePort = null;
    scheduleReconnect(1e3);
  }
}
function startPingLoop() {
  if (pingTimer) return;
  keepaliveDesired = true;
  if (!keepalivePort) {
    keepalivePort = connectToBackground();
  }
  sendPing();
  pingTimer = setInterval(() => {
    sendPing();
  }, DEFAULT_KEEPALIVE_PING_INTERVAL_MS);
  console.log(
    `[rr-keepalive] Ping loop started (interval=${DEFAULT_KEEPALIVE_PING_INTERVAL_MS}ms)`
  );
}
function stopPingLoop() {
  keepaliveDesired = false;
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (keepalivePort) {
    try {
      keepalivePort.disconnect();
    } catch (e) {
    }
    keepalivePort = null;
  }
  console.log("[rr-keepalive] Ping loop stopped");
}
function initKeepalive() {
  var _a, _b;
  if (initialized) return;
  initialized = true;
  if (typeof chrome === "undefined" || !((_a = chrome.runtime) == null ? void 0 : _a.onMessage)) {
    console.warn("[rr-keepalive] chrome.runtime.onMessage not available");
    return;
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!isKeepaliveControlMessage(msg)) return;
    if (msg.command === "start") {
      console.log("[rr-keepalive] Received runtime start command");
      startPingLoop();
    } else {
      console.log("[rr-keepalive] Received runtime stop command");
      stopPingLoop();
    }
    try {
      sendResponse({ ok: true });
    } catch (e) {
    }
  });
  if ((_b = chrome.runtime) == null ? void 0 : _b.connect) {
    keepalivePort = connectToBackground();
  }
  console.log("[rr-keepalive] Keepalive initialized");
}
initKeepalive();
let similarityEngine = null;
chrome.runtime.onMessage.addListener(
  (message, _sender, sendResponse) => {
    if (message.target !== MessageTarget.Offscreen) {
      return;
    }
    if (handleGifMessage(message, sendResponse)) {
      return true;
    }
    try {
      switch (message.type) {
        case SendMessageType.SimilarityEngineInit:
        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_INIT: {
          const initMsg = message;
          console.log("Offscreen: Received similarity engine init message:", message.type);
          handleSimilarityEngineInit(initMsg.config).then(() => sendResponse({ success: true })).catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }
        case SendMessageType.SimilarityEngineComputeBatch: {
          const computeMsg = message;
          handleComputeSimilarityBatch(computeMsg.pairs, computeMsg.options).then((similarities) => sendResponse({ success: true, similarities })).catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }
        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_COMPUTE: {
          const embeddingMsg = message;
          handleGetEmbedding(embeddingMsg.text, embeddingMsg.options).then((embedding) => {
            console.log("Offscreen: Sending embedding response:", {
              length: embedding.length,
              type: typeof embedding,
              constructor: embedding.constructor.name,
              isFloat32Array: embedding instanceof Float32Array,
              firstFewValues: Array.from(embedding.slice(0, 5))
            });
            const embeddingArray = Array.from(embedding);
            console.log("Offscreen: Converted to array:", {
              length: embeddingArray.length,
              type: typeof embeddingArray,
              isArray: Array.isArray(embeddingArray),
              firstFewValues: embeddingArray.slice(0, 5)
            });
            sendResponse({ success: true, embedding: embeddingArray });
          }).catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }
        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_BATCH_COMPUTE: {
          const batchMsg = message;
          handleGetEmbeddingsBatch(batchMsg.texts, batchMsg.options).then(
            (embeddings) => sendResponse({
              success: true,
              embeddings: embeddings.map((emb) => Array.from(emb))
            })
          ).catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }
        case OFFSCREEN_MESSAGE_TYPES.SIMILARITY_ENGINE_STATUS: {
          handleGetEngineStatus().then((status) => sendResponse(__spreadValues({ success: true }, status))).catch((error) => sendResponse({ success: false, error: error.message }));
          break;
        }
        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (error) {
      if (error instanceof Error) {
        sendResponse({ error: error.message });
      } else {
        sendResponse({ error: "Unknown error occurred" });
      }
    }
    return true;
  }
);
let currentModelConfig = null;
function needsReinitialization(newConfig) {
  if (!similarityEngine || !currentModelConfig) {
    return true;
  }
  const keyFields = ["modelPreset", "modelVersion", "modelIdentifier", "dimension"];
  for (const field of keyFields) {
    if (newConfig[field] !== currentModelConfig[field]) {
      console.log(
        `Offscreen: ${field} changed from ${currentModelConfig[field]} to ${newConfig[field]}`
      );
      return true;
    }
  }
  return false;
}
function handleSimilarityEngineInit(config) {
  return __async(this, null, function* () {
    console.log("Offscreen: Initializing semantic similarity engine with config:", config);
    console.log("Offscreen: Config useLocalFiles:", config.useLocalFiles);
    console.log("Offscreen: Config modelPreset:", config.modelPreset);
    console.log("Offscreen: Config modelVersion:", config.modelVersion);
    console.log("Offscreen: Config modelDimension:", config.modelDimension);
    console.log("Offscreen: Config modelIdentifier:", config.modelIdentifier);
    const needsReinit = needsReinitialization(config);
    console.log("Offscreen: Needs reinitialization:", needsReinit);
    if (!needsReinit) {
      console.log("Offscreen: Using existing engine (no changes detected)");
      yield updateModelStatus("ready", 100);
      return;
    }
    if (similarityEngine) {
      console.log("Offscreen: Cleaning up existing engine for model switch...");
      try {
        yield similarityEngine.dispose();
        console.log("Offscreen: Previous engine disposed successfully");
      } catch (error) {
        console.warn("Offscreen: Failed to dispose previous engine:", error);
      }
      similarityEngine = null;
      currentModelConfig = null;
      try {
        console.log("Offscreen: Clearing IndexedDB vector data for model switch...");
        yield clearVectorIndexedDB();
        console.log("Offscreen: IndexedDB vector data cleared successfully");
      } catch (error) {
        console.warn("Offscreen: Failed to clear IndexedDB vector data:", error);
      }
    }
    try {
      yield updateModelStatus("initializing", 10);
      const progressCallback = (progress) => __async(null, null, function* () {
        console.log("Offscreen: Progress update:", progress);
        yield updateModelStatus(progress.status, progress.progress);
      });
      similarityEngine = new SemanticSimilarityEngine(config);
      console.log("Offscreen: Starting engine initialization with progress tracking...");
      if (typeof similarityEngine.initializeWithProgress === "function") {
        yield similarityEngine.initializeWithProgress(progressCallback);
      } else {
        console.log("Offscreen: Using standard initialization (no progress callback support)");
        yield updateModelStatus("downloading", 30);
        yield similarityEngine.initialize();
        yield updateModelStatus("ready", 100);
      }
      currentModelConfig = __spreadValues({}, config);
      console.log("Offscreen: Semantic similarity engine initialized successfully");
    } catch (error) {
      console.error("Offscreen: Failed to initialize semantic similarity engine:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown initialization error";
      const errorType = analyzeErrorType(errorMessage);
      yield updateModelStatus("error", 0, errorMessage, errorType);
      similarityEngine = null;
      currentModelConfig = null;
      throw error;
    }
  });
}
function clearVectorIndexedDB() {
  return __async(this, null, function* () {
    try {
      const dbNames = ["VectorSearchDB", "ContentIndexerDB", "SemanticSimilarityDB"];
      for (const dbName of dbNames) {
        try {
          const deleteRequest = indexedDB.deleteDatabase(dbName);
          yield new Promise((resolve, _reject) => {
            deleteRequest.onsuccess = () => {
              console.log(`Offscreen: Successfully deleted database: ${dbName}`);
              resolve();
            };
            deleteRequest.onerror = () => {
              console.warn(`Offscreen: Failed to delete database: ${dbName}`, deleteRequest.error);
              resolve();
            };
            deleteRequest.onblocked = () => {
              console.warn(`Offscreen: Database deletion blocked: ${dbName}`);
              resolve();
            };
          });
        } catch (error) {
          console.warn(`Offscreen: Error deleting database ${dbName}:`, error);
        }
      }
    } catch (error) {
      console.error("Offscreen: Failed to clear vector IndexedDB:", error);
      throw error;
    }
  });
}
function analyzeErrorType(errorMessage) {
  const message = errorMessage.toLowerCase();
  if (message.includes("network") || message.includes("fetch") || message.includes("timeout") || message.includes("connection") || message.includes("cors") || message.includes("failed to fetch")) {
    return "network";
  }
  if (message.includes("corrupt") || message.includes("invalid") || message.includes("format") || message.includes("parse") || message.includes("decode") || message.includes("onnx")) {
    return "file";
  }
  return "unknown";
}
function updateModelStatus(status, progress, errorMessage, errorType) {
  return __async(this, null, function* () {
    try {
      const modelState = {
        status,
        downloadProgress: progress,
        isDownloading: status === "downloading" || status === "initializing",
        lastUpdated: Date.now(),
        errorMessage: errorMessage || "",
        errorType: errorType || ""
      };
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        yield chrome.storage.local.set({ modelState });
      } else {
        console.log("Offscreen: chrome.storage not available, sending message to background");
        try {
          yield chrome.runtime.sendMessage({
            type: BACKGROUND_MESSAGE_TYPES.UPDATE_MODEL_STATUS,
            modelState
          });
        } catch (messageError) {
          console.error("Offscreen: Failed to send status update message:", messageError);
        }
      }
    } catch (error) {
      console.error("Offscreen: Failed to update model status:", error);
    }
  });
}
function handleComputeSimilarityBatch(_0) {
  return __async(this, arguments, function* (pairs, options = {}) {
    if (!similarityEngine) {
      throw new Error("Similarity engine not initialized. Please reinitialize the engine.");
    }
    console.log(`Offscreen: Computing similarities for ${pairs.length} pairs`);
    const similarities = yield similarityEngine.computeSimilarityBatch(pairs, options);
    console.log("Offscreen: Similarity computation completed");
    return similarities;
  });
}
function handleGetEmbedding(_0) {
  return __async(this, arguments, function* (text, options = {}) {
    if (!similarityEngine) {
      throw new Error("Similarity engine not initialized. Please reinitialize the engine.");
    }
    console.log(`Offscreen: Getting embedding for text: "${text.substring(0, 50)}..."`);
    const embedding = yield similarityEngine.getEmbedding(text, options);
    console.log("Offscreen: Embedding computation completed");
    return embedding;
  });
}
function handleGetEmbeddingsBatch(_0) {
  return __async(this, arguments, function* (texts, options = {}) {
    if (!similarityEngine) {
      throw new Error("Similarity engine not initialized. Please reinitialize the engine.");
    }
    console.log(`Offscreen: Getting embeddings for ${texts.length} texts`);
    const embeddings = yield similarityEngine.getEmbeddingsBatch(texts, options);
    console.log("Offscreen: Batch embedding computation completed");
    return embeddings;
  });
}
function handleGetEngineStatus() {
  return __async(this, null, function* () {
    return {
      isInitialized: !!similarityEngine,
      currentConfig: currentModelConfig
    };
  });
}
console.log("Offscreen: Semantic similarity engine handler loaded");
