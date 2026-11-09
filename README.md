# frbddn — Sandbox Roleplay

A single-page **Progressive Web App** (Expo + React Native Web) that plays like an interactive novel. You choose who you are and which world you live in, and an LLM narrator streams the story while a deterministic engine keeps memory, time, bonds, money, intimacy, images and saves consistent.

Adults only. Settings → New story opens the creation wizard (world, places, lore, you, backstory, intimacy, people, opening, timeline); "Try the sample story" starts the Harbourside test world.

There is **no backend**. Everything runs in the browser and is stored on the device. External services: the **OpenRouter API** (story, memory, summaries, standard images) and, for explicit pictures, **Runware** or **Wiro**, each with a key the player enters in Settings. On Vercel, `api/explicit.js` forwards explicit-image calls when the browser can't reach those two providers directly.

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

- `bun run build:web` writes a static site to `dist/`. On Vercel, `vercel.json` already sets the build command, the output folder and clean URLs; import the repo and deploy.
- The service worker (`public/sw.js`) is generated from `package.json`'s version; bump the version to invalidate caches.
- Icons and the manifest live in `public/`; `python3 scripts/make-icon.py` redraws them (a red keyhole) plus the neutral "Notes" icon used when the neutral name is on.
- On Android, installing from the browser and re-adding the shortcut is needed after an icon change.

---

## What it is made of

| Area | Files |
|---|---|
| Screens (Expo Router) | `app/(tabs)/index.tsx` (Story), `you.tsx` (portrait + Bonds / Jutsu / Journal), `bond/[id].tsx`, `settings.tsx`; shared list kit in `components/List.tsx`, player sections in `components/player/` |
| Game engine | `lib/rpg/game.tsx`, `services.ts` (applies a turn), `entities.ts`, `bonds.ts`, `facts.ts`, `clock.ts`, `log.ts`, `stateBlock.ts`, `db.ts`, `prompt.ts`, `retrieval.ts`, `seed.ts` |
| Simulation systems | `calendar.ts` (clock), `timeparse.ts` (narration time), `pacing.ts` (scene tempo), `canonData.ts` (90 canon milestones, data only) + `canon.ts` (scheduler + news queue) + `newsDelivery.ts` (bearers, delivery styles, catch-up reports) + `letters.ts` (personal letters), `encounters.ts` (location/time realism), `romance.ts` (hearts + lore), `reputation.ts` (bingo books, bounties, Akatsuki standing, bounty hunters), `grudges.ts` (enemies who hunt you) |
| AI client | `lib/openrouter.ts` (streaming chat, JSON completion, image generation, model lists) |
| Images | `lib/rpg/image.ts`, `referenceImages.ts`, `portrait.ts` (your portraits), `imageStore.ts` (IndexedDB storage) |
| Shared UI | `components/*`, `constants/theme.ts` |
| Tests | `scripts/verify-pipeline.test.ts` |
| Docs | `docs/PROJECT_GUIDE.md` (deep engineering handoff) |

**Read `docs/PROJECT_GUIDE.md` first** if you are an AI or developer picking this project up — it documents the data model, turn lifecycle, prompt composition, canon engine, clock rules, image pipeline and invariants.
