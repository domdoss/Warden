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
import { d as defineComponent, r as ref, o as onMounted, b as createElementBlock, e as openBlock, y as createBaseVNode, H as toDisplayString, Y as withDirectives, $ as vModelCheckbox, G as createTextVNode, Z as vModelText, a0 as vModelSelect, z as createCommentVNode, F as Fragment, O as renderList, _ as _export_sfc, a1 as createApp } from "./_plugin-vue_export-helper-DRi44jog.js";
import { T as TOOL_NAMES } from "./index-BYjKghw9.js";
import { S as STORAGE_KEYS } from "./constants-Dw2yqhzZ.js";
const _hoisted_1 = { class: "page" };
const _hoisted_2 = { class: "topbar" };
const _hoisted_3 = { class: "switch" };
const _hoisted_4 = { class: "create" };
const _hoisted_5 = { class: "grid" };
const _hoisted_6 = ["placeholder"];
const _hoisted_7 = { value: "auto" };
const _hoisted_8 = { value: "document_start" };
const _hoisted_9 = { value: "document_end" };
const _hoisted_10 = { value: "document_idle" };
const _hoisted_11 = { value: "auto" };
const _hoisted_12 = { value: "ISOLATED" };
const _hoisted_13 = { value: "MAIN" };
const _hoisted_14 = { value: "auto" };
const _hoisted_15 = { value: "persistent" };
const _hoisted_16 = { value: "css" };
const _hoisted_17 = { value: "once" };
const _hoisted_18 = ["placeholder"];
const _hoisted_19 = ["placeholder"];
const _hoisted_20 = ["placeholder"];
const _hoisted_21 = ["placeholder"];
const _hoisted_22 = { class: "row" };
const _hoisted_23 = ["disabled"];
const _hoisted_24 = ["disabled"];
const _hoisted_25 = {
  key: 0,
  class: "hint"
};
const _hoisted_26 = { class: "filters" };
const _hoisted_27 = { class: "grid" };
const _hoisted_28 = { value: "" };
const _hoisted_29 = { value: "enabled" };
const _hoisted_30 = { value: "disabled" };
const _hoisted_31 = ["placeholder"];
const _hoisted_32 = { class: "row" };
const _hoisted_33 = { class: "table" };
const _hoisted_34 = ["checked", "onChange"];
const _hoisted_35 = { class: "actions" };
const _hoisted_36 = ["onClick"];
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "App",
  setup(__props) {
    const emergencyDisabled = ref(false);
    const items = ref([]);
    const filters = ref({ query: "", status: "", domain: "" });
    const form = ref({
      name: "",
      runAt: "auto",
      world: "auto",
      mode: "auto",
      allFrames: true,
      persist: true,
      dnrFallback: true,
      script: "",
      matches: "",
      excludes: "",
      tags: ""
    });
    const submitting = ref(false);
    const lastResult = ref("");
    function formatTime(ts) {
      if (!ts) return "";
      try {
        return new Date(ts).toLocaleString();
      } catch (e) {
        return String(ts);
      }
    }
    function saveEmergency() {
      return __async(this, null, function* () {
        var _a, _b;
        yield (_b = (_a = globalThis.chrome) == null ? void 0 : _a.storage) == null ? void 0 : _b.local.set({
          [STORAGE_KEYS.USERSCRIPTS_DISABLED]: emergencyDisabled.value
        });
      });
    }
    function loadEmergency() {
      return __async(this, null, function* () {
        var _a, _b;
        const v = yield (_b = (_a = globalThis.chrome) == null ? void 0 : _a.storage) == null ? void 0 : _b.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED]);
        emergencyDisabled.value = !!v[STORAGE_KEYS.USERSCRIPTS_DISABLED];
      });
    }
    function callTool(name, args) {
      return __async(this, null, function* () {
        var _a, _b;
        const res = yield (_b = (_a = globalThis.chrome) == null ? void 0 : _a.runtime) == null ? void 0 : _b.sendMessage({
          type: "call_tool",
          name,
          args
        });
        if (!res || !res.success) throw new Error((res == null ? void 0 : res.error) || "call failed");
        return res.result;
      });
    }
    function reload() {
      return __async(this, null, function* () {
        var _a, _b;
        const result = yield callTool(TOOL_NAMES.BROWSER.USERSCRIPT, {
          action: "list",
          args: __spreadValues({}, filters.value)
        });
        try {
          const txt = ((_b = (_a = result == null ? void 0 : result.content) == null ? void 0 : _a[0]) == null ? void 0 : _b.text) || "{}";
          const data = JSON.parse(txt);
          items.value = data.items || [];
        } catch (e) {
          console.warn("parse list failed", e);
        }
      });
    }
    function apply(mode) {
      return __async(this, null, function* () {
        var _a, _b;
        if (!form.value.script.trim()) return;
        submitting.value = true;
        lastResult.value = "";
        try {
          const args = {
            script: form.value.script,
            name: form.value.name || void 0,
            runAt: form.value.runAt,
            world: form.value.world,
            allFrames: !!form.value.allFrames,
            persist: !!form.value.persist,
            dnrFallback: !!form.value.dnrFallback,
            mode
          };
          if (form.value.matches.trim())
            args.matches = form.value.matches.split(",").map((s) => s.trim());
          if (form.value.excludes.trim())
            args.excludes = form.value.excludes.split(",").map((s) => s.trim());
          if (form.value.tags.trim()) args.tags = form.value.tags.split(",").map((s) => s.trim());
          const result = yield callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: "create", args });
          lastResult.value = ((_b = (_a = result == null ? void 0 : result.content) == null ? void 0 : _a[0]) == null ? void 0 : _b.text) || "";
          yield reload();
        } catch (e) {
          lastResult.value = "Error: " + ((e == null ? void 0 : e.message) || String(e));
        } finally {
          submitting.value = false;
        }
      });
    }
    function toggle(it) {
      return __async(this, null, function* () {
        try {
          yield callTool(TOOL_NAMES.BROWSER.USERSCRIPT, {
            action: it.status === "enabled" ? "disable" : "enable",
            args: { id: it.id }
          });
          yield reload();
        } catch (e) {
          console.warn("toggle failed", e);
        }
      });
    }
    function remove(it) {
      return __async(this, null, function* () {
        try {
          yield callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: "remove", args: { id: it.id } });
          yield reload();
        } catch (e) {
          console.warn("remove failed", e);
        }
      });
    }
    function exportAll() {
      return __async(this, null, function* () {
        var _a, _b, _c, _d;
        try {
          const res = yield callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: "export", args: {} });
          const txt = ((_b = (_a = res == null ? void 0 : res.content) == null ? void 0 : _a[0]) == null ? void 0 : _b.text) || "{}";
          const blob = new Blob([txt], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          yield (_d = (_c = globalThis.chrome) == null ? void 0 : _c.downloads) == null ? void 0 : _d.download({
            url,
            filename: "userscripts-export.json",
            saveAs: true
          });
          URL.revokeObjectURL(url);
        } catch (e) {
          console.warn("export failed", e);
        }
      });
    }
    onMounted(() => __async(null, null, function* () {
      yield loadEmergency();
      yield reload();
    }));
    function m(key, substitutions) {
      var _a, _b;
      const msg = (((_b = (_a = globalThis.chrome) == null ? void 0 : _a.i18n) == null ? void 0 : _b.getMessage(key, substitutions)) || "").trim();
      return msg || key;
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1, [
        createBaseVNode("header", _hoisted_2, [
          createBaseVNode("h1", null, toDisplayString(m("userscriptsManagerTitle")), 1),
          createBaseVNode("div", _hoisted_3, [
            createBaseVNode("label", null, [
              withDirectives(createBaseVNode("input", {
                type: "checkbox",
                "onUpdate:modelValue": _cache[0] || (_cache[0] = ($event) => emergencyDisabled.value = $event),
                onChange: saveEmergency
              }, null, 544), [
                [vModelCheckbox, emergencyDisabled.value]
              ]),
              createBaseVNode("span", null, toDisplayString(m("emergencySwitchLabel")), 1)
            ])
          ])
        ]),
        createBaseVNode("section", _hoisted_4, [
          createBaseVNode("h2", null, toDisplayString(m("createRunSectionTitle")), 1),
          createBaseVNode("div", _hoisted_5, [
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("nameLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                "onUpdate:modelValue": _cache[1] || (_cache[1] = ($event) => form.value.name = $event),
                placeholder: m("placeholderOptional")
              }, null, 8, _hoisted_6), [
                [vModelText, form.value.name]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("runAtLabel")) + " ", 1),
              withDirectives(createBaseVNode("select", {
                "onUpdate:modelValue": _cache[2] || (_cache[2] = ($event) => form.value.runAt = $event)
              }, [
                createBaseVNode("option", _hoisted_7, toDisplayString(m("runAtAuto")), 1),
                createBaseVNode("option", _hoisted_8, toDisplayString(m("runAtDocumentStart")), 1),
                createBaseVNode("option", _hoisted_9, toDisplayString(m("runAtDocumentEnd")), 1),
                createBaseVNode("option", _hoisted_10, toDisplayString(m("runAtDocumentIdle")), 1)
              ], 512), [
                [vModelSelect, form.value.runAt]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("worldLabel")) + " ", 1),
              withDirectives(createBaseVNode("select", {
                "onUpdate:modelValue": _cache[3] || (_cache[3] = ($event) => form.value.world = $event)
              }, [
                createBaseVNode("option", _hoisted_11, toDisplayString(m("worldAuto")), 1),
                createBaseVNode("option", _hoisted_12, toDisplayString(m("worldIsolated")), 1),
                createBaseVNode("option", _hoisted_13, toDisplayString(m("worldMain")), 1)
              ], 512), [
                [vModelSelect, form.value.world]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("modeLabel")) + " ", 1),
              withDirectives(createBaseVNode("select", {
                "onUpdate:modelValue": _cache[4] || (_cache[4] = ($event) => form.value.mode = $event)
              }, [
                createBaseVNode("option", _hoisted_14, toDisplayString(m("modeAuto")), 1),
                createBaseVNode("option", _hoisted_15, toDisplayString(m("modePersistent")), 1),
                createBaseVNode("option", _hoisted_16, toDisplayString(m("modeCss")), 1),
                createBaseVNode("option", _hoisted_17, toDisplayString(m("modeOnce")), 1)
              ], 512), [
                [vModelSelect, form.value.mode]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("allFramesLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                type: "checkbox",
                "onUpdate:modelValue": _cache[5] || (_cache[5] = ($event) => form.value.allFrames = $event)
              }, null, 512), [
                [vModelCheckbox, form.value.allFrames]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("persistLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                type: "checkbox",
                "onUpdate:modelValue": _cache[6] || (_cache[6] = ($event) => form.value.persist = $event)
              }, null, 512), [
                [vModelCheckbox, form.value.persist]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("dnrFallbackLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                type: "checkbox",
                "onUpdate:modelValue": _cache[7] || (_cache[7] = ($event) => form.value.dnrFallback = $event)
              }, null, 512), [
                [vModelCheckbox, form.value.dnrFallback]
              ])
            ])
          ]),
          createBaseVNode("label", null, [
            createTextVNode(toDisplayString(m("matchesInputLabel")) + " ", 1),
            withDirectives(createBaseVNode("input", {
              "onUpdate:modelValue": _cache[8] || (_cache[8] = ($event) => form.value.matches = $event),
              placeholder: m("placeholderMatchesExample")
            }, null, 8, _hoisted_18), [
              [vModelText, form.value.matches]
            ])
          ]),
          createBaseVNode("label", null, [
            createTextVNode(toDisplayString(m("excludesInputLabel")) + " ", 1),
            withDirectives(createBaseVNode("input", {
              "onUpdate:modelValue": _cache[9] || (_cache[9] = ($event) => form.value.excludes = $event),
              placeholder: m("placeholderOptional")
            }, null, 8, _hoisted_19), [
              [vModelText, form.value.excludes]
            ])
          ]),
          createBaseVNode("label", null, [
            createTextVNode(toDisplayString(m("tagsInputLabel")) + " ", 1),
            withDirectives(createBaseVNode("input", {
              "onUpdate:modelValue": _cache[10] || (_cache[10] = ($event) => form.value.tags = $event),
              placeholder: m("placeholderOptional")
            }, null, 8, _hoisted_20), [
              [vModelText, form.value.tags]
            ])
          ]),
          createBaseVNode("label", null, [
            createTextVNode(toDisplayString(m("scriptLabel")) + " ", 1),
            withDirectives(createBaseVNode("textarea", {
              "onUpdate:modelValue": _cache[11] || (_cache[11] = ($event) => form.value.script = $event),
              placeholder: m("placeholderScriptHint"),
              rows: "8"
            }, null, 8, _hoisted_21), [
              [vModelText, form.value.script]
            ])
          ]),
          createBaseVNode("div", _hoisted_22, [
            createBaseVNode("button", {
              disabled: submitting.value,
              onClick: _cache[12] || (_cache[12] = ($event) => apply("auto"))
            }, toDisplayString(m("applyButton")), 9, _hoisted_23),
            createBaseVNode("button", {
              disabled: submitting.value,
              onClick: _cache[13] || (_cache[13] = ($event) => apply("once"))
            }, toDisplayString(m("runOnceButton")), 9, _hoisted_24),
            lastResult.value ? (openBlock(), createElementBlock("span", _hoisted_25, toDisplayString(lastResult.value), 1)) : createCommentVNode("", true)
          ])
        ]),
        createBaseVNode("section", _hoisted_26, [
          createBaseVNode("h2", null, toDisplayString(m("listSectionTitle")), 1),
          createBaseVNode("div", _hoisted_27, [
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("queryLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                "onUpdate:modelValue": _cache[14] || (_cache[14] = ($event) => filters.value.query = $event),
                onInput: _cache[15] || (_cache[15] = ($event) => reload())
              }, null, 544), [
                [vModelText, filters.value.query]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("statusLabel")) + " ", 1),
              withDirectives(createBaseVNode("select", {
                "onUpdate:modelValue": _cache[16] || (_cache[16] = ($event) => filters.value.status = $event),
                onChange: _cache[17] || (_cache[17] = ($event) => reload())
              }, [
                createBaseVNode("option", _hoisted_28, toDisplayString(m("statusAll")), 1),
                createBaseVNode("option", _hoisted_29, toDisplayString(m("statusEnabled")), 1),
                createBaseVNode("option", _hoisted_30, toDisplayString(m("statusDisabled")), 1)
              ], 544), [
                [vModelSelect, filters.value.status]
              ])
            ]),
            createBaseVNode("label", null, [
              createTextVNode(toDisplayString(m("domainLabel")) + " ", 1),
              withDirectives(createBaseVNode("input", {
                "onUpdate:modelValue": _cache[18] || (_cache[18] = ($event) => filters.value.domain = $event),
                onInput: _cache[19] || (_cache[19] = ($event) => reload()),
                placeholder: m("placeholderDomainHint")
              }, null, 40, _hoisted_31), [
                [vModelText, filters.value.domain]
              ])
            ])
          ]),
          createBaseVNode("div", _hoisted_32, [
            createBaseVNode("button", { onClick: exportAll }, toDisplayString(m("exportAllButton")), 1)
          ]),
          createBaseVNode("table", _hoisted_33, [
            createBaseVNode("thead", null, [
              createBaseVNode("tr", null, [
                createBaseVNode("th", null, toDisplayString(m("tableHeaderName")), 1),
                createBaseVNode("th", null, toDisplayString(m("statusLabel")), 1),
                createBaseVNode("th", null, toDisplayString(m("tableHeaderWorld")), 1),
                createBaseVNode("th", null, toDisplayString(m("tableHeaderRunAt")), 1),
                createBaseVNode("th", null, toDisplayString(m("tableHeaderUpdated")), 1),
                _cache[20] || (_cache[20] = createBaseVNode("th", null, null, -1))
              ])
            ]),
            createBaseVNode("tbody", null, [
              (openBlock(true), createElementBlock(Fragment, null, renderList(items.value, (it) => {
                return openBlock(), createElementBlock("tr", {
                  key: it.id
                }, [
                  createBaseVNode("td", null, toDisplayString(it.name || it.id), 1),
                  createBaseVNode("td", null, [
                    createBaseVNode("label", null, [
                      createBaseVNode("input", {
                        type: "checkbox",
                        checked: it.status === "enabled",
                        onChange: ($event) => toggle(it)
                      }, null, 40, _hoisted_34),
                      createTextVNode(" " + toDisplayString(it.status), 1)
                    ])
                  ]),
                  createBaseVNode("td", null, toDisplayString(it.world), 1),
                  createBaseVNode("td", null, toDisplayString(it.runAt), 1),
                  createBaseVNode("td", null, toDisplayString(formatTime(it.updatedAt)), 1),
                  createBaseVNode("td", _hoisted_35, [
                    createBaseVNode("button", {
                      onClick: ($event) => remove(it)
                    }, toDisplayString(m("deleteButton")), 9, _hoisted_36)
                  ])
                ]);
              }), 128))
            ])
          ])
        ])
      ]);
    };
  }
});
const App = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-01edace1"]]);
createApp(App).mount("#app");
