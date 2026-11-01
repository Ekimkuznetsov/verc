// Cloudflare Pages Function — RAG index builder for VERC.
// POST /api/ingest   header: x-ingest-secret: <env.INGEST_SECRET>
// Reads /data/rag-chunks.json from this deployment, embeds each chunk with
// Workers AI, and upserts the vectors into Vectorize. Run once after each deploy
// whose content changed (see scripts/reindex.mjs / DEPLOY.md).
//
// Bindings: env.AI, env.VECTORIZE, env.INGEST_SECRET (secret)

const EMBED_MODEL = '@cf/baai/bge-m3';
const EMBED_BATCH = 50;   // texts per Workers AI call
const UPSERT_BATCH = 100; // vectors per Vectorize upsert

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.INGEST_SECRET || request.headers.get('x-ingest-secret') !== env.INGEST_SECRET) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // Load the chunks produced by the site build
  let chunks;
  try {
    const res = await fetch(new URL('/data/rag-chunks.json', request.url).toString());
    if (!res.ok) return json({ error: 'rag-chunks.json not found', status: res.status }, 500);
    chunks = await res.json();
  } catch (e) {
    return json({ error: 'Failed to load chunks', detail: String(e) }, 500);
  }
  if (!Array.isArray(chunks) || chunks.length === 0) return json({ error: 'No chunks' }, 400);

  // Embed in batches
  const vectors = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const emb = await env.AI.run(EMBED_MODEL, { text: batch.map((c) => c.text) });
    emb.data.forEach((values, j) => {
      const c = batch[j];
      vectors.push({
        id: c.id,
        values,
        metadata: {
          text: c.text,
          title: c.title,
          slug: c.source_slug,
          url: `/resources/${c.source_slug}.html`,
          source_url: c.source_url || '',
          type: c.type || '',
        },
      });
    });
  }

  // Upsert in batches
  let upserted = 0;
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await env.VECTORIZE.upsert(vectors.slice(i, i + UPSERT_BATCH));
    upserted += Math.min(UPSERT_BATCH, vectors.length - i);
  }

  return json({ ok: true, chunks: chunks.length, upserted });
}
