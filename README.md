# Kan — Interactive Naruto RPG

A single-page **Progressive Web App** (Expo + React Native Web) that plays like an interactive novel set in the Naruto world. The player controls **Kan**, an original Uchiha-Uzumaki character, and an LLM narrator streams the story while a deterministic engine keeps memory, canon, time, bonds, jutsu, images and saves consistent.

There is **no backend**. Everything runs in the browser and is stored in `localStorage` through `AsyncStorage`. The only external service is the **OpenRouter API** (chat completions + image generation) using a key the player enters in Settings.

---

## Quick start

```bash
bun install
bun run dev          # Expo dev server on port 4000
```

Then open the app, go to **Settings → OpenRouter API key**, paste a key from https://openrouter.ai/keys, and pick models.

### Useful commands

| Command | What it does |
|---|---|
| `bun run typecheck` | TypeScript check (fast, no build) |
| `bun test` | Full engine test suite (`scripts/verify-pipeline.test.ts`) |
| `bun run build:web` | Regenerates the service worker and exports the static PWA to `dist/` |
| `bun run dev` | Expo dev server on port 4000 |

### Deploy / PWA

- `bun run build:web` writes a static site to `dist/` — deploy that folder anywhere (Vercel etc.).
- The service worker (`public/sw.js`) is generated from `package.json`'s version; bump the version to invalidate caches.
- Icons and the manifest live in `public/`. The app icon is the red vulture mark.
- On Android, installing from the browser and re-adding the shortcut is needed after an icon change.

---

## What it is made of

| Area | Files |
|---|---|
| Screens (Expo Router) | `app/(tabs)/index.tsx` (Story), `characters.tsx` (Bonds), `jutsu.tsx`, `journal.tsx`, `settings.tsx` |
| Game engine | `lib/rpg/game.tsx`, `services.ts`, `db.ts`, `prompt.ts`, `retrieval.ts`, `seed.ts` |
| Simulation systems | `calendar.ts` (clock), `timeparse.ts` (narration time), `pacing.ts` (scene tempo), `canon.ts` (90 canon milestones + news), `encounters.ts` (location/time realism), `romance.ts` (hearts + lore) |
| AI client | `lib/openrouter.ts` (streaming chat, JSON completion, image generation, model lists) |
| Images | `lib/rpg/image.ts`, `referenceImages.ts` |
| Shared UI | `components/*`, `constants/theme.ts` |
| Tests | `scripts/verify-pipeline.test.ts` |
| Docs | `docs/PROJECT_GUIDE.md` (deep engineering handoff) |

**Read `docs/PROJECT_GUIDE.md` first** if you are an AI or developer picking this project up — it documents the data model, turn lifecycle, prompt composition, canon engine, clock rules, image pipeline and invariants.
