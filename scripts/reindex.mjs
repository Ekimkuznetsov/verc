// Trigger a re-index of the CBD knowledge base after a deploy.
// Calls the protected /api/ingest endpoint, which reads the freshly-built
// /data/rag-chunks.json and upserts embeddings into Vectorize.
//
//   SITE_URL=https://verc.pages.dev INGEST_SECRET=xxxx npm run reindex
//
const SITE = process.env.SITE_URL;
const SECRET = process.env.INGEST_SECRET;

if (!SITE || !SECRET) {
  console.error('Set SITE_URL and INGEST_SECRET env vars.');
  process.exit(1);
}

const res = await fetch(new URL('/api/ingest', SITE), {
  method: 'POST',
  headers: { 'x-ingest-secret': SECRET },
});
const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
process.exit(res.ok ? 0 : 1);
