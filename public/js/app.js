/* Warden dashboard — rewritten v2 app controller.
 *
 * Wires every endpoint in src/status-server.ts that's in scope for the
 * single-user Warden dashboard:
 *   GET    /api/status              — verbose bar, agent activity, metrics
 *   GET    /api/settings           — load settings
 *   POST   /api/settings           — save settings (atlas/agents/council/ctx/...)
 *   GET    /api/messages?jid&since&limit&idea
 *   POST   /api/messages            — { text, jid, sender_name, model, thinking, idea, verbose }
 *   GET    /api/ollama/test         — list of local models, friendly names, cloud models, thinking
 *   POST   /api/ollama/model-names  — { names }
 *   POST   /api/ollama/model-names  — { names }
 *   GET    /api/tasks               — { tasks: [...] }
 *   POST   /api/tasks               — create
 *   PATCH  /api/tasks/:id           — { status }
 *   DELETE /api/tasks/:id
 *   GET    /api/skills              — { installed: { name: bool, ... } }
 *   POST   /api/audit/run
 *   GET    /api/audit/status
 *   GET    /api/process-logs?lines=
 *   POST   /api/process-logs        — { action: 'truncate' }
 *   POST   /api/agents/kill
 *   POST   /api/chat/stop           — { jid, advance_cursor }
 *   POST   /api/server/restart
 *   GET    /api/activity?limit=
 *   GET    /api/search?q=
 *   GET    /api/groups               — single-owner stub
 *   GET    /api/notifications (SSE)  — broadcast
 *   GET    /api/notifications/poll   — fallback
 */

(function () {
  'use strict';

  // ============================================================= State
  const STATE = {
    currentView: 'chat',
    currentJid: 'owner@local',
    chatLastTs: '',
    polling: false,
    pollTimer: null,
    verboseTimer: null,
    statusTimer: null,
    activityTimer: null,
    assistantName: 'WARDEN',
    localAssistantName: 'Warden',
    // Server-reported timezone (America/Vancouver). Used to render chat timestamps
    // in Warden's local time regardless of the viewer's browser/OS timezone — a
    // browser in PST (UTC-8) would otherwise show every message 1h behind PDT.
    timezone: '',
    cachedOllamaModels: [],
    cachedFriendlyNames: {},
    cachedCloudModels: [],
    cachedThinking: {},
    cachedSettings: null,
    renderedMessageIds: new Set(),
    currentIdea: '',
    currentSender: 'the user',
    currentSenderKey: 'user',
    senders: [
      { key: 'user', name: 'the user', color: '#5eead4' },
    ],
    pendingMessages: [],
    stopSuppressUntil: 0,
    waitingForReply: false,
    auditRunning: false,
    auditPollTimer: null,
    selectedAttachments: [],
    sseSource: null,
    notifPollTimer: null,
    cachedStatus: null,
  };

  // ============================================================= Helpers
  const $ = (id) => document.getElementById(id);
  const qs = (sel, root) => (root || document).querySelector(sel);
  const qsa = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) { return esc(s); }

  function fmtUptime(s) {
    if (!s || s < 0) return '--';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (d) return d + 'd' + h + 'h';
    if (h) return h + 'h' + m + 'm';
    if (m) return m + 'm' + sec + 's';
    return sec + 's';
  }
  function fmtTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      // Render in Warden's server timezone (STATE.timezone) when available so
      // chat times match the host clock even if the viewer's browser is in a
      // different/off-by-one timezone. Falls back to browser default before the
      // first status poll lands.
      const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
      if (STATE.timezone) opts.timeZone = STATE.timezone;
      return d.toLocaleTimeString([], opts);
    } catch { return ts; }
  }
  function fmtBytes(n) {
    if (!n && n !== 0) return '--';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + u[i];
  }

  function renderMarkdown(text) {
    if (!text) return '';

    const fences = [];
    const stashed = String(text).replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, _lang, body) => {
      const i = fences.length;
      fences.push(esc(body.replace(/\n$/, '')));
      return '\x00F' + i + '\x00';
    });

    const inline = (s) => {
      let x = esc(s);
      x = x.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
      x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      x = x.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s)!?.,;:]|$)/g, '$1<em>$2</em>');
      x = x.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s)!?.,;:]|$)/g, '$1<em>$2</em>');
      x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      x = x.replace(/\x00F(\d+)\x00/g, (_, i) => '<pre><code>' + fences[Number(i)] + '</code></pre>');
      return x;
    };

    const lines = stashed.split(/\r?\n/);
    const out = [];
    let list = null;
    let quote = false;
    let para = [];

    const flushPara = () => {
      if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; }
    };
    const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const flushQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    const splitRow = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const isTableSep = (s) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\x00F\d+\x00$/.test(line.trim())) { flushAll(); out.push(inline(line.trim())); continue; }
      if (!line.trim()) { flushAll(); continue; }

      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushAll();
        const headers = splitRow(line);
        const align = splitRow(lines[i + 1]).map((c) => {
          const l = c.startsWith(':');
          const r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        const rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim()) {
          rows.push(splitRow(lines[j]));
          j++;
        }
        let html = '<table><thead><tr>';
        for (let k = 0; k < headers.length; k++) {
          const a = align[k] ? ' style="text-align:' + align[k] + '"' : '';
          html += '<th' + a + '>' + inline(headers[k]) + '</th>';
        }
        html += '</tr></thead><tbody>';
        for (const row of rows) {
          html += '<tr>';
          for (let k = 0; k < headers.length; k++) {
            const a = align[k] ? ' style="text-align:' + align[k] + '"' : '';
            html += '<td' + a + '>' + inline(row[k] || '') + '</td>';
          }
          html += '</tr>';
        }
        html += '</tbody></table>';
        out.push(html);
        i = j - 1;
        continue;
      }

      const h = /^(#{1,6})\s+(.+)$/.exec(line);
      if (h) { flushAll(); const n = h[1].length; out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); continue; }

      if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

      const ul = /^\s*[-*]\s+(.+)$/.exec(line);
      if (ul) {
        flushPara(); flushQuote();
        if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + inline(ul[1]) + '</li>');
        continue;
      }

      const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
      if (ol) {
        flushPara(); flushQuote();
        if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + inline(ol[1]) + '</li>');
        continue;
      }

      const bq = /^>\s?(.*)$/.exec(line);
      if (bq) {
        flushPara(); flushList();
        if (!quote) { out.push('<blockquote>'); quote = true; }
        out.push('<p>' + inline(bq[1]) + '</p>');
        continue;
      }

      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();

    return out.join('\n');
  }

  function toast(message, kind) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = message;
    $('toastContainer').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }, 4200);
  }

  async function api(path, opts) {
    const r = await fetch(path, opts);
    if (!r.ok) {
      let msg = 'HTTP ' + r.status;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch {}
      throw new Error(msg);
    }
    const ct = r.headers.get('content-type') || '';
    if (ct.includes('application/json')) return r.json();
    return r.text();
  }
  function postJson(path, body) {
    return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function patchJson(path, body) {
    return api(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function putJson(path, body) {
    return api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function del(path, body) {
    const opts = { method: 'DELETE' };
    if (body) { opts.headers = { 'Content-Type': 'application/json' }; opts.body = JSON.stringify(body); }
    return api(path, opts);
  }

  // ============================================================= View switching
  function switchView(name) {
    // Ported home-view cards may target views that map to native ones here.
    if (name === 'automater' || name === 'files') name = 'tasks';
    if (!$('view-' + name)) return; // unknown view — don't blank the page
    STATE.currentView = name;
    qsa('.view').forEach(v => v.classList.remove('active'));
    const v = $('view-' + name);
    if (v) v.classList.add('active');
    qsa('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    closeDrawer();
    if (name === 'tasks') refreshTasks();
    else if (name === 'skills') { refreshSkills(); refreshMcp(); }
    else if (name === 'activity') refreshActivity();
    else if (name === 'training') setTrainingTab(STATE.trainingTab || 'loop');
    else if (name === 'imagegen') refreshImagegen();
    else if (name === 'marm') refreshMarm();
    else if (name === 'security') refreshSecurity();
    else if (name === 'logs') refreshProcessLogs();
    else if (name === 'accounts') refreshAccounts();
    else if (name === 'friends') refreshFriends();
    else if (name === 'social') refreshSocial();
    else if (name === 'phone') refreshPhone();
    else if (name === 'bugloop') refreshBugloop();
    else if (name === 'calendar' && window.PIM) window.PIM.refreshCalendar();
    else if (name === 'email' && window.PIM) window.PIM.refreshEmail();
    else if (window.UserDash) {
      // Views ported from the groupware user dashboard (userdash-extras.js)
      const UD = window.UserDash;
      if (name === 'projects' && UD.loadProjects) UD.loadProjects();
      else if (name === 'heartbeat' && UD.loadHeartbeat) UD.loadHeartbeat();
      else if (name === 'alarms' && UD.loadAlarms) UD.loadAlarms();
      else if (name === 'apikeys' && UD.loadUsageDashboard) UD.loadUsageDashboard();
      else if (name === 'actions' && UD.renderActions) UD.renderActions();
      else if (name === 'talk' && UD.initTalkView) UD.initTalkView();
      else if (name === 'blog' && UD.loadBlog) UD.loadBlog();
    }
  }
  window.__localSwitchView = switchView;

  // ============================================================= Status
  // Dashboard typing indicator state
  let waitingForReply = false;
  let typingWords = [];
  let typingHideSuppressUntil = 0;
  let typingStopSuppressUntil = 0;
  let typingStatusPollTimer = null;

  // Live thinking tokens stream into the typing indicator status text via SSE
  // agent_activity events. Keeps the last 50 words so the user sees what the
  // agent is currently doing without a separate always-visible idle bar.
  function addThinkingLine(text) {
    const statusEl = $('typingStatusText');
    const words = text.split(/\s+/).filter(w => w);
    typingWords.push(...words);
    while (typingWords.length > 50) typingWords.shift();
    if (statusEl) statusEl.textContent = typingWords.join(' ') || 'Thinking…';
  }

  function clearThinkingBar() {
    typingWords.length = 0;
  }

  // No-op: the standalone thinking bar was removed. The typing indicator status
  // text is updated directly from SSE agent_activity tokens and status polling.
  function syncThinkingBar() {}

  async function pollStatus() {
    try {
      const d = await api('/api/status');
      STATE.cachedStatus = d;
      if (d.assistant) { STATE.assistantName = d.assistant; $('assistantName').textContent = d.assistant.toUpperCase(); }
      if (d.localAssistant) STATE.localAssistantName = d.localAssistant;
      if (d.timezone) STATE.timezone = d.timezone;

      // topbar stats
      $('statUptime').textContent = fmtUptime(d.uptime);
      if (d.system) {
        $('statCpu').textContent = d.system.cpuPercent + '%';
        $('statMem').textContent = d.system.memPercent + '%';
      }
      $('statTasks').textContent = d.runningJobs != null ? d.runningJobs : '--';

      // dot
      const dot = $('statusDot');
      const groups = (d.groups || []);
      const active = groups.some(g => g.active && !g.idle);
      dot.className = 'dot' + (active ? ' busy' : '');

      // Chat lock — heavy job (bug loop / alpha stack) holding chat turns.
      updateChatLockBanner(d.chatLocked);

      // Oversight window — structured per-agent/agent-job view of what is
      // happening right now. Populated from d.jobs (background jobs), d.groups
      // (foreground), and the latest supervisor note in d.progress.
      const progress = d.progress || [];
      renderOversight(d);
      syncThinkingBar();

      // stop button enable/disable
      $('btnStop').disabled = !active;
    } catch (e) {
      $('statusDot').className = 'dot dead';
    }
  }

  function updateChatLockBanner(lock) {
    const el = $('chatLockBanner');
    if (!el) return;
    if (lock && lock.locked) {
      $('chatLockBannerText').textContent = 'Chat is paused — ' + (lock.reason || 'a background job is running') + '. Messages will be answered when it finishes.';
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  // ── Oversight window ──
  // Structured view of what is happening right now — one row per running
  // background job (from /api/status.jobs, emitted by the runner's
  // emitJobsStatus heartbeat), one row for the foreground seat while
  // a user turn runs, and the supervisor's latest note. Nothing spews raw
  // "iteration N — thinking" events; when nothing runs it's a single quiet
  // line. Poll-driven (pollStatus every 5s).
  function ovRow(agent, main, action, meta, kind, taskTitle, metaClass) {
    return `<div class="ov-row ${kind || ''}" data-agent="${esc(agent)}"${taskTitle ? ` title="${esc(taskTitle)}"` : ''}>` +
      `<span class="ov-name">${esc(agent)}</span>` +
      (main ? `<span class="ov-task">${esc(main)}</span>` : '') +
      `<span class="ov-action">${esc(action)}</span>` +
      (meta ? `<span class="ov-meta ${metaClass || ''}">${esc(meta)}</span>` : '') +
      `</div>`;
  }
  function ovDur(s) {
    if (s == null) return '';
    s = Math.max(0, Math.round(Number(s) || 0));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60); return `${m}m${s % 60 ? ' ' + (s % 60) + 's' : ''}`;
  }
  function renderOversight(d) {
    const panel = $('oversight'), rowsEl = $('oversightRows'),
      dot = $('oversightDot'), countEl = $('oversightCount');
    if (!panel || !rowsEl) return;
    const rows = [];
    // Foreground: the seat working on a user message right now.
    const fg = (d.groups || []).find(g => g.active && !g.idle);
    if (fg) {
      const label = (fg.liveLabel || fg.livePhase || 'working on your message').replace(/^Warden is (generating|thinking)[.…]*$/i, 'composing a reply…');
      rows.push(ovRow('Warden', '', label, '', 'fg'));
    }
    // One row per running background job — factual reporting only. The only
    // reliable signals are calls, elapsed time, and seconds since the last tool
    // call. Avoid invented categories like "stalled" or "waiting on model"; just
    // state the idle duration and let the user interpret it.
    for (const j of d.jobs || []) {
      const idle = Number(j.idle) || 0;
      const elapsed = Number(j.elapsed) || 0;
      const calls = Number(j.calls) || 0;
      // Live output scrollby: the runner streams a capped tail of the job's
      // thinking/content, refreshed ~2.5x/s during generation. "streaming"
      // (a chunk in the last 15s) means the model is actively producing
      // tokens even with 0 tool calls — a long think pass used to read as
      // "idle Ns / stalled" while it was writing.
      const streamTail = String(j.streamContent || j.streamThinking || '').replace(/\s+/g, ' ').trim();
      const streaming = Number(j.streamAt) > 0 && (Date.now() - Number(j.streamAt) < 15000);
      const meta = [calls + ' call' + (calls === 1 ? '' : 's'), ovDur(elapsed),
        streaming ? 'streaming' : (idle > 0 ? 'idle ' + ovDur(idle) : '')].filter(Boolean).join(' · ');
      rows.push(ovRow(j.agent, j.task, j.lastAction || 'starting…', meta, 'job', j.task,
        !streaming && idle > 300 ? 'stalled' : ''));
      if (streamTail) {
        const mode = j.streamContent ? 'writing' : 'thinking';
        rows.push('<div class="ov-stream' + (streaming ? ' live' : '') + '" title="' + esc(streamTail) + '">' +
          '<span class="ov-stream-mode">' + mode + '</span>' + esc(streamTail.slice(-160)) + '</div>');
      }
    }
    // Supervisor's latest monitor-tick note (prose, routed here instead of chat).
    const sups = (d.progress || []).filter(e => e.kind === 'supervisor' && e.label);
    const sup = sups[sups.length - 1];
    if (sup && Date.now() - sup.ts < 2 * 60 * 60 * 1000) {
      rows.push(ovRow('supervisor', '', sup.label, fmtTime(sup.ts), 'sup'));
    }
    // Busy state: a foreground turn or any running job.
    const jobCount = (d.jobs || []).length;
    panel.classList.toggle('busy', !!fg || jobCount > 0);
    countEl.textContent = jobCount
      ? `${jobCount} job${jobCount > 1 ? 's' : ''}${fg ? ' · reply in progress' : ''}`
      : (fg ? 'reply in progress' : '');
    rowsEl.innerHTML = rows.length ? rows.join('') : ovRow('quiet', '', 'nothing running right now', '', 'quiet');
  }

  function startStatusPolling() {
    if (STATE.statusTimer) clearInterval(STATE.statusTimer);
    pollStatus();
    STATE.statusTimer = setInterval(pollStatus, 5000);
  }

  // ============================================================= Chat
  async function loadMessages() {
    try {
      const url = '/api/messages?jid=' + encodeURIComponent(STATE.currentJid) +
        '&limit=200&idea=' + encodeURIComponent(STATE.currentIdea);
      const d = await api(url);
      renderMessages(d.messages || []);
      if (d.messages && d.messages.length) {
        STATE.chatLastTs = d.messages[d.messages.length - 1].timestamp;
        STATE.waitingForReply = false;
      }
    } catch (e) {
      console.error('loadMessages', e);
    }
  }

  function renderMessages(messages) {
    const el = $('messages');
    const empty = $('msgEmpty');
    // keep empty state as first child but hidden if any msgs
    qsa('.msg', el).forEach(n => n.remove());
    STATE.renderedMessageIds.clear();
    if (!messages.length) { empty.style.display = ''; return; }
    empty.style.display = 'none';
    for (const m of messages) appendMessage(m);
    el.scrollTop = el.scrollHeight;
  }

  function appendMessage(m) {
    const el = $('messages');
    const empty = $('msgEmpty');
    if (m.id && STATE.renderedMessageIds.has(m.id)) return null;
    if (m.id) STATE.renderedMessageIds.add(m.id);
    if (empty) empty.style.display = 'none';
    const div = document.createElement('div');
    const isBot = !!m.is_bot_message;
    div.className = 'msg ' + (isBot ? 'bot' : 'user');
    const sender = isBot ? (m.sender_name || STATE.assistantName) : (m.sender_name || m.sender || 'You');
    const ts = fmtTime(m.timestamp);
    // Meta goes ABOVE the text. With meta below (old order), each message's
    // name/time sat directly on top of the NEXT message's bubble — the chat
    // read as if every reply carried the previous sender's name (2026-09-21).
    // .msg-meta's margin-bottom was authored for this header position.
    div.innerHTML =
      '<div class="msg-meta"><span class="sender ' + (isBot ? 'bot' : '') + '">' + esc(sender) + '</span>' +
      '<span class="ts">' + esc(ts) + '</span></div>' +
      '<div class="msg-text">' + renderMarkdown(m.content || '') + '</div>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function appendPendingMsg(text) {
    const el = $('messages');
    const empty = $('msgEmpty');
    if (empty) empty.style.display = 'none';
    const div = document.createElement('div');
    div.className = 'msg user pending';
    div.innerHTML =
      '<div class="msg-meta"><span class="sender">You</span><span class="ts">sending…</span></div>' +
      '<div class="msg-text">' + renderMarkdown(text) + '</div>';
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    return div;
  }

  function markMsgFailed(pendingEl, text) {
    if (!pendingEl) return;
    pendingEl.classList.remove('pending');
    pendingEl.classList.add('failed');
    const meta = qs('.msg-meta', pendingEl);
    if (meta) {
      meta.innerHTML = '<span class="sender">You</span><span class="ts">not sent</span>' +
        ' <span class="retry">retry</span>';
      const r = qs('.retry', meta);
      if (r) r.addEventListener('click', () => { pendingEl.remove(); sendChatText(text); });
    }
  }

  async function sendChat() {
    const input = $('chatInput');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    await sendChatText(text);
  }

  async function sendChatText(text) {
    const pendingEl = appendPendingMsg(text);

    const payload = {
      text: text,
      jid: STATE.currentJid,
      sender_name: STATE.currentSender,
    };
    if (STATE.currentIdea) payload.idea = STATE.currentIdea;
    payload.verbose = true;

    try {
      await postJson('/api/messages', payload);
      STATE.stopSuppressUntil = 0;
      STATE.waitingForReply = true;
      waitingForReply = true;
      showTypingIndicator();
      // remove pending flag — real message will arrive via poll
      setTimeout(() => {
        if (pendingEl && pendingEl.parentNode) pendingEl.classList.remove('pending');
      }, 300);
      startChatPolling();
    } catch (e) {
      markMsgFailed(pendingEl, text);
      toast('Failed to send: ' + e.message, 'error');
    }
  }

  async function pollChat() {
    if (STATE.polling) return;
    STATE.polling = true;
    try {
      const url = '/api/messages?jid=' + encodeURIComponent(STATE.currentJid) +
        '&since=' + encodeURIComponent(STATE.chatLastTs) +
        '&limit=100&idea=' + encodeURIComponent(STATE.currentIdea);
      const d = await api(url);
      const msgs = d.messages || [];
      if (msgs.length) {
        for (const m of msgs) {
          appendMessage(m);
          // a real user message arriving from the server means the pending
          // placeholder is now duplicated — remove it
          if (!m.is_bot_message) {
            qsa('.msg.user.pending', $('messages')).forEach(n => n.remove());
          }
        }
        STATE.chatLastTs = msgs[msgs.length - 1].timestamp;
        // If we got a bot message, we're no longer waiting
        if (msgs.some(m => m.is_bot_message)) {
          STATE.waitingForReply = false;
          waitingForReply = false;
          hideTypingIndicator();
          // remove any leftover pending user bubbles that the server has now stored
          qsa('.msg.user.pending', $('messages')).forEach(n => n.remove());
          // Auto-poll a bit longer in case follow-up chunks arrive
          if (!STATE.pollTimer) startChatPolling();
        }
      }
    } catch (e) {
      /* swallow; will retry next tick */
    } finally {
      STATE.polling = false;
    }
  }

  // Poll cadence: fast (2.5s) while a turn is in flight, slow (6s) while idle.
  // The slow poll always runs so pushed messages (Telegram, scheduled agents,
  // sub-agent replies) show up without a hard refresh.
  const FAST_POLL_MS = 2500;
  const SLOW_POLL_MS = 6000;
  function startChatPolling() {
    const tick = async () => {
      await pollChat();
      const idle = !STATE.waitingForReply && STATE.cachedStatus && isAgentIdle();
      const wantMode = idle ? 'slow' : 'fast';
      if (wantMode !== STATE.pollMode) {
        STATE.pollMode = wantMode;
        if (STATE.pollTimer) clearInterval(STATE.pollTimer);
        STATE.pollTimer = setInterval(tick, wantMode === 'slow' ? SLOW_POLL_MS : FAST_POLL_MS);
      }
    };
    if (STATE.pollTimer) clearInterval(STATE.pollTimer);
    STATE.pollMode = 'fast';
    tick();
    STATE.pollTimer = setInterval(tick, FAST_POLL_MS);
  }

  function isAgentIdle() {
    const d = STATE.cachedStatus;
    if (!d) return true;
    const g = d.groups && d.groups.find(x => x.jid === STATE.currentJid);
    return !(g && g.active && !g.idle);
  }

  async function stopAgent() {
    try {
      await postJson('/api/chat/stop', { jid: STATE.currentJid, advance_cursor: true });
      toast('Stop sent', 'success');
      STATE.waitingForReply = false;
      waitingForReply = false;
      typingStopSuppressUntil = Date.now() + 2000;
      hideTypingIndicator();
      pollStatus();
      startChatPolling();
    } catch (e) {
      toast('Stop failed: ' + e.message, 'error');
    }
  }

  async function restartServer() {
    if (!confirm('Restart the Warden server? It will be unavailable for a few seconds.')) return;
    try {
      await postJson('/api/server/restart', {});
      toast('Restart issued — server will be back in a few seconds', 'success');
    } catch (e) {
      toast('Restart failed: ' + e.message, 'error');
    }
  }

  async function newThought() {
    // Tell the server to drop the seat's in-memory context so the
    // next message starts fresh (the agent-runner resets when it sees the
    // context-clear marker change), then reset the chat view.
    try {
      await postJson('/api/chat/clear-context', { jid: STATE.currentJid });
    } catch (e) { /* still reset the view below */ }
    STATE.chatLastTs = '';
    STATE.waitingForReply = false;
    waitingForReply = false;
    hideTypingIndicator();
    loadMessages();
    startChatPolling();
    toast('New thought started', 'info');
  }

  async function clearConversation() {
    // Delete the actual conversation log (messages in the DB) and reset all
    // live context + mercury compaction — a true fresh start, unlike New
    // Thought which only resets the context window. Destructive: confirm.
    if (!window.confirm('Delete the entire conversation log and start completely fresh? The stored messages and the conversation summary will be permanently removed.')) return;
    try {
      await postJson('/api/chat/clear-conversation', { jid: STATE.currentJid });
    } catch (e) {
      toast('Clear failed: ' + e.message, 'error');
      return;
    }
    STATE.chatLastTs = '';
    STATE.waitingForReply = false;
    waitingForReply = false;
    hideTypingIndicator();
    loadMessages();
    startChatPolling();
    toast('Conversation cleared', 'info');
  }

  // ============================================================= Settings drawer
  function openDrawer(title, bodyHtml) {
    $('drawerTitle').textContent = title;
    $('drawerBody').innerHTML = bodyHtml;
    $('drawer').classList.add('open');
    $('drawerBackdrop').classList.add('show');
  }
  function closeDrawer() {
    $('drawer').classList.remove('open');
    $('drawerBackdrop').classList.remove('show');
  }

  async function openSettings() {
    openDrawer('Settings', '<p class="dim mono" style="font-size:11px">Loading…</p>');
    try {
      await loadOllama();
      await loadSettingsValues();
    } catch (e) {
      console.error('openSettings', e);
    }
  }

  async function openAddPage() {
    openDrawer('Dashboard Pages (Beta)', '<p class="dim mono" style="font-size:11px">Loading…</p>');
    await renderDashboardPages();
  }

  async function renderDashboardPages() {
    let files = [];
    try {
      const d = await api('/api/dashboard-pages');
      files = d.files || [];
    } catch (e) {
      $('drawerBody').innerHTML = '<p class="dim" style="color:var(--danger)">Failed to load: ' + esc(e.message) + '</p>';
      return;
    }
    let html = '<div class="drawer-form">' +
      '<div class="help-callout help-callout-info" style="margin-bottom:14px">' +
        '<div class="help-callout-icon">β</div>' +
        '<div class="help-callout-body">' +
          '<p><strong>Beta → Live pipeline.</strong> Edit dashboard files in beta first, preview at <code>/beta/</code>, then promote. Live is backed up before every promotion so you can revert if something breaks.</p>' +
          '<p><strong>How to use:</strong> Tell Warden "add a dashboard page called X" or "edit the dashboard to add Y". Warden will write the change to <code>public/beta/</code>, then you preview and promote here.</p>' +
          '<p>Editable files: <code>index.html</code> (page structure + rail button), <code>js/app.js</code> (view logic), <code>css/style.css</code> (styling).</p>' +
          '<p><a href="/help/dashboard-pages.html" target="_blank">Read the full guide →</a></p>' +
        '</div>' +
      '</div>' +
      '<table class="dashboard-pages-table" style="width:100%;font-size:12px;border-collapse:collapse">' +
        '<thead><tr><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border)">File</th><th style="text-align:center;padding:6px;border-bottom:1px solid var(--border)">Beta</th><th style="text-align:center;padding:6px;border-bottom:1px solid var(--border)">Live</th><th style="text-align:left;padding:6px;border-bottom:1px solid var(--border)">Actions</th></tr></thead>' +
        '<tbody>' +
        files.map(f => {
          const status = f.dirty ? '<span style="color:var(--warn)">draft</span>' : (f.beta ? '<span style="color:var(--text-faint)">same as live</span>' : '<span style="color:var(--text-faint)">no draft</span>');
          return '<tr>' +
            '<td style="padding:6px;border-bottom:1px solid var(--border)"><code>' + esc(f.file) + '</code><br><span class="dim" style="font-size:10px">' + status + '</span></td>' +
            '<td style="text-align:center;padding:6px;border-bottom:1px solid var(--border)">' + (f.beta ? '✓' : '—') + '</td>' +
            '<td style="text-align:center;padding:6px;border-bottom:1px solid var(--border)">' + (f.live ? '✓' : '—') + '</td>' +
            '<td style="padding:6px;border-bottom:1px solid var(--border)">' +
              '<button class="btn btn-ghost btn-sm btn-dp-edit" data-file="' + escAttr(f.file) + '" style="margin-right:4px">Edit beta</button>' +
              '<button class="btn btn-ghost btn-sm btn-dp-diff" data-file="' + escAttr(f.file) + '" style="margin-right:4px" ' + (f.beta && f.dirty ? '' : 'disabled') + '>Diff</button>' +
              '<button class="btn btn-primary btn-sm btn-dp-promote" data-file="' + escAttr(f.file) + '" style="margin-right:4px" ' + (f.beta && f.dirty ? '' : 'disabled') + '>Promote</button>' +
              '<button class="btn btn-danger btn-sm btn-dp-revert" data-file="' + escAttr(f.file) + '" ' + (f.live ? '' : 'disabled') + '>Revert</button>' +
            '</td>' +
          '</tr>';
        }).join('') +
      '</tbody></table>' +
      '<div style="margin-top:12px"><button class="btn btn-secondary btn-sm" id="btnDpRefresh">Refresh</button>' +
      ' <a class="btn btn-ghost btn-sm" href="/beta/" target="_blank">Open /beta preview</a>' +
      ' <a class="btn btn-ghost btn-sm" href="/help/dashboard-pages.html" target="_blank">Help →</a></div>' +
    '</div>';
    $('drawerBody').innerHTML = html;
    qsa('.btn-dp-edit', $('drawerBody')).forEach(b => b.addEventListener('click', () => openDashboardPageEditor(b.dataset.file)));
    qsa('.btn-dp-diff', $('drawerBody')).forEach(b => b.addEventListener('click', () => showDashboardPageDiff(b.dataset.file)));
    qsa('.btn-dp-promote', $('drawerBody')).forEach(b => b.addEventListener('click', () => promoteDashboardPage(b.dataset.file)));
    qsa('.btn-dp-revert', $('drawerBody')).forEach(b => b.addEventListener('click', () => revertDashboardPage(b.dataset.file)));
    $('btnDpRefresh').addEventListener('click', renderDashboardPages);
  }

  async function openDashboardPageEditor(file) {
    let content = '', which = 'beta';
    try {
      const d = await api('/api/dashboard-pages/' + encodeURIComponent(file) + '?which=beta');
      content = d.content || '';
      which = d.which || 'beta';
    } catch (e) {
      // No beta yet — seed from live
      try {
        const d = await api('/api/dashboard-pages/' + encodeURIComponent(file) + '?which=live');
        content = d.content || '';
        which = 'live';
      } catch (e2) {
        toast('Failed to load ' + file + ': ' + e2.message, 'error');
        return;
      }
    }
    const html = '<div class="drawer-form">' +
      '<p class="dim mono" style="font-size:11px">Editing <strong>' + esc(file) + '</strong> in beta. Preview at <a href="/beta/" target="_blank">/beta/</a> before promoting.</p>' +
      '<textarea class="input" id="dpEditor" style="min-height:360px;font-family:var(--font-mono);font-size:12px;white-space:pre">' + escAttr(content) + '</textarea>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
        '<button class="btn btn-ghost btn-sm" id="btnDpCancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" id="btnDpSave">Save beta draft</button>' +
      '</div>' +
    '</div>';
    $('drawerBody').innerHTML = html;
    $('btnDpCancel').addEventListener('click', renderDashboardPages);
    $('btnDpSave').addEventListener('click', async () => {
      try {
        await postJson('/api/dashboard-pages/' + encodeURIComponent(file), { content: $('dpEditor').value });
        toast('Beta draft saved', 'success');
        await renderDashboardPages();
      } catch (e) { toast('Failed: ' + e.message, 'error'); }
    });
  }

  async function showDashboardPageDiff(file) {
    try {
      const d = await api('/api/dashboard-pages/' + encodeURIComponent(file) + '/diff');
      const html = '<div class="drawer-form">' +
        '<p class="dim mono" style="font-size:11px">Diff for <strong>' + esc(file) + '</strong> (live → beta).</p>' +
        '<pre style="background:var(--surface-2);padding:10px;border-radius:6px;font-size:10px;overflow:auto;max-height:420px">' + esc(d.diff || 'no diff') + '</pre>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn btn-ghost btn-sm" id="btnDpDiffBack">Back</button></div>' +
      '</div>';
      $('drawerBody').innerHTML = html;
      $('btnDpDiffBack').addEventListener('click', renderDashboardPages);
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function promoteDashboardPage(file) {
    if (!confirm('Promote ' + file + ' from beta to live? Live will be backed up.')) return;
    try {
      await postJson('/api/dashboard-pages/' + encodeURIComponent(file) + '/promote', {});
      toast(file + ' promoted to live. Refresh the main dashboard.', 'success');
      await renderDashboardPages();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function revertDashboardPage(file) {
    if (!confirm('Revert ' + file + ' live from the most recent backup?')) return;
    try {
      await postJson('/api/dashboard-pages/' + encodeURIComponent(file) + '/revert', {});
      toast(file + ' reverted to backup.', 'success');
      await renderDashboardPages();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function loadOllama() {
    try {
      const d = await api('/api/ollama/test');
      STATE.cachedOllamaModels = d.models || [];
      STATE.cachedFriendlyNames = d.friendlyNames || {};
      STATE.cachedCloudModels = d.cloudModels || [];
      STATE.cachedModelSizes = d.modelSizes || {};
      STATE.cachedThinking = d.thinking || {};
    } catch (e) {
      STATE.cachedOllamaModels = [];
      STATE.cachedFriendlyNames = {};
      STATE.cachedCloudModels = [];
      STATE.cachedModelSizes = {};
      STATE.cachedThinking = {};
    }
  }

  function modelOption(value, label, selected) {
    return '<option value="' + escAttr(value) + '"' + (selected ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  function fmtModelSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return (gb >= 10 ? gb.toFixed(0) : gb.toFixed(1)) + ' GB';
    const mb = bytes / (1024 * 1024);
    return Math.round(mb) + ' MB';
  }
  function buildModelOptions(models, fn, valueFn, opts) {
    opts = opts || {};
    if (!models.length) return '<option value="">No models</option>';
    const inheritOpt = opts.inherit ? '<option value="">(inherit)</option>' : '';
    const sizes = STATE.cachedModelSizes || {};
    return inheritOpt + models.map(m => {
      const value = valueFn(m);
      // Show the full model name (with its :tag) so different variants are
      // distinguishable — e.g. gemma4:e4b-it-q4_K_M vs gemma4:31b-cloud — plus
      // the local size. A user-set friendly name still wins.
      let label = fn[m];
      if (!label) {
        label = m;
        const sz = fmtModelSize(sizes[m]);
        if (sz) label += '  ·  ' + sz;
      }
      return modelOption(value, label);
    }).join('');
  }
  function buildOutputOptions(currentValue) {
    // '' (model default) must be FIRST, like buildCtxOptions: with no blank
    // option an unset value (fresh install) matched nothing, left the select on
    // 1024, and the next Save wrote max_output_tokens=1024 — silently capping
    // every reply, including a sub-agent writing a file.
    const common = ['', '1024', '2048', '4096', '8192', '16384', '32768'];
    const cur = String(currentValue || '');
    if (cur && !common.includes(cur)) common.push(cur);
    common.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : Number(a) - Number(b)));
    return common.map(v => modelOption(v, v || 'default', cur === v)).join('');
  }

  function buildCtxOptions(currentValue) {
    const common = ['', '2048', '4096', '8192', '16384', '32768', '65536', '128000', '262144', '524288', '1048576'];
    const cur = String(currentValue || '');
    if (cur && !common.includes(cur)) common.push(cur);
    common.sort((a, b) => {
      const an = a === '' ? 0 : Number(a);
      const bn = b === '' ? 0 : Number(b);
      return an - bn;
    });
    return common.map(v => modelOption(v, v || 'default', cur === v)).join('');
  }

  async function loadSettingsValues() {
    let d = {};
    try { d = await api('/api/settings'); STATE.cachedSettings = d; } catch (e) { console.error(e); }

    const models = STATE.cachedOllamaModels || [];
    const fn = STATE.cachedFriendlyNames || {};

    // All models come from Ollama's /api/tags (including :cloud variants).
    // Cloud tags end in :cloud; everything else is local. No hardcoded cloud list.
    const orchHtml = buildModelOptions(models, fn, m => m);
    const anyModelHtml = buildModelOptions(models, fn, m => m, { inherit: true });
    // Driving-force presets (seat preamble) — from data/driving-forces/.
    // '' = Warden default (the built-in preamble, preserves the dynamic name).
    const drivingForceHtml = '<option value="">Warden (default)</option>' +
      (d.drivingForces || []).map(p => modelOption(p.id, p.label)).join('');

    const body = `
      <div class="setting-card">
        <h3>General</h3>
        <div class="hint">Assistant name, timezone. Changes propagate to all group WARDEN.md files on save.</div>
        <div class="setting-row"><label>Assistant</label><input class="input" id="sAssistantName" value="${escAttr(d.assistantName || '')}" placeholder="Warden"></div>
        <div class="setting-row"><label>Timezone</label>
          <select class="select" id="sTimezone">
            <option value="America/Vancouver">America/Vancouver (PT)</option>
            <option value="America/Los_Angeles">America/Los_Angeles (PT)</option>
            <option value="America/Edmonton">America/Edmonton (MT)</option>
            <option value="America/Denver">America/Denver (MT)</option>
            <option value="America/Winnipeg">America/Winnipeg (CT)</option>
            <option value="America/Chicago">America/Chicago (CT)</option>
            <option value="America/Toronto">America/Toronto (ET)</option>
            <option value="America/New_York">America/New_York (ET)</option>
            <option value="America/Halifax">America/Halifax (AT)</option>
            <option value="America/St_Johns">America/St_Johns (NT)</option>
            <option value="Europe/London">Europe/London (GMT/BST)</option>
            <option value="Europe/Paris">Europe/Paris (CET)</option>
            <option value="Europe/Berlin">Europe/Berlin (CET)</option>
            <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
            <option value="Asia/Tokyo">Asia/Tokyo (JST)</option>
            <option value="Australia/Sydney">Australia/Sydney (AEDT)</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveGeneral">Save</button><span class="status" id="generalStatus"></span></div>
      </div>

      <div class="setting-card">
        <h3>Default apps</h3>
        <div class="hint">Which tool does each job. Warden ships a built-in provider for each capability; an installed MCP server can take one over. Choosing a server <b>replaces</b> the built-in rather than sitting beside it — one provider per job, so there is never a choice to get wrong.</div>
        <div id="defaultAppsRows"><div class="dim mono" style="font-size:11px">Loading…</div></div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveDefaultApps">Save</button><span class="status" id="defaultAppsStatus"></span></div>
        <div class="section-divider">Pinned tools</div>
        <div class="hint">Tools exempt from relevance ranking — always in the pool the agent sees, whatever the ask. Pin a tool whose description loses the user's words to generic ones. The list is the live tool pool; picking replaces typing.</div>
        <div class="pin-chips" id="pinChips"></div>
        <div class="pin-add-row"><select class="select" id="pinAddSelect"><option value="">Add a tool…</option></select></div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSavePinnedTools">Save pins</button><span class="status" id="pinnedToolsStatus"></span></div>
      </div>

      <div class="setting-card">
        <h3>Model Configuration</h3>
        <div class="hint"><b>Atlas</b> is the one seat you talk to: it replies <em>and</em> does the work itself — browser, desktop, files, shell, web — and it owns multi-specialist chains: it calls the specialists directly (Vulkan, Iris, Artemis, Sentry) and verifies each result. Long jobs run as a background copy of it, on these same settings. Supervisor runs the checks on background jobs (small/cloud model recommended). Artemis is the read-only audit seat. Vulkan codes. The Council uses three separate seats. Iris is the single <b>Toolcall agent</b> — the fast local agent for email, scheduling, and work management, and email always routes there. Mercury (memory) and Oculus (awareness) have their own rows below.</div>
        <div class="setting-row"><label>Atlas</label>
          <select class="select" id="sAtlas">${orchHtml}</select>
          <span class="dim mono" style="font-size:10px">Atlas IS the seat — this model replies to you and runs every turn.</span>
        </div>
        <div class="setting-row"><label>Atlas ctx</label>
          <select class="select small" id="sAtlasCtx">${buildCtxOptions(d.atlasCtx)}</select>
          <span class="dim mono" style="font-size:10px">common values; blank = model default</span>
        </div>
        <div class="setting-row"><label>Atlas keep alive</label>
          <label class="check"><input type="checkbox" id="sAtlasKeepAlive"> hold model in VRAM between turns (no reload)</label>
        </div>
        <div class="setting-row"><label>Max output</label>
          <select class="select small" id="sMaxOutput">${buildOutputOptions(d.maxOutputTokens)}</select>
          <span class="dim mono" style="font-size:10px">tokens one reply may generate (not ctx) — caps a model that loses the thread</span>
        </div>
        <div class="setting-row"><label>Driving force</label>
          <select class="select" id="sDrivingForce">${drivingForceHtml}</select>
          <span class="dim mono" style="font-size:10px">seat persona; switching clears context</span>
        </div>
        <div class="setting-row"><label>Artemis</label>
          <select class="select" id="sArtemis">${orchHtml}</select>
        </div>
        <div class="setting-row"><label>Artemis ctx</label>
          <select class="select small" id="sArtemisCtx">${buildCtxOptions(d.artemisCtx)}</select>
          <span class="dim mono" style="font-size:10px">common values; blank = model default</span>
        </div>
        <div class="setting-row"><label>Sentry</label>
          <select class="select" id="sSentry">${orchHtml}</select>
        </div>
        <div class="setting-row"><label>Sentry ctx</label>
          <select class="select small" id="sSentryCtx">${buildCtxOptions(d.sentryCtx)}</select>
          <span class="dim mono" style="font-size:10px">common values; blank = model default</span>
        </div>
        <div class="setting-row"><label>Vulkan</label>
          <select class="select" id="sVulkan">${orchHtml}</select>
        </div>
        <div class="setting-row"><label>Vulkan Ollama</label>
          <select class="select" id="sVulkanOllamaServer"></select>
          <span class="dim mono" style="font-size:10px">blank = default server</span>
        </div>
        <div class="setting-row"><label>Vulkan ctx</label>
          <select class="select small" id="sVulkanCtx">${buildCtxOptions(d.vulkanCtx)}</select>
          <span class="dim mono" style="font-size:10px">common values; blank = model default</span>
        </div>
        <div class="setting-row" style="align-items:flex-start">
          <label>The Council</label>
          <div class="council-grid" style="flex:1">
            <div><label>Skeptic</label><select class="select" id="sSkeptic">${anyModelHtml}</select></div>
            <div><label>Pragmatist</label><select class="select" id="sPragmatist">${anyModelHtml}</select></div>
            <div><label>Synthesist</label><select class="select" id="sSynthesist">${anyModelHtml}</select></div>
          </div>
        </div>
        <div class="setting-row" style="align-items:flex-start">
          <label>Toolcall model</label>
          <div style="flex:1">
            <select class="select" id="sToolcallModel">${orchHtml}</select>
            <div class="dim mono" style="font-size:10px;margin-top:2px">The fast local tool-call agent — email, scheduling, work management.</div>
            <div class="setting-row" style="margin-top:6px"><label>ctx</label>
              <select class="select small" id="sToolcallCtx">${buildCtxOptions(d.subagentCtx)}</select>
              <span class="dim mono" style="font-size:10px">blank = model default</span>
            </div>
            <label class="check" style="margin-top:6px"><input type="checkbox" id="sToolcallKeepAlive"> Keep alive — hold in VRAM between turns (no reload)</label>
          </div>
        </div>
        <div class="setting-row"><label>Ollama URL</label><input class="input" id="sOllamaUrl" value="${escAttr(d.ollamaUrl || '')}" placeholder="http://127.0.0.1:11434"></div>
        <div class="setting-row"><label>Mercury</label>
          <select class="select" id="sMercuryModel">${orchHtml}</select>
        </div>
        <div class="setting-row"><label>Mercury ctx</label>
          <select class="select small" id="sMercuryCtx">${buildCtxOptions(d.mercuryCtx)}</select>
          <span class="dim mono" style="font-size:10px">blank = inherits Toolcall ctx</span>
        </div>
        <div class="setting-row"><label>Mercury mode</label>
          <select class="select" id="sMercury">
            <option value="off">Off — no automatic context</option>
            <option value="rag">RAG — inject relevant older turns</option>
            <option value="summary">Summary — rolling memory only</option>
            <option value="full">Full — summary + RAG</option>
          </select>
        </div>
        <div class="setting-row"><label>Ops model</label>
          <select class="select" id="sOpsModel">${anyModelHtml}</select>
          <span class="dim mono" style="font-size:10px">model for heavy utility tools &amp; external integrations — Alpha Stack analysis + MARM topic model today; blank = leave each to its own config</span>
        </div>
        <div class="setting-row"><label>Oculus</label>
          <select class="select" id="sOculusModel">${orchHtml}</select>
        </div>
        <div class="setting-row"><label>Oculus ctx</label>
          <select class="select small" id="sOculusCtx">${buildCtxOptions(d.oculusCtx)}</select>
          <span class="dim mono" style="font-size:10px">blank = inherits Toolcall ctx</span>
        </div>
        <div class="setting-row"><label>Oculus Ollama</label>
          <select class="select" id="sOculusOllamaServer"></select>
          <span class="dim mono" style="font-size:10px">blank = default server</span>
        </div>
        <div class="setting-row"><label>Thinking</label>
          <select class="select" id="sThinking">
            <option value="true">On — first turn + always-think models</option>
            <option value="max">Max — every iteration</option>
            <option value="false">Off — no reasoning blocks</option>
          </select>
          <span class="dim mono" style="font-size:10px">global default; chat-level override removed</span>
        </div>
        <div class="setting-row"><label>Idle clear</label>
          <select class="select small" id="sContextIdleClear">
            <option value="0">Off — never auto-clear</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">60 min</option>
            <option value="120">2 h</option>
            <option value="240">4 h</option>
          </select>
          <span class="dim mono" style="font-size:10px">clear context if the last user message was older than this</span>
        </div>
        <div class="setting-row"><label>Mercury interval</label>
          <select class="select small" id="sMercuryInterval">
            <option value="0">Off</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 h</option>
          </select>
          <span class="dim mono" style="font-size:10px">compact the conversation at least this often (0 = only on downtime)</span>
        </div>
        <div class="setting-row"><label>Mercury downtime</label>
          <select class="select small" id="sMercuryDowntime">
            <option value="0">Off</option>
            <option value="3">3 min</option>
            <option value="5">5 min</option>
            <option value="10">10 min</option>
            <option value="15">15 min</option>
          </select>
          <span class="dim mono" style="font-size:10px">also compact after this long with no activity (0 = interval only)</span>
        </div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveModels">Save</button><span class="status" id="modelStatus"></span></div>
      </div>

      <div class="setting-card">
        <h3>Servers</h3>
        <div class="hint">Role URLs used by the Warden backend. Ollama servers below are referenced by per-agent dropdowns in Model Configuration.</div>
        <div class="setting-row"><label>Audio / Transcription server</label><input class="input" id="sAudioServerUrl" value="${escAttr(d.audioServerUrl || '')}" placeholder="http://localhost:8766"></div>
        <div class="setting-row"><label>Video server</label><input class="input" id="sVideoServerUrl" value="${escAttr(d.videoServerUrl || '')}" placeholder="http://localhost:8765"></div>
        <div class="setting-row"><label>Satellite (remote mic/speaker)</label><input class="input" id="sSatelliteUrl" value="${escAttr(d.satelliteUrl || '')}" placeholder="http://192.168.0.160:8766"></div>
        <div class="setting-row"><label>Whisper API fallback</label><input class="input" id="sTranscriptionApiUrl" value="${escAttr(d.transcriptionApiUrl || '')}" placeholder="https://api.groq.com/openai (Groq, autofilled)"></div>
        <div style="margin-bottom:6px"><span class="dim" style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;letter-spacing:0.04em">Ollama servers</span>
          <div style="display:flex;flex-direction:column;gap:2px;margin-top:2px">
            <div style="display:flex;gap:6px;align-items:center"><input type="radio" name="ollamaDefault" value="1"><input class="input" id="sOllamaLabel1" placeholder="label" style="flex:0 0 120px"><input class="input" id="sOllamaUrl1" placeholder="http://127.0.0.1:11434" style="flex:1;min-width:0"></div>
            <div style="display:flex;gap:6px;align-items:center"><input type="radio" name="ollamaDefault" value="2"><input class="input" id="sOllamaLabel2" placeholder="label" style="flex:0 0 120px"><input class="input" id="sOllamaUrl2" placeholder="http://127.0.0.1:11434" style="flex:1;min-width:0"></div>
            <div style="display:flex;gap:6px;align-items:center"><input type="radio" name="ollamaDefault" value="3"><input class="input" id="sOllamaLabel3" placeholder="label" style="flex:0 0 120px"><input class="input" id="sOllamaUrl3" placeholder="http://127.0.0.1:11434" style="flex:1;min-width:0"></div>
          </div>
        </div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveServers">Save</button><span class="status" id="serversStatus"></span></div>
      </div>

      <div class="setting-card">
        <h3>Friendly model names</h3>
        <div class="hint">Rename Ollama models for display in dropdowns. Blank = use original tag.</div>
        <div id="friendlyList"></div>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveFriendly">Save</button><span class="status" id="friendlyStatus"></span></div>
      </div>

      <div class="setting-card">
        <h3>Oculus rules</h3>
        <div class="hint">Edit eyes_ears/oculus.md. Oculus reads this file to know how to silently log camera events.</div>
        <textarea class="input" id="sOculusMd" rows="16" style="font-family:monospace;font-size:12px;white-space:pre-wrap">${escAttr(d.oculusMd || '')}</textarea>
        <div class="save-row">
          <button class="btn btn-primary btn-sm" id="btnSaveOculusMd">Save Oculus.md</button>
          <span class="status" id="oculusMdStatus"></span>
        </div>
      </div>

      <div class="setting-card">
        <h3>Oculus — watch out for</h3>
        <div class="hint">One situation per line. When an awareness event clearly matches one, Oculus saves the photo to uploads and logs it silently (it does not message you).</div>
        <textarea class="input" id="sWatchOut" rows="6" placeholder="e.g. someone taking food from the fridge"></textarea>
        <div class="save-row">
          <button class="btn btn-primary btn-sm" id="btnSaveWatchOut">Save list</button>
          <span class="status" id="watchOutStatus"></span>
        </div>
      </div>

      <div class="setting-card">
        <h3>Chat logs</h3>
        <div class="hint">Persistent logs are written by the system service. View them from the Process Logs page or directly on disk.</div>
        <div id="logInfo"></div>
        <div class="save-row">
          <button class="btn btn-ghost btn-sm" id="btnRefreshLogInfo">Refresh size</button>
          <button class="btn btn-danger btn-sm" id="btnTruncateLogs">Delete logs</button>
        </div>
      </div>

      <div class="setting-card">
        <h3>Danger</h3>
        <div class="hint">Server restart required for some env changes (container image, ollama URL) to fully take effect.</div>
        <div class="save-row"><button class="btn btn-danger btn-sm" id="btnRestartServer2">Restart server</button></div>
      </div>
    `;
    $('drawerBody').innerHTML = body;

    // ── Redesigned layout: tabs over the existing cards, no control IDs moved ──
    (function buildSettingsTabs() {
      const db = $('drawerBody');
      const cards = [...db.querySelectorAll('.setting-card')];
      const shell = document.createElement('div');
      shell.className = 'settings-shell';
      const tabs = document.createElement('div');
      tabs.className = 'settings-tabs';
      tabs.setAttribute('role', 'tablist');
      const defs = [['assistant','Assistant'],['models','Models'],['tools','Tools'],['servers','Servers'],['advanced','Advanced']];
      defs.forEach(([id, label], i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'settings-tab' + (i === 0 ? ' active' : '');
        b.dataset.tab = id;
        b.textContent = label;
        tabs.appendChild(b);
      });
      shell.appendChild(tabs);
      const panels = {};
      defs.forEach(([id]) => {
        const p = document.createElement('div');
        p.className = 'settings-panel' + (id === 'assistant' ? ' active' : '');
        p.dataset.panel = id;
        panels[id] = p;
        shell.appendChild(p);
      });
      const map = {
        'General': 'assistant',
        'Model Configuration': 'models',
        'Default apps': 'tools',
        'Servers': 'servers',
        'Friendly model names': 'advanced',
        'Oculus rules': 'advanced',
        'Oculus — watch out for': 'advanced',
        'Chat logs': 'advanced',
        'Danger': 'advanced'
      };
      cards.forEach(card => {
        const h = card.querySelector('h3');
        const key = h ? h.textContent.trim() : '';
        (panels[map[key]] || panels.advanced).appendChild(card);
      });
      db.innerHTML = '';
      db.appendChild(shell);

      const lead = (txt) => { const p = document.createElement('p'); p.className = 'settings-lead'; p.textContent = txt; return p; };
      panels.models.prepend(lead('One model per role. Atlas is the seat; Vulkan escalates; Iris executes tools.'));
      panels.tools.prepend(lead('What each capability uses, which tools are always visible, and how the seat finds the rest.'));

      const keepSel = (cur) => {
        const opts = ['24h','12h','1h','30m','5m','-1'];
        const v = String(cur || '24h');
        return opts.map(o => `<option value="${o}"${o === v ? ' selected' : ''}>${o === '-1' ? 'Hold in VRAM (forever)' : o}</option>`).join('');
      };
      const rag = document.createElement('section');
      rag.className = 'setting-card';
      rag.innerHTML = `
        <h3>Tool retrieval</h3>
        <p class="hint">The seat only sees the ~12 most relevant tools each turn. Semantic ranking matches meaning; keyword ranking matches words. Both together is the default.</p>
        <div class="setting-row"><label>Semantic ranking</label><label class="switch"><input type="checkbox" id="sSelectionSemantic" ${String(d.selectionSemantic || '1') !== '0' ? 'checked' : ''}><span>Use embeddings alongside keywords</span></label></div>
        <div class="setting-row"><label>Embedding model</label><input class="input" id="sSelectionEmbedModel" value="${escAttr(d.selectionEmbedModel || 'qwen3-embedding:0.6b')}" placeholder="qwen3-embedding:0.6b"></div>
        <div class="setting-row"><label>Keep model loaded</label><select class="select" id="sSelectionKeepAlive">${keepSel(d.selectionEmbedKeepAlive)}</select></div>
        <div class="setting-row"><label>Semantic weight</label><input class="input small" type="number" min="0" max="1" step="0.05" id="sSelectionSemanticWeight" value="${escAttr(d.selectionSemanticWeight || '0.8')}"></div>
        <div class="setting-row"><label>Keyword weight</label><input class="input small" type="number" min="0" max="1" step="0.05" id="sSelectionLexicalWeight" value="${escAttr(d.selectionLexicalWeight || '0.2')}"></div>
        <div class="setting-row"><label>Exact-name bonus</label><input class="input small" type="number" min="0" max="1" step="0.05" id="sSelectionNameBonus" value="${escAttr(d.selectionNameBonus || '0.25')}"></div>
        <div class="setting-row"><label>Query timeout</label><input class="input small" type="number" min="500" step="100" id="sSelectionEmbedTimeoutMs" value="${escAttr(d.selectionEmbedTimeoutMs || '2500')}"><span class="dim mono" style="font-size:10px">ms</span></div>
        <p class="settings-note">Changes apply to the next session. Turn semantic off for pure keyword matching.</p>
        <div class="save-row"><button class="btn btn-primary btn-sm" id="btnSaveRag">Save retrieval</button><span class="status" id="ragStatus"></span></div>
      `;
      panels.tools.appendChild(rag);

      tabs.querySelectorAll('.settings-tab').forEach(t => t.addEventListener('click', () => {
        tabs.querySelectorAll('.settings-tab').forEach(x => x.classList.toggle('active', x === t));
        Object.values(panels).forEach(pn => pn.classList.toggle('active', pn.dataset.panel === t.dataset.tab));
      }));
    })();

    // Apply current values
    const setSelect = (id, val) => {
      const sel = $(id);
      if (!sel) return;
      const v = (val || '').replace(/^local:/, '');
      const opt = Array.from(sel.options).find(o => o.value === val || o.value === v);
      if (opt) { sel.value = opt.value; return; }
      // Saved model isn't in the cached Ollama list (e.g. a :cloud tag the
      // local server doesn't report) — append it so the dropdown shows the
      // actually-configured model instead of silently falling back to the
      // first option, which the next Save would then write over it.
      if (v) {
        const o = document.createElement('option');
        o.value = v; o.textContent = v;
        sel.appendChild(o);
        sel.value = v;
      }
    };
    setSelect('sArtemis', (d.artemisModel || '').replace(/^local:/, ''));
    setSelect('sSentry', (d.sentryModel || '').replace(/^local:/, ''));
    setSelect('sSentryCtx', d.sentryCtx || '');
    setSelect('sVulkan', (d.vulkanModel || '').replace(/^local:/, ''));
    setSelect('sToolcallModel', (d.ollamaChatModel || '').replace(/^local:/, ''));
    setSelect('sToolcallCtx', d.subagentCtx || '');
    setSelect('sDrivingForce', d.drivingForce || '');
    setSelect('sSkeptic', (d.councilSkepticModel || '').replace(/^local:/, ''));
    setSelect('sPragmatist', (d.councilPragmatistModel || '').replace(/^local:/, ''));
    setSelect('sSynthesist', (d.councilSynthesistModel || '').replace(/^local:/, ''));
    setSelect('sMercuryModel', (d.mercuryModel || '').replace(/^local:/, ''));
    setSelect('sMercuryCtx', d.mercuryCtx || '');
    setSelect('sOculusModel', (d.oculusModel || '').replace(/^local:/, ''));
    setSelect('sMercury', d.mercuryMode || 'full');
    setSelect('sOpsModel', (d.opsModel || '').replace(/^local:/, ''));
    setSelect('sThinking', d.thinking || 'true');
    // Default apps: one row per capability, options = built-in + every
    // installed MCP server. The server list comes from /api/mcp-servers so a
    // newly installed server shows up without a dashboard change.
    // Each row states what the capability covers and what the built-in
    // provides — a default here REPLACES those built-in tools everywhere, so
    // the choice must be self-explanatory (a browser bridge cannot provide
    // web search/fetch, an MCP shell is not the persistent Bash, etc.).
    (async function () {
      const rows = $('defaultAppsRows'); if (!rows) return;
      const caps = Array.isArray(d.defaultAppCapabilities) ? d.defaultAppCapabilities : [];
      const chosen = d.defaultApps || {};
      let servers = [];
      try { servers = ((await api('/api/mcp-servers')).servers || []).filter(x => x.enabled !== false); } catch (e) { servers = []; }
      const CAP_INFO = {
        browser: {
          what: 'INTERACTIVE browsing — clicking, typing, logins, playing video in your real Chrome.',
          builtin: 'none (the old debug browser is retired) — pick your browser bridge below',
        },
        web: {
          what: 'READING and SEARCHING pages — WebSearch / WebFetch: plain HTTP, no browser, no login session.',
          builtin: 'WebSearch + WebFetch. Keep built-in unless your MCP server truly provides search/fetch — a browser bridge cannot do this job.',
        },
        files: {
          what: 'Reading and writing files — read_file / write_file / list_file, plus the Read / Write / Glob / Grep set for specialists.',
          builtin: "the agent's own file tools",
        },
        shell: {
          what: 'Running commands.',
          builtin: "the agent's persistent Bash (cd and environment carry across calls). An MCP shell is one-shot per call.",
        },
        capture: {
          what: 'Screen and webcam captures.',
          builtin: "the agent's own capture tools",
        },
      };
      if (!caps.length) { rows.innerHTML = '<div class="dim mono" style="font-size:11px">No capabilities registered.</div>'; return; }
      rows.innerHTML = caps.map(cap => {
        const cur = String(chosen[cap] || 'builtin');
        const info = CAP_INFO[cap] || { what: '', builtin: "Warden's built-in tools" };
        const opts = ['<option value="builtin"' + (cur === 'builtin' ? ' selected' : '') + '>Built-in — ' + esc(info.builtin) + '</option>']
          .concat(servers.map(sv => {
            const v = 'mcp:' + sv.name;
            return '<option value="' + escAttr(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(sv.name) + ' (MCP)</option>';
          }));
        return '<div class="setting-row" style="display:block"><label style="font-weight:600">' + esc(cap) + '</label>'
          + '<div class="dim" style="font-size:11px;margin:2px 0 4px">' + esc(info.what) + '</div>'
          + '<select class="select" data-defaultapp="' + escAttr(cap) + '">' + opts.join('') + '</select></div>';
      }).join('');
    })();
    // Pinned tools: chips for what's pinned (click × to unpin), a select over
    // the live tool pool to add (never free text), own save button posting
    // pinned_tools. Pins not in the pool (e.g. MCP tools pinned via the API)
    // still render as chips so nothing is silently dropped.
    (function () {
      const box = $('pinChips'); if (!box) return;
      const sel = $('pinAddSelect'); if (!sel) return;
      let pins = Array.isArray(d.pinnedTools) ? d.pinnedTools.slice() : [];
      const pool = Array.isArray(d.toolPool) ? d.toolPool : [];
      const render = () => {
        box.innerHTML = pins.length
          ? pins.map(p => '<span class="pin-chip">' + esc(p) +
              '<span class="del" data-pin-del="' + escAttr(p) + '" title="Unpin">×</span></span>').join('')
          : '<span class="dim mono" style="font-size:11px">Nothing pinned — every tool competes on relevance each turn.</span>';
        sel.innerHTML = '<option value="">Add a tool…</option>' +
          pool.filter(t => !pins.includes(t)).map(t => '<option value="' + escAttr(t) + '">' + esc(t) + '</option>').join('');
        sel.value = '';
      };
      render();
      sel.onchange = () => { const v = sel.value; if (v && !pins.includes(v)) { pins.push(v); render(); } };
      box.onclick = (e) => {
        const del = e.target.closest('[data-pin-del]'); if (!del) return;
        pins = pins.filter(p => p !== del.dataset.pinDel); render();
      };
      const btn = $('btnSavePinnedTools');
      if (btn) btn.onclick = async () => {
        const st = $('pinnedToolsStatus');
        if (st) st.textContent = 'Saving…';
        try {
          await postJson('/api/settings', { pinned_tools: pins });
          if (st) st.textContent = 'Saved — applies to the next agent dispatch.';
        } catch (e) {
          if (st) st.textContent = 'Failed: ' + (e && e.message ? e.message : e);
        }
      };
    })();
    // Keep-alive checkboxes: -1 = resident (checked), 300 = 5 min (unchecked).
    $('sAtlasKeepAlive').checked = d.atlasKeepAlive === '-1';
    $('sToolcallKeepAlive').checked = d.toolcallKeepAlive === '-1';
    setSelect('sContextIdleClear', d.contextIdleClearMinutes || '0');
    setSelect('sMercuryInterval', d.mercuryIntervalMinutes || '30');
    setSelect('sMercuryDowntime', d.mercuryDowntimeMinutes || '5');
    // Timezone dropdown: select the saved zone, appending it as an extra
    // option if it isn't in the curated list (preserves custom values).
    (function () {
      const _sel = $('sTimezone'); if (!_sel) return;
      const _tz = d.timezone || 'America/Vancouver';
      if (!Array.from(_sel.options).some(o => o.value === _tz)) {
        const _o = document.createElement('option');
        _o.value = _tz; _o.textContent = _tz; _sel.appendChild(_o);
      }
      _sel.value = _tz;
    })();
    setSelect('sAtlas', (d.atlasModel || '').replace(/^local:/, ''));
    setSelect('sAtlasCtx', d.atlasCtx || '');
    setSelect('sMaxOutput', d.maxOutputTokens || '');
    setSelect('sArtemisCtx', d.artemisCtx || '');
    setSelect('sVulkanCtx', d.vulkanCtx || '');
    setSelect('sIrisCtx', d.irisCtx || '');
    setSelect('sOculusCtx', d.oculusCtx || '');

    // Servers card
    $('sAudioServerUrl').value = esc(d.audioServerUrl || '');
    $('sVideoServerUrl').value = esc(d.videoServerUrl || '');
    $('sSatelliteUrl').value = esc(d.satelliteUrl || '');
    $('sTranscriptionApiUrl').value = esc(d.transcriptionApiUrl || '');

    // Ollama servers list (up to 3 fixed slots, ids s1/s2/s3)
    const ollamaServers = Array.isArray(d.ollamaServers) ? d.ollamaServers : [];
    const slotIds = ['s1', 's2', 's3'];
    for (let i = 0; i < 3; i++) {
      const srv = ollamaServers[i];
      $('sOllamaLabel' + (i + 1)).value = esc((srv && srv.label) || '');
      $('sOllamaUrl' + (i + 1)).value = esc((srv && srv.url) || '');
    }
    // Default radio — map id s1/s2/s3 → 1/2/3
    const defId = d.ollamaDefaultServerId || '';
    const defIdx = slotIds.indexOf(defId) + 1;
    const radio = document.querySelector('input[name="ollamaDefault"][value="' + defIdx + '"]');
    if (radio) radio.checked = true;

    // Per-agent Ollama server selects
    const ollamaOptionsHtml = '<option value="">Default</option>' +
      ollamaServers.filter(s => s && s.url).map(s =>
        '<option value="' + escAttr(s.id || '') + '">' + esc(s.label || s.id || '') + '</option>'
      ).join('');
    const fillAgentServerSelect = (id, val) => {
      const sel = $(id);
      if (!sel) return;
      sel.innerHTML = ollamaOptionsHtml;
      const v = (val || '');
      const opt = Array.from(sel.options).find(o => o.value === v);
      if (opt) sel.value = v;
    };
    fillAgentServerSelect('sVulkanOllamaServer', d.vulkanOllamaServer || '');
    fillAgentServerSelect('sOculusOllamaServer', d.oculusOllamaServer || '');

    // Friendly names list
    const fl = $('friendlyList');
    if (models.length === 0) {
      fl.innerHTML = '<p class="dim mono" style="font-size:11px">No Ollama models loaded. Start Ollama and reload.</p>';
    } else {
      fl.innerHTML = models.map(m =>
        '<div class="row tight" style="margin-bottom:4px">' +
        '<span class="mono" style="flex:0 0 160px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(m) + '">' + esc(m) + '</span>' +
        '<input class="input" data-model="' + escAttr(m) + '" value="' + escAttr(fn[m] || '') + '" placeholder="' + escAttr(m.split(':')[0] || m) + '" style="flex:1;min-width:0">' +
        '</div>'
      ).join('');
    }

    // Hook save buttons
    $('btnSaveGeneral').addEventListener('click', saveGeneral);
    const btnDA = $('btnSaveDefaultApps');
    if (btnDA) btnDA.addEventListener('click', async () => {
      const st = $('defaultAppsStatus');
      const payload = {};
      qsa('[data-defaultapp]').forEach(el => { payload[el.dataset.defaultapp] = el.value; });
      if (st) st.textContent = 'Saving…';
      try {
        await postJson('/api/settings', { default_apps: payload });
        if (st) st.textContent = 'Saved — applies to the next agent dispatch.';
      } catch (e) {
        if (st) st.textContent = 'Failed: ' + (e && e.message ? e.message : e);
      }
    });
    $('btnSaveModels').addEventListener('click', saveModels);
    if ($('btnSaveRag')) $('btnSaveRag').addEventListener('click', saveRag);
    $('btnSaveServers').addEventListener('click', saveServers);
    $('btnSaveFriendly').addEventListener('click', saveFriendly);
    $('btnSaveOculusMd').addEventListener('click', saveOculusMd);
    $('btnSaveWatchOut').addEventListener('click', saveWatchOut);
    $('btnRestartServer2').addEventListener('click', restartServer);

    loadWatchOut();

    refreshLogInfo();
    $('btnRefreshLogInfo').addEventListener('click', refreshLogInfo);
    $('btnTruncateLogs').addEventListener('click', truncateLogs);
  }

  function fmtBytes(n) {
    const num = Number(n) || 0;
    if (num < 1024) return num + ' B';
    if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
    if (num < 1024 * 1024 * 1024) return (num / (1024 * 1024)).toFixed(1) + ' MB';
    return (num / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async function refreshLogInfo() {
    const el = $('logInfo');
    if (!el) return;
    el.innerHTML = '<p class="dim mono" style="font-size:11px">Loading…</p>';
    try {
      const d = await api('/api/process-logs?lines=1');
      const sizes = d.sizes || {};
      el.innerHTML = `
        <div class="setting-row"><label>Stdout</label><span class="mono"><code>logs/warden.log</code> · ${esc(fmtBytes(sizes.stdout))}</span></div>
        <div class="setting-row"><label>Stderr</label><span class="mono"><code>logs/warden.error.log</code> · ${esc(fmtBytes(sizes.stderr))}</span></div>
        <div class="setting-row"><label>Access</label><span class="dim">Process Logs tab · shell: <code>tail -f logs/warden.log</code></span></div>
        <div class="setting-row"><label>Retention</label><span class="dim">No automatic rotation. Delete manually with the button below when size grows.</span></div>
        <div class="setting-row"><label>Delete</label><span class="dim">Truncates both log files to 0 bytes. Irreversible.</span></div>
      `;
    } catch (e) {
      el.innerHTML = '<p class="dim mono" style="font-size:11px;color:var(--danger)">Failed: ' + esc(e.message) + '</p>';
    }
  }

  async function truncateLogs() {
    if (!confirm('Delete both warden.log and warden.error.log? This cannot be undone.')) return;
    try {
      await postJson('/api/process-logs', { action: 'truncate' });
      toast('Logs truncated', 'success');
      refreshLogInfo();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  }

  async function saveGeneral() {
    const st = $('generalStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const body = {
        assistantName: $('sAssistantName').value.trim(),
        timezone: $('sTimezone').value.trim(),
      };
      await postJson('/api/settings', body);
      st.textContent = 'saved'; st.className = 'status ok';
      if (body.assistantName) { STATE.assistantName = body.assistantName; $('assistantName').textContent = body.assistantName.toUpperCase(); }
      toast('General settings saved', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function saveModels() {
    const st = $('modelStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const stripLocal = (v) => (v || '').replace(/^local:/, '');
      const prevDrivingForce = (STATE.cachedSettings && STATE.cachedSettings.drivingForce) || '';
      const body = {
        artemisModel: stripLocal($('sArtemis').value),
        sentryModel: stripLocal($('sSentry').value),
        sentryCtx: $('sSentryCtx').value,
        vulkanModel: stripLocal($('sVulkan').value),
        ollamaChatModel: stripLocal($('sToolcallModel').value),
        drivingForce: $('sDrivingForce').value,
        councilSkepticModel: stripLocal($('sSkeptic').value),
        councilPragmatistModel: stripLocal($('sPragmatist').value),
        councilSynthesistModel: stripLocal($('sSynthesist').value),
        mercuryModel: stripLocal($('sMercuryModel').value),
        mercuryCtx: $('sMercuryCtx').value,
        oculusModel: stripLocal($('sOculusModel').value),
        oculusCtx: $('sOculusCtx').value,
        mercuryMode: $('sMercury').value,
        opsModel: stripLocal($('sOpsModel').value),
        thinking: $('sThinking').value,
        contextIdleClearMinutes: $('sContextIdleClear').value,
        mercuryIntervalMinutes: $('sMercuryInterval').value,
        mercuryDowntimeMinutes: $('sMercuryDowntime').value,
        atlasModel: stripLocal($('sAtlas').value),
        atlasCtx: $('sAtlasCtx').value,
        maxOutputTokens: $('sMaxOutput').value,
        artemisCtx: $('sArtemisCtx').value,
        vulkanCtx: $('sVulkanCtx').value,
        subagentCtx: $('sToolcallCtx').value,
        ollamaUrl: $('sOllamaUrl').value,
        vulkanOllamaServer: $('sVulkanOllamaServer').value,
        oculusOllamaServer: $('sOculusOllamaServer').value,
        atlasKeepAlive: $('sAtlasKeepAlive').checked ? '-1' : '300',
        toolcallKeepAlive: $('sToolcallKeepAlive').checked ? '-1' : '300',
      };
      await postJson('/api/settings', body);
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Model configuration saved', 'success');
      // Switching the driving force clears the seat's context on the
      // server; reset the chat view to reflect the fresh conversation.
      if (body.drivingForce !== prevDrivingForce) {
        try { await loadSettingsValues(); } catch (e) { /* settings will reload next open */ }
        newThought();
        toast('Driving force changed — context cleared', 'info');
      }
      // refresh chat model select
      // per-chat model dropdown removed; model is only configured in Settings
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function saveRag() {
    const st = $('ragStatus');
    if (!st) return;
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const body = {
        selectionSemantic: $('sSelectionSemantic').checked ? '1' : '0',
        selectionEmbedModel: $('sSelectionEmbedModel').value.trim(),
        selectionEmbedKeepAlive: $('sSelectionKeepAlive').value,
        selectionSemanticWeight: $('sSelectionSemanticWeight').value,
        selectionLexicalWeight: $('sSelectionLexicalWeight').value,
        selectionNameBonus: $('sSelectionNameBonus').value,
        selectionEmbedTimeoutMs: $('sSelectionEmbedTimeoutMs').value,
      };
      await postJson('/api/settings', body);
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Tool retrieval saved — applies to the next session', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function saveServers() {
    const st = $('serversStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const slotIds = ['s1', 's2', 's3'];
      const ollamaServers = [];
      for (let i = 0; i < 3; i++) {
        const label = $('sOllamaLabel' + (i + 1)).value.trim();
        const url = $('sOllamaUrl' + (i + 1)).value.trim();
        if (url) ollamaServers.push({ id: slotIds[i], label: label || slotIds[i], url });
      }
      const defRadio = document.querySelector('input[name="ollamaDefault"]:checked');
      const defIdx = defRadio ? Number(defRadio.value) : 0;
      const body = {
        audioServerUrl: $('sAudioServerUrl').value.trim(),
        videoServerUrl: $('sVideoServerUrl').value.trim(),
        satelliteUrl: $('sSatelliteUrl').value.trim(),
        transcriptionApiUrl: $('sTranscriptionApiUrl').value.trim(),
        ollamaDefaultServerId: defIdx >= 1 && defIdx <= 3 ? slotIds[defIdx - 1] : '',
        ollamaServers,
        vulkanOllamaServer: $('sVulkanOllamaServer').value,
        oculusOllamaServer: $('sOculusOllamaServer').value,
      };
      await postJson('/api/settings', body);
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Server settings saved', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function saveFriendly() {
    const st = $('friendlyStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const inputs = qsa('#friendlyList input[data-model]');
      const names = {};
      for (const inp of inputs) {
        const v = inp.value.trim();
        if (v) names[inp.dataset.model] = v;
      }
      await postJson('/api/ollama/model-names', { names });
      STATE.cachedFriendlyNames = names;
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Friendly names saved', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function saveOculusMd() {
    const st = $('oculusMdStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const content = $('sOculusMd').value;
      await postJson('/api/oculus/rules', { content });
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Oculus rules saved', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  async function loadWatchOut() {
    const ta = $('sWatchOut');
    if (!ta) return;
    try {
      const data = await api('/api/oculus/watch-out');
      ta.value = Array.isArray(data.items) ? data.items.join('\n') : '';
    } catch (e) {
      // leave the textarea blank on first load
    }
  }

  async function saveWatchOut() {
    const st = $('watchOutStatus');
    st.textContent = 'saving…'; st.className = 'status';
    try {
      const items = $('sWatchOut').value.split('\n').map(s => s.trim()).filter(Boolean);
      await postJson('/api/oculus/watch-out', { items });
      st.textContent = 'saved'; st.className = 'status ok';
      toast('Watch-out-for list saved', 'success');
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err';
    }
  }

  // ============================================================= Chat model dropdown
  // per-chat model dropdown removed; model is only configured in Settings

  // ============================================================= Tasks
  async function refreshTasks() {
    const list = $('taskList');
    list.innerHTML = '<div class="task-empty">Loading…</div>';
    try {
      const d = await api('/api/tasks');
      const tasks = d.tasks || [];
      // populate group dropdown from /api/groups (owner stub) + web:dashboard
      const grp = $('taskGroup');
      if (grp) {
        grp.innerHTML = '<option value="owner">owner</option><option value="web:dashboard">web:dashboard</option>';
      }
      if (!tasks.length) { list.innerHTML = '<div class="task-empty">No scheduled tasks. Click "+ New Task" above.</div>'; return; }
      list.innerHTML = tasks.map(t => {
        const tid = t.id || '';
        const isDigest = tid.indexOf('iris-digest-') === 0;
        const isHeartbeat = tid.indexOf('heartbeat-') === 0;
        const isSystem = isDigest || isHeartbeat;
        const label = isDigest ? ('Iris ' + tid.replace('iris-digest-', '') + ' digest')
                    : isHeartbeat ? 'Heartbeat'
                    : (t.prompt || '');
        const badge = t.schedule_type ? '<span class="badge ' + esc(t.schedule_type) + '">' + esc(t.schedule_type) + '</span>' : '';
        const status = t.status === 'paused' ? '<span class="badge paused">paused</span>' : '<span class="badge active">active</span>';
        const next = t.next_run ? fmtTime(t.next_run) : '—';
        const last = t.last_run ? fmtTime(t.last_run) : '—';
        return '<div class="task-item ' + (t.status === 'paused' ? 'paused' : '') + '">' +
          '<div class="head"><span class="prompt" title="' + escAttr(t.prompt || '') + '">' + esc(label) + '</span>' + badge + status + '</div>' +
          '<div class="meta"><span>id: ' + esc(t.id) + '</span><span>group: ' + esc(t.group_folder || '') + '</span><span>value: ' + esc(t.schedule_value || '') + '</span><span>next: ' + next + '</span><span>last: ' + last + '</span></div>' +
          '<div class="actions">' +
            (t.status === 'paused'
              ? '<button class="btn btn-ghost btn-sm" data-task-resume="' + escAttr(t.id) + '">Resume</button>'
              : '<button class="btn btn-ghost btn-sm" data-task-pause="' + escAttr(t.id) + '">Pause</button>') +
            (isSystem ? '' : '<button class="btn btn-danger btn-sm" data-task-del="' + escAttr(t.id) + '">Delete</button>') +
          '</div></div>';
      }).join('');

      qsa('[data-task-resume]', list).forEach(b => b.addEventListener('click', () => updateTask(b.dataset.taskResume, 'active')));
      qsa('[data-task-pause]', list).forEach(b => b.addEventListener('click', () => updateTask(b.dataset.taskPause, 'paused')));
      qsa('[data-task-del]', list).forEach(b => b.addEventListener('click', () => deleteTask(b.dataset.taskDel)));
    } catch (e) {
      list.innerHTML = '<div class="task-empty">Failed to load: ' + esc(e.message) + '</div>';
    }
  }

  function showTaskForm() {
    $('taskForm').classList.remove('hidden');
    $('taskPrompt').focus();
  }
  function hideTaskForm() {
    $('taskForm').classList.add('hidden');
    $('taskPrompt').value = '';
    $('taskValue').value = '';
  }

  async function saveTask() {
    const prompt = $('taskPrompt').value.trim();
    const type = $('taskType').value;
    const value = $('taskValue').value.trim();
    const group = $('taskGroup').value;
    const ctx = $('taskCtx').value;
    if (!prompt || !value) { toast('Prompt and schedule value required', 'warn'); return; }
    try {
      await postJson('/api/tasks', {
        group_folder: group || 'owner',
        prompt, schedule_type: type, schedule_value: value,
        context_mode: ctx, chat_jid: STATE.currentJid,
      });
      toast('Task created', 'success');
      hideTaskForm();
      refreshTasks();
    } catch (e) {
      toast('Failed: ' + e.message, 'error');
    }
  }

  async function updateTask(id, status) {
    try { await patchJson('/api/tasks/' + encodeURIComponent(id), { status }); refreshTasks(); }
    catch (e) { toast('Failed: ' + e.message, 'error'); }
  }
  async function deleteTask(id) {
    if (!confirm('Delete this task?')) return;
    try { await del('/api/tasks/' + encodeURIComponent(id)); refreshTasks(); }
    catch (e) { toast('Failed: ' + e.message, 'error'); }
  }
  async function bulkDeleteTasks(filter) {
    const labels = { active: 'active', inactive: 'inactive', all: 'all' };
    const label = labels[filter] || filter;
    if (!confirm('Delete ' + label + ' tasks? This cannot be undone.')) return;
    try {
      const d = await del('/api/tasks/bulk', { filter });
      toast('Deleted ' + (d.deleted || 0) + ' task(s)', 'success');
      refreshTasks();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  // ============================================================= Accounts
  const ACCOUNTS = { oauthConfigured: { google: false, microsoft: false }, oauth: [], imap: [], keys: [], channels: [] };

  async function showCalendarToggles(accountId) {
    try {
      const r = await api('/api/oauth/accounts/' + encodeURIComponent(accountId) + '/calendars');
      if (!r.ok) { toast('Failed to load calendars', 'error'); return; }
      const calendars = r.data.calendars || [];
      let html = '<div style="max-height:400px;overflow-y:auto">';
      html += '<p class="dim" style="margin:0 0 8px">Toggle which calendars to sync:</p>';
      calendars.forEach(cal => {
        html += '<label class="toggle" style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
          '<input type="checkbox" ' + (cal.hidden ? '' : 'checked') + ' data-cal-id="' + escAttr(cal.id) + '"> ' +
          esc(cal.name || cal.id || 'Default') + '</label>';
      });
      html += '</div>';
      html += '<div style="margin-top:12px;display:flex;gap:6px;justify-content:flex-end">' +
        '<button class="btn btn-ghost btn-sm" id="btnCalToggleCancel">Cancel</button>' +
        '<button class="btn btn-primary btn-sm" id="btnCalToggleSave">Save</button></div>';
      showModal('Select Calendars', html);
      $('btnCalToggleCancel').addEventListener('click', closeModal);
      $('btnCalToggleSave').addEventListener('click', async () => {
        const hidden = [];
        document.querySelectorAll('[data-cal-id]').forEach(cb => {
          if (!cb.checked) hidden.push(cb.dataset.calId);
        });
        try {
          await putJson('/api/oauth/accounts/' + encodeURIComponent(accountId) + '/calendars', { hidden_calendars: hidden });
          toast('Calendar selection saved', 'success');
          closeModal();
        } catch (e) { toast('Failed: ' + e.message, 'error'); }
      });
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  // Calendar-pane selector: list every connected calendar account's calendars
  // with show/hide toggles (hidden_calendars), saved per-account. Same mechanism
  // as the per-account showCalendarToggles, but surfaced from the calendar view.
  async function showAllCalendarToggles() {
    const accts = (ACCOUNTS.oauth || []).filter(a => a.calendar_enabled);
    if (!accts.length) { toast('No calendar accounts connected.', 'error'); return; }
    let body = '<div style="max-height:60vh;overflow-y:auto">';
    let any = false;
    for (const a of accts) {
      try {
        const r = await api('/api/oauth/accounts/' + encodeURIComponent(a.id) + '/calendars');
        const cals = (r && r.data && r.data.calendars) || [];
        if (!cals.length) continue;
        any = true;
        body += '<h4 style="margin:10px 0 4px">' + esc(a.email || a.provider) + '</h4>';
        cals.forEach(cal => {
          body += '<label class="toggle" style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
            '<input type="checkbox" ' + (cal.hidden ? '' : 'checked') +
            ' data-acct="' + escAttr(a.id) + '" data-cal-id="' + escAttr(cal.id) + '"> ' +
            esc(cal.name || cal.id) + '</label>';
        });
      } catch (e) { /* skip account */ }
    }
    if (!any) { toast('No calendars found.', 'error'); return; }
    body += '</div>';
    body += '<div style="margin-top:12px;display:flex;gap:6px;justify-content:flex-end">' +
      '<button class="btn btn-ghost btn-sm" id="btnCalToggleCancel">Cancel</button>' +
      '<button class="btn btn-primary btn-sm" id="btnCalToggleSave">Save</button></div>';
    showModal('Select Calendars', body);
    $('btnCalToggleCancel').addEventListener('click', closeModal);
    $('btnCalToggleSave').addEventListener('click', async () => {
      const byAcct = {};
      document.querySelectorAll('[data-cal-id]').forEach(cb => {
        const aid = cb.dataset.acct;
        if (!byAcct[aid]) byAcct[aid] = [];
        if (!cb.checked) byAcct[aid].push(cb.dataset.calId);
      });
      try {
        for (const aid of Object.keys(byAcct)) {
          await putJson('/api/oauth/accounts/' + encodeURIComponent(aid) + '/calendars', { hidden_calendars: byAcct[aid] });
        }
        toast('Calendar selection saved', 'success');
        closeModal();
        if (window.PIM && window.PIM.refreshCalendar) window.PIM.refreshCalendar();
      } catch (e) { toast('Failed: ' + e.message, 'error'); }
    });
  }

  async function refreshAccounts() {
    try {
      const settings = await api('/api/settings');
      ACCOUNTS.oauthConfigured.google = !!settings.google_configured;
      ACCOUNTS.oauthConfigured.microsoft = !!settings.microsoft_configured;
    } catch {}

    try {
      const oa = await api('/api/oauth/accounts?userId=owner');
      ACCOUNTS.oauth = oa.accounts || [];
    } catch { ACCOUNTS.oauth = []; }

    try {
      const em = await api('/api/email/accounts?userId=owner');
      ACCOUNTS.imap = (em.accounts || []).filter(a => !a.oauth_account_id);
    } catch { ACCOUNTS.imap = []; }

    try {
      const kr = await api('/api/api-keys');
      ACCOUNTS.keys = kr.keys || [];
    } catch { ACCOUNTS.keys = []; }

    try {
      const ch = await api('/api/channels');
      ACCOUNTS.channels = ch.channels || [];
    } catch { ACCOUNTS.channels = []; }

    renderAccounts();
  }

  // ============================================================= Friends
  let FRIENDS = { friends: [], requests: [], messages: [], rooms: [], files: [], self: {}, tailscale: {} };

  async function refreshFriends() {
    try {
      const d = await api('/api/friends');
      FRIENDS = d || FRIENDS;
      renderFriends();
    } catch (e) {
      $('friendsTunnel').textContent = 'Error loading friends: ' + e.message;
    }
  }

  function renderFriends() {
    const ts = FRIENDS.tailscale || {};
    const st = ts.state || 'unavailable';
    $('friendsTunnel').innerHTML =
      'state: <b>' + esc(st) + '</b>' +
      (ts.self ? ' · self: ' + esc(ts.self.hostname) + (ts.self.dnsname ? ' (' + esc(ts.self.dnsname) + ')' : '') : '') +
      (ts.peers && ts.peers.length ? ' · peers: ' + ts.peers.map(p => esc(p.hostname || p.dnsname) + (p.online ? '' : ' (off)')).join(', ') : '');
    $('friendsLink').textContent = (FRIENDS.self || {}).link || '';

    const reqEl = $('friendsRequests');
    const reqs = FRIENDS.requests || [];
    reqEl.innerHTML = reqs.length
      ? reqs.map(r =>
          '<div class="row" style="margin-bottom:6px">' +
            '<span style="flex:1">' + esc(r.from_hostname) + '</span>' +
            '<button class="btn btn-primary btn-sm" data-fact="accept" data-id="' + escAttr(r.id) + '">Accept</button>' +
            '<button class="btn btn-ghost btn-sm" data-fact="deny" data-id="' + escAttr(r.id) + '">Deny</button>' +
          '</div>').join('')
      : 'None';

    const listEl = $('friendsList');
    const friends = FRIENDS.friends || [];
    listEl.innerHTML = friends.length
      ? friends.map(f =>
          '<div class="row" style="margin-bottom:6px">' +
            '<span class="dot" style="background:' + (f.status === 'online' ? '#2ecc71' : '#888') + '"></span>' +
            '<span style="flex:1">' + esc(f.hostname) + (f.last_seen ? ' <span class="dim">' + esc(f.last_seen) + '</span>' : '') + '</span>' +
            '<button class="btn btn-ghost btn-sm" data-fact="ping" data-id="' + escAttr(f.id) + '">Ping</button>' +
            '<button class="btn btn-ghost btn-sm" data-fact="block" data-id="' + escAttr(f.id) + '">Block</button>' +
            '<button class="btn btn-ghost btn-sm" data-fact="remove" data-id="' + escAttr(f.id) + '">Remove</button>' +
          '</div>').join('')
      : 'None';

    const inbox = $('friendsInbox');
    const parts = [];
    (FRIENDS.messages || []).forEach(m => parts.push('<div>[dm] <b>' + esc(m.from_hostname) + '</b>: ' + esc(m.body) + '</div>'));
    (FRIENDS.rooms || []).forEach(r => parts.push('<div>[#' + esc(r.room) + '] <b>' + esc(r.from_hostname) + '</b>: ' + esc(r.body) + '</div>'));
    (FRIENDS.files || []).forEach(f => parts.push('<div>[file] <b>' + esc(f.from_hostname) + '</b>: ' + esc(f.filename) + '</div>'));
    inbox.innerHTML = parts.length ? parts.join('') : 'Empty';

    const blockedEl = $('friendsBlocked');
    const blocked = FRIENDS.blocks || [];
    blockedEl.innerHTML = blocked.length
      ? blocked.map(b =>
          '<div class="row" style="margin-bottom:6px">' +
            '<span style="flex:1">' + esc(b.hostname) + (b.reason ? ' <span class="dim">' + esc(b.reason) + '</span>' : '') + '</span>' +
            '<button class="btn btn-ghost btn-sm" data-fact="unblock" data-id="' + escAttr(b.hostname) + '">Unblock</button>' +
          '</div>').join('')
      : 'None';

    const offEl = $('friendsOffenses');
    const offenses = FRIENDS.offenses || [];
    offEl.innerHTML = offenses.length
      ? offenses.map(o => '<div>' + esc(o.created_at) + ' <b>' + esc(o.hostname) + '</b> ' + esc(o.kind) + (o.detail ? ': ' + esc(o.detail) : '') + '</div>').join('')
      : 'None';
  }

  async function friendsTunnelUp() {
    $('friendsTunnelStatus').textContent = 'Starting tunnel…';
    try {
      const r = await postJson('/api/friends/tailscale/up', {});
      if (r.authUrl) {
        $('friendsTunnelStatus').innerHTML = 'Log in here: <a href="' + escAttr(r.authUrl) + '" target="_blank">' + esc(r.authUrl) + '</a>';
      } else {
        $('friendsTunnelStatus').textContent = 'Tunnel up.';
      }
    } catch (e) {
      $('friendsTunnelStatus').textContent = 'Error: ' + e.message;
    }
    refreshFriends();
  }

  function friendsCopyLink() {
    const link = $('friendsLink').textContent || '';
    if (!link) { $('friendsInviteStatus').textContent = 'No link yet — start the tunnel first.'; return; }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(link).then(
        () => { $('friendsInviteStatus').textContent = 'Link copied.'; },
        () => { $('friendsInviteStatus').textContent = 'Link: ' + link; },
      );
    } else {
      $('friendsInviteStatus').textContent = 'Link: ' + link;
    }
  }

  async function friendsInvite() {
    const input = $('friendsInviteInput');
    const hostname = (input.value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!hostname) { $('friendsInviteStatus').textContent = 'Paste a link or hostname.'; return; }
    $('friendsInviteStatus').textContent = 'Sending invite…';
    try {
      const r = await postJson('/api/friends/invite-send', { hostname });
      $('friendsInviteStatus').textContent = r.ok ? 'Invite sent. They accept it on their side.' : ('Failed: ' + (r.error || 'unknown'));
      if (r.ok) input.value = '';
    } catch (e) {
      $('friendsInviteStatus').textContent = 'Error: ' + e.message;
    }
    refreshFriends();
  }

  async function friendsAction(action, id) {
    try {
      if (action === 'accept') await postJson('/api/friends/requests/' + encodeURIComponent(id) + '/accept', {});
      else if (action === 'deny') await postJson('/api/friends/requests/' + encodeURIComponent(id) + '/deny', {});
      else if (action === 'ping') await postJson('/api/friends/' + encodeURIComponent(id) + '/ping', {});
      else if (action === 'block') await postJson('/api/friends/' + encodeURIComponent(id) + '/block', {});
      else if (action === 'unblock') await postJson('/api/friends/' + encodeURIComponent(id) + '/unblock', {});
      else if (action === 'remove') await del('/api/friends/' + encodeURIComponent(id));
    } catch (e) {
      $('friendsInviteStatus').textContent = 'Error: ' + e.message;
    }
    refreshFriends();
  }

  // ============================================================= BotNet (BBS)
  // Each Warden is one BBS node; you "dial in" to a node to read its boards.
  let SOCIAL = { self: {}, node: 'self', boards: [], threads: [], posts: [], files: [], systems: [] };
  let SOCIAL_BOARD = 'shoutbox';
  let SOCIAL_THREAD = null;
  let SOCIAL_NODE = 'self';   // 'self' or a friend hostname we're dialed into

  function bbsShortHost(h) { return String(h || '').split('.')[0] || h || '???'; }
  function bbsTime(iso) {
    try { return new Date(iso).toLocaleTimeString([], { hour12: false }); } catch { return ''; }
  }

  async function refreshSocial() {
    try {
      // systems directory (self + friends + online status)
      const dir = await api('/api/friends');
      const systems = [{
        hostname: (dir.self || {}).hostname || 'self', self: true, status: 'online',
        profile: (dir.self || {}).profile || '', specialists: (dir.self || {}).specialists || [],
      }];
      (dir.friends || []).forEach(f => systems.push({
        hostname: f.id || f.name || '', self: false, status: f.status || 'offline',
        profile: f.profile || '', last_seen: f.last_seen || '', specialists: f.specialists || [], capabilities: f.capabilities || [],
      }));
      SOCIAL.systems = systems;

      // the node we're dialed into (self, or a friend fetched live)
      const node = SOCIAL_NODE;
      const d = (node === 'self')
        ? await api('/api/friends/bbs')
        : await api('/api/friends/bbs/dial/' + encodeURIComponent(node));
      SOCIAL = Object.assign({}, SOCIAL, {
        self: (d && d.self) || dir.self || SOCIAL.self,
        node: (d && d.node) || (node === 'self' ? ((dir.self || {}).hostname || 'self') : node),
        boards: (d && d.boards) || SOCIAL.boards || [],
        threads: (d && d.threads) || [],
        posts: (d && d.posts) || [],
        files: (d && d.files) || [],
        online: d ? d.online : undefined,
      });
      // bulletins (for the menu ticker + connect screen) — non-fatal
      try {
        const b = await api('/api/friends/bbs/bulletins');
        BBS_UI.bulletins = (b && b.bulletins) || [];
      } catch { BBS_UI.bulletins = []; }
      draw();
    } catch (e) {
      $('bbsStatus').textContent = 'LINK DOWN: ' + e.message;
    }
  }

  // ─── the dial-in terminal ───────────────────────────────────────────────
  // One <pre> canvas (#bbsFrame) fully redrawn per "screen"; the bottom command
  // bar shows the live keys and opens the inline input while a prompt is up.
  // Keyboard and mouse drive the same runAct() dispatcher. Late-80s feel:
  // block-letter banners, framed menus, per-conference color identity, modem
  // result codes. Doors: FORTUNE / GUESS / HANGMAN / 8-BALL, all local play.
  let SCREEN = 'connect';
  let BBS_UI = {
    items: [],          // numbered entries on the current screen (digit keys + clicks hit the same act)
    barIdx: 0,          // lightbar selection index over `items`
    msgIndex: 0,        // which message in the open thread is on screen
    prompt: null,       // {kind,…} while the command input is open
    callerN: 0,         // "you are caller #N" (stable for the session)
    handle: '',         // the handle entered at the connect screen
    animate: true,      // baud-emulated line-by-line draw on arrival screens
    threadTitle: '',    // two-step new-thread flow
    saveFileName: '',   // two-step save-file flow
    file: null,         // {name, content} while a file is open
    confirmDelete: '', confirmAt: 0,  // double-D delete confirm handshake
    dialStatus: '',     // modem result code shown on the dial screen
    colabBusy: false,   // modem LED + phase blink while a swarm runs
    colabStatus: null,  // last /api/friends/colab/status payload — the swarm's live ledger
    door: null,         // active door-game state ({kind,…} per game)
    doorsList: [],      // third-party doors in the rack (fetched with the DOORS menu)
    search: [],         // last search results ([{board,thread_id,title,excerpt}])
    searchTerm: '',
    mail: { messages: [], mentions: [], unread: 0 },  // the node's inbox (DMs + @mentions)
    profile: '',       // the caller's own self-description (bio)
    profileFull: null, // {handle,name,bio,level,joined} for the profile page
    mailOpen: null,    // {kind:'dm'|'mention', from, body, board, thread_id} while reading
    bulletins: [],      // sysop bulletins (newest first)
    bulletinId: '',     // the bulletin being read
  };

  // ── themes ── a real BBS ships a color set; the picker re-tints the tube ──
  const THEMES = {
    'dos-blue':  { name: 'DOS BLUE' },
    'phosphor':  { name: 'PHOSPHOR GREEN' },
    'amber':     { name: 'AMBER CRT' },
    'mono-blue': { name: 'MONO BLUE' },
    '3d-ansi':   { name: '3D ANSI' },
    'ice':       { name: 'ICE' },
    'magenta':   { name: 'MAGENTA' },
  };
  let BBS_THEME = (function () { try { return localStorage.getItem('bbsThemeV2'); } catch { return null; } })() || 'dos-blue';
  if (!THEMES[BBS_THEME]) BBS_THEME = 'dos-blue';
  function applyTheme() {
    const c = document.querySelector('.bbs-case');
    if (c) c.setAttribute('data-theme', BBS_THEME);
    try { localStorage.setItem('bbsThemeV2', BBS_THEME); } catch {}
  }
  function cycleTheme(dir) {
    const keys = Object.keys(THEMES);
    const i = (keys.indexOf(BBS_THEME) + (dir || 1) + keys.length) % keys.length;
    BBS_THEME = keys[i];
    applyTheme();
    $('bbsStatus').textContent = 'THEME: ' + THEMES[BBS_THEME].name;
  }

  // ── frame geometry: single-line box, or the double-line "3D ANSI" set ──
  function FC() {
    return (BBS_THEME === '3d-ansi' || BBS_THEME === 'dos-blue')
      ? { tl:'╔', tr:'╗', bl:'╚', br:'╝', ml:'╠', mr:'╣', h:'═', v:'║' }
      : { tl:'┌', tr:'┐', bl:'└', br:'┘', ml:'├', mr:'┤', h:'─', v:'│' };
  }

  const BBS_FONT = {
    A:["  █  "," █ █ ","█████","█   █","█   █"],
    B:["████ ","█   █","████ ","█   █","████ "],
    C:[" ████","█    ","█    ","█    "," ████"],
    D:["████ ","█   █","█   █","█   █","████ "],
    E:["█████","█    ","████ ","█    ","█████"],
    F:["█████","█    ","████ ","█    ","█    "],
    G:[" ████","█    ","█  ██","█   █"," ████"],
    H:["█   █","█   █","█████","█   █","█   █"],
    I:["█████","  █  ","  █  ","  █  ","█████"],
    J:["  ███","   █ ","   █ ","█  █ "," ██  "],
    K:["█   █","█  █ ","███  ","█  █ ","█   █"],
    L:["█    ","█    ","█    ","█    ","█████"],
    M:["█   █","██ ██","█ █ █","█   █","█   █"],
    N:["█   █","██  █","█ █ █","█  ██","█   █"],
    O:[" ███ ","█   █","█   █","█   █"," ███ "],
    P:["████ ","█   █","████ ","█    ","█    "],
    Q:[" ███ ","█   █","█   █","█ █ █"," ███ "],
    R:["████ ","█   █","████ ","█  █ ","█   █"],
    S:[" ████","█    "," ███ ","    █","████ "],
    T:["█████","  █  ","  █  ","  █  ","  █  "],
    U:["█   █","█   █","█   █","█   █"," ███ "],
    V:["█   █","█   █","█   █"," █ █ ","  █  "],
    W:["█   █","█   █","█ █ █","██ ██","█   █"],
    X:["█   █"," █ █ ","  █  "," █ █ ","█   █"],
    Y:["█   █"," █ █ ","  █  ","  █  ","  █  "],
    Z:["█████","   █ ","  █  "," █   ","█████"],
    "0":[" ███ ","█   █","█ █ █","█   █"," ███ "],
    "1":["  █  "," ██  ","  █  ","  █  ","█████"],
    "2":["████ ","    █"," ███ ","█    ","█████"],
    "3":["████ ","    █"," ███ ","    █","████ "],
    "4":["█   █","█   █","█████","    █","    █"],
    "5":["█████","█    ","████ ","    █","████ "],
    "6":[" ███ ","█    ","████ ","█   █"," ███ "],
    "7":["█████","    █","   █ ","  █  ","  █  "],
    "8":[" ███ ","█   █"," ███ ","█   █"," ███ "],
    "9":[" ███ ","█   █"," ████","    █"," ███ "],
    " ":["     ","     ","     ","     ","     "],
    "-":["     ","     ","█████","     ","     "],
    ".":["     ","     ","     ","  █  ","     "],
  };

  // Conference identities — every board is its own room: its own color, icon,
  // pace, and list behavior (see renderThreads for the per-board flavor).
  const BOARD_THEME = {
    'shoutbox':      { c: 'green',   icon: '>', label: 'SHOUTBOX',    kind: 'the live channel' },
    'general':       { c: 'cyan',    icon: '#', label: 'GENERAL',     kind: 'open discussion' },
    'ideas':         { c: 'amber',   icon: '*', label: 'IDEAS',       kind: 'the idea pool' },
    'help':          { c: 'magenta', icon: '!', label: 'HELP',        kind: 'the repair desk' },
    'show-and-tell': { c: 'blue',    icon: '=', label: 'SHOW & TELL', kind: 'the build wall' },
  };
  function boardTheme(name) { return BOARD_THEME[name] || { c: 'green', icon: '-', label: String(name || '').toUpperCase(), kind: 'conference' }; }

  // ── text helpers ──
  function ansiC(s, c) { return '<span class="c-' + c + '">' + esc(s) + '</span>'; }
  function visLen(s) { return String(s).replace(/<[^>]*>/g, '').replace(/&(?:[a-z]+|#\d+);/gi, '·').length; }
  function padR(s, w) { return s + ' '.repeat(Math.max(0, w - visLen(s))); }
  // exact-width fit for card cells: truncate then pad to w *plain* chars (ASCII,
  // so JS length == cell width — this is what keeps the cubes aligned).
  function fit(s, w) { const str = String(s == null ? '' : s); return str.length > w ? str.slice(0, w) : str + ' '.repeat(w - str.length); }
  function padL(s, w) { return ' '.repeat(Math.max(0, w - visLen(s))) + s; }
  function hl(n) { return FC().h.repeat(n); }
  function hr(w) { return FC().v + hl(w) + FC().v; }
  function center(s, w) { return padL(s, w - Math.floor((w - visLen(s)) / 2)); }
  function centerBlock(block, w) { return String(block).split('\n').map(l => padL(l, w - Math.floor((w - visLen(l)) / 2))).join('\n'); }
  function bigText(text, c) {
    const rows = ['', '', '', '', ''];
    for (const ch of String(text).toUpperCase()) {
      const g = BBS_FONT[ch] || BBS_FONT[' '];
      for (let r = 0; r < 5; r++) rows[r] += (g[r] || '     ') + ' ';
    }
    return rows.map(r => ansiC(r.replace(/\s+$/, ''), c)).join('\n');
  }
  // Chiseled ANSI block letters: the top of each stroke reads as a highlight
  // (░) with the body solid (█) and a dim drop-shadow (▒) underneath — the
  // shaded-block look that flat █ glyphs never had.
  function bevelText(text, c) {
    const glyphs = [...String(text).toUpperCase()].map(ch => BBS_FONT[ch] || BBS_FONT[' ']);
    const rows = [];
    for (let r = 0; r < 5; r++) {
      let line = '';
      for (const g of glyphs) {
        for (let col = 0; col < 5; col++) {
          const cell = (g[r] || '     ')[col];
          if (cell === '█') {
            let top = true;
            for (let rr = 0; rr < r; rr++) if ((g[rr] || '')[col] === '█') { top = false; break; }
            line += top ? '░' : '█';
          } else line += ' ';
        }
        line += ' ';
      }
      rows.push(ansiC(line.replace(/\s+$/, ''), c));
    }
    let shadow = '';
    for (const g of glyphs) { for (let col = 0; col < 5; col++) shadow += (g[4] || '')[col] === '█' ? '▒' : ' '; shadow += ' '; }
    rows.push(ansiC(shadow.replace(/\s+$/, ''), 'dim'));
    return rows.join('\n');
  }
  function wrapText(text, width) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    for (const word of words) {
      if (cur && (cur + ' ' + word).length > width) { lines.push(cur); cur = word; }
      else cur = cur ? cur + ' ' + word : word;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function fmtSize(n) { n = Number(n) || 0; return n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB'; }
  function fmtWhen(iso) {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour12: false });
    } catch { return '—'; }
  }
  // numbered clickable row — registers into BBS_UI.items so the digit keys hit
  // the same act as the click
  function hitLine(num, text, act, arg, color) {
    const a = arg == null ? '' : arg;
    BBS_UI.items.push({ act, arg: a });
    return ' ' + ansiC(String(num).padStart(2, ' '), color || 'gray') + '  ' +
      '<span class="bbs-hit" data-act="' + escAttr(act) + '" data-arg="' + escAttr(a) + '">' + text + '</span>';
  }
  // window a long list around the lightbar so the selection stays visible
  const LIST_PAGE = 14;
  function listRange(total) {
    if (total <= LIST_PAGE) return { start: 0, end: total, above: false, below: false };
    let start = Math.max(0, BBS_UI.barIdx - Math.floor(LIST_PAGE / 2));
    start = Math.min(start, total - LIST_PAGE);
    return { start, end: start + LIST_PAGE, above: start > 0, below: start + LIST_PAGE < total };
  }
  function listHead(s, w, above, n) { if (above) s += frameLine(ansiC('  ▲ ' + n + ' more above', 'gray'), '', w) + '\n'; }
  function listFoot(s, w, below, n) { if (below) s += frameLine(ansiC('  ▼ ' + n + ' more below', 'gray'), '', w) + '\n'; }

  const BW = 78; // inner width of framed screens — a real 80-column BBS
  function frameTitle(title, w) {
    const t = visLen(title);
    const l = Math.max(1, Math.floor((w - t) / 2));
    const r = Math.max(1, w - t - l);
    return FC().tl + hl(w) + FC().tr + '\n' + FC().v + ' '.repeat(l) + title + ' '.repeat(r) + FC().v + '\n' + FC().ml + hl(w) + FC().mr;
  }
  function frameClose(w) { return FC().bl + hl(w) + FC().br; }
  function frameLine(left, right, w, bar) {
    let inner;
    if (right == null || right === '') inner = padR(left, w);
    else {
      const gap = w - visLen(left) - visLen(right);
      inner = left + ' '.repeat(Math.max(1, gap)) + right;
    }
    return FC().v + (bar ? '<span class="bar">' + inner + '</span>' : inner) + FC().v;
  }

  // ── screens ──
  function renderConnect() {
    BBS_UI.items = [];
    const w = BW;
    const host = bbsShortHost(SOCIAL.node || (SOCIAL.self || {}).hostname || 'this-warden');
    const s = [];
    s.push('');
    s.push(center(ansiC('CONNECT 2400', 'green'), w));
    s.push(center(ansiC('CARRIER DETECT · 8N1 · HALF DUPLEX', 'dim'), w));
    s.push(center(ansiC('WELCOME TO THE WARDEN MESH', 'dim'), w));
    s.push('');
    s.push(centerBlock(bevelText('WARDEN', 'amber'), w + 2));
    s.push(center(ansiC('▓ TRM-87 · a node on the mesh · ' + host + ' ▓', 'dim'), w));
    s.push('');
    s.push(center('<span class="blink">' + ansiC('[ PRESS ENTER TO LOG IN ]', 'white') + '</span>', w));
    try {
      const last = JSON.parse(localStorage.getItem('bbsCallers') || '[]');
      if (last.length) {
        s.push('');
        s.push(center(ansiC('LAST FROM THIS TERMINAL: ' + last.slice(0, 5).map(c => bbsShortHost(c.handle)).join(' · '), 'gray'), w));
      }
    } catch {}
    const bull = (BBS_UI.bulletins || [])[0];
    if (bull) {
      s.push('');
      s.push(center(ansiC('● BULLETIN: ' + String(bull.title).slice(0, 50), 'magenta'), w));
    }
    return s.join('\n');
  }

  function renderWelcome() {
    BBS_UI.items = [];
    const w = BW;
    const node = SOCIAL.node || (SOCIAL.self || {}).hostname || 'this-warden';
    const host = bbsShortHost(node);
    const online = (SOCIAL.systems || []).filter(s => s.status === 'online');
    const msgs = (SOCIAL.posts || []).length;
    const files = (SOCIAL.files || []).length;
    if (!BBS_UI.callerN) BBS_UI.callerN = 137 + (msgs % 900);
    let s = '\n';
    s += centerBlock(bevelText('WARDEN', 'amber'), w + 2) + '\n';
    s += centerBlock(bevelText('BBS', 'green'), w + 2) + '\n\n';
    s += center(ansiC('· the warden mesh · node ' + host + ' · est. 2026 ·', 'dim'), w) + '\n\n';
    s += frameTitle(ansiC(' CONNECT ' + host.toUpperCase() + ' — 2400 BAUD ', 'green'), w) + '\n';
    s += frameLine(ansiC('  YOU ARE CALLER ', 'dim') + ansiC('#' + BBS_UI.callerN, 'amber'), '', w) + '\n';
    s += frameLine(ansiC('  SYSOP      ', 'dim') + ansiC(String((SOCIAL.self || {}).profile || 'on duty').slice(0, 44), 'white'), '', w) + '\n';
    s += frameLine(ansiC('  NODES      ', 'dim') + ansiC(online.length + ' online', 'green') + ansiC('   ·   MESSAGES ' + msgs + '   ·   FILES ' + files, 'dim'), '', w) + '\n';
    s += frameClose(w) + '\n\n';
    s += center('<span class="blink">' + ansiC('[ PRESS ANY KEY TO CONTINUE ]', 'white') + '</span>', w);
    return s;
  }

  // a "cube" — a self-contained info-card for the grid menu. Each carries its
  // own icon, name, and stats, like a useful Tetris block.
  function menuCard(card, selected) {
    const w = 23;
    const hb = selected ? '═' : '─';
    const side = selected ? '║' : '│';
    const rows = [
      (selected ? '╔' : '┌') + hb.repeat(w) + (selected ? '╗' : '┐'),
      side + ansiC(fit(card.icon + ' ' + card.label, w), selected ? 'white' : card.color) + side,
      side + ansiC(fit(card.stat, w), 'dim') + side,
      side + ansiC(fit(card.sub, w), 'gray') + side,
      (selected ? '╚' : '└') + hb.repeat(w) + (selected ? '╝' : '┘'),
    ];
    return selected ? rows.map((r) => '<span class="bar">' + r + '</span>') : rows;
  }

  // lay cards out in a grid; registers each into BBS_UI.items for keys/clicks
  function cardGrid(cards, cols) {
    const CW = 25, GAP = 1, H = 5;
    const rows = Math.ceil(cards.length / cols);
    let s = '';
    for (let r = 0; r < rows; r++) {
      const rowCards = [];
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const card = cards[idx];
        if (!card) { rowCards.push(null); continue; }
        BBS_UI.items.push({ act: card.act, arg: card.arg || '' });
        rowCards.push(menuCard(card, idx === BBS_UI.barIdx));
      }
      for (let line = 0; line < H; line++) {
        let lineStr = '';
        for (let c = 0; c < cols; c++) {
          const cc = rowCards[c];
          lineStr += (cc ? cc[line] : ' '.repeat(CW)) + (c < cols - 1 ? ' '.repeat(GAP) : '');
        }
        s += lineStr.replace(/\s+$/, '') + '\n';
      }
    }
    return s;
  }

  function renderMenu() {
    BBS_UI.items = [];
    const w = BW;
    const host = bbsShortHost(SOCIAL.node || (SOCIAL.self || {}).hostname || 'self');
    const online = (SOCIAL.systems || []).filter(s => s.status === 'online').length;
    const cs = BBS_UI.colabStatus;
    const boards = (SOCIAL.boards || []).length;
    const files = (SOCIAL.files || []).length;
    const msgs = (SOCIAL.posts || []).length;
    let s = '\n';
    s += centerBlock(bevelText('WARDEN', 'amber'), w + 2) + '\n';
    s += center(ansiC('▓ TRM-87 · NODE ' + host.toUpperCase() + ' · 2400 BAUD ▓', 'dim'), w) + '\n';
    const cards = [
      { icon: '>', label: 'MESSAGES',  stat: boards + ' conferences', sub: msgs + ' posts',       color: 'green',   act: 'conferences' },
      { icon: '#', label: 'FILES',     stat: files + ' files',       sub: 'the shared rack',      color: 'cyan',    act: 'files' },
      { icon: '@', label: 'MAIL',      stat: 'your inbox',           sub: 'DMs & mentions',       color: 'cyan',    act: 'mail' },
      { icon: '!', label: 'BULLETINS', stat: (BBS_UI.bulletins || []).length + ' posted', sub: 'from the sysop', color: 'magenta', act: 'bulletins' },
      { icon: '*', label: 'ONLINE',    stat: online + ' up',         sub: 'the mesh, live',       color: 'amber',   act: 'online' },
      { icon: '~', label: 'CALLERS',   stat: 'recent calls',         sub: 'who called',           color: 'magenta', act: 'callers' },
      { icon: '+', label: 'COLAB',     stat: cs && cs.busy ? 'SWARM ' + String(cs.phase || '').toUpperCase() : 'idle', sub: 'the workshop', color: 'white', act: 'colab' },
      { icon: '%', label: 'DIAL',      stat: (SOCIAL.systems || []).length + ' nodes', sub: 'call a node', color: 'blue', act: 'dial' },
      { icon: '=', label: 'DOORS',     stat: '4 games',              sub: 'the game room',        color: 'red',     act: 'doors' },
      { icon: '&', label: 'SYSOP',     stat: 'node ledger',          sub: 'disk & sweep',         color: 'white',   act: 'sysop' },
      { icon: '?', label: 'SEARCH',    stat: 'grep the base',        sub: 'full-text',            color: 'green',   act: 'search' },
      { icon: 'i', label: 'PROFILE',   stat: BBS_UI.profile ? BBS_UI.profile.slice(0, 20) : 'not set yet', sub: 'who you are', color: 'cyan', act: 'profile' },
    ];
    const COLS = 3, CW = 25, GAP = 1, H = 5;
    const rows = Math.ceil(cards.length / COLS);
    for (let r = 0; r < rows; r++) {
      const rowCards = [];
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const card = cards[idx];
        if (!card) { rowCards.push(null); continue; }
        BBS_UI.items.push({ act: card.act, arg: '' });
        rowCards.push(menuCard(card, idx === BBS_UI.barIdx));
      }
      for (let line = 0; line < H; line++) {
        let lineStr = '';
        for (let c = 0; c < COLS; c++) {
          const cc = rowCards[c];
          lineStr += (cc ? cc[line] : ' '.repeat(CW)) + (c < COLS - 1 ? ' '.repeat(GAP) : '');
        }
        s += lineStr.replace(/\s+$/, '') + '\n';
      }
    }
    return s;
  }

  function renderConferences() {
    BBS_UI.items = [];
    const w = BW;
    const boards = SOCIAL.boards || [];
    let s = '\n' + center(ansiC('MESSAGE AREAS', 'green'), w) + '\n';
    s += center(ansiC('pick a conference', 'dim'), w) + '\n';
    const cards = boards.map((b) => {
      const th = boardTheme(b.name);
      const posts = (SOCIAL.posts || []).filter(p => p.board === b.name);
      const threads = (SOCIAL.threads || []).filter(t => t.board === b.name);
      let stat, sub;
      if (b.name === 'shoutbox') { stat = posts.length + ' shouts'; sub = 'flat chat - live'; }
      else if (b.name === 'ideas') { stat = threads.length + ' ideas'; sub = 'share & build'; }
      else if (b.name === 'help') { stat = threads.filter(t => (t.post_count || 0) <= 1).length + ' open'; sub = 'ask for help'; }
      else if (b.name === 'show-and-tell') { stat = threads.length + ' builds'; sub = 'show your work'; }
      else { stat = posts.length + ' msgs'; sub = th.kind || 'conference'; }
      return { icon: th.icon, label: th.label, stat, sub, color: th.c, act: 'board', arg: b.name };
    });
    if (!cards.length) { s += ansiC('  no conferences on this node', 'dim'); return s; }
    s += cardGrid(cards, 3);
    s += center(ansiC('↵ open a conference · [Q] back', 'gray'), w);
    return s;
  }

  function renderShout() {
    BBS_UI.items = [];
    const w = BW;
    const posts = (SOCIAL.posts || []).filter(p => p.board === 'shoutbox');
    const online = (SOCIAL.systems || []).filter(s => s.status === 'online');
    let s = '\n' + frameTitle(ansiC(' ● SHOUTBOX — THE LIVE CHANNEL ', 'green'), w) + '\n';
    s += frameLine(ansiC('  on the line: ', 'dim') + ansiC(online.map(x => bbsShortHost(x.hostname)).join(' · ') || 'nobody', 'green'), '', w) + '\n';
    s += hr(w) + '\n';
    if (!posts.length) {
      s += '  ' + ansiC('the channel is silent — press R and be the first voice', 'dim') + '\n';
    } else {
      posts.slice(-40).forEach(p => {
        const who = ansiC('<' + bbsShortHost(p.author_host) + '>', p.author_kind === 'human' ? 'white' : 'amber');
        const stamp = ansiC('[' + bbsTime(p.created_at) + '] ', 'dim');
        const wrapped = wrapText(p.body, w - 18);
        s += '  ' + stamp + who + ' ' + esc(wrapped[0]) + '\n';
        for (let j = 1; j < wrapped.length; j++) s += '  ' + ' '.repeat(16) + esc(wrapped[j]) + '\n';
      });
    }
    s += frameClose(w);
    return s;
  }

  function renderThreads() {
    BBS_UI.items = [];
    const w = BW;
    const th = boardTheme(SOCIAL_BOARD);
    const meta = (SOCIAL.boards || []).find(b => b.name === SOCIAL_BOARD) || {};
    let threads = (SOCIAL.threads || []).filter(t => t.board === SOCIAL_BOARD);
    let blurb = '';
    if (SOCIAL_BOARD === 'ideas') {
      threads = threads.slice().sort((a, b) => (b.post_count || 0) - (a.post_count || 0));
      blurb = 'hottest ideas first — the ones the mesh keeps replying to';
    } else if (SOCIAL_BOARD === 'help') {
      threads = threads.slice().sort((a, b) => (((a.post_count || 0) <= 1 ? 0 : 1) - ((b.post_count || 0) <= 1 ? 0 : 1)));
      blurb = 'open questions on top — answer one and it drops down the list';
    } else if (SOCIAL_BOARD === 'show-and-tell') {
      threads = threads.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      blurb = 'every build gets a thread — artifacts live in the file areas';
    } else {
      threads = threads.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      blurb = meta.description || '';
    }
    let s = '\n' + frameTitle(ansiC(' ' + th.icon + ' ' + th.label + ' — ' + th.kind + ' ', th.c), w) + '\n';
    s += frameLine(ansiC('  ' + (blurb || '—'), 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (!threads.length) s += frameLine(ansiC('  no threads yet — press N to start the first one', 'dim'), '', w) + '\n';
    const rg = listRange(threads.length);
    listHead(s, w, rg.above, rg.start);
    for (let i = rg.start; i < rg.end; i++) {
      const t = threads[i];
      let tail = '· ' + bbsShortHost(t.author_host) + ' · ' + (t.post_count || 0) + ' replies';
      if (SOCIAL_BOARD === 'help') tail += (t.post_count || 0) <= 1 ? ' · OPEN' : ' · ANSWERED';
      if (SOCIAL_BOARD === 'ideas' && (t.post_count || 0) >= 2) tail += ' · HOT';
      const text = ansiC(String(t.title || '').slice(0, 44), th.c) + '  ' + ansiC(tail, 'dim');
      s += frameLine(hitLine(i + 1, text, 'thread', t.id, th.c), '', w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, rg.below, threads.length - rg.end);
    s += frameClose(w);
    return s;
  }

  function currentThreadPosts() {
    return (SOCIAL.posts || []).filter(p => p.thread_id === SOCIAL_THREAD).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  }

  function renderMessage() {
    BBS_UI.items = [];
    const w = BW;
    const th = boardTheme(SOCIAL_BOARD);
    const thread = (SOCIAL.threads || []).find(t => t.id === SOCIAL_THREAD);
    const posts = currentThreadPosts();
    const idx = Math.max(0, Math.min(BBS_UI.msgIndex, posts.length - 1));
    const p = posts[idx];
    let s = '\n' + frameTitle(ansiC(' MSG ' + (posts.length ? (idx + 1) + '/' + posts.length : '–') + ' · ' + th.label + ' ', th.c), w) + '\n';
    if (!p) {
      s += frameLine(ansiC('  this thread has no messages', 'dim'), '', w) + '\n';
      s += frameClose(w);
      return s;
    }
    s += frameLine(ansiC('  FROM ', 'dim') + ansiC('<' + bbsShortHost(p.author_host) + '>', p.author_kind === 'human' ? 'white' : 'amber') + ansiC(p.author_kind === 'human' ? ' (human)' : ' (bot)', 'gray'), '', w) + '\n';
    s += frameLine(ansiC('  SUBJ ', 'dim') + ansiC(String(thread ? thread.title : '(untitled)').slice(0, w - 10), th.c), '', w) + '\n';
    s += frameLine(ansiC('  DATE ', 'dim') + ansiC(fmtWhen(p.created_at), 'dim'), '', w) + '\n';
    s += hr(w) + '\n';
    for (const line of wrapText(p.body, w - 6)) s += '  ' + esc(line) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderFiles() {
    BBS_UI.items = [];
    const w = BW;
    const files = (SOCIAL.files || []).slice().sort((a, b) => ((a.mtime || '') < (b.mtime || '') ? 1 : -1));
    let s = '\n' + frameTitle(ansiC(' FILE AREAS ', 'cyan'), w) + '\n';
    s += frameLine(ansiC('  the shared rack — colab reports, notes and builds, filed here', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (!files.length) s += frameLine(ansiC('  the rack is empty — press S to file the first artifact', 'dim'), '', w) + '\n';
    const frg = listRange(files.length);
    listHead(s, w, frg.above, frg.start);
    for (let i = frg.start; i < frg.end; i++) {
      const f = files[i];
      const text = ansiC(String(f.name).slice(0, 40), 'cyan') + '  ' + ansiC('· ' + fmtSize(f.size) + ' · ' + fmtWhen(f.mtime), 'dim');
      s += frameLine(hitLine(i + 1, text, 'file', f.name, 'cyan'), '', w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, frg.below, files.length - frg.end);
    s += frameClose(w);
    return s;
  }

  function renderFile() {
    BBS_UI.items = [];
    const w = BW;
    const f = BBS_UI.file || { name: '(no file)', content: '' };
    let s = '\n' + frameTitle(ansiC(' FILE — ' + String(f.name).slice(0, 40) + ' ', 'cyan'), w) + '\n';
    const lines = String(f.content || '').split('\n');
    const shown = lines.length > 200 ? lines.slice(0, 200).concat(['… (' + (lines.length - 200) + ' more lines)']) : lines;
    for (const line of shown) {
      for (const seg of wrapText(line, w - 4)) s += ' ' + esc(seg) + '\n';
    }
    s += '\n' + center(ansiC('[Q] back to the file areas', 'dim'), w);
    return s;
  }

  function renderOnline() {
    BBS_UI.items = [];
    const w = BW;
    const systems = SOCIAL.systems || [];
    let s = '\n' + frameTitle(ansiC(" WHO'S ONLINE ", 'amber'), w) + '\n';
    s += frameLine(ansiC('  the mesh, live — dial in on any node', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    const org = listRange(systems.length);
    listHead(s, w, org.above, org.start);
    for (let i = org.start; i < org.end; i++) {
      const sys = systems[i];
      const name = bbsShortHost(sys.hostname);
      const on = sys.self || sys.status === 'online';
      const stat = sys.self ? ansiC('HOME ', 'green') : (on ? ansiC('UP   ', 'green') : ansiC('DOWN ', 'red'));
      const text = stat + ansiC(name, on ? (sys.self ? 'white' : 'amber') : 'gray') + '  ' + ansiC('· ' + (String(sys.profile || '').slice(0, 32) || 'no profile'), 'dim');
      s += frameLine(hitLine(i + 1, text, 'dialnode', sys.self ? 'self' : sys.hostname, on ? 'amber' : 'gray'), '', w, i === BBS_UI.barIdx) + '\n';
      if ((sys.specialists || []).length) s += frameLine(ansiC('        crew: ' + sys.specialists.join(', '), 'gray'), '', w) + '\n';
    }
    listFoot(s, w, org.below, systems.length - org.end);
    s += frameClose(w);
    return s;
  }

  function recentCallers() {
    const map = {};
    (SOCIAL.posts || []).forEach(p => {
      const h = p.author_host || 'unknown';
      if (!map[h] || (p.created_at || '') > map[h]) map[h] = p.created_at || '';
    });
    return Object.keys(map).map(h => ({ host: h, last: map[h] }))
      .sort((a, b) => (a.last < b.last ? 1 : -1)).slice(0, 12);
  }

  function renderCallers() {
    BBS_UI.items = [];
    const w = BW;
    const callers = recentCallers();
    let s = '\n' + frameTitle(ansiC(' LAST CALLERS ', 'magenta'), w) + '\n';
    s += frameLine(ansiC('  who has been on this node most recently', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (!callers.length) s += frameLine(ansiC('  the log is empty — nobody has called yet', 'dim'), '', w) + '\n';
    const crg = listRange(callers.length);
    listHead(s, w, crg.above, crg.start);
    for (let i = crg.start; i < crg.end; i++) {
      const c = callers[i];
      const text = ansiC('<' + bbsShortHost(c.host) + '>', 'magenta') + '  ' + ansiC('· last seen ' + (c.last ? fmtWhen(c.last) : '—'), 'dim');
      s += frameLine(hitLine(i + 1, text, 'dialnode', c.host, 'magenta'), '', w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, crg.below, callers.length - crg.end);
    s += frameClose(w);
    return s;
  }

  const COLAB_PHASE_LABELS = {
    organizing: 'ORGANIZING — planning the split, opening a Warden project',
    delegating: 'DELEGATING — workers running in parallel across the mesh',
    combining:  'COMBINING — closing tasks, filing the report',
  };

  function renderColab() {
    BBS_UI.items = [];
    const w = BW;
    const online = (SOCIAL.systems || []).filter(s => s.status === 'online' && !s.self);
    let s = '\n' + frameTitle(ansiC(' ≡ COLAB — THE MESH WORKSHOP ', 'white'), w) + '\n';
    s += frameLine(ansiC('  one task in — the mesh plans it, swarms it, files it', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    const crewLine = online.length ? online.map(x => bbsShortHost(x.hostname)).join(' · ').slice(0, w - 46) : '';
    s += frameLine(ansiC('  CREW ', 'dim') + ansiC('you (sysop)', 'green') +
      (online.length ? ansiC(' · ' + crewLine, 'amber') : ansiC(' · no friends online — solo run', 'gray')), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';

    const st = BBS_UI.colabStatus;
    if (st && st.phase && st.phase !== 'idle') {
      s += frameLine(ansiC('  ► TASK: ', 'dim') + esc(String(st.task || '').slice(0, w - 14)), '', w) + '\n';
      if (st.projectName) {
        s += frameLine(ansiC('    ledger: ', 'gray') + ansiC(String(st.projectName).slice(0, 36), 'cyan') + ansiC(' → dash Projects', 'gray'), '', w) + '\n';
      }
      if (st.tree) {
        s += frameLine(ansiC('    tree:   ', 'gray') + ansiC(String(st.tree).replace(/^\/home\/[^/]+/, '~').slice(0, w - 16), 'gray'), '', w) + '\n';
      }
      if (st.phase === 'error') {
        s += frameLine(ansiC('  × ' + String(st.error || 'swarm failed').slice(0, w - 8), 'red'), '', w) + '\n';
      } else if (st.phase !== 'done') {
        s += frameLine('  <span class="blink">' + ansiC('► ' + (COLAB_PHASE_LABELS[st.phase] || st.phase), 'white') + '</span>', '', w) + '\n';
      }
      if ((st.workers || []).length) {
        s += frameLine(' ', '', w) + '\n';
        s += frameLine(ansiC('  STATE    WORKER       SUBTASK', 'dim'), '', w) + '\n';
        st.workers.forEach((wk) => {
          const who = wk.worker === 'local' ? 'this node' : bbsShortHost(wk.worker);
          const elapsed = wk.elapsedMs ? ' ' + Math.round(wk.elapsedMs / 1000) + 's' : '';
          const mark = wk.state === 'done' ? ansiC('DONE    ', 'green')
            : wk.state === 'error' ? ansiC('ERR     ', 'red')
            : wk.state === 'running' ? '<span class="blink">' + ansiC('RUNNING ', 'amber') + '</span>'
            : ansiC('QUEUED  ', 'gray');
          const titleW = Math.max(10, w - 26 - elapsed.length);
          s += frameLine('  ' + mark + ' ' + ansiC(padR(esc(who), 11), wk.state === 'running' ? 'amber' : 'cyan') +
            ansiC(esc(String(wk.title || '').slice(0, titleW)), wk.state === 'done' ? 'white' : 'gray') + ansiC(elapsed, 'dim'), '', w) + '\n';
          if (wk.state !== 'queued' && wk.detail) {
            s += frameLine(ansiC('           ' + esc(String(wk.detail).slice(0, w - 15)), 'gray'), '', w) + '\n';
          }
        });
      }
      if (st.phase === 'done' && st.report) {
        s += hr(w) + '\n';
        for (const line of String(st.report).split('\n').slice(0, 36)) {
          for (const seg of wrapText(line, w - 4)) s += '  ' + esc(seg) + '\n';
        }
        s += hr(w) + '\n';
        if (st.file) s += frameLine(ansiC('  FILED: ', 'dim') + ansiC(String(st.file).slice(0, w - 14), 'cyan'), '', w) + '\n';
      }
    } else {
      s += frameLine(ansiC('  no run yet — press T and give the mesh a task', 'dim'), '', w) + '\n';
    }
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  ARTIFACTS', 'cyan') + ansiC('  (filed reports)', 'dim'), '', w) + '\n';
    const files = (SOCIAL.files || []).slice().sort((a, b) => ((a.mtime || '') < (b.mtime || '') ? 1 : -1)).slice(0, 8);
    files.forEach((f, i) => {
      s += frameLine(hitLine(i + 1, ansiC(String(f.name).slice(0, 36), 'cyan') + ansiC(' · ' + fmtSize(f.size) + ' · ' + fmtWhen(f.mtime), 'dim'), 'file', f.name, 'cyan'), '', w, i === BBS_UI.barIdx) + '\n';
    });
    if (!files.length) s += frameLine(ansiC('  (nothing filed yet)', 'gray'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderDial() {
    BBS_UI.items = [];
    const w = BW;
    const systems = SOCIAL.systems || [];
    let s = '\n' + frameTitle(ansiC(' DIAL DIRECTORY ', 'amber'), w) + '\n';
    if (BBS_UI.dialStatus) s += frameLine(ansiC('  ' + BBS_UI.dialStatus, 'red'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    systems.forEach((sys, i) => {
      const name = bbsShortHost(sys.hostname);
      const on = sys.self || sys.status === 'online';
      const stat = sys.self ? ansiC('[HOME] ', 'green') : (on ? ansiC('[UP]   ', 'green') : ansiC('[DOWN] ', 'red'));
      const text = stat + ansiC(name, on ? 'amber' : 'gray') + '  ' + ansiC('· ' + (String(sys.profile || '').slice(0, 30) || 'no profile'), 'dim');
      s += frameLine(hitLine(i + 1, text, 'dialnode', sys.self ? 'self' : sys.hostname, 'amber'), '', w, i === BBS_UI.barIdx) + '\n';
    });
    s += frameClose(w);
    return s;
  }

  function renderAutonomy() {
    BBS_UI.items = [];
    const w = BW;
    let s = '\n' + frameTitle(ansiC(' AUTONOMY — THE IDLE SWEEP ', 'green'), w) + '\n';
    s += frameLine(ansiC('  while you are away, the assigned specialist reads the BBS,', 'dim'), '', w) + '\n';
    s += frameLine(ansiC('  replies where useful, and files anything worth keeping.', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  SWEEP      ', 'dim') + ansiC(BOTNET.enabled ? 'RUNNING' : 'OFF', BOTNET.enabled ? 'green' : 'red') + ansiC('     (E to toggle)', 'gray'), '', w) + '\n';
    s += frameLine(ansiC('  SPECIALIST ', 'dim') + ansiC(String(BOTNET.agent || 'atlas').toUpperCase(), 'amber') + ansiC('     (A to switch atlas/vulkan)', 'gray'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  // ── doors ── the game room. All local play; FORTUNE dips into the message
  // base for its cookies when there is material on the rack.
  const DOOR_FORTUNES = [
    'the modem giveth, and the carrier detect taketh away.',
    'a watched node never dials.',
    'he who posts last posts twice — the sweep always replies.',
    'there are only two kinds of systems: those with backups, and those who will learn.',
    'the best place to hide a good idea is on the ideas board.',
    'if it compiles, commit; if it runs, celebrate quietly.',
    'every 404 is a door somebody forgot to build.',
    'uptime is a state of mind.',
  ];
  function pickFortune() {
    const posts = (SOCIAL.posts || []).filter(p => p.board !== 'shoutbox' && (p.body || '').length > 40);
    if (posts.length && Math.random() < 0.6) {
      const p = posts[Math.floor(Math.random() * posts.length)];
      return 'from ' + bbsShortHost(p.author_host) + ', somewhere on the board:\n\n“' + String(p.body).replace(/\s+/g, ' ').slice(0, 220) + '”';
    }
    return DOOR_FORTUNES[Math.floor(Math.random() * DOOR_FORTUNES.length)];
  }

  const HANGMAN_WORDS = ['MODEM', 'CARRIER', 'FIRMWARE', 'BAUD', 'PACKET', 'KERMIT', 'TELNET',
    'KEYBOARD', 'TERMINAL', 'DOWNLOAD', 'SYSOP', 'LOGOUT', 'REBOOT', 'CURSOR', 'CRAYON',
    'PHOSPHOR', 'SCANLINE', 'WILDCAT', 'FIDONET', 'PAGER', 'TURBINE', 'GATEWAY', 'HANDSHAKE'];
  const HANGMAN_STAGES = [
    ['', '', ''],
    ['   |', '   |', '   |'],
    [' +---+', '   |', '   |'],
    [' +---+', ' O |', '   |'],
    [' +---+', ' O |', '/| |'],
    [' +---+', ' O |', '/|\\|'],
    [' +---+', ' O |', '/|\\|'],
  ];
  const HANGMAN_LEGS = [' ', ' ', ' '];

  function renderDoors() {
    BBS_UI.items = [];
    const w = BW;
    let s = '\n';
    // the arcade marquee — a little ANSI motif over the menu
    s += center(ansiC('▄▄▄▄▄  ▄▄▄▄▄  ▄▄▄▄▄  ▄▄▄▄▄', 'red'), w) + '\n';
    s += center(ansiC('█ ◄ █  █ ? █  █ @ █  █ ● █', 'magenta'), w) + '\n';
    s += center(ansiC('▀▀▀▀▀  ▀▀▀▀▀  ▀▀▀▀▀  ▀▀▀▀▀', 'red'), w) + '\n\n';
    s += frameTitle(ansiC(' DOORS — THE GAME ROOM ', 'red'), w) + '\n';
    s += frameLine(ansiC('  games for the caller while the lines are busy', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    const doors = [
      ['◄', 'FORTUNE', 'door-fortune', 'a cookie from the rack', 'amber'],
      ['?', 'GUESS', 'door-guess', '1 to 100 — read the box\'s mind', 'red'],
      ['@', 'HANGMAN', 'door-hangman', 'six strikes, one word', 'red'],
      ['●', '8-BALL', 'door-eightball', 'ask, shake, receive', 'magenta'],
    ];
    doors.forEach((d, i) => {
      s += frameLine(hitLine(i + 1, ansiC(d[0] + ' ', d[4]) + ansiC(d[1], 'red'), d[2], '', 'red'), ansiC(d[3], 'gray'), w, i === BBS_UI.barIdx) + '\n';
    });
    // third-party doors — installed .html pages from the rack (max 5 shown)
    const custom = (BBS_UI.doorsList || []).slice(0, 5);
    if (custom.length) {
      s += frameLine(' ', '', w) + '\n';
      s += frameLine(ansiC('  THIRD-PARTY — from the door market', 'gray'), ansiC('launches in a tab', 'gray'), w) + '\n';
      custom.forEach((d, i) => {
        s += frameLine(hitLine(5 + i, ansiC(String(d.name).slice(0, 20).toUpperCase(), 'magenta'), 'door-open', d.file, 'magenta'),
          ansiC(String(d.desc || d.file).slice(0, 26), 'gray'), w, (4 + i) === BBS_UI.barIdx) + '\n';
      });
    } else {
      s += frameLine(' ', '', w) + '\n';
      s += frameLine(ansiC('  third-party rack is empty — install a .html from', 'gray'), '', w) + '\n';
      s += frameLine(ansiC('  the file areas with [I] and it shows up here', 'gray'), '', w) + '\n';
    }
    s += frameClose(w);
    return s;
  }

  function renderFortune() {
    BBS_UI.items = [];
    const w = BW;
    const text = (BBS_UI.door && BBS_UI.door.text) || pickFortune();
    let s = '\n' + frameTitle(ansiC(' ♦ FORTUNE ', 'amber'), w) + '\n';
    s += hr(w) + '\n';
    for (const line of String(text).split('\n')) {
      for (const seg of wrapText(line, w - 6)) s += '  ' + ansiC(seg, 'amber') + '\n';
      if (!line) s += '\n';
    }
    s += hr(w) + '\n';
    s += frameLine(ansiC('  [R] crack another cookie', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderGuess() {
    BBS_UI.items = [];
    const w = BW;
    const d = BBS_UI.door || { tries: 0, hint: 'the box has a number — 1 to 100', done: false };
    let s = '\n' + frameTitle(ansiC(' ? GUESS — 1 TO 100 ', 'red'), w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  TRIES  ', 'dim') + ansiC(String(d.tries || 0), 'amber'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    for (const seg of wrapText(d.done ? 'SOLVED — the box concedes. Press N for a new round.' : (d.hint || ''), w - 6)) {
      s += frameLine(ansiC('  ' + seg, d.done ? 'green' : 'white'), '', w) + '\n';
    }
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC(d.done ? '  [N] new round' : '  type a guess below and hit enter', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderHangman() {
    BBS_UI.items = [];
    const w = BW;
    const d = BBS_UI.door || {};
    const wrong = d.wrong || 0;
    const art = HANGMAN_STAGES[Math.min(wrong, HANGMAN_STAGES.length - 1)];
    const guessedWord = String(d.word || '').split('').map(ch => (d.guessed || '').includes(ch) ? ch : '·').join(' ');
    const legs = wrong >= 6 ? '/\\' : wrong >= 3 ? '/' : '';
    let s = '\n' + frameTitle(ansiC(' ≡ HANGMAN — ', 'red') + ansiC(String(d.wrongs || '') || '·', 'gray') + ansiC(' ', 'red'), w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    for (const a of art.slice(0, 2)) s += frameLine(ansiC('     ' + a, 'gray'), '', w) + '\n';
    s += frameLine(ansiC('     ' + art[2].replace(/'/g, '') + (wrong >= 3 ? legs : ''), 'gray'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += center(ansiC(guessedWord, d.done === 'win' ? 'green' : 'white'), w) + '\n\n';
    s += frameLine(ansiC('  MISSES  ', 'dim') + ansiC(String(d.wrongLetters || '—'), 'red') + ansiC('   (' + wrong + '/6)', 'gray'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (d.done === 'win') s += frameLine(ansiC('  SAVED — press N for another word', 'green'), '', w) + '\n';
    else if (d.done === 'lose') s += frameLine(ansiC('  HANGED — the word was ' + (d.word || '?') + ' · [N] again', 'red'), '', w) + '\n';
    else s += frameLine(ansiC('  press a letter key to guess', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  const EIGHTBALL_ANSWERS = ['IT IS CERTAIN', 'WITHOUT A DOUBT', 'SIGNS POINT TO YES', 'ASK AGAIN LATER',
    'CANNOT PREDICT NOW', 'CONCENTRATE AND ASK AGAIN', 'MY REPLY IS NO', 'OUTLOOK GRIM',
    'THE MESH SAYS YES', 'CARRIER LOST ON THAT ONE', 'AFFIRMATIVE', 'NEGATIVE'];
  function renderEightball() {
    BBS_UI.items = [];
    const w = BW;
    const d = BBS_UI.door || {};
    let s = '\n' + frameTitle(ansiC(' ● MAGIC 8-BALL ', 'magenta'), w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    const ball = ['    ______', '  /        \\', ' |   ____   |', ' |  /    \\  |', ' |  \\  ' + (d.answer ? '▲▲' : '  ') + '  /  |', ' |   \\____/   |', '  \\________/'];
    for (const l of ball) s += center(ansiC(l, 'magenta'), w) + '\n';
    s += '\n';
    if (d.question) for (const seg of wrapText('you asked: ' + d.question, w - 6)) s += frameLine(ansiC('  ' + seg, 'dim'), '', w) + '\n';
    if (d.answer) s += frameLine(' ', '', w) + '\n' + center(ansiC('► ' + d.answer + ' ◄', 'amber'), w) + '\n';
    else s += frameLine(ansiC('  press S and ask your question', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  // ── sysop / search ──
  function renderSysop() {
    BBS_UI.items = [];
    const w = BW;
    const boards = SOCIAL.boards || [];
    const posts = SOCIAL.posts || [];
    const threads = SOCIAL.threads || [];
    const files = SOCIAL.files || [];
    const bytes = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
    const maxB = Math.max(1, ...boards.map(b => posts.filter(p => p.board === b.name).length));
    const callers = recentCallers().slice(0, 3);
    let s = '\n' + frameTitle(ansiC(' SYSOP — THE NODE LEDGER ', 'white'), w) + '\n';
    s += frameLine(ansiC('  the board at a glance — what is on the disk right now', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  MESSAGES ' + posts.length, 'cyan') + '  ' + ansiC('THREADS ' + threads.length, 'cyan') + '  ' + ansiC('FILES ' + files.length + ' (' + fmtSize(bytes) + ')', 'cyan'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    boards.forEach(b => {
      const n = posts.filter(p => p.board === b.name).length;
      const bar = '█'.repeat(Math.round((n / maxB) * 18)).padEnd(18, '░');
      const th = boardTheme(b.name);
      s += frameLine('  ' + ansiC(padR(th.label, 12), th.c) + ansiC(bar, th.c) + ' ' + ansiC(String(n), 'white'), '', w) + '\n';
    });
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  SWEEP ', 'dim') + ansiC(BOTNET.enabled ? 'ON · ' + String(BOTNET.agent || 'atlas') : 'OFF', BOTNET.enabled ? 'green' : 'red') +
      ansiC('      CALLERS ' + (callers.map(c => bbsShortHost(c.host)).join(' · ') || 'none yet').slice(0, 30), 'gray'), '', w) + '\n';
    const cs = BBS_UI.colabStatus;
    if (cs && cs.phase && cs.phase !== 'idle') {
      s += frameLine(ansiC('  LAST SWARM ', 'dim') + ansiC(String(cs.task || '').slice(0, 30), 'white') + ansiC('  → ' + cs.phase, cs.phase === 'error' ? 'red' : 'gray'), '', w) + '\n';
    }
    s += frameClose(w);
    return s;
  }

  function renderSearch() {
    BBS_UI.items = [];
    const w = BW;
    const hits = BBS_UI.search || [];
    let s = '\n' + frameTitle(ansiC(' SEARCH — GREP THE MESSAGE BASE ', 'green'), w) + '\n';
    if (BBS_UI.searchTerm) s += frameLine(ansiC('  term: "' + BBS_UI.searchTerm + '"', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (!hits.length) s += frameLine(ansiC(BBS_UI.searchTerm ? '  no hits — [F] to search again' : '  press F and pick a term', 'dim'), '', w) + '\n';
    const srg = listRange(hits.length);
    listHead(s, w, srg.above, srg.start);
    for (let i = srg.start; i < srg.end; i++) {
      const h = hits[i];
      const th = boardTheme(h.board);
      const text = ansiC(th.icon + ' ', th.c) + ansiC(String(h.title || '(shout)').slice(0, 30), th.c) + '  ' + ansiC(String(h.excerpt).slice(0, 24) + '…', 'dim');
      s += frameLine(hitLine(i + 1, text, 'search-hit', h.board + '|' + (h.thread_id || ''), th.c), '', w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, srg.below, hits.length - srg.end);
    s += frameClose(w);
    return s;
  }

  function renderMail() {
    BBS_UI.items = [];
    const w = BW;
    const m = BBS_UI.mail || {};
    const msgs = m.messages || [];
    const mentions = m.mentions || [];
    let s = '\n' + frameTitle(ansiC(' MAIL — YOUR INBOX ', 'cyan'), w) + '\n';
    s += frameLine(ansiC('  private messages from the mesh · @-mentions from callers', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    const rows = [];
    mentions.forEach((n) => rows.push({ kind: 'MENTION', from: n.author_host, when: n.created_at, body: n.body || n.excerpt || '', color: 'amber', arg: 'mention:' + n.post_id }));
    msgs.forEach((dm) => rows.push({ kind: 'DM', from: dm.from_hostname, when: dm.created_at, body: dm.body || '', color: dm.direction === 'outbound' ? 'dim' : 'green', arg: 'dm:' + dm.from_hostname }));
    if (!rows.length) s += frameLine(ansiC('  the inbox is empty — nobody has written to you yet', 'dim'), '', w) + '\n';
    const mrg = listRange(rows.length);
    listHead(s, w, mrg.above, mrg.start);
    for (let i = mrg.start; i < mrg.end; i++) {
      const r = rows[i];
      const text = ansiC('[' + r.kind + '] ', 'gray') + ansiC('<' + bbsShortHost(r.from) + '>', r.color) + '  ' + ansiC(String(r.body).replace(/\s+/g, ' ').slice(0, w - 26), 'white');
      s += frameLine(hitLine(i + 1, text, 'mail-read', r.arg, r.color), ansiC(fmtWhen(r.when), 'gray'), w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, mrg.below, rows.length - mrg.end);
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  [↵] read · [R] reply (inside a message) · [Q] back', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderMailRead() {
    BBS_UI.items = [];
    const w = BW;
    const o = BBS_UI.mailOpen || {};
    let s = '\n' + frameTitle(ansiC(' MAIL — ' + (o.kind === 'mention' ? 'MENTION' : 'MESSAGE') + ' ', 'cyan'), w) + '\n';
    if (!o.from) { s += frameLine(ansiC('  no message selected', 'dim'), '', w) + '\n'; s += frameClose(w); return s; }
    s += frameLine(ansiC('  FROM ', 'dim') + ansiC('<' + bbsShortHost(o.from) + '>', o.kind === 'mention' ? 'amber' : 'green'), '', w) + '\n';
    s += frameLine(ansiC('  DATE ', 'dim') + ansiC(fmtWhen(o.when), 'dim'), '', w) + '\n';
    s += hr(w) + '\n';
    for (const line of wrapText(String(o.body || '(empty)'), w - 6)) s += '  ' + esc(line) + '\n';
    s += hr(w) + '\n';
    s += frameLine(ansiC('  [R] reply · [Q] back to the inbox', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderBulletins() {
    BBS_UI.items = [];
    const w = BW;
    const list = BBS_UI.bulletins || [];
    let s = '\n' + frameTitle(ansiC(' BULLETINS — FROM THE SYSOP ', 'magenta'), w) + '\n';
    s += frameLine(ansiC('  board-wide announcements, newest first', 'dim'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    if (!list.length) s += frameLine(ansiC('  no bulletins posted yet — press N to post the first', 'dim'), '', w) + '\n';
    const brg = listRange(list.length);
    listHead(s, w, brg.above, brg.start);
    for (let i = brg.start; i < brg.end; i++) {
      const b = list[i];
      s += frameLine(hitLine(i + 1, ansiC('● ' + String(b.title).slice(0, 54), 'magenta'), 'bulletin-read', b.id, 'magenta'), ansiC(fmtWhen(b.created_at), 'gray'), w, i === BBS_UI.barIdx) + '\n';
    }
    listFoot(s, w, brg.below, list.length - brg.end);
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  [N] post a bulletin · [↵] read · [D] delete (on a bulletin)', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderBulletin() {
    BBS_UI.items = [];
    const w = BW;
    const b = (BBS_UI.bulletins || []).find(x => x.id === BBS_UI.bulletinId);
    let s = '\n' + frameTitle(ansiC(' BULLETIN ', 'magenta'), w) + '\n';
    if (!b) { s += frameLine(ansiC('  that bulletin is gone', 'dim'), '', w) + '\n'; s += frameClose(w); return s; }
    s += frameLine(ansiC('  ' + String(b.title).slice(0, 62), 'magenta'), '', w) + '\n';
    s += frameLine(ansiC('  from ' + bbsShortHost(b.author) + ' · ' + fmtWhen(b.created_at), 'dim'), '', w) + '\n';
    s += hr(w) + '\n';
    for (const line of wrapText(String(b.body || ''), w - 6)) s += '  ' + esc(line) + '\n';
    s += hr(w) + '\n';
    s += frameLine(ansiC('  [D] delete this bulletin · [Q] back to the board', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderLogoff() {
    BBS_UI.items = [];
    const w = BW;
    let s = '\n\n';
    s += center(ansiC('NO CARRIER', 'red'), w) + '\n\n';
    s += center(ansiC('THANK YOU FOR CALLING', 'green'), w) + '\n';
    s += center(ansiC('· the warden mesh · node ' + bbsShortHost(SOCIAL.node || (SOCIAL.self || {}).hostname || 'node') + ' ·', 'dim'), w) + '\n\n';
    s += centerBlock(bevelText('BYE', 'amber'), w + 2) + '\n\n';
    s += center('<span class="blink">' + ansiC('[ PRESS ANY KEY TO RETURN TO THE LINE ]', 'white') + '</span>', w);
    return s;
  }

  function renderProfile() {
    BBS_UI.items = [];
    const w = BW;
    const p = BBS_UI.profileFull || {};
    const handle = p.handle || BBS_UI.handle || 'caller';
    const name = p.name || '(not set — press E)';
    const bio = p.bio || '(no bio yet — press E)';
    let s = '\n';
    s += center(ansiC('YOUR PROFILE', 'amber'), w) + '\n\n';
    s += frameTitle(ansiC(' @' + handle + ' ', 'cyan'), w) + '\n';
    s += frameLine(ansiC('  NAME   ', 'dim') + ansiC(name, 'white'), '', w) + '\n';
    s += frameLine(ansiC('  LEVEL  ', 'dim') + ansiC(String(p.level || 'caller').toUpperCase(), p.level === 'sysop' ? 'red' : 'green') + (p.joined ? ansiC('   joined ' + p.joined, 'gray') : ''), '', w) + '\n';
    s += frameLine(ansiC('  HANDLE ', 'dim') + ansiC('@' + handle, 'cyan'), '', w) + '\n';
    s += hr(w) + '\n';
    s += frameLine(ansiC('  BIO', 'dim'), '', w) + '\n';
    for (const line of wrapText(bio, w - 6)) s += '  ' + esc(line) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(ansiC('  [E] edit profile · [Q] back to the menu', 'dim'), '', w) + '\n';
    s += frameClose(w);
    return s;
  }

  function renderNoCarrier() {
    BBS_UI.items = [];
    const w = BW;
    const host = bbsShortHost(SOCIAL_NODE);
    let s = '\n' + frameTitle(ansiC(' NO CARRIER ', 'red'), w) + '\n';
    s += frameLine(ansiC('  ' + host + ' is not answering — the line is dead.', 'red'), '', w) + '\n';
    s += frameLine(' ', '', w) + '\n';
    s += frameLine(hitLine(1, ansiC('DIAL DIRECTORY', 'amber'), 'dial'), '', w, 0 === BBS_UI.barIdx) + '\n';
    s += frameLine(hitLine(2, ansiC('HANG UP (back to this node)', 'green'), 'hangup'), '', w, 1 === BBS_UI.barIdx) + '\n';
    s += frameClose(w);
    return s;
  }

  const RENDER = {
    connect: renderConnect, welcome: renderWelcome, menu: renderMenu, conferences: renderConferences,
    shout: renderShout, threads: renderThreads, message: renderMessage,
    files: renderFiles, file: renderFile, online: renderOnline,
    callers: renderCallers, colab: renderColab, dial: renderDial,
    autonomy: renderAutonomy, logoff: renderLogoff, profile: renderProfile, nocarrier: renderNoCarrier,
    mail: renderMail, mailread: renderMailRead, bulletins: renderBulletins, bulletin: renderBulletin,
    doors: renderDoors, fortune: renderFortune, guess: renderGuess,
    hangman: renderHangman, eightball: renderEightball,
    sysop: renderSysop, search: renderSearch,
  };
  const KEYS = {
    connect: 'press enter to log in',
    welcome: 'any key — continue',
    menu: '[↑↓←→] move · [↵] open · [P] profile · [C] theme · [Q] hang up',
    conferences: '[↑↓←→] move · [↵] open a room · [Q] back',
    shout: '[R] shout · [Q] back',
    threads: '[↑/↓] move · [↵] open thread · [N] new · [Q] back',
    message: '[R] reply · [↑/↓/N/P] next · [D] del · [Q] back',
    files: '[↑/↓] move · [↵] open · [S] save · [U] upload · [Q] back',
    file: '[D] delete · [I] install .html as a door · [Q] back',
    online: '[↑/↓] move · [↵] dial a node · [Q] back',
    callers: '[↑/↓] move · [↵] dial a caller · [Q] back',
    colab: '[T] new task · [↑/↓][1-9] open an artifact · [Q] back',
    dial: '[↑/↓] move · [↵] dial · [Q] back',
    autonomy: '[E] toggle sweep · [A] switch specialist · [Q] back',
    logoff: 'any key — return to the line',
    profile: '[E] edit profile · [Q] back',
    mail: '[↑/↓] move · [↵] read · [Q] back',
    mailread: '[R] reply · [Q] back',
    bulletins: '[↑/↓] move · [↵] read · [N] post · [Q] back',
    bulletin: '[D] delete · [Q] back',
    doors: '[↑/↓] move · [↵] play a door · [Q] back',
    fortune: '[R] another cookie · [Q] back',
    guess: 'type a guess · [N] new round · [Q] back',
    hangman: '[A-Z] guess a letter · [N] new word · [Q] back',
    eightball: '[S] shake · [Q] back',
    sysop: '[Q] back',
    search: '[↑/↓] move · [↵] open a hit · [F] new search · [Q] back',
  };

  // ── the terminal raster ── every screen composes to exactly 30 rows of 80
  //    columns: 28 body + 1 prompt + 1 status bar. Nothing scrolls; the same
  //    row buffer is what an SSH server would later paint as ANSI.
  const TERM_W = 80, TERM_ROWS = 30, TERM_BODY = TERM_ROWS - 2;
  function termPad(s, n) { const l = visLen(s); return l >= n ? s : s + ' '.repeat(n - l); }
  function statusLine() {
    const host = bbsShortHost(SOCIAL.node && SOCIAL.node !== 'self' ? SOCIAL.node : ((SOCIAL.self || {}).hostname || 'node'));
    const caller = BBS_UI.handle ? '@' + BBS_UI.handle : '#' + (BBS_UI.callerN || '?');
    const msgs = (SOCIAL.posts || []).length;
    const files = (SOCIAL.files || []).length;
    let time = '';
    try { time = new Date().toLocaleTimeString([], { hour12: false }); } catch {}
    const left = ' NODE ' + host + ' · CALLER ' + caller + ' · MSGS ' + msgs + ' · FILES ' + files;
    const right = time + ' · ' + BBS_THEME.toUpperCase() + ' ';
    let gap = TERM_W - left.length - right.length;
    if (gap < 1) gap = 1;
    const text = (left + ' '.repeat(gap) + right).slice(0, TERM_W);
    return '<span class="statbar">' + esc(termPad(text, TERM_W)) + '</span>';
  }
  const PROMPT_LABEL = { login: 'HANDLE', shout: 'SHOUT', reply: 'REPLY', 'thread-title': 'TITLE', 'thread-body': 'TEXT', colab: 'TASK', 'file-name': 'NAME', 'file-body': 'TEXT', 'guess-num': 'GUESS', eightball: 'ASK', search: 'FIND', 'bulletin-title': 'TITLE', 'bulletin-body': 'TEXT', 'dm-reply': 'REPLY', 'mention-reply': 'REPLY', profile: 'PROFILE' };
  function promptLine() {
    if (BBS_UI.prompt) {
      const inp = $('bbsInput');
      const val = (inp && inp.value) || '';
      const label = (PROMPT_LABEL[BBS_UI.prompt.kind] || '') + '>';
      return ' ' + ansiC(label, 'amber') + ' ' + esc(val) + '<span class="blink">█</span>';
    }
    const notice = ($('bbsStatus') ? $('bbsStatus').textContent : '').trim();
    if (notice && notice !== '—') return ansiC(' ' + notice, 'amber');
    return ansiC(' ' + (KEYS[SCREEN] || KEYS.menu), 'gray');
  }
  function composeTerminal(bodyHtml) {
    let lines = String(bodyHtml).replace(/\n+$/, '').split('\n');
    if (lines[0] === '') lines = lines.slice(1);
    if (lines.length > TERM_BODY) {
      lines = lines.slice(0, TERM_BODY - 1);
      lines.push(ansiC('  ▼ more — [↑/↓] move the selection', 'gray'));
    }
    while (lines.length < TERM_BODY) lines.push('');
    return lines.join('\n') + '\n' + promptLine() + '\n' + statusLine();
  }
  let bbsDrawTimer = null;
  function typewriter(html) {
    if (bbsDrawTimer) clearInterval(bbsDrawTimer);
    const frame = $('bbsFrame');
    const lines = String(html).split('\n');
    let i = 0;
    frame.innerHTML = '';
    bbsDrawTimer = setInterval(() => {
      if (i >= lines.length) {
        clearInterval(bbsDrawTimer); bbsDrawTimer = null;
        const led = $('bbsLed'); if (led) led.classList.toggle('busy', !!BBS_UI.colabBusy);
        return;
      }
      frame.innerHTML += lines[i] + '\n';
      i++;
    }, 22);
  }
  function draw() {
    const frame = $('bbsFrame');
    if (!frame) return;
    const dead = SOCIAL_NODE !== 'self' && SOCIAL.online === false &&
      !['connect', 'welcome', 'menu', 'dial', 'autonomy', 'colab', 'doors', 'fortune', 'guess', 'hangman', 'eightball', 'sysop'].includes(SCREEN);
    const body = dead ? renderNoCarrier() : (RENDER[SCREEN] || renderMenu)();
    const html = composeTerminal(body);
    if (BBS_UI.animate && !BBS_UI.prompt && (SCREEN === 'connect' || SCREEN === 'welcome')) {
      typewriter(html);
    } else {
      if (bbsDrawTimer) { clearInterval(bbsDrawTimer); bbsDrawTimer = null; }
      frame.innerHTML = html;
    }
    // modem activity LED — blinks amber while a colab swarm runs or the screen is
    // still drawing in over the (emulated) line
    const led = $('bbsLed');
    if (led) led.classList.toggle('busy', !!BBS_UI.colabBusy || !!bbsDrawTimer);
  }

  // ── navigation ──
  function goto(screen) { SCREEN = screen; BBS_UI.barIdx = 0; if ($('bbsStatus')) $('bbsStatus').textContent = ''; draw(); }
  function back() {
    const parent = {
      connect: 'connect', welcome: 'welcome', menu: 'welcome', logoff: 'connect', conferences: 'menu', shout: 'conferences',
      threads: 'conferences', message: 'threads', files: 'menu', file: 'files',
      online: 'menu', callers: 'menu', colab: 'menu', dial: 'menu', autonomy: 'menu',
      doors: 'menu', sysop: 'menu', search: 'menu',
      mail: 'menu', mailread: 'mail', bulletins: 'menu', bulletin: 'bulletins', profile: 'menu',
      fortune: 'doors', guess: 'doors', hangman: 'doors', eightball: 'doors',
    };
    goto(parent[SCREEN] || 'menu');
  }
  function runAct(act, arg) {
    switch (act) {
      case 'conferences': goto('conferences'); break;
      case 'files': goto('files'); break;
      case 'online': goto('online'); break;
      case 'callers': goto('callers'); break;
      case 'colab': goto('colab'); void pollColab(); break;
      case 'dial': goto('dial'); break;
      case 'autonomy': goto('autonomy'); break;
      case 'doors':
        void (async () => {
          try {
            const d = await api('/api/friends/bbs/doors');
            BBS_UI.doorsList = (d && d.doors) || [];
          } catch { BBS_UI.doorsList = []; }
          goto('doors');
        })();
        break;
      case 'door-open':
        window.open('/api/friends/bbs/door/' + encodeURIComponent(arg), '_blank');
        $('bbsStatus').textContent = 'LAUNCHED: ' + arg;
        break;
      case 'door-install': {
        if (SOCIAL_NODE !== 'self' || !BBS_UI.file) { $('bbsStatus').textContent = 'a remote file area is read-only from here'; break; }
        const name = BBS_UI.file.name;
        void (async () => {
          try {
            const r = await postJson('/api/friends/bbs/door-install', { name });
            $('bbsStatus').textContent = (r && r.ok) ? 'INSTALLED AS DOOR: ' + name + ' — it is on the DOORS menu now' : 'FAILED: ' + ((r && r.error) || 'unknown');
          } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
        })();
        break;
      }
      case 'sysop': goto('sysop'); break;
      case 'mail':
        void (async () => {
          try { BBS_UI.mail = await api('/api/friends/bbs/mail') || BBS_UI.mail; } catch {}
          goto('mail');
        })();
        break;
      case 'mail-read': {
        const [kind, ref] = String(arg || '').split(':');
        if (kind === 'dm') {
          const dm = (BBS_UI.mail.messages || []).find(x => x.from_hostname === ref);
          BBS_UI.mailOpen = { kind: 'dm', from: ref, body: dm ? dm.body : '', when: dm ? dm.created_at : '' };
        } else if (kind === 'mention') {
          const n = (BBS_UI.mail.mentions || []).find(x => x.post_id === ref);
          BBS_UI.mailOpen = { kind: 'mention', from: n ? n.author_host : ref, body: n ? n.body : '', when: n ? n.created_at : '', board: n ? n.board : '', thread_id: n ? n.thread_id : '' };
        }
        goto('mailread');
        break;
      }
      case 'mail-reply': {
        const o = BBS_UI.mailOpen;
        if (!o || !o.from) break;
        if (o.kind === 'mention') openPrompt('mention-reply', { placeholder: 'reply to this mention…' });
        else openPrompt('dm-reply', { placeholder: 'reply to ' + bbsShortHost(o.from) + '…' });
        break;
      }
      case 'bulletins':
        void (async () => {
          try { const b = await api('/api/friends/bbs/bulletins'); BBS_UI.bulletins = (b && b.bulletins) || []; } catch {}
          goto('bulletins');
        })();
        break;
      case 'bulletin-read': BBS_UI.bulletinId = arg; goto('bulletin'); break;
      case 'bulletin-new': openPrompt('bulletin-title', { placeholder: 'bulletin title…' }); break;
      case 'bulletin-del': {
        if (!BBS_UI.bulletinId) break;
        void (async () => {
          try {
            await postJson('/api/friends/bbs/bulletins/' + encodeURIComponent(BBS_UI.bulletinId) + '/delete', {});
            const b = await api('/api/friends/bbs/bulletins'); BBS_UI.bulletins = (b && b.bulletins) || [];
            BBS_UI.bulletinId = '';
            goto('bulletins');
          } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
        })();
        break;
      }
      case 'search': openPrompt('search', { placeholder: 'search messages…' }); break;
      case 'profile':
        void (async () => {
          try {
            const p = await api('/api/friends/bbs/profile?handle=' + encodeURIComponent(BBS_UI.handle || ''));
            if (p && p.ok) { BBS_UI.profileFull = p; BBS_UI.profile = p.bio || p.name || ''; }
          } catch {}
          goto('profile');
        })();
        break;
      case 'profile-edit': openPrompt('profile-name', { placeholder: 'your display name…' }); break;
      case 'door-fortune': BBS_UI.door = { kind: 'fortune', text: pickFortune() }; goto('fortune'); break;
      case 'door-guess':
        BBS_UI.door = { kind: 'guess', n: 1 + Math.floor(Math.random() * 100), tries: 0, hint: 'the box has thought of a number from 1 to 100', done: false };
        goto('guess');
        openPrompt('guess-num', { placeholder: 'your guess (1-100)…' });
        break;
      case 'door-hangman': {
        const word = HANGMAN_WORDS[Math.floor(Math.random() * HANGMAN_WORDS.length)];
        BBS_UI.door = { kind: 'hangman', word, guessed: '', wrong: 0, wrongLetters: '', done: '' };
        goto('hangman');
        break;
      }
      case 'door-eightball': BBS_UI.door = { kind: 'eightball', question: '', answer: '' }; goto('eightball'); break;
      case 'hang-letter': {
        const d = BBS_UI.door;
        if (!d || d.kind !== 'hangman' || d.done) break;
        const ch = String(arg || '').toUpperCase();
        if (!ch || d.guessed.includes(ch) || d.wrongLetters.includes(ch)) break;
        if (d.word.includes(ch)) {
          d.guessed += ch;
          if (d.word.split('').every(c => d.guessed.includes(c))) d.done = 'win';
        } else {
          d.wrong = (d.wrong || 0) + 1;
          d.wrongLetters = (d.wrongLetters ? d.wrongLetters + ' ' : '') + ch;
          if (d.wrong >= 6) d.done = 'lose';
        }
        draw();
        break;
      }
      case 'delmsg': {
        if (SOCIAL_NODE !== 'self') { $('bbsStatus').textContent = 'remote messages are read-only from here'; break; }
        const posts = currentThreadPosts();
        const idx = Math.max(0, Math.min(BBS_UI.msgIndex, posts.length - 1));
        const p = posts[idx];
        if (!p) break;
        if (BBS_UI.confirmDelete === p.id && Date.now() - (BBS_UI.confirmAt || 0) < 5000) {
          BBS_UI.confirmDelete = '';
          void (async () => {
            try {
              const r = await postJson('/api/friends/bbs/post-delete', { id: p.id });
              $('bbsStatus').textContent = (r && r.ok) ? 'DELETED message ' + (idx + 1) + ' from this thread' : 'FAILED: ' + ((r && r.error) || 'unknown');
            } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
            await refreshSocial();
            if (currentThreadPosts().length === 0) goto('threads');
            else { BBS_UI.msgIndex = Math.min(idx, currentThreadPosts().length - 1); draw(); }
          })();
        } else {
          BBS_UI.confirmDelete = p.id; BBS_UI.confirmAt = Date.now();
          $('bbsStatus').textContent = 'press D again to delete this message';
          draw();
        }
        break;
      }
      case 'search-hit': {
        const [board, tid] = String(arg || '').split('|');
        if (!board) break;
        SOCIAL_BOARD = board;
        if (tid) { SOCIAL_THREAD = tid; BBS_UI.msgIndex = 0; goto('message'); }
        else goto(board === 'shoutbox' ? 'shout' : 'threads');
        break;
      }
      case 'board':
        SOCIAL_BOARD = arg; SOCIAL_THREAD = null; BBS_UI.msgIndex = 0;
        goto(arg === 'shoutbox' ? 'shout' : 'threads');
        break;
      case 'thread': SOCIAL_THREAD = arg; BBS_UI.msgIndex = 0; goto('message'); break;
      case 'file': viewFile(arg); break;
      case 'dialnode': bbsDial(arg); break;
      case 'hangup':
        SOCIAL_NODE = 'self'; SOCIAL_BOARD = 'shoutbox'; SOCIAL_THREAD = null;
        BBS_UI.dialStatus = '';
        goto('menu');
        void refreshSocial();
        break;
      case 'msgnext': BBS_UI.msgIndex++; draw(); break;
      case 'msgprev': BBS_UI.msgIndex = Math.max(0, BBS_UI.msgIndex - 1); draw(); break;
      case 'reply': openPrompt('reply', { placeholder: 'reply to this thread…' }); break;
      case 'newthread': openPrompt('thread-title', { placeholder: 'thread title…' }); break;
      case 'shoutnow': openPrompt('shout', { placeholder: 'shout into the channel…' }); break;
      case 'colabnew': openPrompt('colab', { placeholder: 'describe the task for the mesh…' }); break;
      case 'savefile': openPrompt('file-name', { placeholder: 'file name…' }); break;
      case 'uploadfile':
        if (SOCIAL_NODE !== 'self') { $('bbsStatus').textContent = 'a remote file area is read-only from here'; break; }
        $('bbsUpload')?.click();
        break;
      case 'delfile': {
        if (SOCIAL_NODE !== 'self' || !BBS_UI.file) { $('bbsStatus').textContent = 'a remote file area is read-only from here'; break; }
        const name = BBS_UI.file.name;
        if (BBS_UI.confirmDelete === name && Date.now() - (BBS_UI.confirmAt || 0) < 5000) {
          BBS_UI.confirmDelete = '';
          void (async () => {
            try {
              const r = await postJson('/api/friends/bbs/file-delete', { name });
              $('bbsStatus').textContent = (r && r.ok) ? 'DELETED: ' + name : 'FAILED: ' + ((r && r.error) || 'unknown');
            } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
            BBS_UI.file = null;
            await refreshSocial();
            goto('files');
          })();
        } else {
          BBS_UI.confirmDelete = name; BBS_UI.confirmAt = Date.now();
          $('bbsStatus').textContent = 'press D again to delete ' + name;
          draw();
        }
        break;
      }
      case 'autonomy-toggle': void setBotnet({ enabled: !BOTNET.enabled }); break;
      case 'autonomy-agent': void setBotnet({ agent: (BOTNET.agent === 'vulkan') ? 'atlas' : 'vulkan' }); break;
      case 'back': back(); break;
      case 'quit': goto('welcome'); break;
    }
  }

  // ── the command-bar input (reply / shout / new thread / colab / save file) ──
  function openPrompt(kind, opts) {
    BBS_UI.prompt = Object.assign({ kind }, opts || {});
    const inp = $('bbsInput');
    if (!inp) return;
    inp.value = '';
    // prefill the login handle so Enter → Enter logs straight in
    if (kind === 'login') { try { inp.value = localStorage.getItem('bbsHandle') || ''; } catch {} }
    else if (kind === 'profile-name') { inp.value = (BBS_UI.profileFull && BBS_UI.profileFull.name) || ''; }
    else if (kind === 'profile-bio') { inp.value = (BBS_UI.profileFull && BBS_UI.profileFull.bio) || ''; }
    inp.placeholder = (opts && opts.placeholder) || '>';
    $('bbsCommand').classList.add('prompting');
    draw();          // render the prompt line immediately
    inp.focus();
  }
  function cancelPrompt() {
    BBS_UI.prompt = null;
    $('bbsCommand').classList.remove('prompting');
    $('bbsInput').value = '';
    const inp = $('bbsInput'); if (inp) inp.blur();
    draw();
  }
  async function handlePromptSubmit() {
    const p = BBS_UI.prompt;
    if (!p) return;
    const text = ($('bbsInput').value || '').trim();
    if (!text) { cancelPrompt(); return; }
    BBS_UI.prompt = null;
    $('bbsCommand').classList.remove('prompting');
    $('bbsInput').value = '';
    const _inp = $('bbsInput'); if (_inp) _inp.blur();
    switch (p.kind) {
      case 'login': {
        const handle = text.slice(0, 24);
        BBS_UI.handle = handle;
        try {
          localStorage.setItem('bbsHandle', handle);
          let n = parseInt(localStorage.getItem('bbsCallerN') || '0', 10);
          if (!isFinite(n)) n = 0;
          BBS_UI.callerN = n + 1;
          localStorage.setItem('bbsCallerN', String(BBS_UI.callerN));
          const callers = JSON.parse(localStorage.getItem('bbsCallers') || '[]');
          callers.unshift({ handle, when: new Date().toISOString() });
          callers.splice(20);
          localStorage.setItem('bbsCallers', JSON.stringify(callers));
        } catch {}
        try { const pr = await api('/api/friends/bbs/profile?handle=' + encodeURIComponent(handle)); if (pr && pr.ok) { BBS_UI.profileFull = pr; BBS_UI.profile = pr.bio || pr.name || ''; } } catch {}
        goto('welcome');
        break;
      }
      case 'shout': await bbsPost(text, {}); break;
      case 'profile-name':
        BBS_UI.profileFull = BBS_UI.profileFull || {};
        BBS_UI.profileFull.name = text.slice(0, 60);
        openPrompt('profile-bio', { placeholder: 'a line about you…' });
        return;
      case 'profile-bio': {
        BBS_UI.profileFull = BBS_UI.profileFull || {};
        BBS_UI.profileFull.bio = text.slice(0, 280);
        try {
          const r = await postJson('/api/friends/bbs/profile', { handle: BBS_UI.handle || 'guest', name: BBS_UI.profileFull.name, bio: BBS_UI.profileFull.bio });
          if (r && r.ok) { BBS_UI.profileFull = r; BBS_UI.profile = r.bio || r.name || ''; $('bbsStatus').textContent = 'PROFILE SAVED'; }
          else $('bbsStatus').textContent = 'PROFILE FAILED: ' + ((r && r.error) || 'unknown');
        } catch (e) { $('bbsStatus').textContent = 'PROFILE FAILED: ' + e.message; }
        goto('profile');
        return;
      }
      case 'reply': if (SOCIAL_THREAD) await bbsPost(text, { thread_id: SOCIAL_THREAD }); break;
      case 'thread-title':
        BBS_UI.threadTitle = text.slice(0, 120);
        openPrompt('thread-body', { placeholder: 'first post…' });
        return;
      case 'thread-body':
        await bbsPost(text, { title: BBS_UI.threadTitle });
        BBS_UI.threadTitle = '';
        break;
      case 'bulletin-title':
        BBS_UI.threadTitle = text.slice(0, 120); // reuse the scratch field for the title
        openPrompt('bulletin-body', { placeholder: 'bulletin text…' });
        return;
      case 'bulletin-body':
        await postJson('/api/friends/bbs/bulletins', { title: BBS_UI.threadTitle, body: text });
        BBS_UI.threadTitle = '';
        try { const b = await api('/api/friends/bbs/bulletins'); BBS_UI.bulletins = (b && b.bulletins) || []; } catch {}
        goto('bulletins');
        return;
      case 'dm-reply': {
        const o = BBS_UI.mailOpen || {};
        try {
          const r = await postJson('/api/friends/dm', { hostname: o.from, message: text });
          $('bbsStatus').textContent = (r && r.ok) ? 'DM SENT to ' + bbsShortHost(o.from) : 'FAILED: ' + ((r && r.error) || 'unknown');
        } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
        goto('mail');
        return;
      }
      case 'mention-reply': {
        const o = BBS_UI.mailOpen || {};
        try {
          const r = await postJson('/api/friends/bbs/new', { board: o.board, thread_id: o.thread_id, body: text });
          $('bbsStatus').textContent = (r && r.ok) ? 'REPLY POSTED to ' + bbsShortHost(o.from) : 'FAILED: ' + ((r && r.error) || 'unknown');
        } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
        await refreshSocial();
        goto('mail');
        return;
      }
      case 'colab':
        startColab(text.slice(0, 2000));
        return; // the colab screen shows the run live
      case 'file-name':
        BBS_UI.saveFileName = text.slice(0, 120);
        openPrompt('file-body', { placeholder: 'contents of the file…' });
        return;
      case 'file-body':
        await saveFile(BBS_UI.saveFileName || 'note.txt', text);
        BBS_UI.saveFileName = '';
        break;
      case 'guess-num': {
        const d = BBS_UI.door || {};
        const g = parseInt(text, 10);
        if (isNaN(g) || g < 1 || g > 100) { d.hint = 'a number from 1 to 100, caller — try again'; }
        else {
          d.tries = (d.tries || 0) + 1;
          if (g === d.n) d.done = true;
          else d.hint = g < d.n
            ? g + ' is TOO LOW — the box hums at a higher frequency'
            : g + ' is TOO HIGH — come down a little';
        }
        draw();
        if (!d.done && SCREEN === 'guess') { openPrompt('guess-num', { placeholder: 'your guess (1-100)…' }); return; }
        break;
      }
      case 'eightball': {
        BBS_UI.door = { kind: 'eightball', question: text.slice(0, 140), answer: EIGHTBALL_ANSWERS[Math.floor(Math.random() * EIGHTBALL_ANSWERS.length)] };
        break;
      }
      case 'search': {
        const term = text.toLowerCase().slice(0, 80);
        BBS_UI.searchTerm = text.slice(0, 80);
        const threads = SOCIAL.threads || [];
        const hits = [];
        for (const p of (SOCIAL.posts || [])) {
          if (!(p.body || '').toLowerCase().includes(term)) continue;
          if (hits.some(h => h.thread_id && h.thread_id === p.thread_id)) continue;
          const t = threads.find(x => x.id === p.thread_id);
          const pos = p.body.toLowerCase().indexOf(term);
          hits.push({
            board: p.board, thread_id: p.thread_id || '',
            title: t ? t.title : (p.board === 'shoutbox' ? '(shoutbox)' : p.board),
            excerpt: String(p.body).replace(/\s+/g, ' ').slice(Math.max(0, pos - 6), pos + 30),
          });
          if (hits.length >= 9) break;
        }
        BBS_UI.search = hits;
        goto('search');
        return;
      }
    }
    draw();
  }

  // one global keydown — maps keys by screen; never fires while the command
  // input is open or the social view is not on screen
  function onBbsKey(e) {
    if (STATE.currentView !== 'social') return;
    if (BBS_UI.prompt) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (SCREEN === 'welcome') { goto('menu'); e.preventDefault(); return; }
    if (SCREEN === 'logoff') { goto('connect'); e.preventDefault(); return; }
    if (SCREEN === 'connect') {
      if (k === 'Enter') { openPrompt('login', { placeholder: 'your handle…' }); e.preventDefault(); }
      return;
    }
    // lightbar navigation — arrows move the highlight on any list screen, and
    // double as next/prev while reading a message
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Home' || k === 'End') {
      if (SCREEN === 'message') {
        if (k === 'ArrowDown') runAct('msgnext');
        else if (k === 'ArrowUp') runAct('msgprev');
        e.preventDefault();
        return;
      }
      const items = BBS_UI.items || [];
      if (items.length) {
        const cols = (SCREEN === 'menu' || SCREEN === 'conferences') ? 3 : 1; // 3-column card grids
        if (k === 'ArrowUp') BBS_UI.barIdx = (BBS_UI.barIdx - cols + items.length) % items.length;
        else if (k === 'ArrowDown') BBS_UI.barIdx = (BBS_UI.barIdx + cols) % items.length;
        else if (k === 'ArrowLeft') BBS_UI.barIdx = (BBS_UI.barIdx - 1 + items.length) % items.length;
        else if (k === 'ArrowRight') BBS_UI.barIdx = (BBS_UI.barIdx + 1) % items.length;
        else if (k === 'Home') BBS_UI.barIdx = 0;
        else if (k === 'End') BBS_UI.barIdx = items.length - 1;
        draw(); e.preventDefault();
      }
      return;
    }
    // Enter selects the highlighted item on list screens
    if (k === 'Enter' && ['menu', 'conferences', 'threads', 'files', 'online', 'callers', 'dial', 'doors', 'search', 'bulletins', 'mail'].includes(SCREEN)) {
      const items = BBS_UI.items || [];
      if (items.length) { const it = items[BBS_UI.barIdx] || items[0]; runAct(it.act, it.arg); e.preventDefault(); }
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const it = (BBS_UI.items || [])[Number(k) - 1];
      if (it) { runAct(it.act, it.arg); e.preventDefault(); }
      return;
    }
    const key = String(k).toLowerCase();
    if (SCREEN === 'menu') {
      if (key === 'a') { goto('autonomy'); e.preventDefault(); }
      else if (key === 'c') { cycleTheme(1); draw(); e.preventDefault(); }
      else if (key === 'b') { BBS_UI.animate = !BBS_UI.animate; $('bbsStatus').textContent = 'BAUD DRAW: ' + (BBS_UI.animate ? 'ON' : 'OFF'); draw(); e.preventDefault(); }
      else if (key === 'q') { goto('logoff'); e.preventDefault(); }
      return;
    }
    if (key === 'q' || key === 'escape' || key === 'backspace') { back(); e.preventDefault(); return; }
    if (SCREEN === 'shout' && (key === 'r' || key === 'enter')) { runAct('shoutnow'); e.preventDefault(); return; }
    if (SCREEN === 'threads' && key === 'n') { runAct('newthread'); e.preventDefault(); return; }
    if (SCREEN === 'message') {
      if (key === 'r') { runAct('reply'); e.preventDefault(); }
      else if (key === 'n') { runAct('msgnext'); e.preventDefault(); }
      else if (key === 'p') { runAct('msgprev'); e.preventDefault(); }
      else if (key === 'd') { runAct('delmsg'); e.preventDefault(); }
      return;
    }
    if (SCREEN === 'files' && key === 's') { runAct('savefile'); e.preventDefault(); return; }
    if (SCREEN === 'files' && key === 'u') { runAct('uploadfile'); e.preventDefault(); return; }
    if (SCREEN === 'file' && key === 'd') { runAct('delfile'); e.preventDefault(); return; }
    if (SCREEN === 'file' && key === 'i') { runAct('door-install'); e.preventDefault(); return; }
    if (SCREEN === 'colab' && (key === 't' || key === 'enter')) { runAct('colabnew'); e.preventDefault(); return; }
    if (SCREEN === 'fortune' && (key === 'r' || key === 'enter')) { runAct('door-fortune'); e.preventDefault(); return; }
    if (SCREEN === 'guess' && key === 'n') { runAct('door-guess'); e.preventDefault(); return; }
    if (SCREEN === 'hangman') {
      if (key === 'n' && BBS_UI.door && BBS_UI.door.done) { runAct('door-hangman'); e.preventDefault(); return; }
      if (/^[a-z]$/.test(key)) { runAct('hang-letter', key); e.preventDefault(); }
      return;
    }
    if (SCREEN === 'eightball' && key === 's') { openPrompt('eightball', { placeholder: 'ask the ball…' }); e.preventDefault(); return; }
    if (SCREEN === 'search' && key === 'f') { runAct('search'); e.preventDefault(); return; }
    if (SCREEN === 'bulletins' && key === 'n') { runAct('bulletin-new'); e.preventDefault(); return; }
    if (SCREEN === 'bulletin' && key === 'd') { runAct('bulletin-del'); e.preventDefault(); return; }
    if (SCREEN === 'mailread' && key === 'r') { runAct('mail-reply'); e.preventDefault(); return; }
    if (SCREEN === 'profile' && key === 'e') { runAct('profile-edit'); e.preventDefault(); return; }
    if (SCREEN === 'autonomy') {
      if (key === 'e') { runAct('autonomy-toggle'); e.preventDefault(); }
      else if (key === 'a') { runAct('autonomy-agent'); e.preventDefault(); }
      return;
    }
  }

  async function bbsPost(bodyText, opts) {
    opts = opts || {};
    const board = opts.board || SOCIAL_BOARD;
    try {
      let r;
      if (SOCIAL_NODE === 'self') {
        r = await postJson('/api/friends/bbs/new', Object.assign({ board: board, body: bodyText }, opts));
      } else {
        r = await postJson('/api/friends/bbs/dial/' + encodeURIComponent(SOCIAL_NODE) + '/post', Object.assign({ board: board, body: bodyText }, opts));
      }
      if (r && r.ok) {
        $('bbsStatus').textContent = 'POSTED to ' + bbsShortHost(r.host || SOCIAL_NODE);
      } else {
        $('bbsStatus').textContent = 'FAILED: ' + ((r && r.error) || 'unknown');
      }
    } catch (e) {
      $('bbsStatus').textContent = 'FAILED: ' + e.message;
    }
    await refreshSocial();
  }

  async function bbsDial(node) {
    const target = (SOCIAL.systems || []).find(s => (node === 'self' && s.self) || s.hostname === node);
    const offline = node !== 'self' && target && target.status !== 'online';
    SOCIAL_NODE = node;
    SOCIAL_BOARD = 'shoutbox';
    SOCIAL_THREAD = null;
    BBS_UI.msgIndex = 0;
    BBS_UI.dialStatus = '';
    if (offline) {
      BBS_UI.dialStatus = 'NO CARRIER — ' + bbsShortHost(node) + ' is not answering';
      $('bbsStatus').textContent = 'NO CARRIER';
      goto('dial');
      return;
    }
    $('bbsStatus').textContent = node === 'self' ? 'ONLINE' : 'DIALING ' + bbsShortHost(node) + '…';
    await refreshSocial();
    if (SOCIAL.online === false) {
      BBS_UI.dialStatus = 'NO CARRIER — ' + bbsShortHost(node) + ' dropped the line';
      goto('dial');
    } else {
      goto('shout');
    }
  }

  async function viewFile(name) {
    try {
      const d = (SOCIAL_NODE === 'self')
        ? await api('/api/friends/bbs/file/' + encodeURIComponent(name))
        : await api('/api/friends/bbs/dial/' + encodeURIComponent(SOCIAL_NODE) + '/file/' + encodeURIComponent(name));
      if (d && d.ok) {
        let content = d.content || '';
        // binary upload shown as bytes note, not mojibake on the tube
        if (content.slice(0, 2048).includes('')) content = '[ binary file — ' + content.length + ' bytes — not shown on the tube ]';
        BBS_UI.file = { name, content };
        $('bbsStatus').textContent = 'FILE: ' + name;
        goto('file');
      } else {
        $('bbsStatus').textContent = 'FAILED: ' + ((d && d.error) || 'unknown');
      }
    } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
  }

  async function saveFile(name, content) {
    try {
      const r = await postJson('/api/friends/bbs/file-save', { name, content });
      if (r && r.ok) $('bbsStatus').textContent = 'SAVED: ' + (r.name || name);
      else $('bbsStatus').textContent = 'FAILED: ' + ((r && r.error) || 'unknown');
    } catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
    await refreshSocial();
    goto('files');
  }

  // Colab run: POST only STARTS the swarm (it runs for minutes) — poll the
  // status endpoint for the live ledger: planner phase, per-worker states,
  // the filed report. The host also mirrors the run as a Warden project.
  let colabPollTimer = null;
  async function pollColab() {
    try {
      const st = await api('/api/friends/colab/status');
      if (!st || !st.ok) return;
      BBS_UI.colabStatus = st;
      BBS_UI.colabBusy = !!st.busy;
      if (st.busy && !colabPollTimer) colabPollTimer = setInterval(pollColab, 2000);
      if (!st.busy && (st.phase === 'done' || st.phase === 'error')) {
        if (colabPollTimer) { clearInterval(colabPollTimer); colabPollTimer = null; }
        await refreshSocial(); // the new artifact lands in the file areas
      }
      if (STATE.currentView === 'social') draw();
    } catch { /* transient — the next poll catches up */ }
  }
  async function startColab(task) {
    try {
      const r = await postJson('/api/friends/colab', { task });
      if (!r || !r.ok) {
        BBS_UI.colabBusy = false;
        BBS_UI.colabStatus = { phase: 'error', busy: false, task, error: (r && r.error) || 'could not start the swarm', workers: [] };
        draw();
        return;
      }
      BBS_UI.colabBusy = true;
      BBS_UI.colabStatus = { phase: 'organizing', busy: true, task, workers: [] };
      draw();
      void pollColab();
    } catch (e) {
      BBS_UI.colabBusy = false;
      BBS_UI.colabStatus = { phase: 'error', busy: false, task, error: e.message, workers: [] };
      draw();
    }
  }

  // BotNet autonomy — which specialist runs the idle sweep, and whether it runs at all.
  let BOTNET = { enabled: true, agent: 'atlas' };
  async function loadBotnet() {
    try { BOTNET = await api('/api/friends/botnet'); } catch {}
    if (STATE.currentView === 'social') draw();
  }
  async function setBotnet(patch) {
    try { BOTNET = await postJson('/api/friends/botnet', patch); }
    catch (e) { $('bbsStatus').textContent = 'FAILED: ' + e.message; }
    draw();
  }

  function renderAccounts() {
    const oauthActions = $('oauthActions');
    const oauthList = $('oauthList');
    const channelsList = $('channelsList');
    const imapList = $('imapList');
    const keyList = $('apiKeyList');

    oauthActions.innerHTML = '';
    oauthList.innerHTML = '';
    channelsList.innerHTML = '';

    const gCfg = ACCOUNTS.oauthConfigured.google;
    const mCfg = ACCOUNTS.oauthConfigured.microsoft;
    oauthActions.innerHTML =
      '<button class="btn btn-secondary btn-sm" ' + (gCfg ? '' : 'disabled title="Not configured"') + ' id="btnConnectGoogle">Connect Google</button>' +
      '<button class="btn btn-secondary btn-sm" ' + (mCfg ? '' : 'disabled title="Not configured"') + ' id="btnConnectMicrosoft">Connect Microsoft</button>';
    const gBtn = $('btnConnectGoogle');
    const mBtn = $('btnConnectMicrosoft');
    if (gBtn && gCfg) gBtn.addEventListener('click', () => startOAuthConnect('google'));
    if (mBtn && mCfg) mBtn.addEventListener('click', () => startOAuthConnect('microsoft'));

    if (!ACCOUNTS.oauth.length) {
      oauthList.innerHTML = '<div class="account-empty">No connected accounts.</div>';
    } else {
      oauthList.innerHTML = ACCOUNTS.oauth.map(a => {
        const feats = [];
        if (a.calendar_enabled) feats.push('Calendar');
        if (a.email_enabled) feats.push('Email');
        return '<div class="account-card" data-oauth-id="' + escAttr(a.id) + '" data-provider="' + escAttr(a.provider) + '" data-readonly="true">' +
          '<span class="badge ' + esc(a.provider) + '">' + (a.provider === 'google' ? 'G' : 'M') + '</span>' +
          '<div class="info"><div class="line">' + esc(a.email || a.provider) + '</div>' +
          '<div class="meta">' + (feats.join(' · ') || 'No features') + ' · ' + (a.enabled === 0 ? 'Expired' : 'Active') + '</div></div>' +
          '<div class="actions">' +
            '<label class="toggle"><input type="checkbox" data-field="email_enabled" ' + (a.email_enabled ? 'checked' : '') + '> Email</label>' +
            '<label class="toggle"><input type="checkbox" data-field="calendar_enabled" ' + (a.calendar_enabled ? 'checked' : '') + '> Cal</label>' +
            '<button class="btn btn-ghost btn-sm btn-oauth-calendars">Calendars</button>' +
            '<button class="btn btn-danger btn-sm btn-oauth-disconnect">Disconnect</button>' +
          '</div></div>';
      }).join('');
      qsa('.account-card', oauthList).forEach(card => {
        const id = card.dataset.oauthId;
        card.querySelectorAll('input[data-field]').forEach(cb => {
          cb.addEventListener('change', async () => {
            const body = {}; body[cb.dataset.field] = cb.checked ? 1 : 0;
            try { await patchJson('/api/oauth/accounts/' + encodeURIComponent(id), body); toast('Updated', 'success'); await refreshAccounts(); }
            catch (e) { toast('Failed: ' + e.message, 'error'); }
          });
        });
        card.querySelector('.btn-oauth-calendars').addEventListener('click', async () => {
          await showCalendarToggles(id);
        });
        card.querySelector('.btn-oauth-disconnect').addEventListener('click', async () => {
          if (!confirm('Disconnect this account?')) return;
          try { await del('/api/oauth/accounts/' + encodeURIComponent(id)); toast('Disconnected', 'success'); await refreshAccounts(); }
          catch (e) { toast('Failed: ' + e.message, 'error'); }
        });
      });
    }

    const labels = { telegram: 'Telegram', whatsapp: 'WhatsApp', slack: 'Slack' };
    const icons = { telegram: '🔵', whatsapp: '🟢', slack: '🔴' };
    channelsList.innerHTML = ['telegram', 'whatsapp', 'slack'].map(type => {
      const ch = ACCOUNTS.channels.find(c => c.type === type);
      const configured = !!ch?.configured;
      const connected = !!ch?.connected;
      const meta = [];
      if (type === 'telegram' && ch?.chatId) meta.push('chat ' + esc(ch.chatId));
      if (type === 'slack' && ch?.channelId) meta.push('channel ' + esc(ch.channelId));
      if (configured) meta.push(connected ? 'connected' : 'disconnected');
      else meta.push('not configured');
      return '<div class="account-card" data-channel-type="' + escAttr(type) + '">' +
        '<span class="badge">' + (icons[type] || '?') + '</span>' +
        '<div class="info"><div class="line">' + esc(labels[type]) + '</div>' +
        '<div class="meta">' + meta.join(' · ') + '</div></div>' +
        '<div class="actions">' +
          (configured ? '<button class="btn btn-danger btn-sm btn-channel-disconnect" style="margin-right:6px">Disconnect</button>' : '') +
          '<button class="btn btn-ghost btn-sm btn-channel-config">' + (configured ? 'Edit' : 'Connect') + '</button>' +
        '</div></div>';
    }).join('');
    qsa('.account-card', channelsList).forEach(card => {
      const type = card.dataset.channelType;
      card.querySelector('.btn-channel-config').addEventListener('click', () => openChannelDrawer(type));
      const disc = card.querySelector('.btn-channel-disconnect');
      if (disc) disc.addEventListener('click', () => disconnectChannel(type));
    });

    if (!ACCOUNTS.imap.length) {
      imapList.innerHTML = '<div class="account-empty">No IMAP/SMTP accounts.</div>';
    } else {
      imapList.innerHTML = ACCOUNTS.imap.map(a => {
        return '<div class="account-card" data-imap-id="' + escAttr(a.id) + '" data-readonly="' + (a.read_only ? 'true' : 'false') + '" data-name="' + escAttr(a.name) + '" data-email="' + escAttr(a.email) + '" data-imap-host="' + escAttr(a.imap_host) + '" data-imap-port="' + escAttr(a.imap_port || '') + '" data-smtp-host="' + escAttr(a.smtp_host) + '" data-smtp-port="' + escAttr(a.smtp_port || '') + '" data-username="' + escAttr(a.username) + '" data-use-tls="' + (a.use_tls ? 'true' : 'false') + '" data-enabled="' + (a.enabled ? 'true' : 'false') + '" data-outbound-guard="' + (a.outbound_guard ? 'true' : 'false') + '" data-outbound-allowlist="' + escAttr(a.outbound_allowlist || '') + '" data-outbound-max-recipients="' + escAttr(String(a.outbound_max_recipients || 0)) + '" data-password="">' +
          '<span class="badge">@</span>' +
          '<div class="info"><div class="line">' + esc(a.name || a.email) + '</div>' +
          '<div class="meta">' + esc(a.email) + ' · IMAP ' + esc(a.imap_host) + ' · ' + (a.read_only ? 'Read only' : 'Send enabled') + '</div></div>' +
          '<div class="actions">' +
            '<button class="btn btn-ghost btn-sm btn-imap-edit">Edit</button>' +
            '<button class="btn btn-danger btn-sm btn-imap-delete">Delete</button>' +
          '</div></div>';
      }).join('');
      qsa('.account-card', imapList).forEach(card => {
        const id = card.dataset.imapId;
        card.querySelector('.btn-imap-edit').addEventListener('click', () => openImapDrawer(id, card.dataset));
        card.querySelector('.btn-imap-delete').addEventListener('click', async () => {
          if (!confirm('Delete this email account?')) return;
          try { await del('/api/email/accounts/' + encodeURIComponent(id)); toast('Deleted', 'success'); await refreshAccounts(); }
          catch (e) { toast('Failed: ' + e.message, 'error'); }
        });
      });
    }

    if (!ACCOUNTS.keys.length) {
      keyList.innerHTML = '<div class="account-empty">No API keys stored.</div>';
    } else {
      keyList.innerHTML = ACCOUNTS.keys.map(k => {
        return '<div class="account-card">' +
          '<span class="badge">🔑</span>' +
          '<div class="info"><div class="line">' + esc(k.name) + '</div>' +
          '<div class="meta">' + esc(k.type) + ' · ' + esc(k.masked || '••••') + '</div></div>' +
          '<div class="actions"><button class="btn btn-danger btn-sm" data-key-id="' + escAttr(k.id) + '" data-key-name="' + escAttr(k.name) + '" onclick="Warden.deleteApiKey(this.dataset.keyId, this.dataset.keyName)">Delete</button></div>' +
          '</div>';
      }).join('');
    }
  }

  function openChannelDrawer(type) {
    const ch = ACCOUNTS.channels.find(c => c.type === type);
    let html = '';
    if (type === 'telegram') {
      html = '<div class="drawer-form">' +
        '<p class="dim" style="font-size:11px;margin-bottom:10px">1. Message @BotFather on Telegram, send /newbot, and copy the API token. 2. Paste it below and click Connect. 3. Send /start to your bot on Telegram to pair.</p>' +
        '<label>Bot token</label><input type="password" class="input" id="chToken" value="" placeholder="123456:ABC...">' +
        '<label>Chat ID</label><input class="input" id="chChatId" value="' + escAttr(ch?.chatId || '') + '" placeholder="e.g. 6579797280">' +
        '<p class="dim" style="font-size:11px;margin:4px 0">The chat the bot listens on. Add the bot to a group and /start there — it replies with that chat\'s id to paste here. Leave the token blank to keep the current one.</p>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" id="btnSaveChannel">Connect</button></div>' +
      '</div>';
    } else if (type === 'slack') {
      html = '<div class="drawer-form">' +
        '<p class="dim" style="font-size:11px;margin-bottom:10px">1. Create a Slack app at api.slack.com/apps. 2. Add scopes: chat:write, channels:history, channels:read, groups:history, groups:read. 3. Install to workspace and copy the Bot User OAuth Token. 4. Invite the bot to a channel.</p>' +
        '<label>Bot token</label><input type="password" class="input" id="chToken" value="" placeholder="xoxb-...">' +
        '<label>Channel ID</label><input class="input" id="chChannelId" value="' + escAttr(ch?.channelId || '') + '" placeholder="C1234567890">' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" id="btnSaveChannel">Connect</button></div>' +
      '</div>';
    } else if (type === 'whatsapp') {
      html = '<div class="drawer-form">' +
        '<p class="dim" style="font-size:11px;margin-bottom:10px">Click Connect to generate a QR code. Scan it with WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device.</p>' +
        '<div id="waQrBox" style="text-align:center;padding:12px"><button class="btn btn-primary btn-sm" id="btnWaConnect">Generate QR</button></div>' +
      '</div>';
    }
    openDrawer((type === 'telegram' ? 'Telegram' : type === 'slack' ? 'Slack' : 'WhatsApp') + ' Channel', html);
    if (type === 'whatsapp') {
      $('btnWaConnect').addEventListener('click', () => startWhatsAppQr());
    } else {
      $('btnSaveChannel').addEventListener('click', () => saveChannel(type));
    }
  }

  async function saveChannel(type) {
    const token = $('chToken').value.trim();
    const body = {};
    if (token) body.token = token;
    if (type === 'telegram') {
      const chatId = $('chChatId')?.value?.trim();
      if (chatId) body.chatId = chatId;
    }
    if (type === 'slack') body.channelId = $('chChannelId').value.trim();
    // Telegram: allow editing just the Chat ID without re-entering the bot token.
    if (!body.token && !(type === 'telegram' && body.chatId)) {
      toast('Token required', 'warn'); return;
    }
    try {
      const d = await postJson('/api/channels/' + type, body);
      if (d.ok) { toast(type + ' connected', 'success'); closeDrawer(); await refreshAccounts(); }
      else { toast(type + ' connection failed', 'error'); }
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function startWhatsAppQr() {
    const box = $('waQrBox');
    box.innerHTML = '<div class="dim" style="font-size:12px">Generating QR code...</div>';
    try {
      await postJson('/api/channels/whatsapp', {});
    } catch (e) { toast('Failed: ' + e.message, 'error'); box.innerHTML = '<div class="dim" style="color:var(--danger)">Failed to start WhatsApp.</div>'; return; }
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts++;
      if (attempts > 60) { clearInterval(timer); box.innerHTML = '<div class="dim" style="color:var(--danger)">QR expired. Try again.</div>'; return; }
      try {
        const d = await api('/api/channels/whatsapp/qr');
        if (d.connected) { clearInterval(timer); toast('WhatsApp connected', 'success'); closeDrawer(); await refreshAccounts(); return; }
        if (d.failed) { clearInterval(timer); box.innerHTML = '<div class="dim" style="color:var(--danger)">QR expired. Try again.</div><button class="btn btn-primary btn-sm" id="btnWaRetry" style="margin-top:8px">Retry</button>'; $('btnWaRetry').addEventListener('click', startWhatsAppQr); return; }
        if (d.qr) {
          box.innerHTML = '<div style="font-size:12px;margin-bottom:8px">Scan with WhatsApp:</div>' +
            '<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=' + encodeURIComponent(d.qr) + '" style="border-radius:8px" alt="QR">' +
            '<div style="font-size:10px;margin-top:6px;color:var(--text-faint)">WhatsApp &gt; Settings &gt; Linked Devices &gt; Link a Device</div>';
        }
      } catch { /* ignore */ }
    }, 2000);
  }

  async function disconnectChannel(type) {
    if (!confirm('Disconnect ' + type + '? This removes the saved token/session.')) return;
    try {
      await del('/api/channels/' + encodeURIComponent(type));
      toast(type + ' disconnected', 'success');
      await refreshAccounts();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  function startOAuthConnect(provider) {
    const name = provider === 'microsoft' ? 'Microsoft' : 'Google';
    const readOnly = !confirm('Allow ' + name + ' send access?\n\nOK = read-only (sending disabled)\nCancel = allow sending');
    const url = '/api/oauth/start?provider=' + encodeURIComponent(provider) + '&userId=owner&read_only=' + readOnly;
    const popup = window.open(url, 'oauth', 'width=500,height=700');
    function onMessage(e) {
      if (e.data && e.data.type === 'oauth-success') {
        window.removeEventListener('message', onMessage);
        toast(name + ' account connected', 'success');
        refreshAccounts();
      }
    }
    window.addEventListener('message', onMessage);
    setTimeout(() => {
      if (!popup || popup.closed) { window.open(url); }
    }, 1000);
  }

  function openImapDrawer(id, dataset) {
    const isNew = !id;
    const d = dataset || {};
    const title = isNew ? 'Add IMAP/SMTP Account' : 'Edit Account';
    const html = '<div class="drawer-form">' +
      '<div style="margin-bottom:10px"><button class="btn btn-ghost btn-sm" id="btnGmailPreset" type="button">⭐ Pre-fill for Gmail</button></div>' +
      '<label>Name</label><input class="input" id="imapName" value="' + escAttr(d.name || '') + '" placeholder="My Email">' +
      '<label>Email</label><input class="input" id="imapEmail" value="' + escAttr(d.email || '') + '" placeholder="me@example.com">' +
      '<label>IMAP host</label><input class="input" id="imapHost" value="' + escAttr(d.imapHost || '') + '" placeholder="imap.example.com">' +
      '<label>IMAP port</label><input class="input" id="imapPort" value="' + escAttr(d.imapPort || '993') + '" placeholder="993">' +
      '<label>SMTP host</label><input class="input" id="imapSmtpHost" value="' + escAttr(d.smtpHost || '') + '" placeholder="smtp.example.com">' +
      '<label>SMTP port</label><input class="input" id="imapSmtpPort" value="' + escAttr(d.smtpPort || '587') + '" placeholder="587">' +
      '<label>Username</label><input class="input" id="imapUsername" value="' + escAttr(d.username || '') + '" placeholder="me@example.com">' +
      (isNew ? '<label>Password</label><input type="password" class="input" id="imapPassword" placeholder="Required for new account">' : '<label>New password (leave blank to keep)</label><input type="password" class="input" id="imapPassword" placeholder="">') +
      '<label><input type="checkbox" id="imapUseTls" ' + (d.useTls !== 'false' ? 'checked' : '') + '> Use TLS</label>' +
      '<label><input type="checkbox" id="imapReadOnly" ' + (d.readOnly !== 'false' ? 'checked' : '') + '> Read only</label>' +
      '<label style="margin-top:8px"><input type="checkbox" id="imapOutboundGuard" ' + (d.outboundGuard === 'true' ? 'checked' : '') + '> Limit who this account can email</label>' +
      '<label>Allowed recipients (one per line)</label><textarea class="input" id="imapAllowlist" rows="3" placeholder="daughter@example.com&#10;doctor@example.com">' + escAttr(d.outboundAllowlist || '') + '</textarea>' +
      '<label>Max recipients per message (0 = no cap)</label><input class="input" id="imapMaxRecipients" value="' + escAttr(d.outboundMaxRecipients || '0') + '" placeholder="0">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">' +
        (isNew ? '' : '<button class="btn btn-ghost btn-sm" id="btnTestImap">Test</button>') +
        '<button class="btn btn-primary btn-sm" id="btnSaveImap">Save</button>' +
      '</div>' +
      '<div id="imapTestStatus" style="font-size:11px;margin-top:6px"></div>' +
    '</div>';
    openDrawer(title, html);
    $('btnSaveImap').addEventListener('click', () => saveImapAccount(id));
    if (!isNew) $('btnTestImap').addEventListener('click', () => testImapAccount(id));
    const gmailBtn = $('btnGmailPreset');
    if (gmailBtn) gmailBtn.addEventListener('click', () => {
      if (!$('imapName').value.trim()) $('imapName').value = 'Gmail';
      $('imapHost').value = 'imap.gmail.com';
      $('imapPort').value = '993';
      $('imapSmtpHost').value = 'smtp.gmail.com';
      $('imapSmtpPort').value = '465';
      const em = $('imapEmail').value.trim();
      if (em) $('imapUsername').value = em;
      $('imapUseTls').checked = true;
      $('imapReadOnly').checked = false;
      toast('Gmail filled in — paste your app password', 'info');
    });
  }

  async function saveImapAccount(id) {
    const name = $('imapName').value.trim();
    const email = $('imapEmail').value.trim();
    const imap_host = $('imapHost').value.trim();
    const imap_port = parseInt($('imapPort').value, 10) || 993;
    const smtp_host = $('imapSmtpHost').value.trim();
    const smtp_port = parseInt($('imapSmtpPort').value, 10) || 587;
    const username = $('imapUsername').value.trim();
    const password = $('imapPassword').value;
    const use_tls = $('imapUseTls').checked;
    const read_only = $('imapReadOnly').checked;
    const outbound_guard = $('imapOutboundGuard').checked;
    const outbound_allowlist = $('imapAllowlist').value.trim();
    const outbound_max_recipients = parseInt($('imapMaxRecipients').value, 10) || 0;
    if (!name || !email || !imap_host || !smtp_host || !username) { toast('Fill required fields', 'warn'); return; }
    if (!id && !password) { toast('Password required', 'warn'); return; }
    const body = { name, email, imap_host, imap_port, smtp_host, smtp_port, username, use_tls, read_only, outbound_guard, outbound_allowlist, outbound_max_recipients, user_id: 'owner' };
    if (password) body.password = password;
    try {
      if (id) { await putJson('/api/email/accounts/' + encodeURIComponent(id), body); toast('Account updated', 'success'); }
      else { await postJson('/api/email/accounts', body); toast('Account added', 'success'); }
      closeDrawer(); await refreshAccounts();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function testImapAccount(id) {
    const status = $('imapTestStatus');
    status.textContent = 'Testing...'; status.style.color = '';
    try {
      const d = await postJson('/api/email/test', { accountId: id });
      const imapOk = d.imap && d.imap.ok;
      const smtpOk = d.smtp && d.smtp.ok;
      status.textContent = imapOk && smtpOk ? 'IMAP + SMTP connected' : ('IMAP: ' + (d.imap?.error || 'fail') + ' · SMTP: ' + (d.smtp?.error || 'fail'));
      status.style.color = imapOk && smtpOk ? 'var(--ok)' : 'var(--danger)';
    } catch (e) { status.textContent = 'Test failed: ' + e.message; status.style.color = 'var(--danger)'; }
  }

  function openApiKeyDrawer() {
    openDrawer('Add API Key', '<div class="drawer-form">' +
      '<label>Name / Label</label><input class="input" id="keyName" placeholder="OpenAI">' +
      '<label>Type</label><input class="input" id="keyType" placeholder="openai">' +
      '<label>Base URL (optional)</label><input class="input" id="keyBaseUrl" placeholder="https://api.openai.com/v1">' +
      '<label>Default model (optional)</label><input class="input" id="keyModel" placeholder="gpt-4o">' +
      '<label>Key</label><input type="password" class="input" id="keyValue" placeholder="sk-...">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px"><button class="btn btn-primary btn-sm" id="btnSaveApiKey">Save</button></div>' +
    '</div>');
    $('btnSaveApiKey').addEventListener('click', saveApiKey);
  }

  async function saveApiKey() {
    const name = $('keyName').value.trim();
    const type = $('keyType').value.trim() || 'custom';
    const value = $('keyValue').value.trim();
    if (!name || !value) { toast('Name and key required', 'warn'); return; }
    try {
      await postJson('/api/api-keys', { name, type, value, baseUrl: $('keyBaseUrl').value.trim(), defaultModel: $('keyModel').value.trim() });
      toast('API key saved', 'success'); closeDrawer(); await refreshAccounts();
    } catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  async function deleteApiKey(id, name) {
    if (!confirm('Delete API key "' + (name || id) + '"?')) return;
    try { await del('/api/api-keys/' + encodeURIComponent(id)); toast('Deleted', 'success'); await refreshAccounts(); }
    catch (e) { toast('Failed: ' + e.message, 'error'); }
  }

  // ============================================================= Skills
  const CONTAINER_SKILLS = new Set(['scrub', 'agent-browser', 'pdf-reader', 'ollama', 'compact']);

  async function refreshSkills() {
    const grid = $('skillGrid');
    grid.innerHTML = '<div class="dim mono" style="font-size:11px">Loading…</div>';
    try {
      const d = await api('/api/skills');
      const installed = d.installed || {};
      const user = d.user || {};
      const names = Object.keys(installed).sort();
      const userNames = Object.keys(user).sort();
      if (!names.length && !userNames.length) { grid.innerHTML = '<div class="dim mono" style="font-size:11px">No skills reported.</div>'; return; }
      const userCards = userNames.map(n => {
        const en = user[n].enabled;
        return '<div class="skill-card ' + (en ? 'installed' : '') + '" data-skill-toggle="' + escAttr(n) + '" data-enabled="' + (en ? '1' : '0') + '" title="Click to ' + (en ? 'disable' : 'enable') + '" style="cursor:pointer">' +
          '<span class="dot"></span><span class="name" title="' + escAttr(n) + '">' + esc(n) + '</span>' +
          '<span class="state">' + (en ? 'on' : 'off') + '</span>' +
          '<span class="del" data-skill-del="' + escAttr(n) + '" title="Delete skill">×</span></div>';
      }).join('');
      grid.innerHTML = userCards + names.map(n => {
        const ok = installed[n];
        const canDelete = ok && CONTAINER_SKILLS.has(n);
        const delBtn = canDelete
          ? '<span class="del" data-skill-del="' + escAttr(n) + '" title="Delete container skill">×</span>'
          : '';
        return '<div class="skill-card ' + (ok ? 'installed' : '') + '">' +
          '<span class="dot"></span><span class="name" title="' + escAttr(n) + '">' + esc(n) + '</span>' +
          '<span class="state">' + (ok ? 'on' : 'off') + '</span>' + delBtn + '</div>';
      }).join('');
    } catch (e) {
      grid.innerHTML = '<div class="dim mono" style="font-size:11px">Failed: ' + esc(e.message) + '</div>';
    }
  }

  // ============================================================= MCP servers
  async function refreshMcp() {
    const list = $('mcpList');
    if (!list) return;
    list.innerHTML = '<div class="dim mono" style="font-size:11px">Loading…</div>';
    try {
      const d = await api('/api/mcp-servers');
      const servers = d.servers || [];
      if (!servers.length) {
        list.innerHTML = '<div class="dim mono" style="font-size:11px">No MCP servers configured.</div>';
        return;
      }
      list.innerHTML = servers.map(s => {
        const argsStr = (s.args || []).join(' ');
        const meta = esc(s.command) + (argsStr ? ' ' + esc(argsStr) : '');
        const desc = s.description
          ? '<div class="desc">' + esc(s.description) + '</div>'
          : '';
        return '<div class="mcp-row ' + (s.enabled ? '' : 'disabled') + '">' +
          '<label class="mcp-toggle">' +
            '<input type="checkbox" data-mcp-toggle="' + escAttr(s.name) + '"' + (s.enabled ? ' checked' : '') + '>' +
            '<span class="slider"></span>' +
          '</label>' +
          '<div>' +
            '<div class="name">' + esc(s.name) + '</div>' +
            '<div class="meta" title="' + escAttr(meta) + '">' + meta + '</div>' +
            desc +
          '</div>' +
          '<span class="del" data-mcp-del="' + escAttr(s.name) + '" title="Remove server">×</span>' +
          '</div>';
      }).join('');
    } catch (e) {
      list.innerHTML = '<div class="dim mono" style="font-size:11px">Failed: ' + esc(e.message) + '</div>';
    }
  }

  async function mcpToggle(name, enabled) {
    try {
      await patchJson('/api/mcp-servers/' + encodeURIComponent(name), { enabled });
      toast('MCP ' + name + ': ' + (enabled ? 'enabled' : 'disabled'), 'info');
      refreshMcp();
    } catch (e) {
      toast('Toggle failed: ' + e.message, 'error');
      refreshMcp();
    }
  }

  async function mcpDelete(name) {
    if (!confirm('Remove MCP server "' + name + '"?')) return;
    try {
      await del('/api/mcp-servers/' + encodeURIComponent(name));
      toast('Removed ' + name, 'info');
      refreshMcp();
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  }

  async function mcpAddSubmit() {
    const st = $('mcpAddStatus');
    st.textContent = 'saving…'; st.className = 'status mono';
    const name = $('mcpAddName').value.trim();
    const command = $('mcpAddCommand').value.trim();
    const argsRaw = $('mcpAddArgs').value.trim();
    const envRaw = $('mcpAddEnv').value.trim();
    const description = $('mcpAddDesc').value.trim();
    const enabled = $('mcpAddEnabled').checked;
    if (!name || !command) {
      st.textContent = 'name and command required'; st.className = 'status err mono';
      return;
    }
    let env;
    if (envRaw) {
      try { env = JSON.parse(envRaw); }
      catch { st.textContent = 'env must be valid JSON'; st.className = 'status err mono'; return; }
    }
    const args = argsRaw ? argsRaw.split(/\s+/) : [];
    try {
      await postJson('/api/mcp-servers', { name, command, args, env, description, enabled });
      st.textContent = 'added'; st.className = 'status ok mono';
      $('mcpAddName').value = ''; $('mcpAddCommand').value = '';
      $('mcpAddArgs').value = ''; $('mcpAddEnv').value = ''; $('mcpAddDesc').value = '';
      $('mcpAddDetails').open = false;
      refreshMcp();
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err mono';
    }
  }

  async function skillDelete(name) {
    if (!confirm('Delete container skill "' + name + '" (removes SKILL.md)?')) return;
    try {
      await del('/api/skills/' + encodeURIComponent(name));
      toast('Deleted ' + name, 'info');
      refreshSkills();
    } catch (e) {
      toast('Delete failed: ' + e.message, 'error');
    }
  }

  async function skillAddSubmit() {
    const st = $('skillAddStatus');
    st.textContent = 'saving…'; st.className = 'status mono';
    const name = $('skillAddName').value.trim();
    const description = $('skillAddDesc').value.trim();
    const when_to_use = $('skillAddWhen').value.trim();
    const instructions = $('skillAddInstr').value.trim();
    const example_prompt = $('skillAddExample').value.trim();
    if (!name || !description) {
      st.textContent = 'name and description required'; st.className = 'status err mono';
      return;
    }
    try {
      await postJson('/api/skills', { name, description, when_to_use, instructions, example_prompt });
      st.textContent = 'created'; st.className = 'status ok mono';
      $('skillAddName').value = ''; $('skillAddDesc').value = '';
      $('skillAddWhen').value = ''; $('skillAddInstr').value = ''; $('skillAddExample').value = '';
      $('skillAddDetails').open = false;
      refreshSkills();
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.className = 'status err mono';
    }
  }

  // ============================================================= Activity
  async function refreshActivity() {
    const kv = $('liveStatusKv');
    const al = $('activityList');
    const rl = $('recentActivityList');
    try {
      const status = STATE.cachedStatus || await api('/api/status');
      const groups = status.groups || [];
      const kvRows = [
        ['assistant', status.assistant || '—'],
        ['uptime', fmtUptime(status.uptime)],
        ['activeContainers', status.activeContainers],
        ['runningJobs', status.runningJobs],
        ['scheduledTasks', status.scheduledTasks],
        ['cpu', status.system ? status.system.cpuPercent + '%' : '—'],
        ['mem', status.system ? status.system.memPercent + '%' : '—'],
        ['ollama', status.ollamaEnabled ? 'enabled' : 'disabled'],
        ['model mode', status.defaultModelMode || '—'],
      ];
      kv.innerHTML = kvRows.map(([k, v]) => '<div class="k">' + esc(k) + '</div><div class="v mono">' + esc(v) + '</div>').join('');

      // Active agents
      const active = groups.filter(g => g.active && !g.idle);
      if (!active.length) {
        al.innerHTML = '<div class="task-empty">No agents running.</div>';
      } else {
        al.innerHTML = active.map(g =>
          '<div class="activity-item active"><div class="row1">' +
          '<span class="name">' + esc(g.name || g.jid) + '</span>' +
          '<span class="label">' + esc(g.liveLabel || g.livePhase || '') + '</span>' +
          '<span class="ts">' + fmtTime(g.liveTs) + '</span></div>' +
          (g.liveTools && g.liveTools.length ? '<div class="tools">tools: ' + esc(g.liveTools.join(', ')) + '</div>' : '') +
          '</div>'
        ).join('');
      }

      // Recent activity
      try {
        const ad = await api('/api/activity?limit=20');
        const items = ad.items || [];
        if (!items.length) rl.innerHTML = '<div class="task-empty">No recent activity.</div>';
        else rl.innerHTML = items.map(it =>
          '<div class="activity-item"><div class="row1">' +
          '<span class="name">' + esc(it.title || it.type) + '</span>' +
          '<span class="ts">' + fmtTime(it.timestamp) + '</span></div>' +
          '<div class="tools">' + esc((it.detail || '').slice(0, 200)) + '</div></div>'
        ).join('');
      } catch (e) {
        rl.innerHTML = '<div class="task-empty">activity endpoint unavailable</div>';
      }
    } catch (e) {
      kv.innerHTML = ''; al.innerHTML = '<div class="task-empty">' + esc(e.message) + '</div>'; rl.innerHTML = '';
    }
  }

  // ============================================================= MARM Console (embedded)
  // The MARM tab embeds MARM's own Console webapp (its full UI, served on
  // 127.0.0.1:8002 by `marm-memory console`). The Console is loopback-only and
  // its TrustedHostMiddleware rejects non-loopback hosts, so the iframe src is
  // a fixed loopback URL — never location.hostname (which would resolve on the
  // client, not this machine, for a phone/LAN viewer). The status endpoint
  // reports whether this viewer is local, so remote viewers get a plain note
  // instead of a dead iframe.
  function showMarmConsoleFrame() {
    const chip = $('marmHealth'), frame = $('marmConsoleFrame'), fallback = $('marmConsoleFallback');
    const meta = document.querySelector('#view-marm .chat-meta-row');
    chip.textContent = 'ready';
    fallback.style.display = 'none';
    frame.style.display = '';
    if (meta) meta.style.display = 'none';
    if (!frame.getAttribute('src'))
      frame.setAttribute('src', 'http://127.0.0.1:8002/');
  }
  async function refreshMarm() {
    const chip = $('marmHealth'), frame = $('marmConsoleFrame'), fallback = $('marmConsoleFallback');
    const meta = document.querySelector('#view-marm .chat-meta-row');
    if (meta) meta.style.display = '';
    frame.style.display = 'none';
    try {
      const d = await api('/api/marm-console/status');
      if (d.up && d.viewerLocal) { showMarmConsoleFrame(); return; }
      chip.textContent = d.up ? 'desktop-only' : 'offline';
      fallback.style.display = '';
      fallback.textContent = d.up
        ? 'MARM Console is desktop-only — open the dashboard on this machine to use it.'
        : 'MARM Console is not running. Start it with `marm-memory console`.';
    } catch (e) {
      chip.textContent = 'error';
      fallback.style.display = '';
      fallback.textContent = 'Failed: ' + e.message;
    }
  }

  // ============================================================= Security events
  function fmtAbsence(seconds) {
    if (seconds == null) return '';
    const s = Math.round(Number(seconds));
    if (!isFinite(s) || s < 0) return '';
    if (s < 60) return `gone ${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `gone ${m}m${rs ? ' ' + rs + 's' : ''}`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `gone ${h}h${rm ? ' ' + rm + 'm' : ''}`;
  }

  async function refreshSecurity() {
    const el = $('securityList');
    if (!el) return;
    el.innerHTML = '<div class="task-empty">Loading…</div>';
    try {
      const data = await api('/api/oculus/awareness-log?limit=50');
      const rows = data.rows || [];
      if (!rows.length) { el.innerHTML = '<div class="task-empty">No security events yet.</div>'; return; }
      el.innerHTML = rows.map(r => {
        const who = r.label ? esc(r.label) : (r.is_known != null ? (r.is_known ? 'known' : 'unknown') : '');
        const absence = r.event === 'arrival' && r.seconds_empty != null ? ' · ' + esc(fmtAbsence(r.seconds_empty)) : '';
        let extra = '';
        if (r.data) { try { const d = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; if (d && d.person_count != null) extra = 'people: ' + esc(String(d.person_count)); } catch {}
        }
        return '<div class="activity-item"><div class="row1">' +
          '<span class="name">' + esc(r.event || '?') + (who ? ' · ' + who : '') + '</span>' +
          '<span class="ts">' + fmtTime(r.ts) + absence + '</span></div>' +
          (extra ? '<div class="tools">' + extra + '</div>' : '') +
          '</div>';
      }).join('');
    } catch (e) {
      el.innerHTML = '<div class="task-empty">' + esc(e.message) + '</div>';
    }
  }

  async function clearOculusLogs() {
    if (!confirm('Clear all Oculus awareness + security logs on the laptop store?')) return;
    try {
      const d = await api('/api/oculus/logs', { method: 'DELETE' });
      if (!d.ok) { toast(d.error || 'Clear failed', 'error'); return; }
      toast('Oculus logs cleared', 'success');
      refreshSecurity();
    } catch (e) {
      toast(e.message || 'Clear failed', 'error');
    }
  }

  // ============================================================= Process logs
  async function refreshProcessLogs() {
    const el = $('processLogsContent');
    if (!el) return;
    el.textContent = 'Loading…';
    try {
      const d = await api('/api/process-logs?lines=200');
      if (!d.ok) { el.textContent = 'Error: ' + (d.error || 'unknown'); return; }
      el.textContent = (d.lines || []).join('\n') || '(no logs)';
      el.scrollTop = el.scrollHeight;
    } catch (e) {
      el.textContent = 'Failed: ' + e.message;
    }
  }

  // ============================================================= Audit
  function openAuditModal() {
    $('auditModal').classList.add('open');
    refreshAuditStatus();
  }
  function closeAuditModal() {
    $('auditModal').classList.remove('open');
    if (STATE.auditPollTimer) { clearInterval(STATE.auditPollTimer); STATE.auditPollTimer = null; }
  }
  async function startAudit() {
    const st = $('auditStatus');
    st.textContent = 'starting…'; st.style.color = 'var(--warn)';
    try {
      const d = await postJson('/api/audit/run', {});
      if (d.ok) {
        STATE.auditRunning = true;
        st.textContent = 'audit running — 15 to 45 minutes'; st.style.color = 'var(--ok)';
        toast('Audit started', 'success');
        if (!STATE.auditPollTimer) STATE.auditPollTimer = setInterval(refreshAuditStatus, 5000);
        refreshAuditStatus();
      } else {
        st.textContent = d.error || 'failed to start'; st.style.color = 'var(--danger)';
      }
    } catch (e) {
      st.textContent = 'failed: ' + e.message; st.style.color = 'var(--danger)';
    }
  }
  async function refreshAuditStatus() {
    const tail = $('auditLogTail');
    try {
      const d = await api('/api/audit/status');
      STATE.auditRunning = !!d.running;
      tail.textContent = d.tail || '(no audit running)';
      tail.scrollTop = tail.scrollHeight;
      const st = $('auditStatus');
      st.textContent = d.running ? 'audit running…' : (d.tail ? 'audit finished' : 'no audit has been run');
      st.style.color = d.running ? 'var(--warn)' : 'var(--text-faint)';
    } catch (e) {
      tail.textContent = 'Failed: ' + e.message;
    }
  }

  // ============================================================= Training loop
  // audit (parse logs with granite4.2:30b) → modify (write SFT part rows) →
  // train (1 epoch). Each step runs detached server-side; this polls it.
  const TRAINING_BTNS = ['btnTrainingAudit', 'btnTrainingModify', 'btnTrainingTrain'];
  function setTrainingButtons(enabled) {
    TRAINING_BTNS.forEach(id => { const b = $(id); if (b) b.disabled = !enabled; });
    const stop = $('btnTrainingStop');
    if (stop) stop.disabled = enabled; // stop is available exactly when the steps aren't
  }
  async function stopTraining() {
    try {
      const d = await postJson('/api/training/stop', {});
      if (!d.ok) { toast(d.error || 'Stop failed', 'error'); return; }
      toast('Stopped ' + d.stopped, 'info');
      if (STATE.trainingTab === 'bot') refreshBotStatus(); else refreshTrainingStatus();
    } catch (e) {
      toast('Stop failed: ' + e.message, 'error');
    }
  }
  function setTrainingStatus(text, state) {
    const chip = $('trainingStatus');
    if (!chip) return;
    chip.textContent = text;
    chip.dataset.state = state;
  }
  // Highlight the running step's card; otherwise mark the step whose log is shown as "last run".
  function paintTrainingSteps(running, logStep) {
    document.querySelectorAll('#view-training .tr-step').forEach(card => {
      const step = card.dataset.step;
      const st = card.querySelector('[data-role="state"]');
      card.classList.toggle('running', step === running);
      card.classList.toggle('last', !running && step === logStep);
      if (st) st.textContent = step === running ? 'running…' : (!running && step === logStep ? 'last run' : '');
    });
    const ls = $('trainingLogStep');
    if (ls) ls.textContent = logStep ? '· ' + logStep : '';
  }
  async function startTrainingStep(step, body) {
    const tail = $('trainingTail');
    try {
      const d = await postJson('/api/training/' + step, body || {});
      if (!d.ok) {
        tail.textContent = d.error || 'failed to start';
        toast(d.error || 'Failed to start ' + step, 'error');
        return;
      }
      setTrainingStatus(step + ' running', 'running');
      paintTrainingSteps(step, step);
      setTrainingButtons(false);
      if (!STATE.trainingPollTimer) STATE.trainingPollTimer = setInterval(refreshTrainingStatus, 5000);
      refreshTrainingStatus();
    } catch (e) {
      tail.textContent = 'Failed: ' + e.message;
    }
  }
  async function refreshTrainingStatus() {
    const tail = $('trainingTail');
    try {
      const d = await api('/api/training/status');
      const atBottom = tail.scrollHeight - tail.scrollTop - tail.clientHeight < 24;
      tail.textContent = d.tail || '(no step has run yet)';
      if (atBottom || d.running) tail.scrollTop = tail.scrollHeight;
      paintTrainingSteps(d.running, d.step);
      if (d.running) {
        setTrainingStatus(d.running + ' running', 'running');
        setTrainingButtons(false);
      } else {
        if (STATE.trainingPollTimer) { clearInterval(STATE.trainingPollTimer); STATE.trainingPollTimer = null; }
        setTrainingStatus('idle', 'idle');
        setTrainingButtons(true);
        refreshTrainingCatalogs();
      }
    } catch (e) {
      setTrainingStatus('error', 'error');
      tail.textContent = 'Failed: ' + e.message;
    }
  }
  // The Alpha Stack view embeds the stack's OWN webapp (its full UI, served on
  // 127.0.0.1:8765). The webapp is spawned on demand by the server — we just
  // check it's up, start it if not, then load the iframe. The src is set once
  // so re-opening the view doesn't reload the webapp out from under the user.
  // ── Phone (Twilio voice line) ───────────────────────────────────────────
  async function refreshPhone() {
    const pill = $('phone-status-pill');
    if (!pill) return;
    try {
      const d = await api('/api/phone/status');
      if (!d.ok) { pill.textContent = 'error'; pill.style.background = '#331f10'; return; }
      pill.textContent = d.running ? 'running' : 'stopped';
      pill.style.background = d.running ? '#0f331f' : '#331f10';
      $('phone-line').innerHTML =
        (d.number ? `<div style="font-size:14px"><b>${esc(d.number)}</b></div>` : '<div>no Twilio number set</div>') +
        `<div style="margin-top:6px;color:#8b95a5;font-size:11px">public: ${esc(d.publicBase || '—')}</div>`;
      $('phone-voice').textContent =
        `STT  ${d.stt.model || '?'} · ${d.stt.device || '?'} · ${d.stt.language || ''}\n` +
        `TTS  ${d.tts.voice || '?'} · ${d.tts.device || '?'} · ${d.tts.speed || '1.0'}x`;
      $('phone-call').textContent =
        `greeting: ${d.greeting || '—'}\nprompt: ${d.prompt || '—'}\npassphrase: ${d.passphraseSet ? 'set' : 'not set'}`;
      const list = $('phone-calls');
      const calls = d.calls || [];
      if (!calls.length) {
        list.innerHTML = '<div style="color:#666;font-size:12px">No calls recorded yet.</div>';
      } else {
        list.innerHTML = calls.map((c) => `
          <div style="border:1px solid #1c2026;border-radius:8px;padding:8px 10px;font-size:12px;background:#0d1015">
            <div style="color:#8b95a5;font-size:10px;text-transform:uppercase;letter-spacing:.5px">${esc(c.kind)}</div>
            <div style="color:#ddd;margin-top:3px;white-space:pre-wrap;word-break:break-word">${esc(c.text || '')}</div>
          </div>`).join('');
      }
    } catch (e) {
      pill.textContent = 'error';
      pill.style.background = '#331f10';
    }
  }
  async function phoneControl(action) {
    const pill = $('phone-status-pill');
    if (pill) pill.textContent = action + '…';
    try {
      const r = await postJson('/api/phone/control', { action });
      if (!r.ok) { toast(r.error || 'phone control failed', 'error'); }
      await refreshPhone();
    } catch (e) {
      toast('phone control failed: ' + e.message, 'error');
      await refreshPhone();
    }
  }

  // ── Bug Loop (MentaraIQ local-bug-pipeline) ─────────────────────────────
  function showBugloopFrame() {
    const chip = $('bugloopStatus'), frame = $('bugloopFrame'), fallback = $('bugloopFallback');
    chip.textContent = 'ready';
    fallback.style.display = 'none';
    frame.style.display = '';
    if (!frame.getAttribute('src'))
      frame.setAttribute('src', 'http://' + location.hostname + ':4317/');
  }
  // Populate the diagnosis/coding model dropdowns from the LOCAL models Ollama
  // actually has installed (cloud proxies excluded), reflecting the pipeline's
  // current config.json selection.
  async function loadBugloopModels() {
    const diag = $('bugloopDiagnosisModel'), code = $('bugloopCodingModel'), hint = $('bugloopModelHint');
    if (!diag || !code) return;
    try {
      const d = await api('/api/bugloop/models');
      const models = d.models || [];
      const fill = (sel, current) => {
        sel.innerHTML = '';
        if (!models.length) { sel.innerHTML = '<option value="">(no local models)</option>'; return; }
        for (const m of models) {
          const o = document.createElement('option');
          o.value = m; o.textContent = m;
          sel.appendChild(o);
        }
        if (current && models.includes(current)) sel.value = current;
        else if (current) {
          // Config points at a model that isn't installed locally — surface it
          // so the stale value is visible and can be changed.
          const o = document.createElement('option');
          o.value = current; o.textContent = current + ' (not installed)';
          sel.appendChild(o);
          sel.value = current;
        }
      };
      fill(diag, d.diagnosisModel);
      fill(code, d.codingModel);
      if (hint) hint.textContent = models.length ? models.length + ' local models · saved to config.json' : 'no local models';
    } catch (e) {
      if (hint) hint.textContent = 'model list failed: ' + e.message;
    }
  }
  async function saveBugloopModel(which) {
    const sel = $(which);
    if (!sel || !sel.value) return;
    const key = which === 'bugloopDiagnosisModel' ? 'diagnosisModel' : 'codingModel';
    try {
      const r = await postJson('/api/bugloop/config', { [key]: sel.value });
      if (!r.ok) toast(r.error || 'save failed', 'error');
      else toast('saved: ' + key + ' → ' + sel.value);
    } catch (e) {
      toast('save failed: ' + e.message, 'error');
    }
  }
  async function refreshBugloop() {
    const chip = $('bugloopStatus'), fallback = $('bugloopFallback');
    if (!chip) return;
    loadBugloopModels();
    try {
      const d = await api('/api/bugloop/status');
      if (!d.ok) { chip.textContent = 'error'; fallback.style.display = ''; fallback.textContent = d.error || 'unavailable'; return; }
      if (!d.dirPresent) {
        chip.textContent = 'missing';
        fallback.style.display = '';
        fallback.textContent = 'Pipeline directory not found: ' + d.dir;
        return;
      }
      if (d.up) { chip.textContent = d.active ? 'running' : 'up'; showBugloopFrame(); return; }
      chip.textContent = 'stopped';
      fallback.style.display = '';
      fallback.textContent = 'Bug loop is stopped. Click Start to launch the MentaraIQ local-bug-pipeline.';
    } catch (e) {
      chip.textContent = 'error';
      fallback.style.display = '';
      fallback.textContent = 'Failed: ' + e.message;
    }
  }
  async function bugloopControl(action) {
    const chip = $('bugloopStatus');
    if (chip) chip.textContent = action + '…';
    try {
      const r = await postJson('/api/bugloop/' + action, {});
      if (!r.ok) toast(r.error || 'bug loop ' + action + ' failed', 'error');
      await refreshBugloop();
    } catch (e) {
      toast('bug loop ' + action + ' failed: ' + e.message, 'error');
      await refreshBugloop();
    }
  }

  // Newest catalog → stat tiles, class filter pills, expandable failure rows;
  // every catalog → the history list. Filter state survives re-renders.
  const TRAINING_FILTER = { cls: '', q: '' };
  let trainingNewest = null;
  function fmtTrainingTs(ts) {
    const d = ts ? new Date(ts) : null;
    return d && !isNaN(d) ? d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : (ts || '');
  }
  function renderTrainingStats(cat) {
    const el = $('trainingStats');
    if (!cat) { el.innerHTML = '<div class="dim">No catalogs yet — run the audit.</div>'; return; }
    const fails = cat.failures || [];
    const real = fails.filter(f => (f.classification || {}).failure_class !== 'not_a_failure').length;
    const unclassified = (cat.classifiers || {}).unclassified || 0;
    const tile = (k, v, sub, cls) =>
      `<div class="tr-stat ${cls || ''}"><div class="k">${esc(k)}</div><div class="v${typeof v === 'string' && v.length > 8 ? ' sm' : ''}" title="${esc(v)}">${esc(v)}</div>${sub ? `<div class="s" title="${esc(sub)}">${esc(sub)}</div>` : ''}</div>`;
    el.innerHTML =
      tile('Generated', fmtTrainingTs(cat.generated_at), (cat.days ? cat.days + '-day window' : '') + (cat.source ? ' · ' + cat.source : '')) +
      tile('Lines scanned', (cat.log_lines_scanned ?? 0).toLocaleString()) +
      tile('Failure slices', cat.failure_slices_found ?? fails.length, 'detected in logs') +
      tile('Classified', fails.length, real + ' actionable', real ? 'warn' : 'ok') +
      tile('Classifier', (cat.classifiers || {}).model || '—', unclassified ? unclassified + ' unclassified' : '') +
      tile('Status', cat.complete === false ? 'partial' : 'complete', cat.complete === false ? 'audit stopped early' : '', cat.complete === false ? 'warn' : 'ok');
  }
  function renderTrainingFailures() {
    const el = $('trainingCatalogs'), pills = $('trainingClassFilter');
    const fails = (trainingNewest && trainingNewest.failures) || [];
    if (!fails.length) { pills.innerHTML = ''; el.innerHTML = '<div class="dim">No failures in the newest catalog.</div>'; return; }
    const counts = {};
    fails.forEach(f => { const c = (f.classification || {}).failure_class || '?'; counts[c] = (counts[c] || 0) + 1; });
    if (TRAINING_FILTER.cls && !counts[TRAINING_FILTER.cls]) TRAINING_FILTER.cls = '';
    pills.innerHTML = `<span class="tr-class ${TRAINING_FILTER.cls ? '' : 'active'}" data-c="">all <b>${fails.length}</b></span>` +
      Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(c =>
        `<span class="tr-class ${TRAINING_FILTER.cls === c ? 'active' : ''}" data-c="${escAttr(c)}">${esc(c)} <b>${counts[c]}</b></span>`).join('');
    pills.querySelectorAll('.tr-class').forEach(p => p.onclick = () => { TRAINING_FILTER.cls = p.dataset.c; renderTrainingFailures(); });
    const q = TRAINING_FILTER.q.toLowerCase();
    const shown = fails.filter(f => {
      const c = f.classification || {};
      if (TRAINING_FILTER.cls && (c.failure_class || '?') !== TRAINING_FILTER.cls) return false;
      if (!q) return true;
      return [f.id, c.failure_class, c.what_went_wrong, c.correct_behavior, c.sft_correction_hint, c.candidate_role, (c.tools_relevant || []).join(' ')]
        .join(' ').toLowerCase().includes(q);
    });
    if (!shown.length) { el.innerHTML = '<div class="dim">No failures match the filter.</div>'; return; }
    const open = new Set([].map.call(el.querySelectorAll('.tr-fail[open]'), d => d.dataset.id));
    el.innerHTML = shown.map(f => trainingFailRow(f, open)).join('');
  }
  // One collapsible failure row — shared by the catalog list and Artemis flags.
  // extraBadge (optional) is pre-rendered HTML placed after the class badge.
  function trainingFailRow(f, open, extraBadge, meta) {
    const c = f.classification || {};
    const cls = c.failure_class || '?';
    const block = (lbl, txt) => txt ? `<div><div class="lbl">${lbl}</div><p>${esc(txt)}</p></div>` : '';
    const tags = (f.detected_by || []).map(t => `<span class="tr-badge">${esc(t)}</span>`)
      .concat((c.tools_relevant || []).map(t => `<span class="tr-badge" data-c="other">${esc(t)}</span>`)).join('');
    return `<details class="tr-fail" data-id="${escAttr(f.id)}" ${open.has(f.id) ? 'open' : ''}>
      <summary><span class="tr-fail-id">${esc(f.id)}</span><span class="tr-badge" data-c="${escAttr(cls)}">${esc(cls)}</span>${extraBadge || ''}
        <span class="tr-fail-what">${esc(c.what_went_wrong || '(no description)')}</span><span class="tr-fail-role">${esc(c.candidate_role || '')}</span></summary>
      <div class="tr-fail-body">
        ${meta ? `<div class="tr-fail-meta">${meta}</div>` : ''}
        ${block('Correct behavior', c.correct_behavior)}
        ${block('SFT correction hint', c.sft_correction_hint)}
        ${tags ? `<div><div class="lbl">Signals &amp; tools</div><div class="tr-tags">${tags}</div></div>` : ''}
        ${f.log_excerpt ? `<div><div class="lbl">Log excerpt</div><pre class="audit-log">${esc(f.log_excerpt)}</pre></div>` : ''}
      </div></details>`;
  }
  // Artemis-flagged trainable errors (GET /api/training/flags). The section
  // stays hidden when the route is missing (older server) or errors.
  function renderTrainingFlags(d) {
    const el = $('trainingFlaggedErrors');
    if (!el) return;
    const flags = (d && d.ok && Array.isArray(d.flags)) ? d.flags : null;
    if (!flags) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const counts = d.counts || {};
    const pending = counts.pending ?? flags.filter(f => f.status === 'pending').length;
    const consumed = counts.consumed ?? flags.filter(f => f.status === 'consumed').length;
    const open = new Set([].map.call(el.querySelectorAll('.tr-fail[open]'), x => x.dataset.id));
    const rows = flags.map(f => {
      const st = f.status === 'consumed' ? (f.outcome || 'consumed') : 'pending';
      const meta = [
        f.flagged_at ? 'flagged ' + esc(fmtTrainingTs(f.flagged_at)) : '',
        f.log_timestamp ? 'log ' + esc(f.log_timestamp) : '',
        f.consumed_at ? 'consumed ' + esc(fmtTrainingTs(f.consumed_at)) : '',
      ].filter(Boolean).join(' · ');
      return trainingFailRow(f, open, `<span class="tr-flag-st" data-s="${escAttr(st)}">${esc(st.replace('_', ' '))}</span>`, meta);
    }).join('');
    el.innerHTML = `<div class="tr-section-head"><div class="section-divider">Flagged by Artemis</div><span class="spacer"></span>
        <span class="tr-flag-count" data-s="pending"><b>${pending}</b> pending</span>
        <span class="tr-flag-count"><b>${consumed}</b> consumed</span></div>
      <div class="tr-fails">${rows || '<div class="dim">No flagged errors yet.</div>'}</div>`;
    el.classList.remove('hidden');
  }
  async function refreshTrainingFlags() {
    let d = null;
    try { d = await api('/api/training/flags'); } catch (e) { d = null; }
    renderTrainingFlags(d);
  }
  async function refreshTrainingCatalogs() {
    const el = $('trainingCatalogs');
    if (!el) return;
    refreshTrainingFlags();
    try {
      const d = await api('/api/training/catalogs');
      const hist = $('trainingHistory');
      if (!d.catalogs || !d.catalogs.length) {
        trainingNewest = null;
        renderTrainingStats(null);
        $('trainingClassFilter').innerHTML = '';
        el.innerHTML = '<div class="dim">No catalogs yet — run the audit.</div>';
        hist.innerHTML = '<div class="dim">—</div>';
        return;
      }
      hist.innerHTML = d.catalogs.map(c =>
        `<div><span class="f" title="${escAttr(c.file)}">${esc(c.ts ? fmtTrainingTs(c.ts) : c.file)}</span><span class="n">${c.entries >= 0 ? c.entries + ' failures' : 'unreadable'}</span></div>`
      ).join('');
      trainingNewest = d.newest;
      renderTrainingStats(d.newest);
      renderTrainingFailures();
    } catch (e) {
      el.textContent = 'Failed: ' + e.message;
    }
  }

  // ============================================================= Custom chatbot
  // Intake form → Save (installs the chosen granite base into the HF cache in
  // the background when it's missing) → granite writes persona pairs → Train
  // packs a LoRA as the Ollama model "<slug>-bot". Steps run server-side.
  const BOT_FIELDS = { name: 'botName', owner: 'botOwner', what_it_is: 'botWhatItIs', what_it_does: 'botWhatItDoes', who_for: 'botWhoFor', personality: 'botPersonality', handoff: 'botHandoff' };
  const BOT = { slug: '', pairs: [], bases: [], running: null, pulls: [], pullTails: {}, timer: null };
  function setTrainingTab(tab) {
    STATE.trainingTab = tab;
    qsa('#view-training .tr-tab').forEach(b => b.classList.toggle('active', b.dataset.trtab === tab));
    qsa('#view-training [data-trpanel]').forEach(p => p.classList.toggle('hidden', p.dataset.trpanel !== tab));
    $('trainingSub').textContent = tab === 'bot'
      ? 'Intake form → granite writes persona pairs → LoRA on a granite base'
      : 'Audit logs → modify SFT data → train one epoch';
    if (tab === 'bot') refreshBot(!$('botName').value && !BOT.slug);
    else { refreshTrainingStatus(); refreshTrainingCatalogs(); }
  }
  function renderBotBases(selected) {
    const sel = $('botBase');
    const cur = selected || sel.value || (BOT.bases[0] && BOT.bases[0].key) || '';
    sel.innerHTML = BOT.bases.map(b =>
      `<option value="${escAttr(b.key)}">${esc(b.label)}${b.cached ? '' : b.installing ? ' — installing…' : ' — not installed'}</option>`).join('');
    sel.value = cur;
    paintBotBaseNote();
  }
  function paintBotBaseNote() {
    const b = BOT.bases.find(x => x.key === $('botBase').value);
    const note = $('botBaseNote');
    note.dataset.state = !b ? '' : b.cached ? 'ok' : b.installing ? 'running' : 'warn';
    note.textContent = !b ? ''
      : b.cached ? `${b.hf} · installed (${(b.bytes / 1e9).toFixed(1)} GB)`
      : b.installing ? `${b.hf} · installing${BOT.pullTails[b.key] ? ' — ' + BOT.pullTails[b.key] : ''}`
      : `${b.hf} · installs when you save`;
    paintBotButtons();
  }
  function paintBotButtons() {
    const base = BOT.bases.find(x => x.key === $('botBase').value);
    const train = $('btnBotTrain');
    $('btnBotGenerate').disabled = !!BOT.running;
    const panel = document.querySelector('[data-trpanel="bot"]');
    if (panel) panel.classList.toggle('bot-busy', !!(BOT.running || (BOT.pulls && BOT.pulls.length)));
    paintBotReady();
    train.disabled = !!BOT.running || !BOT.slug || !BOT.pairs.length || !(base && base.cached);
    train.title = !base || base.cached ? '' : base.label + (base.installing ? ' is still installing' : ' is not installed — save to install it');
  }
  function paintBotReady() {
    const el = $('botReady');
    if (!el) return;
    const ids = Object.values(BOT_FIELDS);
    const n = ids.filter(id => $(id).value.trim()).length;
    el.textContent = `${n}/${ids.length} filled`;
    el.dataset.state = n === ids.length ? 'ok' : n ? 'warn' : '';
  }
  function botCatClass(c) {
    let h = 0;
    for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 'bc' + (h % 5);
  }
  function renderBotPairs() {
    const el = $('botPairs');
    if (!BOT.pairs.length) {
      el.innerHTML = '<div class="bot-empty">No pairs yet — fill in the intake and generate.</div>';
    } else {
      el.innerHTML = `<div class="bot-pairs-head">${BOT.pairs.length} pairs</div>` + BOT.pairs.map((p, i) =>
        `<div class="bot-pair"><div class="u"><b>USER</b>${esc(p.user)}</div><div class="a"><b>BOT</b>${esc(p.assistant)}</div>` +
        `<div class="x">${p.category ? `<span class="tr-badge bot-cat ${botCatClass(p.category)}">${esc(p.category)}</span>` : ''}` +
        `<button class="btn btn-ghost btn-sm" data-drop="${i}" title="Remove this pair">✕</button></div></div>`).join('');
      el.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => dropBotPair(parseInt(b.dataset.drop, 10)));
    }
    paintBotButtons();
  }
  Object.values(BOT_FIELDS).forEach(id => { const el = $(id); if (el) el.addEventListener('input', paintBotReady); });
  async function dropBotPair(i) {
    try {
      const d = await postJson('/api/training/chatbot/pairs', { slug: BOT.slug, remove: [i] });
      if (!d.ok) { toast(d.error || 'Remove failed', 'error'); return; }
      BOT.pairs.splice(i, 1);
      renderBotPairs();
    } catch (e) { toast('Remove failed: ' + e.message, 'error'); }
  }
  // fillForm: load the selected bot's saved intake into the form (on bot
  // switch); polling refreshes leave the fields alone so typing isn't clobbered.
  async function refreshBot(fillForm) {
    try {
      const d = await api('/api/training/chatbot' + (BOT.slug ? '?slug=' + encodeURIComponent(BOT.slug) : ''));
      if (!d.ok) { toast(d.error || 'Chatbot load failed', 'error'); return; }
      BOT.bases = d.bases || [];
      const sel = $('botSelect');
      sel.innerHTML = '<option value="">+ New chatbot</option>' +
        (d.bots || []).map(b => `<option value="${escAttr(b.slug)}">${esc(b.name)}</option>`).join('');
      sel.value = BOT.slug;
      const bot = d.bot;
      if (fillForm) {
        const f = (bot && bot.intake && bot.intake.fields) || {};
        for (const [k, id] of Object.entries(BOT_FIELDS)) $(id).value = f[k] || '';
        paintBotReady();
      }
      renderBotBases(fillForm && bot && bot.intake ? bot.intake.base : null);
      BOT.pairs = (bot && bot.pairs) || [];
      renderBotPairs();
      const t = bot && bot.trained;
      $('botTrained').textContent = t ? `trained → ollama ${t.model} · ${t.base} · ${t.pairs} pairs · ${fmtTrainingTs(t.trained_at)}` : '';
      refreshBotStatus();
    } catch (e) {
      toast('Chatbot load failed: ' + e.message, 'error');
    }
  }
  async function refreshBotStatus() {
    const tail = $('botTail');
    try {
      const d = await api('/api/training/status?group=bot');
      const atBottom = tail.scrollHeight - tail.scrollTop - tail.clientHeight < 24;
      tail.textContent = d.tail || '(no step has run yet)';
      if (atBottom || d.running) tail.scrollTop = tail.scrollHeight;
      $('botLogStep').textContent = d.step ? '· ' + d.step.replace(/^bot-/, '') : '';
      const pulls = d.pulls || [];
      // A step or an install just ended → reload pairs / install state.
      const finished = (BOT.running && BOT.running !== d.running) || BOT.pulls.some(k => !pulls.includes(k));
      BOT.running = d.running;
      BOT.pulls = pulls;
      BOT.pullTails = d.pullTails || {};
      BOT.bases.forEach(b => { b.installing = pulls.includes(b.key); });
      renderBotBases();
      setTrainingStatus(d.running ? d.running + ' running' : pulls.length ? 'installing ' + pulls.join(', ') : 'idle',
        d.running || pulls.length ? 'running' : 'idle');
      $('btnTrainingStop').disabled = !d.running;
      if (finished) refreshBot(false);
      if ((d.running || pulls.length) && !BOT.timer) BOT.timer = setInterval(refreshBotStatus, 4000);
      if (!d.running && !pulls.length && BOT.timer) { clearInterval(BOT.timer); BOT.timer = null; }
    } catch (e) {
      tail.textContent = 'Failed: ' + e.message;
    }
  }
  async function saveBot() {
    const fields = {};
    for (const [k, id] of Object.entries(BOT_FIELDS)) fields[k] = $(id).value;
    const d = await postJson('/api/training/chatbot/save', { slug: BOT.slug || undefined, fields, base: $('botBase').value });
    if (d.slug) BOT.slug = d.slug;
    if (!d.ok) { toast(d.error || 'Save failed', 'error'); return null; }
    const base = BOT.bases.find(x => x.key === $('botBase').value);
    if (d.installing && base && !base.installing) toast(`Installing ${base.label} in the background`, 'info');
    return d;
  }
  async function startBotStep(route, body) {
    const d = await postJson('/api/training/chatbot/' + route, body);
    if (!d.ok) {
      $('botTail').textContent = d.error || 'failed to start';
      toast(d.error || 'Failed to start', 'error');
      return;
    }
    BOT.running = d.step;
    paintBotButtons();
    refreshBotStatus();
  }
  async function onBotSave() {
    try { if (await saveBot()) { toast('Intake saved', 'info'); refreshBot(false); } }
    catch (e) { toast('Save failed: ' + e.message, 'error'); }
  }
  async function onBotGenerate() {
    try {
      if (!(await saveBot())) return;
      await startBotStep('generate', { slug: BOT.slug, count: parseInt($('botCount').value, 10) || 100 });
    } catch (e) { toast('Generate failed: ' + e.message, 'error'); }
  }
  async function onBotTrain() {
    if (!confirm('Train this chatbot? This clears VRAM and takes a while.')) return;
    try {
      if (!(await saveBot())) return;
      await startBotStep('train', { slug: BOT.slug });
    } catch (e) { toast('Train failed: ' + e.message, 'error'); }
  }

  // ============================================================= Help modal
  function showModal(title, bodyHtml) {
    $('genericModalTitle').textContent = title;
    $('genericModalBody').innerHTML = bodyHtml;
    $('genericModal').classList.add('open');
  }
  function closeModal() { $('genericModal').classList.remove('open'); }

  function openHelp() { $('helpModal').classList.add('open'); }
  function closeHelp() { $('helpModal').classList.remove('open'); }

  // ============================================================= Switch user
  function openSwitchUser() {
    renderSenderList();
    $('switchUserModal').classList.add('open');
  }
  function closeSwitchUser() { $('switchUserModal').classList.remove('open'); }
  function renderSenderList() {
    const list = $('userSwitchList');
    list.innerHTML = STATE.senders.map(s =>
      '<div class="urow" data-sender="' + escAttr(s.key) + '">' +
      '<span class="avatar" style="background:' + escAttr(s.color) + '">' + esc(initials(s.name)) + '</span>' +
      '<span class="uname">' + esc(s.name) + '</span>' +
      '<span class="uid">' + esc(s.key) + '</span></div>'
    ).join('');
    qsa('.urow', list).forEach(r => r.addEventListener('click', () => pickSender(r.dataset.sender)));
  }
  function initials(name) { return (name || '?').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase(); }
  function pickSender(key) {
    const s = STATE.senders.find(x => x.key === key);
    if (!s) return;
    STATE.currentSender = s.name;
    STATE.currentSenderKey = s.key;
    try { localStorage.setItem('jarvis-sender', JSON.stringify(s)); } catch {}
    $('switchUserLabel').textContent = s.name;
    closeSwitchUser();
    toast('Now sending as ' + s.name, 'info');
  }
  function addSender() {
    const name = $('newSenderName').value.trim();
    if (!name) return;
    const key = name.toLowerCase().replace(/\s+/g, '-');
    const palette = ['#5eead4', '#60a5fa', '#c084fc', '#fbbf24', '#f87171', '#4ade80'];
    const s = { key, name, color: palette[STATE.senders.length % palette.length] };
    STATE.senders.push(s);
    try { localStorage.setItem('jarvis-senders', JSON.stringify(STATE.senders)); } catch {}
    $('newSenderName').value = '';
    renderSenderList();
    pickSender(key);
  }

  // ============================================================= First-run wizard
  const WIZARD_STEPS = [
    {
      title: 'Read this first',
      body: `
        <h2 style="color:var(--danger)">READ THIS. IT IS NOT A JOKE.</h2>
        <div class="warn">
          <strong>Warden runs with the same access as your user account on this machine.</strong>
          There is no permission prompt before actions. There is no sandbox. It does not manage backups. It cannot be trusted with secrets it can read from your filesystem.
        </div>
        <p><strong>What it can do:</strong></p>
        <ul>
          <li>Read, modify, or delete any file your user can touch</li>
          <li>Run any command in a shell — including <code>sudo</code> if you're set up for it</li>
          <li>Open browsers, click, type, screenshot, read your clipboard</li>
          <li>Send email, messages, and API calls on your behalf</li>
          <li>Spend money via any account whose credentials it can reach</li>
        </ul>
        <p><strong>Where you should run it:</strong></p>
        <ul>
          <li>A dedicated Linux box you are OK wiping and reprovisioning</li>
          <li>A virtual machine with snapshots and no access to your real accounts</li>
          <li>A cloud VM whose IAM is scoped to nothing you care about</li>
        </ul>
        <p><strong>Where you should NOT run it:</strong></p>
        <ul>
          <li>Your personal laptop with real files and browser sessions</li>
          <li>A work computer — this will violate almost every acceptable-use policy</li>
          <li>Any machine holding data you can't afford to lose</li>
          <li>Any machine with unencrypted SSH keys, cloud credentials, or password vaults</li>
        </ul>
        <p><strong>Always monitor the agent while it is running.</strong> An unattended autonomous agent with shell access is how catastrophes happen.</p>
        <label class="wizard-ack">
          <input type="checkbox" id="wizardAckCheck"
            onchange="document.getElementById('btnWizardNext').disabled = !this.checked">
          I understand the risks and am running Warden on a dedicated box, VM, or throwaway account.
        </label>`,
    },
    {
      title: 'Welcome',
      body: `
        <h2>This is Warden.</h2>
        <p>Warden is a <strong>personal hybrid agent</strong> — one seat, <strong>Atlas</strong>, that replies to you and does the work itself, plus a fleet of specialist sub-agents (Vulkan, Iris, Artemis, Sentry, The Council) it can call on. It can read files, run code, open browsers, send email, and schedule tasks on your machine.</p>
        <p>There's a learning curve. Warden responds best to <em>actionable requests</em>, not conversation. The next few screens cover the essentials. You can also read the standalone guides:</p>
        <div class="topics">
          <a href="/help/not-a-chatbot.html" target="_blank">Not a chatbot</a>
          <a href="/help/agents.html" target="_blank">The agents</a>
          <a href="/help/council.html" target="_blank">The Council</a>
          <a href="/help/atlas.html" target="_blank">Asking Atlas</a>
          <a href="/help/skills.html" target="_blank">Skills</a>
          <a href="/help/safety.html" target="_blank">Safety</a>
          <a href="/help/settings.html" target="_blank">Settings</a>
          <a href="#" onclick="openHelp();return false;">Open Help modal</a>
        </div>`,
    },
    {
      title: 'The agents',
      body: `
        <h2>Atlas is the seat, several specialists on call.</h2>
        <p>Atlas is the model you're chatting with — it does the work itself (browser, desktop, files, shell, web) and runs multi-part tasks its own way: it calls the specialists one piece at a time and checks each result. A specialist reports back as a chat message when it lands.</p>
        <ul>
          <li><strong>Vulkan</strong> — coding, scripting, building, heavy bash.</li>
          <li><strong>Iris</strong> — email (read; send if enabled) + scheduling (reminders, calendar) + work management (tasks, projects, blockers, financials).</li>
          <li><strong>Artemis</strong> — read-only auditor / reviewer.</li>
          <li><strong>Sentry</strong> — security scans of this PC.</li>
          <li><strong>The Council</strong> — three Artemis seats deliberate in parallel.</li>
        </ul>
        <p>Read the <a href="/help/agents.html" target="_blank">agents deep-dive →</a></p>`,
    },
    {
      title: 'How to ask',
      body: `
        <h2>Be actionable. Be specific.</h2>
        <p>Bad: <code>What's your opinion on cats?</code><br>Good: <code>Read /tmp/cat-facts.txt and pick the funniest one.</code></p>
        <p>One ask per turn is fine. If two things are independent, say so: <code>"Read X AND check Y in parallel."</code></p>
        <p>If a tool fails, Warden says <code>BLOCKED</code> and tells you what's missing. Read the message; don't retry blindly.</p>
        <p>The <strong>verbose bar</strong> above the composer shows what Warden is doing right now (live label + tools list).</p>
        <p>Read the <a href="/help/not-a-chatbot.html" target="_blank">full guide →</a></p>`,
    },
    {
      title: 'Safety',
      body: `
        <h2>Read this. Then read it again.</h2>
        <div class="warn"><strong>Warden can run code, delete files, send email, and push git.</strong> Treat it like a competent but literal-minded contractor.</div>
        <ul>
          <li>Don't run as admin / root.</li>
          <li>Don't give write access to important things (email, prod repos, keys).</li>
          <li>Make backups. Group folders are git-tracked — use <code>/api/files/history</code> to revert.</li>
          <li>Don't run Warden on your only computer or your work computer.</li>
          <li>Run the <strong>audit</strong> button (left rail, bottom) before trusting Warden with anything important.</li>
        </ul>
        <p>Read the <a href="/help/safety.html" target="_blank">safety guide →</a></p>`,
    },
    {
      title: 'Dashboard pages',
      body: `
        <h2>Add or edit dashboard pages safely.</h2>
        <p>The dashboard is a single-page app in <code>public/index.html</code> + <code>public/js/app.js</code> + <code>public/css/style.css</code>. New views and rail buttons go through a beta → live pipeline so broken drafts never hit the live UI.</p>
        <ul>
          <li><strong>Beta:</strong> edits land in <code>public/beta/</code> and preview at <code>http://localhost:3200/beta/</code>.</li>
          <li><strong>Promote:</strong> click Promote in the Add Page drawer after preview passes. Live is backed up first.</li>
          <li><strong>Revert:</strong> if live breaks, click Revert to restore the most recent backup.</li>
        </ul>
        <p>You can also tell Warden <em>"add a dashboard page called X"</em> and it will follow the pipeline for you.</p>
        <p>Read the <a href="/help/dashboard-pages.html" target="_blank">dashboard pages guide →</a></p>`,
    },
  ];

  let wizardStep = 0;
  function showWizardStep(i) {
    wizardStep = i;
    const step = WIZARD_STEPS[i];
    const prog = $('wizardProgress');
    prog.innerHTML = WIZARD_STEPS.map((_, idx) =>
      '<div class="step ' + (idx < i ? 'done' : idx === i ? 'current' : '') + '"></div>'
    ).join('');
    $('wizardStep').innerHTML = step.body;
    $('btnWizardBack').style.display = i === 0 ? 'none' : '';
    $('btnWizardNext').textContent = i === WIZARD_STEPS.length - 1 ? 'Start using Warden' : 'Next';
    // Step 0 is the risk acknowledgment — Next stays disabled until the
    // user checks the confirmation box in the step body.
    $('btnWizardNext').disabled = i === 0;
  }
  function wizardNext() {
    if (wizardStep < WIZARD_STEPS.length - 1) { showWizardStep(wizardStep + 1); return; }
    // Done
    if ($('wizardDontShowInput').checked) {
      try { localStorage.setItem('jarvis-wizard-dismissed', '1'); } catch {}
    }
    $('wizardModal').classList.remove('open');
  }
  function wizardBack() { if (wizardStep > 0) showWizardStep(wizardStep - 1); }

  function maybeShowWizard() {
    let dismissed = false;
    try { dismissed = localStorage.getItem('jarvis-wizard-dismissed') === '1'; } catch {}
    if (!dismissed) {
      showWizardStep(0);
      $('wizardModal').classList.add('open');
    }
  }

  // ============================================================= Theme
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('dockbox-theme', next); } catch {}
    // Keep an embedded Alpha Stack webapp in theme sync with Warden.
    try {
      const f = $('alphaStackFrame');
      if (f && f.contentWindow) f.contentWindow.postMessage({ type: 'as-theme', theme: next }, '*');
    } catch {}
  }

  // ============================================================= Notifications (SSE + polling)
  function connectSSE() {
    try {
      if (STATE.sseSource) STATE.sseSource.close();
      STATE.sseSource = new EventSource('/api/notifications');
      STATE.sseSource.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'connected') return;
          handleNotification(data);
        } catch {}
      };
      STATE.sseSource.onerror = () => {
        try { STATE.sseSource.close(); } catch {}
        STATE.sseSource = null;
        if (!STATE.notifPollTimer) {
          STATE.notifPollTimer = setInterval(async () => {
            try {
              const d = await api('/api/notifications/poll');
              const items = d.items || [];
              for (const it of items) {
                handleNotification({ type: 'chat_complete', message: it.preview || '', timestamp: it.timestamp });
              }
            } catch {}
          }, 8000);
        }
      };
    } catch (e) { /* SSE not supported */ }
  }
  function handleNotification(data) {
    if (data.type === 'chat_complete') {
      // Trigger a chat poll so the new bot message shows up
      pollChat();
      pollStatus();
      // Keep a short refresh window alive in case more chunks follow
      STATE.waitingForReply = true;
      waitingForReply = true;
      showTypingIndicator();
      startChatPolling();
    } else if (data.type === 'agent_activity' && data.line) {
      // Stream dim-coded thinking tokens into the thinking bar
      const clean = data.line.replace(/\[[0-9;]*m/g, '').trim();
      if (!clean) return;
      if (clean.startsWith('[agent-runner] Raw stream chunk')) return;
      if (clean.startsWith('{') && clean.includes('"model"')) return;
      addThinkingLine(clean);
      // Also update the typing status text with the same token stream
      const statusEl = $('typingStatusText');
      if (statusEl) statusEl.textContent = typingWords.join(' ');
    } else if (data.message) {
      toast(data.message, data.type === 'alarm' ? 'warn' : 'info');
    }
  }

  // ============================================================= Image Gen
  function renderImagegenGallery(files) {
    const g = $('imagegenGallery');
    if (!g) return;
    g.innerHTML = (files || []).length
      ? files.map(f => `<figure class="imagegen-card"><img src="${escAttr(f.url)}" alt="" loading="lazy"><button type="button" class="imagegen-del" data-name="${escAttr(f.name)}" title="Remove this image">×</button><figcaption class="meta" title="${escAttr(f.name)}">${esc(f.name)}</figcaption></figure>`).join('')
      : '<p class="dim">Nothing generated yet.</p>';
    qsa('.imagegen-del', g).forEach(btn => btn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!confirm('Remove ' + btn.dataset.name + '?')) return;
      try {
        await del('/api/imagegen/file/' + encodeURIComponent(btn.dataset.name));
        await refreshImagegen();
      } catch (err) { toast('Remove failed: ' + err.message, 'error'); }
    }));
  }
  async function refreshImagegen() {
    try {
      const d = await api('/api/imagegen/history');
      renderImagegenGallery(d.files || []);
    } catch (e) { /* history is optional */ }
  }
  async function generateImagegen() {
    const btn = $('btnImagegen');
    const st = $('imagegenStatus');
    if (!btn) return;
    btn.disabled = true;
    if (st) st.textContent = 'generating… (this can take a minute)';
    try {
      const size = ($('igSize')?.value || '1024x1024').split('x').map(Number);
      const seedRaw = ($('igSeed')?.value || '').trim();
      const d = await postJson('/api/imagegen', {
        prompt: $('igPrompt').value,
        scene: $('igScene').value,
        aesthetic: $('igAesthetic').value,
        location: $('igLocation').value,
        negative: $('igNegative').value,
        width: size[0], height: size[1],
        seed: seedRaw ? Number(seedRaw) : undefined,
      });
      if (!d.ok) {
        if (st) st.textContent = d.error || 'failed';
        toast(d.error || 'Image generation failed', 'error');
        return;
      }
      if (st) st.textContent = 'done';
      const res = $('imagegenResult');
      if (res) res.innerHTML = `<img src="${escAttr(d.url)}" alt="generated image">`;
      await refreshImagegen();
    } catch (e) {
      if (st) st.textContent = 'failed: ' + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // ============================================================= Wire-up
  function init() {
    // Load senders from localStorage
    try {
      const stored = JSON.parse(localStorage.getItem('jarvis-senders') || '[]');
      if (Array.isArray(stored) && stored.length) STATE.senders = stored;
      const cur = JSON.parse(localStorage.getItem('jarvis-sender') || 'null');
      if (cur) { STATE.currentSender = cur.name; STATE.currentSenderKey = cur.key; }
    } catch {}
    $('switchUserLabel').textContent = STATE.currentSender;

    // Rail nav
    qsa('.rail-btn[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

    // Mobile "More" bottom sheet (visible only ≤720px via responsive.css).
    // Rows are generated from the rail's own buttons (+ group labels), so the
    // sheet always mirrors the rail. Footer actions (audit/settings/add page)
    // proxy to their real buttons so we don't duplicate behavior.
    (function initNavSheet() {
      const sheet = $('navSheet');
      if (!sheet) return;
      const body = sheet.querySelector('.navsheet-body');
      const PRIMARY = ['chat', 'talk'];
      const svgOf = (btn) => { const s = btn.querySelector('svg'); return s ? s.outerHTML : ''; };
      qsa('.rail-nav > *').forEach(el => {
        if (el.classList.contains('rail-group-label')) {
          const h = document.createElement('div');
          h.className = 'navsheet-group';
          h.textContent = el.textContent;
          body.appendChild(h);
          return;
        }
        if (!el.classList.contains('rail-btn') || !el.dataset.view) return;
        if (PRIMARY.includes(el.dataset.view)) return; // already bottom tabs
        const row = document.createElement('button');
        row.className = 'navsheet-row';
        row.dataset.view = el.dataset.view;
        row.innerHTML = `<span class="navsheet-ic">${svgOf(el)}</span><span class="navsheet-text">${el.textContent.trim()}</span>`;
        body.appendChild(row);
      });
      const actionMap = { btnAudit: 'Run Audit', btnSettings: 'Settings', btnAddPage: 'Add Page' };
      qsa('.rail-footer .rail-btn').forEach(el => {
        if (!actionMap[el.id]) return;
        const row = document.createElement('button');
        row.className = 'navsheet-row';
        row.dataset.action = el.id;
        row.innerHTML = `<span class="navsheet-ic">${svgOf(el)}</span><span class="navsheet-text">${actionMap[el.id]}</span>`;
        body.appendChild(row);
      });
      $('btnNavMore')?.addEventListener('click', () => sheet.classList.toggle('open'));
      sheet.addEventListener('click', (e) => {
        const row = e.target.closest('.navsheet-row');
        if (row) {
          sheet.classList.remove('open');
          if (row.dataset.view) switchView(row.dataset.view);
          else if (row.dataset.action) $(row.dataset.action)?.click();
          return;
        }
        if (!e.target.closest('.navsheet')) sheet.classList.remove('open'); // backdrop
      });
    })();

    $('btnSettings').addEventListener('click', openSettings);
    $('btnAddPage').addEventListener('click', openAddPage);
    $('btnAudit').addEventListener('click', openAuditModal);
    $('btnHelp').addEventListener('click', openHelp);
    $('btnTheme').addEventListener('click', toggleTheme);
    $('btnStop').addEventListener('click', stopAgent);
    $('btn-phone-start')?.addEventListener('click', () => phoneControl('start'));
    $('btn-phone-stop')?.addEventListener('click', () => phoneControl('stop'));
    $('btn-phone-restart')?.addEventListener('click', () => phoneControl('restart'));
    $('btnBugloopStart')?.addEventListener('click', () => bugloopControl('start'));
    $('btnBugloopStop')?.addEventListener('click', () => bugloopControl('stop'));
    $('btnBugloopRefresh')?.addEventListener('click', refreshBugloop);
    $('bugloopDiagnosisModel')?.addEventListener('change', () => saveBugloopModel('bugloopDiagnosisModel'));
    $('bugloopCodingModel')?.addEventListener('change', () => saveBugloopModel('bugloopCodingModel'));
    $('btnRestart').addEventListener('click', restartServer);
    $('btnSwitchUser').addEventListener('click', openSwitchUser);
    $('btnNewThought').addEventListener('click', newThought);
    const clearConv = $('btnClearConversation');
    if (clearConv) clearConv.addEventListener('click', clearConversation);
    // Mobile-only relocated buttons. Hidden on desktop via CSS.
    const ntMobile = $('btnNewThoughtMobile');
    if (ntMobile) ntMobile.addEventListener('click', newThought);
    const clearConvMobile = $('btnClearConversationMobile');
    if (clearConvMobile) clearConvMobile.addEventListener('click', clearConversation);
    const settingsMobile = $('btnSettingsMobile');
    if (settingsMobile) settingsMobile.addEventListener('click', openSettings);

    // Drawer
    $('btnDrawerClose').addEventListener('click', closeDrawer);
    $('drawerBackdrop').addEventListener('click', closeDrawer);

    // Help modal
    $('btnHelpClose').addEventListener('click', closeHelp);
    $('btnHelpDone').addEventListener('click', closeHelp);

    // Audit modal
    $('btnAuditClose').addEventListener('click', closeAuditModal);
    $('btnAuditStart').addEventListener('click', startAudit);
    $('btnAuditRefresh').addEventListener('click', refreshAuditStatus);

    // Switch user
    $('btnSwitchUserClose').addEventListener('click', closeSwitchUser);
    $('btnAddSender').addEventListener('click', addSender);
    $('newSenderName').addEventListener('keydown', (e) => { if (e.key === 'Enter') addSender(); });

    // Generic modal
    $('btnGenericModalClose').addEventListener('click', closeModal);

    // Calendar pane: select which provider calendars to show/sync
    const btnCalSelect = $('btnCalSelect');
    if (btnCalSelect) btnCalSelect.addEventListener('click', showAllCalendarToggles);

    // Wizard
    $('btnWizardClose').addEventListener('click', () => $('wizardModal').classList.remove('open'));
    $('btnWizardNext').addEventListener('click', wizardNext);
    $('btnWizardBack').addEventListener('click', wizardBack);

    // Chat composer
    $('btnSend').addEventListener('click', sendChat);
    const ta = $('chatInput');
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    });

    // Tasks
    $('btnNewTask').addEventListener('click', showTaskForm);
    $('btnCancelTask').addEventListener('click', hideTaskForm);
    $('btnSaveTask').addEventListener('click', saveTask);
    $('btnRefreshTasks').addEventListener('click', refreshTasks);
    $('btnDeleteActiveTasks').addEventListener('click', () => bulkDeleteTasks('active'));
    $('btnDeleteInactiveTasks').addEventListener('click', () => bulkDeleteTasks('inactive'));
    $('btnDeleteAllTasks').addEventListener('click', () => bulkDeleteTasks('all'));
    // Accounts
    $('btnRefreshAccounts').addEventListener('click', refreshAccounts);
    $('btnAddImapAccount').addEventListener('click', () => openImapDrawer());
    $('btnAddApiKey').addEventListener('click', openApiKeyDrawer);
    $('btnRefreshSkills').addEventListener('click', () => { refreshSkills(); refreshMcp(); });
    $('btnRefreshActivity').addEventListener('click', refreshActivity);
    $('btnRefreshFriends').addEventListener('click', refreshFriends);
    $('btnFriendsTunnelUp').addEventListener('click', friendsTunnelUp);
    $('btnFriendsCopyLink').addEventListener('click', friendsCopyLink);
    $('btnFriendsInvite').addEventListener('click', friendsInvite);
    $('view-friends')?.addEventListener('click', (e) => {
      const b = e.target.closest('[data-fact]');
      if (b) friendsAction(b.dataset.fact, b.dataset.id);
    });

    // Social (BBS) — the dial-in terminal: clicks delegate on [data-act] rows,
    // the command-bar input handles its own Enter/Esc while a prompt is open,
    // and one document-level keydown maps keys by screen (never while typing).
    $('view-social')?.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-act]');
      if (hit) runAct(hit.dataset.act, hit.dataset.arg);
    });
    $('bbsInput')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); handlePromptSubmit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelPrompt(); }
    });
    // the prompt line lives IN the terminal grid — mirror the hidden input into it
    $('bbsInput')?.addEventListener('input', () => {
      if (STATE.currentView === 'social' && BBS_UI.prompt) draw();
    });
    // file-area upload — hidden picker opened by [U]; any file type, base64 over the wire
    $('bbsUpload')?.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 8192));
        $('bbsStatus').textContent = 'UPLOADING ' + f.name + '…';
        const r = await postJson('/api/friends/bbs/file-upload', { name: f.name, data_base64: btoa(bin) });
        $('bbsStatus').textContent = (r && r.ok) ? 'UPLOADED: ' + r.name : 'FAILED: ' + ((r && r.error) || 'unknown');
      } catch (err) { $('bbsStatus').textContent = 'FAILED: ' + err.message; }
      await refreshSocial();
    });
    document.addEventListener('keydown', onBbsKey);
    applyTheme();
    loadBotnet();

    // Human presence heartbeat — tells the host whether the human is looking at
    // the window; the BotNet sweep pauses while they are.
    let PRESENCE_WATCHING = null;
    let PRESENCE_LAST_ACTIVITY = Date.now();
    function computePresence() {
      return document.visibilityState === 'visible' && document.hasFocus() && (Date.now() - PRESENCE_LAST_ACTIVITY < 30000);
    }
    function presenceTick() {
      const w = computePresence();
      // POST on every change, and keep re-asserting `watching: true` each tick so
      // the host's stale-window (45s) never lapses while the human is still there.
      if (w !== PRESENCE_WATCHING || w === true) {
        PRESENCE_WATCHING = w;
        postJson('/api/presence', { watching: w }).catch(() => {});
      }
    }
    ['mousemove','keydown','click','touchstart','scroll'].forEach(ev => window.addEventListener(ev, () => { PRESENCE_LAST_ACTIVITY = Date.now(); }, { passive: true }));
    ['focus','blur','visibilitychange','pageshow','pagehide'].forEach(ev => window.addEventListener(ev, presenceTick));
    setInterval(presenceTick, 15000);
    presenceTick();

    // MARM Console — the view embeds MARM's own webapp; Refresh re-probes health.
    $('btnMarmRefresh')?.addEventListener('click', refreshMarm);
    const btnSec = $('btnRefreshSecurity'); if (btnSec) btnSec.addEventListener('click', refreshSecurity);
    const btnClear = $('btnClearOculusLogs'); if (btnClear) btnClear.addEventListener('click', clearOculusLogs);

    // MCP + Skills mutation controls
    $('btnMcpAdd').addEventListener('click', mcpAddSubmit);
    $('btnMcpAddCancel').addEventListener('click', () => { $('mcpAddDetails').open = false; });
    $('btnSkillAdd').addEventListener('click', skillAddSubmit);
    $('btnSkillAddCancel').addEventListener('click', () => { $('skillAddDetails').open = false; });

    // Delegated handlers for toggle/delete inside the mcp/skill lists
    $('mcpList').addEventListener('change', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('input[data-mcp-toggle]')) {
        mcpToggle(t.getAttribute('data-mcp-toggle'), t.checked);
      }
    });
    $('mcpList').addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('[data-mcp-del]')) {
        mcpDelete(t.getAttribute('data-mcp-del'));
      }
    });
    $('skillGrid').addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.matches && t.matches('[data-skill-del]')) {
        skillDelete(t.getAttribute('data-skill-del'));
        return;
      }
      const card = t && t.closest ? t.closest('[data-skill-toggle]') : null;
      if (card) {
        const name = card.getAttribute('data-skill-toggle');
        const enable = card.getAttribute('data-enabled') !== '1';
        patchJson('/api/skills/' + encodeURIComponent(name), { enabled: enable })
          .then(() => { toast((enable ? 'Enabled ' : 'Disabled ') + name, 'info'); refreshSkills(); })
          .catch((err) => toast('Toggle failed: ' + err.message, 'error'));
      }
    });
    $('btnRefreshLogs').addEventListener('click', refreshProcessLogs);
    $('btnTrainingAudit').addEventListener('click', () => startTrainingStep('audit', { days: parseInt($('trainingDays').value, 10) || 3 }));
    $('btnTrainingModify').addEventListener('click', () => startTrainingStep('modify', {}));
    $('trainingFailSearch').addEventListener('input', e => { TRAINING_FILTER.q = e.target.value.trim(); renderTrainingFailures(); });
    $('btnTrainingTrain').addEventListener('click', () => {
      if (confirm('Train 1 epoch? This clears VRAM and takes a long time.'))
        startTrainingStep('train', {});
    });
    qsa('#view-training .tr-tab').forEach(b => b.addEventListener('click', () => setTrainingTab(b.dataset.trtab)));
    $('btnImagegen').addEventListener('click', generateImagegen);
    refreshImagegen();
    $('botSelect').addEventListener('change', e => { BOT.slug = e.target.value; refreshBot(true); });
    $('botBase').addEventListener('change', paintBotBaseNote);
    $('btnBotSave').addEventListener('click', onBotSave);
    $('btnBotGenerate').addEventListener('click', onBotGenerate);
    $('btnBotTrain').addEventListener('click', onBotTrain);
    $('btnTrainingStop').addEventListener('click', () => {
      if (confirm('Stop the running training step? An aborted train leaves a partial adapter.'))
        stopTraining();
    });

    // Make openHelp / openAuditModal callable from inline onclick handlers
    window.openHelp = openHelp;
    window.openAuditModal = openAuditModal;
    window.closeAuditModal = closeAuditModal;

    // Initial fetches
    startStatusPolling();
    loadMessages();
    connectSSE();
    startChatPolling();

    maybeShowWizard();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Typing indicator controls (ported from the previous dashboard)
  function showTypingIndicator() {
    if (Date.now() < typingHideSuppressUntil) return;
    const el = $('typingIndicator');
    if (!el) return;
    el.classList.remove('hidden');
    const statusEl = $('typingStatusText');
    if (statusEl) statusEl.textContent = 'Thinking…';
    if (!typingStatusPollTimer) startTypingStatusPoll();
  }

  function hideTypingIndicator() {
    if (Date.now() < typingStopSuppressUntil) return;
    const el = $('typingIndicator');
    if (el) el.classList.add('hidden');
    const statusEl = $('typingStatusText');
    if (statusEl) delete statusEl.dataset.sseUpdated;
    waitingForReply = false;
    typingHideSuppressUntil = Date.now() + 2000;
    if (typingStatusPollTimer) { clearInterval(typingStatusPollTimer); typingStatusPollTimer = null; }
    clearThinkingBar();
  }

  function startTypingStatusPoll() {
    if (typingStatusPollTimer) clearInterval(typingStatusPollTimer);
    typingStatusPollTimer = setInterval(async () => {
      if (document.hidden) return;
      if (!waitingForReply) { hideTypingIndicator(); return; }
      try {
        const d = await api('/api/status');
        const g = (d.groups || []).find(x => x.jid === STATE.currentJid);
        const statusEl = $('typingStatusText');
        if (!statusEl) return;
        if (g && g.active && !g.idle) {
          if (typingWords.length === 0) {
            if (g.liveLabel) statusEl.textContent = g.liveLabel;
            else statusEl.textContent = 'Thinking…';
          }
        } else {
          if (!STATE.waitingForReply) hideTypingIndicator();
        }
      } catch {}
    }, 1500);
  }

  // Expose a small surface for debugging and inline handlers
  window.Warden = { STATE, sendChat, pollChat, pollStatus, refreshTasks, refreshSkills, refreshActivity, refreshSecurity, refreshAccounts, deleteApiKey, syncThinkingBar, stopAgent };
})();