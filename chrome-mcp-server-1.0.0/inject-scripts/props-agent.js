/* eslint-disable */
// @ts-nocheck
/**
 * Props Agent - MAIN World Script
 *
 * Runtime hacking agent for React/Vue Props editing.
 * Communicates with ISOLATED world via CustomEvent.
 *
 * Architecture:
 * - Transport: CustomEvent-based request/response
 * - Locator: Simplified ElementLocator resolution
 * - ReactAdapter: DevTools Hook detection/injection + overrideProps
 * - VueAdapter: __vueParentComponent + $forceUpdate
 * - Serializer: Safe Props serialization with type preservation
 * - Handlers: Request operation dispatch
 *
 * @module props-agent
 */
(() => {
  'use strict';

  // =============================================================================
  // Constants & Guards
  // =============================================================================

  const GLOBAL_KEY = '__MCP_WEB_EDITOR_PROPS_AGENT__';
  if (window[GLOBAL_KEY]) return;

  const PROTOCOL_VERSION = 1;
  const LOG_PREFIX = '[PropsAgent]';

  const EVENT_NAME = Object.freeze({
    REQUEST: 'web-editor-props:request',
    RESPONSE: 'web-editor-props:response',
    CLEANUP: 'web-editor-props:cleanup',
  });

  const REACT_HOOK_NAME = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

  /** @type {'READY' | 'HOOK_PRESENT_NO_RENDERERS' | 'RENDERERS_NO_EDITING' | 'HOOK_MISSING'} */
  const HOOK_STATUS = Object.freeze({
    READY: 'READY',
    HOOK_PRESENT_NO_RENDERERS: 'HOOK_PRESENT_NO_RENDERERS',
    RENDERERS_NO_EDITING: 'RENDERERS_NO_EDITING',
    HOOK_MISSING: 'HOOK_MISSING',
  });

  const SERIALIZE_LIMITS = Object.freeze({
    maxDepth: 4,
    maxEntries: 100,
    maxArrayLength: 50,
    maxStringLength: 1500,
  });

  // =============================================================================
  // Utilities
  // =============================================================================

  function isObject(value) {
    return value !== null && typeof value === 'object';
  }

  function safeString(value) {
    try {
      if (typeof value === 'string') return value;
      if (value === null || value === undefined) return '';
      return String(value);
    } catch {
      return '';
    }
  }

  function logWarn(...args) {
    try {
      console.warn(LOG_PREFIX, ...args);
    } catch {
      // Silently ignore
    }
  }

  // =============================================================================
  // Transport Layer
  // =============================================================================

  const Transport = {
    dispatchResponse(detail) {
      try {
        window.dispatchEvent(new CustomEvent(EVENT_NAME.RESPONSE, { detail }));
      } catch (err) {
        logWarn('Failed to dispatch response:', err);
      }
    },

    createResponse(requestId, success, data, error) {
      const response = {
        v: PROTOCOL_VERSION,
        requestId,
        success: Boolean(success),
      };
      if (data !== undefined) response.data = data;
      if (error !== undefined) response.error = safeString(error);
      return response;
    },

    normalizeRequest(detail) {
      if (!isObject(detail)) return null;
      if (detail.v !== PROTOCOL_VERSION) return null;

      const requestId = typeof detail.requestId === 'string' ? detail.requestId : '';
      const op = typeof detail.op === 'string' ? detail.op : '';
      if (!requestId || !op) return null;

      return {
        v: PROTOCOL_VERSION,
        requestId,
        op,
        locator: detail.locator,
        payload: detail.payload,
      };
    },
  };

  // =============================================================================
  // Locator - Element Resolution
  // =============================================================================

  const Locator = {
    safeQuerySelector(root, selector) {
      try {
        if (!root || typeof selector !== 'string' || !selector.trim()) return null;
        return root.querySelector(selector);
      } catch {
        return null;
      }
    },

    safeQuerySelectorAll(root, selector) {
      try {
        if (!root || typeof selector !== 'string' || !selector.trim()) return [];
        return Array.from(root.querySelectorAll(selector));
      } catch {
        return [];
      }
    },

    isSelectorUnique(root, selector) {
      return this.safeQuerySelectorAll(root, selector).length === 1;
    },

    computeFingerprint(element) {
      try {
        const parts = [];
        const tag = element?.tagName ? String(element.tagName).toLowerCase() : 'unknown';
        parts.push(tag);
        const id = element?.id ? String(element.id).trim() : '';
        if (id) parts.push(`id=${id}`);
        return parts.join('|');
      } catch {
        return '';
      }
    },

    verifyFingerprint(element, fingerprint) {
      try {
        const current = this.computeFingerprint(element);
        const storedParts = safeString(fingerprint).split('|');
        const currentParts = current.split('|');

        // Tag must match
        if (storedParts[0] !== currentParts[0]) return false;

        // If stored has id, current must have same id
        const storedId = storedParts.find((p) => p.startsWith('id='));
        const currentId = currentParts.find((p) => p.startsWith('id='));
        if (storedId && storedId !== currentId) return false;

        return true;
      } catch {
        return false;
      }
    },

    normalizeStringArray(value) {
      if (!Array.isArray(value)) return [];
      return value.map((v) => safeString(v).trim()).filter(Boolean);
    },

    /**
     * Resolve ElementLocator to DOM element
     * Simplified version for MAIN world (no iframe support yet)
     */
    locate(locator, rootDocument = document) {
      try {
        if (!isObject(locator)) return null;

        let queryRoot = rootDocument;

        // Traverse Shadow DOM host chain
        const shadowHostChain = this.normalizeStringArray(locator.shadowHostChain);
        for (const hostSelector of shadowHostChain) {
          if (!this.isSelectorUnique(queryRoot, hostSelector)) return null;
          const host = this.safeQuerySelector(queryRoot, hostSelector);
          if (!host) return null;
          const shadowRoot = host.shadowRoot;
          if (!shadowRoot) return null;
          queryRoot = shadowRoot;
        }

        // Try each selector candidate
        const selectors = this.normalizeStringArray(locator.selectors);
        for (const selector of selectors) {
          if (!this.isSelectorUnique(queryRoot, selector)) continue;
          const element = this.safeQuerySelector(queryRoot, selector);
          if (!element) continue;

          // Verify fingerprint if provided
          const fp = safeString(locator.fingerprint);
          if (fp && !this.verifyFingerprint(element, fp)) continue;

          return element;
        }
      } catch {
        // Best-effort
      }
      return null;
    },
  };

  // =============================================================================
  // React Adapter
  // =============================================================================

  const ReactAdapter = {
    /** Store original values for reset (fiber -> { renderer, originals: Map }) */
    overrideStore: typeof WeakMap === 'function' ? new WeakMap() : null,

    /** Flag to avoid repeated hook installation attempts */
    hookInstallAttempted: false,

    getHook() {
      try {
        return window[REACT_HOOK_NAME] || null;
      } catch {
        return null;
      }
    },

    /**
     * Install minimal DevTools hook if missing.
     * Note: This only helps if React hasn't initialized yet.
     * Only attempts once per session to avoid repeated pollution.
     */
    installMinimalHook() {
      // Only attempt once per session
      if (this.hookInstallAttempted) {
        return { installed: false, hook: this.getHook(), skipped: true };
      }
      this.hookInstallAttempted = true;
      try {
        const existing = window[REACT_HOOK_NAME];
        if (existing && typeof existing.inject === 'function') {
          return { installed: false, hook: existing };
        }

        const listeners = Object.create(null);

        const hook = {
          renderers: new Map(),
          supportsFiber: true,

          inject(renderer) {
            try {
              const id = this.renderers.size + 1;
              this.renderers.set(id, renderer);
              this.emit('renderer', { id, renderer });
              return id;
            } catch {
              return 0;
            }
          },

          // Required lifecycle callbacks (no-ops)
          onCommitFiberRoot() {},
          onCommitFiberUnmount() {},
          onPostCommitFiberRoot() {},
          setStrictMode() {},
          checkDCE() {},

          // Event emitter
          on(event, fn) {
            if (typeof event !== 'string' || typeof fn !== 'function') return;
            if (!listeners[event]) listeners[event] = new Set();
            listeners[event].add(fn);
          },

          off(event, fn) {
            if (typeof event !== 'string' || typeof fn !== 'function') return;
            listeners[event]?.delete(fn);
          },

          emit(event, data) {
            const set = listeners[event];
            if (!set) return;
            for (const fn of Array.from(set)) {
              try {
                fn(data);
              } catch {
                // Listener errors must not break the hook
              }
            }
          },

          sub(event, fn) {
            this.on(event, fn);
            return () => this.off(event, fn);
          },
        };

        window[REACT_HOOK_NAME] = hook;
        return { installed: true, hook };
      } catch (err) {
        return { installed: false, hook: null, error: err };
      }
    },

    /**
     * Normalize hook.renderers to array format
     */
    normalizeRenderers(hook) {
      const result = [];
      if (!hook) return result;

      try {
        const renderers = hook.renderers;
        if (renderers instanceof Map) {
          for (const [id, renderer] of renderers.entries()) {
            result.push({ id, renderer });
          }
        } else if (renderers && typeof renderers === 'object') {
          for (const [id, renderer] of Object.entries(renderers)) {
            result.push({ id, renderer });
          }
        }
      } catch {
        // Best-effort
      }
      return result;
    },

    /**
     * Detect Hook status (4 states)
     */
    detectStatus() {
      const hook = this.getHook();

      if (!hook || typeof hook.inject !== 'function') {
        return {
          hookStatus: HOOK_STATUS.HOOK_MISSING,
          hook: null,
          renderers: [],
          editableRenderers: [],
        };
      }

      const renderers = this.normalizeRenderers(hook);
      if (!renderers.length) {
        return {
          hookStatus: HOOK_STATUS.HOOK_PRESENT_NO_RENDERERS,
          hook,
          renderers,
          editableRenderers: [],
        };
      }

      const editableRenderers = renderers.filter(
        (r) => r?.renderer && typeof r.renderer.overrideProps === 'function',
      );

      if (editableRenderers.length) {
        return {
          hookStatus: HOOK_STATUS.READY,
          hook,
          renderers,
          editableRenderers,
        };
      }

      return {
        hookStatus: HOOK_STATUS.RENDERERS_NO_EDITING,
        hook,
        renderers,
        editableRenderers: [],
      };
    },

    /**
     * Get React version from renderer or global.
     * Prioritizes specific renderer version for multi-renderer scenarios.
     *
     * @param {object} hookInfo - Result from detectStatus()
     * @param {object} [specificRenderer] - Specific renderer to prefer (from resolveFiberWithRenderer)
     * @returns {string | undefined}
     */
    getVersion(hookInfo, specificRenderer) {
      try {
        // Priority 1: Specific renderer version (for multi-renderer scenarios)
        if (specificRenderer) {
          const version = specificRenderer.version;
          if (typeof version === 'string' && version.trim()) {
            return version.trim();
          }
        }

        // Priority 2: Any renderer with version
        const renderers = hookInfo?.renderers || [];
        for (const item of renderers) {
          const version = item?.renderer?.version;
          if (typeof version === 'string' && version.trim()) {
            return version.trim();
          }
        }

        // Priority 3: Global React object (if exposed)
        if (typeof window !== 'undefined' && window.React?.version) {
          return String(window.React.version).trim();
        }
      } catch {
        // Best-effort
      }
      return undefined;
    },

    /**
     * Find React fiber from DOM node
     */
    findFiberFromDOM(node) {
      try {
        if (!node || typeof node !== 'object') return null;
        const keys = Object.keys(node);
        for (const key of keys) {
          if (key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')) {
            return node[key];
          }
        }
      } catch {
        // Best-effort
      }
      return null;
    },

    /**
     * Check if fiber tag is a component (Function/Class/ForwardRef etc.)
     */
    isComponentTag(tag) {
      // 0=FunctionComponent, 1=ClassComponent, 2=IndeterminateComponent,
      // 11=ForwardRef, 14=MemoComponent, 15=SimpleMemoComponent
      return tag === 0 || tag === 1 || tag === 2 || tag === 11 || tag === 14 || tag === 15;
    },

    /**
     * Find nearest component fiber by walking up the fiber tree
     */
    findNearestComponentFiber(fiber) {
      try {
        let current = fiber;
        for (let i = 0; i < 60 && current; i++) {
          if (this.isComponentTag(current.tag)) return current;
          current = current.return;
        }
      } catch {
        // Best-effort
      }
      return null;
    },

    /**
     * Get component display name from fiber
     */
    getComponentName(fiber) {
      try {
        const type = fiber?.type || fiber?.elementType;
        if (!type) return 'Anonymous';
        if (typeof type === 'string') return type;
        return safeString(type.displayName || type.name) || 'Anonymous';
      } catch {
        return 'Anonymous';
      }
    },

    /**
     * Extract debug source from React Fiber.
     * Walks up the fiber tree checking _debugSource and _debugOwner._debugSource.
     *
     * @param {object} fiber - React Fiber node
     * @returns {{ file: string, line?: number, column?: number, componentName?: string } | null}
     */
    getDebugSource(fiber) {
      try {
        let current = fiber;
        for (let i = 0; i < 40 && current; i++) {
          if (!isObject(current)) break;

          // Try direct _debugSource first
          const src = isObject(current._debugSource) ? current._debugSource : null;
          if (src) {
            const file = safeString(src.fileName).trim();
            if (file) {
              return this.buildDebugSourceResult(file, src.lineNumber, src.columnNumber, current);
            }
          }

          // Fallback to _debugOwner._debugSource
          const owner = isObject(current._debugOwner) ? current._debugOwner : null;
          const ownerSrc = owner && isObject(owner._debugSource) ? owner._debugSource : null;
          if (ownerSrc) {
            const ownerFile = safeString(ownerSrc.fileName).trim();
            if (ownerFile) {
              return this.buildDebugSourceResult(
                ownerFile,
                ownerSrc.lineNumber,
                ownerSrc.columnNumber,
                owner,
              );
            }
          }

          current = current.return;
        }
      } catch {
        // Best-effort extraction
      }
      return null;
    },

    /**
     * Build debug source result with validated line/column values.
     * @private
     */
    buildDebugSourceResult(file, lineNumber, columnNumber, fiberForName) {
      const line = Number(lineNumber);
      const column = Number(columnNumber);
      return {
        file,
        line: Number.isFinite(line) && line > 0 ? line : undefined,
        column: Number.isFinite(column) && column > 0 ? column : undefined,
        componentName: this.getComponentName(fiberForName),
      };
    },

    /**
     * Resolve fiber using renderer.findFiberByHostInstance when available
     */
    resolveFiberWithRenderer(element, hookInfo) {
      // Prefer renderer API (returns renderer-owned fiber suitable for overrideProps)
      try {
        const renderers = hookInfo?.renderers || [];
        for (const item of renderers) {
          const renderer = item?.renderer;
          if (!renderer || typeof renderer.findFiberByHostInstance !== 'function') continue;
          try {
            const fiber = renderer.findFiberByHostInstance(element);
            if (fiber) return { fiber, renderer };
          } catch {
            // Try next renderer
          }
        }
      } catch {
        // Best-effort
      }

      // Fallback: DOM-attached fiber reference
      const fallback = this.findFiberFromDOM(element);
      return { fiber: fallback, renderer: null };
    },

    /**
     * Record original value for reset
     */
    recordOriginal(fiber, renderer, path, existed, value) {
      if (!this.overrideStore || !fiber) return;

      try {
        const key = JSON.stringify(path);
        let store = this.overrideStore.get(fiber);

        if (!store) {
          store = { renderer: renderer || null, originals: new Map() };
          this.overrideStore.set(fiber, store);

          // Also store by alternate to improve reset hit rate
          if (fiber.alternate && typeof fiber.alternate === 'object') {
            this.overrideStore.set(fiber.alternate, store);
          }
        }

        if (!store.originals.has(key)) {
          store.originals.set(key, { path, existed, value });
        }

        if (!store.renderer && renderer) {
          store.renderer = renderer;
        }
      } catch {
        // Best-effort
      }
    },

    /**
     * Get stored originals for fiber
     */
    getOriginals(fiber) {
      if (!this.overrideStore || !fiber) return null;
      return this.overrideStore.get(fiber) || null;
    },

    /**
     * Clear stored originals for fiber
     */
    clearOriginals(fiber) {
      if (!this.overrideStore || !fiber) return;
      const store = this.overrideStore.get(fiber);
      if (store?.originals) store.originals.clear();
    },
  };

  // =============================================================================
  // Vue Adapter
  // =============================================================================

  const VueAdapter = {
    /** Store original values for reset (instance -> Map) */
    overrideStore: typeof WeakMap === 'function' ? new WeakMap() : null,

    /**
     * Find Vue 3 component instance from DOM node
     */
    findInstanceFromDOM(node) {
      try {
        if (!node || typeof node !== 'object') return null;
        return node.__vueParentComponent || null;
      } catch {
        return null;
      }
    },

    /**
     * Get component name from instance
     */
    getComponentName(instance) {
      try {
        const type = instance?.type;
        return safeString(type?.name || type?.__name) || 'Anonymous';
      } catch {
        return 'Anonymous';
      }
    },

    /**
     * Check if instance appears to be from dev build
     */
    isDevBuild(instance) {
      try {
        const type = instance?.type;
        const file = type?.__file;
        return typeof file === 'string' && !!file.trim();
      } catch {
        return false;
      }
    },

    /**
     * Parse Vue inspector location attribute value.
     * Format: "src/components/Foo.vue:23:7" or "C:\path\file.vue:10:5" (Windows)
     *
     * Uses trailing regex to safely handle Windows paths with drive letters.
     *
     * @param {string} value - The data-v-inspector attribute value
     * @returns {{ file: string, line?: number, column?: number } | null}
     */
    parseVInspector(value) {
      if (typeof value !== 'string') return null;
      const raw = value.trim();
      if (!raw) return null;

      // Match only trailing :line or :line:column to avoid Windows drive letter issues
      const match = raw.match(/:([\d]+)(?::([\d]+))?$/);
      if (!match) {
        // No line info, return file only
        return { file: raw };
      }

      const file = raw.slice(0, match.index).trim();
      if (!file) return null;

      const line = Number.parseInt(match[1], 10);
      const column = match[2] ? Number.parseInt(match[2], 10) : undefined;

      return {
        file,
        line: Number.isFinite(line) && line > 0 ? line : undefined,
        column: Number.isFinite(column) && column > 0 ? column : undefined,
      };
    },

    /**
     * Walk up DOM tree to find data-v-inspector attribute.
     * This attribute is injected by @vitejs/plugin-vue-inspector.
     *
     * @param {Element} element - Starting DOM element
     * @param {number} [maxDepth=15] - Maximum depth to traverse
     * @returns {{ file: string, line?: number, column?: number } | null}
     */
    findInspectorLocation(element, maxDepth = 15) {
      try {
        let node = element;
        for (let depth = 0; depth < maxDepth && node; depth++) {
          if (typeof node.getAttribute === 'function') {
            const attr = node.getAttribute('data-v-inspector');
            if (attr) {
              const parsed = this.parseVInspector(attr);
              if (parsed?.file) return parsed;
            }
          }
          node = node.parentElement;
        }
      } catch {
        // Best-effort extraction
      }
      return null;
    },

    /**
     * Get Vue component debug source.
     * Priority: data-v-inspector (has line/column) > type.__file (file only)
     *
     * @param {object} instance - Vue component instance
     * @param {Element} targetElement - DOM element for inspector lookup
     * @returns {{ file: string, line?: number, column?: number, componentName?: string } | null}
     */
    getDebugSource(instance, targetElement) {
      try {
        // Priority 1: data-v-inspector attribute (has precise line/column)
        const inspector = this.findInspectorLocation(targetElement);
        if (inspector?.file) {
          return {
            file: inspector.file,
            line: inspector.line,
            column: inspector.column,
            componentName: this.getComponentName(instance),
          };
        }

        // Priority 2: type.__file (file only, no line/column)
        const typeFile = instance?.type?.__file;
        if (typeof typeFile === 'string') {
          const file = typeFile.trim();
          if (file) {
            return {
              file,
              componentName: this.getComponentName(instance),
            };
          }
        }
      } catch {
        // Best-effort extraction
      }
      return null;
    },

    /**
     * Get Vue 3 version from instance.
     * Note: This adapter only supports Vue 3 (via __vueParentComponent).
     *
     * @param {object} instance - Vue 3 component instance
     * @returns {string | undefined}
     */
    getVersion(instance) {
      try {
        // Vue 3: Get version from app context
        const appVersion = instance?.appContext?.app?.version;
        if (typeof appVersion === 'string' && appVersion.trim()) {
          return appVersion.trim();
        }
      } catch {
        // Best-effort
      }
      return undefined;
    },

    /**
     * Get writable props container (vnode.props or instance.props)
     * @deprecated Use getWriteContainers for better targeting
     */
    getPropsContainer(instance) {
      try {
        const vnodeProps = instance?.vnode?.props;
        if (vnodeProps && typeof vnodeProps === 'object') return vnodeProps;
      } catch {
        // ignore
      }

      try {
        const props = instance?.props;
        if (props && typeof props === 'object') return props;
      } catch {
        // ignore
      }

      return null;
    },

    /**
     * Check if a key is a declared prop (vs fallthrough attr).
     * Uses component type definition and runtime props object.
     */
    isDeclaredProp(instance, key) {
      // Check type.props definition first
      try {
        const opts = instance?.type?.props;
        if (Array.isArray(opts)) return opts.includes(key);
        if (isObject(opts)) return Object.prototype.hasOwnProperty.call(opts, key);
      } catch {
        // ignore
      }

      // Fallback: if key exists in instance.props, treat as declared
      try {
        const props = instance?.props;
        if (isObject(props)) {
          return Object.prototype.hasOwnProperty.call(props, key);
        }
      } catch {
        // ignore
      }

      return false;
    },

    /**
     * Get write container candidates for a prop kind ('props' | 'attrs').
     * Returns array of containers to try in order.
     */
    getWriteContainers(instance, kind) {
      const containers = [];
      const seen = typeof Set === 'function' ? new Set() : null;

      const addContainer = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        if (seen) {
          if (seen.has(obj)) return;
          seen.add(obj);
        }
        containers.push(obj);
      };

      if (!instance || typeof instance !== 'object') return containers;

      // Primary container based on kind
      if (kind === 'attrs') {
        try {
          addContainer(instance.attrs);
        } catch {
          // ignore
        }
      } else {
        try {
          addContainer(instance.props);
        } catch {
          // ignore
        }
      }

      // Fallback: vnode.props (often more writable)
      try {
        addContainer(instance?.vnode?.props);
      } catch {
        // ignore
      }

      return containers;
    },

    /**
     * Get logical root for reading a prop kind.
     */
    getReadRoot(instance, kind) {
      if (kind === 'attrs') {
        try {
          if (isObject(instance?.attrs)) return instance.attrs;
        } catch {
          // ignore
        }
      } else {
        try {
          if (isObject(instance?.props)) return instance.props;
        } catch {
          // ignore
        }
      }

      // Fallback
      try {
        if (isObject(instance?.vnode?.props)) return instance.vnode.props;
      } catch {
        // ignore
      }

      return null;
    },

    /**
     * Get raw vnode props object
     */
    getVNodeProps(instance) {
      try {
        const p = instance?.vnode?.props;
        return isObject(p) ? p : null;
      } catch {
        return null;
      }
    },

    /**
     * Apply new raw props via instance.next + instance.update() so Vue runs its internal
     * updateProps/updateSlots pipeline (closest to a parent-driven props update).
     * This is the correct way to trigger Vue3 props update.
     */
    applyNextProps(instance, nextRawProps) {
      try {
        const vnode = instance?.vnode;
        if (!vnode || typeof vnode !== 'object') return false;

        // Vue3 PatchFlags.FULL_PROPS = 16
        const FULL_PROPS = 16;
        const prevFlag = typeof vnode.patchFlag === 'number' ? vnode.patchFlag : 0;
        const patchFlag = prevFlag >= 0 ? prevFlag | FULL_PROPS : FULL_PROPS;

        // Create next vnode with updated props
        const nextVNode = Object.assign({}, vnode, {
          props: nextRawProps,
          patchFlag,
          dynamicProps: null,
          component: instance,
        });

        instance.next = nextVNode;

        // Trigger update
        if (instance && typeof instance.update === 'function') {
          instance.update();
          return true;
        }

        const proxy = instance?.proxy;
        if (proxy && typeof proxy.$forceUpdate === 'function') {
          proxy.$forceUpdate();
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    },

    /**
     * Trigger Vue re-render (fallback, may not work for props changes)
     */
    forceUpdate(instance) {
      try {
        const proxy = instance?.proxy;
        if (proxy && typeof proxy.$forceUpdate === 'function') {
          proxy.$forceUpdate();
          return true;
        }
      } catch {
        // ignore
      }

      try {
        if (instance && typeof instance.update === 'function') {
          instance.update();
          return true;
        }
      } catch {
        // ignore
      }

      return false;
    },

    /**
     * Immutable update helper for nested props
     */
    copyWithSet(root, path, value) {
      if (!Array.isArray(path) || path.length === 0) return value;

      const seg = path[0];
      const rest = path.slice(1);
      const isIndex = typeof seg === 'number';

      let base = root;
      if (
        base === null ||
        base === undefined ||
        (typeof base !== 'object' && !Array.isArray(base))
      ) {
        base = isIndex ? [] : {};
      }

      const clone = Array.isArray(base) ? base.slice() : { ...base };
      clone[seg] = this.copyWithSet(clone[seg], rest, value);
      return clone;
    },

    /**
     * Record original value for reset
     * @param {object} instance - Vue component instance
     * @param {Array} path - Prop path
     * @param {boolean} existed - Whether the prop existed before
     * @param {*} value - Original value
     * @param {'props'|'attrs'} [targetKind] - Target container kind (for accurate reset)
     */
    recordOriginal(instance, path, existed, value, targetKind) {
      if (!this.overrideStore || !instance) return;

      try {
        const key = JSON.stringify(path);
        let store = this.overrideStore.get(instance);

        if (!store) {
          store = new Map();
          this.overrideStore.set(instance, store);
        }

        if (!store.has(key)) {
          store.set(key, { path, existed, value, targetKind });
        }
      } catch {
        // Best-effort
      }
    },

    /**
     * Get stored originals for instance
     */
    getOriginals(instance) {
      if (!this.overrideStore || !instance) return null;
      return this.overrideStore.get(instance) || null;
    },

    /**
     * Clear stored originals for instance
     */
    clearOriginals(instance) {
      if (!this.overrideStore || !instance) return;
      const store = this.overrideStore.get(instance);
      if (store) store.clear();
    },
  };

  // =============================================================================
  // Framework Detector
  // =============================================================================

  const FrameworkDetector = {
    /**
     * Detect framework for element (walks up DOM tree)
     */
    detect(element, maxDepth = 15) {
      let node = element;

      for (let depth = 0; depth < maxDepth && node; depth++) {
        // React first (more common)
        const fiber = ReactAdapter.findFiberFromDOM(node);
        if (fiber) {
          return { framework: 'react', node, data: fiber };
        }

        // Vue 3
        const vue = VueAdapter.findInstanceFromDOM(node);
        if (vue) {
          return { framework: 'vue', node, data: vue };
        }

        node = node.parentElement;
      }

      return { framework: 'unknown', node: null, data: null };
    },
  };

  // =============================================================================
  // Serializer
  // =============================================================================

  const Serializer = {
    /**
     * Check if value is a React element
     */
    isReactElement(value) {
      try {
        if (!value || typeof value !== 'object') return false;
        const t = value.$$typeof;
        if (!t) return false;

        if (typeof Symbol === 'function' && Symbol.for) {
          return (
            t === Symbol.for('react.element') ||
            t === Symbol.for('react.transitional.element') ||
            t === Symbol.for('react.portal')
          );
        }

        // Fallback heuristic
        return !!(value.type && value.props);
      } catch {
        return false;
      }
    },

    /**
     * Get React element display string
     */
    reactElementDisplay(value) {
      try {
        const type = value?.type;
        if (typeof type === 'string') return `<${type} />`;
        if (typeof type === 'function') {
          return `<${safeString(type.displayName || type.name) || 'Anonymous'} />`;
        }
        if (type && typeof type === 'object') {
          const name = safeString(type.displayName || type.name) || 'Anonymous';
          return `<${name} />`;
        }
      } catch {
        // ignore
      }
      return '<ReactElement />';
    },

    /**
     * Check if value is an editable primitive
     */
    isEditablePrimitive(value) {
      if (value === null || value === undefined) return true;
      const t = typeof value;
      if (t === 'string' || t === 'boolean') return true;
      if (t === 'number') return Number.isFinite(value);
      return false;
    },

    /**
     * Create serialization context for cycle detection
     */
    createContext() {
      return {
        seen: typeof WeakMap === 'function' ? new WeakMap() : null,
        nextId: 1,
      };
    },

    /**
     * Serialize a value with type information
     */
    serializeValue(value, ctx, depth = 0) {
      try {
        if (value === null) return { kind: 'null' };
        if (value === undefined) return { kind: 'undefined' };

        const t = typeof value;

        if (t === 'string') {
          if (value.length > SERIALIZE_LIMITS.maxStringLength) {
            return {
              kind: 'string',
              value: value.slice(0, SERIALIZE_LIMITS.maxStringLength),
              truncated: true,
              length: value.length,
            };
          }
          return { kind: 'string', value };
        }

        if (t === 'number') {
          if (Number.isFinite(value)) return { kind: 'number', value };
          if (Number.isNaN(value)) return { kind: 'number', special: 'NaN' };
          return { kind: 'number', special: value > 0 ? 'Infinity' : '-Infinity' };
        }

        if (t === 'boolean') return { kind: 'boolean', value };
        if (t === 'bigint') return { kind: 'bigint', value: value.toString() };
        if (t === 'symbol') return { kind: 'symbol', description: safeString(value) };
        if (t === 'function')
          return { kind: 'function', name: safeString(value.name) || undefined };

        // Object types
        if (this.isReactElement(value)) {
          return { kind: 'react_element', display: this.reactElementDisplay(value) };
        }

        if (typeof Element !== 'undefined' && value instanceof Element) {
          return {
            kind: 'dom_element',
            tagName: safeString(value.tagName).toLowerCase(),
            id: safeString(value.id) || undefined,
            className: safeString(value.className) || undefined,
          };
        }

        if (value instanceof Date) {
          let iso = '';
          try {
            iso = value.toISOString();
          } catch {
            iso = safeString(value);
          }
          return { kind: 'date', value: iso };
        }

        if (value instanceof RegExp) {
          return { kind: 'regexp', source: value.source, flags: value.flags };
        }

        if (value instanceof Error) {
          return {
            kind: 'error',
            name: safeString(value.name) || 'Error',
            message: safeString(value.message),
          };
        }

        // Depth limit
        if (depth >= SERIALIZE_LIMITS.maxDepth) {
          return {
            kind: 'max_depth',
            type: Object.prototype.toString.call(value),
            preview: safeString(value),
          };
        }

        // Circular reference detection
        if (ctx?.seen) {
          const existingId = ctx.seen.get(value);
          if (existingId) return { kind: 'circular', refId: existingId };
          ctx.seen.set(value, ctx.nextId++);
        }

        // Array
        if (Array.isArray(value)) {
          const max = Math.min(value.length, SERIALIZE_LIMITS.maxArrayLength);
          const items = [];
          for (let i = 0; i < max; i++) {
            items.push(this.serializeValue(value[i], ctx, depth + 1));
          }
          return {
            kind: 'array',
            length: value.length,
            truncated: value.length > max,
            items,
          };
        }

        // Map
        if (value instanceof Map) {
          const entries = [];
          let count = 0;
          for (const [k, v] of value.entries()) {
            if (count >= SERIALIZE_LIMITS.maxEntries) break;
            entries.push({
              key: this.serializeValue(k, ctx, depth + 1),
              value: this.serializeValue(v, ctx, depth + 1),
            });
            count++;
          }
          return {
            kind: 'map',
            size: value.size,
            truncated: value.size > count,
            entries,
          };
        }

        // Set
        if (value instanceof Set) {
          const items = [];
          let count = 0;
          for (const v of value.values()) {
            if (count >= SERIALIZE_LIMITS.maxEntries) break;
            items.push(this.serializeValue(v, ctx, depth + 1));
            count++;
          }
          return {
            kind: 'set',
            size: value.size,
            truncated: value.size > count,
            items,
          };
        }

        // Plain object
        const constructorName = value?.constructor?.name;
        const name = typeof constructorName === 'string' ? constructorName : undefined;
        const keys = Object.keys(value);
        const limitedKeys = keys.slice(0, SERIALIZE_LIMITS.maxEntries);
        const entries = limitedKeys.map((k) => ({
          key: k,
          value: this.serializeValue(value[k], ctx, depth + 1),
        }));

        return {
          kind: 'object',
          name: name !== 'Object' ? name : undefined,
          truncated: keys.length > limitedKeys.length,
          entries,
        };
      } catch (err) {
        return { kind: 'unknown', type: typeof value, preview: safeString(err) };
      }
    },

    /**
     * Serialize props object to structured format
     * @param {object} props - Props object to serialize
     * @param {Record<string, Array<string|number|boolean>>} [enumValuesByKey] - Optional enum values by prop key
     */
    serializeProps(props, enumValuesByKey) {
      const ctx = this.createContext();
      const entries = [];
      const enumMap = isObject(enumValuesByKey) ? enumValuesByKey : null;

      if (!props || (typeof props !== 'object' && typeof props !== 'function')) {
        return { kind: 'props', entries: [] };
      }

      const keys = Object.keys(props);
      const limited = keys.slice(0, SERIALIZE_LIMITS.maxEntries);

      for (const key of limited) {
        let raw;
        try {
          raw = props[key];
        } catch {
          raw = undefined;
        }

        const entry = {
          key,
          editable: this.isEditablePrimitive(raw),
          value: this.serializeValue(raw, ctx, 0),
        };

        // Attach enum values if available
        const enumValues = enumMap ? enumMap[key] : null;
        if (Array.isArray(enumValues) && enumValues.length > 0) {
          entry.enumValues = enumValues.slice(0, EnumIntrospection.MAX_ENUM_VALUES);
        }

        entries.push(entry);
      }

      const result = { kind: 'props', entries };
      if (keys.length > limited.length) result.truncated = true;
      return result;
    },
  };

  // =============================================================================
  // Enum Introspection (Best-effort)
  // =============================================================================

  /**
   * Best-effort enum value extraction from React/Vue runtime metadata.
   *
   * React: Relies on __docgenInfo (Storybook/react-docgen output)
   * Vue: Relies on explicit values/validator.values in props options
   */
  const EnumIntrospection = {
    MAX_ENUM_VALUES: 50,

    /**
     * Normalize a raw enum value to primitive
     */
    normalizeEnumValue(raw) {
      if (raw === null || raw === undefined) return null;

      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;

      const s = safeString(raw).trim();
      if (!s) return null;

      // Strip surrounding quotes: "'primary'" -> "primary"
      const m = s.match(/^(['"])(.*)\1$/);
      const unquoted = m ? m[2] : s;

      if (unquoted === 'true') return true;
      if (unquoted === 'false') return false;

      if (/^-?(?:\d+|\d*\.\d+)$/.test(unquoted)) {
        const n = Number(unquoted);
        if (Number.isFinite(n)) return n;
      }

      return unquoted;
    },

    /**
     * Normalize array of enum values, deduplicate
     */
    normalizeEnumList(list) {
      if (!Array.isArray(list)) return [];
      const out = [];
      const seen = new Set();

      for (const item of list) {
        const v = this.normalizeEnumValue(item);
        if (v === null) continue;
        const key =
          typeof v === 'string' ? `s:${v}` : typeof v === 'number' ? `n:${v}` : `b:${v ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(v);
        if (out.length >= this.MAX_ENUM_VALUES) break;
      }

      return out;
    },

    /**
     * Extract enum values from React docgen prop info
     * (e.g., from Storybook's __docgenInfo)
     */
    extractDocgenEnumValues(propInfo) {
      if (!isObject(propInfo)) return [];

      // Check type.name === 'enum' with type.value array
      const t = propInfo.type;
      if (isObject(t) && t.name === 'enum' && Array.isArray(t.value)) {
        const rawList = t.value.map((item) =>
          isObject(item) && 'value' in item ? item.value : item,
        );
        return this.normalizeEnumList(rawList);
      }

      // Check tsType for TypeScript enums
      const ts = propInfo.tsType;
      if (isObject(ts) && ts.name === 'union' && Array.isArray(ts.elements)) {
        const rawList = ts.elements.map((el) =>
          isObject(el) && 'value' in el ? el.value : el.name,
        );
        return this.normalizeEnumList(rawList);
      }

      return [];
    },

    /**
     * Get enum values map for React component
     */
    getReactEnumValues(componentFiber) {
      try {
        const type = componentFiber?.type || componentFiber?.elementType;
        if (!type) return {};

        const docgen = type.__docgenInfo;
        if (!isObject(docgen) || !isObject(docgen.props)) return {};

        const result = {};
        for (const [key, info] of Object.entries(docgen.props)) {
          const values = this.extractDocgenEnumValues(info);
          if (values.length > 0) result[key] = values;
        }
        return result;
      } catch {
        return {};
      }
    },

    /**
     * Extract enum values from Vue prop option
     */
    extractVuePropEnumValues(propOption) {
      if (!isObject(propOption)) return [];

      // Check explicit values array
      if (Array.isArray(propOption.values)) {
        return this.normalizeEnumList(propOption.values);
      }

      // Check validator with values/allowedValues
      const validator = propOption.validator;
      if (validator && Array.isArray(validator.values)) {
        return this.normalizeEnumList(validator.values);
      }
      if (validator && Array.isArray(validator.allowedValues)) {
        return this.normalizeEnumList(validator.allowedValues);
      }

      return [];
    },

    /**
     * Get enum values map for Vue component
     */
    getVueEnumValues(instance) {
      try {
        const propsOptions = instance?.type?.props;
        if (!isObject(propsOptions)) return {};

        const result = {};
        for (const [key, opt] of Object.entries(propsOptions)) {
          const values = this.extractVuePropEnumValues(opt);
          if (values.length > 0) result[key] = values;
        }
        return result;
      } catch {
        return {};
      }
    },
  };

  // =============================================================================
  // Value Access Helpers
  // =============================================================================

  function getValueAtPath(root, path) {
    let current = root;

    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      if (!isObject(current) && !Array.isArray(current)) {
        return { ok: false, existed: false, value: undefined };
      }

      const has = Object.prototype.hasOwnProperty.call(current, seg);
      current = current[seg];

      if (!has && i === path.length - 1) {
        return { ok: true, existed: false, value: undefined };
      }
    }

    return { ok: true, existed: true, value: current };
  }

  // Dangerous keys that could cause prototype pollution or unexpected behavior
  const DANGEROUS_KEYS = new Set([
    '__proto__',
    'constructor',
    'prototype',
    '__defineGetter__',
    '__defineSetter__',
    '__lookupGetter__',
    '__lookupSetter__',
  ]);

  function isDangerousKey(key) {
    return typeof key === 'string' && DANGEROUS_KEYS.has(key);
  }

  function normalizePropPath(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) return null;

    const result = [];
    for (const seg of value) {
      if (typeof seg === 'string') {
        const s = seg.trim();
        if (!s) return null;
        // Reject dangerous keys to prevent prototype pollution
        if (isDangerousKey(s)) return null;
        result.push(s);
      } else if (typeof seg === 'number' && Number.isInteger(seg) && seg >= 0 && seg <= 1e6) {
        result.push(seg);
      } else {
        return null;
      }
    }
    return result;
  }

  function decodeIncomingValue(raw) {
    // Bridge encodes undefined as { $we: 'undefined' }
    if (isObject(raw) && raw.$we === 'undefined') return undefined;
    return raw;
  }

  // =============================================================================
  // Capabilities Builder
  // =============================================================================

  function makeCapabilities(init) {
    return {
      canRead: Boolean(init?.canRead),
      canWrite: Boolean(init?.canWrite),
      canWriteHooks: Boolean(init?.canWriteHooks),
    };
  }

  function buildResponseData(init) {
    const data = {};
    if (init?.hookStatus) data.hookStatus = init.hookStatus;
    if (typeof init?.needsRefresh === 'boolean') data.needsRefresh = init.needsRefresh;
    if (init?.framework) data.framework = init.framework;
    if (init?.frameworkVersion) data.frameworkVersion = init.frameworkVersion;
    if (init?.componentName) data.componentName = init.componentName;
    if (init?.debugSource) data.debugSource = init.debugSource;
    if (init?.props) data.props = init.props;
    if (init?.capabilities) data.capabilities = init.capabilities;
    if (init?.meta) data.meta = init.meta;
    return data;
  }

  // =============================================================================
  // Request Handlers
  // =============================================================================

  const Handlers = {
    resolveTarget(locator) {
      if (!locator) return null;
      const el = Locator.locate(locator, document);
      // Return element if connected to DOM; otherwise return null
      return el?.isConnected ? el : null;
    },

    /**
     * Handle 'probe' operation - Detect capabilities without reading props
     */
    handleProbe(req) {
      // Check initial hook status
      const preStatus = ReactAdapter.detectStatus();
      const initialHookStatus = preStatus.hookStatus;

      // Try to install hook if missing (only helps if React hasn't initialized)
      if (initialHookStatus === HOOK_STATUS.HOOK_MISSING) {
        ReactAdapter.installMinimalHook();
      }

      const hookInfo = ReactAdapter.detectStatus();
      // Report original status if hook was missing (so UI knows refresh is needed)
      const hookStatus =
        initialHookStatus === HOOK_STATUS.HOOK_MISSING
          ? HOOK_STATUS.HOOK_MISSING
          : hookInfo.hookStatus;

      const target = this.resolveTarget(req.locator);
      const fw = target ? FrameworkDetector.detect(target) : { framework: 'unknown', data: null };

      let componentName;
      let debugSource;
      let canRead = false;
      let canWrite = false;
      let needsRefresh = false;

      let frameworkVersion;

      if (fw.framework === 'react') {
        const fiberInfo = ReactAdapter.resolveFiberWithRenderer(target, hookInfo);
        const componentFiber = fiberInfo.fiber
          ? ReactAdapter.findNearestComponentFiber(fiberInfo.fiber)
          : null;

        componentName = componentFiber ? ReactAdapter.getComponentName(componentFiber) : undefined;
        // Extract debug source from component fiber or raw fiber
        const sourceFiber = componentFiber || fiberInfo.fiber;
        debugSource = sourceFiber ? ReactAdapter.getDebugSource(sourceFiber) : undefined;
        // Pass specific renderer to prioritize its version in multi-renderer scenarios
        frameworkVersion = ReactAdapter.getVersion(hookInfo, fiberInfo.renderer);
        canRead = Boolean(componentFiber);
        canWrite = hookStatus === HOOK_STATUS.READY && Boolean(componentFiber);
        needsRefresh = canRead && hookStatus !== HOOK_STATUS.READY;
      } else if (fw.framework === 'vue') {
        const instance = fw.data;
        componentName = VueAdapter.getComponentName(instance);
        debugSource = instance ? VueAdapter.getDebugSource(instance, target) : undefined;
        frameworkVersion = VueAdapter.getVersion(instance);
        canRead = Boolean(instance);
        canWrite = Boolean(instance) && VueAdapter.isDevBuild(instance);
        needsRefresh = false;
      }

      const data = buildResponseData({
        hookStatus,
        framework: fw.framework,
        frameworkVersion,
        componentName,
        debugSource,
        capabilities: makeCapabilities({ canRead, canWrite, canWriteHooks: false }),
        needsRefresh,
      });

      return Transport.createResponse(req.requestId, true, data);
    },

    /**
     * Handle 'read' operation - Read component props
     */
    handleRead(req) {
      const target = this.resolveTarget(req.locator);
      if (!target) {
        return Transport.createResponse(
          req.requestId,
          false,
          undefined,
          'Target element not found',
        );
      }

      const preStatus = ReactAdapter.detectStatus();
      if (preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING) {
        ReactAdapter.installMinimalHook();
      }

      const hookInfo = ReactAdapter.detectStatus();
      const hookStatus =
        preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING
          ? HOOK_STATUS.HOOK_MISSING
          : hookInfo.hookStatus;

      const fw = FrameworkDetector.detect(target);

      if (fw.framework === 'react') {
        const fiberInfo = ReactAdapter.resolveFiberWithRenderer(target, hookInfo);
        const componentFiber = fiberInfo.fiber
          ? ReactAdapter.findNearestComponentFiber(fiberInfo.fiber)
          : null;

        // Extract debug source even if component fiber not found
        const sourceFiber = componentFiber || fiberInfo.fiber;
        const debugSource = sourceFiber ? ReactAdapter.getDebugSource(sourceFiber) : undefined;
        // Pass specific renderer to prioritize its version in multi-renderer scenarios
        const frameworkVersion = ReactAdapter.getVersion(hookInfo, fiberInfo.renderer);

        if (!componentFiber) {
          const data = buildResponseData({
            hookStatus,
            framework: 'react',
            frameworkVersion,
            debugSource,
            capabilities: makeCapabilities({ canRead: false, canWrite: false }),
            needsRefresh: false,
          });
          return Transport.createResponse(
            req.requestId,
            false,
            data,
            'React component fiber not found',
          );
        }

        const props = componentFiber.memoizedProps;
        const enumValuesByKey = EnumIntrospection.getReactEnumValues(componentFiber);
        const serialized = Serializer.serializeProps(props, enumValuesByKey);
        const componentName = ReactAdapter.getComponentName(componentFiber);
        const canWrite = hookStatus === HOOK_STATUS.READY;
        const needsRefresh = hookStatus !== HOOK_STATUS.READY;

        const data = buildResponseData({
          hookStatus,
          framework: 'react',
          frameworkVersion,
          componentName,
          debugSource,
          props: serialized,
          capabilities: makeCapabilities({ canRead: true, canWrite, canWriteHooks: false }),
          needsRefresh,
        });

        return Transport.createResponse(req.requestId, true, data);
      }

      if (fw.framework === 'vue') {
        const instance = fw.data;
        const frameworkVersion = VueAdapter.getVersion(instance);

        if (!instance) {
          const data = buildResponseData({
            hookStatus,
            framework: 'vue',
            frameworkVersion,
            capabilities: makeCapabilities({ canRead: false, canWrite: false }),
            needsRefresh: false,
          });
          return Transport.createResponse(
            req.requestId,
            false,
            data,
            'Vue component instance not found',
          );
        }

        const componentName = VueAdapter.getComponentName(instance);
        const debugSource = VueAdapter.getDebugSource(instance, target);

        // Read both props and attrs
        let rootProps = null;
        let rootAttrs = null;
        try {
          rootProps = instance.props;
        } catch {
          rootProps = null;
        }
        try {
          rootAttrs = instance.attrs;
        } catch {
          rootAttrs = null;
        }

        // Serialize props with enum introspection
        const enumValuesByKey = EnumIntrospection.getVueEnumValues(instance);
        const serializedProps = Serializer.serializeProps(rootProps, enumValuesByKey);
        const serializedAttrs = Serializer.serializeProps(rootAttrs, null);

        // Merge entries with source annotation
        const mergedEntries = [];
        if (Array.isArray(serializedProps.entries)) {
          for (const entry of serializedProps.entries) {
            mergedEntries.push({ ...entry, source: 'props' });
          }
        }
        if (Array.isArray(serializedAttrs.entries)) {
          for (const entry of serializedAttrs.entries) {
            mergedEntries.push({ ...entry, source: 'attrs' });
          }
        }

        const serialized = {
          kind: 'props',
          entries: mergedEntries,
        };
        if (serializedProps.truncated || serializedAttrs.truncated) {
          serialized.truncated = true;
        }

        const canWrite = VueAdapter.isDevBuild(instance);

        const data = buildResponseData({
          hookStatus,
          framework: 'vue',
          frameworkVersion,
          componentName,
          debugSource,
          props: serialized,
          capabilities: makeCapabilities({ canRead: true, canWrite, canWriteHooks: false }),
          needsRefresh: false,
        });

        return Transport.createResponse(req.requestId, true, data);
      }

      // Unknown framework
      const data = buildResponseData({
        hookStatus,
        framework: 'unknown',
        capabilities: makeCapabilities({ canRead: false, canWrite: false }),
        needsRefresh: false,
      });

      return Transport.createResponse(req.requestId, false, data, 'Not a React/Vue component');
    },

    /**
     * Handle 'write' operation - Modify component props
     */
    handleWrite(req) {
      const target = this.resolveTarget(req.locator);
      if (!target) {
        return Transport.createResponse(
          req.requestId,
          false,
          undefined,
          'Target element not found',
        );
      }

      const path = normalizePropPath(req.payload?.propPath);
      if (!path) {
        return Transport.createResponse(req.requestId, false, undefined, 'Invalid propPath');
      }

      const rawValue = req.payload?.propValue;
      const value = decodeIncomingValue(rawValue);
      if (!Serializer.isEditablePrimitive(value)) {
        return Transport.createResponse(
          req.requestId,
          false,
          undefined,
          'Only primitive prop values are supported',
        );
      }

      const preStatus = ReactAdapter.detectStatus();
      if (preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING) {
        ReactAdapter.installMinimalHook();
      }

      const hookInfo = ReactAdapter.detectStatus();
      const hookStatus =
        preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING
          ? HOOK_STATUS.HOOK_MISSING
          : hookInfo.hookStatus;

      const fw = FrameworkDetector.detect(target);

      if (fw.framework === 'react') {
        const fiberInfo = ReactAdapter.resolveFiberWithRenderer(target, hookInfo);
        const componentFiber = fiberInfo.fiber
          ? ReactAdapter.findNearestComponentFiber(fiberInfo.fiber)
          : null;

        const componentName = componentFiber
          ? ReactAdapter.getComponentName(componentFiber)
          : undefined;
        const canRead = Boolean(componentFiber);
        const canWrite = hookStatus === HOOK_STATUS.READY && Boolean(componentFiber);
        const needsRefresh = canRead && hookStatus !== HOOK_STATUS.READY;

        const base = buildResponseData({
          hookStatus,
          framework: 'react',
          componentName,
          capabilities: makeCapabilities({ canRead, canWrite, canWriteHooks: false }),
          needsRefresh,
        });

        if (!componentFiber) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'React component fiber not found',
          );
        }

        if (hookStatus !== HOOK_STATUS.READY) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'React DevTools editing API unavailable. Use a Development build and refresh the page.',
          );
        }

        // Check current value for editability and record original
        const props = componentFiber.memoizedProps;
        const read = getValueAtPath(props, path);
        if (read.ok && read.existed && !Serializer.isEditablePrimitive(read.value)) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Target prop is not a primitive (read-only)',
          );
        }

        // Try renderers with overrideProps
        const candidates = (hookInfo.editableRenderers || [])
          .map((r) => r.renderer)
          .filter(Boolean);
        const preferred =
          fiberInfo.renderer && typeof fiberInfo.renderer.overrideProps === 'function'
            ? fiberInfo.renderer
            : null;
        const ordered = preferred
          ? [preferred, ...candidates.filter((r) => r !== preferred)]
          : candidates;

        let usedRenderer = null;
        let lastErr = null;

        for (const renderer of ordered) {
          try {
            renderer.overrideProps(componentFiber, path, value);
            usedRenderer = renderer;
            break;
          } catch (err) {
            lastErr = err;
          }
        }

        if (!usedRenderer) {
          base.meta = { write: { method: 'overrideProps', error: safeString(lastErr) } };
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Failed to write props via overrideProps',
          );
        }

        ReactAdapter.recordOriginal(componentFiber, usedRenderer, path, read.existed, read.value);
        base.meta = { write: { method: 'overrideProps' } };

        return Transport.createResponse(req.requestId, true, base);
      }

      if (fw.framework === 'vue') {
        const instance = fw.data;
        const componentName = VueAdapter.getComponentName(instance);
        const canRead = Boolean(instance);
        const canWrite = Boolean(instance) && VueAdapter.isDevBuild(instance);

        const base = buildResponseData({
          hookStatus,
          framework: 'vue',
          componentName,
          capabilities: makeCapabilities({ canRead, canWrite, canWriteHooks: false }),
          needsRefresh: false,
        });

        if (!instance) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Vue component instance not found',
          );
        }

        if (!VueAdapter.isDevBuild(instance)) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Vue dev metadata missing. Use a Development build.',
          );
        }

        // Vue props keys must be strings at top level
        if (typeof path[0] !== 'string') {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Vue propPath must start with a string key',
          );
        }

        const propName = path[0];
        const subPath = path.slice(1);

        // Infer target kind based on whether key is declared prop
        const targetKind = VueAdapter.isDeclaredProp(instance, propName) ? 'props' : 'attrs';

        // Check current value from logical root
        const readRoot = VueAdapter.getReadRoot(instance, targetKind) || {};
        const read = getValueAtPath(readRoot, path);
        if (read.ok && read.existed && !Serializer.isEditablePrimitive(read.value)) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Target prop is not a primitive (read-only)',
          );
        }

        // Build next vnode props (the correct way to update Vue3 props)
        const currentRawProps = VueAdapter.getVNodeProps(instance) || {};
        const nextRawProps = { ...currentRawProps };

        try {
          if (subPath.length === 0) {
            nextRawProps[propName] = value;
          } else {
            const prev = nextRawProps[propName];
            nextRawProps[propName] = VueAdapter.copyWithSet(prev, subPath, value);
          }
        } catch (err) {
          base.meta = {
            write: { method: 'vueNextVNode', target: targetKind, error: safeString(err) },
          };
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Failed to build Vue props patch',
          );
        }

        // Apply via instance.next + update() to trigger Vue's internal updateProps pipeline
        if (!VueAdapter.applyNextProps(instance, nextRawProps)) {
          base.meta = {
            write: { method: 'vueNextVNode', target: targetKind, error: 'No update method' },
          };
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Vue update method not available',
          );
        }

        // Record original for reset only after successful write (include targetKind for accurate reset)
        VueAdapter.recordOriginal(instance, path, read.existed, read.value, targetKind);

        base.meta = { write: { method: 'vueNextVNode', target: targetKind } };
        return Transport.createResponse(req.requestId, true, base);
      }

      return Transport.createResponse(req.requestId, false, undefined, 'Not a React/Vue component');
    },

    /**
     * Handle 'reset' operation - Restore original props values
     */
    handleReset(req) {
      const target = this.resolveTarget(req.locator);
      if (!target) {
        return Transport.createResponse(
          req.requestId,
          false,
          undefined,
          'Target element not found',
        );
      }

      const preStatus = ReactAdapter.detectStatus();
      if (preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING) {
        ReactAdapter.installMinimalHook();
      }

      const hookInfo = ReactAdapter.detectStatus();
      const hookStatus =
        preStatus.hookStatus === HOOK_STATUS.HOOK_MISSING
          ? HOOK_STATUS.HOOK_MISSING
          : hookInfo.hookStatus;

      const fw = FrameworkDetector.detect(target);

      if (fw.framework === 'react') {
        const fiberInfo = ReactAdapter.resolveFiberWithRenderer(target, hookInfo);
        const componentFiber = fiberInfo.fiber
          ? ReactAdapter.findNearestComponentFiber(fiberInfo.fiber)
          : null;

        const componentName = componentFiber
          ? ReactAdapter.getComponentName(componentFiber)
          : undefined;
        const canRead = Boolean(componentFiber);
        const canWrite = hookStatus === HOOK_STATUS.READY && Boolean(componentFiber);
        const needsRefresh = canRead && hookStatus !== HOOK_STATUS.READY;

        const base = buildResponseData({
          hookStatus,
          framework: 'react',
          componentName,
          capabilities: makeCapabilities({ canRead, canWrite, canWriteHooks: false }),
          needsRefresh,
        });

        if (!componentFiber) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'React component fiber not found',
          );
        }

        const store = ReactAdapter.getOriginals(componentFiber);
        if (!store?.originals?.size) {
          base.meta = { reset: { method: 'refresh', reason: 'noOverrides' } };
          base.needsRefresh = true;
          return Transport.createResponse(req.requestId, true, base);
        }

        if (hookStatus !== HOOK_STATUS.READY) {
          base.meta = { reset: { method: 'refresh', reason: 'hookNotReady' } };
          base.needsRefresh = true;
          return Transport.createResponse(req.requestId, true, base);
        }

        const renderer = store.renderer;
        if (!renderer || typeof renderer.overrideProps !== 'function') {
          base.meta = { reset: { method: 'refresh', reason: 'missingRenderer' } };
          base.needsRefresh = true;
          return Transport.createResponse(req.requestId, true, base);
        }

        let reverted = 0;
        for (const entry of store.originals.values()) {
          try {
            renderer.overrideProps(componentFiber, entry.path, entry.value);
            reverted++;
          } catch {
            // Continue reverting others
          }
        }

        ReactAdapter.clearOriginals(componentFiber);
        base.meta = { reset: { method: 'overrideProps', reverted } };

        return Transport.createResponse(req.requestId, true, base);
      }

      if (fw.framework === 'vue') {
        const instance = fw.data;
        const componentName = VueAdapter.getComponentName(instance);
        const canRead = Boolean(instance);
        const canWrite = Boolean(instance) && VueAdapter.isDevBuild(instance);

        const base = buildResponseData({
          hookStatus,
          framework: 'vue',
          componentName,
          capabilities: makeCapabilities({ canRead, canWrite, canWriteHooks: false }),
          needsRefresh: false,
        });

        if (!instance) {
          return Transport.createResponse(
            req.requestId,
            false,
            base,
            'Vue component instance not found',
          );
        }

        const store = VueAdapter.getOriginals(instance);
        if (!store?.size) {
          base.meta = { reset: { method: 'refresh', reason: 'noOverrides' } };
          base.needsRefresh = true;
          return Transport.createResponse(req.requestId, true, base);
        }

        // Build next vnode props with all originals restored
        const currentRawProps = VueAdapter.getVNodeProps(instance) || {};
        const nextRawProps = { ...currentRawProps };

        let reverted = 0;
        for (const entry of store.values()) {
          const path = entry.path;
          if (!Array.isArray(path) || typeof path[0] !== 'string') continue;

          const propName = path[0];
          const subPath = path.slice(1);

          try {
            if (subPath.length === 0) {
              if (entry.existed) {
                nextRawProps[propName] = entry.value;
              } else {
                delete nextRawProps[propName];
              }
            } else {
              const prev = nextRawProps[propName];
              nextRawProps[propName] = VueAdapter.copyWithSet(prev, subPath, entry.value);
            }
            reverted++;
          } catch {
            // Continue with other entries
          }
        }

        // Apply via instance.next + update() to trigger Vue's internal updateProps pipeline
        if (!VueAdapter.applyNextProps(instance, nextRawProps)) {
          base.meta = { reset: { method: 'refresh', reason: 'noUpdate' } };
          base.needsRefresh = true;
          return Transport.createResponse(req.requestId, true, base);
        }

        VueAdapter.clearOriginals(instance);
        base.meta = { reset: { method: 'vueNextVNode', reverted } };

        return Transport.createResponse(req.requestId, true, base);
      }

      return Transport.createResponse(req.requestId, false, undefined, 'Not a React/Vue component');
    },

    /**
     * Handle 'cleanup' operation - Dispose agent
     */
    handleCleanup(req) {
      const resp = Transport.createResponse(req.requestId, true, {
        meta: { cleanup: { ok: true } },
      });
      Lifecycle.dispose('request');
      return resp;
    },

    /**
     * Route request to appropriate handler
     */
    handle(req) {
      switch (req.op) {
        case 'probe':
          return this.handleProbe(req);
        case 'read':
          return this.handleRead(req);
        case 'write':
          return this.handleWrite(req);
        case 'reset':
          return this.handleReset(req);
        case 'cleanup':
          return this.handleCleanup(req);
        default:
          return Transport.createResponse(
            req.requestId,
            false,
            undefined,
            `Unsupported op: ${safeString(req.op)}`,
          );
      }
    },
  };

  // =============================================================================
  // Lifecycle Management
  // =============================================================================

  const Lifecycle = {
    disposed: false,

    onRequestEvent(event) {
      try {
        if (Lifecycle.disposed) return;

        const detail = event?.detail;
        const req = Transport.normalizeRequest(detail);
        if (!req) return;

        const resp = Handlers.handle(req);
        Transport.dispatchResponse(resp);
      } catch (err) {
        try {
          const requestId = event?.detail?.requestId;
          if (typeof requestId === 'string' && requestId) {
            Transport.dispatchResponse(
              Transport.createResponse(requestId, false, undefined, safeString(err)),
            );
          }
        } catch {
          // ignore
        }
      }
    },

    onCleanupEvent() {
      Lifecycle.dispose('external-event');
    },

    dispose(reason) {
      if (this.disposed) return;
      this.disposed = true;

      try {
        window.removeEventListener(EVENT_NAME.REQUEST, this.onRequestEvent, true);
        window.removeEventListener(EVENT_NAME.CLEANUP, this.onCleanupEvent, true);
      } catch {
        // ignore
      }

      try {
        delete window[GLOBAL_KEY];
      } catch {
        // ignore
      }

      if (reason) {
        logWarn('Disposed:', reason);
      }
    },

    init() {
      // Use capture phase to avoid page stopPropagation interfering
      window.addEventListener(EVENT_NAME.REQUEST, this.onRequestEvent, true);
      window.addEventListener(EVENT_NAME.CLEANUP, this.onCleanupEvent, true);

      window[GLOBAL_KEY] = {
        version: PROTOCOL_VERSION,
        dispose: () => this.dispose('manual'),
      };

      // Early injection: install minimal hook before React loads (document_start)
      // This is critical for capturing React renderers that initialize early
      if (document.readyState === 'loading') {
        try {
          const status = ReactAdapter.detectStatus();
          if (status.hookStatus === HOOK_STATUS.HOOK_MISSING) {
            ReactAdapter.installMinimalHook();
            logWarn('Installed minimal hook during early injection');
          }
        } catch (err) {
          // Best-effort: early injection may fail in some environments
          logWarn('Early hook injection failed:', err);
        }
      }
    },
  };

  // Initialize
  Lifecycle.init();
})();
