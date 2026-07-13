# TG Planner — Telegram Mini App

Daily planner mini app: day/week tasks, inbox, recurring tasks, subtasks, tags,
notes, month/year goals, stats with streaks, pomodoro. Neomorphism UI, light/dark
themes, RU/EN localization.

## Stack

Zero-build static app: plain ES modules + CSS. No dependencies, no bundler.

- `index.html` — shell
- `css/style.css` — neomorphism design system, theme via `data-theme` on `<html>`
- `js/app.js` — state, views, modals, pomodoro
- `js/i18n.js` — RU/EN dictionaries, locale-aware date formatting
- `js/storage.js` — storage abstraction

## Storage

Data lives in **Telegram CloudStorage** (bound to the user's TG account, no server).
Outside Telegram it falls back to `localStorage` (dev mode).

Collections are chunked to fit CloudStorage's 4096-char value limit:
`m:<name>` holds chunk count, `c:<name>:<i>` hold JSON chunks.

**Migrating to Supabase later:** implement an adapter with the same interface
(`getItem/getItems/setItem/removeItems`) in `js/storage.js` and switch the
`adapter` assignment. Data can be moved via Settings → Export/Import.

## Run locally

```sh
cd tg-planner
python -m http.server 8080
# open http://localhost:8080
```

(ES modules require http://, opening index.html via file:// won't work.)

## Deploy & attach to the bot

1. Host the folder on any static HTTPS hosting (GitHub Pages, Cloudflare Pages, Vercel).
2. Attach as the bot's menu button — this does NOT touch existing bot logic:

```sh
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setChatMenuButton" \
  -H "Content-Type: application/json" \
  -d '{"menu_button":{"type":"web_app","text":"Planner","web_app":{"url":"https://<YOUR_URL>/"}}}'
```

Never commit the bot token to this repo.

## Roadmap

- [ ] Reminders via bot messages (needs a small server-side worker)
- [ ] Supabase adapter + sync
