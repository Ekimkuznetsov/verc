# VERC — розгортання на Cloudflare Pages

Сайт (статика) + база знань CBD (пункт 2) + RAG-чат (пункт 3) розгортаються
одним деплоєм на **Cloudflare Pages** з репозиторію GitHub.

## Що вже готово в репозиторії
- `npm run build` → генерує `dist/` (лендінг, `/resources/`, `data/rag-chunks.json`)
- `functions/api/chat.js` → RAG-ендпоінт `/api/chat`
- `functions/api/ingest.js` → індексація `/api/ingest` (захищена секретом)
- `assets/widget.js` → чат-віджет на всіх сторінках
- `wrangler.toml` → бінди AI + Vectorize, змінна `CLAUDE_MODEL`

## Передумови (одноразово)
```bash
npm install                     # локальні залежності білду
npx wrangler login              # вхід у Cloudflare (відкриє браузер)
```

## Крок 1. Створити Vectorize-індекс
`bge-m3` дає вектори розмірності **1024**, метрика — cosine:
```bash
npx wrangler vectorize create verc-cbd --dimensions=1024 --metric=cosine
```

## Крок 2. Створити Pages-проєкт (підключити GitHub)
У дашборді Cloudflare → **Workers & Pages → Create → Pages → Connect to Git**:
- Репозиторій: `ekimkuznetsov/verc`
- **Build command:** `npm run build`
- **Build output directory:** `dist`
- Framework preset: None

Після цього кожен `git push` у `main` авто-збиратиме й деплоїтиме сайт.

## Крок 3. Прив'язати бінди та секрети
У налаштуваннях Pages-проєкту → **Settings → Functions / Bindings** (production і preview):
- **Workers AI** binding: назва `AI`
- **Vectorize** binding: назва `VECTORIZE`, індекс `verc-cbd`

Секрети → **Settings → Environment variables** (тип *Secret*, або через CLI):
```bash
npx wrangler pages secret put ANTHROPIC_API_KEY --project-name verc   # ключ Claude API
npx wrangler pages secret put INGEST_SECRET     --project-name verc   # будь-який довгий рядок
```
Змінна `CLAUDE_MODEL=claude-haiku-4-5` уже задана в `wrangler.toml` (можна змінити на `claude-sonnet-5` для складніших відповідей).

## Крок 4. Задеплоїти
Запуш у `main` (або **Retry deployment** у дашборді). Отримаєте URL виду
`https://verc.pages.dev`.

## Крок 5. Проіндексувати базу знань (після кожної зміни `content/cbd/`)
Наповнює Vectorize ембедингами з `data/rag-chunks.json`:
```bash
SITE_URL=https://verc.pages.dev INGEST_SECRET=<той самий секрет> npm run reindex
```
Успіх: `HTTP 200: {"ok":true,"chunks":6,"upserted":6}`. Після цього чат почне
відповідати з посиланнями на джерела.

## Локальна розробка Functions (опційно)
```bash
npm run build
npx wrangler pages dev dist            # піднімає сайт + Functions локально
```
Для реальних відповідей потрібні бінди/секрети — найпростіше тестувати вже в проді.

## Вартість
Vectorize, Workers AI та Pages — у межах безкоштовних лімітів. Платні лише токени
Claude API (копійки на Haiku 4.5), ключ схований у секреті Worker.

## Міграція з GitHub Pages
Після перевірки Cloudflare-версії старий GitHub Pages можна вимкнути
(Settings → Pages → Source: None) або лишити як дзеркало старого лендінгу.
Абсолютні шляхи (`/resources/`, `/assets/`) розраховані на корінь домену CF.
