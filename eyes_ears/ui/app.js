/* ==========================================================================
   Warden voice console — single-page app logic
   --------------------------------------------------------------------------
   One document, one bridge. Everything below calls
   `window.pywebview.api.<method>()` DIRECTLY — there is no iframe
   postMessage shim anymore. Python pushes state into this page by evaluating
   `holoBroadcast({...})`; that global is defined near the bottom of this file
   and is the receiving end of the status-bar/wake/audio channel.
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* DOM helpers                                                         */
  /* ------------------------------------------------------------------ */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const on = (el, ev, fn, opts) => { if (el) el.addEventListener(ev, fn, opts); };

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = (s == null ? '' : String(s));
    return d.innerHTML;
  }

  /* ------------------------------------------------------------------ */
  /* Bridge                                                              */
  /* ------------------------------------------------------------------ */
  // pywebview injects window.pywebview.api after the document loads. Every
  // call waits for it instead of firing early (the old iframe shim problem).
  let bridgePromise = null;

  function hasBridge() {
    return !!(window.pywebview && window.pywebview.api);
  }

  function waitForBridge(timeoutMs) {
    if (bridgePromise) return bridgePromise;
    bridgePromise = new Promise(function (resolve) {
      if (hasBridge()) { resolve(true); return; }
      const deadline = Date.now() + (timeoutMs || 15000);
      const timer = setInterval(function () {
        if (hasBridge()) { clearInterval(timer); resolve(true); return; }
        if (Date.now() > deadline) { clearInterval(timer); resolve(false); }
      }, 120);
      // pywebview also fires this event; use it as an instant wake-up.
      window.addEventListener('pywebviewready', function () {
        if (hasBridge()) { clearInterval(timer); resolve(true); }
      });
    });
    return bridgePromise;
  }

  function bridgeCall(method, args) {
    return waitForBridge(15000).then(function (ready) {
      if (!ready || !hasBridge() || typeof window.pywebview.api[method] !== 'function') {
        throw new Error('bridge method "' + method + '" is not available');
      }
      return Promise.resolve(window.pywebview.api[method].apply(window.pywebview.api, args || []));
    });
  }

  // Warden HTTP proxy. Returns the raw response body, or '' on failure.
  function wapi(path, method, body) {
    return bridgeCall('warden_api', [path, method || 'GET', body || '']);
  }

  async function wjson(path, method, body) {
    const raw = await wapi(path, method, body);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /* ------------------------------------------------------------------ */
  /* App state                                                           */
  /* ------------------------------------------------------------------ */
  const State = {
    view: 'chat',
    voice: 'idle',
    audioLevel: 0,
    reachable: null,
    wardenUrl: '',
    satelliteHost: '',
    wake: { active: false, mode: '' },
    timer: null,
    sse: null,
  };

  const VIEW_META = {
    chat:     { title: 'Direct Line',   sub: 'secure channel' },
    digest:   { title: 'Iris Digest',   sub: 'automated summaries' },
    tasks:    { title: 'Ops',           sub: 'inbox · work · schedules' },
    upload:   { title: 'Upload',        sub: 'shared workspace' },
    agents:   { title: 'Agents',        sub: 'live roster' },
    galaxy:   { title: 'Memory Galaxy', sub: 'the brain' },
    settings: { title: 'Settings',      sub: 'connection & audio' },
  };

  function hostLabel(url) {
    const u = (url || State.wardenUrl || '').replace(/\/+$/, '');
    if (!u) return 'localhost:3200';
    return u.replace(/^https?:\/\//, '');
  }

  /* ------------------------------------------------------------------ */
  /* Status bar                                                          */
  /* ------------------------------------------------------------------ */
  const VOICE_LABEL = {
    idle: 'Idle',
    listening: 'Listening',
    processing: 'Thinking',
    speaking: 'Speaking',
    error: 'Error',
  };

  function setVoiceState(state) {
    if (!VOICE_LABEL[state]) state = 'idle';
    State.voice = state;
    if (window.wardenOrb) window.wardenOrb.setState(state);
    const live = state !== 'idle' && state !== 'error';
    const panel = $('#voice-panel');
    if (panel) panel.classList.toggle('live', live);
    const orbState = $('#orbstate');
    if (orbState) orbState.textContent = state === 'idle' ? 'READY' : state.toUpperCase();
    const vlabel = $('#voice-label');
    if (vlabel) vlabel.textContent = state === 'idle' ? 'READY'
      : state === 'listening' ? 'LISTENING'
      : state === 'processing' ? 'PROCESSING'
      : state === 'speaking' ? 'SPEAKING' : 'ERROR';
    const kv = $('#set-voice-state');
    if (kv) kv.textContent = VOICE_LABEL[state];
  }

  function setWakeState(active, mode) {
    State.wake = { active: !!active, mode: mode || '' };
    const chip = $('#wake-chip');
    if (chip) chip.classList.toggle('on', !!active);
    const label = $('#wake-label');
    if (label) label.textContent = active ? ('Wake: ' + (mode || 'on')) : 'Wake: —';
    const kv = $('#set-wake-state');
    if (kv) kv.textContent = active ? (mode || 'active') : 'unavailable';
  }

  function setReachable(ok) {
    State.reachable = ok;
    const chip = $('#reach-chip');
    if (chip) {
      const dot = chip.querySelector('.status-dot');
      if (dot) {
        dot.style.background = ok ? 'var(--cyan)' : 'var(--red)';
        dot.style.boxShadow = ok ? '0 0 10px var(--cyan)' : '0 0 10px var(--red)';
      }
    }
    const host = $('#reach-host');
    if (host) host.textContent = ok ? 'ONLINE' : 'OFFLINE';
    const kv = $('#set-reach-state');
    if (kv) kv.textContent = ok ? 'online' : 'unreachable';
  }

  function updateVoiceMeter() {
    if (window.wardenOrb) window.wardenOrb.setAudioLevel(State.audioLevel || 0);
    const bars = $$('#voice-meter i');
    if (!bars.length) return;
    // Bridge audio level is documented 0..2; map it across five bars.
    const lvl = Math.max(0, Math.min(2, State.audioLevel || 0));
    for (let i = 0; i < bars.length; i++) {
      const wave = 0.5 + 0.5 * Math.sin(Date.now() / 110 + i * 1.1);
      const scale = 0.18 + Math.min(1, lvl * 0.55 + wave * lvl * 0.25);
      bars[i].style.transform = 'scaleY(' + scale.toFixed(3) + ')';
    }
  }

  function showTimer(timer) {
    if (!timer) return;
    State.timer = {
      id: timer.id,
      label: timer.label || 'Timer',
      remaining: Number(timer.seconds_remaining) || 0,
    };
    const chip = $('#timer-chip');
    if (chip) chip.hidden = false;
    renderTimer();
  }

  function clearTimer(id) {
    if (State.timer && (!id || State.timer.id === id)) {
      State.timer = null;
      const chip = $('#timer-chip');
      if (chip) chip.hidden = true;
    }
  }

  function renderTimer() {
    if (!State.timer) return;
    const t = State.timer;
    const s = Math.max(0, t.remaining);
    const mm = Math.floor(s / 60);
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    const label = $('#timer-label');
    if (label) label.textContent = t.label + ' · ' + mm + ':' + ss;
    const chip = $('#timer-chip');
    if (chip) chip.classList.toggle('on', s > 0);
    if (s <= 0) { State.timer = null; if (chip) chip.hidden = true; }
  }

  setInterval(function () {
    if (!State.timer) return;
    State.timer.remaining -= 1;
    renderTimer();
  }, 1000);

  /* ------------------------------------------------------------------ */
  /* Python → page state channel (extends the old holoBroadcast pattern)  */
  /* ------------------------------------------------------------------ */
  // The Python host still evaluates `window.holoBroadcast({cmd, ...})`.
  // Keep that name and shape stable — it is the live push path for the
  // status bar, the wake indicator, audio level and timers.
  window.holoBroadcast = function (msg) {
    if (!msg || !msg.cmd) return;
    try {
      if (msg.cmd === 'state') {
        setVoiceState(msg.state || 'idle');
      } else if (msg.cmd === 'audio') {
        State.audioLevel = Number(msg.level) || 0;
        updateVoiceMeter();
      } else if (msg.cmd === 'timer') {
        showTimer(msg.payload);
      } else if (msg.cmd === 'cleartimer') {
        clearTimer(msg.id);
      } else if (msg.cmd === 'wake') {
        setWakeState(!!msg.active, msg.mode || '');
      }
      // cmd 'mini' / 'removemini' are reserved mini-hologram stubs; the SPA
      // has no separate holograms, so they are intentionally ignored.
    } catch (e) { /* never let a bad push break the page */ }
  };

  // Also expose the SPA's own control surface for the host (mirrors the old
  // hologram's window API, now driven in-pane rather than from an iframe).
  window.wardenConsole = {
    setState: function (s) { setVoiceState(s); },
    setWake: function (active, mode) { setWakeState(active, mode); },
    setAudioLevel: function (l) { State.audioLevel = Number(l) || 0; updateVoiceMeter(); },
    view: function (name) { showView(name); },
  };

  /* ------------------------------------------------------------------ */
  /* Router                                                              */
  /* ------------------------------------------------------------------ */
  function openModule(name) {
    if (!name) return;
    const target = $('#mod-' + name);
    const wasOpen = target && target.classList.contains('open');
    $$('.module').forEach(function (p) { p.classList.remove('open'); });
    if (target && !wasOpen) target.classList.add('open');
    if (wasOpen) return; // clicking the active panel closes it
    if (name === 'galaxy') ensureGalaxy();
    else if (name === 'chat') refreshChat();
    else if (name === 'digest') refreshDigest();
    else if (name === 'tasks') refreshOps();
    else if (name === 'upload') { renderUploads(); refreshDownloads(); }
    else if (name === 'agents') refreshAgents();
    else if (name === 'systems') refreshSystems();
    else if (name === 'comms') refreshComms();
    try { localStorage.setItem('warden.module', name); } catch (e) { /* ignore */ }
  }

  function closeModule(name) {
    const p = $('#mod-' + name);
    if (p) p.classList.remove('open');
  }

  function showView(name) { openModule(name); }

  /* ------------------------------------------------------------------ */
  /* Live updates                                                        */
  /* ------------------------------------------------------------------ */
  const refreshTimers = {};
  function scheduleRefresh(key, ms) {
    if (refreshTimers[key]) clearTimeout(refreshTimers[key]);
    refreshTimers[key] = setTimeout(function () {
      refreshTimers[key] = null;
      if (key === 'chat') refreshChat();
      else if (key === 'digest') refreshDigest();
      else if (key === 'tasks') refreshOps();
      else if (key === 'agents') refreshAgents();
    }, ms || 500);
  }

  // SSE is the ideal live channel, but a file:// page in Qt WebEngine may
  // refuse the cross-origin EventSource. We TRY it, and every panel keeps its
  // bridge-polling loop as the transport that definitely works. Nothing
  // depends on the SSE connection.
  function startLiveUpdates() {
    if (!State.wardenUrl || typeof EventSource === 'undefined' || State.sse) return;
    try {
      const es = new EventSource(State.wardenUrl.replace(/\/+$/, '') + '/api/notifications');
      State.sse = es;
      es.onmessage = function (ev) {
        let d = null;
        try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (!d || !d.type) return;
        if (d.type === 'chat_complete') { scheduleRefresh('chat', 500); scheduleRefresh('digest', 2500); }
        else if (d.type === 'agent_activity') scheduleRefresh('agents', 900);
        else if (d.type === 'task') { scheduleRefresh('tasks', 900); scheduleRefresh('digest', 2500); }
        else if (d.type === 'alarm') {
          const chip = $('#timer-chip');
          if (chip) chip.classList.add('on');
        }
      };
      es.onerror = function () {
        // Direct SSE blocked (file:// origin) or Warden restarted — the
        // polling loops already cover every view. Drop the handle so a
        // later bridge-aware retry can take over.
        try { es.close(); } catch (e) { /* ignore */ }
      if (State.sse === es) State.sse = null;
      };
    } catch (e) {
      State.sse = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Command wheel (radial module menu)                                  */
  /* ------------------------------------------------------------------ */
  const WHEEL_MODULES = [
    { key: 'comms',   icon: '\u{1F4AC}', label: 'Comms' },
    { key: 'chat',    icon: '⌁',   label: 'Chat' },
    { key: 'digest',  icon: '◈',   label: 'Briefing' },
    { key: 'tasks',   icon: '▣',   label: 'Ops' },
    { key: 'agents',  icon: '⬡',   label: 'Agents' },
    { key: 'systems', icon: '◉',   label: 'Systems' },
    { key: 'galaxy',  icon: '✦',   label: 'Memory' },
    { key: 'upload',  icon: '⤓',   label: 'Files' },
  ];

  function setWheelBadge(key, n) {
    const el = $('#wc-' + key);
    if (!el) return;
    el.textContent = (n == null || n === '' || n === 0) ? '' : String(n);
  }

  const QUICK_COMMANDS = [
    'Summarize my unread messages',
    'What is on my schedule for tomorrow?',
    'What tasks do I have left today?',
    'Draft a reply to my most important message',
    'Any conflicts I need to resolve?',
  ];

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Good night';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  function renderHeader() {
    const g = $('#greet');
    if (g) g.textContent = greeting();
    const dt = $('#date-text');
    if (dt) dt.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  function renderChips() {
    const box = $('#chips');
    if (!box) return;
    box.innerHTML = QUICK_COMMANDS.map(function (c) {
      return '<button class="action-btn" data-cmd="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('');
  }

  function fmtEventTime(t) {
    const d = new Date(t);
    if (isNaN(d.getTime())) return '';
    const day = function (x) { const y = new Date(x); y.setHours(0, 0, 0, 0); return y; };
    const diff = Math.round((day(d) - day(new Date())) / 86400000);
    const hm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diff === 0) return 'today ' + hm;
    if (diff === 1) return 'tomorrow ' + hm;
    if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + hm;
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderNextEvents(events) {
    const box = $('#next-events');
    if (!box) return;
    const now = Date.now();
    const seen = {};
    const next = [];
    for (const e of events) {
      if (!e || !e.start_time) continue;
      const t = new Date(e.start_time).getTime();
      if (isNaN(t) || t < now) continue;
      if (/holiday/i.test(e.provider_calendar_name || '')) continue;
      const key = e.title || '';
      if (seen[key]) continue; // collapse daily recurrences to one entry
      seen[key] = true;
      next.push(e);
      if (next.length >= 3) break;
    }
    if (!next.length) { box.innerHTML = '<div class="glance-empty">No upcoming events.</div>'; return; }
    box.innerHTML = next.map(function (e) {
      return '<div class="glance-item"><span class="g-txt">' + esc(e.title || 'Event') + '</span><span class="g-time">' + esc(fmtEventTime(e.start_time)) + '</span></div>';
    }).join('');
  }

  function isBulkEmail(e) {
    const body = (e.body || '').toLowerCase();
    const from = (e.from || '').toLowerCase();
    const subj = (e.subject || '').toLowerCase();
    if (body.indexOf('unsubscribe') >= 0) return true;
    if (/noreply|no-reply|newsletter|digest|marketing|info@|updates@|team@|ambassador|calendar-notification/.test(from)) return true;
    if (/newsletter|digest|weekly roundup|promotion/.test(subj)) return true;
    return false;
  }

  function renderEmails(accounts) {
    const box = $('#important-emails');
    if (!box) return;
    const acct = (accounts && accounts[0]) || null;
    if (!acct) { box.innerHTML = '<div class="glance-empty">No email account linked.</div>'; return; }
    wjson('/api/email/inbox?accountId=' + encodeURIComponent(acct.id) + '&limit=30').then(function (d) {
      const emails = ((d && d.emails) || []).filter(function (e) { return !isBulkEmail(e); }).slice(0, 3);
      if (!emails.length) { box.innerHTML = '<div class="glance-empty">Nothing important in inbox.</div>'; return; }
      box.innerHTML = emails.map(function (e) {
        const sender = String(e.from || '').replace(/<[^>]*>/g, '').trim().slice(0, 22);
        return '<div class="glance-item email"><span class="g-txt">' + esc(sender || 'Unknown') + '<span class="g-sub">' + esc(String(e.subject || '(no subject)').slice(0, 40)) + '</span></span></div>';
      }).join('');
    }).catch(function () { box.innerHTML = '<div class="glance-empty">Email unavailable.</div>'; });
  }

  function renderDashboard() {
    // Tasks (open reminders + work tasks only — completed ones leave the list).
    Promise.all([wjson('/api/tasks'), wjson('/api/work-tasks')]).then(function (r) {
      const reminders = ((r[0] && r[0].tasks) || []).filter(function (x) { return x.schedule_type === 'once' && x.status === 'active'; });
      const work = ((r[1] && r[1].tasks) || []).filter(function (x) { return !/complet|done|closed/i.test(x.status || ''); });
      const items = reminders.map(function (x) { return { id: x.id, type: 'task', text: x.prompt || 'Reminder' }; })
        .concat(work.map(function (x) { return { id: x.id, type: 'work', text: x.title || 'Task' }; }));
      const list = $('#mission-list');
      const count = $('#mission-count');
      if (count) count.textContent = String(items.length).padStart(2, '0') + ' ACTIVE';
      if (!items.length) { list.innerHTML = '<div class="mission-item"><div class="mission-check"></div><span>All clear.</span></div>'; return; }
      list.innerHTML = items.map(function (m) {
        return '<div class="mission-item" data-type="' + m.type + '" data-id="' + esc(m.id || '') + '"><div class="mission-check"></div><span>' + esc(String(m.text).slice(0, 50)) + '</span></div>';
      }).join('');
    }).catch(function () {});

    // Primary directives.
    Promise.all([wjson('/api/tasks'), wjson('/api/work-tasks')]).then(function (r) {
      const reminders = ((r[0] && r[0].tasks) || []).filter(function (x) { return x.schedule_type === 'once' && x.status !== 'paused'; });
      const work = ((r[1] && r[1].tasks) || []).filter(function (x) { return !/complet|done|closed/i.test(x.status || ''); });
      const all = reminders.map(function (x) { return x.prompt || 'Reminder'; }).concat(work.map(function (x) { return x.title || 'Task'; })).slice(0, 5);
      const box = $('#directive-list');
      if (!all.length) { box.innerHTML = '<div class="directive-block"><div class="directive-text">No directives.</div></div>'; return; }
      box.innerHTML = all.map(function (t, i) {
        return '<div class="directive-block"><div class="directive-priority">' + String(i + 1).padStart(2, '0') + '</div><div class="directive-text">' + esc(String(t).slice(0, 60)) + '</div></div>';
      }).join('');
    }).catch(function () {});

    // At-a-glance: task/agent stats + next 3 events + important emails.
    Promise.all([wjson('/api/tasks'), wjson('/api/work-tasks'), wjson('/api/status'), wjson('/api/calendar/events'), wjson('/api/email/accounts')]).then(function (r) {
      const tasks = ((r[0] && r[0].tasks) || []).filter(function (x) { return x.schedule_type === 'once' && x.status === 'active'; });
      const work = ((r[1] && r[1].tasks) || []).filter(function (x) { return !/complet|done|closed/i.test(x.status || ''); });
      const groups = (r[2] && r[2].groups) || [];
      const active = groups.filter(function (g) { return g.active; }).length;
      const set = function (id, v) { const el = $(id); if (el) el.textContent = String(v).padStart(2, '0'); };
      set('#bio-1', tasks.length + work.length);
      set('#bio-4', active);

      renderNextEvents((r[3] && r[3].events) || []);
      renderEmails(r[4] && r[4].accounts);
    }).catch(function () {});

    // Anomalies (conflicts).
    wjson('/api/scan/inbox').then(function (st) {
      const n = ((st && st.tasks) || []).length + ((st && st.events) || []).length;
      const c = $('#anomaly-count');
      if (c) c.textContent = String(n).padStart(2, '0');
      const t = $('#anomaly-text');
      if (t) t.textContent = n ? (n + ' CONFLICT' + (n === 1 ? '' : 'S') + ' DETECTED') : 'NO CONFLICTS DETECTED';
    }).catch(function () {});

    // Direct messages — WhatsApp DMs + Slack mentions (channel-delivered msgs).
    wjson('/api/messages?limit=300').then(function (d) {
      const arr = ((d && d.messages) || []).filter(function (m) {
        return m && !m.is_bot_message && (m.channel === 'whatsapp' || m.channel === 'slack' || m.channel === 'telegram' || m.channel === 'email');
      });
      // Dedupe repeats (same sender + content) so a burst shows once.
      const seen = {};
      const dm = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const m = arr[i];
        const k = (m.sender || '') + '|' + (m.content || '');
        if (seen[k]) continue;
        seen[k] = true;
        dm.unshift(m);
        if (dm.length >= 8) break;
      }
      const count = $('#comms-count');
      if (count) count.textContent = String(dm.length).padStart(2, '0') + ' DM';
      const list = $('#comms-list');
      if (!dm.length) { list.innerHTML = '<div class="comm-item"><span class="comm-sender">NO DIRECT MESSAGES</span><span class="comm-time">—</span></div>'; return; }
      list.innerHTML = dm.map(function (m) {
        const who = String(m.sender_name || m.sender || m.channel || 'unknown').toUpperCase().slice(0, 16);
        const ch = String(m.channel || '').toUpperCase();
        return '<div class="comm-item"><span class="comm-sender">' + esc(who) + ' <span style="color:var(--text-dim);font-weight:normal;font-size:0.6rem">' + esc(ch) + '</span></span><span class="comm-time">' + esc(String(m.content || '').slice(0, 42)) + '</span></div>';
      }).join('');
    }).catch(function () {});

    // Data stream ticker.
    wjson('/api/status').then(function (d) {
      const groups = (d && d.groups) || [];
      const active = groups.filter(function (g) { return g.active; }).length;
      const liveLabel = groups[0] && groups[0].liveLabel;
      const lines = [
        'WARDEN ONLINE',
        'SYSTEMS NOMINAL',
        (active ? active + ' AGENTS ACTIVE' : 'AGENTS IDLE'),
        (liveLabel ? esc(liveLabel) : 'AWAITING INPUT'),
        'SYNC COMPLETE',
        'ALL SYSTEMS GO',
      ];
      const stream = $('#data-stream');
      if (stream) {
        const seg = lines.map(function (l) { return l + ' <span>•</span> '; }).join('');
        stream.innerHTML = seg + seg;
      }
    }).catch(function () {});
  }

  /* ------------------------------------------------------------------ */
  /* SYSTEMS + COMMS modules                                             */
  /* ------------------------------------------------------------------ */
  function renderSystems(d) {
    const body = $('#systems-body');
    if (!body) return;
    if (!d) { body.innerHTML = '<div class="empty">Warden status unavailable.</div>'; return; }
    const sys = d.system || {};
    const up = d.uptime || 0;
    const upStr = up >= 86400 ? Math.floor(up / 86400) + 'd ' + Math.floor(up % 86400 / 3600) + 'h'
      : Math.floor(up / 3600) + 'h ' + Math.floor(up % 3600 / 60) + 'm';
    const rows = [
      ['Warden', d.assistant || 'WARDEN', null],
      ['Uptime', upStr, null],
      ['CPU', (sys.cpuPercent != null ? (+sys.cpuPercent).toFixed(0) : '—') + '%', sys.cpuPercent],
      ['Memory', (sys.memPercent != null ? (+sys.memPercent).toFixed(0) : '—') + '%', sys.memPercent],
      ['Running jobs', String(d.runningJobs != null ? d.runningJobs : '—'), null],
      ['Containers', String(d.activeContainers != null ? d.activeContainers : '—'), null],
      ['Scheduled tasks', String(d.scheduledTasks != null ? d.scheduledTasks : '—'), null],
      ['Model', d.ollamaChatModel || '—', null],
    ];
    body.innerHTML = rows.map(function (rr) {
      const bar = (typeof rr[2] === 'number') ? '<div class="sys-bar"><i style="width:' + Math.min(100, rr[2]) + '%"></i></div>' : '';
      return '<div class="sys-row"><span class="k">' + esc(rr[0]) + '</span><span class="v">' + esc(rr[1]) + '</span>' + bar + '</div>';
    }).join('');
  }

  async function refreshSystems() {
    if (!hasBridge()) return;
    try { const d = await wjson('/api/status'); renderSystems(d); } catch (e) { renderSystems(null); }
  }

  function renderComms(d) {
    const body = $('#comms-body');
    if (!body) return;
    const arr = (d && d.messages) || [];
    setWheelBadge('comms', arr.length);
    if (!arr.length) {
      body.innerHTML = '<div class="empty">No connectors configured yet.<br><br>Warden will aggregate Slack, Signal, Discord, KDE Connect &amp; SMS here once their bridges are connected.</div>';
      return;
    }
    body.innerHTML = arr.map(function (m) {
      return '<div class="item"><div class="it-title"><span class="phase-badge" style="color:var(--cyan);border-color:var(--cyan)">' + esc(m.channel || m.source || '?') + '</span> ' + esc(m.sender || '') + '</div>' +
        '<div class="it-sub">' + esc(m.text || '') + '</div>' +
        (m.ts ? '<div class="it-sub" style="color:var(--text-faint)">' + esc(fmtTs(m.ts)) + '</div>' : '') + '</div>';
    }).join('');
  }

  async function refreshComms() {
    try { const d = await wjson('/api/comms'); renderComms(d); } catch (e) { renderComms(null); }
  }

  async function sendComms() {
    const inp = $('#comms-input');
    const text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    try {
      await wjson('/api/comms/send', 'POST', JSON.stringify({ channel: $('#comms-channel').value, text: text }));
    } catch (e) { /* ignore */ }
    refreshComms();
  }

  function openSettings() { $('#settings-overlay').classList.add('open'); loadSettingsFields(); }
  function closeSettings() { $('#settings-overlay').classList.remove('open'); }

  /* ------------------------------------------------------------------ */
  /* Init / config                                                       */
  /* ------------------------------------------------------------------ */
  async function loadConfig() {
    try {
      const raw = await bridgeCall('get_widget_config', []);
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg && cfg.warden_url) State.wardenUrl = cfg.warden_url;
      }
    } catch (e) { /* older host or bridge not ready */ }
    try {
      const raw = await bridgeCall('get_state', []);
      if (raw) {
        const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (st) {
          if (st.warden_url) State.wardenUrl = st.warden_url;
          if (st.satellite_host != null) State.satelliteHost = st.satellite_host;
          if (st.state) setVoiceState(st.state);
          if (st.wake) setWakeState(!!st.wake.active, st.wake.mode || '');
        }
      }
    } catch (e) { /* get_state is new; ignore when absent */ }
    setReachable(State.reachable);
    updateHostLabels();
  }

  function updateHostLabels() {
    const host = hostLabel();
    const reach = $('#reach-host');
    if (reach && State.reachable == null) reach.textContent = host;
    const side = $('#side-host');
    if (side) side.textContent = host;
    const active = $('#set-warden-url');
    if (active && !active.value) active.value = State.wardenUrl;
    const sat = $('#set-satellite-host');
    if (sat && !sat.value) sat.value = State.satelliteHost;
  }

  async function pollHealth() {
    if (!hasBridge()) { setReachable(false); return; }
    try {
      const raw = await wapi('/api/health');
      let ok = false;
      if (raw) {
        try { ok = JSON.parse(raw).status === 'ok'; } catch (e) { ok = true; }
      }
      setReachable(ok);
    } catch (e) {
      setReachable(false);
    }
  }

  function startPolling() {
    pollHealth();
    setInterval(pollHealth, 10000);
    setInterval(refreshChat, 8000);
    setInterval(refreshOps, 15000);
    setInterval(refreshAgents, 5000);
    setInterval(refreshDigest, 20000);
    setInterval(refreshDownloads, 15000);
    setInterval(refreshSystems, 5000);
    setInterval(refreshComms, 10000);
    setInterval(renderDashboard, 5000);
  }

  /* ================================================================== */
  /* CHAT                                                                */
  /* ================================================================== */
  const Chat = {
    loading: false,
    renderedIds: new Set(),
    localRenders: [],
    serverBotRenders: [],
  };

  function chatEmpty() {
    let el = $('#chat-list .empty');
    if (!el) {
      el = document.createElement('div');
      el.className = 'empty';
      el.textContent = 'Direct line to Warden. Type a message.';
      $('#chat-list').appendChild(el);
    }
    return el;
  }

  function fmtTs(ts) {
    let d;
    if (!ts) d = new Date();
    else if (typeof ts === 'number') d = new Date(ts);
    else if (typeof ts === 'string' && /^\d+$/.test(ts)) d = new Date(parseInt(ts, 10));
    else d = new Date(ts);
    if (isNaN(d)) d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function msOf(ts) {
    if (!ts) return Date.now();
    if (typeof ts === 'number') return ts;
    if (typeof ts === 'string' && /^\d+$/.test(ts)) return parseInt(ts, 10);
    const d = new Date(ts);
    return isNaN(d) ? Date.now() : d.getTime();
  }

  function renderChatMessage(role, text, ts, opts) {
    const empty = chatEmpty();
    if (empty && empty.parentNode) empty.remove();
    // Any real assistant line ends the transient thinking indicator.
    if (role === 'jarvis' && !(opts && opts.thinking)) {
      const old = document.getElementById('chat-thinking');
      if (old && old.parentNode) old.remove();
    }
    const div = document.createElement('div');
    div.className = 'msg ' + role;
    const sender = document.createElement('span');
    sender.className = 'sender';
    sender.textContent = role === 'user' ? 'You' : 'Warden';
    div.appendChild(sender);
    if (opts && opts.thinking) {
      const think = document.createElement('span');
      think.className = 'thinking';
      think.innerHTML = '<i></i><i></i><i></i>';
      div.appendChild(think);
    } else {
      div.appendChild(document.createTextNode(text == null ? '' : String(text)));
    }
    const stamp = document.createElement('span');
    stamp.className = 'ts';
    stamp.textContent = opts && opts.thinking ? '' : fmtTs(ts);
    div.appendChild(stamp);
    div.setAttribute('data-ms', String(msOf(ts)));
    if (opts && opts.thinking) div.id = 'chat-thinking';
    $('#chat-list').appendChild(div);
    $('#chat-list').scrollTop = $('#chat-list').scrollHeight;
    return div;
  }

  function ensureChatOrder() {
    const list = $('#chat-list');
    const kids = $$('.msg', list);
    let prev = -1, outOfOrder = false;
    kids.forEach(function (k) {
      const ms = parseInt(k.getAttribute('data-ms') || '0', 10);
      if (ms < prev) outOfOrder = true;
      prev = ms;
    });
    if (!outOfOrder) return;
    kids.sort(function (a, b) {
      return parseInt(a.getAttribute('data-ms') || '0', 10) - parseInt(b.getAttribute('data-ms') || '0', 10);
    });
    kids.forEach(function (k) { list.appendChild(k); });
    list.scrollTop = list.scrollHeight;
  }

  function addLocalRender(role, text) {
    Chat.localRenders.push({ role: role, text: text, ts: Date.now() });
    const cutoff = Date.now() - 60000;
    Chat.localRenders = Chat.localRenders.filter(function (r) { return r.ts >= cutoff; });
  }

  function isLocalDuplicate(m) {
    const role = m.is_bot_message ? 'jarvis' : 'user';
    const mTs = new Date(m.timestamp || 0).getTime();
    for (let i = Chat.localRenders.length - 1; i >= 0; i--) {
      const r = Chat.localRenders[i];
      if (r.role === role && r.text === m.content && Math.abs(mTs - r.ts) < 30000) return true;
    }
    return false;
  }

  function seenByPoll(text) {
    return Chat.serverBotRenders.indexOf(text) !== -1;
  }

  async function refreshChat() {
    if (!hasBridge() || Chat.loading) return;
    Chat.loading = true;
    try {
      const raw = await wapi('/api/messages?limit=100');
      if (!raw) return;
      const d = JSON.parse(raw);
      const arr = (d && d.messages) || [];
      arr.forEach(function (m) {
        if (!m || typeof m.content !== 'string' || !m.content) return;
        if (m.id && Chat.renderedIds.has(m.id)) return;
        if (isLocalDuplicate(m)) return;
        if (m.id) Chat.renderedIds.add(m.id);
        if (m.is_bot_message) {
          Chat.serverBotRenders.push(m.content);
          if (Chat.serverBotRenders.length > 50) Chat.serverBotRenders = Chat.serverBotRenders.slice(-50);
        }
        renderChatMessage(m.is_bot_message ? 'jarvis' : 'user', m.content, m.timestamp);
      });
      ensureChatOrder();
    } catch (e) {
      /* Warden momentarily unreachable — next poll retries */
    } finally {
      Chat.loading = false;
    }
  }

  function addChatMessage(role, text) {
    if (role === 'jarvis' && seenByPoll(text)) {
      addLocalRender(role, text);
      return;
    }
    addLocalRender(role, text);
    renderChatMessage(role, text, null);
  }

  async function sendChat() {
    const input = $('#chat-input');
    const text = input.value.trim();
    if (!text) return;
    addChatMessage('user', text);
    input.value = '';
    const btn = $('#chat-send');
    btn.disabled = true;
    const thinking = renderChatMessage('jarvis', '', null, { thinking: true });
    try {
      if (!hasBridge()) throw new Error('bridge unavailable');
      // Ingest only: POST /api/messages stores the message; the reply arrives
      // through the history poll / SSE. No synchronous round-trip to block on.
      const raw = await wapi('/api/messages', 'POST', JSON.stringify({ text: text }));
      if (!raw) throw new Error('empty response');
    } catch (e) {
      if (thinking && thinking.parentNode) thinking.remove();
      addChatMessage('jarvis', '[unavailable]');
    } finally {
      btn.disabled = false;
      scheduleRefresh('chat', 1200);
      setTimeout(refreshChat, 3500);
      setTimeout(refreshChat, 9000);
    }
  }

  /* ================================================================== */
  /* DIGEST                                                              */
  /* ================================================================== */
  const Digest = { span: 'hourly', genBusy: false, lookoutTimer: null, loadedLookout: false };

  function digestSpanIcon(span) {
    return { hourly: '🕒', daily: '📋', weekly: '🗓️' }[span] || '';
  }
  function digestSpanTitle(span) {
    return { hourly: 'Hourly Digest', daily: 'Daily Digest', weekly: 'Weekly Roundup' }[span] || '';
  }
  const DIGEST_ICONS = { inbox: '📦', calendar: '📅', tasks: '✅', weather: '🌤️', nudge: '💡', review: '📝', tomorrow: '👀' };

  function inlineMd(s) {
    let h = s;
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return h;
  }

  function badgeFrom(s) {
    return s.replace(/^\[([a-zA-Z -]+)\]\s*/, function (m, stat) {
      const c = stat.toLowerCase().replace(/\s/g, '-');
      return '<span class="badge ' + c + '">' + stat + '</span> ';
    });
  }

  function renderMarkdown(text) {
    let h = esc(text || '');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    h = h.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
    const lines = h.split(/\n/), out = [];
    let inList = false, para = [], tblRows = [];
    const flush = function () {
      if (para.length) {
        const joined = para.join(' ');
        const cls = /<strong>[^<]*Review/i.test(joined) ? ' class="review"' : '';
        out.push('<p' + cls + '>' + joined + '</p>');
        para = [];
      }
    };
    const closeList = function () { if (inList) { out.push('</ul>'); inList = false; } };
    const flushTable = function () {
      if (!tblRows.length) return;
      let html = '<table>', headerDone = false;
      for (let r = 0; r < tblRows.length; r++) {
        const cells = tblRows[r].replace(/^\s*\|\s*|\s*\|\s*$/g, '').split(/\s*\|\s*/);
        const isSep = cells.every(function (c) { return /^:?-{3,}:?$/.test(c.trim()); });
        if (isSep && r === 1 && !headerDone) { headerDone = true; continue; }
        if (isSep) continue;
        const tag = (!headerDone && r === 0) ? 'th' : 'td';
        html += '<tr>' + cells.map(function (c) { return '<' + tag + '>' + c.trim() + '</' + tag + '>'; }).join('') + '</tr>';
        if (r === 0 && !headerDone) headerDone = true;
      }
      html += '</table>';
      out.push(html);
      tblRows = [];
    };
    const isTableRow = function (l) { return /^\s*\|.*\|\s*$/.test(l); };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isTableRow(line)) { closeList(); flush(); tblRows.push(line); }
      else if (tblRows.length) flushTable();
      if (isTableRow(line)) continue;
      if (/^\s*###\s+/.test(line)) { closeList(); flush(); out.push('<h4>' + line.replace(/^\s*###\s+/, '') + '</h4>'); }
      else if (/^\s*##\s+/.test(line)) { closeList(); flush(); out.push('<h3>' + line.replace(/^\s*##\s+/, '') + '</h3>'); }
      else if (/^\s*#\s+/.test(line)) { closeList(); flush(); out.push('<h3>' + line.replace(/^\s*#\s+/, '') + '</h3>'); }
      else if (/^\s*[-*]\s+/.test(line)) {
        flush();
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + badgeFrom(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
      }
      else if (/^\s*---+\s*$/.test(line)) { closeList(); flush(); out.push('<hr>'); }
      else if (line.trim() === '') { closeList(); flush(); }
      else { closeList(); para.push(line); }
    }
    flushTable(); closeList(); flush();
    return out.join('');
  }

  function digestBalanced(raw, j, open, close) {
    let depth = 0, inStr = false, escape = false;
    for (let p = j; p < raw.length; p++) {
      const c = raw.charAt(p);
      if (inStr) {
        if (escape) escape = false;
        else if (c === '\\') escape = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return p; }
    }
    return -1;
  }

  function parseDigestLoose(raw) {
    const blocks = [];
    let i = 0;
    while (true) {
      const k = raw.indexOf('"blocks"', i);
      if (k < 0) break;
      let j = k + 8;
      while (j < raw.length && /[\s:]/.test(raw.charAt(j))) j++;
      const ch = raw.charAt(j);
      if (ch !== '[' && ch !== '{') { i = k + 8; continue; }
      const end = digestBalanced(raw, j, ch, ch === '[' ? ']' : '}');
      if (end < 0) { i = k + 8; continue; }
      try {
        const val = JSON.parse(raw.slice(j, end + 1));
        if (Array.isArray(val)) { for (let x = 0; x < val.length; x++) blocks.push(val[x]); }
        else blocks.push(val);
      } catch (e) { /* keep scanning */ }
      i = end + 1;
    }
    let title = '', summary = '', alerts = [];
    let full = null;
    try { full = JSON.parse(raw); } catch (e) { /* loose */ }
    if (full) {
      title = full.title || '';
      summary = full.summary || '';
      if (Array.isArray(full.alerts)) alerts = full.alerts;
      else if (typeof full.alerts === 'string') alerts = [full.alerts];
    }
    if (!blocks.length && full) {
      if (Array.isArray(full.blocks)) blocks = full.blocks.slice();
      else if (full.blocks && typeof full.blocks === 'object') blocks = [full.blocks];
    }
    return { title: title, summary: summary, alerts: alerts, blocks: blocks };
  }

  function renderDigestData(d) {
    let out = '';
    let alerts = d.alerts;
    if (typeof alerts === 'string') alerts = [alerts];
    if (Array.isArray(alerts) && alerts.length) {
      out += '<div class="alerts"><div class="alerts-head">⚠️ Alerts</div><ul>';
      alerts.forEach(function (a) { out += '<li>' + inlineMd(esc(a)) + '</li>'; });
      out += '</ul></div>';
    }
    if (d.title) {
      out += '<div class="digest-title">' + esc(digestSpanIcon(Digest.span) + ' ' + digestSpanTitle(Digest.span) + ' — ' + d.title) + '</div>';
    }
    if (d.summary && String(d.summary).trim()) {
      out += '<div class="digest-summary">' + inlineMd(esc(d.summary)) + '</div>';
    }
    const blocks = Array.isArray(d.blocks) ? d.blocks : (d.blocks ? [d.blocks] : []);
    blocks.forEach(function (b) {
      const icon = DIGEST_ICONS[b.icon] || '';
      const label = esc(b.label || '');
      if (b.type === 'list') {
        const itemLine = function (x) {
          if (x && typeof x === 'object') {
            try {
              const get = function (keys) {
                for (let i = 0; i < keys.length; i++) {
                  const k = Object.keys(x).find(function (kk) { return kk.toLowerCase() === keys[i]; });
                  if (k && x[k]) return x[k];
                }
                return null;
              };
              const parts = [
                get(['from']) ? ('From: ' + get(['from'])) : null,
                get(['subject']), get(['date', 'time']), get(['snippet', 'body', 'content'])
              ].filter(Boolean);
              return parts.join(' — ') || JSON.stringify(x);
            } catch (e) { return ''; }
          }
          return x;
        };
        const items = (b.items || []).map(itemLine).filter(function (x) { return x && String(x).trim().length; });
        if (!items.length) return;
        out += '<div class="block"><strong>' + (icon ? icon + ' ' : '') + label + '</strong><ul>';
        items.forEach(function (it) { out += '<li>' + badgeFrom(inlineMd(esc(it))) + '</li>'; });
        out += '</ul></div>';
      } else {
        const text = (b.text || '').trim();
        if (!text) return;
        const cls = /review/i.test(b.label || '') ? ' class="review"' : '';
        out += '<div class="block"><strong>' + (icon ? icon + ' ' : '') + label + '</strong><p' + cls + '>' + inlineMd(esc(text)) + '</p></div>';
      }
    });
    return out;
  }

  function renderDigestOrMd(text) {
    if (text) {
      let s = String(text).trim();
      const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenced) s = fenced[1].trim();
      if (s.charAt(0) === '{') {
        const d = parseDigestLoose(s);
        if (d && (d.blocks.length || d.title || d.alerts.length || d.summary)) return renderDigestData(d);
      }
    }
    return renderMarkdown(text);
  }

  function showDigestEmpty() {
    $('#digest-body').innerHTML = '<div class="empty">No digest yet — Iris compiles these automatically.</div>';
    $('#digest-ts').textContent = '';
  }

  async function fetchDigest(span, render) {
    const useSpan = span || Digest.span;
    const doRender = render !== false;
    if (Digest.span === 'actionable') return '';
    try {
      const raw = await wapi('/api/summaries?span=' + encodeURIComponent(useSpan));
      if (!raw) { if (doRender) showDigestEmpty(); return ''; }
      const d = JSON.parse(raw);
      if (!d || !d.summaries || !d.summaries.length) { if (doRender) showDigestEmpty(); return ''; }
      const s = d.summaries[0];
      if (doRender) {
        $('#digest-body').innerHTML = '<div class="summary-text">' + renderDigestOrMd(s.text) + '</div>';
        $('#digest-ts').textContent = s.generated_at || '';
      }
      return s.generated_at || '';
    } catch (e) {
      if (doRender) showDigestEmpty();
      return '';
    }
  }

  async function refreshDigest() {
    if (!hasBridge()) return;
    if (Digest.span === 'actionable') { fetchScan(); return; }
    fetchDigest();
  }

  function setDigestTab(span) {
    Digest.span = span;
    $$('#digest-tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-span') === span);
    });
    const isScan = span === 'actionable';
    $('#digest-body').hidden = isScan;
    $('#digest-scan').hidden = !isScan;
    const lookout = $('#lookout');
    if (lookout) lookout.hidden = isScan;
    const gen = $('#digest-generate');
    if (gen) gen.style.visibility = isScan ? 'hidden' : 'visible';
    refreshDigest();
  }

  async function loadLookout() {
    if (Digest.loadedLookout) return;
    try {
      const d = await wjson('/api/lookout');
      if (d && typeof d.text === 'string') {
        $('#lookout-input').value = d.text;
        Digest.loadedLookout = true;
      }
    } catch (e) { /* bridge not ready */ }
  }

  async function saveLookout() {
    if (Digest.lookoutTimer) { clearTimeout(Digest.lookoutTimer); Digest.lookoutTimer = null; }
    const status = $('#lookout-status');
    try {
      if (!hasBridge()) return;
      status.textContent = 'saving…';
      status.classList.remove('err');
      await wapi('/api/lookout', 'POST', JSON.stringify({ text: $('#lookout-input').value }));
      status.textContent = 'saved';
      setTimeout(function () { if (status.textContent === 'saved') status.textContent = ''; }, 1500);
    } catch (e) {
      status.classList.add('err');
      status.textContent = 'save failed';
    }
  }

  async function loadScanConfig() {
    try {
      const d = await wjson('/api/scan/config');
      if (d && typeof d.autoAccept === 'boolean') {
        $('#scan-auto').classList.toggle('on', d.autoAccept);
      }
    } catch (e) { /* ignore */ }
  }

  async function fetchScan() {
    if (Digest.span !== 'actionable') return;
    try {
      const st = await wjson('/api/scan/inbox');
      renderScan(st);
    } catch (e) {
      renderScan(null);
    }
  }

  function renderScan(st) {
    const box = $('#scan-status');
    const meta = $('#scan-meta');
    if (!st) { box.textContent = 'Scanner unavailable.'; meta.textContent = ''; return; }
    $('#scan-auto').classList.toggle('on', !!st.autoConfirm);
    meta.textContent = 'Auto-confirm ' + (st.autoConfirm ? 'ON' : 'OFF');
    const tasks = (st.tasks || []).length, events = (st.events || []).length;
    const pending = tasks + events;
    box.innerHTML =
      '<div style="font-size:15px;color:var(--accent-strong);margin-bottom:6px">' +
      pending + ' item' + (pending === 1 ? '' : 's') + ' awaiting review</div>' +
      (pending ? ('<div style="margin-bottom:6px">' + tasks + ' task' + (tasks === 1 ? '' : 's') +
        ' · ' + events + ' event' + (events === 1 ? '' : 's') + ' (unconfirmed)</div>') : '') +
      '<div>Confirm or delete them in <b>Ops → Inbox</b>.</div>' +
      '<div style="margin-top:8px;font-size:11px;color:var(--text-faint)">Auto-confirm is ' +
      (st.autoConfirm ? 'ON — scanned items land confirmed' : 'OFF — scanned items wait for review') + '.</div>';
  }

  function bindDigest() {
    $$('#digest-tabs .tab').forEach(function (t) {
      on(t, 'click', function () { setDigestTab(t.getAttribute('data-span')); });
    });
    on($('#digest-refresh'), 'click', function () { refreshDigest(); });
    on($('#digest-generate'), 'click', async function () {
      const btn = $('#digest-generate');
      if (Digest.genBusy) return;
      const span = Digest.span;
      if (span === 'actionable') return;
      Digest.genBusy = true;
      btn.classList.add('busy');
      const beforeTs = $('#digest-ts').textContent || '';
      try { await wapi('/api/digest/generate?span=' + encodeURIComponent(span), 'POST', '{}'); }
      catch (e) { /* the poll below still checks */ }
      const wait = function () {
        setTimeout(async function () {
          const ts = await fetchDigest(span, false);
          if (ts && ts !== beforeTs) {
            if (Digest.span === span) await fetchDigest(span, true);
            Digest.genBusy = false;
            btn.classList.remove('busy');
            return;
          }
          wait();
        }, 4000);
      };
      wait();
    });

    on($('#lookout-input'), 'input', function () {
      if (Digest.lookoutTimer) clearTimeout(Digest.lookoutTimer);
      Digest.lookoutTimer = setTimeout(saveLookout, 800);
    });
    on($('#lookout-input'), 'blur', saveLookout);

    on($('#scan-now'), 'click', async function () {
      const btn = $('#scan-now');
      if (btn.classList.contains('busy')) return;
      btn.classList.add('busy');
      btn.textContent = 'Scanning…';
      try {
        const r = await wjson('/api/scan/run', 'POST', '{}');
        if (r && r.ok && r.started) {
          $('#scan-meta').textContent = 'running hourly scan…';
          setTimeout(fetchScan, 8000);
        } else {
          $('#scan-meta').textContent = 'scan failed: ' + ((r && r.error) || 'unknown');
        }
      } catch (e) {
        $('#scan-meta').textContent = 'scan failed';
      } finally {
        btn.classList.remove('busy');
        btn.textContent = 'Scan now';
      }
    });

    on($('#scan-auto'), 'click', async function () {
      const el = $('#scan-auto');
      const next = !el.classList.contains('on');
      el.classList.toggle('on', next);
      try { await wapi('/api/scan/config', 'POST', JSON.stringify({ autoAccept: next })); } catch (e) { /* ignore */ }
    });
  }

  /* ================================================================== */
  /* OPS / TASKS                                                         */
  /* ================================================================== */
  const Ops = {
    tab: 'work',
    editingCalId: null,
    lastTasks: [],
    digestTalk: { hourly: false, daily: false, weekly: false },
    loading: false,
  };

  function cronToHuman(c) {
    if (!c) return '';
    const p = c.trim().split(/\s+/);
    if (p.length !== 5) return c;
    const min = p[0], hr = p[1], dom = p[2], mon = p[3], dow = p[4];
    const at = function (h, m) {
      const hh = (+h) % 12 || 12;
      const mm = m && m !== '0' ? ':' + String(m).replace(/^\*/, '') : (+h ? ':00' : '');
      return hh + (mm || '') + ((+h || 0) >= 12 ? 'pm' : 'am');
    };
    let day = '';
    if (dow !== '*') {
      const D = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const ds = dow.split(',');
      day = ds.length === 1 ? D[+ds[0]] : 'weekly ' + ds.map(function (d) { return D[+d]; }).join('/');
    }
    if (dom !== '*' || mon !== '*') return c;
    if (min === '*' && hr === '*') return 'every minute';
    if (min !== '*' && hr !== '*') return (day ? day + ' ' : 'daily ') + (day ? 'at ' : '') + at(hr, min);
    if (hr !== '*' && min === '*') return (day || 'hourly') + ' at ' + at(hr, '0');
    return c;
  }

  function fmtDT(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d)) return esc(iso);
      return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return esc(iso); }
  }

  function toLocalInput(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function setCount(id, n) {
    const el = $('#' + id);
    if (el) el.textContent = n || '';
  }

  async function loadDigestTalkState() {
    try {
      const d = await wjson('/api/digest/config');
      Ops.digestTalk = {
        hourly: !!(d && d.hourly && d.hourly.talk),
        daily: !!(d && d.daily && d.daily.talk),
        weekly: !!(d && d.weekly && d.weekly.talk),
      };
    } catch (e) { /* ignore */ }
  }

  function spanFromTaskId(id) { return id.replace('iris-digest-', ''); }

  function renderDigestSched(span, cron) {
    const p = (cron || '').trim().split(/\s+/);
    const parts = p.length === 5 ? { min: p[0], hr: p[1], dow: p[4] } : { min: '0', hr: '0', dow: '0' };
    const pad2 = function (n) { return String(n).padStart(2, '0'); };
    if (span === 'hourly') {
      return '<div><label>Minute past the hour</label>' +
        '<input type="number" min="0" max="59" class="dg-min" value="' + esc(parts.min) + '" style="width:76px"></div>';
    }
    const timeVal = pad2((+parts.hr) % 24) + ':' + pad2(+parts.min);
    if (span === 'weekly') {
      const D = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      let opts = '';
      for (let i = 0; i < 7; i++) {
        opts += '<option value="' + i + '"' + (String(parts.dow) === String(i) ? ' selected' : '') + '>' + D[i] + '</option>';
      }
      return '<div><label>Day</label><select class="dg-dow">' + opts + '</select></div>' +
        '<div><label>Time</label><input type="time" class="dg-time" value="' + timeVal + '"></div>';
    }
    return '<div><label>Time of day</label><input type="time" class="dg-time" value="' + timeVal + '"></div>';
  }

  async function loadCalendar() {
    try {
      const d = await wjson('/api/calendar/events');
      const evs = ((d && d.events) || []).filter(function (e) {
        const t = e.start_time ? new Date(e.start_time).getTime() : NaN;
        return !Number.isNaN(t);
      });
      const now = Date.now();
      const future = evs.filter(function (e) { return new Date(e.start_time).getTime() >= now; })
        .sort(function (a, b) { return new Date(a.start_time) - new Date(b.start_time); });
      const past = evs.filter(function (e) { return new Date(e.start_time).getTime() < now; })
        .sort(function (a, b) { return new Date(b.start_time) - new Date(a.start_time); });
      const ordered = future.concat(past);
      setCount('count-calendar', evs.length);
      if (!evs.length) { $('#ops-body').innerHTML = '<div class="empty">No calendar events.</div>'; return; }
      $('#ops-body').innerHTML = ordered.map(function (e) {
        const eid = e.id || e.uid || '';
        const isPast = new Date(e.start_time).getTime() < now;
        const st = e.start_time ? fmtDT(e.start_time) : '';
        const loc = e.location ? (' · ' + esc(e.location)) : '';
        const src = e.calendar_source ? (' · ' + esc(e.calendar_source)) : '';
        const end = e.end_time ? (' → ' + fmtDT(e.end_time)) : '';
        let editHtml = '';
        if (Ops.editingCalId === eid) {
          editHtml = '<div class="edit-row">' +
            '<label>Start</label><input type="datetime-local" id="cal-start" value="' + toLocalInput(e.start_time) + '">' +
            '<label>End</label><input type="datetime-local" id="cal-end" value="' + (e.end_time ? toLocalInput(e.end_time) : '') + '">' +
            '<label>Location</label><input type="text" id="cal-loc" value="' + esc(e.location || '').replace(/"/g, '&quot;') + '">' +
            '<div class="edit-btns"><span class="act-btn confirm" data-act="cal-save">Save</span>' +
            '<span class="act-btn" data-act="cal-cancel">Cancel</span></div></div>';
        }
        return '<div class="item' + (isPast ? ' past' : '') + '" data-kind="calendar" data-id="' + esc(eid) + '">' +
          '<div class="del-x" data-act="del" title="Delete">✕</div>' +
          '<div class="it-title">' + esc(e.title) + '</div>' +
          '<div class="it-sub">' + esc(st) + end + loc + src + '</div>' +
          '<div class="it-row">' +
          (isPast ? '<span class="badge badge-done">past</span>' : '<span class="badge badge-active">upcoming</span>') +
          '<span class="act-btn" data-act="edit">Edit</span></div>' + editHtml + '</div>';
      }).join('');
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load calendar.</div>';
    }
  }

  async function loadTasks() {
    await loadDigestTalkState();
    try {
      const d = await wjson('/api/tasks');
      Ops.lastTasks = ((d && d.tasks) || []).filter(function (t) { return (t.schedule_type || '') !== 'once'; });
      setCount('count-tasks', Ops.lastTasks.length);
      if (!Ops.lastTasks.length) { $('#ops-body').innerHTML = '<div class="empty">No scheduled tasks.</div>'; return; }
      $('#ops-body').innerHTML = Ops.lastTasks.map(function (t) {
        const badge = t.status === 'active' ? 'badge-active' : (t.status === 'paused' ? 'badge-paused' : 'badge-done');
        const sched = t.schedule_type === 'cron' ? cronToHuman(t.schedule_value)
          : t.schedule_type === 'interval' ? 'every ' + Math.round((+t.schedule_value) / 60000) + 'm'
            : t.schedule_type === 'once' ? 'once ' + esc(t.schedule_value || '') : '';
        const next = t.next_run ? 'next ' + esc(new Date(t.next_run).toLocaleString()) : '';
        const last = t.last_run ? 'last ' + esc(new Date(t.last_run).toLocaleString()) +
          (t.last_result ? (' · ' + esc(String(t.last_result).slice(0, 80))) : '') : '';
        const tog = t.status === 'active' ? ['Pause', 'paused'] : ['Resume', 'active'];
        const tid = t.id || '';
        const isSystem = tid.indexOf('iris-digest-') === 0 || tid.indexOf('heartbeat-') === 0;
        const isDigest = tid.indexOf('iris-digest-') === 0;
        let titleHtml;
        if (isDigest) titleHtml = esc('Iris ' + tid.replace('iris-digest-', '') + ' digest');
        else if (tid.indexOf('heartbeat-') === 0) titleHtml = 'Heartbeat';
        else titleHtml = esc((t.prompt || '(no prompt)').slice(0, 120)) + ((t.prompt || '').length > 120 ? '…' : '');
        let talkBtn = '';
        let cronInput = '';
        if (isDigest) {
          const span = spanFromTaskId(tid);
          const on = !!Ops.digestTalk[span];
          talkBtn = '<span class="act-btn ' + (on ? 'confirm' : '') + '" data-act="digest-talk" data-span="' + esc(span) + '" data-on="' + (!on) + '">' +
            (on ? '🔊 Speak: ON' : '🔊 Speak: off') + '</span>';
          cronInput = '<div class="dg-sched" data-id="' + esc(tid) + '" data-span="' + esc(span) + '">' +
            renderDigestSched(span, t.schedule_value || '') + '</div>';
        }
        return '<div class="item" data-kind="task" data-id="' + esc(t.id) + '">' +
          (isSystem ? '' : '<div class="del-x" data-act="del" title="Delete">✕</div>') +
          '<div class="it-title">' + titleHtml + '</div>' +
          '<div class="it-sub">' + esc(sched) + (next ? ' · ' + next : '') + '</div>' +
          (last ? '<div class="it-sub">' + last + '</div>' : '') + cronInput +
          '<div class="it-row"><span class="badge ' + badge + '">' + esc(t.status || 'active') + '</span>' +
          '<span class="act-btn" data-act="toggle" data-status="' + tog[1] + '">' + tog[0] + '</span>' + talkBtn + '</div></div>';
      }).join('');
      wireDigestSched();
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load tasks.</div>';
    }
  }

  function wireDigestSched() {
    $$('.dg-sched', $('#ops-body')).forEach(function (box) {
      const id = box.getAttribute('data-id');
      const span = box.getAttribute('data-span');
      let timer = null;
      const handler = function () {
        if (timer) clearTimeout(timer);
        timer = setTimeout(function () {
          const minEl = box.querySelector('.dg-min'), timeEl = box.querySelector('.dg-time'), dowEl = box.querySelector('.dg-dow');
          let min, hr, dow;
          if (span === 'hourly') { min = (minEl && minEl.value) || '0'; hr = '*'; dow = '*'; }
          else {
            const tv = (timeEl && timeEl.value) || '00:00';
            const tp = tv.split(':');
            hr = tp[0] || '0'; min = tp[1] || '0';
            dow = span === 'weekly' ? ((dowEl && dowEl.value) || '0') : '*';
          }
          const cron = span === 'hourly' ? (min + ' * * * *')
            : span === 'daily' ? (min + ' ' + hr + ' * * *')
              : (min + ' ' + hr + ' * * ' + dow);
          wapi('/api/tasks/' + encodeURIComponent(id), 'PATCH', JSON.stringify({ schedule_value: cron }))
            .then(function () { loadTasks(); }, function () { loadTasks(); });
        }, 800);
      };
      $$('input,select', box).forEach(function (f) {
        f.addEventListener('input', handler);
        f.addEventListener('change', handler);
      });
    });
  }

  async function loadReminders() {
    try {
      const d = await wjson('/api/tasks');
      const rems = ((d && d.tasks) || []).filter(function (t) { return (t.schedule_type || '') === 'once'; });
      setCount('count-reminders', rems.length);
      if (!rems.length) {
        $('#ops-body').innerHTML = '<div class="empty">No reminders. Use “+ New Reminder” to add one, or tell Warden “remind me to…”.</div>';
        return;
      }
      $('#ops-body').innerHTML = rems.map(function (t) {
        const badge = t.status === 'active' ? 'badge-active' : (t.status === 'paused' ? 'badge-paused' : 'badge-done');
        const when = t.schedule_value ? ('fires ' + esc(new Date(t.schedule_value).toLocaleString())) : '';
        const tog = t.status === 'active' ? ['Pause', 'paused'] : ['Resume', 'active'];
        const title = esc((t.prompt || '(no prompt)').slice(0, 120)) + ((t.prompt || '').length > 120 ? '…' : '');
        return '<div class="item" data-kind="task" data-id="' + esc(t.id) + '">' +
          '<div class="del-x" data-act="del" title="Delete">✕</div>' +
          '<div class="it-title">' + title + '</div>' +
          (when ? '<div class="it-sub">' + when + '</div>' : '') +
          '<div class="it-row"><span class="badge ' + badge + '">' + esc(t.status || 'active') + '</span>' +
          '<span class="act-btn" data-act="toggle" data-status="' + tog[1] + '">' + tog[0] + '</span></div></div>';
      }).join('');
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load reminders.</div>';
    }
  }

  async function loadWork() {
    try {
      const d = await wjson('/api/work-tasks');
      const tasks = (d && d.tasks) || [];
      const projMap = {};
      try {
        const pd = await wjson('/api/projects');
        ((pd && pd.projects) || []).forEach(function (p) { projMap[p.id] = p.name; });
      } catch (e) { /* projects optional */ }
      setCount('count-work', tasks.length);
      if (!tasks.length) { $('#ops-body').innerHTML = '<div class="empty">No work tasks. Use “+ Work Task” to add one.</div>'; return; }
      $('#ops-body').innerHTML = tasks.map(function (t) {
        const st = t.status || 'open';
        const badge = /complet|done|closed/i.test(st) ? 'badge-done'
          : /block/i.test(st) ? 'badge-risk'
            : /progress/i.test(st) ? 'badge-track'
              : /pause/i.test(st) ? 'badge-paused' : 'badge-active';
        const proj = projMap[t.project_id] || (t.project_id ? esc(t.project_id) : 'Personal');
        const due = t.due_date ? (' · due ' + esc(t.due_date.slice(0, 10))) : '';
        const pri = esc(t.priority || 'medium');
        return '<div class="item" data-kind="worktask" data-id="' + esc(t.id) + '">' +
          '<div class="del-x" data-act="del" title="Delete">✕</div>' +
          '<div class="it-title">' + esc(t.title) + '</div>' +
          '<div class="it-sub">' + esc(proj) + ' · ' + pri + ' priority' + due + '</div>' +
          '<div class="it-row"><span class="badge ' + badge + '">' + esc(st) + '</span></div></div>';
      }).join('');
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load work tasks.</div>';
    }
  }

  async function loadProjects() {
    try {
      const d = await wjson('/api/projects');
      const projects = (d && d.projects) || [];
      setCount('count-projects', projects.length);
      if (!projects.length) { $('#ops-body').innerHTML = '<div class="empty">No projects. Use “+ Project” to add one.</div>'; return; }
      const today = new Date().toISOString().slice(0, 10);
      $('#ops-body').innerHTML = projects.map(function (p) {
        const st = esc(p.status || 'On Track');
        const badge = /risk|delay|block/i.test(st) ? 'badge-risk' : /complet/i.test(st) ? 'badge-done' : 'badge-track';
        const due = p.due_date ? esc(p.due_date.slice(0, 10)) : '';
        const overdue = due && due < today && !/complet/i.test(st);
        const prog = p.progress != null ? (+p.progress) + '%' : '';
        const meta = [p.project_code ? esc(p.project_code) : '', due ? (overdue ? 'OVERDUE ' : 'due ') + due : '', prog].filter(Boolean).join(' · ');
        const desc = p.description ? '<div class="it-sub">' + esc(p.description).slice(0, 140) + '</div>' : '';
        const dels = (p.deliverables || []), deldone = dels.filter(function (x) { return x.done; }).length;
        const delLine = dels.length ? ('<div class="it-sub">' + deldone + '/' + dels.length + ' deliverables</div>') : '';
        return '<div class="item" data-kind="project" data-id="' + esc(p.id) + '">' +
          '<div class="del-x" data-act="del" title="Delete">✕</div>' +
          '<div class="it-title">' + esc(p.name) + '</div>' + desc +
          (meta ? '<div class="it-sub"' + (overdue ? ' style="color:var(--red)"' : '') + '>' + meta + '</div>' : '') +
          delLine + '<div class="it-row"><span class="badge ' + badge + '">' + st + '</span></div></div>';
      }).join('');
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load projects.</div>';
    }
  }

  async function loadInbox() {
    try {
      const st = await wjson('/api/scan/inbox');
      const tasks = (st && st.tasks) || [], events = (st && st.events) || [];
      const n = tasks.length + events.length;
      setCount('count-inbox', n);
      setWheelBadge('tasks', n);
      const badge = $('#nav-inbox-badge');
      if (badge) badge.textContent = n || '';
      if (!n) {
        $('#ops-body').innerHTML = '<div class="empty">Inbox clear — no items awaiting review.<br><br>' +
          'Scanned tasks &amp; events land here unconfirmed for a ✓.<br>Run a scan from the Digest → Actionable tab.</div>';
        return;
      }
      let h = '';
      tasks.forEach(function (t) {
        h += '<div class="item unconfirmed" data-kind="inbox-task" data-id="' + esc(t.id) + '">' +
          '<div class="it-title">' + esc(t.title) + '</div>' +
          '<div class="it-sub">' + esc(t.due_date ? ('due ' + fmtDT(t.due_date)) : 'to-do') +
          (t.description ? (' · ' + esc(t.description).slice(0, 80)) : '') + '</div>' +
          '<div class="it-row"><span class="badge badge-unconfirmed">unconfirmed · task</span>' +
          '<span class="act-btn deny" data-act="deny">✕ Deny</span>' +
          '<span class="act-btn confirm" data-act="confirm">✓ Confirm</span></div></div>';
      });
      events.forEach(function (e) {
        h += '<div class="item unconfirmed" data-kind="inbox-event" data-id="' + esc(e.id) + '">' +
          '<div class="it-title">' + esc(e.title) + '</div>' +
          '<div class="it-sub">' + esc(fmtDT(e.start_time)) + (e.end_time ? (' → ' + esc(fmtDT(e.end_time))) : '') +
          (e.location ? (' · ' + esc(e.location)) : '') + '</div>' +
          '<div class="it-row"><span class="badge badge-unconfirmed">unconfirmed · event</span>' +
          '<span class="act-btn deny" data-act="deny">✕ Deny</span>' +
          '<span class="act-btn confirm" data-act="confirm">✓ Confirm</span></div></div>';
      });
      $('#ops-body').innerHTML = h;
    } catch (e) {
      $('#ops-body').innerHTML = '<div class="empty">Unable to load inbox.</div>';
    }
  }

  async function refreshInboxCount() {
    if (Ops.tab === 'inbox') return;
    try {
      const st = await wjson('/api/scan/inbox');
      const n = ((st && st.tasks) || []).length + ((st && st.events) || []).length;
      const badge = $('#nav-inbox-badge');
      if (badge) badge.textContent = n || '';
      setCount('count-inbox', n);
      setWheelBadge('tasks', n);
    } catch (e) { /* ignore */ }
  }

  async function confirmInboxItem(kind, id) {
    try { await wapi('/api/scan/confirm', 'POST', JSON.stringify({ kind: kind, id: id })); } catch (e) { /* ignore */ }
    await loadInbox();
  }

  async function delInboxItem(kind, id) {
    const ep = kind === 'inbox-event'
      ? ('/api/calendar/events/' + encodeURIComponent(id))
      : ('/api/work-tasks/' + encodeURIComponent(id));
    try { await wapi(ep, 'DELETE'); } catch (e) { /* ignore */ }
    await loadInbox();
  }

  function setAddMode(tab) {
    const addBtn = $('#ops-add');
    const sched = $('#new-sched');
    const name = $('#new-name');
    addBtn.style.display = '';
    if (tab === 'inbox') {
      addBtn.style.display = 'none';
    } else if (tab === 'tasks') {
      addBtn.textContent = 'New Schedule';
      name.placeholder = 'New schedule prompt…';
      sched.type = 'text'; sched.hidden = false;
      sched.placeholder = 'cron e.g. 0 9 * * *';
    } else if (tab === 'reminders') {
      addBtn.textContent = 'New Reminder';
      name.placeholder = 'Reminder prompt…';
      sched.type = 'datetime-local'; sched.hidden = false;
      sched.placeholder = '';
    } else if (tab === 'work') {
      addBtn.textContent = '+ Work Task';
      name.placeholder = 'New work task…';
      sched.hidden = true;
    } else {
      addBtn.textContent = '+ Project';
      name.placeholder = 'New project name…';
      sched.hidden = true;
    }
  }

  function commitNew() {
    const name = $('#new-name').value.trim();
    if (!name) return;
    const sched = $('#new-sched').value.trim();
    if (Ops.tab === 'tasks') createOpsTask(name, sched);
    else if (Ops.tab === 'reminders') createReminder(name, sched);
    else if (Ops.tab === 'work') createWorkTask(name);
    else createProject(name);
  }

  async function afterCreate(fn) {
    const addBtn = $('#ops-add');
    addBtn.classList.add('busy');
    try { await fn(); } finally {
      addBtn.classList.remove('busy');
      setAddMode(Ops.tab);
    }
  }

  function createProject(name) {
    return afterCreate(async function () {
      const d = await wjson('/api/projects', 'POST', JSON.stringify({ name: name }));
      if (d && d.ok) { $('#new-row').classList.remove('show'); $('#new-name').value = ''; await loadProjects(); }
      else $('#ops-body').innerHTML = '<div class="empty">' + esc((d && d.error) || 'Create failed') + '</div>';
    });
  }

  function createOpsTask(prompt, cron) {
    return afterCreate(async function () {
      const d = await wjson('/api/tasks', 'POST', JSON.stringify({
        prompt: prompt, schedule_type: 'cron', schedule_value: cron || '0 9 * * *',
        chat_jid: 'owner@local', context_mode: 'isolated',
      }));
      if (d && d.id) {
        $('#new-row').classList.remove('show');
        $('#new-name').value = ''; $('#new-sched').value = '';
        await loadTasks();
      } else {
        $('#ops-body').innerHTML = '<div class="empty">' + esc((d && d.error) || 'Create failed') + '</div>';
      }
    });
  }

  function createReminder(prompt, when) {
    return afterCreate(async function () {
      const d = await wjson('/api/tasks', 'POST', JSON.stringify({
        prompt: prompt, schedule_type: 'once', schedule_value: when ? when + ':00' : '',
        chat_jid: 'owner@local', context_mode: 'isolated',
      }));
      if (d && d.id) {
        $('#new-row').classList.remove('show');
        $('#new-name').value = ''; $('#new-sched').value = '';
        await loadReminders();
      } else {
        $('#ops-body').innerHTML = '<div class="empty">' + esc((d && d.error) || 'Create failed') + '</div>';
      }
    });
  }

  function createWorkTask(title) {
    return afterCreate(async function () {
      const d = await wjson('/api/work-tasks', 'POST', JSON.stringify({ title: title }));
      if (d && d.ok) { $('#new-row').classList.remove('show'); $('#new-name').value = ''; await loadWork(); }
      else $('#ops-body').innerHTML = '<div class="empty">' + esc((d && d.error) || 'Create failed') + '</div>';
    });
  }

  async function delTask(id) {
    try { await wapi('/api/tasks/' + encodeURIComponent(id), 'DELETE'); } catch (e) { /* ignore */ }
    await loadTasks();
  }
  async function delProject(id) {
    try { await wapi('/api/projects/' + encodeURIComponent(id), 'DELETE'); } catch (e) { /* ignore */ }
    await loadProjects();
  }
  async function delWorkTask(id) {
    try { await wapi('/api/work-tasks/' + encodeURIComponent(id), 'DELETE'); } catch (e) { /* ignore */ }
    await loadWork();
  }
  async function delCalendarEvent(id) {
    try { await wapi('/api/calendar/events/' + encodeURIComponent(id), 'DELETE'); } catch (e) { /* ignore */ }
    await loadCalendar();
  }
  async function saveCalendarEvent(id) {
    const start = $('#cal-start').value;
    const end = $('#cal-end').value;
    const loc = $('#cal-loc').value;
    if (!start) { Ops.editingCalId = null; await loadCalendar(); return; }
    const body = { start_time: new Date(start).toISOString(), location: loc || '' };
    body.end_time = end ? new Date(end).toISOString() : '';
    try { await wapi('/api/calendar/events/' + encodeURIComponent(id), 'PUT', JSON.stringify(body)); } catch (e) { /* ignore */ }
    Ops.editingCalId = null;
    await loadCalendar();
  }
  async function toggleTask(id, status) {
    try { await wapi('/api/tasks/' + encodeURIComponent(id), 'PATCH', JSON.stringify({ status: status })); } catch (e) { /* ignore */ }
    await loadTasks();
  }

  async function loadOps() {
    if (Ops.tab === 'inbox') return loadInbox();
    if (Ops.tab === 'calendar') return loadCalendar();
    if (Ops.tab === 'tasks') return loadTasks();
    if (Ops.tab === 'reminders') return loadReminders();
    if (Ops.tab === 'work') return loadWork();
    return loadProjects();
  }

  async function refreshOps() {
    if (!hasBridge() || Ops.loading) return;
    Ops.loading = true;
    try {
      await loadOps();
      await refreshInboxCount();
      const ts = $('#ops-ts');
      if (ts) ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } finally {
      Ops.loading = false;
    }
  }

  function bindOps() {
    $$('#ops-tabs .tab').forEach(function (t) {
      on(t, 'click', function () {
        $$('#ops-tabs .tab').forEach(function (x) { x.classList.remove('active'); });
        t.classList.add('active');
        Ops.tab = t.getAttribute('data-tab');
        setAddMode(Ops.tab);
        $('#new-row').classList.remove('show');
        loadOps();
      });
    });
    on($('#ops-refresh'), 'click', function () { refreshOps(); });
    on($('#ops-add'), 'click', function () {
      const row = $('#new-row');
      row.classList.toggle('show');
      if (row.classList.contains('show')) $('#new-name').focus();
    });
    on($('#new-create'), 'click', commitNew);
    on($('#new-name'), 'keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); commitNew(); } });
    on($('#new-sched'), 'keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); commitNew(); } });

    on($('#ops-body'), 'click', function (ev) {
      const el = ev.target.closest('[data-act]');
      if (!el) return;
      const item = el.closest('.item');
      if (!item) return;
      const kind = item.getAttribute('data-kind');
      const id = item.getAttribute('data-id');
      const act = el.getAttribute('data-act');
      if (act === 'del') {
        if (kind === 'project') { if (confirm('Delete this project?')) delProject(id); }
        else if (kind === 'worktask') delWorkTask(id);
        else if (kind === 'calendar') delCalendarEvent(id);
        else delTask(id);
      } else if (act === 'deny') {
        delInboxItem(kind, id);
      } else if (act === 'confirm') {
        confirmInboxItem(kind === 'inbox-event' ? 'event' : 'task', id);
      } else if (act === 'toggle') {
        toggleTask(id, el.getAttribute('data-status'));
      } else if (act === 'digest-talk') {
        const span = el.getAttribute('data-span');
        const next = el.getAttribute('data-on') === 'true';
        const payload = {};
        payload[span] = { talk: next };
        wapi('/api/digest/config', 'POST', JSON.stringify(payload)).then(loadTasks, loadTasks);
      } else if (act === 'edit' && kind === 'calendar') {
        Ops.editingCalId = id;
        loadCalendar();
      } else if (act === 'cal-save') {
        saveCalendarEvent(id);
      } else if (act === 'cal-cancel') {
        Ops.editingCalId = null;
        loadCalendar();
      }
    });

    setAddMode(Ops.tab);
  }

  /* ================================================================== */
  /* UPLOAD                                                              */
  /* ================================================================== */
  const Upload = { storeKey: 'warden.uploads.recent', dir: 'uploads' };

  function recentUploads() {
    try { return JSON.parse(localStorage.getItem(Upload.storeKey) || '[]'); }
    catch (e) { return []; }
  }
  function saveRecentUploads(a) {
    try { localStorage.setItem(Upload.storeKey, JSON.stringify(a.slice(0, 12))); } catch (e) { /* ignore */ }
  }

  function renderUploads() {
    const list = $('#upload-list');
    if (!list) return;
    const a = recentUploads();
    if (!a.length) { list.innerHTML = '<div class="empty">No uploads yet.</div>'; return; }
    list.innerHTML = a.map(function (u, i) {
      return '<div class="up-item" data-i="' + i + '">' +
        '<div class="name">' + esc(u.name) + '</div>' +
        '<div class="path" data-path="' + esc(u.path) + '">' + esc(u.path) + '</div>' +
        '<div class="copy" data-copy="' + i + '">copy</div></div>';
    }).join('');
  }

  function readB64(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { const s = r.result || ''; resolve(s.substring(s.indexOf(',') + 1)); };
      r.onerror = function () { reject(r.error || new Error('read failed')); };
      r.readAsDataURL(file);
    });
  }

  function fmtSize(n) {
    if (!n || n < 0) return '';
    if (n < 1024) return n + 'B';
    if (n < 1048576) return (n / 1024).toFixed(1) + 'K';
    return (n / 1048576).toFixed(1) + 'M';
  }
  function fmtMtime(s) {
    if (!s) return '';
    try { return new Date(s).toISOString().slice(0, 16).replace('T', ' '); } catch (e) { return ''; }
  }

  async function uploadFile(file) {
    if (!file) return;
    const status = $('#upload-status');
    status.classList.remove('err');
    status.textContent = 'Reading ' + file.name + '…';
    try {
      const b64 = await readB64(file);
      status.textContent = 'Uploading ' + file.name + ' (' + fmtSize(file.size) + ')…';
      const raw = await bridgeCall('warden_upload', [Upload.dir, file.name, b64]);
      let d = null;
      try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
      if (d && d.ok) {
        const a = recentUploads();
        a.unshift({ name: file.name, path: d.path, size: file.size, at: new Date().toISOString().slice(0, 16) });
        saveRecentUploads(a);
        renderUploads();
        status.textContent = 'Uploaded → ' + d.path;
        refreshDownloads();
      } else {
        status.classList.add('err');
        status.textContent = 'Failed: ' + ((d && d.error) || 'unknown');
      }
    } catch (e) {
      status.classList.add('err');
      status.textContent = 'Error: ' + ((e && e.message) || e);
    }
  }

  async function handleFiles(files) {
    const arr = Array.prototype.slice.call(files || []);
    if (!arr.length) return;
    const drop = $('#drop');
    drop.classList.add('busy');
    for (let i = 0; i < arr.length; i++) await uploadFile(arr[i]);
    drop.classList.remove('busy');
  }

  async function refreshDownloads() {
    if (!hasBridge()) return;
    const list = $('#download-list');
    try {
      const raw = await wapi('/api/files?path=' + encodeURIComponent(Upload.dir));
      const d = raw ? JSON.parse(raw) : null;
      const entries = (d && d.entries) || [];
      const files = entries.filter(function (e) { return e && e.type === 'file' && !e.scrubbed; });
      if (!files.length) {
        list.innerHTML = '<div class="empty">No files in ' + esc(Upload.dir) + '/.</div>';
        return;
      }
      files.sort(function (a, b) { return (b.mtime || '').localeCompare(a.mtime || ''); });
      list.innerHTML = files.map(function (f) {
        const p = Upload.dir + '/' + f.name;
        const meta = [fmtSize(f.size), fmtMtime(f.mtime)].filter(Boolean).join(' · ');
        return '<div class="down-row" data-path="' + esc(p) + '" data-name="' + esc(f.name) + '">' +
          '<div><div class="dname">' + esc(f.name) + '</div>' +
          '<div class="dmeta">' + esc(meta) + '</div></div>' +
          '<div class="dbtn" title="Download">⤓</div></div>';
      }).join('');
    } catch (e) { /* leave the last render in place */ }
  }

  function b64ToBlob(b64, contentType) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: contentType || 'application/octet-stream' });
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function bindUpload() {
    const drop = $('#drop');
    const input = $('#file-input');
    ['dragenter', 'dragover'].forEach(function (ev) {
      on(drop, ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      on(drop, ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove('over'); });
    });
    on(drop, 'drop', function (e) { handleFiles(e.dataTransfer && e.dataTransfer.files); });
    on(drop, 'click', function () { input.click(); });
    on(input, 'change', function () { handleFiles(input.files); input.value = ''; });

    on($('#upload-list'), 'click', function (e) {
      const copy = e.target.closest('[data-copy]');
      const pathEl = e.target.closest('[data-path]');
      let path = '';
      if (copy) {
        const item = $('#upload-list .up-item[data-i="' + copy.getAttribute('data-copy') + '"] [data-path]');
        path = item && item.getAttribute('data-path');
      } else if (pathEl) {
        path = pathEl.getAttribute('data-path');
      }
      if (!path) return;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(path);
      const status = $('#upload-status');
      status.classList.remove('err');
      status.textContent = 'Copied: ' + path;
    });

    on($('#download-list'), 'click', async function (e) {
      const btn = e.target.closest('.dbtn');
      if (!btn) return;
      const row = btn.closest('.down-row');
      if (!row || btn.classList.contains('busy')) return;
      const path = row.getAttribute('data-path');
      const name = row.getAttribute('data-name');
      btn.classList.add('busy');
      btn.textContent = '…';
      try {
        const raw = await bridgeCall('warden_download', [path]);
        if (!raw) throw new Error('empty response');
        if (raw.charAt(0) === '{') {
          const d = JSON.parse(raw);
          throw new Error((d && d.error) || 'download failed');
        }
        triggerDownload(b64ToBlob(raw), name);
      } catch (err) {
        const status = $('#upload-status');
        status.classList.add('err');
        status.textContent = 'Download failed: ' + ((err && err.message) || err);
      } finally {
        btn.classList.remove('busy');
        btn.textContent = '⤓';
      }
    });

    on($('#downloads-refresh'), 'click', refreshDownloads);
    on(document, 'visibilitychange', function () { if (!document.hidden) refreshDownloads(); });
  }

  /* ================================================================== */
  /* AGENTS                                                              */
  /* ================================================================== */
  const AGENT_COLORS = {
    orchestrator: '#ffb454', iris: '#ff7ab8', atlas: '#5ce08a', mercury: '#c8d4e0',
    sentry: '#ff6b6b', artemis: '#ff9a3c', vulkan: '#ff7a3c', council: '#4ec9ff',
    tool: '#4ec9ff', thinking: '#b08cff',
  };
  const AGENT_ICONS = {
    orchestrator: '⬡', iris: '✉', atlas: '⚡', mercury: '☿',
    sentry: '🛡', artemis: '🔍', vulkan: '🔧',
  };
  const KNOWN_AGENTS = [
    { key: 'orchestrator', name: 'Orchestrator', channel: 'owner' },
    { key: 'iris', name: 'Iris', channel: 'email & calendar' },
    { key: 'atlas', name: 'Atlas', channel: 'research' },
    { key: 'mercury', name: 'Mercury', channel: 'memory' },
    { key: 'artemis', name: 'Artemis', channel: 'browser' },
    { key: 'sentry', name: 'Sentry', channel: 'security' },
    { key: 'vulkan', name: 'Vulkan', channel: 'build' },
  ];

  function renderAgents(progress, groups, livePhase, liveLabel, liveTools) {
    const list = $('#agent-list');
    const count = $('#agent-count');
    const now = Date.now();
    const seen = {};
    const cards = [];

    KNOWN_AGENTS.forEach(function (a) {
      seen[a.key] = true;
      cards.push({
        key: a.key, name: a.name, channel: a.channel, isMain: a.key === 'orchestrator',
        active: false, idle: true, pendingTasks: 0, pendingMessages: false,
        label: '', phase: a.key === 'orchestrator' ? 'orchestrator' : a.key, tools: [], ts: 0,
      });
    });

    const latestByPhase = {};
    (progress || []).forEach(function (e) {
      const ph = (e.phase || '').toLowerCase();
      if (!ph || ph === 'thinking' || ph === 'tool' || ph === 'tool_call') return;
      if (!latestByPhase[ph] || (e.ts || 0) > (latestByPhase[ph].ts || 0)) latestByPhase[ph] = e;
    });

    (groups || []).forEach(function (g) {
      const isMain = g.isMain || (g.name || g.jid || '').toLowerCase() === 'owner';
      const key = isMain ? 'orchestrator' : (g.name || g.jid || '').toLowerCase();
      let card = cards.find(function (c) { return c.key === key; });
      if (!card) {
        card = {
          key: key, name: isMain ? 'Orchestrator' : (g.name || g.jid), channel: g.channel || '',
          isMain: !!isMain, active: false, idle: true, pendingTasks: 0, pendingMessages: false,
          label: '', phase: '', tools: [], ts: 0,
        };
        seen[key] = true;
        cards.push(card);
      } else {
        card.channel = g.channel || card.channel;
      }
      card.pendingTasks = g.pendingTasks || card.pendingTasks;
      card.pendingMessages = g.pendingMessages || card.pendingMessages;
      if (g.liveLabel) card.label = g.liveLabel;
      if (g.livePhase) card.phase = g.livePhase;
      if (g.liveTools && g.liveTools.length) card.tools = g.liveTools;
      if (g.liveTs) card.ts = (g.liveTs || 0) * 1000;
    });

    Object.keys(latestByPhase).forEach(function (agent) {
      if (seen[agent]) return;
      seen[agent] = true;
      const ev = latestByPhase[agent];
      cards.push({
        key: agent, name: agent.charAt(0).toUpperCase() + agent.slice(1), channel: 'subagent',
        active: false, idle: false, pendingTasks: 0, pendingMessages: false,
        label: ev.label || '', phase: agent, tools: [], ts: ev.ts || 0,
      });
    });

    cards.forEach(function (c) {
      const ev = latestByPhase[c.key];
      if (ev && ev.label) { c.label = ev.label; c.ts = ev.ts || c.ts; }
      const labelIsDone = /complete|done|finished|error|exited/i.test(c.label || '');
      const jobsActive = !!ev && ev.jobs > 0;
      const phaseActive = !!livePhase && (c.key === livePhase || c.name.toLowerCase() === livePhase);
      if ((jobsActive || phaseActive) && !labelIsDone) {
        c.active = true; c.idle = false;
        if (phaseActive) { c.label = liveLabel || c.label; c.tools = liveTools || c.tools; c.ts = Date.now(); }
      } else {
        c.active = false; c.idle = true;
      }
    });

    cards.sort(function (a, b) {
      if (a.isMain && !b.isMain) return -1;
      if (!a.isMain && b.isMain) return 1;
      if (a.active && !b.active) return -1;
      if (!a.active && b.active) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    if (!cards.length) { list.innerHTML = '<div class="empty">No agents registered.</div>'; count.textContent = '0'; return; }
    count.textContent = cards.length;

    list.innerHTML = cards.map(function (c) {
      const statusClass = c.active ? 'active' : ((c.pendingMessages || c.pendingTasks) ? 'idle-pending' : '');
      const color = AGENT_COLORS[c.key] || AGENT_COLORS[c.phase] || '#4ec9ff';
      const icon = AGENT_ICONS[c.key] || AGENT_ICONS[c.phase] || '●';
      const toolsHtml = (c.tools && c.tools.length)
        ? '<div class="agent-tools">' + c.tools.map(function (t) { return '<span class="tool-tag">' + esc(t) + '</span>'; }).join('') + '</div>'
        : '';
      const phaseHtml = c.phase
        ? '<span class="phase-badge" style="color:' + color + ';border-color:' + color + '">' + esc(c.phase) + '</span>'
        : '';
      let activity = c.label || '';
      if (!activity && c.active) activity = 'processing…';
      if (!activity && c.idle) activity = 'idle';
      let ageStr = '';
      if (c.ts) {
        const sec = Math.floor((now - c.ts) / 1000);
        if (sec < 60) ageStr = 'just now';
        else if (sec < 3600) ageStr = Math.floor(sec / 60) + 'm ago';
        else ageStr = Math.floor(sec / 3600) + 'h ago';
      }
      const tip = esc(c.channel || '') + (ageStr ? ' · ' + ageStr : '') +
        (activity ? ' · ' + esc(activity) : '') +
        (c.pendingTasks ? ' · ' + c.pendingTasks + ' tasks' : '') +
        (c.pendingMessages ? ' · unread' : '');
      return '<div class="agent-card ' + statusClass + '" data-agent="' + esc(c.key) + '" title="' + tip + '">' +
        '<div class="agent-top"><div class="agent-icon" style="color:' + color + '">' + icon + '</div>' +
        '<div class="agent-name" style="color:' + color + '">' + esc(c.name) + '</div>' +
        '<div class="status-dot ' + statusClass + '"></div></div>' +
        '<div class="agent-channel">' + esc(c.channel || '') + '</div>' +
        (activity ? '<div class="agent-activity">' + esc(activity) + (ageStr ? ' · ' + ageStr : '') + '</div>' : '') +
        '<div class="badge-row">' + phaseHtml +
        (c.pendingTasks ? '<span class="phase-badge">' + c.pendingTasks + ' tasks</span>' : '') +
        (c.pendingMessages ? '<span class="phase-badge">unread</span>' : '') + '</div>' +
        toolsHtml + '</div>';
    }).join('');
  }

  async function refreshAgents() {
    if (!hasBridge()) return;
    try {
      const d = await wjson('/api/status');
      if (!d) return;
      const live = (d.groups && d.groups[0]) || {};
      renderAgents(d.progress || [], d.groups || [], live.livePhase, live.liveLabel, live.liveTools);
      const ts = $('#agents-ts');
      if (ts) ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) { /* ignore */ }
  }

  const AGENT_SETTINGS_KEYS = {
    orchestrator: { name: 'Orchestrator', model: 'globalDefaultModel', ctx: 'orchestratorCtx' },
    atlas: { name: 'Atlas', model: 'atlasModel', ctx: 'atlasCtx' },
    artemis: { name: 'Artemis', model: 'artemisModel', ctx: 'artemisCtx' },
    iris: { name: 'Iris', model: 'irisModel', ctx: 'irisCtx', note: 'Email, calendar, and work tasks.' },
    vulkan: { name: 'Vulkan', model: 'vulkanModel', ctx: 'vulkanCtx' },
    sentry: { name: 'Sentry', model: 'sentryModel', ctx: 'sentryCtx', note: 'Security scans of the PC — speaks only when something looks wrong.' },
    mercury: { name: 'Mercury', model: 'mercuryModel', ctx: 'mercuryCtx' },
  };
  const CTX_OPTIONS = ['', 2048, 4096, 8192, 16384, 32768, 65536, 128000];
  const Agents = { modelCache: null, settingsCache: null, current: null };

  async function loadModelList() {
    try {
      const d = await wjson('/api/ollama/test');
      if (!d || !d.ok) return;
      Agents.modelCache = {
        models: d.models || [], sizes: d.modelSizes || {},
        friendly: d.friendlyNames || {}, cloud: d.cloudModels || [],
      };
    } catch (e) { /* ignore */ }
  }
  async function loadAgentSettings() {
    try {
      const d = await wjson('/api/settings');
      if (d) Agents.settingsCache = d;
    } catch (e) { /* ignore */ }
  }

  function buildModelOptions(selected) {
    if (!Agents.modelCache) return '';
    let out = '';
    const seen = {};
    (Agents.modelCache.cloud || []).forEach(function (m) {
      if (!seen[m]) { seen[m] = true; out += '<option value="' + esc(m) + '"' + (m === selected ? ' selected' : '') + '>' + esc(m) + '</option>'; }
    });
    (Agents.modelCache.models || []).forEach(function (m) {
      if (!m || seen[m]) return;
      seen[m] = true;
      let label = Agents.modelCache.friendly[m] || m;
      const sz = Agents.modelCache.sizes[m];
      if (sz) label += '  (' + (sz / (1024 * 1024 * 1024)).toFixed(1) + ' GB)';
      out += '<option value="' + esc(m) + '"' + (m === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    if (selected && !seen[selected]) out += '<option value="' + esc(selected) + '" selected>' + esc(selected) + ' (not listed)</option>';
    return out;
  }

  function buildCtxOptions(selected) {
    let out = '';
    CTX_OPTIONS.forEach(function (v) {
      const val = v === '' ? '' : String(v);
      const label = v === '' ? 'default (native window)' : v.toLocaleString();
      out += '<option value="' + esc(val) + '"' + (val === String(selected || '') ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    if (selected && CTX_OPTIONS.indexOf(parseInt(selected, 10)) === -1 && selected !== '') {
      out += '<option value="' + esc(String(selected)) + '" selected>' + esc(String(selected)) + '</option>';
    }
    return out;
  }

  function openPopover(key) {
    const cfg = AGENT_SETTINGS_KEYS[key];
    if (!cfg) return;
    Agents.current = key;
    const note = $('#pop-note');
    note.textContent = cfg.note || '';
    note.style.display = cfg.note ? 'block' : 'none';
    $('#pop-name').textContent = cfg.name;
    $('#pop-icon').textContent = AGENT_ICONS[key] || '●';
    $('#pop-icon').style.color = AGENT_COLORS[key] || '#5ce08a';
    $('#pop-status').textContent = '';
    $('#pop-status').className = 'pop-status';
    if (!Agents.modelCache) loadModelList();
    if (!Agents.settingsCache) loadAgentSettings();
    const populate = function (triesLeft) {
      if (!Agents.modelCache || !Agents.settingsCache) {
        if (triesLeft > 0) {
          setTimeout(function () { populate(triesLeft - 1); }, 250);
          return;
        }
        // Warden didn't answer — render what we can rather than spin forever.
        if (!$('#pop-model').options.length) {
          $('#pop-model').innerHTML = '<option value="">— models unavailable —</option>';
        }
        if (!$('#pop-ctx').options.length) {
          $('#pop-ctx').innerHTML = buildCtxOptions('');
        }
        return;
      }
      const curModel = Agents.settingsCache[cfg.model] || '';
      const curCtx = Agents.settingsCache[cfg.ctx] || '';
      $('#pop-model').innerHTML = buildModelOptions(curModel);
      $('#pop-ctx').innerHTML = buildCtxOptions(curCtx);
    };
    populate(8);
    $('#pop-overlay').classList.add('open');
  }

  function closePopover() {
    $('#pop-overlay').classList.remove('open');
    Agents.current = null;
  }

  function bindAgents() {
    on($('#agents-refresh'), 'click', refreshAgents);
    on($('#agent-list'), 'click', function (ev) {
      const card = ev.target.closest('.agent-card');
      if (!card) return;
      openPopover(card.getAttribute('data-agent') || '');
    });
    on($('#pop-close'), 'click', closePopover);
    on($('#pop-cancel'), 'click', closePopover);
    on($('#pop-overlay'), 'click', function (ev) { if (ev.target === $('#pop-overlay')) closePopover(); });
    on($('#pop-save'), 'click', async function () {
      if (!Agents.current || !hasBridge()) return;
      const cfg = AGENT_SETTINGS_KEYS[Agents.current];
      const model = $('#pop-model').value;
      const ctx = $('#pop-ctx').value;
      const status = $('#pop-status');
      if (!model) { status.textContent = 'No model selected — pick a model first.'; status.className = 'pop-status err'; return; }
      const btn = $('#pop-save');
      btn.disabled = true;
      status.textContent = 'Saving…';
      status.className = 'pop-status busy';
      try {
        const body = {};
        body[cfg.model] = model;
        body[cfg.ctx] = ctx;
        await wapi('/api/settings', 'POST', JSON.stringify(body));
        await loadAgentSettings();
        const ok = (Agents.settingsCache || {})[cfg.model] === model;
        status.textContent = ok ? 'Saved.' : 'Saved, but the value did not persist as expected.';
        status.className = 'pop-status ' + (ok ? 'ok' : 'err');
      } catch (e) {
        status.textContent = 'Save failed: ' + ((e && e.message) || e);
        status.className = 'pop-status err';
      }
      btn.disabled = false;
    });
    // Warm the caches once the bridge is up.
    (function warm() {
      if (!hasBridge()) { setTimeout(warm, 300); return; }
      loadModelList();
      loadAgentSettings();
    })();
  }

  /* ================================================================== */
  /* SETTINGS                                                            */
  /* ================================================================== */
  const WX_KEY = 'warden.weather.loc';

  function setSettingsStatus(id, text, isErr) {
    const el = $('#' + id);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('err', !!isErr);
  }

  async function loadSettingsFields() {
    try { $('#set-bridge-state').textContent = hasBridge() ? 'connected' : 'unavailable'; } catch (e) { /* ignore */ }
    try {
      const u = await bridgeCall('get_warden_url', []);
      if (typeof u === 'string') { $('#set-warden-url').value = u; if (u) State.wardenUrl = u; }
    } catch (e) { /* ignore */ }
    try {
      const h = await bridgeCall('get_satellite_host', []);
      if (typeof h === 'string') $('#set-satellite-host').value = h;
    } catch (e) { /* ignore */ }
    try { $('#set-weather-loc').value = localStorage.getItem(WX_KEY) || ''; } catch (e) { /* ignore */ }
    const voice = $('#set-voice-state');
    if (voice) voice.textContent = VOICE_LABEL[State.voice] || State.voice;
    const wake = $('#set-wake-state');
    if (wake) wake.textContent = State.wake.active ? (State.wake.mode || 'active') : 'unavailable';
  }

  function bindSettings() {
    on($('#set-warden-save'), 'click', async function () {
      const url = $('#set-warden-url').value.trim();
      setSettingsStatus('set-warden-status', 'Saving…');
      try {
        await bridgeCall('save_warden_url', [url]);
        State.wardenUrl = url;
        updateHostLabels();
        if (State.sse) { try { State.sse.close(); } catch (e) { /* ignore */ } State.sse = null; }
        startLiveUpdates();
        pollHealth();
        setSettingsStatus('set-warden-status', 'Saved — restart to rebind audio/SSE listeners.');
      } catch (e) {
        setSettingsStatus('set-warden-status', 'Error: ' + ((e && e.message) || e), true);
      }
    });
    on($('#set-satellite-save'), 'click', async function () {
      const host = $('#set-satellite-host').value.trim();
      setSettingsStatus('set-satellite-status', 'Saving…');
      try {
        await bridgeCall('save_satellite_host', [host]);
        State.satelliteHost = host;
        setSettingsStatus('set-satellite-status', 'Saved — takes effect on next launch.');
      } catch (e) {
        setSettingsStatus('set-satellite-status', 'Error: ' + ((e && e.message) || e), true);
      }
    });
    on($('#set-weather-save'), 'click', function () {
      const loc = $('#set-weather-loc').value.trim();
      try { localStorage.setItem(WX_KEY, loc); } catch (e) { /* ignore */ }
      setSettingsStatus('set-weather-status', 'Saved — weather updating.');
      setTimeout(function () { setSettingsStatus('set-weather-status', ''); }, 3000);
    });
    on($('#set-minimize'), 'click', function () { bridgeCall('minimize_window', []).catch(function () {}); });
    on($('#set-fullscreen'), 'click', toggleFullscreen);
    on($('#set-close'), 'click', function () { bridgeCall('close_window', []).catch(function () {}); });
  }

  /* ================================================================== */
  /* MEMORY GALAXY (lazy loader)                                         */
  /* ================================================================== */
  const Galaxy = { loading: false, loaded: false };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.body.appendChild(s);
    });
  }

  function galaxyError(msg) {
    const el = $('#galaxy-boot-error');
    if (!el) return;
    el.style.display = 'block';
    el.textContent = msg;
  }

  function ensureGalaxy() {
    if (Galaxy.loaded) {
      if (window.MemoryGalaxy) window.MemoryGalaxy.setActive(true);
      return;
    }
    if (Galaxy.loading) return;
    Galaxy.loading = true;
    const hint = $('#galaxy-hint');
    if (hint) {
      hint.classList.remove('gone');
      setTimeout(function () { hint.classList.add('gone'); }, 10000);
    }
    // bundle.js carries three r160 + the addons (EffectComposer, RenderPass,
    // UnrealBloomPass, OutputPass, OrbitControls, RoomEnvironment) as classic
    // globals — vendor/three.min.js alone has only the core. Load it lazily so
    // the 1.9 MB of rendering code never delays app boot. A failed retry may
    // already have loaded one of the two scripts; only append what's missing.
    // bundle.js (three + bloom/orbit addons) is already loaded at boot for the
    // orb, so skip reloading it here — only fetch galaxy.js if it isn't loaded.
    const needBundle = typeof window.THREE === 'undefined';
    const needGalaxy = !window.MemoryGalaxy;
    (needBundle ? loadScript('marm-memory-map/bundle.js') : Promise.resolve())
      .then(function () {
        if (typeof window.THREE === 'undefined') throw new Error('THREE did not initialise from bundle.js');
        return needGalaxy ? loadScript('galaxy.js') : null;
      })
      .then(function () {
        if (!window.MemoryGalaxy) throw new Error('galaxy.js did not register window.MemoryGalaxy');
        return window.MemoryGalaxy.mount($('#galaxy-host')).then(function () {
          Galaxy.loaded = true;
          Galaxy.loading = false;
          const errEl = $('#galaxy-boot-error');
          if (errEl) errEl.style.display = 'none';
          window.MemoryGalaxy.setActive(true);
        });
      })
      .catch(function (err) {
        Galaxy.loading = false;
        galaxyError('Memory galaxy failed to load.\n\n' + ((err && err.message) || err) +
          '\n\nExpected files:\n  ui/marm-memory-map/bundle.js\n  ui/galaxy.js');
      });
  }

  /* ================================================================== */
  /* Bindings                                                            */
  /* ================================================================== */
  function toggleFullscreen() {
    const btn = $('#fs-btn');
    bridgeCall('toggle_panels_fullscreen', []).then(function (onNow) {
      if (!btn) return;
      btn.textContent = onNow ? '❐' : '⛶';
      btn.title = onNow ? 'Exit fullscreen' : 'Fullscreen';
    }, function () { /* bridge not ready */ });
  }

  function bindShell() {
    on($('#orbbtn'), 'click', function () {
      // Toggle a voice turn (start when idle, interrupt when active).
      bridgeCall('hologram_click', []).catch(function () {});
    });
    on($('#open-channel'), 'click', function () { openModule('comms'); });
    on($('#min-btn'), 'click', function () { bridgeCall('minimize_window', []).catch(function () {}); });
    on($('#close-btn'), 'click', function () { bridgeCall('close_window', []).catch(function () {}); });
    on($('#fs-btn'), 'click', toggleFullscreen);

    on($('#chat-form'), 'submit', function (ev) { ev.preventDefault(); sendChat(); });

    on($('#chips'), 'click', function (ev) {
      const b = ev.target.closest ? ev.target.closest('button[data-cmd]') : null;
      if (!b) return;
      const input = $('#chat-input');
      if (input) input.value = b.getAttribute('data-cmd');
      sendChat();
    });

    on($('#settings-btn'), 'click', openSettings);
    on($('#settings-close'), 'click', closeSettings);

    // Open the corresponding deep-dive module when a panel title is clicked.
    $$('.panel-header[data-module]').forEach(function (t) {
      on(t, 'click', function () { openModule(t.getAttribute('data-module')); });
    });
    // Close module buttons.
    $$('.module .close').forEach(function (c) {
      on(c, 'click', function () { const m = c.closest('.module'); if (m) m.classList.remove('open'); });
    });

    // Complete a task and remove it from the list when its checkbox is clicked.
    on($('#mission-list'), 'click', function (ev) {
      const item = ev.target.closest ? ev.target.closest('.mission-item') : null;
      if (!item) return;
      const id = item.getAttribute('data-id');
      const type = item.getAttribute('data-type');
      if (!id) return;
      item.remove();
      const ep = type === 'work' ? ('/api/work-tasks/' + encodeURIComponent(id)) : ('/api/tasks/' + encodeURIComponent(id));
      wapi(ep, 'PATCH', JSON.stringify({ status: 'completed' })).then(function () {
        renderDashboard();
      }).catch(function () {
        renderDashboard(); // reappears if the save failed
      });
    });

    bindDigest();
    bindOps();
    bindUpload();
    bindAgents();
    bindSettings();
    on($('#galaxy-reset'), 'click', function () {
      if (window.MemoryGalaxy && window.MemoryGalaxy.resetView) window.MemoryGalaxy.resetView();
    });
  }

  /* ================================================================== */
  /* Boot                                                                */
  /* ================================================================== */
  async function boot() {
    bindShell();
    setVoiceState('idle');
    renderHeader();
    renderChips();

    const clock = $('#clock');
    const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const tickClock = function () {
      if (!clock) return;
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      clock.textContent = DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' • ' + hh + ':' + mm + ':' + ss;
    };
    tickClock();
    setInterval(tickClock, 1000);

    const ready = await waitForBridge(20000);
    const bstate = $('#set-bridge-state');
    if (bstate) bstate.textContent = ready ? 'connected' : 'unavailable';
    if (!ready) {
      setReachable(false);
      return;
    }

    await loadConfig();
    setReachable(null);
    startPolling();
    startLiveUpdates();

    // First paint of every module (the bridge is ready now).
    refreshChat();
    refreshOps();
    refreshAgents();
    renderUploads();
    refreshDownloads();
    refreshDigest();
    refreshSystems();
    refreshComms();
    renderDashboard();
    loadLookout();
    loadScanConfig();
    try { await loadSettingsFields(); } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
