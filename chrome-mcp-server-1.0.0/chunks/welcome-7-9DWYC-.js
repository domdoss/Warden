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
import { d as defineComponent, r as ref, b as createElementBlock, e as openBlock, y as createBaseVNode, G as createTextVNode, H as toDisplayString, D as normalizeStyle, F as Fragment, O as renderList, V as createStaticVNode, _ as _export_sfc, a1 as createApp } from "./_plugin-vue_export-helper-DRi44jog.js";
import { N as NATIVE_HOST, L as LINKS } from "./constants-Dw2yqhzZ.js";
/* empty css                    */
/* empty css                  */
const _hoisted_1 = { class: "agent-theme welcome-root" };
const _hoisted_2 = { class: "min-h-screen flex flex-col" };
const _hoisted_3 = { class: "welcome-header flex-none px-6 py-5" };
const _hoisted_4 = { class: "max-w-3xl mx-auto flex items-center justify-between gap-4" };
const _hoisted_5 = { class: "flex items-center gap-3 min-w-0" };
const _hoisted_6 = {
  class: "welcome-icon w-10 h-10 flex items-center justify-center flex-shrink-0",
  "aria-hidden": "true"
};
const _hoisted_7 = {
  class: "w-6 h-6",
  style: { color: "var(--ac-accent)" },
  fill: "none",
  viewBox: "0 0 24 24",
  stroke: "currentColor"
};
const _hoisted_8 = { class: "flex-1 px-6 py-8" };
const _hoisted_9 = { class: "max-w-3xl mx-auto space-y-6" };
const _hoisted_10 = { class: "welcome-card welcome-card--primary p-6" };
const _hoisted_11 = { class: "mt-4 space-y-3" };
const _hoisted_12 = { class: "welcome-command-row flex items-center justify-between gap-3 px-4 py-3" };
const _hoisted_13 = { class: "welcome-code text-sm break-all" };
const _hoisted_14 = { class: "grid sm:grid-cols-2 gap-3" };
const _hoisted_15 = { class: "min-w-0" };
const _hoisted_16 = { class: "welcome-mono welcome-subtle text-[10px] uppercase tracking-widest font-medium" };
const _hoisted_17 = { class: "welcome-code text-xs break-all" };
const _hoisted_18 = ["onClick"];
const _hoisted_19 = {
  class: "mt-6 pt-5",
  style: { borderTop: "var(--ac-border-width) solid var(--ac-border)" }
};
const _hoisted_20 = { class: "welcome-command-row mt-3 flex items-center justify-between gap-3 px-4 py-3" };
const _hoisted_21 = { class: "welcome-code text-sm break-all" };
const _hoisted_22 = { class: "welcome-card overflow-hidden" };
const _hoisted_23 = { class: "px-6 pb-6 space-y-4" };
const _hoisted_24 = { class: "welcome-alt-row p-4" };
const _hoisted_25 = { class: "mt-3 space-y-2" };
const _hoisted_26 = { class: "min-w-0" };
const _hoisted_27 = { class: "welcome-mono welcome-subtle text-[10px] uppercase tracking-widest font-medium" };
const _hoisted_28 = { class: "welcome-code text-xs break-all" };
const _hoisted_29 = ["onClick"];
const _hoisted_30 = { class: "welcome-report-card p-4" };
const _hoisted_31 = { class: "welcome-command-row mt-3 flex items-center justify-between gap-3 px-3 py-2" };
const _hoisted_32 = { class: "welcome-code text-xs break-all" };
const _sfc_main = /* @__PURE__ */ defineComponent({
  __name: "App",
  setup(__props) {
    const COMMANDS = {
      npmInstall: "npm install -g mcp-chrome-bridge",
      pnpmInstall: "pnpm add -g mcp-chrome-bridge",
      yarnInstall: "yarn global add mcp-chrome-bridge",
      mcpUrl: "http://127.0.0.1:" + NATIVE_HOST.DEFAULT_PORT + "/mcp",
      doctor: "mcp-chrome-bridge doctor",
      fix: "mcp-chrome-bridge doctor --fix",
      report: "mcp-chrome-bridge report --copy"
    };
    const copiedKey = ref(null);
    const ALT_INSTALL = [
      { label: "pnpm", key: "pnpmInstall" },
      { label: "yarn", key: "yarnInstall" }
    ];
    const DIAGNOSTICS = [
      { label: "Doctor", key: "doctor" },
      { label: "Auto-fix", key: "fix" }
    ];
    function copyLabel(key) {
      return copiedKey.value === key ? "Copied" : "Copy";
    }
    function copyColor(key) {
      return copiedKey.value === key ? "var(--ac-success)" : "var(--ac-text-muted)";
    }
    function copyCommand(key) {
      return __async(this, null, function* () {
        try {
          yield navigator.clipboard.writeText(COMMANDS[key]);
          copiedKey.value = key;
          window.setTimeout(() => {
            if (copiedKey.value === key) copiedKey.value = null;
          }, 2e3);
        } catch (err) {
          console.error("Failed to copy:", err);
          copiedKey.value = null;
        }
      });
    }
    function openDocs() {
      return __async(this, null, function* () {
        try {
          yield chrome.tabs.create({ url: LINKS.TROUBLESHOOTING });
        } catch (e) {
          window.open(LINKS.TROUBLESHOOTING, "_blank", "noopener,noreferrer");
        }
      });
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1, [
        createBaseVNode("div", _hoisted_2, [
          createBaseVNode("header", _hoisted_3, [
            createBaseVNode("div", _hoisted_4, [
              createBaseVNode("div", _hoisted_5, [
                createBaseVNode("div", _hoisted_6, [
                  (openBlock(), createElementBlock("svg", _hoisted_7, [..._cache[3] || (_cache[3] = [
                    createBaseVNode("path", {
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                      "stroke-width": "2",
                      d: "M13 10V3L4 14h7v7l9-11h-7z"
                    }, null, -1)
                  ])]))
                ]),
                _cache[4] || (_cache[4] = createBaseVNode("div", { class: "min-w-0" }, [
                  createBaseVNode("h1", { class: "welcome-title text-lg font-medium tracking-tight truncate" }, " Chrome MCP Server "),
                  createBaseVNode("p", { class: "welcome-muted text-sm truncate" }, " After the extension is installed, this is the only required step. ")
                ], -1))
              ]),
              createBaseVNode("button", {
                class: "welcome-button px-3 py-2 text-xs font-medium ac-btn flex-shrink-0",
                onClick: openDocs
              }, " Troubleshooting Docs ")
            ])
          ]),
          createBaseVNode("main", _hoisted_8, [
            createBaseVNode("div", _hoisted_9, [
              createBaseVNode("section", _hoisted_10, [
                _cache[9] || (_cache[9] = createBaseVNode("h2", { class: "welcome-title text-xl font-medium" }, [
                  createTextVNode(" Install "),
                  createBaseVNode("code", { class: "welcome-code" }, "mcp-chrome-bridge")
                ], -1)),
                _cache[10] || (_cache[10] = createBaseVNode("p", { class: "welcome-muted text-sm mt-2" }, " The Chrome extension uses this local bridge to expose MCP tools to your client. ", -1)),
                createBaseVNode("div", _hoisted_11, [
                  createBaseVNode("div", _hoisted_12, [
                    createBaseVNode("code", _hoisted_13, toDisplayString(COMMANDS.npmInstall), 1),
                    createBaseVNode("button", {
                      class: "welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0",
                      style: normalizeStyle({ color: copyColor("npmInstall") }),
                      onClick: _cache[0] || (_cache[0] = ($event) => copyCommand("npmInstall"))
                    }, toDisplayString(copyLabel("npmInstall")), 5)
                  ]),
                  createBaseVNode("div", _hoisted_14, [
                    (openBlock(), createElementBlock(Fragment, null, renderList(ALT_INSTALL, (item) => {
                      return createBaseVNode("div", {
                        key: item.key,
                        class: "welcome-alt-row flex items-center justify-between gap-3 px-4 py-3"
                      }, [
                        createBaseVNode("div", _hoisted_15, [
                          createBaseVNode("div", _hoisted_16, toDisplayString(item.label), 1),
                          createBaseVNode("code", _hoisted_17, toDisplayString(COMMANDS[item.key]), 1)
                        ]),
                        createBaseVNode("button", {
                          class: "welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0",
                          style: normalizeStyle({ color: copyColor(item.key) }),
                          onClick: ($event) => copyCommand(item.key)
                        }, toDisplayString(copyLabel(item.key)), 13, _hoisted_18)
                      ]);
                    }), 64))
                  ]),
                  _cache[5] || (_cache[5] = createBaseVNode("div", { class: "welcome-alt-row welcome-muted px-4 py-3 text-xs" }, [
                    createTextVNode(" Requires Node.js 20+. Check your version with "),
                    createBaseVNode("code", { class: "welcome-code welcome-code-inline px-1 py-0.5" }, "node -v"),
                    createTextVNode(". ")
                  ], -1))
                ]),
                createBaseVNode("div", _hoisted_19, [
                  _cache[6] || (_cache[6] = createBaseVNode("h3", { class: "welcome-title text-sm font-medium" }, "MCP client URL (streamable HTTP)", -1)),
                  _cache[7] || (_cache[7] = createBaseVNode("p", { class: "welcome-muted text-sm mt-1" }, " Use this URL in your MCP client (e.g., Claude Desktop, CherryStudio). ", -1)),
                  createBaseVNode("div", _hoisted_20, [
                    createBaseVNode("code", _hoisted_21, toDisplayString(COMMANDS.mcpUrl), 1),
                    createBaseVNode("button", {
                      class: "welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0",
                      style: normalizeStyle({ color: copyColor("mcpUrl") }),
                      onClick: _cache[1] || (_cache[1] = ($event) => copyCommand("mcpUrl"))
                    }, toDisplayString(copyLabel("mcpUrl")), 5)
                  ]),
                  _cache[8] || (_cache[8] = createBaseVNode("p", { class: "welcome-subtle text-xs mt-3" }, ' Tip: You can also open the extension popup and click "Connect" to copy a full client config snippet. ', -1))
                ])
              ]),
              createBaseVNode("details", _hoisted_22, [
                _cache[16] || (_cache[16] = createStaticVNode('<summary class="px-6 py-4 cursor-pointer select-none flex items-center justify-between gap-4" data-v-0a6d1030><div class="min-w-0" data-v-0a6d1030><div class="welcome-title text-sm font-medium" data-v-0a6d1030>Troubleshooting</div><div class="welcome-muted text-xs truncate" data-v-0a6d1030> Use these only if the bridge fails to register or connect. </div></div><span class="welcome-mono welcome-subtle text-xs flex-shrink-0" data-v-0a6d1030>doctor · report</span></summary>', 1)),
                createBaseVNode("div", _hoisted_23, [
                  createBaseVNode("div", _hoisted_24, [
                    _cache[11] || (_cache[11] = createBaseVNode("div", { class: "text-sm font-medium" }, "Diagnostics", -1)),
                    _cache[12] || (_cache[12] = createBaseVNode("p", { class: "welcome-muted text-sm mt-1" }, [
                      createTextVNode(" Run "),
                      createBaseVNode("code", { class: "welcome-code" }, "doctor"),
                      createTextVNode(" to check installation status. If it reports an error, run the auto-fix command. ")
                    ], -1)),
                    createBaseVNode("div", _hoisted_25, [
                      (openBlock(), createElementBlock(Fragment, null, renderList(DIAGNOSTICS, (item) => {
                        return createBaseVNode("div", {
                          key: item.key,
                          class: "welcome-command-row flex items-center justify-between gap-3 px-3 py-2"
                        }, [
                          createBaseVNode("div", _hoisted_26, [
                            createBaseVNode("div", _hoisted_27, toDisplayString(item.label), 1),
                            createBaseVNode("code", _hoisted_28, toDisplayString(COMMANDS[item.key]), 1)
                          ]),
                          createBaseVNode("button", {
                            class: "welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0",
                            style: normalizeStyle({ color: copyColor(item.key) }),
                            onClick: ($event) => copyCommand(item.key)
                          }, toDisplayString(copyLabel(item.key)), 13, _hoisted_29)
                        ]);
                      }), 64))
                    ])
                  ]),
                  createBaseVNode("div", _hoisted_30, [
                    _cache[13] || (_cache[13] = createBaseVNode("div", {
                      class: "text-sm font-medium",
                      style: { color: "var(--ac-danger)" }
                    }, " Report an issue ", -1)),
                    _cache[14] || (_cache[14] = createBaseVNode("p", { class: "welcome-muted text-sm mt-1" }, " Generate a diagnostic report and paste it into a GitHub issue. ", -1)),
                    createBaseVNode("div", _hoisted_31, [
                      createBaseVNode("code", _hoisted_32, toDisplayString(COMMANDS.report), 1),
                      createBaseVNode("button", {
                        class: "welcome-mono px-2 py-1 text-xs font-medium ac-btn flex-shrink-0",
                        style: normalizeStyle({ color: copyColor("report") }),
                        onClick: _cache[2] || (_cache[2] = ($event) => copyCommand("report"))
                      }, toDisplayString(copyLabel("report")), 5)
                    ]),
                    _cache[15] || (_cache[15] = createBaseVNode("p", { class: "welcome-subtle text-xs mt-2" }, " This copies the report to your clipboard (sensitive info is automatically redacted). ", -1))
                  ]),
                  createBaseVNode("div", { class: "flex" }, [
                    createBaseVNode("button", {
                      class: "welcome-button px-3 py-2 text-xs font-medium ac-btn",
                      onClick: openDocs
                    }, " Open troubleshooting docs ")
                  ])
                ])
              ])
            ])
          ])
        ])
      ]);
    };
  }
});
const App = /* @__PURE__ */ _export_sfc(_sfc_main, [["__scopeId", "data-v-0a6d1030"]]);
createApp(App).mount("#app");
