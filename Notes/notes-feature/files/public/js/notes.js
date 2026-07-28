/* ===== Notes view — Obsidian-inspired markdown notes with [[wiki-links]] =====
 * Self-contained: own `$` + `api()` wrapper, talks to flat /api/notes/* endpoints
 * directly (no app.js internals). Plain JS only — no TS, no bundler, no deps.
 * Storage is SQLite (see src/db.ts); the [[link]] graph + tags are derived from
 * the note body on every write. Editing uses a plain <textarea>; the preview
 * pane renders markdown with [[wiki-links]] and #tags rewritten to in-tab links.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const qs = (s, r) => (r || document).querySelector(s);
  const qsa = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  async function api(path, opts) {
    try {
      const r = await fetch(path, opts);
      const txt = await r.text();
      let data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch { data = null; }
      return { ok: r.ok, status: r.status, data };
    } catch (e) {
      return { ok: false, status: 0, data: null, err: e };
    }
  }
  const getJson = (path) => api(path);
  const postJson = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const putJson = (path, body) => api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const del = (path) => api(path, { method: 'DELETE' });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function p2(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }

  function slugify(title) {
    return String(title == null ? '' : title).trim().toLowerCase()
      .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'untitled';
  }

  function toast(msg, kind) {
    const el = $('notesTitle');
    if (el) { el.textContent = msg; el.className = 'chip ' + (kind === 'error' ? 'chip-err' : ''); clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = 'Notes'; el.className = 'chip'; }, 1800); }
  }

  // ───────────────────────────────────────────────────────── state
  let allNotes = [];          // every note (lightweight, from list endpoint)
  let folders = [];           // [{folder, count}]
  let tags = [];              // [{tag, count}]
  let current = null;         // full open note
  let filterFolder = null;    // null = all, '' = root, or a folder name
  let filterTag = null;
  let searchQ = '';
  let mode = 'edit';          // 'edit' | 'preview'
  let saveTimer = null;
  let titleTimer = null;

  // ───────────────────────────────────────────────────────── refresh
  async function refresh() {
    await Promise.all([loadIndex(), refreshListOnly()]);
    renderFolders();
    renderTags();
    renderList();
    if (current) {
      // reload the open note so backlinks/preview reflect any external change
      const r = await getJson('/api/notes/' + current.id);
      if (r.ok && r.data && r.data.note) { current = r.data.note; renderEditor(); }
    }
  }

  async function loadIndex() {
    const [fr, tr] = await Promise.all([getJson('/api/notes/folders'), getJson('/api/notes/tags')]);
    folders = (fr.data && fr.data.folders) || [];
    tags = (tr.data && tr.data.tags) || [];
  }

  // ───────────────────────────────────────────────────────── folders / tags
  function renderFolders() {
    const el = $('notesFolders');
    if (!el) return;
    const total = allNotes.length;
    const row = (label, val, cls) => `<div class="notes-folder${cls ? ' ' + cls : ''}" data-folder="${esc(val == null ? '' : val)}">${esc(label)} <span class="dim"></span></div>`;
    let html = row('All notes', '__all__', filterFolder === null ? 'active' : '');
    html += row('Unfiled', '', filterFolder === '' ? 'active' : '');
    folders.forEach((f) => {
      if (!f.folder) return;
      html += row(f.folder, f.folder, filterFolder === f.folder ? 'active' : '');
    });
    el.innerHTML = html;
    qsa('.notes-folder', el).forEach((b) => b.addEventListener('click', async () => {
      const v = b.dataset.folder;
      filterFolder = v === '__all__' ? null : v;
      filterTag = null;
      await refreshListOnly();
      renderFolders();
      renderTags();
      renderList();
    }));
  }

  function renderTags() {
    const el = $('notesTags');
    if (!el) return;
    if (!tags.length) { el.innerHTML = '<span class="dim" style="font-size:12px">none yet</span>'; return; }
    el.innerHTML = tags.map((t) => `<span class="notes-tag-chip${filterTag === t.tag ? ' active' : ''}" data-tag="${esc(t.tag)}">#${esc(t.tag)} <span class="dim">${t.count}</span></span>`).join(' ');
    qsa('.notes-tag-chip', el).forEach((c) => c.addEventListener('click', async () => {
      filterTag = filterTag === c.dataset.tag ? null : c.dataset.tag;
      filterFolder = null;
      await refreshListOnly();
      renderFolders();
      renderTags();
      renderList();
    }));
  }

  // ───────────────────────────────────────────────────────── list
  function visibleNotes() {
    let list = allNotes;
    // folder + tag filters are applied server-side in refreshListOnly(); only
    // fast client-side search is layered on top of whatever was loaded.
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter((n) => (n.title || '').toLowerCase().indexOf(q) >= 0 || (n.body || '').toLowerCase().indexOf(q) >= 0);
    }
    return list;
  }

  function renderList() {
    const el = $('notesList');
    if (!el) return;
    const list = visibleNotes();
    if (!list.length) {
      el.innerHTML = '<div class="dim" style="padding:14px">No notes. Click + New.</div>';
      return;
    }
    el.innerHTML = list.map((n) => {
      const active = current && current.id === n.id ? ' active' : '';
      const sub = n.folder ? esc(n.folder) + ' · ' : '';
      const when = new Date(n.updated_at).toLocaleDateString();
      return `<div class="notes-item${active}" data-id="${n.id}"><div class="notes-item-title">${esc(n.title)}</div><div class="notes-item-sub dim">${sub}${when}</div></div>`;
    }).join('');
    qsa('.notes-item', el).forEach((it) => it.addEventListener('click', () => openNote(Number(it.dataset.id))));
  }

  // ───────────────────────────────────────────────────────── open / edit
  async function openNote(id) {
    const r = await getJson('/api/notes/' + id);
    if (!r.ok || !r.data || !r.data.note) { toast('Could not open note', 'error'); return; }
    current = r.data.note;
    setMode('edit');
    renderEditor();
    renderList();
  }

  function renderEditor() {
    if (!current) {
      $('notesEditorPane').classList.add('hidden');
      $('notesPreviewPane').classList.add('hidden');
      $('notesBacklinks').innerHTML = '';
      $('btnNotesDelete').classList.add('hidden');
      return;
    }
    $('notesTitleInput').value = current.title;
    $('notesBody').value = current.body;
    $('btnNotesDelete').classList.remove('hidden');
    $('notesFolderLabel').textContent = current.folder ? ('/' + current.folder) : '/unfiled';
    if (mode === 'edit') { $('notesEditorPane').classList.remove('hidden'); $('notesPreviewPane').classList.add('hidden'); }
    else { renderPreview(); }
    renderBacklinks();
  }

  async function renderBacklinks() {
    const el = $('notesBacklinks');
    if (!el || !current) { if (el) el.innerHTML = ''; return; }
    const r = await getJson('/api/notes/' + current.id + '/backlinks');
    const links = (r.data && r.data.backlinks) || [];
    if (!links.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="dim notes-backlinks-head">Linked from</div>' +
      links.map((b) => `<span class="notes-backlink" data-id="${b.id}">${esc(b.title)}</span>`).join('');
    qsa('.notes-backlink', el).forEach((s) => s.addEventListener('click', () => openNote(Number(s.dataset.id))));
  }

  // ───────────────────────────────────────────────────────── save (debounced)
  function scheduleSave() {
    if (!current) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveCurrent, 600);
  }
  async function saveCurrent() {
    if (!current) return;
    const body = $('notesBody').value;
    const title = $('notesTitleInput').value.trim() || 'Untitled';
    const r = await putJson('/api/notes/' + current.id, { title, body });
    if (r.ok && r.data && r.data.note) {
      const prevUid = current.uid;
      current = r.data.note;
      // uid may have changed on rename → refresh index + backlinks
      if (current.uid !== prevUid) { await loadIndex(); renderFolders(); renderTags(); }
      // update lightweight entry in allNotes
      const i = allNotes.findIndex((n) => n.id === current.id);
      if (i >= 0) allNotes[i] = { ...allNotes[i], title: current.title, folder: current.folder, updated_at: current.updated_at };
      renderList();
      renderBacklinks();
    } else {
      toast('Save failed', 'error');
    }
  }

  // ───────────────────────────────────────────────────────── new / today / delete
  async function newNote(title) {
    const r = await postJson('/api/notes', { title: title || 'Untitled', body: '', folder: filterFolder && filterFolder !== '__all__' ? filterFolder : '' });
    if (r.ok && r.data && r.data.note) {
      await loadIndex();
      renderFolders(); renderTags();
      current = r.data.note;
      allNotes.unshift({ id: current.id, title: current.title, folder: current.folder, updated_at: current.updated_at, tags: [] });
      setMode('edit');
      renderEditor();
      renderList();
      $('notesTitleInput').focus();
      $('notesTitleInput').select();
    } else {
      toast('Create failed', 'error');
    }
  }

  function newToday() {
    const title = dateStr(new Date());
    const uid = slugify(title);
    const found = allNotes.find((n) => n.uid === uid);
    if (found) { openNote(found.id); return; }
    newNote(title);
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!confirm('Delete "' + current.title + '"?')) return;
    const id = current.id;
    const r = await del('/api/notes/' + id);
    if (r.ok) {
      allNotes = allNotes.filter((n) => n.id !== id);
      current = null;
      await loadIndex();
      renderFolders(); renderTags(); renderList(); renderEditor();
    } else {
      toast('Delete failed', 'error');
    }
  }

  // ───────────────────────────────────────────────────────── preview / markdown
  function setMode(m) {
    mode = m;
    if (m === 'edit') {
      $('btnNotesEdit').classList.add('hidden');
      $('btnNotesPreview').classList.remove('hidden');
      $('notesEditorPane').classList.remove('hidden');
      $('notesPreviewPane').classList.add('hidden');
    } else {
      $('btnNotesEdit').classList.remove('hidden');
      $('btnNotesPreview').classList.add('hidden');
      $('notesEditorPane').classList.add('hidden');
      $('notesPreviewPane').classList.remove('hidden');
      renderPreview();
    }
  }

  function renderPreview() {
    const el = $('notesPreviewPane');
    if (!el || !current) return;
    el.innerHTML = '<h2 class="notes-preview-title">' + esc(current.title) + '</h2>' + renderMarkdown(current.body || '');
    // wiki-link clicks
    qsa('.note-wikilink', el).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const uid = a.dataset.noteUid;
      const target = allNotes.find((n) => n.uid === uid);
      if (target) openNote(target.id);
      else if (confirm('Create note "' + (a.dataset.label || a.textContent) + '"?')) newNote(a.dataset.label || a.textContent);
    }));
    // tag clicks in preview → filter
    qsa('.note-inline-tag', el).forEach((t) => t.addEventListener('click', () => {
      filterTag = t.dataset.tag;
      filterFolder = null;
      renderFolders(); renderTags(); renderList();
    }));
  }

  // Compact markdown renderer with [[wiki-links]] + #tags. Escapes first.
  function renderMarkdown(text) {
    if (!text) return '<p class="dim">Empty note.</p>';
    const fences = [];
    // Stash code fences so nothing inside them gets rewritten.
    let stashed = String(text).replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, _lang, body) => {
      const i = fences.length;
      fences.push(esc(body.replace(/\n$/, '')));
      return '\x00F' + i + '\x00';
    });

    const knownUids = new Set(allNotes.map((n) => n.uid));

    const inline = (s) => {
      let x = esc(s);
      // inline code
      x = x.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
      // wiki-links: [[Target]], [[Target#heading]], [[Target|alias]]
      x = x.replace(/\[\[([^\]|#\[]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (m, target, alias) => {
        const t = target.trim();
        const label = alias ? alias.trim() : t;
        const uid = slugify(t);
        const cls = knownUids.has(uid) ? 'note-wikilink' : 'note-wikilink unresolved';
        return '<a href="#" class="' + cls + '" data-note-uid="' + esc(uid) + '" data-label="' + esc(label) + '">' + esc(label) + '</a>';
      });
      // inline #tags (not inside a word)
      x = x.replace(/(^|\s)#([A-Za-z][\w-]*)/g, (_, pre, tag) => pre + '<span class="note-inline-tag" data-tag="' + esc(tag) + '">#' + esc(tag) + '</span>');
      // external links
      x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      // bold / italic
      x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      x = x.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s)!?.,;:]|$)/g, '$1<em>$2</em>');
      // restore fences
      x = x.replace(/\x00F(\d+)\x00/g, (_, i) => '<pre><code>' + fences[Number(i)] + '</code></pre>');
      return x;
    };

    const lines = stashed.split(/\r?\n/);
    const out = [];
    let list = null;
    let quote = false;
    let para = [];

    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const flushQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\x00F\d+\x00$/.test(line.trim())) { flushAll(); out.push(inline(line.trim())); continue; }
      if (!line.trim()) { flushAll(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushAll(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
      if (/^>\s?/.test(line)) { flushPara(); flushList(); if (!quote) { out.push('<blockquote>'); quote = true; } out.push('<p>' + inline(line.replace(/^>\s?/, '')) + '</p>'); continue; }
      const li = line.match(/^[-*]\s+(.*)$/);
      if (li) { flushPara(); flushQuote(); if (!list) { out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(li[1]) + '</li>'); continue; }
      const ol = line.match(/^\d+\.\s+(.*)$/);
      if (ol) { flushPara(); flushQuote(); if (!list) { out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(ol[1]) + '</li>'); continue; }
      flushList(); flushQuote();
      para.push(line);
    }
    flushAll();
    return out.join('\n');
  }

  // ───────────────────────────────────────────────────────── [[ autocomplete
  function autocomplete() {
    const ta = $('notesBody');
    const box = $('notesAc');
    const upto = ta.value.slice(0, ta.selectionStart);
    const m = upto.match(/\[\[([^\]|#\[]*)$/);
    if (!m) { if (box) box.classList.add('hidden'); return; }
    const q = m[1].toLowerCase();
    const matches = allNotes.filter((n) => n.title.toLowerCase().indexOf(q) >= 0).slice(0, 8);
    if (!box) return;
    if (!matches.length) { box.classList.add('hidden'); return; }
    box.innerHTML = matches.map((n) => `<div class="notes-ac-item" data-title="${esc(n.title)}">${esc(n.title)}</div>`).join('');
    box.classList.remove('hidden');
    qsa('.notes-ac-item', box).forEach((it) => it.addEventListener('mousedown', (e) => {
      e.preventDefault();
      insertLink(it.dataset.title);
      box.classList.add('hidden');
    }));
  }

  function insertLink(title) {
    const ta = $('notesBody');
    const start = ta.selectionStart;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(ta.selectionEnd);
    const i = before.lastIndexOf('[[');
    if (i < 0) return;
    ta.value = before.slice(0, i) + '[[' + title + ']]' + after;
    const pos = i + 2 + title.length + 2;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    scheduleSave();
  }

  // ───────────────────────────────────────────────────────── search + list load
  async function runSearch() {
    searchQ = $('notesSearch').value.trim();
    if (searchQ) {
      // server-side search to catch notes outside the current filter
      const r = await getJson('/api/notes?q=' + encodeURIComponent(searchQ));
      allNotes = ((r.data && r.data.notes) || []).map((n) => ({ ...n, tags: [] }));
    } else {
      await refreshListOnly();
    }
    renderList();
  }

  async function refreshListOnly() {
    const params = new URLSearchParams();
    if (filterFolder !== null && filterFolder !== '__all__') params.set('folder', filterFolder);
    if (filterTag) params.set('tag', filterTag);
    const r = await getJson('/api/notes' + (params.toString() ? '?' + params : ''));
    allNotes = ((r.data && r.data.notes) || []).map((n) => ({ ...n, tags: n.tags || [] }));
  }

  // ───────────────────────────────────────────────────────── init / bindings
  function bind() {
    const btnNew = $('btnNotesNew');
    const btnToday = $('btnNotesToday');
    const btnEdit = $('btnNotesEdit');
    const btnPreview = $('btnNotesPreview');
    const btnDelete = $('btnNotesDelete');
    const search = $('notesSearch');
    const title = $('notesTitleInput');
    const body = $('notesBody');
    if (btnNew) btnNew.addEventListener('click', () => newNote());
    if (btnToday) btnToday.addEventListener('click', newToday);
    if (btnEdit) btnEdit.addEventListener('click', () => setMode('edit'));
    if (btnPreview) btnPreview.addEventListener('click', () => setMode('preview'));
    if (btnDelete) btnDelete.addEventListener('click', deleteCurrent);
    if (search) search.addEventListener('input', () => { clearTimeout(search._t); search._t = setTimeout(runSearch, 250); });
    if (title) title.addEventListener('input', () => { clearTimeout(titleTimer); titleTimer = setTimeout(scheduleSave, 400); });
    if (body) {
      body.addEventListener('input', scheduleSave);
      body.addEventListener('keyup', autocomplete);
      body.addEventListener('click', autocomplete);
      body.addEventListener('blur', () => { const box = $('notesAc'); if (box) setTimeout(() => box.classList.add('hidden'), 150); });
    }
  }

  async function init() {
    bind();
    await refreshListOnly();
    renderFolders();
    renderTags();
    renderList();
    renderEditor();
  }

  // The rail button + switchView hook drive refresh(); init runs once on load.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Notes = { refresh, refreshListOnly };
})();