# Cinematic Studio — nostackai frontend

The control room for the article-to-4K-video pipeline. Built with Vite + React + TypeScript + MUI, following nostackai's frontend standards (config-driven pages, a dedicated services layer, token kept in memory).

## Run it

1. Install Node.js 18+ if you don't have it (nodejs.org).
2. In this folder:

```bash
cp .env.example .env    # then open .env and paste your real values
npm install
npm run dev
```

3. Open http://localhost:5173

Your four `.env` values come from the nostackai platform: **Settings → API Keys** gives you the API key and client ID; the org API endpoint and org code are shown in Settings too.

## What works right now (default APIs only)

- **Sign in / create account / forgot password** — the full two-step token flow, with silent refresh every 45 minutes.
- **Profile** — edit name, change password, and upload a profile photo. Note: the photo save intentionally sends `picurl` instead of the documented `picture` field, working around a known platform bug (see `src/services/authService.ts`).
- **Integrations** — lists the connectors your org has enabled, renders each credential form from its `auth_schema`, saves/removes tenant keys.

## What lights up later (entity APIs)

The Dashboard, Projects, and Project Detail pages call the pipeline entities (`project`, `generatedhtml`, `script`, `voiceover`, `finalvideo`) via the live API paths (`/create/{entity}`, `/item/{entity}/{id}`, `/update/{entity}/{id}`, `/delete/{entity}/{id}`, `/list/{entity}`). Entity names and fields live in `src/config/entities.ts` — adjust there if anything changes in the console.

The "Start pipeline" button on a project sets `status` to `generating_html` — that's the update your automations listen for.

## Folder map

```
src/
  config/entities.ts     entity names, pipeline stages, status colors (edit here first)
  services/              apiClient (token, refresh), auth, entities, settings, uploads
  hooks/useAuth.tsx      session state
  components/            layout, PipelineTimeline (the film-strip tracker), status chips
  pages/                 Auth, Dashboard, Projects, ProjectDetail, Presets, Profile, Integrations
```

## One thing that might bite: CORS headers

The login flow reads two response headers (`oauthtoken`, `x-nostackai-token`). Browsers can only read those if the API exposes them via `Access-Control-Expose-Headers`. If sign-in fails with a message about unreadable headers, that's the cause — check nostackai's CORS settings for your org, or ask their support about exposing those headers.
