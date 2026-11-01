// Cloudflare Pages Function — RAG chat endpoint for VERC.
// POST /api/chat  { question: string, history?: [{role, content}] }
// -> { answer: string, sources: [{title, url, source_url}] }
//
// Bindings (configured in the Pages project / wrangler.toml):
//   env.AI                 — Workers AI (embeddings via @cf/baai/bge-m3)
//   env.VECTORIZE          — Vectorize index "verc-cbd" (1024 dims, cosine)
//   env.ANTHROPIC_API_KEY  — secret
//   env.CLAUDE_MODEL       — var, defaults to claude-haiku-4-5

const EMBED_MODEL = '@cf/baai/bge-m3';
const TOP_K = 6;
const SCORE_MIN = 0.35; // drop weak matches from the cited sources

const SYSTEM_PROMPT = `Ти — асистент проєкту VERC (Veteran Eco-Rehab Clusters): перша у світі державна ветеранська hemp-мережа з цифровим контролем кожного процесу. Ветерани вирощують CBD для власної реабілітації та будують житло з hempcrete (технічні коноплі) за моделлю «Producer Therapy».

Правила:
- Відповідай УКРАЇНСЬКОЮ мовою, стисло і по суті.
- Відповідай ЛИШЕ на основі наданого контексту (розділ CONTEXT нижче) та загальновідомих фактів про проєкт VERC. Якщо в контексті немає відповіді — чесно скажи, що не маєш цієї інформації, і запропонуй звернутися до команди проєкту.
- Не вигадуй законів, номерів постанов, досліджень чи цифр, яких немає в контексті.
- Матеріали мають інформаційний характер і НЕ Є медичною порадою. Якщо питання стосується здоров'я/лікування — додай коротке нагадування про консультацію з лікарем.
- Не переходь на інші теми, не пов'язані з VERC, CBD, реабілітацією ветеранів чи технічними коноплями.`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const question = (body.question || '').toString().trim();
  if (!question) return json({ error: 'Порожнє питання' }, 400);
  if (question.length > 1000) return json({ error: 'Питання задовге' }, 400);

  if (!env.ANTHROPIC_API_KEY) return json({ error: 'Server not configured' }, 500);

  // 1) Embed the question (multilingual, matches ingestion model)
  let queryVector;
  try {
    const emb = await env.AI.run(EMBED_MODEL, { text: [question] });
    queryVector = emb.data[0];
  } catch (e) {
    return json({ error: 'Помилка ембедингу', detail: String(e) }, 502);
  }

  // 2) Retrieve relevant chunks from Vectorize
  let matches = [];
  try {
    const res = await env.VECTORIZE.query(queryVector, { topK: TOP_K, returnMetadata: true });
    matches = res.matches || [];
  } catch (e) {
    return json({ error: 'Помилка векторного пошуку', detail: String(e) }, 502);
  }

  // 3) Build the grounded context + a deduped source list
  const contextBlocks = [];
  const sourcesBySlug = new Map();
  for (const m of matches) {
    const md = m.metadata || {};
    contextBlocks.push(`[${md.title || 'Джерело'}]\n${md.text || ''}`);
    if (m.score >= SCORE_MIN && md.slug && !sourcesBySlug.has(md.slug)) {
      sourcesBySlug.set(md.slug, {
        title: md.title || md.slug,
        url: md.url || `/resources/${md.slug}.html`,
        source_url: md.source_url || '',
      });
    }
  }
  const contextText = contextBlocks.join('\n\n---\n\n') || '(контекст порожній)';

  // 4) Ask Claude, grounded on the retrieved context
  const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const messages = [
    ...history
      .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && h.content)
      .map((h) => ({ role: h.role, content: String(h.content).slice(0, 2000) })),
    { role: 'user', content: `CONTEXT:\n${contextText}\n\n---\n\nПитання: ${question}` },
  ];

  let answer;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.CLAUDE_MODEL || 'claude-haiku-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: 'Помилка моделі', detail: errText.slice(0, 500) }, 502);
    }
    const data = await resp.json();
    answer = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  } catch (e) {
    return json({ error: 'Помилка запиту до моделі', detail: String(e) }, 502);
  }

  return json({ answer: answer || 'Вибачте, не вдалося сформувати відповідь.', sources: [...sourcesBySlug.values()] });
}
