import { d as defineComponent, r as ref, b as createElementBlock, w as watch, o as onMounted, P as onBeforeUnmount, e as openBlock, Y as withDirectives, A as createBlock, z as createCommentVNode, a2 as vShow, y as createBaseVNode, M as withCtx, f as renderSlot, a3 as Transition } from "./_plugin-vue_export-helper-DRi44jog.js";
import { Z, f as fo, a as Zl, v as vo, F as Fl, p as pl } from "./sidepanel-6Tj8Fb70.js";
import "./_virtual_wxt-html-plugins-Cyikj0JH.js";
import "./index-BYjKghw9.js";
import "./message-types-DUXLbMdM.js";
import "./useAgentTheme-PaQCh03y.js";
import "./preload-helper-Cu8Qyz_K.js";
/* empty css                  */
/* empty css                    */
var w = (d, n, r) => new Promise((a, s) => {
  var f = (e) => {
    try {
      o(r.next(e));
    } catch (m) {
      s(m);
    }
  }, c = (e) => {
    try {
      o(r.throw(e));
    } catch (m) {
      s(m);
    }
  }, o = (e) => e.done ? a(e.value) : Promise.resolve(e.value).then(f, c);
  o((r = r.apply(d, n)).next());
});
const Y = {
  class: "math-inline__loading",
  role: "status",
  "aria-live": "polite"
}, $ = /* @__PURE__ */ defineComponent({
  __name: "MathInlineNode",
  props: {
    node: {}
  },
  setup(d) {
    const n = d, r = ref(null), a = ref(null);
    let s = false, f = 0, c = false, o = null;
    const e = ref(true), m = fo();
    let l = null;
    function R() {
      return w(this, null, function* () {
        if (!n.node.content || !a.value || c)
          return;
        o && (o.abort(), o = null);
        const i = ++f, u = new AbortController();
        if (o = u, !s)
          try {
            !l && r.value && (l = m(r.value)), yield l == null ? void 0 : l.whenVisible;
          } catch (t) {
          }
        Zl(n.node.content, false, {
          // Inline math should not wait on worker slots; fallback to sync render immediately
          timeout: 1500,
          waitTimeout: 0,
          maxRetries: 0,
          signal: u.signal
        }).then((t) => {
          c || i !== f || a.value && (a.value.innerHTML = t, e.value = false, s = true);
        }).catch((t) => w(null, null, function* () {
          if (c || i !== f || !a.value)
            return;
          const p = (t == null ? void 0 : t.code) || (t == null ? void 0 : t.name), k = p === "WORKER_INIT_ERROR" || (t == null ? void 0 : t.fallbackToRenderer), I = p === pl || p === "WORKER_TIMEOUT", h = p === "KATEX_DISABLED";
          if (k || I) {
            const T = yield vo();
            if (T) {
              try {
                const v = T.renderToString(n.node.content, { throwOnError: n.node.loading, displayMode: false });
                e.value = false, a.value.innerHTML = v, s = true, Fl(n.node.content, false, v);
              } catch (v) {
              }
              return;
            }
          }
          if (h) {
            e.value = false, a.value.textContent = n.node.raw;
            return;
          }
          s || (e.value = !h), n.node.loading ? h && (a.value.textContent = n.node.raw) : (e.value = false, a.value.textContent = n.node.raw);
        }));
      });
    }
    return watch(
      () => n.node.content,
      () => {
        R();
      }
    ), onMounted(() => {
      R();
    }), onBeforeUnmount(() => {
      var i;
      c = true, o && (o.abort(), o = null), (i = l == null ? void 0 : l.destroy) == null || i.call(l), l = null;
    }), (i, u) => (openBlock(), createElementBlock("span", {
      ref_key: "containerEl",
      ref: r,
      class: "math-inline-wrapper"
    }, [
      withDirectives(createBaseVNode("span", {
        ref_key: "mathElement",
        ref: a,
        class: "math-inline"
      }, null, 512), [
        [vShow, !e.value]
      ]),
      e.value ? (openBlock(), createBlock(Transition, {
        key: 0,
        name: "table-node-fade"
      }, {
        default: withCtx(() => [
          createBaseVNode("span", Y, [
            renderSlot(i.$slots, "loading", { isLoading: e.value }, () => [
              u[0] || (u[0] = createBaseVNode("span", {
                class: "math-inline__spinner animate-spin",
                "aria-hidden": "true"
              }, null, -1)),
              u[1] || (u[1] = createBaseVNode("span", { class: "sr-only" }, "Loading", -1))
            ], true)
          ])
        ]),
        _: 3
      })) : createCommentVNode("", true)
    ], 512));
  }
}), g = /* @__PURE__ */ Z($, [["__scopeId", "data-v-fbd3ae11"]]);
g.install = (d) => {
  d.component(g.__name, g);
};
export {
  g as default
};
