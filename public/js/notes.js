/* ===== Notes view — Obsidian-inspired, filesystem-backed =====
 * Self-contained: own `$` + `api()` wrapper, talks to /api/notes/* directly.
 * Storage is the real filesystem (see src/notes-fs.ts): notes are .md files, the
 * vault root is the user's home dir, and the folder browser has full filesystem
 * access (breadcrumb goes up to /). The [[link]] graph + #tags + backlinks are
 * derived from the .md corpus under home (cached server-side).
 *
 * The left rail is a lazily-expanded folder tree (root-level dirs only until you
 * click a caret). Notes/folders can be ignored — ignored entries drop out of the
 * corpus and surface in the "Ignored" view, where they can be restored.
 *
 * Note identity is the absolute file path, base64url-encoded as :p in the
 * /api/notes/file/:p routes. Editing uses a plain <textarea>; the preview pane
 * renders an extended markdown superset (tables, hr, images, strike, task lists,
 * nested lists) with [[wiki-links]] and #tags rewritten to in-tab links.
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

  function b64u(s) { const b = btoa(unescape(encodeURIComponent(String(s)))); return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  const fileUrl = (abs) => '/api/notes/file/' + b64u(abs);

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
  let corpus = [];          // every non-ignored .md under home — for [[link]] resolution + autocomplete
  let folders = [];         // [{folder, count}] — dirs under home containing .md
  let tags = [];            // [{tag, count}]
  let folderTree = { name: 'Home', abs: '/', children: {}, subtree: 0 };
  let folderTreeMap = {};
  let current = null;       // full open note
  let cwd = null;           // absolute path of the folder currently being browsed
  let root = '/';           // NOTES_ROOT (home)
  let filterTag = null;
  let searchQ = '';
  let ignoredView = false;
  let ignoredFiles = [];
  let ignoredFolders = [];
  let mode = 'edit';
  let saveTimer = null;
  let titleTimer = null;
  let folderNotes = [];
  let corpusResults = [];
  let listDirs = [];

  // ───────────────────────────────────────────────────────── refresh
  async function refresh() {
    await loadIndex();
    renderFolders();
    renderTags();
    await refreshListOnly();
    renderList();
    renderBreadcrumb();
    if (current) {
      const r = await getJson(fileUrl(current.path));
      if (r.ok && r.data && r.data.note) { current = r.data.note; renderEditor(); }
    }
  }

  async function loadIndex() {
    const [ir, fr, tr] = await Promise.all([
      getJson('/api/notes/index'),
      getJson('/api/notes/folders'),
      getJson('/api/notes/tags'),
    ]);
    corpus = (ir.data && ir.data.notes) || [];
    root = (ir.data && ir.data.root) || root;
    folders = (fr.data && fr.data.folders) || [];
    tags = (tr.data && tr.data.tags) || [];
    if (cwd == null) cwd = root;
    buildFolderTree();
  }

  // Backwards-compat alias used by the app.js switchView hook.
  async function loadFolderList() {}

  // ───────────────────────────────────────────────────────── folder tree (lazy)
  function buildFolderTree() {
    const t = { name: 'Home', abs: root, children: {}, subtree: 0 };
    const map = {};
    map[root] = t;
    for (const f of folders) {
      const parts = String(f.folder || '').split('/').filter(Boolean);
      let node = t;
      let acc = root;
      for (const p of parts) {
        acc = acc.replace(/\/+$/, '') + '/' + p;
        if (!node.children[p]) {
          node.children[p] = { name: p, abs: acc, children: {}, subtree: 0, direct: 0 };
          map[acc] = node.children[p];
        }
        node = node.children[p];
      }
      node.direct = (node.direct || 0) + (f.count || 0);
    }
    (function sum(n) {
      let s = n.direct || 0;
      for (const k in n.children) s += sum(n.children[k]);
      n.subtree = s;
      return s;
    })(t);
    folderTree = t;
    folderTreeMap = map;
  }

  function renderFolders() {
    const el = $('notesFolders');
    if (!el) return;
    if (ignoredView) { el.innerHTML = '<div class="dim" style="font-size:12px;padding:4px 0">hidden in Ignored view</div>'; return; }
    // Flat list: Home + top-level directories only (no nested tree).
    const homeActive = (cwd === root && !filterTag && !searchQ) ? ' active' : '';
    let html = `<div class="notes-folder${homeActive}" data-folder="${esc(root)}">Home <span class="dim">${folderTree.subtree || 0}</span></div>`;
    const top = Object.keys(folderTree.children).sort();
    html += top.map((k) => {
      const n = folderTree.children[k];
      // active when browsing this top-level dir or anywhere under it
      const active = (cwd && (cwd === n.abs || cwd.startsWith(n.abs + '/')) && !filterTag && !searchQ) ? ' active' : '';
      return `<div class="notes-folder${active}" data-folder="${esc(n.abs)}">${esc(k)} <span class="dim">${n.subtree || 0}</span></div>`;
    }).join('');
    el.innerHTML = html;
    qsa('.notes-folder', el).forEach((b) => b.addEventListener('click', () => goFolder(b.dataset.folder)));
  }

  // ───────────────────────────────────────────────────────── tags
  function renderTags() {
    const el = $('notesTags');
    if (!el) return;
    if (ignoredView) { el.innerHTML = ''; return; }
    if (!tags.length) { el.innerHTML = '<span class="dim" style="font-size:12px">none yet</span>'; return; }
    el.innerHTML = tags.map((t) => `<span class="notes-tag-chip${filterTag === t.tag ? ' active' : ''}" data-tag="${esc(t.tag)}">#${esc(t.tag)} <span class="dim">${t.count}</span></span>`).join(' ');
    qsa('.notes-tag-chip', el).forEach((c) => c.addEventListener('click', async () => {
      filterTag = filterTag === c.dataset.tag ? null : c.dataset.tag;
      searchQ = ''; ignoredView = false; $('notesSearch').value = '';
      await refreshListOnly();
      renderFolders(); renderTags(); renderList(); renderBreadcrumb();
    }));
  }

  // ───────────────────────────────────────────────────────── breadcrumb
  function renderBreadcrumb() {
    const el = $('notesFolderLabel');
    if (!el) return;
    if (ignoredView) { el.innerHTML = '<span class="notes-crumb-here">Ignored</span>'; el.className = 'dim notes-crumb'; return; }
    if (filterTag) { el.innerHTML = '<span class="dim">tag:</span> #' + esc(filterTag); el.className = 'dim notes-crumb'; return; }
    if (searchQ) { el.innerHTML = '<span class="dim">search:</span> ' + esc(searchQ); el.className = 'dim notes-crumb'; return; }
    if (cwd == null) { el.textContent = ''; return; }
    const rel = pathRelative(root, cwd);
    const parts = rel === '' ? [] : rel.split('/');
    const segs = [{ label: 'Home', abs: root }];
    let acc = root;
    parts.forEach((p) => { acc = acc.replace(/\/+$/, '') + '/' + p; segs.push({ label: p, abs: acc }); });
    const up = parentOf(cwd);
    let html = (up ? `<span class="notes-crumb-up" data-abs="${esc(up)}" title="${esc(up)}">↑</span> ` : '');
    html += segs.map((s, i) => (i < segs.length - 1 ? `<span class="notes-crumb-seg" data-abs="${esc(s.abs)}">${esc(s.label)}</span> / ` : `<span class="notes-crumb-here">${esc(s.label)}</span>`)).join('');
    el.innerHTML = html;
    el.className = 'dim notes-crumb';
    qsa('.notes-crumb-seg', el).forEach((s) => s.addEventListener('click', () => goFolder(s.dataset.abs)));
    const u = qs('.notes-crumb-up', el);
    if (u) u.addEventListener('click', () => goFolder(u.dataset.abs));
  }

  function pathRelative(base, target) {
    const a = base.replace(/\/+$/, '').split('/').filter(Boolean);
    const b = target.replace(/\/+$/, '').split('/').filter(Boolean);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    const ups = a.length - i;
    const rest = b.slice(i);
    return Array(ups).fill('..').concat(rest).join('/') || '.';
  }
  function parentOf(abs) {
    if (abs === '/' || abs === '') return null;
    const p = abs.replace(/\/+$/, '');
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }
  async function goFolder(abs) {
    cwd = abs || root;
    filterTag = null; searchQ = ''; ignoredView = false;
    $('notesSearch').value = '';
    await refreshListOnly();
    renderFolders(); renderTags(); renderList(); renderBreadcrumb();
  }

  // ───────────────────────────────────────────────────────── list
  function visibleNotes() {
    return (filterTag || searchQ) ? corpusResults : folderNotes;
  }

  function renderList() {
    const el = $('notesList');
    if (!el) return;
    if (ignoredView) { renderIgnored(el); return; }
    const list = visibleNotes();
    let html = '';
    if (!filterTag && !searchQ) {
      listDirs.forEach((d) => {
        const abs = cwd.replace(/\/+$/, '') + '/' + d;
        html += `<div class="notes-item notes-dir" data-abs="${esc(abs)}"><div class="notes-item-title">📁 ${esc(d)}</div></div>`;
      });
    }
    if (!list.length && !listDirs.length) {
      html += '<div class="dim" style="padding:14px">No notes here. Click + New.</div>';
    }
    html += list.map((n) => {
      const active = current && current.path === n.path ? ' active' : '';
      const sub = n.folder ? esc(n.folder) + ' · ' : '';
      const when = new Date(n.mtime).toLocaleDateString();
      return `<div class="notes-item${active}" data-abs="${esc(n.path)}"><div class="notes-item-title">${esc(n.title)}</div><div class="notes-item-sub dim">${sub}${when}</div></div>`;
    }).join('');
    el.innerHTML = html;
    qsa('.notes-item', el).forEach((it) => it.addEventListener('click', () => {
      if (it.classList.contains('notes-dir')) goFolder(it.dataset.abs);
      else openNote(it.dataset.abs);
    }));
  }

  // ───────────────────────────────────────────────────────── ignored view
  async function openIgnoredView() {
    ignoredView = true;
    filterTag = null; searchQ = ''; $('notesSearch').value = '';
    const r = await getJson('/api/notes/ignored');
    ignoredFiles = (r.data && r.data.files) || [];
    ignoredFolders = (r.data && r.data.folders) || [];
    renderFolders(); renderTags(); renderBreadcrumb(); renderList();
  }

  function renderIgnored(el) {
    let html = '';
    if (ignoredFolders.length) {
      html += '<div class="dim notes-ign-head">Folders</div>';
      html += ignoredFolders.map((f) => {
        const cnt = f.count ? ` <span class="dim">${f.count}</span>` : '';
        const gone = f.exists ? '' : ' <span class="dim">(gone)</span>';
        return `<div class="notes-item notes-ignored" data-folder="${esc(f.path)}"><div class="notes-item-title">📁 ${esc(f.rel)}${gone}${cnt}</div><button class="btn btn-ghost btn-sm notes-restore" data-folder="${esc(f.path)}">Restore</button></div>`;
      }).join('');
    }
    if (ignoredFiles.length) {
      html += '<div class="dim notes-ign-head">Files</div>';
      html += ignoredFiles.map((f) => {
        const gone = f.exists ? '' : ' <span class="dim">(gone)</span>';
        return `<div class="notes-item notes-ignored" data-path="${esc(f.path)}"><div class="notes-item-title">📄 ${esc(f.title)} <span class="dim">${esc(f.rel)}</span>${gone}</div><button class="btn btn-ghost btn-sm notes-restore" data-path="${esc(f.path)}">Restore</button></div>`;
      }).join('');
    }
    if (!ignoredFolders.length && !ignoredFiles.length) {
      html = '<div class="dim" style="padding:14px">Nothing ignored.</div>';
    }
    el.innerHTML = html;
    qsa('.notes-restore', el).forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const body = b.dataset.path ? { path: b.dataset.path } : { folder: b.dataset.folder };
      await postJson('/api/notes/unignore', body);
      await loadIndex();
      const r = await getJson('/api/notes/ignored');
      ignoredFiles = (r.data && r.data.files) || [];
      ignoredFolders = (r.data && r.data.folders) || [];
      renderFolders(); renderTags(); renderList();
    }));
  }

  // ───────────────────────────────────────────────────────── open / edit
  async function openNote(abs) {
    const r = await getJson(fileUrl(abs));
    if (!r.ok || !r.data || !r.data.note) { toast('Could not open note', 'error'); return; }
    current = r.data.note;
    ignoredView = false;
    setMode('edit');
    renderEditor();
    renderList();
    renderBreadcrumb();
  }

  function renderEditor() {
    const btnIgnore = $('btnNotesIgnore');
    if (!current) {
      $('notesEditorPane').classList.add('hidden');
      $('notesPreviewPane').classList.add('hidden');
      $('notesBacklinks').innerHTML = '';
      $('btnNotesDelete').classList.add('hidden');
      if (btnIgnore) btnIgnore.classList.add('hidden');
      return;
    }
    $('notesTitleInput').value = current.title;
    $('notesBody').value = current.body;
    $('btnNotesDelete').classList.remove('hidden');
    if (btnIgnore) btnIgnore.classList.remove('hidden');
    if (mode === 'edit') { $('notesEditorPane').classList.remove('hidden'); $('notesPreviewPane').classList.add('hidden'); }
    else { renderPreview(); }
    renderBacklinks();
  }

  async function renderBacklinks() {
    const el = $('notesBacklinks');
    if (!el || !current) { if (el) el.innerHTML = ''; return; }
    const r = await getJson(fileUrl(current.path) + '/backlinks');
    const links = (r.data && r.data.backlinks) || [];
    if (!links.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="dim notes-backlinks-head">Linked from</div>' +
      links.map((b) => `<span class="notes-backlink" data-abs="${esc(b.path)}">${esc(b.title)}</span>`).join('');
    qsa('.notes-backlink', el).forEach((s) => s.addEventListener('click', () => openNote(s.dataset.abs)));
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
    const r = await putJson(fileUrl(current.path), { title, body });
    if (r.ok && r.data && r.data.note) {
      const prevPath = current.path;
      current = r.data.note;
      if (current.path !== prevPath) {
        await loadIndex();
        renderFolders(); renderTags(); renderBreadcrumb();
      }
      const i = corpus.findIndex((n) => n.path === prevPath);
      if (i >= 0) corpus[i] = { ...corpus[i], path: current.path, title: current.title, uid: current.uid };
      renderList();
      renderBacklinks();
    } else {
      toast('Save failed', 'error');
    }
  }

  // ───────────────────────────────────────────────────────── new / today / delete / ignore
  async function newNote(title) {
    const r = await postJson('/api/notes', { title: title || 'Untitled', body: '', folder: cwd || root });
    if (r.ok && r.data && r.data.note) {
      await loadIndex();
      renderFolders(); renderTags();
      current = r.data.note;
      corpus.unshift({ path: current.path, title: current.title, uid: current.uid, mtime: current.mtime });
      cwd = parentOf(current.path) || root;
      ignoredView = false;
      await refreshListOnly();
      setMode('edit');
      renderEditor(); renderList(); renderBreadcrumb();
      $('notesTitleInput').focus();
      $('notesTitleInput').select();
    } else {
      toast('Create failed', 'error');
    }
  }

  function newToday() {
    const title = dateStr(new Date());
    const uid = slugify(title);
    const found = corpus.find((n) => n.uid === uid);
    if (found) { openNote(found.path); return; }
    newNote(title);
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!confirm('Delete "' + current.title + '"?')) return;
    const abs = current.path;
    const r = await del(fileUrl(abs));
    if (r.ok) {
      corpus = corpus.filter((n) => n.path !== abs);
      current = null;
      await loadIndex();
      renderFolders(); renderTags(); await refreshListOnly(); renderList(); renderEditor();
    } else {
      toast('Delete failed', 'error');
    }
  }

  async function ignoreCurrent() {
    if (!current) return;
    const abs = current.path;
    const r = await postJson('/api/notes/ignore', { path: abs });
    if (r.ok) {
      current = null;
      await loadIndex();
      renderFolders(); renderTags(); await refreshListOnly(); renderList(); renderEditor();
      toast('Ignored');
    } else {
      toast('Ignore failed', 'error');
    }
  }

  async function ignoreCwd() {
    const abs = cwd || root;
    if (abs === root) { toast("Can't ignore home", 'error'); return; }
    const r = await postJson('/api/notes/ignore', { folder: abs });
    if (r.ok) {
      // the ignored folder is now hidden from the corpus; jump to root
      cwd = root;
      await loadIndex();
      renderFolders(); renderTags(); await refreshListOnly(); renderList(); renderBreadcrumb();
      toast('Ignored ' + abs);
    } else {
      toast('Ignore failed', 'error');
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
    qsa('.note-wikilink', el).forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const uid = a.dataset.noteUid;
      const target = corpus.find((n) => n.uid === uid);
      if (target) openNote(target.path);
      else if (confirm('Create note "' + (a.dataset.label || a.textContent) + '"?')) newNote(a.dataset.label || a.textContent);
    }));
    qsa('.note-inline-tag', el).forEach((t) => t.addEventListener('click', async () => {
      filterTag = t.dataset.tag; searchQ = ''; ignoredView = false;
      $('notesSearch').value = '';
      await refreshListOnly();
      renderFolders(); renderTags(); renderList(); renderBreadcrumb();
    }));
  }

  // Extended markdown renderer (escapes first), with [[wiki-links]] + #tags.
  function renderMarkdown(text) {
    if (!text) return '<p class="dim">Empty note.</p>';
    const fences = [];
    let stashed = String(text).replace(/```(\w*)\r?\n?([\s\S]*?)```/g, (_, lang, body) => {
      const i = fences.length;
      fences.push('<pre><code class="lang-' + esc(lang) + '">' + esc(body.replace(/\n$/, '')) + '</code></pre>');
      return '\x00F' + i + '\x00';
    });

    const knownUids = new Set(corpus.map((n) => n.uid));

    const inline = (s) => {
      let x = esc(s);
      x = x.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>');
      x = x.replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => '<img src="' + url + '" alt="' + esc(alt) + '"' + (title ? ' title="' + esc(title) + '"' : '') + '>');
      x = x.replace(/\[\[([^\]|#\[]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (m, target, alias) => {
        const t = target.trim();
        const label = alias ? alias.trim() : t;
        const uid = slugify(t);
        const cls = knownUids.has(uid) ? 'note-wikilink' : 'note-wikilink unresolved';
        return '<a href="#" class="' + cls + '" data-note-uid="' + esc(uid) + '" data-label="' + esc(label) + '">' + esc(label) + '</a>';
      });
      x = x.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      x = x.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
      x = x.replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s)!?.,;:]|$)/g, '$1<em>$2</em>');
      x = x.replace(/(^|[\s(])_([^_\s][^_\n]*?)_(?=[\s)!?.,;:]|$)/g, '$1<em>$2</em>');
      x = x.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
      x = x.replace(/(^|\s)#([A-Za-z][\w-]*)/g, (_, pre, tag) => pre + '<span class="note-inline-tag" data-tag="' + esc(tag) + '">#' + esc(tag) + '</span>');
      x = x.replace(/\x00F(\d+)\x00/g, (_, i) => fences[Number(i)]);
      return x;
    };

    const lines = stashed.split(/\r?\n/);
    const out = [];
    let listStack = []; // {type, indent}
    let quote = false;
    let para = [];

    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
    const flushList = () => { while (listStack.length) out.push('</li></' + listStack.pop().type + '>'); };
    const flushQuote = () => { if (quote) { out.push('</blockquote>'); quote = false; } };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); };

    const splitRow = (s) => s.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const isTableSep = (s) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(s);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\x00F\d+\x00$/.test(line.trim())) { flushAll(); out.push(inline(line.trim())); continue; }
      if (!line.trim()) { flushAll(); continue; }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { flushAll(); out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); continue; }
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) { flushAll(); out.push('<hr>'); continue; }

      // tables
      if (line.indexOf('|') >= 0 && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        flushAll();
        const headers = splitRow(line);
        const align = splitRow(lines[i + 1]).map((c) => {
          const l = c.startsWith(':'), r = c.endsWith(':');
          return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
        });
        const rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].indexOf('|') >= 0 && lines[j].trim()) { rows.push(splitRow(lines[j])); j++; }
        let t = '<table><thead><tr>';
        headers.forEach((c, k) => t += '<th' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c) + '</th>');
        t += '</tr></thead><tbody>';
        rows.forEach((r) => {
          t += '<tr>';
          r.forEach((c, k) => t += '<td' + (align[k] ? ' style="text-align:' + align[k] + '"' : '') + '>' + inline(c) + '</td>');
          t += '</tr>';
        });
        out.push(t + '</tbody></table>');
        i = j - 1;
        continue;
      }

      // blockquote
      if (/^>\s?/.test(line)) {
        flushPara(); flushList();
        if (!quote) { out.push('<blockquote>'); quote = true; }
        out.push('<p>' + inline(line.replace(/^>\s?/, '')) + '</p>');
        continue;
      }

      // lists (nested via indentation, with task-list checkboxes)
      const ul = line.match(/^(\s*)([-*+])\s+(?:\[( |x|X)\]\s+)?(.*)$/);
      const ol = line.match(/^(\s*)(\d+)\.\s+(?:\[( |x|X)\]\s+)?(.*)$/);
      if (ul || ol) {
        flushPara(); flushQuote();
        const type = ol ? 'ol' : 'ul';
        const indent = (ul ? ul[1] : ol[1]).length;
        const task = ul ? ul[3] : ol[3];
        const content = ul ? ul[4] : ol[4];
        while (listStack.length && listStack[listStack.length - 1].indent > indent) {
          out.push('</li></' + listStack.pop().type + '>');
        }
        const top = listStack[listStack.length - 1];
        if (top && top.indent === indent && top.type === type) {
          out.push('</li>'); // same list, next item
        } else if (top && top.indent === indent && top.type !== type) {
          out.push('</li></' + listStack.pop().type + '>');
          out.push('<' + type + '>');
          listStack.push({ type, indent });
        } else {
          // shallower or empty → new (possibly nested) list
          out.push('<' + type + '>');
          listStack.push({ type, indent });
        }
        let li = inline(content);
        if (task !== undefined) {
          const checked = (task === 'x' || task === 'X') ? ' checked' : '';
          li = '<input type="checkbox" disabled' + checked + ' class="note-task"> ' + li;
          out.push('<li class="note-task-item">' + li);
        } else {
          out.push('<li>' + li);
        }
        continue;
      }

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
    const matches = corpus.filter((n) => n.title.toLowerCase().indexOf(q) >= 0).slice(0, 8);
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
    filterTag = null; ignoredView = false;
    await refreshListOnly();
    renderFolders(); renderTags(); renderList(); renderBreadcrumb();
  }

  async function refreshListOnly() {
    if (ignoredView) return; // ignored view loads its own data
    const params = new URLSearchParams();
    if (filterTag) params.set('tag', filterTag);
    else if (searchQ) params.set('q', searchQ);
    else if (cwd) params.set('folder', cwd);
    const r = await getJson('/api/notes' + (params.toString() ? '?' + params : ''));
    const data = r.data || {};
    if (filterTag || searchQ) {
      corpusResults = data.notes || [];
      listDirs = [];
    } else {
      folderNotes = data.notes || [];
      listDirs = data.dirs || [];
      if (data.folder) cwd = data.folder;
      if (data.root) root = data.root;
    }
  }

  // ───────────────────────────────────────────────────────── init / bindings
  function bind() {
    if (btn('btnNotesNew')) btn('btnNotesNew').addEventListener('click', () => newNote());
    if (btn('btnNotesToday')) btn('btnNotesToday').addEventListener('click', newToday);
    if (btn('btnNotesEdit')) btn('btnNotesEdit').addEventListener('click', () => setMode('edit'));
    if (btn('btnNotesPreview')) btn('btnNotesPreview').addEventListener('click', () => setMode('preview'));
    if (btn('btnNotesDelete')) btn('btnNotesDelete').addEventListener('click', deleteCurrent);
    if (btn('btnNotesIgnore')) btn('btnNotesIgnore').addEventListener('click', ignoreCurrent);
    if (btn('btnNotesIgnoreFolder')) btn('btnNotesIgnoreFolder').addEventListener('click', ignoreCwd);
    if (btn('btnNotesIgnored')) btn('btnNotesIgnored').addEventListener('click', () => {
      if (ignoredView) { ignoredView = false; (async () => { await refreshListOnly(); renderFolders(); renderTags(); renderList(); renderBreadcrumb(); })(); }
      else openIgnoredView();
    });
    const search = $('notesSearch');
    if (search) search.addEventListener('input', () => { clearTimeout(search._t); search._t = setTimeout(runSearch, 250); });
    const title = $('notesTitleInput');
    if (title) title.addEventListener('input', () => { clearTimeout(titleTimer); titleTimer = setTimeout(scheduleSave, 400); });
    const body = $('notesBody');
    if (body) {
      body.addEventListener('input', scheduleSave);
      body.addEventListener('keyup', autocomplete);
      body.addEventListener('click', autocomplete);
      body.addEventListener('blur', () => { const box = $('notesAc'); if (box) setTimeout(() => box.classList.add('hidden'), 150); });
    }
  }
  function btn(id) { return $(id); }

  async function init() {
    bind();
    await loadIndex();
    await refreshListOnly();
    renderFolders();
    renderTags();
    renderList();
    renderBreadcrumb();
    renderEditor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Notes = { refresh, refreshListOnly };
})();