# AI Content Factory

Автоматична фабрика контенту: URL або текст → Groq (Llama 3.3 70B) → зображення → Telegram і socials.

## Problem

Ручна підготовка поста для соцмереж займає **~60 хвилин**: прочитати матеріал, виділити тези, написати короткий пост і експертний коментар, підібрати/згенерувати картинку, опублікувати в кількох каналах.

## AI Solution

Один webhook-запит запускає ланцюжок:

1. **format_text.js** — скрейп URL (fallback: URL у промпт) або нормалізація тексту
2. **gemini_cached.js** — Groq Llama 3.3 70B з JSON-кешем → `theses`, `short_post`, `expert_opinion`
3. **Pollinations.ai** — зображення за `short_post`
4. **n8n** — відправка в Telegram + HTTP-заглушки для socials

## Stack

| Компонент | Роль |
|-----------|------|
| **n8n** | Оркестратор workflow (Docker) |
| **Groq (Llama 3.3 70B)** | Генерація тексту (безкоштовно, швидко) |
| **Pollinations.ai** | Генерація зображення |
| **Node.js scripts** | format_text + gemini_cached |
| **Cursor** | Розробка та ітерація промптів |

## Result

**60 хв → ~30 сек** — один POST замість ручної роботи.

### Telegram screenshot


![Telegram demo](docs/telegram-demo.png)

---

## Швидкий старт

### 1. Env

```bash
cp .env.example .env
# заповніть GROQ_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
```

### 2. n8n (Docker Compose)

```bash
docker compose up -d
```

> Потрібен файл `.env` в корені проєкту поруч з `docker-compose.yml`.

### 3. Import workflow

1. Відкрийте http://localhost:5678
2. **Workflows → Import from File** → `workflows/foundation_ai_content_factory.json`
3. Активуйте workflow (тумблер **Active** у правому верхньому куті)

### 4. Тест скриптів локально (всередині контейнера)

```bash
docker exec n8n node /data/projects/n8n_ai-content-factory/scripts/format_text.js --text "Штучний інтелект змінює маркетинг"
docker exec n8n node /data/projects/n8n_ai-content-factory/scripts/gemini_cached.js --input "Штучний інтелект змінює маркетинг"
```

### 5. Webhook

**PowerShell:**
```powershell
$body = '{"text": "OpenAI та Google конкурують за ринок LLM"}'
Invoke-RestMethod -Method POST -Uri "http://localhost:5678/webhook/content-factory" -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

**curl (Linux/Mac):**
```bash
curl -X POST http://localhost:5678/webhook/content-factory \
  -H "Content-Type: application/json" \
  -d '{"text": "OpenAI та Google конкурують за ринок LLM"}'
```

Або з URL статті:
```powershell
$body = '{"url": "https://example.com/article"}'
Invoke-RestMethod -Method POST -Uri "http://localhost:5678/webhook/content-factory" -ContentType "application/json; charset=utf-8" -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

---

## Структура

```
ai-content-factory/
├── workflows/foundation_ai_content_factory.json
├── scripts/
│   ├── format_text.js
│   └── gemini_cached.js
├── prompts/system_min.txt
├── cache/gemini.json
└── docs/telegram-demo.png
```

## Вихід LLM

```json
{
  "theses": ["...", "..."],
  "short_post": "до 280 символів",
  "expert_opinion": "2-3 речення"
}
```

Кеш: `cache/groq.json` — ключ SHA256(system + input).

## Social stubs

Вузли **Stub Twitter / LinkedIn / Facebook** шлють POST на `httpbin.org` — замініть URL на реальні API платформ.

---

## Повна автоматизація (наступний крок)

Поточний воркфлоу запускається вручну через webhook. Для повністю автономної роботи — щоб система сама збирала новини і публікувала пости — потрібно додати три компоненти:

### 1. Schedule Trigger
Замінює Webhook-тригер. Запускає воркфлоу автоматично за розкладом.

У n8n: нода **Schedule Trigger** → інтервал (наприклад, кожні 30 хв або у 9:00/15:00/21:00).

### 2. RSS Feed Reader
Читає свіжі новини з футбольних сайтів.

У n8n: нода **RSS Feed Read** → вкажіть URL RSS-стрічки.

Приклади футбольних RSS:
| Джерело | URL |
|---------|-----|
| BBC Sport Football | `https://feeds.bbci.co.uk/sport/football/rss.xml` |
| Sport.ua | `https://sport.ua/rss/football` |
| UEFA | `https://www.uefa.com/rssfeed/uefachampionsleague/index.xml` |
| Goal.com | `https://www.goal.com/feeds/en/news` |

Можна підключити кілька джерел паралельно через **Merge** ноду.

### 3. Фільтр дублів
Перевіряє, чи вже публікувалась ця новина (за заголовком або URL).

```javascript
// Code-нода: фільтр дублів
const fs = require('fs');
const PUBLISHED_FILE = '/data/projects/n8n_ai-content-factory/cache/published.json';

let published = [];
try { published = JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf8')); } catch (_) {}

const items = $input.all().filter(item => {
  const id = item.json.link || item.json.title;
  return !published.includes(id);
});

// Зберегти нові ID
const newIds = items.map(i => i.json.link || i.json.title);
fs.mkdirSync('/data/projects/n8n_ai-content-factory/cache', { recursive: true });
fs.writeFileSync(PUBLISHED_FILE, JSON.stringify([...published, ...newIds].slice(-500)));

return items.map(item => ({ json: { url: item.json.link, text: item.json.title + '. ' + (item.json.contentSnippet || '') } }));
```

### Схема повного воркфлоу

```
Schedule Trigger
      ↓
RSS Feed Read (кілька джерел)
      ↓
Фільтр дублів (Code)
      ↓
Format Text (script)
      ↓
Groq AI (script)
      ↓
Pollinations.ai (зображення)
      ↓
Telegram → Twitter → LinkedIn → Facebook
```

> Поточний `foundation_ai_content_factory.json` — це базовий шаблон з ручним запуском. Описані вузли додаються у n8n UI без зміни скриптів.
