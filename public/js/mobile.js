// Android tab — live screen, journal, Start/Stop loop, process log.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var state = null;

  function clock(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (n) {
      return String(n).padStart(2, '0');
    }).join(':');
  }

  function render() {
    if (!state) return;
    var on = !!state.enabled;
    var pill = $('mobile-status-pill');
    if (pill) {
      pill.textContent = on ? 'running' : 'off';
      pill.style.background = on ? '#1f6f43' : '#222';
    }
    var dev = $('mobile-device');
    if (dev) {
      var base = state.connected
        ? 'phone: ' + state.device
        : (state.device ? 'last phone: ' + state.device : 'no phone connected');
      dev.textContent = base + (state.lastError ? ' · ' + state.lastError.slice(0, 140) : '');
    }
    var obj = $('mobile-objective');
    if (obj) obj.textContent = state.objective || '';
    var meta = $('mobile-meta');
    if (meta) meta.textContent = 'model: ' + (state.model || '?');

    var j = $('mobile-journal');
    if (j) {
      j.innerHTML = '';
      // show the bot's reasoning, plans and actions — not internal screen snapshots
      (state.journal || []).filter(function (e) { return e.action !== 'screen'; }).forEach(function (e) {
        var row = document.createElement('div');
        var kind = e.action;
        var color = kind === 'think' ? '#8fb0ff' : kind === 'plan' ? '#6fd0a0' : '#d0d0d0';
        var label = kind === 'think' ? 'thinking' : kind === 'plan' ? 'plan' : kind;
        row.style.cssText = 'border-left:2px solid ' + (kind === 'think' ? '#3b5cff' : kind === 'plan' ? '#2f8a5f' : '#333') +
          ';padding:4px 8px;font-size:12px;' + (kind === 'think' ? 'font-style:italic;' : '');
        row.innerHTML = '<span style="color:#777">' + clock(e.ts) + '</span> ' +
          '<span style="color:' + color + '">' + label + '</span> ' +
          '<span style="color:' + (kind === 'think' ? '#a9c0d8' : '#ccc') + '">' + (e.text || '') + '</span>' +
          (e.result && kind !== 'think' && kind !== 'plan' ? ' <span style="color:#777">→ ' + e.result + '</span>' : '') +
          (e.error ? ' <span style="color:#c66">(' + e.error.slice(0, 120) + ')</span>' : '');
        j.appendChild(row);
      });
    }
  }

  function refresh() {
    fetch('/api/mobile/state', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { state = d; render(); })
      .catch(function () {});
  }

  function refreshFrame() {
    if (!document.querySelector('#view-android.active')) return;
    var img = $('mobile-frame');
    if (img) img.src = '/api/mobile/frame?ts=' + Date.now();
  }


  function toggle(on) {
    fetch('/api/mobile/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: on }),
    }).then(refresh);
  }

  var start = $('btn-mobile-start');
  if (start) start.addEventListener('click', function () { toggle(true); });
  var stop = $('btn-mobile-stop');
  if (stop) stop.addEventListener('click', function () { toggle(false); });

  function connectPhone() {
    var btn = $('btn-mobile-connect');
    var input = $('mobile-address');
    var address = input ? input.value.trim() : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
    var banner = $('mobile-device');
    if (banner) banner.textContent = 'Looking for the phone…';
    fetch('/api/mobile/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: address }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok) {
        if (banner) banner.textContent = 'phone: ' + d.device;
        refresh();
        refreshFrame();
      } else {
        if (banner) banner.textContent = (d && d.error) || 'could not connect';
        if (state) state.lastError = (d && d.error) || 'could not connect';
      }
    }).catch(function (err) {
      if (banner) banner.textContent = 'connect failed: ' + err;
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = 'Connect phone'; }
    });
  }

  var connectBtn = $('btn-mobile-connect');
  if (connectBtn) connectBtn.addEventListener('click', connectPhone);
  var addrInput = $('mobile-address');
  if (addrInput) addrInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') connectPhone();
  });


  // ---- talents: pick one, edit its prompt + skill, add new ----
  var talents = [], skills = [], currentId = '';

  function el(tag, style, text) {
    var e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function renderTalentSelect() {
    var sel = $('talent-select');
    if (!sel) return;
    sel.innerHTML = '';
    var head = el('option'); head.value = ''; head.textContent = talents.length ? '— choose a talent —' : 'no talents yet';
    sel.appendChild(head);
    talents.forEach(function (t) {
      var o = el('option');
      o.value = t.id;
      o.textContent = t.name + (t.enabled ? '' : ' (off)');
      sel.appendChild(o);
    });
    if (currentId) sel.value = currentId;
    var picker = $('talent-skill-picker');
    if (picker) {
      picker.innerHTML = '';
      var p0 = el('option'); p0.value = ''; p0.textContent = 'import a skill from disk…'; picker.appendChild(p0);
      var have = {};
      talents.forEach(function (t) { if (t.skill) have[t.skill] = 1; });
      skills.filter(function (s) { return !have[s.path]; }).forEach(function (s) {
        var o = el('option'); o.value = s.path; o.textContent = s.name + (s.description ? ' — ' + s.description.slice(0, 60) : '');
        o.dataset.name = s.name; o.dataset.desc = s.description || '';
        picker.appendChild(o);
      });
    }
  }

  function refreshTalents() {
    fetch('/api/mobile/talents', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        talents = d.talents || [];
        skills = d.skills || [];
        renderTalentSelect();
      })
      .catch(function () {});
  }

  function loadSkillContent(pathStr) {
    if (!pathStr) return;
    fetch('/api/mobile/skill?path=' + encodeURIComponent(pathStr), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ta = $('le-skill-content');
        if (ta && d && d.ok) ta.value = d.content;
      })
      .catch(function () {});
  }

  function closeEditor() {
    var ed = $('mobile-loop-editor');
    if (ed) { ed.style.display = 'none'; ed.innerHTML = ''; }
  }

  function openEditor(t) {
    var ed = $('mobile-loop-editor');
    if (!ed) return;
    var v = t || { id: '', name: '', description: '', goal: '', skill: '', intervalMin: 0, intervalMaxMin: '' };
    currentId = v.id || '';
    var field = 'style="background:#0b0d10;border:1px solid #222;color:#ddd;padding:6px;border-radius:6px"';
    ed.innerHTML =
      '<input id="le-name" placeholder="name" value="' + String(v.name || '').replace(/"/g, '&quot;') + '" ' + field + '>' +
      '<input id="le-desc" placeholder="one-line description" value="' + String(v.description || '').replace(/"/g, '&quot;') + '" ' + field + '>' +
      '<div style="display:flex;gap:6px">' +
        '<input id="le-interval" type="number" min="0" placeholder="interval min (0 = continuous)" value="' + (v.intervalMin || 0) + '" ' + field + ' style="flex:1;background:#0b0d10;border:1px solid #222;color:#ddd;padding:6px;border-radius:6px">' +
        '<input id="le-interval-max" type="number" min="0" placeholder="random max min (optional)" value="' + (v.intervalMaxMin || '') + '" ' + field + ' style="flex:1;background:#0b0d10;border:1px solid #222;color:#ddd;padding:6px;border-radius:6px">' +
      '</div>' +
      '<label style="color:#8b95a5">goal / prompt</label>' +
      '<textarea id="le-goal" rows="5" placeholder="what the phone runner should do" style="background:#0b0d10;border:1px solid #222;color:#ddd;padding:6px;border-radius:6px;font-family:inherit"></textarea>' +
      '<label style="color:#8b95a5">skill file</label>' +
      '<input id="le-skill-path" placeholder="/path/to/SKILL.md (leave blank to create one)" value="' + String(v.skill || '').replace(/"/g, '&quot;') + '" ' + field + '>' +
      '<textarea id="le-skill-content" rows="12" placeholder="SKILL.md contents" style="background:#0b0d10;border:1px solid #222;color:#ccc;padding:6px;border-radius:6px;font-family:monospace;font-size:11px"></textarea>' +
      '<div style="display:flex;gap:6px">' +
        '<button class="btn btn-sm" id="le-save">Save</button>' +
        '<button class="btn btn-sm" id="le-delete">Delete</button>' +
        '<button class="btn btn-sm" id="le-cancel">Cancel</button>' +
        '<label style="margin-left:auto;color:#8b95a5"><input type="checkbox" id="le-enabled" ' + (v.enabled !== false ? 'checked' : '') + '> enabled</label>' +
      '</div>';
    $('le-goal').value = v.goal || '';
    loadSkillContent(v.skill);
    $('le-save').addEventListener('click', saveTalent);
    $('le-cancel').addEventListener('click', closeEditor);
    $('le-delete').addEventListener('click', function () {
      if (!currentId) { closeEditor(); return; }
      if (!confirm('Delete this talent?')) return;
      fetch('/api/mobile/talents?id=' + encodeURIComponent(currentId), { method: 'DELETE' })
        .then(function () { currentId = ''; closeEditor(); refreshTalents(); });
    });
    ed.style.display = 'flex';
  }

  function saveTalent() {
    var skillPath = $('le-skill-path').value.trim();
    var payload = {
      talent: {
        id: currentId,
        name: $('le-name').value || 'Untitled talent',
        description: $('le-desc').value,
        goal: $('le-goal').value,
        skill: skillPath,
        intervalMin: Number($('le-interval').value) || 0,
        intervalMaxMin: Number($('le-interval-max').value) || undefined,
        enabled: $('le-enabled').checked,
      },
      skillContent: $('le-skill-content').value,
    };
    fetch('/api/mobile/talents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.talent) currentId = d.talent.id;
      closeEditor();
      refreshTalents();
    });
  }

  var talentSel = $('talent-select');
  if (talentSel) talentSel.addEventListener('change', function () {
    var t = talents.filter(function (x) { return x.id === talentSel.value; })[0];
    if (t) openEditor(t); else closeEditor();
  });
  var newBtn = $('btn-talent-new');
  if (newBtn) newBtn.addEventListener('click', function () { currentId = ''; openEditor(null); });
  var skillPicker = $('talent-skill-picker');
  if (skillPicker) skillPicker.addEventListener('change', function () {
    if (!skillPicker.value) return;
    var opt = skillPicker.options[skillPicker.selectedIndex];
    currentId = '';
    openEditor({ id: '', name: opt.dataset.name || '', description: opt.dataset.desc || '', goal: '', skill: skillPicker.value, intervalMin: 0 });
    skillPicker.value = '';
  });

  refreshTalents();
  setInterval(refreshTalents, 8000);

  setInterval(refresh, 3000);
  setInterval(refreshFrame, 4000);
  refresh();
  refreshFrame();
  var sysHist = { cpu: [], gpu0: [], gpu1: [] };
  function spark(id, hist, color) {
    var c = document.getElementById(id);
    if (!c) return;
    var ctx = c.getContext('2d'), w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (hist.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.beginPath();
    for (var i = 0; i < hist.length; i++) {
      var x = (i / (hist.length - 1)) * w;
      var y = h - (Math.min(100, hist[i]) / 100) * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }
  function refreshSys() {
    fetch('/api/sys', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (d) {
      var g = d.gpus || [];
      sysHist.cpu.push(d.cpu || 0);
      sysHist.gpu0.push((g[0] && g[0].util) || 0);
      sysHist.gpu1.push((g[1] && g[1].util) || 0);
      while (sysHist.cpu.length > 30) { sysHist.cpu.shift(); sysHist.gpu0.shift(); sysHist.gpu1.shift(); }
      spark('sys-cpu', sysHist.cpu, '#6fd0a0');
      spark('sys-gpu0', sysHist.gpu0, '#8fb0ff');
      spark('sys-gpu1', sysHist.gpu1, '#c9a0ff');
      var setv = function (id, v) { var e = document.getElementById(id); if (e) e.textContent = v + '%'; };
      setv('sys-cpu-v', d.cpu || 0);
      setv('sys-gpu0-v', (g[0] && g[0].util) || 0);
      setv('sys-gpu1-v', (g[1] && g[1].util) || 0);
      var m = document.getElementById('sys-mem');
      if (m && d.mem) m.textContent = 'RAM ' + d.mem.used + ' / ' + d.mem.total + ' MB';
    }).catch(function () {});
  }
  setInterval(refreshSys, 2000);
  refreshSys();
})();
