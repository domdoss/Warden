/**
 * Blog Autoposter — nightly research loop + blog poster for aionsystems.ca.
 *
 * Pipeline (all host-side, independent of the chat/model-routing stack):
 *   research()  -> pull recent AI/business news from RSS, build grounded notes
 *   writePost() -> ask Warden's model for one structured post, grounded in
 *                  those notes
 *   renderPost()-> put it into the exact aionsystems.ca blog template
 *   wire()      -> append to blog.html's blogPosts array + sitemap.xml
 *   deploy()    -> FTP the changed files to aionsystems.ca (basic-ftp)
 *
 * If autoPublish is off, drafts land in blog-queue.json for one-click review
 * in the dashboard Blog tab; publishDraft() renders+wires+deploys on demand.
 *
 * The writer uses Warden's own model (the configured atlas model, via
 * llm-client). If the model is unavailable the run reports that and stops —
 * there is no separate LLM config and no fallback.
 */
import * as fs from 'fs';
import * as path from 'path';
import { WORKSPACE_ROOT } from './config.js';
import { getRouterState } from './db.js';
import { llmChat } from './llm-client.js';
import { logger } from './logger.js';
import { Client as FtpClient } from 'basic-ftp';

export interface BlogConfig {
  enabled: boolean;
  cron: string;
  autoPublish: boolean;
  perRunCount: number;
  blogRoot: string;
  blogBaseUrl: string;
  ftpHost: string;
  ftpUser: string;
  ftpPass: string;
  ftpRemoteRoot: string;
  topicsHint: string;
}

export interface BlogSource {
  title: string;
  url: string;
  snippet: string;
}

export interface BlogDraft {
  id: string;
  title: string;
  slug: string;
  date: string;
  iso: string;
  category: string;
  excerpt: string;
  image: string;
  body: string;
  sources: BlogSource[];
  createdAt: string;
  status: 'queued' | 'published';
}

const CONFIG_PATH = path.join(WORKSPACE_ROOT, 'blog-autoposter.json');
const BRIEF_PATH = path.join(WORKSPACE_ROOT, 'BLOG_BRIEF.md');
const QUEUE_PATH = path.join(WORKSPACE_ROOT, 'blog-queue.json');
const HISTORY_PATH = path.join(WORKSPACE_ROOT, 'blog-history.json');

export const DEFAULT_BLOG_CRON = '0 2 * * *';
const DEFAULT_BLOG_ROOT = '/home/user/Projects/aionsystems';
const DEFAULT_BLOG_URL = 'https://aionsystems.ca';
const MAX_PER_RUN = 3;

const DEFAULT_BRIEF = `# AiOn Systems blog — editorial brief

Audience: Canadian small and service businesses (trades, clinics, agencies, retailers, professional services).
Voice: practical, specific, no hype. Concrete Canadian examples. Short paragraphs.

Mix each batch of posts roughly:
- NEWS: grounded in current AI/tech business news (pricing changes, adoption data, regulation, tooling).
- EVERGREEN: "AI-powered X for Canadian service businesses" how-to pieces tied to the season.

Rules:
- Do NOT make every post about local AI. Note local/self-hosted AI where it is genuinely relevant (cost, data sovereignty, compute scarcity), then move on.
- The AI cost hike is a recurring theme: model/API price increases, expiring promos, compute scarcity. Mention it where relevant.
- Every factual claim must come from the research notes provided. If a fact is not in the notes, do not state it as fact. Do not invent statistics, quotes, prices, or studies.
- No fabricated dates, people, or named companies as sources.`;

const IMAGE_POOL = [
  'photo-1504868584819-f8e8b4b6d7e3',
  'photo-1551288049-bebda4e38f71',
  'photo-1553877522-43269d4ea984',
  'photo-1454165804606-c3d57bc86b40',
  'photo-1554224155-8d04cb21cd6c',
  'photo-1517245386807-bb43f82c33c4',
  'photo-1531482615713-2afd69097998',
  'photo-1521791136064-7986c2920216',
  'photo-1507761906261-d31a39975ce4',
  'photo-1516035069371-29a1b244cc32',
  'photo-1551836022-deb4988cc6c0',
  'photo-1621905251189-08b45d6a269e',
  'photo-1506784983877-45594efa4cbe',
  'photo-1551434678-e076c223a692',
];

const CATEGORIES = ['AI & Automation', 'AI News', 'Digital Marketing', 'Local AI'];

function readJson<T>(p: string, dflt: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return dflt;
  }
}
function writeJson(p: string, data: unknown): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

export function defaultBlogConfig(): BlogConfig {
  return {
    enabled: false,
    cron: DEFAULT_BLOG_CRON,
    autoPublish: false,
    perRunCount: 1,
    blogRoot: DEFAULT_BLOG_ROOT,
    blogBaseUrl: DEFAULT_BLOG_URL,
    ftpHost: '',
    ftpUser: '',
    ftpPass: '',
    ftpRemoteRoot: '',
    topicsHint: '',
  };
}

export function readBlogConfig(): BlogConfig {
  const raw = readJson<Partial<BlogConfig>>(CONFIG_PATH, {});
  const base = defaultBlogConfig();
  // env supplies secrets / overrides so they need not live in the JSON
  return {
    ...base,
    ...raw,
    ftpHost: raw.ftpHost || process.env.BLOG_FTP_HOST || 'ftp.aionsystems.ca',
    ftpUser: raw.ftpUser || process.env.BLOG_FTP_USER || '',
    ftpPass: raw.ftpPass || process.env.BLOG_FTP_PASS || '',
  };
}

export function writeBlogConfig(patch: Partial<BlogConfig>): BlogConfig {
  const cur = readBlogConfig();
  const next: BlogConfig = { ...cur, ...patch };
  // don't persist secrets to JSON
  const persisted: Partial<BlogConfig> = { ...next };
  delete persisted.ftpPass;
  writeJson(CONFIG_PATH, persisted);
  return next;
}

function readBrief(): string {
  try {
    return fs.readFileSync(BRIEF_PATH, 'utf8').trim() || DEFAULT_BRIEF;
  } catch {
    return DEFAULT_BRIEF;
  }
}

export function getBlogQueue(): BlogDraft[] {
  return readJson<BlogDraft[]>(QUEUE_PATH, []);
}
export function getBlogHistory(): BlogDraft[] {
  return readJson<BlogDraft[]>(HISTORY_PATH, []).slice(0, 100);
}
function saveQueue(q: BlogDraft[]): void {
  writeJson(QUEUE_PATH, q);
}
function appendHistory(d: BlogDraft): void {
  const h = readJson<BlogDraft[]>(HISTORY_PATH, []);
  h.unshift(d);
  writeJson(HISTORY_PATH, h.slice(0, 100));
}

// ── Model call: the configured OpenAI-compatible LLM ───────────────────────
async function chatComplete(
  system: string,
  user: string,
  maxTokens: number,
): Promise<string | null> {
  const model = (getRouterState('atlas:model') || '').replace(/^local:/, '').trim();
  const res = await llmChat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    model: model || undefined,
    temperature: 0.6,
    maxTokens,
  });
  return res.content?.trim() || null;
}

// ── Research loop (RSS) ─────────────────────────────────────────────────────
function stripTags(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFeed(url: string): Promise<BlogSource[]> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WardenBlogBot/1.0)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return [];
    const xml = await r.text();
    const items = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
    const out: BlogSource[] = [];
    for (const it of items.slice(0, 8)) {
      const title = stripTags((it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
      let link = stripTags((it.match(/<link[^>]*>([\s\S]*?)<\/link>/) || [])[1] || '');
      if (!link) {
        const href = it.match(/<link[^>]*href="([^"]+)"/);
        link = href ? href[1] : '';
      }
      const desc = stripTags(
        (it.match(/<(description|summary)[^>]*>([\s\S]*?)<\/\1>/) || [])[2] || '',
      );
      if (title) out.push({ title, url: link, snippet: desc.slice(0, 320) });
    }
    return out;
  } catch {
    return [];
  }
}

async function research(topicsHint: string): Promise<{ notes: string; sources: BlogSource[] }> {
  const feeds = [
    `https://news.google.com/rss/search?q=${encodeURIComponent(
      'artificial intelligence small business Canada' + (topicsHint ? ' ' + topicsHint : ''),
    )}&hl=en-CA&gl=CA&ceid=CA:en`,
    'https://techcrunch.com/category/artificial-intelligence/feed/',
    'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  ];
  const results = await Promise.all(feeds.map(fetchFeed));
  const all: BlogSource[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const s of r) {
      const k = s.title.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(s);
    }
  }
  const sources = all.slice(0, 14);
  const notes = sources
    .map((s, i) => `${i + 1}. ${s.title}\n   URL: ${s.url}\n   ${s.snippet}`)
    .join('\n');
  return { notes, sources };
}

// ── Writer ──────────────────────────────────────────────────────────────────
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/['’"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function parseJsonObj(raw: string): Record<string, any> | null {
  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function localIsoDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function displayDate(iso: string): string {
  const [y, m, d] = iso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

async function uniqueSlug(blogRoot: string, base: string): Promise<string> {
  let slug = base;
  let i = 2;
  while (fs.existsSync(path.join(blogRoot, 'blog', `${slug}.html`))) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

async function writePost(
  cfg: BlogConfig,
  brief: string,
  notes: string,
  hint: string,
): Promise<BlogDraft | null> {
  const iso = localIsoDate();
  const system = `You are a senior content writer for AiOn Systems (aionsystems.ca), an AI agency serving Canadian small and service businesses. You write one complete blog post and return ONLY a JSON object — no prose, no code fences.

Return exactly this shape:
{"title": "string", "category": "AI & Automation | AI News | Digital Marketing | Local AI", "excerpt": "string (<=160 chars)", "body_html": "<p>..</p><h2>..</h2>.."}

Rules:
- The body_html must be valid HTML using only <p>, <h2>, and <ul>/<li>. Aim ~600-800 words: an intro, 3-4 <h2> sections, a conclusion.
- Ground every factual claim in the RESEARCH NOTES. Do not invent statistics, prices, quotes, or studies. If you are unsure, write generally instead.
- Follow the EDITORIAL BRIEF: Canadian angle, practical, local AI noted only where relevant, the AI cost hike mentioned where relevant.
- Canadian spelling. No em-dashes overuse. No markdown, HTML only.`;
  const user = `EDITORIAL BRIEF:\n${brief}\n\nRESEARCH NOTES (facts you may use):\n${notes || '(no fresh notes — write an evergreen how-to that needs no specific facts)'}\n\n${hint ? 'EXTRA DIRECTION: ' + hint + '\n\n' : ''}Write one post for today (${iso}).`;

  const raw = await chatComplete(system, user, 4000);
  if (!raw) return null;
  const obj = parseJsonObj(raw);
  if (!obj || typeof obj.title !== 'string' || typeof obj.body_html !== 'string') return null;

  const title = obj.title.trim().slice(0, 140);
  const category = CATEGORIES.includes(obj.category) ? obj.category : 'AI & Automation';
  const excerpt = String(obj.excerpt || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160) || title;
  let body = String(obj.body_html).trim();
  // basic safety: strip script/style
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

  const slug = await uniqueSlug(cfg.blogRoot, slugify(title));
  const imgId = IMAGE_POOL[Math.abs([...slug].reduce((a, c) => a + c.charCodeAt(0), 0)) % IMAGE_POOL.length];
  return {
    id: slug,
    title,
    slug,
    date: displayDate(iso),
    iso,
    category,
    excerpt,
    image: `https://images.unsplash.com/${imgId}?w=1200&q=80`,
    body,
    sources: [],
    createdAt: new Date().toISOString(),
    status: 'queued',
  };
}

// ── Render (aionsystems template) ───────────────────────────────────────────
let cachedCss: string | null = null;
function getTemplateCss(blogRoot: string): string {
  if (cachedCss) return cachedCss;
  const ref = path.join(
    blogRoot,
    'blog',
    'ai-powered-q4-planning-how-canadian-service-businesses-are-finishing-the-year-strong-in-2026.html',
  );
  const html = fs.readFileSync(ref, 'utf8');
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error('blog template <style> block not found in reference post');
  cachedCss = m[1];
  return cachedCss;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderPost(cfg: BlogConfig, d: BlogDraft): string {
  const css = getTemplateCss(cfg.blogRoot);
  const url = `${cfg.blogBaseUrl}/blog/${d.slug}.html`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: d.title,
    description: d.excerpt,
    image: d.image,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'AiOn Systems Team' },
    publisher: {
      '@type': 'Organization',
      name: 'AiOn Systems',
      logo: {
        '@type': 'ImageObject',
        url: 'https://aionsystems.ca/images/Red-and-Black-Modern-AI-Technology-Logo-5-2.png',
      },
    },
    datePublished: d.iso,
    dateModified: d.iso,
    articleSection: d.category,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${esc(d.excerpt)}">
    <title>${esc(d.title)} — AiOn Systems Blog</title>
    <link rel="canonical" href="${url}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="AiOn Systems">
    <meta property="og:title" content="${esc(d.title)}">
    <meta property="og:description" content="${esc(d.excerpt)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${d.image}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(d.title)}">
    <meta name="twitter:description" content="${esc(d.excerpt)}">
    <meta name="twitter:image" content="${d.image}">
    <script type="application/ld+json">${JSON.stringify(ld)}</script>

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@100..900&family=Roboto:wght@100..900&family=Poppins:wght@100..900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>${css}</style>
</head>
<body>
    <header class="header">
        <div class="header-inner">
            <a href="../index.html" class="logo">
                <img src="../images/Red-and-Black-Modern-AI-Technology-Logo-5-2.png" alt="AiOn Systems Logo">
            </a>
            <nav class="nav">
                <a href="../index.html">Home</a>
                <a href="../about.html">About</a>
                <a href="../special-projects.html">Special Projects</a>
                <a href="../one-on-one.html">1-on-1</a>
                <a href="../foundry.html">Course</a>
                <a href="../blog.html" class="active">Blog</a>
                <a href="../contact.html">Contact</a>
            </nav>
        </div>
    </header>

    <article>
        <div class="container article-hero">
            <a href="../blog.html" class="back-link"><i class="fas fa-arrow-left"></i> Back to Blog</a>
            <span class="category-badge">${esc(d.category)}</span>
            <h1>${esc(d.title)}</h1>
            <div class="article-meta">
                <span><i class="far fa-calendar-alt"></i> ${esc(d.date)}</span>
                <span><i class="far fa-clock"></i> 6 min read</span>
                <span><i class="far fa-user"></i> AiOn Systems Team</span>
            </div>
        </div>

        <div class="container">
            <img class="featured-image" src="${d.image}" alt="${esc(d.title)}">

            <div class="article-content">
${d.body}
            </div>

            <hr class="article-divider">

            <div class="share-section">
                <h3>Share This Article</h3>
                <div class="share-buttons">
                    <a href="#" class="share-btn" aria-label="Share on Facebook"><i class="fab fa-facebook-f"></i></a>
                    <a href="#" class="share-btn" aria-label="Share on LinkedIn"><i class="fab fa-linkedin-in"></i></a>
                    <a href="#" class="share-btn" aria-label="Share on X"><i class="fab fa-x-twitter"></i></a>
                    <a href="#" class="share-btn" aria-label="Copy Link"><i class="fas fa-link"></i></a>
                </div>
            </div>
        </div>
    </article>

    <footer class="footer">
        <div class="container">
            <p>&copy; 2026 AiOn Systems Inc. All rights reserved. | <a href="../index.html">Home</a> | <a href="../blog.html">Blog</a></p>
        </div>
    </footer>
</body>
</html>
`;
}

// ── Wiring: blog.html + sitemap.xml ─────────────────────────────────────────
function findArrayEnd(src: string, startBracket: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startBracket; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function wireBlogHtml(blogRoot: string, d: BlogDraft): void {
  const p = path.join(blogRoot, 'blog.html');
  let src = fs.readFileSync(p, 'utf8');
  const marker = 'const blogPosts = ';
  const mIdx = src.indexOf(marker);
  if (mIdx === -1) throw new Error('blogPosts array not found in blog.html');
  const arrStart = src.indexOf('[', mIdx + marker.length);
  const arrEnd = findArrayEnd(src, arrStart);
  if (arrEnd === -1) throw new Error('blogPosts array end not found');
  const arr = JSON.parse(src.slice(arrStart, arrEnd + 1)) as any[];
  const entry = {
    id: d.slug,
    title: d.title,
    date: d.date,
    category: d.category,
    image: d.image.replace('w=1200', 'w=600'),
    excerpt: d.excerpt,
    _iso: d.iso,
  };
  const have = new Set(arr.map((e) => e.id));
  if (!have.has(d.slug)) arr.push(entry);
  arr.sort((a, b) => {
    const ai = a._iso || '';
    const bi = b._iso || '';
    return ai < bi ? 1 : ai > bi ? -1 : 0;
  });
  const body = JSON.stringify(arr, null, 8)
    .split('\n')
    .map((ln) => (ln.trim() ? '        ' + ln : ln))
    .join('\n')
    .replace(/^\s+/, '');
  const stmtStart = mIdx;
  let semi = src.indexOf(';', arrEnd);
  if (semi === -1) semi = src.length;
  src = src.slice(0, stmtStart) + marker + body + ';' + src.slice(semi + 1);
  fs.writeFileSync(p, src, 'utf8');
}

function wireSitemap(blogRoot: string, d: BlogDraft): void {
  const p = path.join(blogRoot, 'sitemap.xml');
  let sm = fs.readFileSync(p, 'utf8');
  const loc = `${readBlogConfig().blogBaseUrl}/blog/${d.slug}.html`;
  if (sm.includes(loc)) return;
  const block =
    '    <url>\n' +
    `        <loc>${loc}</loc>\n` +
    `        <lastmod>${d.iso}</lastmod>\n` +
    '        <changefreq>monthly</changefreq>\n' +
    '        <priority>0.6</priority>\n' +
    '    </url>\n';
  sm = sm.replace('</urlset>', block + '</urlset>');
  fs.writeFileSync(p, sm, 'utf8');
}

// ── Deploy (FTP) ─────────────────────────────────────────────────────────────
async function deployFiles(cfg: BlogConfig, files: string[]): Promise<void> {
  if (!cfg.ftpUser || !cfg.ftpPass) throw new Error('FTP credentials not configured (BLOG_FTP_USER / BLOG_FTP_PASS)');
  const client = new FtpClient(30_000);
  try {
    await client.access({ host: cfg.ftpHost, user: cfg.ftpUser, password: cfg.ftpPass, secure: true });
    await client.cd(cfg.ftpRemoteRoot || '/');
    for (const rel of files) {
      const local = path.join(cfg.blogRoot, rel);
      const remote = '/' + rel.split(path.sep).join('/');
      const st = fs.statSync(local);
      await client.ensureDir(path.posix.dirname(remote));
      await client.uploadFrom(local, path.posix.basename(remote));
      logger.info({ local, remote, bytes: st.size }, 'blog autoposter: uploaded');
    }
  } finally {
    client.close();
  }
}

// ── Public operations ────────────────────────────────────────────────────────
export interface RunResult {
  ok: boolean;
  message: string;
  drafts?: BlogDraft[];
  published?: string[];
}

export async function runBlogAutoposter(): Promise<RunResult> {
  const cfg = readBlogConfig();
  const brief = readBrief();
  const count = Math.max(1, Math.min(MAX_PER_RUN, cfg.perRunCount || 1));
  const results: BlogDraft[] = [];
  const published: string[] = [];

  const { notes, sources } = await research(cfg.topicsHint);

  for (let i = 0; i < count; i++) {
    const hint = i > 0 ? 'Write a different angle/post from the previous one in this batch.' : '';
    const draft = await writePost(cfg, brief, notes, [cfg.topicsHint, hint].filter(Boolean).join('. '));
    if (!draft) continue;
    draft.sources = sources.slice(0, 6);
    if (cfg.autoPublish) {
      await publishDraft(draft);
      draft.status = 'published';
      published.push(draft.slug);
    } else {
      const q = getBlogQueue();
      q.unshift(draft);
      saveQueue(q);
    }
    appendHistory(draft);
    results.push(draft);
  }

  if (results.length === 0) {
    return {
      ok: false,
      message:
        'No post generated — Warden’s model returned nothing (is Ollama / the configured model available?).',
    };
  }
  return {
    ok: true,
    message: cfg.autoPublish
      ? `Generated and published ${published.length} post(s).`
      : `Generated ${results.length} draft(s) — awaiting review in the Blog tab.`,
    drafts: results,
    published,
  };
}

export async function publishDraft(d: BlogDraft): Promise<void> {
  const cfg = readBlogConfig();
  const dir = path.join(cfg.blogRoot, 'blog');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${d.slug}.html`), renderPost(cfg, d), 'utf8');
  wireBlogHtml(cfg.blogRoot, d);
  wireSitemap(cfg.blogRoot, d);
  if (cfg.ftpUser && cfg.ftpPass) {
    await deployFiles(cfg, [`blog/${d.slug}.html`, 'blog.html', 'sitemap.xml']);
  }
}

export async function publishDraftById(id: string): Promise<RunResult> {
  const q = getBlogQueue();
  const d = q.find((x) => x.id === id);
  if (!d) return { ok: false, message: `draft ${id} not found` };
  try {
    await publishDraft(d);
  } catch (err) {
    return { ok: false, message: `publish failed: ${String((err as Error)?.message || err)}` };
  }
  d.status = 'published';
  saveQueue(q.filter((x) => x.id !== id));
  appendHistory(d);
  return { ok: true, message: `Published ${d.slug}`, published: [d.slug] };
}

export function dismissDraft(id: string): RunResult {
  const q = getBlogQueue();
  const next = q.filter((x) => x.id !== id);
  if (next.length === q.length) return { ok: false, message: `draft ${id} not found` };
  saveQueue(next);
  return { ok: true, message: `Dismissed ${id}` };
}
