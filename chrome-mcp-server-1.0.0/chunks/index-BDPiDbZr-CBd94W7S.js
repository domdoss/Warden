import { d as defineComponent, r as ref, b as createElementBlock, w as watch, o as onMounted, P as onBeforeUnmount, e as openBlock, L as createVNode, y as createBaseVNode, M as withCtx, z as createCommentVNode, a3 as Transition, n as normalizeClass } from "./_plugin-vue_export-helper-DRi44jog.js";
import { Z, f as fo, a as Zl, v as vo, F as Fl, p as pl } from "./sidepanel-6Tj8Fb70.js";
import "./_virtual_wxt-html-plugins-Cyikj0JH.js";
import "./index-BYjKghw9.js";
import "./message-types-DUXLbMdM.js";
import "./useAgentTheme-PaQCh03y.js";
import "./preload-helper-Cu8Qyz_K.js";
/* empty css                  */
/* empty css                    */
var v = (d, n, r) => new Promise((a, s) => {
  var f = (l) => {
    try {
      o(r.next(l));
    } catch (e) {
      s(e);
    }
  }, u = (l) => {
    try {
      o(r.throw(l));
    } catch (e) {
      s(e);
    }
  }, o = (l) => l.done ? a(l.value) : Promise.resolve(l.value).then(f, u);
  o((r = r.apply(d, n)).next());
});
const z = {
  key: 0,
  class: "math-loading-overlay"
}, F = /* @__PURE__ */ defineComponent({
  __name: "MathBlockNode",
  props: {
    node: {}
  },
  setup(d) {
    const n = d, r = ref(null), a = ref(null);
    let s = false, f = 0, u = false, o = null;
    const l = fo();
    let e = null;
    const c = ref(true);
    function k() {
      return v(this, null, function* () {
        if (!n.node.content || !a.value || u)
          return;
        if (!s)
          try {
            !e && r.value && (e = l(r.value)), yield e == null ? void 0 : e.whenVisible;
          } catch (t) {
          }
        o && (o.abort(), o = null);
        const i = ++f, m = new AbortController();
        o = m, Zl(n.node.content, true, {
          timeout: 3e3,
          waitTimeout: 2e3,
          maxRetries: 1,
          signal: m.signal
        }).then((t) => {
          u || i !== f || a.value && (a.value.innerHTML = t, s = true, c.value = false);
        }).catch((t) => v(null, null, function* () {
          if (u || i !== f || !a.value)
            return;
          const h = (t == null ? void 0 : t.code) || (t == null ? void 0 : t.name), x = h === "WORKER_INIT_ERROR" || (t == null ? void 0 : t.fallbackToRenderer), B = h === pl || h === "WORKER_TIMEOUT", C = h === "KATEX_DISABLED";
          if (x || B) {
            const R = yield vo();
            if (R) {
              try {
                const _ = R.renderToString(n.node.content, {
                  throwOnError: n.node.loading,
                  displayMode: true
                });
                a.value.innerHTML = _, s = true, c.value = false, Fl(n.node.content, true, _);
              } catch (_) {
              }
              return;
            }
          }
          if (C) {
            c.value = false, a.value.textContent = n.node.raw;
            return;
          }
          s || (c.value = true), n.node.loading || (c.value = false, a.value.textContent = n.node.raw);
        }));
      });
    }
    return watch(
      () => n.node.content,
      () => {
        k();
      }
    ), onMounted(() => {
      k();
    }), onBeforeUnmount(() => {
      var i;
      u = true, o && (o.abort(), o = null), (i = e == null ? void 0 : e.destroy) == null || i.call(e), e = null;
    }), (i, m) => (openBlock(), createElementBlock("div", {
      ref_key: "containerEl",
      ref: r,
      class: "math-block text-center overflow-x-auto relative min-h-[40px]"
    }, [
      createVNode(Transition, { name: "math-fade" }, {
        default: withCtx(() => [
          c.value ? (openBlock(), createElementBlock("div", z, [...m[0] || (m[0] = [
            createBaseVNode("div", { class: "math-loading-spinner" }, null, -1)
          ])])) : createCommentVNode("", true)
        ]),
        _: 1
      }),
      createBaseVNode("div", {
        ref_key: "mathBlockElement",
        ref: a,
        class: normalizeClass({ "math-rendering": c.value })
      }, null, 2)
    ], 512));
  }
}), E = /* @__PURE__ */ Z(F, [["__scopeId", "data-v-dab27d4f"]]);
E.install = (d) => {
  d.component(E.__name, E);
};
export {
  E as default
};
