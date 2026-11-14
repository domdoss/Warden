/* ==========================================================================
   Warden voice core — the JarvisHologram (ported verbatim from jarvis.html).
   Reactive: idle = cyan, listening = red, processing = amber ("thinking"),
   speaking = cyan + audio pulse, error = red flash. Full core/glow/wireframe/
   particle/ring/orbital-ring/energy-field scene. Exposes window.wardenOrb.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof THREE === 'undefined') return;

  const STATE_PARAMS = {
    idle:       { color: 0x00ffff, coreSpeed: 0.001,  particleDrift: 1.0, ringSpeed: 1.0, pulseAmp: 0.10, flash: false },
    listening:  { color: 0xff2b2b, coreSpeed: 0.0088, particleDrift: 1.8, ringSpeed: 1.2, pulseAmp: 0.18, flash: false },
    processing: { color: 0xffaa00, coreSpeed: 0.0035, particleDrift: 3.8, ringSpeed: 2.6, pulseAmp: 0.14, flash: false, jitter: 0.06, scatter: 0.035 },
    speaking:   { color: 0x00ffff, coreSpeed: 0.002,  particleDrift: 1.3, ringSpeed: 1.3, pulseAmp: 0.10, flash: false },
    error:      { color: 0xff0000, coreSpeed: 0.003,  particleDrift: 1.0, ringSpeed: 1.0, pulseAmp: 0.12, flash: true },
  };

  class JarvisHologram {
    constructor(host) {
      this.host = host;
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'orb-canvas';
      host.appendChild(this.canvas);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: false });
      this.renderer.setPixelRatio(1);

      this.audioLevel = 0;
      this.targetAudioLevel = 0;
      this.particles = [];
      this.rings = [];
      this.orbitalRings = [];

      this.state = 'idle';
      this.stateParams = STATE_PARAMS.idle;
      this.targetColor = new THREE.Color(STATE_PARAMS.idle.color);
      this.currentColor = new THREE.Color(STATE_PARAMS.idle.color);

      this.init();
    }

    size() {
      return [this.host.clientWidth || 300, this.host.clientHeight || 300];
    }

    fitCamera() {
      const [w, h] = this.size();
      const aspect = w / h;
      const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
      // Span a fixed horizontal world-radius so the particle shell (~6) reaches
      // past the center window's edges; on a wide screen this also spills over
      // the top/bottom, where the surrounding panels swallow it.
      const targetHalfWidth = 10.0;
      this.camera.position.z = targetHalfWidth / (tanHalf * aspect);
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();

      // Center the nucleus in the voice panel (the transparent viewing window),
      // not the raw screen midpoint.
      const vp = document.getElementById('voice-panel');
      if (vp) {
        const rect = vp.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        const screenMid = this.host.clientHeight / 2;
        const vHalf = targetHalfWidth / aspect;
        const pxPerWorld = h / (2 * vHalf);
        this.scene.position.y = (screenMid - centerY) / pxPerWorld;
      } else {
        this.scene.position.y = 0;
      }
    }

    init() {
      const [w, h] = this.size();
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0);
      this.fitCamera();

      this.createCore();
      this.createParticleCloud();
      this.createRings();
      this.createOrbitalRings();
      this.createEnergyField();

      this.coloredMaterials = [
        this.core.material,
        this.innerGlow.material,
        this.wireframeSphere.material,
        this.energyField.material,
        ...this.particleMaterials,
        ...this.rings.map(r => r.material),
        ...this.orbitalRings.map(r => r.material),
      ];

      this.baseOpacities = {
        core: 0.55,
        innerGlow: 0.82,
        wireframeSphere: 0.62,
        energyField: 0.22,
        particles: 0.85,
        rings: this.rings.map((_, i) => 0.42 - i * 0.04),
        orbitalRings: this.orbitalRings.map(() => 0.68),
      };

      this.animate();
      window.addEventListener('resize', () => this.onResize());
      // Re-center when the voice panel changes size (e.g. priorities data loads
      // and shifts its height) without a window resize.
      if (typeof ResizeObserver !== 'undefined') {
        const vp = document.getElementById('voice-panel');
        if (vp) { this._ro = new ResizeObserver(() => this.fitCamera()); this._ro.observe(vp); }
      }
      this._ready = true;
    }

    createCore() {
      this.core = new THREE.Mesh(
        new THREE.SphereGeometry(0.8, 32, 32),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.3 })
      );
      this.scene.add(this.core);

      this.innerGlow = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.6 })
      );
      this.scene.add(this.innerGlow);

      this.wireframeSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 16, 16),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.4 })
      );
      this.scene.add(this.wireframeSphere);
    }

    createParticleCloud() {
      const count = 900;
      const half = count / 2;
      this.particleVelocities = [];
      this.particleGeometries = [];
      this.particleMaterials = [];
      this.particleGroup = new THREE.Group();

      const build = (n, glyph) => {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(n * 3);
        for (let i = 0; i < n * 3; i += 3) {
          const radius = 2 + Math.random() * 4;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI;
          positions[i] = radius * Math.sin(phi) * Math.cos(theta);
          positions[i + 1] = radius * Math.sin(phi) * Math.sin(theta);
          positions[i + 2] = radius * Math.cos(phi);
          this.particleVelocities.push({ x: (Math.random() - 0.5) * 0.01, y: (Math.random() - 0.5) * 0.01, z: (Math.random() - 0.5) * 0.01 });
        }
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const material = new THREE.PointsMaterial({
          color: 0x00ffff, size: 0.2, transparent: true, opacity: 0.8,
          map: this.glyphTexture(glyph), blending: THREE.AdditiveBlending, depthWrite: false,
        });
        this.particleGeometries.push(geometry);
        this.particleMaterials.push(material);
        this.particleGroup.add(new THREE.Points(geometry, material));
      };

      build(half, '1');
      build(half, '0');
      this.scene.add(this.particleGroup);
    }

    glyphTexture(ch) {
      const size = 64;
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 44px "Share Tech Mono", "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, size / 2, size / 2 + 2);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    }

    createRings() {
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(2 + i * 0.6, 0.015, 16, 100),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.25 - i * 0.03 })
        );
        ring.rotation.x = Math.PI / 2;
        this.rings.push(ring);
        this.scene.add(ring);
      }
    }

    createOrbitalRings() {
      for (let i = 0; i < 3; i++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.5 + i * 0.3, 0.02, 8, 64),
          new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 0.5, wireframe: true })
        );
        const angle = (i * Math.PI * 2) / 3;
        ring.rotation.set(angle, angle * 0.5, 0);
        this.orbitalRings.push(ring);
        this.scene.add(ring);
      }
    }

    createEnergyField() {
      this.energyField = new THREE.Mesh(
        new THREE.IcosahedronGeometry(3, 1),
        new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true, transparent: true, opacity: 0.1 })
      );
      this.scene.add(this.energyField);
    }

    setAudioLevel(level) {
      const n = Number(level);
      if (!Number.isFinite(n)) return;
      this.targetAudioLevel = Math.max(0, Math.min(2, n));
    }

    setState(name) {
      const params = STATE_PARAMS[name];
      if (!params) return;
      this.state = name;
      this.stateParams = params;
      this.targetColor = new THREE.Color(params.color);
    }

    animate() {
      requestAnimationFrame(() => this.animate());
      const now = Date.now();
      const params = this.stateParams;

      this.audioLevel += (this.targetAudioLevel - this.audioLevel) * 0.1;
      this.currentColor.lerp(this.targetColor, 0.1);
      for (const mat of this.coloredMaterials) mat.color.copy(this.currentColor);

      const audioWeight = this.state === 'speaking' ? 1.4 : 0.5;
      const totalPulse = 1 + Math.sin(now * params.coreSpeed) * params.pulseAmp + this.audioLevel * audioWeight;
      this.core.scale.setScalar(totalPulse);
      this.innerGlow.scale.setScalar(totalPulse * 0.8);
      this.wireframeSphere.scale.setScalar(totalPulse * 1.1);

      this.innerGlow.material.opacity = Math.max(0.2, Math.min(1, this.baseOpacities.innerGlow + this.audioLevel * 0.35));

      this.core.rotation.y += 0.003 * params.ringSpeed + this.audioLevel * 0.02;
      this.core.rotation.x += 0.002 * params.ringSpeed + this.audioLevel * 0.01;
      const wireDir = this.state === 'processing' ? 1 : -1;
      this.wireframeSphere.rotation.y += wireDir * (0.004 * params.ringSpeed - this.audioLevel * 0.015);
      this.wireframeSphere.rotation.x += wireDir * 0.002;

      this.rings.forEach((ring, i) => {
        ring.rotation.z += 0.001 * (i + 1) * params.ringSpeed + this.audioLevel * 0.01;
        const ringPulse = 1 + Math.sin(now * 0.002 + i) * 0.05 + this.audioLevel * 0.35;
        ring.scale.set(ringPulse, ringPulse, 1);
        ring.material.opacity = this.baseOpacities.rings[i] + this.audioLevel * 0.4;
      });

      this.orbitalRings.forEach((ring, i) => {
        ring.rotation.x += (0.005 + this.audioLevel * 0.02) * params.ringSpeed;
        ring.rotation.y += (0.003 + this.audioLevel * 0.015) * params.ringSpeed;
        ring.rotation.z += 0.002 * (i + 1) * params.ringSpeed + this.audioLevel * 0.01;
      });

      this.energyField.rotation.x += 0.001 * params.ringSpeed + this.audioLevel * 0.01;
      this.energyField.rotation.y += 0.002 * params.ringSpeed + this.audioLevel * 0.015;
      this.energyField.material.opacity = this.baseOpacities.energyField + this.audioLevel * 0.3;

      const drift = params.particleDrift, jitter = params.jitter || 0, scatter = params.scatter || 0;
      const perGeo = this.particleVelocities.length / this.particleGeometries.length;
      for (let g = 0; g < this.particleGeometries.length; g++) {
        const positions = this.particleGeometries[g].attributes.position.array;
        const base = g * perGeo;
        for (let i = 0; i < positions.length; i += 3) {
          const idx = base + i / 3;
          positions[i] += this.particleVelocities[idx].x * drift;
          positions[i + 1] += this.particleVelocities[idx].y * drift;
          positions[i + 2] += this.particleVelocities[idx].z * drift;
          if (jitter > 0) {
            positions[i] += (Math.random() - 0.5) * jitter;
            positions[i + 1] += (Math.random() - 0.5) * jitter;
            positions[i + 2] += (Math.random() - 0.5) * jitter;
          }
          const distance = Math.sqrt(positions[i] ** 2 + positions[i + 1] ** 2 + positions[i + 2] ** 2);
          if (scatter > 0 && distance > 0.001) {
            positions[i] += (positions[i] / distance) * scatter;
            positions[i + 1] += (positions[i + 1] / distance) * scatter;
            positions[i + 2] += (positions[i + 2] / distance) * scatter;
          }
          const outerBound = scatter > 0 ? 7.5 : 6;
          if (distance > outerBound || distance < 1.5) {
            this.particleVelocities[idx].x *= -1;
            this.particleVelocities[idx].y *= -1;
            this.particleVelocities[idx].z *= -1;
          }
          if (this.audioLevel > 0.1 && distance > 0.001) {
            const push = this.audioLevel * 0.04;
            positions[i] += (positions[i] / distance) * push;
            positions[i + 1] += (positions[i + 1] / distance) * push;
            positions[i + 2] += (positions[i + 2] / distance) * push;
          }
          if (distance > 4) {
            const centerForce = (distance - 4) * 0.01;
            positions[i] -= (positions[i] / distance) * centerForce;
            positions[i + 1] -= (positions[i + 1] / distance) * centerForce;
            positions[i + 2] -= (positions[i + 2] / distance) * centerForce;
          }
        }
        this.particleGeometries[g].attributes.position.needsUpdate = true;
      }
      this.particleGroup.rotation.y += (0.0005 + this.audioLevel * 0.005) * drift;

      if (params.flash) {
        const t = (now % 300) / 300;
        const flashDelta = Math.sin(t * Math.PI * 2) * 0.3;
        this.core.material.opacity = Math.max(0.05, this.baseOpacities.core + flashDelta);
        this.wireframeSphere.material.opacity = Math.max(0.05, this.baseOpacities.wireframeSphere + flashDelta);
        this.particleMaterials.forEach(m => { m.opacity = Math.max(0.1, this.baseOpacities.particles + flashDelta); });
      } else {
        this.core.material.opacity = this.baseOpacities.core;
        this.wireframeSphere.material.opacity = this.baseOpacities.wireframeSphere;
        this.particleMaterials.forEach(m => { m.opacity = this.baseOpacities.particles; });
      }

      this.renderer.render(this.scene, this.camera);
    }

    onResize() {
      const [w, h] = this.size();
      this.renderer.setSize(w, h, false);
      this.fitCamera();
    }
  }

  let hologram = null;

  window.wardenOrb = {
    ready: function () { return !!hologram; },
    setState: function (s) { if (hologram) hologram.setState(s); },
    setAudioLevel: function (l) { if (hologram) hologram.setAudioLevel(l); },
  };

  function tryMount() {
    const host = document.getElementById('core-orb');
    if (host && !hologram) hologram = new JarvisHologram(host);
    else if (!host) setTimeout(tryMount, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryMount);
  else tryMount();
})();
