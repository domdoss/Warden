/* ==========================================================================
   Memory Galaxy — three.js brain, mounted into the SPA's #galaxy-host.
   --------------------------------------------------------------------------
   Ported from memory-galaxy.html (zero iframes). The scene, layout, shaders,
   brain-scan flares and activity polling are the same; what changed is the
   host: sizes come from the container instead of the window, UI lives in the
   SPA's own nodes, and the API is window.MemoryGalaxy.mount(...) instead of
   DOMContentLoaded.

   THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass,
   OrbitControls and RoomEnvironment are globals from
   marm-memory-map/bundle.js, which app.js loads lazily right before this file.
   ========================================================================== */
(function () {
  'use strict';

  var ctl = { active: false };
  var mounted = null;      // { start, stop, reset, home } once the scene is up

  /* ------------------------------------------------------------------ */
  /* Warden data access                                                  */
  /* ------------------------------------------------------------------ */
  var WARDEN_BASE = 'http://127.0.0.1:3200';

  // Embedded in the pywebview voice window, fetch() from a file:// page to
  // :3200 can be refused — route through the bridge's warden_api proxy
  // (returns the raw body string, '' on error). Standalone browser runs fall
  // back to a direct fetch; the status server sends CORS headers.
  function wardenGet(path) {
    var api = window.pywebview && window.pywebview.api;
    if (api && typeof api.warden_api === 'function') {
      return Promise.resolve(api.warden_api(path, 'GET', ''));
    }
    return fetch(WARDEN_BASE + path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  async function fetchTaxonomy() {
    var text = await wardenGet('/api/memory-tree');
    if (!text) throw new Error('empty response from /api/memory-tree');
    var data = JSON.parse(text);
    if (!data || !Array.isArray(data.roots) || !data.roots.length) {
      throw new Error('taxonomy has no roots');
    }
    return data;   // { roots, facts }
  }

  async function fetchActivity() {
    var text = await wardenGet('/api/memory-tree/activity');
    if (!text) throw new Error('empty response from /api/memory-tree/activity');
    var data = JSON.parse(text);
    return { events: Array.isArray(data.events) ? data.events : [], running: !!data.running };
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */
  window.MemoryGalaxy = {
    mount: function (hostEl) { return doMount(hostEl); },
    setActive: function (on) {
      ctl.active = !!on;
      if (!mounted) return;
      if (ctl.active) mounted.start();
      else mounted.stop();
    },
    resetView: function () {
      if (mounted) mounted.reset();
    },
    isMounted: function () { return !!mounted; },
  };

  /* ------------------------------------------------------------------ */
  /* Scene                                                               */
  /* ------------------------------------------------------------------ */
  async function doMount(hostEl) {
    if (mounted) { window.MemoryGalaxy.setActive(true); return; }

    if (!hostEl) throw new Error('galaxy host element not found');
    if (typeof THREE === 'undefined') {
      throw new Error('THREE is not defined — marm-memory-map/bundle.js failed to load.');
    }
    if (typeof EffectComposer === 'undefined' ||
        typeof OrbitControls === 'undefined' ||
        typeof RoomEnvironment === 'undefined') {
      throw new Error('three.js addons missing — EffectComposer / OrbitControls / RoomEnvironment not found in bundle.js.');
    }

    var sceneEl = document.getElementById('galaxy-scene') || hostEl;

    function SW() { return Math.max(1, hostEl.clientWidth || 800); }
    function SH() { return Math.max(1, hostEl.clientHeight || 600); }

    // ---------- The brain: taxonomy + fact index ----------
    // The STRUCTURE comes from Warden (data/memory-tree.json, served at
    // :3200/api/memory-tree). The DETAILS are the memory_tree_facts index
    // carried in the same response, so every star lights from ONE request.
    var seed = 1337;
    function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

    var SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'at', 'by',
      'for', 'to', 'and', 'or', 'vs', 'with', 'from', 'into', 'over', 'under']);

    function prettyLabel(raw) {
      var l = String(raw == null ? '' : raw)
        .replace(/\s+/g, ' ')
        .replace(/^[\s"'`]+/, '')
        .replace(/[\s"'`]+$/, '')
        .replace(/[\s:,;.]+$/, '')
        .trim();
      if (!l) return '';
      if (l === l.toLowerCase() && /[a-z]/.test(l)) {
        if (l.indexOf(' ') === -1 && l.length <= 5 && (l.match(/[aeiouy]/g) || []).length <= 1) {
          return l.toUpperCase();
        }
        return l.split(' ').map(function (w, i) {
          return (SMALL_WORDS.has(w) && i > 0) ? w : w.charAt(0).toUpperCase() + w.slice(1);
        }).join(' ');
      }
      return l;
    }

    function buildTree(roots) {
      var out = [];
      function walk(nd, parentIdx, depth, prefix, rootIdx) {
        var p = prefix ? prefix + ' > ' + nd.n : nd.n;
        var idx = out.length;
        out.push({
          id: idx, label: prettyLabel(nd.n) || nd.n, path: p, query: nd.q || p,
          parent: parentIdx, depth: depth, rootIdx: rootIdx,
          children: [], mention_count: 0, memories: null,
        });
        if (parentIdx != null) out[parentIdx].children.push(idx);
        (nd.c || []).forEach(function (ch) { walk(ch, idx, depth + 1, p, rootIdx); });
      }
      roots.forEach(function (r, ri) { walk(r, null, 0, '', ri); });
      return out;
    }

    var nodes;
    var bootFacts = [];
    try {
      var tax = await fetchTaxonomy();
      nodes = buildTree(tax.roots);
      bootFacts = Array.isArray(tax.facts) ? tax.facts : [];
    } catch (e) {
      throw new Error('Memory tree unavailable: ' + ((e && e.message) || e) +
        '\n\nWarden serves the taxonomy at ' + WARDEN_BASE + '/api/memory-tree — check warden.service.');
    }

    // Distribute the server's fact index over the tree (exact node + all
    // ancestors roll up). Pure data, so it can run before the geometry.
    function distributeFacts(facts) {
      var byPath = new Map();
      for (var i = 0; i < nodes.length; i++) byPath.set(nodes[i].path, i);
      for (var a = 0; a < nodes.length; a++) { nodes[a].memories = []; nodes[a].mention_count = 0; }
      for (var f = 0; f < facts.length; f++) {
        var fact = facts[f];
        var idx = byPath.get(String(fact.path || ''));
        if (idx == null) continue;   // path no longer in the taxonomy
        var m = { fact: fact.fact, ts: fact.ts, path: fact.path };
        for (var n = idx; n != null; n = nodes[n].parent) {
          var nd = nodes[n];
          if (nd.memories.length < 12) nd.memories.push(m);
          nd.mention_count++;
        }
      }
    }

    // The nucleus: center of the brain. Every root branches off it.
    var NU = nodes.length;
    nodes.push({
      id: NU, label: 'Memory Nucleus', path: '', query: '',
      parent: null, depth: -1, rootIdx: -1,
      children: [], mention_count: 4096, memories: null,
    });
    nodes[NU].children = nodes.filter(function (n) { return n.depth === 0; }).map(function (n) { return n.id; });
    distributeFacts(bootFacts);

    // Edges: parent→child streams + root→nucleus spokes.
    var adj = nodes.map(function () { return []; });
    nodes.forEach(function (n, i) {
      if (n.parent != null) {
        adj[n.parent].push({ j: i, weight: 0.6 });
        adj[i].push({ j: n.parent, weight: 0.6 });
      }
      if (n.depth === 0) {
        adj[i].push({ j: NU, weight: 0.85 });
        adj[NU].push({ j: i, weight: 0.85 });
      }
      n.degree = adj[i].length;
    });
    var N = nodes.length;  // tree nodes + nucleus

    window.__galaxyGraph = {
      source: 'memory tree',
      labels: nodes.slice(0, NU).map(function (n) { return n.path; }),
      mentions: nodes.slice(0, NU).map(function (n) { return n.mention_count; }),
    };

    // ---------- Knowledge-tree layout ----------
    var ROOT_N = nodes.reduce(function (s, n) { return s + (n.depth === 0 ? 1 : 0); }, 0);
    function fibDir(k, M) {
      var ga = Math.PI * (3 - Math.sqrt(5));
      var y = 1 - (2 * k + 1) / M;
      var r = Math.sqrt(Math.max(0, 1 - y * y));
      var th = ga * k;
      return new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r).normalize();
    }
    function jit(i, s, ch) {
      var x = (i * 374761393 + s * 668265263 + ch * 2246822519) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
      return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    }
    var DEPTH_R = [74, 118, 152];
    function branchDir(i) {
      var nd = nodes[i];
      var rootDir = fibDir(nd.rootIdx, ROOT_N);
      if (nd.depth === 0) return rootDir;
      if (nd.depth === 1) return rootDir.clone().lerp(fibDir(i, NU), 0.42).normalize();
      return branchDir(nd.parent).lerp(fibDir(i, NU), 0.5).normalize();
    }
    function position(i, shSeed) {
      if (i === NU) return new THREE.Vector3(0, 0, 0);
      var nd = nodes[i];
      var R = DEPTH_R[Math.min(nd.depth, DEPTH_R.length - 1)];
      var amp = nd.depth === 0 ? 5 : 7;
      var dir = nd.depth === 0 ? fibDir(nd.rootIdx, ROOT_N) : branchDir(i);
      return dir.clone().multiplyScalar(R).add(new THREE.Vector3(
        (jit(i, shSeed, 1) - 0.5) * amp,
        (jit(i, shSeed, 2) - 0.5) * amp,
        (jit(i, shSeed, 3) - 0.5) * amp
      ));
    }
    var positions = nodes.map(function (_, i) { return position(i, 0); });
    positions[NU] = new THREE.Vector3(0, 0, 0);

    // ---------- Auto-shuffle ----------
    var SHUFFLE_INTERVAL = 36;
    var SHUFFLE_DURATION = 4.2;
    var shuffleSeed = 0;
    var shuffleT0 = -1;
    var nextShuffleAt = SHUFFLE_INTERVAL;
    var fromPos = positions.map(function (p) { return p.clone(); });
    var toPos = positions.map(function (p) { return p.clone(); });

    function beginShuffle(now) {
      shuffleSeed++;
      for (var i = 0; i < nodes.length; i++) {
        fromPos[i].copy(positions[i]);
        toPos[i].copy(position(i, shuffleSeed));
      }
      toPos[NU].set(0, 0, 0);
      shuffleT0 = now;
    }

    // ---------- Scene ----------
    var scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020308);
    scene.fog = new THREE.FogExp2(0x020308, 0.0015);

    var camera = new THREE.PerspectiveCamera(58, SW() / SH(), 0.1, 6000);
    camera.position.set(0, 42, 235);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(SW(), SH());
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    sceneEl.appendChild(renderer.domElement);

    var pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;

    // Controlled bloom — wide radius so the mip chain stays round.
    var composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    var bloom = new UnrealBloomPass(
      new THREE.Vector2(SW(), SH()),
      0.38,   // strength
      0.85,   // radius
      0.8     // threshold
    );
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    if (composer.setPixelRatio) composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    composer.setSize(SW(), SH());

    var controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.048;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.32;
    controls.minDistance = 24;
    controls.maxDistance = 700;

    // ---------- Textures ----------
    function makeGlowTexture() {
      var c = document.createElement('canvas');
      c.width = c.height = 128;
      var ctx = c.getContext('2d');
      var g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      g.addColorStop(0.0, 'rgba(255,255,255,1)');
      g.addColorStop(0.22, 'rgba(255,255,255,0.88)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.25)');
      g.addColorStop(1.0, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(c);
    }
    var glowTex = makeGlowTexture();

    function makeFlareTexture() {
      var c = document.createElement('canvas');
      c.width = c.height = 256;
      var ctx = c.getContext('2d');
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(128, 128, 0, 128, 128, 42);
      g.addColorStop(0, 'rgba(255,255,255,0.98)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 256);
      function streak(x0, y0, x1, y1, w, a) {
        var lg = ctx.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, 'rgba(255,255,255,' + a + ')');
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        var len = Math.hypot(x1 - x0, y1 - y0);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
        ctx.fillRect(-len / 2, -w / 2, len, w);
        ctx.restore();
      }
      streak(8, 128, 248, 128, 5.5, 0.85);
      streak(8, 128, 248, 128, 1.8, 0.6);
      streak(128, 12, 128, 244, 3.2, 0.55);
      streak(40, 40, 216, 216, 1.6, 0.35);
      streak(216, 40, 40, 216, 1.6, 0.35);
      return new THREE.CanvasTexture(c);
    }
    var flareTex = makeFlareTexture();

    // ---------- Deep space backdrop ----------
    var starGroup = new THREE.Group();
    scene.add(starGroup);

    function makeStars(count, rMin, rMax, size, opacity, palette) {
      var pos = new Float32Array(count * 3);
      var col = new Float32Array(count * 3);
      var c = new THREE.Color();
      for (var i = 0; i < count; i++) {
        var r = rMin + rnd() * (rMax - rMin);
        var th = rnd() * Math.PI * 2;
        var ph = Math.acos(2 * rnd() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
        c.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.35 + rnd() * 0.45);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      var m = new THREE.PointsMaterial({
        size: size, map: glowTex, vertexColors: true, transparent: true, opacity: opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
      });
      var pts = new THREE.Points(g, m);
      starGroup.add(pts);
      return pts;
    }

    var farStars = makeStars(3800, 900, 2100, 2.9, 0.58, [0xa8c4ff, 0x8ba8ff, 0xd0b8ff, 0x9aeeff, 0xffd6ec, 0xfff0d0]);
    var midStars = makeStars(900, 320, 820, 1.85, 0.42, [0x9ab8ff, 0xb0c8ff, 0xe8f0ff, 0xc8d8ff]);
    makeStars(400, 180, 420, 1.2, 0.28, [0x7a9cff, 0xa0b8ff, 0xd0e0ff]);

    // Twinkling stars (shader)
    function makeTwinkleStars(count, rMin, rMax, size, opacity) {
      var pos = new Float32Array(count * 3);
      var col = new Float32Array(count * 3);
      var phase = new Float32Array(count);
      var speed = new Float32Array(count);
      var ssize = new Float32Array(count);
      var palette = [0xa8c4ff, 0x8ba8ff, 0xd0b8ff, 0x9aeeff, 0xffd6ec, 0xfff0d0, 0xffffff];
      var c = new THREE.Color();
      for (var i = 0; i < count; i++) {
        var r = rMin + rnd() * (rMax - rMin);
        var th = rnd() * Math.PI * 2;
        var ph = Math.acos(2 * rnd() - 1);
        pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
        pos[i * 3 + 1] = r * Math.cos(ph);
        pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
        c.set(palette[Math.floor(rnd() * palette.length)]).multiplyScalar(0.55 + rnd() * 0.45);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        phase[i] = rnd() * Math.PI * 2;
        speed[i] = 0.35 + rnd() * 1.7;
        ssize[i] = 0.45 + rnd() * 1.2;
      }
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
      g.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
      g.setAttribute('aSize', new THREE.BufferAttribute(ssize, 1));
      var m = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: glowTex },
          uScale: { value: SH() * 0.5 * renderer.getPixelRatio() },
          uSize: { value: size },
          uOpacity: { value: opacity },
        },
        vertexShader: [
          'attribute vec3 aColor;',
          'attribute float aPhase;',
          'attribute float aSpeed;',
          'attribute float aSize;',
          'uniform float uTime;',
          'uniform float uScale;',
          'uniform float uSize;',
          'varying vec3 vColor;',
          'varying float vTw;',
          'void main() {',
          '  vColor = aColor;',
          '  vTw = 0.28 + 0.72 * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));',
          '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
          '  gl_PointSize = uSize * aSize * (0.55 + 0.9 * vTw) * (uScale / max(1.0, -mv.z));',
          '  gl_Position = projectionMatrix * mv;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'uniform sampler2D uMap;',
          'uniform float uOpacity;',
          'varying vec3 vColor;',
          'varying float vTw;',
          'void main() {',
          '  float a = texture2D(uMap, gl_PointCoord).a;',
          '  gl_FragColor = vec4(vColor * vTw * uOpacity * a, 1.0);',
          '}',
        ].join('\n'),
        transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      var pts = new THREE.Points(g, m);
      starGroup.add(pts);
      return m;
    }
    var twinkleMat = makeTwinkleStars(1200, 450, 1900, 3.6, 0.92);

    // Nebulae
    var NEBULAE = [
      { color: 0x2e1a6e, pos: [-980, 420, -1100], size: 1250, op: 0.13 },
      { color: 0x0e2a6a, pos: [1080, -340, -780], size: 1050, op: 0.11 },
      { color: 0x0c4a4a, pos: [640, 740, 860], size: 1120, op: 0.10 },
      { color: 0x52165a, pos: [-760, -640, 760], size: 980, op: 0.12 },
      { color: 0x1a3a7a, pos: [220, -860, -1200], size: 1080, op: 0.10 },
      { color: 0x3a2060, pos: [-400, 200, 900], size: 900, op: 0.09 },
      { color: 0x1a4050, pos: [700, -100, -500], size: 850, op: 0.08 },
    ];
    var nebulaSprites = [];
    NEBULAE.forEach(function (nb) {
      var sm = new THREE.SpriteMaterial({
        map: glowTex, color: nb.color, transparent: true, opacity: nb.op,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      var s = new THREE.Sprite(sm);
      s.position.set(nb.pos[0], nb.pos[1], nb.pos[2]);
      s.scale.setScalar(nb.size);
      starGroup.add(s);
      nebulaSprites.push({ s: s, base: nb.op, phase: rnd() * Math.PI * 2, speed: 0.045 + rnd() * 0.07 });
    });

    // Wide central haze
    var haze = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x3a2f80, transparent: true, opacity: 0.055,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    haze.scale.setScalar(1050);
    starGroup.add(haze);
    nebulaSprites.push({ s: haze, base: 0.055, phase: 1.8, speed: 0.04 });

    // ---------- Concept stars ----------
    var nodeGroup = new THREE.Group();
    scene.add(nodeGroup);
    var nodeMeshes = [];

    var starPalette = [
      0x9eb8ff, 0xc8d8ff, 0xfff0e0, 0xffe0b0,
      0xffc878, 0xffa060, 0xb0c8ff, 0xe8d0ff,
    ];

    var maxMentions = Math.max.apply(null, [1].concat(nodes.slice(0, NU).map(function (n) { return n.mention_count; })));
    function mentionFactor(mentions) {
      return 0.3 + 0.7 * Math.log1p(mentions) / Math.log1p(maxMentions);
    }
    var WHITE = new THREE.Color(0xffffff);

    var starCount = nodes.length;
    var starPos = new Float32Array(starCount * 3);
    var starCol = new Float32Array(starCount * 3);
    var starSize = new Float32Array(starCount);
    var starPhase = new Float32Array(starCount);
    var starSpeed = new Float32Array(starCount);

    nodes.forEach(function (n, i) {
      var p = positions[i];
      starPos[i * 3] = p.x;
      starPos[i * 3 + 1] = p.y;
      starPos[i * 3 + 2] = p.z;

      var mf = mentionFactor(n.mention_count);
      var deg = n.degree;
      var baseSize = (i === NU) ? 10.0 : (3.2 + Math.pow(deg, 0.7) * 1.2 + mf * 1.9);
      starSize[i] = baseSize;
      starPhase[i] = rnd() * Math.PI * 2;
      starSpeed[i] = 0.4 + rnd() * 1.2;

      var c = new THREE.Color(starPalette[(n.rootIdx >= 0 ? n.rootIdx : 0) % starPalette.length]);
      if (i === NU) c.set(0xffe8c0);
      var bright = (i === NU) ? 1.0 : (0.5 + mf * 0.5);
      starCol[i * 3] = c.r * bright;
      starCol[i * 3 + 1] = c.g * bright;
      starCol[i * 3 + 2] = c.b * bright;

      var hitR = Math.max(baseSize * 3.5, 7);
      var hit = new THREE.Mesh(
        new THREE.SphereGeometry(hitR, 6, 5),
        new THREE.MeshBasicMaterial({ visible: false })
      );
      hit.position.copy(p);
      hit.userData = {
        index: i,
        hl: false,
        isNucleus: i === NU,
        baseSize: baseSize,
        baseColor: c.clone(),
        twPhase: starPhase[i],
        twSpeed: starSpeed[i],
      };
      nodeGroup.add(hit);
      nodeMeshes.push(hit);
    });

    var starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));
    starGeo.setAttribute('aSpeed', new THREE.BufferAttribute(starSpeed, 1));

    var conceptStarMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: glowTex },
        uFlare: { value: flareTex },
        uScale: { value: SH() * 0.5 * renderer.getPixelRatio() },
        uOpacity: { value: 0.95 },
      },
      vertexShader: [
        'attribute vec3 aColor;',
        'attribute float aSize;',
        'attribute float aPhase;',
        'attribute float aSpeed;',
        'uniform float uTime;',
        'uniform float uScale;',
        'varying vec3 vColor;',
        'varying float vTw;',
        'varying float vSize;',
        'void main() {',
        '  vColor = aColor;',
        '  vTw = 0.75 + 0.25 * (0.5 + 0.5 * sin(uTime * aSpeed + aPhase));',
        '  vSize = aSize;',
        '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
        '  gl_PointSize = aSize * (0.9 + 0.25 * vTw) * (uScale / max(40.0, -mv.z));',
        '  gl_Position = projectionMatrix * mv;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D uMap;',
        'uniform float uOpacity;',
        'varying vec3 vColor;',
        'varying float vTw;',
        'varying float vSize;',
        'void main() {',
        '  vec2 uv = gl_PointCoord - 0.5;',
        '  float d = length(uv) * 2.0;',
        '  float core = exp(-d * d * 4.5);',
        '  float halo = exp(-d * d * 1.4) * 0.25;',
        '  float a = (core + halo) * vTw * uOpacity;',
        '  if (a < 0.01) discard;',
        '  gl_FragColor = vec4(vColor * (0.85 + 0.4 * core), a);',
        '}',
      ].join('\n'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    var conceptStars = new THREE.Points(starGeo, conceptStarMat);
    nodeGroup.add(conceptStars);

    // Galactic core: a tight cluster of extra stars around the nucleus.
    var coreCount = 80;
    var corePos = new Float32Array(coreCount * 3);
    var coreCol = new Float32Array(coreCount * 3);
    var coreSize = new Float32Array(coreCount);
    for (var ci = 0; ci < coreCount; ci++) {
      var cr = Math.pow(rnd(), 0.6) * 22;
      var cth = rnd() * Math.PI * 2;
      var cph = Math.acos(2 * rnd() - 1);
      corePos[ci * 3] = cr * Math.sin(cph) * Math.cos(cth);
      corePos[ci * 3 + 1] = cr * Math.cos(cph) * 0.6;
      corePos[ci * 3 + 2] = cr * Math.sin(cph) * Math.sin(cth);
      var warm = new THREE.Color().setHSL(0.08 + rnd() * 0.06, 0.55, 0.7 + rnd() * 0.25);
      coreCol[ci * 3] = warm.r;
      coreCol[ci * 3 + 1] = warm.g;
      coreCol[ci * 3 + 2] = warm.b;
      coreSize[ci] = 0.8 + rnd() * 2.2;
    }
    var coreGeo = new THREE.BufferGeometry();
    coreGeo.setAttribute('position', new THREE.BufferAttribute(corePos, 3));
    coreGeo.setAttribute('aColor', new THREE.BufferAttribute(coreCol, 3));
    coreGeo.setAttribute('aSize', new THREE.BufferAttribute(coreSize, 1));
    coreGeo.setAttribute('aPhase', new THREE.BufferAttribute(new Float32Array(coreCount).map(function () { return rnd() * 6.28; }), 1));
    coreGeo.setAttribute('aSpeed', new THREE.BufferAttribute(new Float32Array(coreCount).map(function () { return 0.5 + rnd(); }), 1));
    var coreStars = new THREE.Points(coreGeo, conceptStarMat);
    nodeGroup.add(coreStars);

    var coreLight = new THREE.PointLight(0xffe0b0, 3500, 400, 1.8);
    nodeGroup.add(coreLight);

    var ambient = new THREE.AmbientLight(0x12182a, 0.9);
    scene.add(ambient);
    var keyLight = new THREE.PointLight(0x8899cc, 4000, 1000, 1.6);
    keyLight.position.set(200, 220, 160);
    scene.add(keyLight);
    var rim = new THREE.PointLight(0x5544aa, 2500, 800, 1.7);
    rim.position.set(-220, -120, -160);
    scene.add(rim);

    // ---------- Edges ----------
    var edgeGroup = new THREE.Group();
    scene.add(edgeGroup);
    var edgeLines = [];
    var fadingEdges = [];

    var EDGE_SEGS = 20;
    var _edgeTmp = new THREE.Vector3();
    function updateEdgeGeometry(l) {
      var ud = l.userData;
      var va = positions[ud.a], vb = positions[ud.b];
      ud.len = va.distanceTo(vb);
      ud.curve.v0.copy(va);
      ud.curve.v1.copy(va).lerp(vb, ud.midT).addScaledVector(ud.midDir, ud.len * ud.midScale);
      ud.curve.v2.copy(vb);
      var arr = l.geometry.attributes.position.array;
      for (var s = 0; s <= EDGE_SEGS; s++) {
        ud.curve.getPoint(s / EDGE_SEGS, _edgeTmp);
        arr[s * 3] = _edgeTmp.x; arr[s * 3 + 1] = _edgeTmp.y; arr[s * 3 + 2] = _edgeTmp.z;
      }
      l.geometry.attributes.position.needsUpdate = true;
    }

    function makeEdgeLine(a, b, weight, baseColor) {
      var va = positions[a], vb = positions[b];
      var curve = new THREE.QuadraticBezierCurve3(va.clone(), va.clone(), vb.clone());
      var g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((EDGE_SEGS + 1) * 3), 3));
      var m = new THREE.LineBasicMaterial({
        color: baseColor, transparent: true, opacity: 0.03 + weight * 0.05,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
      var l = new THREE.Line(g, m);
      l.userData = {
        a: a, b: b, weight: weight, curve: curve, baseOpacity: m.opacity,
        baseColor: new THREE.Color(baseColor), len: 0,
        midT: 0.32 + rnd() * 0.36,
        midDir: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize(),
        midScale: 0.13 + rnd() * 0.15,
      };
      updateEdgeGeometry(l);
      edgeGroup.add(l);
      edgeLines.push(l);
    }

    for (var ai = 0; ai < adj.length; ai++) {
      for (var ei = 0; ei < adj[ai].length; ei++) {
        var jj = adj[ai][ei].j;
        var ww = adj[ai][ei].weight;
        if (ai < jj) makeEdgeLine(ai, jj, ww, jj === NU ? 0xe0b870 : 0x90a8e8);
      }
    }

    // Synaptic pulse particles
    var PULSES = 90;
    var pulses = [];
    var puTmp = new THREE.Vector3();
    var puPos = new Float32Array(PULSES * 3);
    var puCol = new Float32Array(PULSES * 3);
    var puGeo = new THREE.BufferGeometry();
    puGeo.setAttribute('position', new THREE.BufferAttribute(puPos, 3));
    puGeo.setAttribute('color', new THREE.BufferAttribute(puCol, 3));
    var puStarlight = new THREE.Color(0xfff6e8);

    function pulseColor(k) {
      var c = pulses[k].e.userData.baseColor.clone().lerp(puStarlight, 0.5);
      pulses[k].r = c.r; pulses[k].g = c.g; pulses[k].b = c.b;
      puCol[k * 3] = c.r; puCol[k * 3 + 1] = c.g; puCol[k * 3 + 2] = c.b;
      puGeo.attributes.color.needsUpdate = true;
    }

    for (var pk = 0; pk < PULSES; pk++) {
      pulses.push({
        e: edgeLines[Math.floor(rnd() * edgeLines.length)],
        t: rnd(),
        speed: 14 + rnd() * 32,
      });
      pulseColor(pk);
    }

    var puMat = new THREE.PointsMaterial({
      size: 1.8, map: glowTex, vertexColors: true, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, fog: false,
    });
    scene.add(new THREE.Points(puGeo, puMat));

    // ---------- Fill-in: counts from the fact index ----------
    function paintSlot(i) {
      var n = nodes[i];
      var mf = mentionFactor(n.mention_count);
      var size = (i === NU) ? 10.0 : (3.2 + Math.pow(n.degree, 0.7) * 1.2 + mf * 1.9);
      var c = new THREE.Color(starPalette[(n.rootIdx >= 0 ? n.rootIdx : 0) % starPalette.length]);
      if (i === NU) c.set(0xffe8c0);
      var bright = (i === NU) ? 1.0 : (0.5 + mf * 0.5);
      starGeo.attributes.aSize.array[i] = size;
      starGeo.attributes.aColor.array[i * 3] = c.r * bright;
      starGeo.attributes.aColor.array[i * 3 + 1] = c.g * bright;
      starGeo.attributes.aColor.array[i * 3 + 2] = c.b * bright;
      starGeo.attributes.aSize.needsUpdate = true;
      starGeo.attributes.aColor.needsUpdate = true;
      var ud = nodeMeshes[i].userData;
      ud.baseSize = size;
      ud.baseColor = c.clone();
    }

    var refreshing = false;
    async function refreshFacts() {
      if (refreshing) return false;
      refreshing = true;
      try {
        var tax = await fetchTaxonomy();
        distributeFacts(Array.isArray(tax.facts) ? tax.facts : []);
        maxMentions = Math.max.apply(null, [1].concat(nodes.slice(0, NU).map(function (n) { return n.mention_count; })));
        for (var i = 0; i < NU; i++) paintSlot(i);
        window.__galaxyGraph = {
          source: 'memory tree',
          labels: nodes.slice(0, NU).map(function (n) { return n.path; }),
          mentions: nodes.slice(0, NU).map(function (n) { return n.mention_count; }),
        };
        return true;
      } catch (e) {
        return false;
      } finally { refreshing = false; }
    }
    var REFRESH_INTERVAL_S = 15 * 60;
    var nextAutoRefreshAt = REFRESH_INTERVAL_S;

    // ---------- Interaction ----------
    var raycaster = new THREE.Raycaster();
    var mouse = new THREE.Vector2();
    var hovered = null;
    var selected = null;
    var flyTarget = null;
    var flyLook = null;

    ['pointerdown', 'wheel', 'keydown', 'touchstart'].forEach(function (ev) {
      renderer.domElement.addEventListener(ev, function () { flyTarget = null; flyLook = null; }, { passive: true });
    });

    function owningNodeIndex(obj) {
      var o = obj;
      while (o && o.userData.index == null) o = o.parent;
      return o ? o.userData.index : null;
    }

    function resetHighlight() {
      edgeLines.forEach(function (l) {
        l.material.opacity = l.userData.baseOpacity;
        l.material.color.copy(l.userData.baseColor);
      });
      nodeMeshes.forEach(function (m) { m.userData.hl = false; });
      var sizes = starGeo.attributes.aSize;
      var cols = starGeo.attributes.aColor;
      for (var i = 0; i < nodes.length; i++) {
        sizes.array[i] = nodeMeshes[i].userData.baseSize;
        var c = nodeMeshes[i].userData.baseColor;
        var bright = (i === NU) ? 1.0 : 0.75;
        cols.array[i * 3] = c.r * bright;
        cols.array[i * 3 + 1] = c.g * bright;
        cols.array[i * 3 + 2] = c.b * bright;
      }
      sizes.needsUpdate = true;
      cols.needsUpdate = true;
    }

    function highlightNode(idx) {
      resetHighlight();
      if (idx == null) return;
      var connected = new Set();
      adj[idx].forEach(function (nb) { connected.add(nb.j); });
      connected.add(idx);
      var sizes = starGeo.attributes.aSize;
      var cols = starGeo.attributes.aColor;
      nodeMeshes.forEach(function (m, i) {
        if (connected.has(i)) {
          m.userData.hl = true;
          sizes.array[i] = m.userData.baseSize * 1.8;
          cols.array[i * 3] = Math.min(1, cols.array[i * 3] * 1.4 + 0.2);
          cols.array[i * 3 + 1] = Math.min(1, cols.array[i * 3 + 1] * 1.4 + 0.2);
          cols.array[i * 3 + 2] = Math.min(1, cols.array[i * 3 + 2] * 1.4 + 0.25);
        }
      });
      sizes.needsUpdate = true;
      cols.needsUpdate = true;
      edgeLines.forEach(function (l) {
        if (l.userData.a === idx || l.userData.b === idx) {
          l.material.color.set(0xc8d8ff);
          l.material.opacity = 0.22 + l.userData.weight * 0.18;
        }
      });
    }

    // Activity highlight API
    var activeNodes = new Map();
    var activeEdges = new Map();
    var activityTimer = null;
    var ACTIVITY_ATTACK = 0.09;
    var ACTIVITY_RELEASE = 0.28;
    var ACTIVITY_BREATH = 3.8;

    function _stepLevel(st, dt) {
      var tau = st.target ? ACTIVITY_ATTACK : ACTIVITY_RELEASE;
      st.level += (st.target - st.level) * (1 - Math.exp(-dt / tau));
      return st.level;
    }
    function _breath(t) {
      return 0.76 + 0.24 * Math.sin(t * ACTIVITY_BREATH);
    }

    function highlightTopics(topics, options) {
      options = options || {};
      var list = topics == null ? [] : (Array.isArray(topics) ? topics : [topics]);
      var intensity = Math.max(0.1, Math.min(1, isFinite(options.intensity) ? options.intensity : 1));
      var resolved = new Set();
      list.forEach(function (topic) {
        if (typeof topic === 'number') { resolved.add(topic); return; }
        var q = String(topic).trim().toLowerCase();
        if (!q) return;
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].label.toLowerCase().indexOf(q) !== -1) resolved.add(i);
        }
      });
      activeNodes.forEach(function (st, i) { if (!resolved.has(i)) st.target = 0; });
      activeEdges.forEach(function (st) { st.target = 0; });
      resolved.forEach(function (i) {
        var st = activeNodes.get(i);
        if (st) { st.target = 1; st.intensity = intensity; }
        else activeNodes.set(i, { level: 0, target: 1, intensity: intensity });
      });
      edgeLines.forEach(function (l) {
        if (resolved.has(l.userData.a) && resolved.has(l.userData.b)) {
          var st = activeEdges.get(l);
          if (st) { st.target = 1; st.intensity = intensity; }
          else activeEdges.set(l, { level: 0, target: 1, intensity: intensity });
        }
      });
      if (activityTimer != null) { clearTimeout(activityTimer); activityTimer = null; }
      var duration = Number(options && options.duration);
      if (isFinite(duration) && duration > 0) {
        activityTimer = setTimeout(clearActivity, duration);
      }
      return resolved.size;
    }

    function clearActivity() {
      if (activityTimer != null) { clearTimeout(activityTimer); activityTimer = null; }
      activeNodes.forEach(function (st) { st.target = 0; });
      activeEdges.forEach(function (st) { st.target = 0; });
    }

    window.memoryMap = {
      highlightTopics: highlightTopics,
      clearActivity: clearActivity,
      shuffle: function () { beginShuffle(clock.getElapsedTime()); },
      refresh: refreshFacts,
      flare: function (q, opts) {
        opts = opts || {};
        var outward = !opts.recall;
        var dur = isFinite(opts.duration) ? opts.duration : 3;
        if (typeof q === 'number') { brainFlare(q, 1, dur, outward, outward); return 1; }
        var s = String(q || '').trim().toLowerCase();
        if (!s) return 0;
        var idx = nodes.findIndex(function (nd) { return nd.path && nd.path.toLowerCase() === s; });
        if (idx >= 0) { brainFlare(idx, 1, dur, outward, outward); return 1; }
        var regions = regionsForQuery(s);
        regions.forEach(function (rg) { brainFlare(rg.i, rg.intensity, dur, outward, outward); });
        return regions.length;
      },
    };

    // ---------- Brain-scan flares ----------
    var ACT_POLL_MS = 2000;
    var ACT_POLL_HIDDEN_MS = 12000;
    var actLastTs = -1;
    var actPollBusy = false;
    var actTimer = null;

    function chainTo(idx) {
      var chain = [];
      for (var i = idx; i != null; i = nodes[i].parent) chain.unshift(i);
      chain.unshift(NU);
      return chain;
    }

    function edgeBetween(a, b) {
      for (var i = 0; i < edgeLines.length; i++) {
        var l = edgeLines[i];
        if ((l.userData.a === a && l.userData.b === b) ||
            (l.userData.a === b && l.userData.b === a)) return l;
      }
      return null;
    }

    function injectPulse(edge, outward, hot) {
      var k = -1;
      for (var p = 0; p < PULSES; p++) {
        if (!pulses[p].e || pulses[p].t > 0.85) { k = p; break; }
      }
      if (k < 0) return;
      var pulse = pulses[k];
      var ud = edge.userData;
      var aIsParent = !!nodes[ud.b] && nodes[ud.b].parent === ud.a;
      pulse.e = edge;
      pulse.t = 0;
      pulse.rev = outward ? !aIsParent : aIsParent;
      pulse.speed = 60 + rnd() * 30;
      var c = hot ? new THREE.Color(0xffedc4) : ud.baseColor.clone().lerp(puStarlight, 0.6);
      pulse.r = c.r; pulse.g = c.g; pulse.b = c.b;
      puCol[k * 3] = c.r; puCol[k * 3 + 1] = c.g; puCol[k * 3 + 2] = c.b;
      puGeo.attributes.color.needsUpdate = true;
    }

    function brainFlare(idx, intensity, durationS, outward, hot) {
      if (idx == null || idx < 0 || idx > NU) return;
      var chain = idx === NU ? [NU] : chainTo(idx);
      chain.forEach(function (i, hop) {
        var k = hop === 0 ? 0.25 : Math.pow(0.55, chain.length - 1 - hop);
        var inten = Math.max(0.1, intensity * (0.3 + 0.7 * k));
        setTimeout(function () {
          var until = clock.getElapsedTime() + durationS;
          var st = activeNodes.get(i);
          if (st) {
            st.target = 1;
            st.intensity = Math.max(st.intensity || 0, inten);
            st.until = Math.max(st.until || 0, until);
          } else {
            activeNodes.set(i, { level: 0, target: 1, intensity: inten, until: until });
          }
          if (hop > 0) {
            var edge = edgeBetween(chain[hop - 1], i);
            if (edge) {
              var est = activeEdges.get(edge);
              if (est) {
                est.target = 1;
                est.intensity = Math.max(est.intensity || 0, inten * 0.9);
                est.until = Math.max(est.until || 0, until);
              } else {
                activeEdges.set(edge, { level: 0, target: 1, intensity: inten * 0.9, until: until });
              }
              injectPulse(edge, outward, hot);
            }
          }
        }, hop * 110);
      });
    }

    var QUERY_STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
      'you', 'your', 'what', 'when', 'where', 'how', 'why', 'who', 'about', 'into', 'has', 'have', 'had', 'not',
      'but', 'all', 'can', 'could', 'will', 'would', 'should', 'its', 'their', 'there', 'them', 'then', 'than',
      'some', 'just', 'also', 'been', 'being', 'does', 'did', 'doing', 'any', 'too', 'very', 'which', 'while',
      'because', 'through', 'during', 'before', 'after', 'again', 'once', 'out', 'off', 'over', 'under',
      'between', 'against', 'here', 'each', 'other', 'more', 'most', 'such', 'only', 'same', 'now', 'warden',
      'memory', 'system', 'said', 'tell', 'know', 'need', 'want', 'make', 'made', 'thing', 'stuff']);

    function regionsForQuery(q) {
      var words = String(q || '').toLowerCase().split(/[^a-z0-9&']+/).filter(function (w) {
        return w.length > 2 && !QUERY_STOP.has(w);
      });
      if (!words.length) return [];
      var hits = [];
      for (var i = 0; i < NU; i++) {
        var n = nodes[i];
        var label = n.label.toLowerCase();
        var p = n.path.toLowerCase();
        var score = 0;
        for (var wi = 0; wi < words.length; wi++) {
          var w = words[wi];
          if (label === w) score += 3;
          else if (label.split(/[^a-z]+/).some(function (lw) { return lw === w; })) score += 2.5;
          else if (label.indexOf(w) !== -1 || w.indexOf(label) !== -1) score += 1.5;
          else if (p.indexOf(w) !== -1) score += 1;
        }
        if (score > 0) hits.push([i, score]);
      }
      if (!hits.length) return [];
      hits.sort(function (a, b) { return b[1] - a[1]; });
      var maxScore = hits[0][1];
      return hits.slice(0, 6).map(function (h) {
        return { i: h[0], intensity: Math.min(1, 0.45 + 0.55 * (h[1] / maxScore)) };
      });
    }

    var factsRefreshAt = -1;
    function queueFactRefresh() { factsRefreshAt = clock.getElapsedTime() + 4; }
    function runFactRefresh() {
      if (factsRefreshAt < 0) return;
      if (clock.getElapsedTime() < factsRefreshAt) return;
      factsRefreshAt = -1;
      void refreshFacts();
    }

    function onActivityEvents(events) {
      if (!events.length) return;
      if (actLastTs < 0) {
        actLastTs = Math.max.apply(null, [0].concat(events.map(function (e) { return Number(e.ts) || 0; })));
        return;
      }
      var fresh = events.filter(function (e) { return (Number(e.ts) || 0) > actLastTs; });
      if (!fresh.length) return;
      actLastTs = Math.max.apply(null, [actLastTs].concat(fresh.map(function (e) { return Number(e.ts) || 0; })));
      fresh.slice(-24).forEach(function (ev, n) {
        setTimeout(function () {
          if (document.visibilityState === 'hidden') return;
          if (ev.kind === 'write') {
            var pl = String(ev.path || '').toLowerCase();
            var idx = pl ? nodes.findIndex(function (nd) { return nd.path && nd.path.toLowerCase() === pl; }) : -1;
            if (idx >= 0 && idx < NU) {
              brainFlare(idx, 1, 3.4, true, true);
              queueFactRefresh();
            } else {
              var regions = regionsForQuery(ev.fact || ev.path || ev.query);
              regions.forEach(function (rg) {
                brainFlare(rg.i, rg.intensity, 3, true, true);
                queueFactRefresh();
              });
            }
          } else {
            var rec = regionsForQuery(ev.query || ev.fact || '');
            rec.forEach(function (rg) { brainFlare(rg.i, rg.intensity, 2.6, false, false); });
          }
        }, n * 240);
      });
    }

    async function activityTick() {
      actTimer = null;
      if (!ctl.active) {
        actTimer = setTimeout(activityTick, ACT_POLL_HIDDEN_MS);
        return;
      }
      if (actPollBusy) { actTimer = setTimeout(activityTick, ACT_POLL_MS); return; }
      actPollBusy = true;
      try {
        var data = await fetchActivity();
        onActivityEvents(data.events);
      } catch (e) { /* Warden momentarily unreachable — next tick retries */ }
      var hidden = document.visibilityState === 'hidden';
      runFactRefresh();
      actPollBusy = false;
      actTimer = setTimeout(activityTick, hidden ? ACT_POLL_HIDDEN_MS : ACT_POLL_MS);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && actTimer == null && ctl.active) activityTick();
    });

    // ---------- Picking ----------
    function setMouseFromEvent(e) {
      var rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    }

    function onPointerMove(e) {
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(nodeMeshes, true);
      var idx = hits.length ? owningNodeIndex(hits[0].object) : null;
      if (idx !== hovered) {
        hovered = idx;
        highlightNode(selected != null ? selected : idx);
        renderer.domElement.style.cursor = idx != null ? 'pointer' : 'default';
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // Drag-vs-click guard — only a click that landed within a few px of its
    // pointerdown selects a star.
    var downX = 0, downY = 0;
    renderer.domElement.addEventListener('pointerdown', function (e) {
      downX = e.clientX; downY = e.clientY;
    }, { passive: true });
    renderer.domElement.addEventListener('click', function (e) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return;
      setMouseFromEvent(e);
      raycaster.setFromCamera(mouse, camera);
      var hits = raycaster.intersectObjects(nodeMeshes, true);
      if (hits.length) selectNode(owningNodeIndex(hits[0].object));
    });

    // ---------- Detail window ----------
    function openDetailWindow(idx) {
      var n = nodes[idx];
      if (!n) return;
      function esc(s) {
        return String(s == null ? '' : s)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }
      var mini, body;
      if (idx === NU) {
        mini = n.children.length + ' branches of the brain';
        body = '<h3>Branches of the brain</h3>' + n.children.map(function (j) {
          return '<div class="row"><span>' + esc(nodes[j].label) + '</span><span class="w">' +
            nodes[j].children.length + '</span></div>';
        }).join('');
      } else {
        mini = (n.children.length ? n.children.length + (n.children.length === 1 ? ' branch · ' : ' branches · ') : '') +
          n.mention_count + (n.mention_count === 1 ? ' memory' : ' memories');
        var memRow = function (m) {
          var content = String(m.fact || m.content || '').slice(0, 400);
          var meta = 'filed ' + String(m.ts || '').slice(0, 10);
          return '<div class="mem"><div class="mc">' + esc(content) + '</div><div class="mm">' + esc(meta) + '</div></div>';
        };
        if (!n.memories || !n.memories.length) {
          body = '<div style="color:#7d8db3;font-size:12px;">nothing filed here yet — the memory-tree classifier has not found facts for this branch.</div>';
        } else {
          body = '<div class="mini" style="margin-bottom:6px">' + n.mention_count + ' filed here' +
            (n.mention_count > n.memories.length ? ' — showing the latest ' + n.memories.length : '') + '</div>' +
            n.memories.map(memRow).join('');
        }
      }
      var doc = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(n.label) + '</title><style>' +
        'html,body { background:#020308; height:100%; }' +
        'body { margin:0; color:#e8f0ff; font-family:system-ui,sans-serif; overflow:hidden; }' +
        '.card { position:absolute; inset:7px; border-radius:15px; padding:20px 18px;' +
        '  background:linear-gradient(165deg, rgba(13,22,41,.97), rgba(3,5,12,.98));' +
        '  border:1px solid rgba(78,201,255,.3);' +
        '  box-shadow:0 0 26px rgba(78,201,255,.2), inset 0 0 46px rgba(78,201,255,.05);' +
        '  overflow-y:auto; }' +
        '.card::-webkit-scrollbar { width:4px; }' +
        '.card::-webkit-scrollbar-thumb { background:rgba(78,201,255,.35); border-radius:3px; }' +
        'h1 { font-size:17px; font-weight:600; margin:2px 30px 8px 0; word-break:break-word;' +
        '  color:#dff1ff; text-shadow:0 0 14px rgba(78,201,255,.35); }' +
        '.mini { color:#7d8db3; font-size:11px; letter-spacing:.4px; margin-bottom:16px; }' +
        'h3 { font-size:10px; text-transform:uppercase; letter-spacing:1.4px; color:#5d6f96;' +
        '  margin:14px 0 8px; }' +
        '.row { display:flex; justify-content:space-between; gap:10px; padding:7px 11px;' +
        '  border-radius:9px; font-size:13px; }' +
        '.row:hover { background:rgba(78,201,255,.11); }' +
        '.w { color:#4ec9ff; font-variant-numeric:tabular-nums; }' +
        '.mem { padding:9px 11px; border-radius:9px; font-size:12.5px; line-height:1.45; }' +
        '.mem:hover { background:rgba(78,201,255,.11); }' +
        '.mc { color:#cfe0f5; word-break:break-word; }' +
        '.mm { color:#5d6f96; font-size:10px; margin-top:4px; letter-spacing:.4px; }' +
        '.x { position:absolute; top:12px; right:12px; width:24px; height:24px; line-height:24px;' +
        '  text-align:center; border-radius:50%; font-size:14px; color:#7d8db3; cursor:pointer;' +
        '  background:rgba(140,180,255,.08); border:none; }' +
        '.x:hover { background:rgba(255,120,120,.18); color:#ffb3b3; }' +
        '.drag { position:fixed; bottom:12px; left:0; right:0; text-align:center;' +
        '  font-size:10px; color:#41527a; letter-spacing:.5px; pointer-events:none; }' +
        '</style></head><body><div class="card">' +
        '<button class="x" id="x" title="Close">✕</button>' +
        '<h1>' + esc(n.label) + '</h1>' +
        '<div class="mini">' + esc(mini) + (idx !== NU ? ' · ' + esc(n.path) : '') + '</div>' +
        body + '</div>' +
        '<div class="drag">drag anywhere to move this window</div>' +
        '<scr' + 'ipt>document.getElementById("x").onclick=function(){' +
        'if(window.pywebview&&window.pywebview.api&&typeof window.pywebview.api.close_memory_window==="function"){' +
        'try{window.pywebview.api.close_memory_window();}catch(e){}}};</scr' + 'ipt>' +
        '</body></html>';
      var api = window.pywebview && window.pywebview.api;
      if (api && typeof api.open_memory_window === 'function') {
        api.open_memory_window(n.label, doc).catch(function () {});
      } else {
        var w = window.open('', '_blank', 'width=420,height=560');
        if (w) { w.document.write(doc); w.document.close(); }
      }
    }

    function selectNode(idx) {
      selected = idx;
      highlightNode(idx);
      var n = nodes[idx];
      var nameEl = document.getElementById('galaxy-np-name');
      if (nameEl) nameEl.textContent = n.label;
      var miniEl = document.getElementById('galaxy-np-mini');
      if (miniEl) {
        miniEl.textContent = idx === NU
          ? n.children.length + ' branches of the brain'
          : (n.children.length ? n.children.length + (n.children.length === 1 ? ' branch · ' : ' branches · ') : '') +
            n.mention_count + (n.mention_count === 1 ? ' memory' : ' memories');
      }
      var list = document.getElementById('galaxy-np-conns');
      if (list) {
        list.innerHTML = '';
        n.children.forEach(function (j) {
          var row = document.createElement('div');
          row.className = 'conn';
          row.title = nodes[j].path;
          row.innerHTML = '<span>' + escHtml(nodes[j].label) + '</span><span class="w">' + nodes[j].mention_count + '</span>';
          row.addEventListener('click', function () { selectNode(j); });
          list.appendChild(row);
        });
      }
      var panel = document.getElementById('galaxy-node-panel');
      if (panel) panel.style.display = 'block';
      openDetailWindow(idx);
      flyTo(positions[idx]);
    }

    function escHtml(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    var npOpen = document.getElementById('galaxy-np-open');
    if (npOpen) npOpen.addEventListener('click', function () {
      if (selected != null) openDetailWindow(selected);
    });

    var closePanel = document.getElementById('galaxy-close-panel');
    if (closePanel) closePanel.addEventListener('click', function () {
      selected = null;
      var panel = document.getElementById('galaxy-node-panel');
      if (panel) panel.style.display = 'none';
      resetHighlight();
      flyTo(new THREE.Vector3(0, 0, 0));
    });

    // ---------- Search ----------
    var searchEl = document.getElementById('galaxy-search');
    var resultsEl = document.getElementById('galaxy-results');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        var q = searchEl.value.trim().toLowerCase();
        resultsEl.innerHTML = '';
        if (!q) {
          resultsEl.style.display = 'none';
          window.memoryMap.clearActivity();
          return;
        }
        var matches = nodes
          .map(function (n, i) { return { n: n, i: i }; })
          .filter(function (x) { return x.i !== NU && x.n.path.toLowerCase().indexOf(q) !== -1; })
          .sort(function (a, b) { return b.n.mention_count - a.n.mention_count; })
          .slice(0, 12);
        window.memoryMap.highlightTopics(q);
        if (!matches.length) { resultsEl.style.display = 'none'; return; }
        resultsEl.style.display = 'block';
        matches.forEach(function (x) {
          var row = document.createElement('div');
          row.className = 'row';
          row.title = x.n.path;
          row.innerHTML = '<span>' + escHtml(x.n.label) + '</span><span class="deg">' + x.n.mention_count + '</span>';
          row.addEventListener('click', function () {
            window.memoryMap.clearActivity();
            selectNode(x.i);
            resultsEl.style.display = 'none';
            searchEl.value = '';
          });
          resultsEl.appendChild(row);
        });
      });
    }

    function flyTo(target) {
      if (target.lengthSq() < 1) {
        flyTarget = new THREE.Vector3(0, 42, 235);
      } else {
        flyTarget = target.clone().multiplyScalar(1.35).add(new THREE.Vector3(0, 32, 0));
      }
      flyLook = target.clone();
    }

    // ---------- Animate ----------
    var clock = new THREE.Clock();
    var lastT = 0;
    var running = false;
    var rafId = 0;

    function animate() {
      var t = clock.getElapsedTime();
      var dt = Math.max(0, Math.min(t - lastT, 0.05));
      lastT = t;

      if (shuffleT0 < 0 && t >= nextShuffleAt) beginShuffle(t);
      if (shuffleT0 >= 0) {
        var rawK = Math.min(1, (t - shuffleT0) / SHUFFLE_DURATION);
        if (rawK >= 1) {
          shuffleT0 = -1;
          nextShuffleAt = t + SHUFFLE_INTERVAL;
        }
        var k = rawK < 0.5 ? 2 * rawK * rawK : 1 - Math.pow(-2 * rawK + 2, 2) / 2;
        for (var i = 0; i < nodes.length; i++) {
          positions[i].lerpVectors(fromPos[i], toPos[i], k);
          starPos[i * 3] = positions[i].x;
          starPos[i * 3 + 1] = positions[i].y;
          starPos[i * 3 + 2] = positions[i].z;
          nodeMeshes[i].position.copy(positions[i]);
        }
        starGeo.attributes.position.needsUpdate = true;
        for (var ei = 0; ei < edgeLines.length; ei++) updateEdgeGeometry(edgeLines[ei]);
      }

      if (t >= nextAutoRefreshAt) {
        nextAutoRefreshAt = t + REFRESH_INTERVAL_S;
        void refreshFacts();
      }

      for (var fi = fadingEdges.length - 1; fi >= 0; fi--) {
        var l = fadingEdges[fi];
        var fk = Math.min(1, (t - l.userData.fadeInAt) / 2.4);
        l.material.opacity = l.userData.baseOpacity * (fk < 1 ? fk * fk : 1);
        if (fk >= 1) fadingEdges.splice(fi, 1);
      }

      twinkleMat.uniforms.uTime.value = t;
      conceptStarMat.uniforms.uTime.value = t;

      var sizes = starGeo.attributes.aSize;
      var cols = starGeo.attributes.aColor;
      var sizeDirty = false;
      var colDirty = false;

      nodeMeshes.forEach(function (m, i) {
        var ud = m.userData;
        var st = activeNodes.get(i);
        var act = 0;
        if (st) {
          if (st.until != null && t > st.until) st.target = 0;
          act = _stepLevel(st, dt) * st.intensity * _breath(t);
          if (st.target === 0 && st.level < 0.005) activeNodes.delete(i);
        }
        var spawn = 1;
        if (ud.spawnAt != null) {
          var raw = Math.min(1, (t - ud.spawnAt) / 1.8);
          if (raw >= 1) ud.spawnAt = null;
          else spawn = 1 - Math.pow(1 - raw, 3);
        }
        var targetSize = ud.baseSize * (ud.hl ? 1.7 : 1) * (1 + act * 0.9) * spawn;
        if (Math.abs(sizes.array[i] - targetSize) > 0.02) {
          sizes.array[i] = targetSize;
          sizeDirty = true;
        }
        if (act > 0.05 || spawn < 1) {
          var c = ud.baseColor;
          var br = 0.25 + 0.75 * spawn;
          cols.array[i * 3] = Math.min(1, c.r * br + act * 0.4);
          cols.array[i * 3 + 1] = Math.min(1, c.g * br + act * 0.4);
          cols.array[i * 3 + 2] = Math.min(1, c.b * br + act * 0.5);
          colDirty = true;
        }
      });
      if (sizeDirty) sizes.needsUpdate = true;
      if (colDirty) cols.needsUpdate = true;

      activeEdges.forEach(function (st, l) {
        if (st.until != null && t > st.until) st.target = 0;
        var lvl = _stepLevel(st, dt);
        if (st.target === 0 && lvl < 0.005) {
          l.material.color.copy(l.userData.baseColor);
          l.material.opacity = l.userData.baseOpacity;
          activeEdges.delete(l);
          return;
        }
        var glow = lvl * st.intensity * _breath(t);
        l.material.color.copy(l.userData.baseColor).lerp(WHITE, Math.min(1, glow * 0.5));
        l.material.opacity = Math.min(0.55, l.userData.baseOpacity + 0.28 * glow);
      });

      starGroup.rotation.y += dt * 0.0018;
      farStars.material.opacity = 0.58;
      midStars.material.opacity = 0.42;
      nebulaSprites.forEach(function (nb) {
        nb.s.material.opacity = nb.base * (0.92 + 0.08 * Math.sin(t * nb.speed + nb.phase));
      });

      for (var k = 0; k < PULSES; k++) {
        var p = pulses[k];
        if (!p.e) { puPos[k * 3] = puPos[k * 3 + 1] = puPos[k * 3 + 2] = 0; continue; }
        p.t += (dt * p.speed) / Math.max(1, p.e.userData.len);
        if (p.t > 1) {
          p.e = edgeLines[Math.floor(Math.random() * edgeLines.length)] || null;
          p.t = 0;
          p.rev = false;
          p.speed = 14 + Math.random() * 32;
          if (p.e) pulseColor(k);
        }
        p.e.userData.curve.getPoint(p.rev ? 1 - p.t : p.t, puTmp);
        puPos[k * 3] = puTmp.x;
        puPos[k * 3 + 1] = puTmp.y;
        puPos[k * 3 + 2] = puTmp.z;
        var crest = Math.pow(Math.sin(Math.PI * p.t), 0.65);
        puCol[k * 3] = p.r * crest; puCol[k * 3 + 1] = p.g * crest; puCol[k * 3 + 2] = p.b * crest;
      }
      puGeo.attributes.position.needsUpdate = true;
      puGeo.attributes.color.needsUpdate = true;

      if (flyTarget && flyLook) {
        camera.position.lerp(flyTarget, 0.055);
        controls.target.lerp(flyLook, 0.055);
        if (camera.position.distanceTo(flyTarget) < 2.5 && controls.target.distanceTo(flyLook) < 2.5) {
          flyTarget = null; flyLook = null;
        }
      }
      controls.update();
      composer.render();
    }

    function loop() {
      rafId = 0;
      if (!running) return;
      animate();
      rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
      if (running) return;
      running = true;
      lastT = clock.getElapsedTime();
      if (!rafId) rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    }

    // ---------- Resize ----------
    function resize() {
      var w = SW(), h = SH();
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      if (composer.setSize) composer.setSize(w, h);
      if (bloom.setSize) bloom.setSize(w, h);
      twinkleMat.uniforms.uScale.value = h * 0.5 * renderer.getPixelRatio();
      conceptStarMat.uniforms.uScale.value = h * 0.5 * renderer.getPixelRatio();
      if (running) composer.render();   // keep a paused-but-resized view correct
    }
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { resize(); });
      ro.observe(hostEl);
    } else {
      window.addEventListener('resize', resize);
    }

    mounted = {
      start: startLoop,
      stop: stopLoop,
      reset: function () {
        selected = null;
        var panel = document.getElementById('galaxy-node-panel');
        if (panel) panel.style.display = 'none';
        resetHighlight();
        flyTo(new THREE.Vector3(0, 0, 0));
        if (searchEl) searchEl.value = '';
        if (resultsEl) resultsEl.style.display = 'none';
        window.memoryMap.clearActivity();
      },
    };

    // First frame + activity poll. The view is visible when mount is called
    // (app.js mounts on the first Galaxy open), so start immediately.
    ctl.active = true;
    startLoop();
    activityTick();

    console.info('[MemoryGalaxy] ready — ' + NU + ' tree nodes, ' + edgeLines.length + ' branches');
  }
})();
