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
import { r as ref } from "./_plugin-vue_export-helper-DRi44jog.js";
const STORAGE_KEY_THEME = "agentTheme";
const DEFAULT_THEME = "warm-editorial";
const VALID_THEMES = [
  "warm-editorial",
  "blueprint-architect",
  "zen-journal",
  "neo-pop",
  "dark-console",
  "swiss-grid"
];
const THEME_LABELS = {
  "warm-editorial": "Editorial",
  "blueprint-architect": "Blueprint",
  "zen-journal": "Zen",
  "neo-pop": "Neo-Pop",
  "dark-console": "Console",
  "swiss-grid": "Swiss"
};
function isValidTheme(value) {
  return typeof value === "string" && VALID_THEMES.includes(value);
}
function getThemeFromDocument() {
  const value = document.documentElement.dataset.agentTheme;
  return isValidTheme(value) ? value : DEFAULT_THEME;
}
function useAgentTheme() {
  const theme = ref(getThemeFromDocument());
  const ready = ref(false);
  function initTheme() {
    return __async(this, null, function* () {
      try {
        const result = yield chrome.storage.local.get(STORAGE_KEY_THEME);
        const stored = result[STORAGE_KEY_THEME];
        if (isValidTheme(stored)) {
          theme.value = stored;
        } else {
          theme.value = getThemeFromDocument();
        }
      } catch (error) {
        console.error("[useAgentTheme] Failed to load theme:", error);
        theme.value = getThemeFromDocument();
      } finally {
        ready.value = true;
      }
    });
  }
  function setTheme(id) {
    return __async(this, null, function* () {
      if (!isValidTheme(id)) {
        console.warn("[useAgentTheme] Invalid theme ID:", id);
        return;
      }
      theme.value = id;
      document.documentElement.dataset.agentTheme = id;
      try {
        yield chrome.storage.local.set({ [STORAGE_KEY_THEME]: id });
      } catch (error) {
        console.error("[useAgentTheme] Failed to save theme:", error);
      }
    });
  }
  function applyTo(el) {
    el.dataset.agentTheme = theme.value;
  }
  function getPreloadedTheme() {
    return getThemeFromDocument();
  }
  return {
    theme,
    ready,
    setTheme,
    initTheme,
    applyTo,
    getPreloadedTheme
  };
}
function preloadAgentTheme() {
  return __async(this, null, function* () {
    let themeId = DEFAULT_THEME;
    try {
      const result = yield chrome.storage.local.get(STORAGE_KEY_THEME);
      const stored = result[STORAGE_KEY_THEME];
      if (isValidTheme(stored)) {
        themeId = stored;
      }
    } catch (error) {
      console.error("[preloadAgentTheme] Failed to load theme:", error);
    }
    document.documentElement.dataset.agentTheme = themeId;
    return themeId;
  });
}
export {
  THEME_LABELS as T,
  preloadAgentTheme as p,
  useAgentTheme as u
};
