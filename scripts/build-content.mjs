// Build script for VERC.
// Reads content/cbd/*.md -> generates static HTML pages + JSON index + RAG chunks.
// Single source of truth for BOTH the Resources section (point 2) and the RAG agent (point 3).
//
//   node scripts/build-content.mjs
//
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const ROOT = process.cwd();
const CONTENT_DIR = path.join(ROOT, 'content', 'cbd');
const DIST = path.join(ROOT, 'dist');
const PARTIALS = path.join(ROOT, 'partials');
const TEMPLATES = path.join(ROOT, 'templates');
const ASSETS = path.join(ROOT, 'assets');

const TYPE_LABELS = { law: 'Законодавство', research: 'Дослідження', application: 'Застосування', faq: 'FAQ' };
const TYPE_ORDER = { law: 0, research: 1, application: 2, faq: 3 };
const CHUNK_MAX = 1200; // chars per RAG chunk (approx)

const read = (p) => fs.readFileSync(p, 'utf8');
const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });
const write = (p, c) => { ensureDir(path.dirname(p)); fs.writeFileSync(p, c); };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// use a replacer FUNCTION so `$` in injected HTML (e.g. "$35,000") isn't treated as a backreference
const inject = (tpl, token, value) => tpl.replace(new RegExp(token, 'g'), () => value);

// ---- reset dist ----
fs.rmSync(DIST, { recursive: true, force: true });
ensureDir(DIST);

// chat widget injected only once its assets exist (point 3)
const widgetHtml = fs.existsSync(path.join(ASSETS, 'widget.js'))
  ? '<link rel="stylesheet" href="/assets/widget.css" />\n<script src="/assets/widget.js" defer></script>'
  : '';

// ---- landing page + extracted CSS ----
const landing = read(path.join(ROOT, 'index.html'));
// inject the widget before </body> so the chat also appears on the landing page
write(path.join(DIST, 'index.html'), widgetHtml ? landing.replace('</body>', `${widgetHtml}\n</body>`) : landing);
const styleMatch = landing.match(/<style>([\s\S]*?)<\/style>/i);
ensureDir(path.join(DIST, 'assets'));
write(path.join(DIST, 'assets', 'styles.css'), styleMatch ? styleMatch[1].trim() : '');

// ---- copy static assets (resources.css, widget.*, etc.) ----
if (fs.existsSync(ASSETS)) {
  for (const f of fs.readdirSync(ASSETS)) {
    const src = path.join(ASSETS, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(DIST, 'assets', f));
  }
}

// ---- partials & templates ----
const navHtml = read(path.join(PARTIALS, 'nav.html'));
const footerHtml = read(path.join(PARTIALS, 'footer.html'));
const headTpl = read(path.join(PARTIALS, 'head.html'));
const resourceTpl = read(path.join(TEMPLATES, 'resource.html'));
const indexTpl = read(path.join(TEMPLATES, 'resources-index.html'));

const head = (title, desc) =>
  inject(inject(headTpl, '{{TITLE}}', esc(title)), '{{DESCRIPTION}}', esc(desc || ''));

// ---- read content ----
const files = fs.readdirSync(CONTENT_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'));
const items = [];
const chunks = [];

for (const file of files) {
  const { data, content } = matter(read(path.join(CONTENT_DIR, file)));
  if ((data.status || 'published') === 'draft') continue;

  const slug = file.replace(/\.md$/, '');
  const type = data.type || 'research';
  const item = {
    slug, type,
    title: data.title || slug,
    summary: data.summary || '',
    authors: Array.isArray(data.authors) ? data.authors : (data.authors ? [data.authors] : []),
    year: data.year || null,
    lang: data.lang || 'uk',
    source_url: data.source_url || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    url: `/resources/${slug}.html`,
  };
  items.push(item);

  // ----- single resource page -----
  const bodyHtml = marked.parse(content);
  const metaBits = [];
  if (item.authors.length) metaBits.push(esc(item.authors.join(', ')));
  if (item.year) metaBits.push(esc(item.year));
  if (item.lang) metaBits.push(esc(item.lang.toUpperCase()));
  const metaHtml = metaBits.map((b) => `<span>${b}</span>`).join('');
  const sourceLink = item.source_url
    ? `<div><a class="btn ghost source-btn" href="${esc(item.source_url)}" target="_blank" rel="noopener">Першоджерело ↗</a></div>`
    : '';

  let page = resourceTpl;
  page = inject(page, '{{HEAD}}', head(`${item.title} · VERC`, item.summary));
  page = inject(page, '{{NAV}}', navHtml);
  page = inject(page, '{{FOOTER}}', footerHtml);
  page = inject(page, '{{WIDGET}}', widgetHtml);
  page = inject(page, '{{TYPE_LABEL}}', TYPE_LABELS[type] || type);
  page = inject(page, '{{TYPE}}', type);
  page = inject(page, '{{TITLE}}', esc(item.title));
  page = inject(page, '{{META}}', metaHtml);
  page = inject(page, '{{SOURCE_LINK}}', sourceLink);
  page = inject(page, '{{BODY}}', bodyHtml);
  write(path.join(DIST, 'resources', `${slug}.html`), page);

  // ----- RAG chunks (from raw markdown body) -----
  const paras = content.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  let buf = '';
  let ci = 0;
  const flush = () => {
    if (buf.trim()) {
      chunks.push({ id: `${slug}#${ci++}`, source_slug: slug, title: item.title, type, source_url: item.source_url, text: buf.trim() });
      buf = '';
    }
  };
  for (const p of paras) {
    if (buf && (buf.length + p.length + 2) > CHUNK_MAX) flush();
    buf += (buf ? '\n\n' : '') + p;
  }
  flush();
}

// ---- resources index page ----
items.sort((a, b) =>
  (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) ||
  ((b.year || 0) - (a.year || 0)) ||
  a.title.localeCompare(b.title, 'uk'));

const cardsHtml = items.map((it) => {
  const searchStr = esc([it.title, it.summary, it.tags.join(' '), it.authors.join(' ')].join(' ').toLowerCase());
  const meta = [it.year, it.authors[0]].filter(Boolean).map(esc).join(' · ');
  const tags = it.tags.slice(0, 3).map((t) => `<span class="rtag">${esc(t)}</span>`).join('');
  return `      <a class="rcard" href="${it.url}" data-type="${it.type}" data-search="${searchStr}">
        <span class="type-badge ${it.type}">${TYPE_LABELS[it.type] || it.type}</span>
        <h3>${esc(it.title)}</h3>
        <p>${esc(it.summary)}</p>
        <div class="rcard-foot"><div class="rtags">${tags}</div><span class="rmeta-inline">${meta}</span></div>
      </a>`;
}).join('\n');

let indexPage = indexTpl;
indexPage = inject(indexPage, '{{HEAD}}', head('Ресурси по CBD · VERC', 'База знань VERC: законодавство, дослідження та застосування CBD і технічних конопель у реабілітації ветеранів.'));
indexPage = inject(indexPage, '{{NAV}}', navHtml);
indexPage = inject(indexPage, '{{FOOTER}}', footerHtml);
indexPage = inject(indexPage, '{{WIDGET}}', widgetHtml);
indexPage = inject(indexPage, '{{CARDS}}', cardsHtml);
write(path.join(DIST, 'resources', 'index.html'), indexPage);

// ---- data files (for client search + RAG ingestion) ----
write(path.join(DIST, 'data', 'resources.json'), JSON.stringify(items, null, 2));
write(path.join(DIST, 'data', 'rag-chunks.json'), JSON.stringify(chunks, null, 2));

console.log(`✓ Built ${items.length} resources → ${chunks.length} RAG chunks → dist/`);
