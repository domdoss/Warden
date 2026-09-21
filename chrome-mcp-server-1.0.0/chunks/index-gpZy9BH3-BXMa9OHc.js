import { d as defineComponent, a as computed, j as getCurrentInstance, r as ref, w as watch, P as onBeforeUnmount, A as createBlock, b as createElementBlock, K as onUnmounted, e as openBlock, u as unref, z as createCommentVNode, Y as withDirectives, y as createBaseVNode, f as renderSlot, H as toDisplayString, D as normalizeStyle, F as Fragment, a2 as vShow, n as normalizeClass, o as onMounted, X as withModifiers, a4 as Teleport, C as nextTick } from "./_plugin-vue_export-helper-DRi44jog.js";
import { Z, m as mo$1, q as qo, P as Pl, f as fo$1, U as Us, Y as Ys, b as mn, D as Dn, u as uo$1, B as Ba, z as zl } from "./sidepanel-6Tj8Fb70.js";
import "./_virtual_wxt-html-plugins-Cyikj0JH.js";
import "./index-BYjKghw9.js";
import "./message-types-DUXLbMdM.js";
import "./useAgentTheme-PaQCh03y.js";
import "./preload-helper-Cu8Qyz_K.js";
/* empty css                  */
/* empty css                    */
var Ot = Object.defineProperty, Dt = Object.defineProperties;
var $t = Object.getOwnPropertyDescriptors;
var je = Object.getOwnPropertySymbols;
var Nt = Object.prototype.hasOwnProperty, zt = Object.prototype.propertyIsEnumerable;
var We = (f, s, i) => s in f ? Ot(f, s, { enumerable: true, configurable: true, writable: true, value: i }) : f[s] = i, be = (f, s) => {
  for (var i in s || (s = {}))
    Nt.call(s, i) && We(f, i, s[i]);
  if (je)
    for (var i of je(s))
      zt.call(s, i) && We(f, i, s[i]);
  return f;
}, Ce = (f, s) => Dt(f, $t(s));
var R = (f, s, i) => new Promise((q, Y) => {
  var L = (x) => {
    try {
      O(i.next(x));
    } catch (c) {
      Y(c);
    }
  }, w = (x) => {
    try {
      O(i.throw(x));
    } catch (c) {
      Y(c);
    }
  }, O = (x) => x.done ? q(x.value) : Promise.resolve(x.value).then(L, w);
  O((i = i.apply(f, s)).next());
});
const Kt = { class: "html-preview-frame__header" }, Jt = { class: "html-preview-frame__title" }, Qt = { class: "html-preview-frame__label" }, Zt = ["srcdoc"], eo = /* @__PURE__ */ defineComponent({
  __name: "HtmlPreviewFrame",
  props: {
    code: {},
    isDark: { type: Boolean },
    onClose: { type: Function },
    title: {}
  },
  setup(f) {
    const s = f, { t: i } = mo$1(), q = computed(() => {
      const L = s.code || "", w = L.trim().toLowerCase();
      if (w.startsWith("<!doctype") || w.startsWith("<html") || w.startsWith("<body"))
        return L;
      const O = s.isDark ? "#020617" : "#ffffff", x = s.isDark ? "#e5e7eb" : "#020617";
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        height: 100%;
        background-color: ${O};
        color: ${x};
      }
      body {
        font-family: system-ui, -apple-system, BlinkMacSystemFont, 'SF Pro Text', ui-sans-serif, sans-serif;
      }
    </style>
  </head>
  <body>
    ${L}
  </body>
</html>`;
    });
    function Y(L) {
      var w;
      (L.key === "Escape" || L.key === "Esc") && ((w = s.onClose) == null || w.call(s));
    }
    return onMounted(() => {
      typeof window != "undefined" && window.addEventListener("keydown", Y);
    }), onUnmounted(() => {
      typeof window != "undefined" && window.removeEventListener("keydown", Y);
    }), (L, w) => (openBlock(), createBlock(Teleport, { to: "body" }, [
      createBaseVNode("div", {
        class: normalizeClass(["html-preview-frame__backdrop", { "html-preview-frame__backdrop--dark": s.isDark }]),
        onClick: w[2] || (w[2] = (O) => {
          var x;
          return (x = s.onClose) == null ? void 0 : x.call(s);
        })
      }, [
        createBaseVNode("div", {
          class: normalizeClass(["html-preview-frame", { "html-preview-frame--dark": s.isDark }]),
          onClick: w[1] || (w[1] = withModifiers(() => {
          }, ["stop"]))
        }, [
          createBaseVNode("div", Kt, [
            createBaseVNode("div", Jt, [
              w[3] || (w[3] = createBaseVNode("span", { class: "html-preview-frame__dot" }, null, -1)),
              createBaseVNode("span", Qt, toDisplayString(s.title || unref(i)("common.preview") || "Preview"), 1)
            ]),
            createBaseVNode("button", {
              type: "button",
              class: normalizeClass(["html-preview-frame__close", { "html-preview-frame__close--dark": s.isDark }]),
              onClick: w[0] || (w[0] = (O) => {
                var x;
                return (x = s.onClose) == null ? void 0 : x.call(s);
              })
            }, " × ", 2)
          ]),
          createBaseVNode("iframe", {
            class: "html-preview-frame__iframe",
            sandbox: "allow-scripts allow-same-origin",
            srcdoc: q.value
          }, null, 8, Zt)
        ], 2)
      ], 2)
    ]));
  }
}), to = /* @__PURE__ */ Z(eo, [["__scopeId", "data-v-3cf0ed56"]]), oo = {
  key: 0,
  class: "code-block-header flex justify-between items-center px-4 py-2.5 border-b border-gray-400/5",
  style: { color: "var(--vscode-editor-foreground)", "background-color": "var(--vscode-editor-background)" }
}, no = { class: "flex items-center space-x-2 flex-1 overflow-hidden" }, io = ["innerHTML"], lo = { class: "text-sm font-medium font-mono truncate" }, ao = { class: "flex items-center space-x-2" }, ro = ["aria-pressed"], so = ["disabled"], uo = ["disabled"], co = ["disabled"], fo = ["aria-label"], vo = {
  key: 0,
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": "true",
  role: "img",
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  class: "w-3 h-3"
}, mo = {
  key: 1,
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": "true",
  role: "img",
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  class: "w-3 h-3"
}, ho = ["aria-pressed"], go = {
  key: 0,
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": "true",
  role: "img",
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  class: "w-3 h-3"
}, po = {
  key: 1,
  xmlns: "http://www.w3.org/2000/svg",
  "xmlns:xlink": "http://www.w3.org/1999/xlink",
  "aria-hidden": "true",
  role: "img",
  width: "1em",
  height: "1em",
  viewBox: "0 0 24 24",
  class: "w-3 h-3"
}, wo = ["aria-label"], yo = { class: "code-loading-placeholder" }, ko = {
  class: "sr-only",
  "aria-live": "polite",
  role: "status"
}, Je = "__markstreamMonacoPassiveTouch__", Qe = 10, Ze = 36, et = 1, tt = 0, ot = 1.5, ue = 1, xo = /* @__PURE__ */ defineComponent({
  __name: "CodeBlockNode",
  props: {
    node: {},
    isDark: { type: Boolean },
    loading: { type: Boolean, default: true },
    stream: { type: Boolean, default: true },
    darkTheme: { default: void 0 },
    lightTheme: { default: void 0 },
    isShowPreview: { type: Boolean, default: true },
    monacoOptions: {},
    enableFontSizeControl: { type: Boolean, default: true },
    minWidth: { default: void 0 },
    maxWidth: { default: void 0 },
    themes: {},
    showHeader: { type: Boolean, default: true },
    showCopyButton: { type: Boolean, default: true },
    showExpandButton: { type: Boolean, default: true },
    showPreviewButton: { type: Boolean, default: true },
    showFontSizeButtons: { type: Boolean, default: true },
    customId: {}
  },
  emits: ["previewCode", "copy"],
  setup(f, { emit: s }) {
    var _e;
    const i = f, q = s;
    typeof window != "undefined" && Y();
    function Y() {
      var t;
      try {
        const e = window;
        if (e[Je])
          return;
        const o = (t = window.Element) == null ? void 0 : t.prototype, n = o == null ? void 0 : o.addEventListener;
        if (!o || !n)
          return;
        o.addEventListener = function(a, h, m) {
          return a === "touchstart" && L(this, m) ? n.call(this, a, h, w(m)) : n.call(this, a, h, m);
        }, e[Je] = true;
      } catch (e) {
      }
    }
    function L(t, e) {
      if (!t)
        return false;
      const o = t;
      return !(typeof o.closest != "function" || !o.closest(".monaco-editor, .monaco-diff-editor") || e && typeof e == "object" && "passive" in e);
    }
    function w(t) {
      return t == null ? { passive: true } : typeof t == "boolean" ? { capture: t, passive: true } : typeof t == "object" ? "passive" in t ? t : Ce(be({}, t), { passive: true }) : { passive: true };
    }
    const O = getCurrentInstance(), x = computed(() => {
      const t = O == null ? void 0 : O.vnode.props;
      return !!(t && (t.onPreviewCode || t.onPreviewCode));
    }), { t: c } = mo$1(), b = ref(null), ce = ref(null), X = ref(false), D = ref(qo(i.node.language)), K = computed(() => Pl(D.value)), M = ref(false), B = ref(false), te = ref(false), He = ref(false), j = ref(null);
    let de = 0;
    const rt = fo$1(), J = ref(null), I = ref(typeof window == "undefined");
    typeof window != "undefined" && watch(
      () => ce.value,
      (t) => {
        var o;
        if ((o = J.value) == null || o.destroy(), J.value = null, !t) {
          I.value = false;
          return;
        }
        const e = rt(t, { rootMargin: "400px" });
        J.value = e, I.value = e.isVisible.value, e.whenVisible.then(() => {
          I.value = true;
        });
      },
      { immediate: true }
    ), onBeforeUnmount(() => {
      var t;
      (t = J.value) == null || t.destroy(), J.value = null;
    });
    let V = null, oe = null, fe = () => {
    }, ve = () => {
    }, ne = () => null, z = () => ({ getModel: () => ({ getLineCount: () => 1 }), getOption: () => 14, updateOptions: () => {
    } }), $ = () => ({ getModel: () => ({ getLineCount: () => 1 }), getOption: () => 14, updateOptions: () => {
    } }), ie = () => {
    }, me = () => {
    }, Q = null, Pe = () => {
      var t;
      return String((t = i.node.language) != null ? t : "plaintext");
    }, he = () => R(null, null, function* () {
    });
    const T = computed(() => i.node.diff), ge = ref(false), le = ref(false);
    typeof window != "undefined" && R(null, null, function* () {
      try {
        const t = yield zl();
        if (!t) {
          ge.value = true;
          return;
        }
        const e = t.useMonaco, o = t.detectLanguage;
        if (typeof o == "function" && (Pe = o), typeof e == "function") {
          const n = ze();
          if (n && i.themes && Array.isArray(i.themes) && !i.themes.includes(n))
            throw new Error("Preferred theme not in provided themes array");
          const l = e(Ce(be({
            wordWrap: "on",
            wrappingIndent: "same",
            themes: i.themes,
            theme: n
          }, i.monacoOptions || {}), {
            onThemeChange() {
              vt();
            }
          }));
          V = l.createEditor || V, oe = l.createDiffEditor || oe, fe = l.updateCode || fe, ve = l.updateDiff || ve, ne = l.getEditor || ne, z = l.getEditorView || z, $ = l.getDiffEditorView || $, ie = l.cleanupEditor || ie, me = l.safeClean || l.cleanupEditor || me, he = l.setTheme || he, He.value = true, b.value && (yield ke(b.value));
        }
      } catch (t) {
        ge.value = true;
      }
    });
    const H = ref(
      typeof ((_e = i.monacoOptions) == null ? void 0 : _e.fontSize) == "number" ? i.monacoOptions.fontSize : Number.NaN
    ), v = ref(H.value), st = computed(() => {
      const t = H.value, e = v.value;
      return typeof t == "number" && Number.isFinite(t) && t > 0 && typeof e == "number" && Number.isFinite(e) && e > 0;
    });
    function ut() {
      try {
        const t = b.value;
        if (!t)
          return null;
        const e = t.querySelector(".view-lines .view-line");
        if (e) {
          const o = Math.ceil(e.getBoundingClientRect().height);
          if (o > 0)
            return o;
        }
      } catch (t) {
      }
      return null;
    }
    function Le() {
      var t, e, o, n, l;
      try {
        const a = T.value ? (o = (e = (t = $()) == null ? void 0 : t.getModifiedEditor) == null ? void 0 : e.call(t)) != null ? o : $() : z(), h = ne(), m = (n = h == null ? void 0 : h.EditorOption) == null ? void 0 : n.fontInfo;
        if (a && m != null) {
          const y = (l = a.getOption) == null ? void 0 : l.call(a, m), d = y == null ? void 0 : y.fontSize;
          if (typeof d == "number" && Number.isFinite(d) && d > 0)
            return d;
        }
      } catch (a) {
      }
      try {
        const a = b.value;
        if (a) {
          const h = a.querySelector(".view-lines .view-line");
          if (h)
            try {
              if (typeof window != "undefined" && typeof window.getComputedStyle == "function") {
                const m = window.getComputedStyle(h).fontSize, y = m && m.match(/^(\d+(?:\.\d+)?)/);
                if (y)
                  return Number.parseFloat(y[1]);
              }
            } catch (m) {
            }
        }
      } catch (a) {
      }
      return null;
    }
    function pe(t) {
      var n, l;
      try {
        const a = ne(), h = (n = a == null ? void 0 : a.EditorOption) == null ? void 0 : n.lineHeight;
        if (h != null) {
          const m = (l = t == null ? void 0 : t.getOption) == null ? void 0 : l.call(t, h);
          if (typeof m == "number" && m > 0)
            return m;
        }
      } catch (a) {
      }
      const e = ut();
      if (e && e > 0)
        return e;
      const o = Number.isFinite(v.value) && v.value > 0 ? v.value : 12;
      return Math.max(12, Math.round(o * 1.35));
    }
    function we() {
      var e;
      if (Number.isFinite(v.value) && v.value > 0 && Number.isFinite(H.value))
        return v.value;
      const t = Le();
      return typeof ((e = i.monacoOptions) == null ? void 0 : e.fontSize) == "number" ? (H.value = i.monacoOptions.fontSize, v.value = i.monacoOptions.fontSize, v.value) : t && t > 0 ? (H.value = t, v.value = t, t) : (H.value = 12, v.value = 12, 12);
    }
    function ct() {
      const t = we(), e = Math.min(Ze, t + et);
      v.value = e;
    }
    function dt() {
      const t = we(), e = Math.max(Qe, t - et);
      v.value = e;
    }
    function ft() {
      we(), Number.isFinite(H.value) && (v.value = H.value);
    }
    function Oe() {
      var t, e, o, n, l, a, h, m, y, d, g, Ie, Ve, Re;
      try {
        const u = T.value ? $() : z();
        if (!u)
          return null;
        if (T.value && (u != null && u.getOriginalEditor) && (u != null && u.getModifiedEditor)) {
          const k = (t = u.getOriginalEditor) == null ? void 0 : t.call(u), C = (e = u.getModifiedEditor) == null ? void 0 : e.call(u);
          (o = k == null ? void 0 : k.layout) == null || o.call(k), (n = C == null ? void 0 : C.layout) == null || n.call(C);
          const St = ((l = k == null ? void 0 : k.getContentHeight) == null ? void 0 : l.call(k)) || 0, Ft = ((a = C == null ? void 0 : C.getContentHeight) == null ? void 0 : a.call(C)) || 0, Ye = Math.max(St, Ft);
          if (Ye > 0)
            return Math.ceil(Ye + ue);
          const Tt = ((y = (m = (h = k == null ? void 0 : k.getModel) == null ? void 0 : h.call(k)) == null ? void 0 : m.getLineCount) == null ? void 0 : y.call(m)) || 1, Ht = ((Ie = (g = (d = C == null ? void 0 : C.getModel) == null ? void 0 : d.call(C)) == null ? void 0 : g.getLineCount) == null ? void 0 : Ie.call(g)) || 1, Pt = Math.max(Tt, Ht), Lt = Math.max(pe(k), pe(C));
          return Math.ceil(Pt * (Lt + ot) + tt + ue);
        } else if (u != null && u.getContentHeight) {
          (Ve = u == null ? void 0 : u.layout) == null || Ve.call(u);
          const k = u.getContentHeight();
          if (k > 0)
            return Math.ceil(k + ue);
        }
        const xe = (Re = u == null ? void 0 : u.getModel) == null ? void 0 : Re.call(u);
        let Ae = 1;
        xe && typeof xe.getLineCount == "function" && (Ae = xe.getLineCount());
        const Et = pe(u);
        return Math.ceil(Ae * (Et + ot) + tt + ue);
      } catch (u) {
        return null;
      }
    }
    function vt() {
      var m, y, d;
      const t = b.value, e = ce.value;
      if (!t || !e)
        return;
      const o = t.querySelector(".monaco-editor") || t;
      let n = null;
      try {
        typeof window != "undefined" && typeof window.getComputedStyle == "function" && (n = window.getComputedStyle(o));
      } catch (g) {
        n = null;
      }
      const l = String((m = n == null ? void 0 : n.getPropertyValue("--vscode-editor-foreground")) != null ? m : ""), a = String((y = n == null ? void 0 : n.getPropertyValue("--vscode-editor-background")) != null ? y : ""), h = String((d = n == null ? void 0 : n.getPropertyValue("--vscode-editor-hoverHighlightBackground")) != null ? d : "");
      if (l && a)
        return e.style.setProperty("--vscode-editor-foreground", l.trim()), e.style.setProperty("--vscode-editor-background", a.trim()), e.style.setProperty("--vscode-editor-selectionBackground", h.trim()), true;
    }
    function W() {
      try {
        const t = b.value;
        if (!t)
          return;
        const e = t.getBoundingClientRect(), o = window.scrollY + e.top, n = Oe();
        if (n != null && n > 0) {
          const l = e.height;
          t.style.height = `${Math.ceil(n)}px`, t.style.maxHeight = "none";
          const a = Math.ceil(n) - l;
          a !== 0 && o < window.scrollY && window.scrollBy(0, a);
        }
      } catch (t) {
      }
    }
    function U() {
      var t;
      try {
        const e = b.value;
        if (!e)
          return;
        const o = e.getBoundingClientRect(), n = window.scrollY + o.top, l = o.height, a = mt();
        if (de > 0 && (de--, j.value != null)) {
          const d = Math.min(j.value, a);
          e.style.height = `${Math.ceil(d)}px`, e.style.maxHeight = `${Math.ceil(a)}px`, e.style.overflow = "auto";
          const g = Math.ceil(d) - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
          return;
        }
        const h = Oe();
        if (h != null && h > 0) {
          const d = Math.min(h, a);
          e.style.height = `${Math.ceil(d)}px`, e.style.maxHeight = `${Math.ceil(a)}px`, e.style.overflow = "auto";
          const g = Math.ceil(d) - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
          return;
        }
        if (j.value != null) {
          const d = Math.min(j.value, a);
          e.style.height = `${Math.ceil(d)}px`, e.style.maxHeight = `${Math.ceil(a)}px`, e.style.overflow = "auto";
          const g = Math.ceil(d) - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
          return;
        }
        const m = Math.ceil(((t = e.getBoundingClientRect) == null ? void 0 : t.call(e).height) || 0);
        if (m > 0) {
          const d = Math.min(m, a);
          e.style.height = `${Math.ceil(d)}px`, e.style.maxHeight = `${Math.ceil(a)}px`, e.style.overflow = "auto";
          const g = Math.ceil(d) - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
          return;
        }
        const y = Number.parseFloat(e.style.height);
        if (!Number.isNaN(y) && y > 0) {
          const d = Math.ceil(Math.min(y, a));
          e.style.height = `${d}px`;
          const g = d - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
        } else {
          const d = Math.ceil(a);
          e.style.height = `${d}px`;
          const g = d - l;
          g !== 0 && n < window.scrollY && window.scrollBy(0, g);
        }
        e.style.maxHeight = `${Math.ceil(a)}px`, e.style.overflow = "auto";
      } catch (e) {
      }
    }
    function mt() {
      var o, n;
      const t = (n = (o = i.monacoOptions) == null ? void 0 : o.MAX_HEIGHT) != null ? n : 500;
      if (typeof t == "number")
        return t;
      const e = String(t).match(/^(\d+(?:\.\d+)?)/);
      return e ? Number.parseFloat(e[1]) : 500;
    }
    const ye = computed(() => i.isShowPreview && (D.value === "html" || D.value === "svg")), Z2 = computed(() => D.value === "mermaid");
    watch(
      () => i.node.language,
      (t) => {
        D.value = qo(t);
      }
    ), watch(
      () => i.node.code,
      (t) => R(null, null, function* () {
        var e, o;
        if (i.stream !== false) {
          if (D.value || (D.value = qo(Pe(t))), V && !te.value && b.value)
            try {
              yield ke(b.value);
            } catch (n) {
            }
          T.value ? ve(String((e = i.node.originalCode) != null ? e : ""), String((o = i.node.updatedCode) != null ? o : ""), K.value) : fe(t, K.value), M.value && Ba(() => W());
        }
      })
    );
    const ht = computed(() => {
      const t = D.value;
      return t ? Us[t] || t.charAt(0).toUpperCase() + t.slice(1) : Us[""];
    }), gt = computed(() => Ys(D.value || "")), pt = computed(() => {
      const t = {}, e = (l) => {
        if (l != null)
          return typeof l == "number" ? `${l}px` : String(l);
      }, o = e(i.minWidth), n = e(i.maxWidth);
      return o && (t.minWidth = o), n && (t.maxWidth = n), t;
    });
    function wt() {
      return R(this, null, function* () {
        try {
          typeof navigator != "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText == "function" && (yield navigator.clipboard.writeText(i.node.code)), X.value = true, q("copy", i.node.code), setTimeout(() => {
            X.value = false;
          }, 1e3);
        } catch (t) {
          console.error("复制失败:", t);
        }
      });
    }
    function De(t) {
      const e = t;
      return !e || e.disabled;
    }
    function P(t, e, o = "top") {
      if (De(t.currentTarget))
        return;
      const n = t, l = (n == null ? void 0 : n.clientX) != null && (n == null ? void 0 : n.clientY) != null ? { x: n.clientX, y: n.clientY } : void 0;
      Dn(t.currentTarget, e, o, false, l, i.isDark);
    }
    function S() {
      uo$1();
    }
    function $e(t) {
      if (De(t.currentTarget))
        return;
      const e = X.value ? c("common.copied") || "Copied" : c("common.copy") || "Copy", o = t, n = (o == null ? void 0 : o.clientX) != null && (o == null ? void 0 : o.clientY) != null ? { x: o.clientX, y: o.clientY } : void 0;
      Dn(t.currentTarget, e, "top", false, n, i.isDark);
    }
    function yt() {
      M.value = !M.value;
      const t = T.value ? $() : z(), e = b.value;
      !t || !e || (M.value ? (ae(true), e.style.maxHeight = "none", e.style.overflow = "visible", W()) : (ae(false), e.style.overflow = "auto", U()));
    }
    function kt() {
      var t, e, o;
      if (B.value = !B.value, B.value) {
        if (b.value) {
          const n = Math.ceil(((e = (t = b.value).getBoundingClientRect) == null ? void 0 : e.call(t).height) || 0);
          n > 0 && (j.value = n);
        }
        ae(false);
      } else {
        M.value && ae(true), b.value && j.value != null && (b.value.style.height = `${j.value}px`);
        const n = T.value ? $() : z();
        try {
          (o = n == null ? void 0 : n.layout) == null || o.call(n);
        } catch (l) {
        }
        de = 2, Ba(() => {
          M.value ? W() : U();
        });
      }
    }
    watch(
      () => v.value,
      (t, e) => {
        const o = T.value ? $() : z();
        o && typeof t == "number" && Number.isFinite(t) && t > 0 && (o.updateOptions({ fontSize: t }), M.value && !B.value && W());
      },
      { flush: "post", immediate: false }
    );
    function xt() {
      if (!ye.value)
        return;
      const t = D.value;
      if (x.value) {
        const e = t === "html" ? "text/html" : "image/svg+xml", o = t === "html" ? c("artifacts.htmlPreviewTitle") || "HTML Preview" : c("artifacts.svgPreviewTitle") || "SVG Preview";
        q("previewCode", {
          node: i.node,
          artifactType: e,
          artifactTitle: o,
          id: `temp-${t}-${Date.now()}`
        });
        return;
      }
      t === "html" && (le.value = !le.value);
    }
    function ae(t) {
      var e, o;
      try {
        if (T.value) {
          const n = $();
          (e = n == null ? void 0 : n.updateOptions) == null || e.call(n, { automaticLayout: t });
        } else {
          const n = z();
          (o = n == null ? void 0 : n.updateOptions) == null || o.call(n, { automaticLayout: t });
        }
      } catch (n) {
      }
    }
    function bt(t) {
      return R(this, null, function* () {
        var o, n, l;
        if (!V)
          return;
        T.value ? (me(), oe ? yield oe(t, String((o = i.node.originalCode) != null ? o : ""), String((n = i.node.updatedCode) != null ? n : ""), K.value) : yield V(t, i.node.code, K.value)) : yield V(t, i.node.code, K.value);
        const e = T.value ? $() : z();
        if (typeof ((l = i.monacoOptions) == null ? void 0 : l.fontSize) == "number")
          e == null || e.updateOptions({ fontSize: i.monacoOptions.fontSize, automaticLayout: false }), H.value = i.monacoOptions.fontSize, v.value = i.monacoOptions.fontSize;
        else {
          const a = Le();
          a && a > 0 ? (H.value = a, v.value = a) : (H.value = 12, v.value = 12);
        }
        !M.value && !B.value && U(), i.loading === false && (yield nextTick(), Ba(() => {
          M.value && !B.value ? W() : B.value || U();
        }));
      });
    }
    function ke(t) {
      return V ? Q || (te.value = true, Q = R(null, null, function* () {
        yield bt(t);
      }).finally(() => {
        Q = null;
      }), Q) : null;
    }
    const Ne = watch(
      () => [b.value, Z2.value, T.value, i.stream, i.loading, He.value, I.value],
      (m) => R(null, [m], function* ([t, e, o, n, l, a, h]) {
        if (!t || !V || !h || n === false && l !== false)
          return;
        if (Z2.value) {
          ie(), Ne();
          return;
        }
        const y = ke(t);
        y && (yield y, Ne());
      })
    ), Ct = watch(
      () => [i.darkTheme, i.lightTheme, te.value, I.value],
      () => {
        if (!(!te.value || !I.value)) {
          if (Z2.value)
            return Ct();
          Mt();
        }
      }
    );
    function ze() {
      return i.isDark ? i.darkTheme : i.lightTheme;
    }
    function Mt() {
      const t = ze();
      t && he(t);
    }
    const Bt = watch(
      () => [i.monacoOptions, I.value],
      () => {
        var o, n;
        if (!V || !I.value)
          return;
        if (Z2.value)
          return Bt();
        const t = T.value ? $() : z(), e = typeof ((o = i.monacoOptions) == null ? void 0 : o.fontSize) == "number" ? i.monacoOptions.fontSize : Number.isFinite(v.value) ? v.value : void 0;
        typeof e == "number" && Number.isFinite(e) && e > 0 && ((n = t == null ? void 0 : t.updateOptions) == null || n.call(t, { fontSize: e })), M.value && !B.value ? W() : B.value || U();
      },
      { deep: true }
    ), re = watch(
      () => [i.loading, I.value],
      (o) => R(null, [o], function* ([t, e]) {
        if (e) {
          if (Z2.value) {
            nextTick(() => {
              re == null || re();
            });
            return;
          }
          t || (yield nextTick(), Ba(() => {
            B.value || (M.value ? W() : U()), re();
          }));
        }
      }),
      { immediate: true, flush: "post" }
    );
    return onUnmounted(() => {
      ie();
    }), (t, e) => ge.value ? (openBlock(), createBlock(unref(mn), {
      key: 0,
      node: f.node,
      loading: i.loading
    }, null, 8, ["node", "loading"])) : (openBlock(), createElementBlock("div", {
      key: 1,
      ref_key: "container",
      ref: ce,
      style: normalizeStyle(pt.value),
      class: normalizeClass(["code-block-container my-4 rounded-lg border overflow-hidden shadow-sm", [
        i.isDark ? "border-gray-700/30 bg-gray-900" : "border-gray-200 bg-white",
        { "is-rendering": i.loading, "is-dark": i.isDark }
      ]])
    }, [
      i.showHeader ? (openBlock(), createElementBlock("div", oo, [
        renderSlot(t.$slots, "header-left", {}, () => [
          createBaseVNode("div", no, [
            createBaseVNode("span", {
              class: "icon-slot h-4 w-4 flex-shrink-0",
              innerHTML: gt.value
            }, null, 8, io),
            createBaseVNode("span", lo, toDisplayString(ht.value), 1)
          ])
        ], true),
        renderSlot(t.$slots, "header-right", {}, () => [
          createBaseVNode("div", ao, [
            createBaseVNode("button", {
              type: "button",
              class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
              "aria-pressed": B.value,
              onClick: kt,
              onMouseenter: e[0] || (e[0] = (o) => P(o, B.value ? unref(c)("common.expand") || "Expand" : unref(c)("common.collapse") || "Collapse")),
              onFocus: e[1] || (e[1] = (o) => P(o, B.value ? unref(c)("common.expand") || "Expand" : unref(c)("common.collapse") || "Collapse")),
              onMouseleave: S,
              onBlur: S
            }, [
              (openBlock(), createElementBlock("svg", {
                style: normalizeStyle({ rotate: B.value ? "0deg" : "90deg" }),
                xmlns: "http://www.w3.org/2000/svg",
                "xmlns:xlink": "http://www.w3.org/1999/xlink",
                "aria-hidden": "true",
                role: "img",
                width: "1em",
                height: "1em",
                viewBox: "0 0 24 24",
                class: "w-3 h-3"
              }, [...e[17] || (e[17] = [
                createBaseVNode("path", {
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "m9 18l6-6l-6-6"
                }, null, -1)
              ])], 4))
            ], 40, ro),
            i.showFontSizeButtons && i.enableFontSizeControl ? (openBlock(), createElementBlock(Fragment, { key: 0 }, [
              createBaseVNode("button", {
                type: "button",
                class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
                disabled: Number.isFinite(v.value) ? v.value <= Qe : false,
                onClick: e[2] || (e[2] = (o) => dt()),
                onMouseenter: e[3] || (e[3] = (o) => P(o, unref(c)("common.decrease") || "Decrease")),
                onFocus: e[4] || (e[4] = (o) => P(o, unref(c)("common.decrease") || "Decrease")),
                onMouseleave: S,
                onBlur: S
              }, [...e[18] || (e[18] = [
                createBaseVNode("svg", {
                  xmlns: "http://www.w3.org/2000/svg",
                  "xmlns:xlink": "http://www.w3.org/1999/xlink",
                  "aria-hidden": "true",
                  role: "img",
                  width: "1em",
                  height: "1em",
                  viewBox: "0 0 24 24",
                  class: "w-3 h-3"
                }, [
                  createBaseVNode("path", {
                    fill: "none",
                    stroke: "currentColor",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "stroke-width": "2",
                    d: "M5 12h14"
                  })
                ], -1)
              ])], 40, so),
              createBaseVNode("button", {
                type: "button",
                class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
                disabled: !st.value || v.value === H.value,
                onClick: e[5] || (e[5] = (o) => ft()),
                onMouseenter: e[6] || (e[6] = (o) => P(o, unref(c)("common.reset") || "Reset")),
                onFocus: e[7] || (e[7] = (o) => P(o, unref(c)("common.reset") || "Reset")),
                onMouseleave: S,
                onBlur: S
              }, [...e[19] || (e[19] = [
                createBaseVNode("svg", {
                  xmlns: "http://www.w3.org/2000/svg",
                  "xmlns:xlink": "http://www.w3.org/1999/xlink",
                  "aria-hidden": "true",
                  role: "img",
                  width: "1em",
                  height: "1em",
                  viewBox: "0 0 24 24",
                  class: "w-3 h-3"
                }, [
                  createBaseVNode("g", {
                    fill: "none",
                    stroke: "currentColor",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "stroke-width": "2"
                  }, [
                    createBaseVNode("path", { d: "M3 12a9 9 0 1 0 9-9a9.75 9.75 0 0 0-6.74 2.74L3 8" }),
                    createBaseVNode("path", { d: "M3 3v5h5" })
                  ])
                ], -1)
              ])], 40, uo),
              createBaseVNode("button", {
                type: "button",
                class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
                disabled: Number.isFinite(v.value) ? v.value >= Ze : false,
                onClick: e[8] || (e[8] = (o) => ct()),
                onMouseenter: e[9] || (e[9] = (o) => P(o, unref(c)("common.increase") || "Increase")),
                onFocus: e[10] || (e[10] = (o) => P(o, unref(c)("common.increase") || "Increase")),
                onMouseleave: S,
                onBlur: S
              }, [...e[20] || (e[20] = [
                createBaseVNode("svg", {
                  xmlns: "http://www.w3.org/2000/svg",
                  "xmlns:xlink": "http://www.w3.org/1999/xlink",
                  "aria-hidden": "true",
                  role: "img",
                  width: "1em",
                  height: "1em",
                  viewBox: "0 0 24 24",
                  class: "w-3 h-3"
                }, [
                  createBaseVNode("path", {
                    fill: "none",
                    stroke: "currentColor",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round",
                    "stroke-width": "2",
                    d: "M5 12h14m-7-7v14"
                  })
                ], -1)
              ])], 40, co)
            ], 64)) : createCommentVNode("", true),
            i.showCopyButton ? (openBlock(), createElementBlock("button", {
              key: 1,
              type: "button",
              class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
              "aria-label": X.value ? unref(c)("common.copied") || "Copied" : unref(c)("common.copy") || "Copy",
              onClick: wt,
              onMouseenter: e[11] || (e[11] = (o) => $e(o)),
              onFocus: e[12] || (e[12] = (o) => $e(o)),
              onMouseleave: S,
              onBlur: S
            }, [
              X.value ? (openBlock(), createElementBlock("svg", mo, [...e[22] || (e[22] = [
                createBaseVNode("path", {
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "M20 6L9 17l-5-5"
                }, null, -1)
              ])])) : (openBlock(), createElementBlock("svg", vo, [...e[21] || (e[21] = [
                createBaseVNode("g", {
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2"
                }, [
                  createBaseVNode("rect", {
                    width: "14",
                    height: "14",
                    x: "8",
                    y: "8",
                    rx: "2",
                    ry: "2"
                  }),
                  createBaseVNode("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" })
                ], -1)
              ])]))
            ], 40, fo)) : createCommentVNode("", true),
            i.showExpandButton ? (openBlock(), createElementBlock("button", {
              key: 2,
              type: "button",
              class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
              "aria-pressed": M.value,
              onClick: yt,
              onMouseenter: e[13] || (e[13] = (o) => P(o, M.value ? unref(c)("common.collapse") || "Collapse" : unref(c)("common.expand") || "Expand")),
              onFocus: e[14] || (e[14] = (o) => P(o, M.value ? unref(c)("common.collapse") || "Collapse" : unref(c)("common.expand") || "Expand")),
              onMouseleave: S,
              onBlur: S
            }, [
              M.value ? (openBlock(), createElementBlock("svg", go, [...e[23] || (e[23] = [
                createBaseVNode("path", {
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "M15 3h6v6m0-6l-7 7M3 21l7-7m-1 7H3v-6"
                }, null, -1)
              ])])) : (openBlock(), createElementBlock("svg", po, [...e[24] || (e[24] = [
                createBaseVNode("path", {
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-linecap": "round",
                  "stroke-linejoin": "round",
                  "stroke-width": "2",
                  d: "m14 10l7-7m-1 7h-6V4M3 21l7-7m-6 0h6v6"
                }, null, -1)
              ])]))
            ], 40, ho)) : createCommentVNode("", true),
            ye.value && i.showPreviewButton ? (openBlock(), createElementBlock("button", {
              key: 3,
              type: "button",
              class: "code-action-btn p-2 text-xs rounded-md transition-colors hover:bg-[var(--vscode-editor-selectionBackground)]",
              "aria-label": unref(c)("common.preview") || "Preview",
              onClick: xt,
              onMouseenter: e[15] || (e[15] = (o) => P(o, unref(c)("common.preview") || "Preview")),
              onFocus: e[16] || (e[16] = (o) => P(o, unref(c)("common.preview") || "Preview")),
              onMouseleave: S,
              onBlur: S
            }, [...e[25] || (e[25] = [
              createBaseVNode("svg", {
                xmlns: "http://www.w3.org/2000/svg",
                width: "12",
                height: "12",
                viewBox: "0 0 24 24"
              }, [
                createBaseVNode("g", {
                  fill: "currentColor",
                  "fill-rule": "evenodd",
                  "clip-rule": "evenodd"
                }, [
                  createBaseVNode("path", { d: "M23.628 7.41c-.12-1.172-.08-3.583-.9-4.233c-1.921-1.51-6.143-1.11-8.815-1.19c-3.481-.15-7.193.14-10.625.24a.34.34 0 0 0 0 .67c3.472-.05 7.074-.29 10.575-.09c2.471.15 6.653-.14 8.254 1.16c.4.33.41 2.732.49 3.582a42 42 0 0 1 .08 9.005a13.8 13.8 0 0 1-.45 3.001c-2.42 1.4-19.69 2.381-20.72.55a21 21 0 0 1-.65-4.632a41.5 41.5 0 0 1 .12-7.964c.08 0 7.334.33 12.586.24c2.331 0 4.682-.13 6.764-.21a.33.33 0 0 0 0-.66c-7.714-.16-12.897-.43-19.31.05c.11-1.38.48-3.922.38-4.002a.3.3 0 0 0-.42 0c-.37.41-.29 1.77-.36 2.251s-.14 1.07-.2 1.6a45 45 0 0 0-.36 8.645a21.8 21.8 0 0 0 .66 5.002c1.46 2.702 17.248 1.461 20.95.43c1.45-.4 1.69-.8 1.871-1.95c.575-3.809.602-7.68.08-11.496" }),
                  createBaseVNode("path", { d: "M4.528 5.237a.84.84 0 0 0-.21-1c-.77-.41-1.71.39-1 1.1a.83.83 0 0 0 1.21-.1m2.632-.25c.14-.14.19-.84-.2-1c-.77-.41-1.71.39-1 1.09a.82.82 0 0 0 1.2-.09m2.88 0a.83.83 0 0 0-.21-1c-.77-.41-1.71.39-1 1.09a.82.82 0 0 0 1.21-.09m-4.29 8.735c0 .08.23 2.471.31 2.561a.371.371 0 0 0 .63-.14c0-.09 0 0 .15-1.72a10 10 0 0 0-.11-2.232a5.3 5.3 0 0 1-.26-1.37a.3.3 0 0 0-.54-.24a6.8 6.8 0 0 0-.2 2.33c-1.281-.38-1.121.13-1.131-.42a15 15 0 0 0-.19-1.93c-.16-.17-.36-.17-.51.14a20 20 0 0 0-.43 3.471c.04.773.18 1.536.42 2.272c.26.4.7.22.7-.1c0-.09-.16-.09 0-1.862c.06-1.18-.23-.3 1.16-.76m5.033-2.552c.32-.07.41-.28.39-.37c0-.55-3.322-.34-3.462-.24s-.2.18-.18.28s0 .11 0 .16a3.8 3.8 0 0 0 1.591.361v.82a15 15 0 0 0-.13 3.132c0 .2-.09.94.17 1.16a.34.34 0 0 0 .48 0c.125-.35.196-.718.21-1.09a8 8 0 0 0 .14-3.232c0-.13.05-.7-.1-.89a8 8 0 0 0 .89-.09m5.544-.181a.69.69 0 0 0-.89-.44a2.8 2.8 0 0 0-1.252 1.001a2.3 2.3 0 0 0-.41-.83a1 1 0 0 0-1.6.27a7 7 0 0 0-.35 2.07c0 .571 0 2.642.06 2.762c.14 1.09 1 .51.63.13a17.6 17.6 0 0 1 .38-3.962c.32-1.18.32.2.39.51s.11 1.081.73 1.081s.48-.93 1.401-1.78q.075 1.345 0 2.69a15 15 0 0 0 0 1.811a.34.34 0 0 0 .68 0q.112-.861.11-1.73a16.7 16.7 0 0 0 .12-3.582m1.441-.201c-.05.16-.3 3.002-.31 3.202a6.3 6.3 0 0 0 .21 1.741c.33 1 1.21 1.07 2.291.82a3.7 3.7 0 0 0 1.14-.23c.21-.22.10-.59-.41-.64q-.817.096-1.64.07c-.44-.07-.34 0-.67-4.442q.015-.185 0-.37a.316.316 0 0 0-.23-.38a.316.316 0 0 0-.38.23" })
                ])
              ], -1)
            ])], 40, wo)) : createCommentVNode("", true)
          ])
        ], true)
      ])) : createCommentVNode("", true),
      withDirectives(createBaseVNode("div", {
        ref_key: "codeEditor",
        ref: b,
        class: normalizeClass(["code-editor-container", [f.stream ? "" : "code-height-placeholder"]])
      }, null, 2), [
        [vShow, !B.value && (f.stream ? true : !f.loading)]
      ]),
      le.value && !x.value && ye.value && D.value === "html" ? (openBlock(), createBlock(to, {
        key: 1,
        code: f.node.code,
        "is-dark": i.isDark,
        "on-close": () => le.value = false
      }, null, 8, ["code", "is-dark", "on-close"])) : createCommentVNode("", true),
      withDirectives(createBaseVNode("div", yo, [
        renderSlot(t.$slots, "loading", {
          loading: f.loading,
          stream: f.stream
        }, () => [
          e[26] || (e[26] = createBaseVNode("div", { class: "loading-skeleton" }, [
            createBaseVNode("div", { class: "skeleton-line" }),
            createBaseVNode("div", { class: "skeleton-line" }),
            createBaseVNode("div", { class: "skeleton-line short" })
          ], -1))
        ], true)
      ], 512), [
        [vShow, !f.stream && f.loading]
      ]),
      createBaseVNode("span", ko, toDisplayString(X.value ? unref(c)("common.copied") || "Copied" : ""), 1)
    ], 6));
  }
}), Se = /* @__PURE__ */ Z(xo, [["__scopeId", "data-v-acbbd971"]]);
Se.install = (f) => {
  f.component(Se.__name, Se);
};
export {
  Se as default
};
