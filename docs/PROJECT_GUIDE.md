# frbddn — Engineering & AI Handoff Guide

frbddn (`APP_NAME` in `lib/brand.ts`) is an adults-only, fully explicit roleplay app set in the real world today. The player writes their own world, character and people, then lives in it: talk, date, text, sleep with people, skip time, rewind. Nothing is scripted and it is not an adventure game. The plans and progress logs live in the claude.ai Project, never in this repo.

This document is the technical map of the app, for a developer **or an AI coding agent** with no prior context. Read it once top to bottom, then use the file map and the invariants (§12) as a checklist.

Only two hard limits live in code (`intimacy.ts`, `explicitImages.ts`): everyone in anything sexual is a stated adult (18+) and never described as a child, and no real people. Nothing else is filtered; the player's own limits are optional settings.

---

## 0. File map

### `lib/rpg/`

| File | What lives there |
|---|---|
| `game.tsx` | `GameProvider`: the turn loop, the background job queue, undo / retry / edit / rewind, time skips, the phone actions, slot switching |
| `prompt.ts` | `NARRATION_SYSTEM`, `STATE_SYSTEM`, summary prompts; `buildNarrationPrompt`, `buildExtractionPrompt`, the summary prompt builders, the `formatX` blocks |
| `stateSchema.ts` / `stateBlock.ts` | `TURN_STATE_SCHEMA` (strict JSON schema for the tracker) and `convertStateBlock` (snake_case reply → `TurnDiff`) |
| `memoryJobs.ts` | `applyStateStep` (phase 1 of saving a turn), the job queue (`state`, `scene`, `timeSkip`, `arc`, `year`, `text`), chapters, scene stamping, `carryOverMemory` |
| `services.ts` | `applyTurnDiff` and the model calls behind memory: `extractTurnDiff`, `summarizeScene`, `summarizeTimeSkip`, `rollArcSummary` |
| `entities.ts` | Name resolution (`resolveEntity`), `resolveCharacterRefs`, `applyEntityDiff`, presence, `mergeEntityPair` |
| `characterRefs.ts` | Tracker ids (slugs) and whole-word name mentions |
| `bonds.ts` | `applyBondDiff`, `syncBondSides` (two-sided feelings) |
| `facts.ts` | Facts (with refs, expiry, who knows), threads, scene-end events |
| `companions.ts` | People WITH YOU right now |
| `deaths.ts` | `isDeceased`, `markDeceased`, `markAlive` |
| `met.ts` | First meetings |
| `names.ts` | Names the player knows (`displayName`, `narratorName`, labels for strangers, `learnName`) |
| `disclosure.ts` | What the UI may show of someone (your feelings, theirs only as a word) |
| `player.ts` | Who the player is (`playerEntity`, `playerName`, `isPlayer`, refs) |
| `world.ts` / `worldBlocks.ts` | `db.world` (empty by default) and the cached THE WORLD / WHO YOU ARE blocks |
| `places.ts` | Kind of place (`classifyLocation`, `locationKindOf`) and `whereaboutsOf` (story first, then routine, then last seen) |
| `routines.ts` | Daily and weekly routines (§7) |
| `phone.ts` | The phone (§8) |
| `skip.ts` | Time skips (§9) |
| `edit.ts` | Edit your last message, edit a reply, rewind (§10) |
| `home.ts` | Where the player lives and who lives with them |
| `money.ts` | The purse |
| `lives.ts` | People's own lives: life events (story-driven, rarely random), reunions |
| `consequences.ts` | Choices that come back later |
| `grudges.ts` | Grudges (resentful → vengeful) |
| `yearly.ts` | Birthdays, death anniversaries, real holidays (`HOLIDAYS`, `holidayToday`) |
| `weather.ts` | Weather from the world's climate, held per scene |
| `ambience.ts` (+ `lib/audio/`) | Ambient sound beds from weather, place, time and the last reply (19 present-day beds) |
| `intimacy.ts` | The adult layer: relationship labels, the intimacy ladder (labels, never a gate), `canBeIntimate`, the INTIMACY block, ROMANCE AND SEX rules, the post-check |
| `sexMode.ts` | Sex mode (§6) |
| `sceneMode.ts` | Scene modes (normal, conversation, intimate), the mode chip, `resolveTurnMode` |
| `sceneNow.ts` | What a picture of the scene would show now (props, screens, mood, who is doing what) |
| `refusal.ts` | Detects a narrator refusal or an unasked fade-out (`heldBack`) |
| `paintScene.ts` | The one picture pipeline (§11), and `paintTextPhoto` for photos in texts |
| `image.ts`, `imageDirection.ts`, `imageCheck.ts`, `referenceImages.ts`, `referencePlan.ts`, `castSheet.ts`, `imageCaps.ts`, `imageCompress.ts`, `imageStore.ts` | Director, shot vocabulary, picture check, references, image storage |
| `explicitImages.ts` / `paintExplicit.ts` / `../explicitProviders.ts` | Explicit pictures: adult checks, sheet-only prompts, reference sheets, Wiro and Runware adapters, `EXPLICIT_PROVIDERS` |
| `portrait.ts`, `characterPortrait.ts` | Portraits of the player and of people |
| `scrapbook.ts` | Scene pictures by chapter |
| `retrieval.ts`, `povMemories.ts`, `sharedMemories.ts` | Memory retrieval, memories from each person's view, memories you shared |
| `calendar.ts` / `clock.ts` / `timeparse.ts` / `pacing.ts` | Dates (present day, `todayAt`, weekday), the clock step, reading time from prose, `resolveTurnClock` |
| `variety.ts` | Keeps the narrator from repeating itself |
| `returning.ts` | The occasional A FAMILIAR FACE offer |
| `proseFallback.ts` | What a turn records when the tracker reply is unreadable |
| `log.ts` | Story log and snapshots (`pushSnapshot`, `restoreSnapshot`, `snapshotBefore`) |
| `db.ts` / `slotStore.ts` / `seed.ts` / `defaults.ts` | Persistence, migration (`normalizeDatabase`), building a save from the wizard |
| `wizard.ts` / `worldEdit.ts` | The creation wizard's draft and "Help me fill this"; editing the world mid-story and world templates |
| `debug.ts` | The debug log (outside the save) and per-call costs |
| `util.ts`, `id.ts`, `file.ts` | Helpers |

### Elsewhere

| File | What lives there |
|---|---|
| `lib/openrouter.ts` | OpenRouter calls (`completeChat`, `streamChatCompletion`, images, key test), `ROLEPLAY_MODELS`, prompt caching (`toWireMessages`) |
| `lib/explicitProviders.ts` | Wiro and Runware: generate, key test |
| `lib/costs.ts` | Spend per provider (session and month, `frbddn.costs.v1`) |
| `lib/setup.ts` | First-launch setup flag |
| `lib/privacy.ts` | PIN lock, quick-hide, neutral name, notification text |
| `lib/brand.ts` | `APP_NAME`, every storage key and IndexedDB name |
| `lib/version.ts` | `APP_VERSION` from app.json |

Dependency direction: `game.tsx` → `memoryJobs.ts` → `services.ts` → entities / bonds / facts / clock / log / stateBlock → util / calendar / characterRefs / id. Leaf modules never import `services.ts`, `memoryJobs.ts` or `game.tsx`.

---

## 1. What the app is

- A **client-only** PWA (Expo SDK 54, Expo Router, React Native Web, TypeScript, `bun`). No server: saves in IndexedDB, keys on the device, models through OpenRouter, explicit pictures through Wiro or Runware.
- **Present day only.** A story starts today (or a day the player picks) at a time of day they pick; `world.where` says where it is set. Phones, apps, taxis, bars, offices. No magic or powers.
- Each turn makes **two calls**: the narrator writes prose only (streamed), then a cheap **state tracker** reads that prose and returns strict JSON. A deterministic engine applies it: clock, people, bonds, facts, memories, phone, sex mode.
- **Nothing is built in or scripted**: no built-in world or cast, no timeline, quests or missions. The world moves from what the player does, from people's routines and lives, and from texts.
- **Pictures only on request** (a button, or opening a photo someone texted).

---

## 2. Persistence

| Key | Where | Contents |
|---|---|---|
| `frbddn.meta.v1` | AsyncStorage | Active slot, slot list |
| `frbddn.slot.<id>.v1` | IndexedDB `frbddn-saves` (`slotStore.ts`) | One `AppDatabase` per save |
| `frbddn.apiKey.v1` | AsyncStorage | OpenRouter key (never in saves or exports) |
| `frbddn.wiroKey.v1`, `frbddn.runwareKey.v1` | AsyncStorage | Explicit provider keys |
| `frbddn.costs.v1` | AsyncStorage | Spend totals |
| `frbddn.setupDone.v1` | AsyncStorage | First launch done |
| `frbddn.privacy.v1`, `frbddn.ambience.v1`, `frbddn.wizardDraft.v1`, `frbddn.worldTemplates.v1` | AsyncStorage | Privacy, sound, wizard autosave, world templates |
| `frbddn-images` | IndexedDB | Images (`img:` references in the save) |
| `frbddn-debug` | IndexedDB | The debug log |

`normalizeDatabase` runs on every load and import (repair, defaults). Old saves from before the present-day rebuild do not need to load. `saveSlot` falls back to smaller writes (fewer images, one snapshot) only if a write fails. Exports always include everything (`exportDatabase`); `withImages` inlines pictures.

---

## 3. Data model (`types.ts`)

`AppDatabase`: `settings`, `rawLog` (story entries: role, content, date, `elapsedSeconds`, `sceneSeq`, `sceneCastIds`, `sceneMode`, `sceneOptions`, `heldBack`, `intimate`, `image` + `imageMeta`, `edited`, `skipTo` + `meanwhile`), `entities` (people: name parts and what the player knows of them, age, gender, role, look, `whereabouts` + `whereaboutsAt`, `routine`, `intimacy` profile, `companion`, `livesWithYou`, `lifeEvents`, `deceased`, `tier`), `events` (memories), `eventEntities`, `bonds` (both sides' feelings, relationship, attraction, intimacy stage, firsts, preferences, grudge), `facts`, `threads` (type includes `plan`), `loreEntries`, `summaries`, `world`, `content` (pacing, interests, limits, voice), `state` (`GameState`: clock `inStoryDate`, location, scene, cast, chapter, purse, weather, `sceneMode` incl. `sex`, `sceneNow`, yearly, consequences…), `indices`, `snapshots`, portraits, faces, `memoryJobs`, `explicitRefs`, and `phone` (§8).

`TurnDiff` is what one turn changes: state, entities, bonds, facts, threads, deaths, companions, life events (with an optional new `routine`), intimacy, outfits, `sex`, consequences, weather, home, money, birthdays, names, grudges, `sceneNow`, `phone`, scene.

---

## 4. A turn

### `sendTurn(input, options)` (`game.tsx`)

1. Snapshot the save (`pushSnapshot`, last 10 kept). For a skip, `applySkip` runs on top (§9).
2. Append the player entry; `buildNarrationPrompt` (§5).
3. **Call 1, narrator**: `streamChatCompletion` streams prose (`streamingPreview` hides any stray JSON). Cut-off prose is trimmed to the last sentence.
4. Save the player entry and the reply onto the **latest** copy of the save (`updateLatest`), with the scene mode and `heldBack` (`refusal.ts`).
5. **Call 2, state** in the background (`runStateStep`); the next turn waits for it.

### Phase 1: `applyStateStep` (`memoryJobs.ts`)

- `extractTurnDiff` sends `buildExtractionPrompt` with structured output; unreadable replies are retried once, then repaired, then fall back to the prose (`proseFallback.ts`). A failed call becomes a pending `state` job.
- **Post-check**: a reply that wrote a hard limit, or made someone who isn't a stated adult part of anything sexual, is thrown away and written again once with a corrective note; if it happens again a fade-to-black line stands in.
- **Clock**: `resolveTurnClock` takes the largest of the tracker's time, the prose parser and the pace minimum (action 30 s, conversation 2 min (20 s in conversation mode), downtime 10 min, travel 30 min); a night's sleep jumps to morning. After a skip, the reply adds at most 30 minutes.
- `applyTurnDiff`, then: texts due by now land (`deliverDueTexts`), reunions, turn kind and scene mode, chapter breaks, scene stamping, weather, names, intimacy (stages, firsts, preferences, outfits), `sceneNow`, sex mode (`applySexStep`, the 4 options), life events, the phone on the page (`applyPhoneDiff`), arrivals settled, lives, consequences, purse, yearly, bond sides, deaths on bonds, close people's own texts (`queueOwnTexts`).
- Follow-up jobs: a time-skip summary (180+ days), a scene summary (scene ended, sex ended, a skip closed the scene, or enough messages), text jobs.
- An empty `characters_present` means the player is alone (companions stay).

### Phase 2: jobs (`drainJobs`)

One at a time, never blocking the next turn. Each reads the latest save, calls the model, applies to the save as it is then, and is dropped if its turn was undone. Kinds: `scene`, `timeSkip`, `arc`, `year` (summaries) and `text` (`writeTexts` → `applyTextPlan`). Jobs live in the save, so a reload resumes them; failures show "Memory pending · N" with Retry.

---

## 5. Prompts (`prompt.ts`)

### Narrator

Ordered from never-changing to changing every turn, so the front is a cacheable prefix (invariant 10):

1. **Rules** — `NARRATION_SYSTEM`: THE PLAYER, PEOPLE, THE WORLD, TIME, NAMES, STYLE, SCENE MODES, then `ROMANCE_RULES` ("ROMANCE AND SEX") and `GRUDGE_RULES`. Identical on every turn of every story.
2. **What the player wrote** — THE WORLD, WHO YOU ARE, INTIMACY (`worldBlocks.ts`, `intimacy.ts`).
3. **Slow context** — story so far (arc + newest chapters), threads, bonds, the dead.
4. **Dynamic** (user message): CURRENT STATE, WITH YOU, TIME, WEATHER, HOME, CHARACTERS IN SCENE, facts, FIGURES ALREADY SAID, ELSEWHERE (story whereabouts, else routine, else last seen), **PHONE** (what just buzzed, unread counts, read texts, who is on the way or arriving now; never write a reply nobody sent), lore, the yearly line, memories, the recent scene, the last beat, VARIETY, one outside pressure (grudge, consequence or familiar face), CONTINUITY, SCENE MODE (sex: the phase, partners, what's been done), steer chip, OOC note, **TIME SKIP** (after a skip), then `YOU DO OR SAY`.

No JSON, field names or ids ever (invariant 2): people are named as the player knows them. The budget (`promptTokenBudget`, default 9500) cuts memories, then facts and lore, then the oldest scene lines.

### Tracker

`STATE_SYSTEM` (cached) + KNOWN CHARACTERS with ids, prices, bonds, threads; then the dynamic part: active facts with refs, state, WITH YOU ids, the turn's characters, time, weather, scene mode, intimacy, SEX tracking, HOME, PHONE (numbers saved and texts already on the phone, so nothing is reported twice), yearly, consequences, the previous beat, and this turn. Field sections: TIME, PLACE, PEOPLE, NAMES, WITH YOU, DEATHS, MEMORY, LIVES, PHONE, GRUDGES, TURN, SCENE NOW, SEX, INTIMACY.

### Other calls

Scene summaries (`INTIMATE_SUMMARY` keeps every detail of a sex scene, in the summarizer's words), arc/year roll-ups, time-skip summaries, the texting call (§8), the image director, the picture check, "Help me fill this".

Sizes on the fixture world: `NARRATION_SYSTEM` went from 11,324 to 6,396 characters (about 1,600 tokens; the whole narrator prompt about 3,000 tokens); the tracker prompt from 19,752 to 12,908 after the rewrite, and about 14,500 once sex mode, the scene-now fields and the phone were added (schema 9,875).

---

## 6. Romance and sex

- **Relationships** are fixed labels (`stranger` … `lover`, `ex`); `partner` means at work, romance is `lover`. Bonds have two sides: `theirFeelings` and `yourFeelings`.
- **The intimacy ladder** (none, interest, flirting, first kiss, lovers, established) only labels what the page showed; it never gates anything. Hookups happen when both people want it. Physical steps need `intimacyAllowed` (both stated adults, no real people).
- **People's own desires**: each person's "In bed" section (drawn to, toward you, turn-ons, won't do, how they are in bed, experience), written in the wizard or filled by "Help me fill this", or learned in play.
- **Sex mode** (`sexMode.ts`): starts from the player's own sexual move (`sexualMove`), the tracker's `sex.on`, or the mode chip. The gate is `canStartSex`. Held at `state.sceneMode.sex` (partners, since, turns, phase build-up → escalation → climax, what's been done). Turns are short and fully explicit; the strip shows who and how; exactly **4 next moves** come from the tracker (`sexOptions`). It ends when the tracker says so: one aftermath reply, then a scene summary. Leaving the scene ends it without an aftermath; the chip ends it at once. Steer chips: Slower, More, Move on, Fade to black.
- **Hard limits** (the player's own, optional) are never written; soft limits stay off-page.

---

## 7. Routines (`routines.ts`)

- `entity.routine` is plain text: "weekdays 9-17:30 at the office; sleeps 23:30-7; Fridays 21-1 at the bar". `parseRoutine` reads day words (weekdays, weekends, Mon-Thu, Fridays), times (9-5 means 9 to 17; past midnight wraps) and what they are doing (sleep, work, home, out) with the place after "at".
- Nobody wrote one: `inferredRoutine` from their job (bar staff nights, shift workers 7-19, students, office hours, or just sleep).
- Written in the wizard ("Their week", and "Help me fill this"), edited on the bond page (`RoutineCard`), changed by life events (the tracker's `life_events.routine`, and some world events like night shifts).
- **The story wins**: `whereabouts` the story set (stamped `whereaboutsAt`) holds for 6 hours (`storyWhereaboutsHold`), then the routine takes over. `whereNow` feeds ELSEWHERE, the bond page ("Usually at the office around now") and reply timing.
- `replyDelayMinutes`: asleep → after they wake; working 10-120 min; out 3-50; free 1-12; doubled when they dislike the player, tripled with a grudge, halved for close people. Deterministic per message.

---

## 8. The phone (`phone.ts`, `app/phone.tsx`)

State: `db.phone` = `contacts` (who you have numbers for), `threads` (one-to-one or group, `readAt` for left-on-read), `messages` (from `player`, an entity id, or `unknown`; `read`; optional `photo`), `pending` (texts written but not yet arrived, each with `dueAt` and optional effects), `arrivals` (people on their way), `sent` (keys for own texts already sent).

- **Contacts** come from the tracker's `phone.numbers_exchanged`. Anyone else who texts shows as "Unknown number".
- **Texts on the page**: `texts_received` (kept once, read) and `texts_sent` (each queues a reply job).
- **Texting from the phone**: `sendText` adds your message and queues a `text` job. `writeTexts` (narrator model, `TEXTING_SYSTEM`, structured JSON: messages with gaps and photos, left on read, coming over, plan, feeling change, life event, shared news) → `applyTextPlan` puts them in `pending`: the first after `replyDelayMinutes`, the rest after the gaps (double-texting). A reply job with nothing left to answer does nothing.
- **Landing**: `deliverDueTexts` runs in every state step and on "Wait for a reply" (`waitForNext`, at most 12 hours) and skips. Effects apply on landing: bond change, a `plan` thread, a life event, news shared (life events become known), left on read (`readAt`), and **coming over** → an arrival (their whereabouts: "on the way to you"). The narrator sees "On the way" then "Arriving now"; once they are in the scene (or the beat passed) the arrival is settled.
- **Mid-scene**: new unread texts show in the narrator's PHONE block as "Just buzzed, unread: Mara (2)"; the content only once read.
- **Memory**: once read, a day's texts in a thread become one memory (tag `text`), rewritten as more arrive.
- **Own texts** (`queueOwnTexts`): close contacts who are awake and not in the scene text first about one day in three when the thread has been quiet 12 hours (at most one a day), on the player's birthday, and on holidays (Valentine's only from romantic partners; not Halloween).
- **Groups**: any two or more contacts; one job writes whoever answers.
- **Photos** are words until opened; opening paints them (`paintTextPhoto`, §11). No push notifications.
- **UI**: thread list with unread badges, bubbles with times, "typing…" (next text due within 5 minutes), "Read 9:41 PM", Wait for a reply, New message, New group. The Story screen has a Phone chip with the unread count; the Journal has a Phone row.

---

## 9. Time skips (`skip.ts`)

- The Skip chip on the Story screen (hidden during sex and before the story starts, `canSkip`) offers An hour, Until tonight (not when it's already night), Next morning (7:30), or a typed time (`parseSkipTarget`: "Friday night", "tomorrow at 9am", "in 3 hours", "noon", "next Thursday", dates).
- `skipTo(to)` sends a turn whose entry reads "⏩ The next morning · …". `applySkip` runs after the snapshot: clock jump, scene closed, people due to arrive arrive now, texts land, facts expire (rested if overnight), lives and consequences move, and on a skip of 3+ hours everyone but companions (and housemates at home) leaves the scene. The **meanwhile** line ("Mara went on with their day. Texts came in: 2 from Mara.") shows under the entry and goes to the narrator with TIME SKIP: open the new moment, don't play out the gap. Routines put everyone where their day says by themselves.
- The reply after a skip moves the clock at most 30 minutes; the closed scene is summarised. Retry repeats the same skip. Typing a skip in the story still works through the normal clock.

---

## 10. Edit and rewind (`edit.ts`, `log.ts`)

- **Snapshots**: one full save (no images) before every turn, last 10 kept (`SNAPSHOT_LIMIT`). `restoreSnapshot` brings back everything: memory, bonds, the clock and the phone; images come from the live save; `carryOverMemory` keeps summaries that still fit and pending jobs.
- **Undo** restores the last snapshot. **Retry** undoes and sends the same message again (a skip as a skip).
- **Edit your last message** (`editLastMessage`): rewind to before it, then the turn runs with the new text. Not offered for a skip entry.
- **Edit a reply** (`editReply`, last reply only): `rebuildWithEditedReply` rewinds to before the turn, re-applies a skip, re-adds the same player entry and your text as the reply (picture and mode kept, `edited: true`), and the tracker reads it again, so its first reading is gone.
- **Rewind** (`rewindTo`): long-press any of your messages still within the snapshots → "Rewind to before this?".

---

## 11. Pictures

One pipeline for every picture (`paintScene.ts`):

1. **Route** (`pictureRoute`): a sexual moment always goes to the explicit provider; anything else follows Settings (`picturesOn`: standard model or explicit provider).
2. **Director** (`writeImageAction`): frames the moment from the latest replies, SCENE NOW and the shot chip (auto, closeup, action, wide, ensemble; intimate close, above, pov, room). No director, no picture: raw prose never goes to an image model.
3. **Standard**: references (your face/outfit, people's faces or portraits, cast sheets for big scenes, one earlier scene for style) → OpenRouter image model → **picture check** (roles, someone missing, wrong scene) → one redraw on a miss.
4. **Explicit** (`paintExplicitScene`): `checkPictureCast` and `checkDirectorText` (adults only, no childlike words, no real people), `explicitScenePrompt` (looks only from the sheets, adult negative prompt), in-app **reference sheets** only (painted on the standard model from written looks when missing), then Wiro or Runware; the same check.
5. **Photos in texts** (`paintTextPhoto`): the texting model's description is the director line, the sender is the only person; a sexual photo goes explicit with the same checks.

Providers (`EXPLICIT_PROVIDERS`): **Wiro** (default; key at wiro.ai/panel/project/new, models at wiro.ai/models; `bytedance/seedream-v4-5-uncensored`, about $0.04) and **Runware** (runware.ai/signup, runware.ai/models; `runware:101@1` FLUX.1 Dev, about $0.004, holds back on nudity). Keys are tested in Settings. Costs: `lib/costs.ts`, shown under Settings → Costs.

Pictures fail with a clear toast (no key, no image model, refused by the checks) and never crash a turn.

---

## 12. Invariants

1. **Never control the player.** The narrator stops where the player would act.
2. **The narrator writes prose only.** No JSON, field names or ids in the narrator prompt; state comes from the tracker. `stripNarrationJson` / `streamingPreview` stay as safety nets.
3. **Nothing scripted, nothing built in.** The world moves from the player, people's routines and lives, and texts. Present day, no magic.
4. **Time always moves**, by the largest of the tracker's time, the parsed prose and the pace minimum, through `resolveTurnClock`. Skips go through `applySkip`; waiting for a text through `waitForNext`.
5. **Names the player knows**: narration and the UI use `displayName`; an unknown name is only a narrator-only truth.
6. **One person, one entity.** Only `is_new` creates someone; merges go through `mergeEntityPair`.
7. **Only the scene cast meets people** (`met`, `lastSeen`).
8. **Two hard limits in code**: everyone in anything sexual is a stated adult (18+) and never described as a child; no real people. Nothing else is filtered.
9. **Pictures only on request** (a button, or opening a texted photo).
10. **Keep the cached prompt prefix stable**: rules, then what the player wrote, then slow context; everything that changes per turn goes in the dynamic block. Never add unbounded prompt data.
11. **Undo restores everything**: every change a turn makes lives in the save, so a snapshot brings it back.
12. **Version sync**: `package.json` → `app.json` → the SW cache name (`scripts/generate-sw.js`) → Settings.
13. **Delete removed systems completely**: no dead code, unused exports or stubs (`tsc --noUnusedLocals`, `ts-prune`).

---

## 13. UI

- `app/_layout.tsx` — fonts, navigation, `GameProvider`, toasts, the privacy gate. Stack screens: tabs, `new-story`, `setup`, `phone`, `world-editor`.
- `app/setup.tsx` — first launch (no OpenRouter key and setup not done): the OpenRouter key with a Test, the explicit provider key with links, then "Create your first story".
- `app/(tabs)/index.tsx` — **Story**: the opening with Begin; prose and your tinted entries (`"speech"`, `*actions*`); the time chip under each reply (tap to correct); under the last reply Picture (long-press: shot), Retry, Edit, Undo; Edit under your last message; long-press to rewind; the sex strip and four moves; the mode chip, Skip and Phone chips; steer chips and an OOC note; the composer.
- `app/(tabs)/you.tsx` — portrait header, Bonds and Journal. Bonds open `bond/[id]` (portrait, your feelings, how they seem, where they are, their week, their life, shared memories, merge, mark dead, with you). Journal: a Phone row, then Now, Recap, World, Memories, Scrapbook.
- `app/phone.tsx` — the phone (§8).
- `app/new-story.tsx` — the wizard: World (where it's set) → Places → Lore → You → Backstory → Intimacy → People (incl. In bed and Their week) → Opening (day and time of day) → Review. "Help me fill this" on every step fills only what's empty.
- `app/world-editor.tsx` — edit the world, your sheet and intimacy during play; add a person; world templates.
- `app/(tabs)/settings.tsx` — Narrator (key, story / summary / memory models with recommended roleplay models, image model), explicit pictures (provider, key, model, route), Costs, Privacy, Sound, Stories (slots, export/import), Debug.

Shared UI kit: `components/List.tsx`, `components/Form.tsx`, `components/AppButton.tsx`, tokens in `constants/theme.ts`.

---

## 14. Extending safely

- **A tracker field**: `types.ts` (`TurnDiff`) → `TURN_STATE_SCHEMA` (auto-required) + a line in `STATE_SYSTEM` → `convertStateBlock` → `resolveCharacterRefs` if it names people → an apply step in `applyStateStep` or `applyTurnDiff` → tests.
- **A narrator block**: a short, capped `formatX` in `buildDynamic`; names only.
- **A background model call**: a new `MemoryJobKind`, `isJobValid`, a branch in `drainJobs`, a pure apply function.
- **Anything the player can undo**: keep it in the save so snapshots carry it.

---

## 15. Troubleshooting

| Symptom | Where to look |
|---|---|
| JSON in the chat | Something put JSON or ids into the narrator prompt; `streamingPreview`, `stripNarrationJson`; run the tests. |
| Clock moves only minutes | No time cue in the prose: the pace minimum applied. Check `time` in the tracker reply (Settings → Debug); fix a turn from its time chip. |
| Nobody texts back | Settings → Debug for a `Texts` call; "Memory pending" Retry; the reply may be pending (Wait for a reply). Asleep people answer after they wake. |
| Someone is in two places | ELSEWHERE comes from `whereNow`: story whereabouts for 6 hours, then the routine. |
| A picture fails | The toast says why: provider key, image model, or the adult checks. |
| Narrator refuses a scene | A note under the reply (`heldBack`) suggests Retry or a roleplay model from Settings. |
| Prompt growing | The budget trims; check new blocks are capped. |
| PWA stale | Bump the version; rebuild. |

---

## 16. Tests

`bun test` (scripts/*.test.ts, on the fixture world in `scripts/fixtures/`; not typechecked by `tsc`). Highlights: `verify-pipeline` (the whole turn pipeline, prompt stability over 60 turns), `sex-mode`, `intimacy`, `explicit-images` (fetch faked), `phone` (numbers, texting with reply timing, a text mid-scene, come over), `skip` (presets, typed times, overnight texts and routines), `edit` (edited reply re-tracked, rewinding three turns), `setup-costs`, `yearly`, `living-world`, `names`, `money`, `weather-map`, `wizard`, `world-edit`, `no-legacy-words` (no word from the old fantasy setting in any prompt or app string), `fixlist-*`, `immersion`, `slot-store`, `debug-panel`.

Mock rules: bun's `mock.module` leaks across files, so fake network calls by swapping `globalThis.fetch` in `beforeAll`/`afterAll`. Tests can't import `.tsx` components that use react-native; keep logic in `lib/`.
