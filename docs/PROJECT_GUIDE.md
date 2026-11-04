# Kan — Engineering & AI Handoff Guide

This document is the complete technical map of the app. It is written so a developer **or an AI coding agent** can understand, debug and extend it without prior context.

Read it top to bottom once. Then use the file map and invariants as a checklist when changing anything.

---

## 0. File map (`lib/rpg/`)

| File | What lives there |
|---|---|
| `game.tsx` | `GameProvider`: the turn loop, undo/regenerate, slot switching |
| `memoryJobs.ts` | `applyStateStep` (phase 1) and the summary job queue (phase 2) |
| `services.ts` | `applyTurnDiff` (applies one `TurnDiff` by calling the modules below) and the model calls: `extractTurnDiff`, `summarizeScene`, `summarizeTimeSkip`, `rollArcSummary` |
| `stateBlock.ts` | Reading the state model's reply: `parseJsonObject`, `convertStateBlock` (snake_case → `TurnDiff`) |
| `entities.ts` | People/places: `resolveEntity`, identity groups, `resolveCharacterRefs`, `applyEntityDiff`, presence, `mergeDuplicateEntities`, `mergeEntityPair` |
| `bonds.ts` | `applyBondDiff`: affinity, status, relationship stage, attraction |
| `facts.ts` | `applyFactDiff`, `applyThreadDiff`, `recordSceneEvent` |
| `deaths.ts` | Who is dead: `isDeceased`, `kanKnowsDeath`, `markDeceased`, `markDeathsByName` (canon, exact names only), `markAlive`, `normalizeDeaths` (load-time backfill) |
| `clock.ts` | `applyClockChange` (date/elapsed/clock from the diff, ageing across years), `applyClockTick` (stall counter) |
| `jutsu.ts` | Chakra natures, grouping, and `applyJutsuDiff` (the permanent jutsu library) |
| `log.ts` | Story log + undo snapshots: `appendStoryMessage`, `pushSnapshot`, `restoreLastSnapshot`, `cloneDatabase`, `storyMessagesSinceLastSummary` |
| `util.ts` | `trimToSentence`, `uniqueList`, `clamp` |
| `canonData.ts` | **Data only**: the 90 milestones (dates, place, who could know), canon types, courier tables, era order |
| `canon.ts` | **Canon engine**: scheduling (`advanceCanon`), state-tracker marks (`applyCanonMarks`), news routing, world clock |
| `prompt.ts` | Narrator and state prompts |
| `calendar.ts` / `timeparse.ts` / `pacing.ts` | Clock arithmetic, reading time from prose, the per-turn clock step (`resolveTurnClock`) |
| `encounters.ts` | Location kind and crowd level (`ENCOUNTER CONDITIONS`) |
| `returning.ts` | Characters who come back: the occasional optional `A FAMILIAR FACE` offer |
| `db.ts` / `seed.ts` / `canonCast.ts` | Persistence + migration, new saves, the canon cast |
| `retrieval.ts` | Memory/fact/lore retrieval |
| `romance.ts` | Hearts, lore locks, era notes |
| `image*.ts`, `reference*.ts`, `portrait.ts` | Image pipeline |
| `debug.ts` | Debug log (outside the save) |

Dependency direction: `services.ts` → `entities/bonds/facts/clock/jutsu/log/stateBlock` → `util/calendar/characterRefs/id`. `canon.ts` → `canonData.ts`. The leaf modules never import `services.ts`.

---

## 1. What the app is

- A **client-only** interactive Naruto RPG/PWA. Player = **Kan** (original Uchiha-Uzumaki, ANBU-trained, missing-nin, age 13 at the start, same age as Itachi).
- An LLM **narrator** writes the story in second person and emits a fenced JSON **state diff** at the end of every turn.
- A deterministic engine applies that diff, advances the clock, runs canon milestones, delivers news, records memories, updates bonds/jutsu, and persists everything.
- No server, no database service: `AsyncStorage` (localStorage on web) + OpenRouter API.

Tech: Expo SDK 54, Expo Router, React Native Web, TypeScript, `bun` as package manager.

---

## 2. Persistence

`lib/rpg/db.ts`

| Key | Contents |
|---|---|
| `kan.meta.v1` | `StorageMeta`: active slot id, slot list, timestamps |
| `kan.slot.<slotId>.v1` | One `AppDatabase` JSON per save slot |
| `kan.apiKey.v1` | OpenRouter API key (never stored in slots or exports) |

Important functions:

- `loadSlot`, `saveSlot`, `createSlot`, `duplicateSlot`, `deleteSlot`, `renameSlot`, `switchSlot`, `listSlots`, `loadActiveSlot`
- `exportDatabase(db)` → pretty JSON string; `importDatabase(json, name?)` → new slot
- `normalizeDatabase(db)` → migration + repair + JSON stripping + default fields. **Every load/import passes through it.**
- `buildIndices(db)` → the `MemoryIndex` used by retrieval

### Storage quota strategy

`saveSlot` tries progressively smaller writes until one succeeds:

1. full database
2. max 3 assistant images, 1 snapshot (`MAX_STORED_IMAGES`, `MAX_SNAPSHOTS`)
3. 1 image, 0 snapshots
4. 0 images, 0 snapshots

Each generated image is ~0.5 MB base64, so images are the main quota risk.

---

## 3. Data model (`lib/rpg/types.ts`)

```ts
AppDatabase {
  schemaVersion: number
  meta: StorageMeta
  settings: Settings
  rawLog: RawLogEntry[]          // story messages (user/assistant) with dates, tokens, image
  entities: EntityRecord[]       // characters/places/organizations + lore + lastSeen
  jutsuRecords: JutsuRecord[]    // permanent jutsu library
  events: EventRecord[]          // memories, canon world events, time skips
  eventEntities: EventEntityRecord[]
  bonds: BondRecord[]            // affinity, status, relationship, attraction, romanceNote
  facts: FactRecord[]            // permanent facts with whoKnows + validity
  threads: ThreadRecord[]        // open/resolved plot threads
  loreEntries: LoreRecord[]      // keyword-triggered world lore
  summaries: SummaryRecord[]     // chapter / arc / year summaries
  state: GameState
  indices: MemoryIndex
  snapshots: TurnSnapshot[]
}
```

### `CalendarDate` — the clock

```ts
{ year, month, day, hour, minute, second? }
```

No `timeOfDay` field. Period labels (`morning/afternoon/evening/night`) are derived with `timeOfDayOf(date)` (05–11 morning, 12–16 afternoon, 17–20 evening, otherwise night).

### `GameState`

```ts
{
  player: PlayerSheet
  mood: string
  worldDescription: string
  jutsu: string[]              // name list shown to the narrator (capped)
  inventory: string[]          // includes Akatsuki cloak detection
  location: string
  locationKind?: 'settlement' | 'road' | 'wilderness' | 'structure'
  inStoryDate: CalendarDate
  turnsWithoutTimeChange?: number   // turns where only the pace minimum moved the clock; drives a prompt nudge
  canonPoint: string
  canonProgress?: CanonProgress
  chapter: number
  scene: string
  scenePace?: 'combat' | 'chase' | 'conversation' | 'travel' | 'downtime'
  sceneCast?: string[]
}
```

### `CanonProgress`

```ts
{
  version: 3
  baselineDate: CalendarDate
  baselineTurn: number          // legacy; no longer used (canon follows dates only)
  completed: string[]           // milestone ids (including expired/silent)
  active: string[]              // open encounter windows
  engaged: string[]             // personal beats started but not finished
  expired: string[]             // windows that closed before they could happen
  heard: Record<eventId, { from: string; date: CalendarDate }>
  heldForCombat?: boolean       // last advance was held because Kan was mid-fight
}
```

### `TurnDiff` (what the state call produces)

```ts
{
  state?: {
    mood?, worldDescription?, jutsuAdded?, jutsuRemoved?,
    inventoryAdded?, inventoryRemoved?, location?, locationKind?,
    inStoryDate?, elapsedSeconds?, clockTime?: {hour,minute},
    scenePace?, canonPoint?, chapter?, scene?, sceneCast?
  },
  imageWorthy?: boolean,
  entities?: [{ entityId?, isNew?, name, age?, role?, personality?, speechStyle?, mood?, appearance? }],
  jutsuUsed?: [{ name, user, chakraNature?, effect?, visual? }],
  bonds?: [{ entityId?, character, affinityDelta?, status?, note?, isMajor?, relationship?, attraction?, romanceNote? }],
  facts?: [{ action, type?, text, subject?, whoKnows?, validFrom?, ... }],
  threads?: [{ action, title, description?, type?, participants? }],
  canonCompleted?: string[], canonEngaged?: string[], canonPassed?: string[],
  newsRelayed?: [{ id, from? }],
  scene?: { ended, summary?, tags?, entities?, importance? }
}
```

Note: the state model returns **snake_case** JSON matching `TURN_STATE_SCHEMA` (`lib/rpg/stateSchema.ts`): flat `location`, `time.elapsed`, `affinity_change`, `characters_present`, `character_updates`, `scene_ended`, `image_worthy`, `news_relayed`, `canon_completed`, … Strict mode means every field is always present, with `null` / `[]` for “unchanged”. `convertStateBlock` (`stateBlock.ts`) ignores those and translates the rest → `TurnDiff` camelCase. It still accepts the older nested `state: { location, … }` shape.

---

## 4. Turn lifecycle

Main file: `lib/rpg/game.tsx` (`GameProvider`).

### `sendTurn(input)`

1. Validate API key and action text.
2. Snapshot the database (undo).
3. Append the player message to `rawLog`.
4. `buildNarrationPrompt(db, action)` → messages + estimated tokens. The narrator prompt contains **no JSON instructions and no canon ids**; it only asks for prose and for time, place, people and outcomes to be legible in it.
5. **Call 1 — narrator.** `streamChatCompletion` (SSE) with the story model. Text streams to the screen live (`streamingText`, throttled to ~60 ms; `streamingPreview` hides anything from a stray ``` or `{"` onwards). Kan's line is shown meanwhile via `pendingAction`.
6. `stripNarrationJson` runs once on the final text as a safety net only. If the finish reason is `length` or the prose ends mid-sentence, it is trimmed to the last complete sentence (`trimToSentence`). There is no continuation request.
7. Snapshot + append the player and assistant messages onto the **latest** copy of the slot (`updateLatest`), not the copy the prompt was built from.
8. **Call 2 — state.** `runStateStep(...)` starts in the background; the next turn, undo and regenerate wait for it.

### Saving a turn: two phases (`lib/rpg/memoryJobs.ts`)

**Phase 1 — state step (`runStateStep` → `applyStateStep`)**, saved immediately:

1. `extraction = extractTurnDiff(...)`: the memory model (`settings.extractionModel`, a cheap one) gets `buildExtractionPrompt` — `STATE_SYSTEM` rules, current state/characters/jutsu/bonds/facts/threads, `TIME BEFORE THIS TURN`, `CANON TRACKING` (active/personal beat ids and unheard news ids with the rule for each), the previous beat for context, then this turn's player line and prose. It is sent with OpenRouter structured output (`response_format: json_schema`, `strict: true`, `provider.require_parameters: true`). If no provider for that model supports it, `completeChat` falls back to `json_object`, then to a plain reply; `parseJsonObject` + `convertStateBlock` read whatever comes back. If the call fails, a `state` job is stored as pending and nothing else changes; an unreadable reply applies `null` (the prose clock parser still runs).
2. **Narration clock**: `detectNarrationTime`, pace via `extraction.state.scenePace ?? inferScenePace`, then `resolveTurnClock(...)` returns the one forward step for the turn (largest of reported, parsed and the pace minimum; combat cannot skip days; a full night's sleep jumps to morning). The diff carries only that `elapsedSeconds`; the applied seconds are stored on the reply as `rawLog[].elapsedSeconds` for the time chip.
3. `applyTurnDiff` (`services.ts`) in this order: state + clock (`clock.ts`), entities (`entities.ts`), revivals and deaths (`deaths.ts`), jutsu (`jutsu.ts`), bonds incl. romance (`bonds.ts`), facts and threads (`facts.ts`), scene event, duplicate merge, presence, stall counter.
4. `applyCanonMarks` → `markNewsHeard` → `advanceCanon`.
5. Queue follow-up jobs in `db.memoryJobs`:
   - `timeSkip` if `daysBetween(before, after) >= 180`,
   - `scene` when `imageWorthy`, `scene.ended`, or `storyMessagesSinceLastSummary >= autoSummarizeThreshold`. A pending scene job is widened (up to 12 messages) instead of stacking a new one.
6. Commit. The clock, bonds, facts and canon are now saved.

**Phase 2 — summary jobs (`drainJobs`)**, one at a time, never blocking the next turn:

- Each job reads the latest save, calls the model (`runSummaryJob`), then `applySummaryJob` applies the result to the save **as it is at that moment**. If the turn it came from was undone or the job was removed, the result is discarded.
- A finished chapter summary queues `arc` (every 3 chapters) and `year` (every 12) roll-ups, deduplicated by `sourceSummaryIds`.
- Every step has its own error handling: a failure marks just that job `failed` (with `attempts` and `error`); the rest still run.
- Jobs are stored in the save, so a step interrupted by closing the tab survives a reload.
- Story screen: "Memory updating…" while any step runs; "Memory pending · N" with **Retry** when a step failed (`pendingMemoryCount`, `retryPendingMemory`).
- A `state` job only stays valid while its turn is the newest; once another turn is narrated it is dropped.

**Write ordering**: `commitDb` updates `dbRef` synchronously and saves through a serial queue, so an older copy can never be written last. Writes to a slot that isn't open go through `updateLatest`'s inactive path (load → mutate → save, serialized).

### `undoLastTurn` / `regenerate`

- Undo restores the most recent snapshot (taken just before the turn was saved), then `carryOverMemory` keeps summaries that finished later if everything they were written from still exists (`sourceLogIds` / `sourceSummaryIds`), plus pending jobs that still apply.
- Regenerate re-sends the last user message from the pre-turn state (same carry-over).

---

## 5. Prompt composition (`lib/rpg/prompt.ts`)

`buildNarrationPrompt` returns `{ messages, estimatedTokens, memories, recentMessages, arcSummary }`.

The prompt is ordered from never-changing to changing-every-turn, so its front is a stable prefix that providers can cache (cache reads cost a fraction of fresh input; see Settings → Debug for cached tokens per call).

### System message (two cacheable blocks)

1. **Rules** — `NARRATION_SYSTEM`, identical on every turn of every story (~1.3k tokens):
   - **CORE** — never control Kan, place-name rule (English names), date/rank/knowledge discipline, supplied context is truth, binding threads.
   - **TIME** — TIME block is the only date, relative time only, durations made explicit and honest.
   - **CANON** — never invent canon; news only through bearers; identity rules (masked man = Tobi = Obito = fake Madara, real Madara separate, mask breaks only in the war; Pain = Nagato's six bodies; Zetsu = one being).
   - **STYLE** — plain English, 2–4 paragraphs, no repeats, rare encounters, new characters, Kan's `"speech"` / `*action*` markers.
   - **ROMANCE** (from `romance.ts`): lore-locked vs winnable, adults deflect under 17, explicit intimacy only 18+, rejections hold by default but can slowly thaw when the story earns it.
   - **OUTPUT** — prose only, changes legible in the prose.
2. **Slow context** — `formatCharacterSheet`, `formatStorySoFar` (latest arc summary + up to 3 newest chapter summaries the arc doesn't cover, never fewer than 2), `formatJutsu`, `formatThreads`, `formatBonds`, `formatTheDead` (everyone dead, flagged when Kan does not know yet). Changes only when a summary lands, a jutsu is used, a thread or bond moves.

Each block is sent as a text part with `cache_control` for models that need explicit breakpoints (`anthropic/`, `google/`, `qwen/` — see `toWireMessages` in `lib/openrouter.ts`; Gemini uses only the last one). Other providers (OpenAI, DeepSeek, …) cache a repeated prefix automatically and get plain string content. `OpenRouterMessage.content` is always the full text; `parts` is only the split.

### Dynamic user block (in order)

1. `formatState` (date, place, mood, world, inventory, canon point)
2. `formatTimeLine` — `Year 13 · Day 4, October · 9:40 PM` plus a nudge to state durations once `turnsWithoutTimeChange >= 2`
3. `formatMatchedEntities` (with lore hearts + era notes), `formatFacts` (≤10), `formatLore`
4. `formatNewsBlock` — the single next unheard event (none in combat), major first, with location, bearers, courier channel, overdue escalation
5. `formatUpcomingWorldBlock` — planned world events in the next ~10 days (“RUMORS OF WHAT'S COMING”)
6. `formatCanonBlock` — recent heard world events, pending personal beats (“do not assume”), active beats + encounter context, recently concluded
7. `formatMemories` — retrieved events (≤ retrieval limit, 400 chars each), skipping any that repeat a summary already in STORY SO FAR
8. `formatRecentMessages` — last `contextMessages` (default 16). The newest narration keeps its last 2200 chars; older narrations keep their **start and end** (`headAndTail`, 1400 chars: ~40% opening, ~60% ending); player input 500 the same way
9. `formatLastBeat` — final 450 chars of the newest narration
10. `formatEncounterConditions` — place kind, hour and how crowded it is
11. `formatReturningCharacter` — occasionally, “A FAMILIAR FACE (optional)”: one original character Kan has not seen in a while who fits the current place (see §9)
12. `CONTINUITY` line + location kind
13. `YOU (KAN) DO OR SAY: <action>`

There is no dice roll and no repeated-word list. Encounter frequency comes from the STYLE rule (rare, must fit the conditions, never two in a row) plus `ENCOUNTER CONDITIONS`; freshness comes from the STYLE rule against reusing descriptions and the `CONTINUITY` line. (Both blocks were removed: the roll added random events that fought canon pacing, and listing overused words put those words back in front of the model.)

The current action appears **once** (it is excluded from the recent-message block).

### Token budget

`settings.promptTokenBudget` (default 9500; Settings → Advanced → Story context offers 6k / 8k / 9.5k / 12k). After building, the prompt drops the oldest scene messages (never below 4) until `estimateTokens` is under budget.

### State prompt (call 2)

`buildExtractionPrompt` puts `STATE_SYSTEM` first as its own cacheable block (field-by-field rules, ~650 tokens: time, place, people, jutsu, memory, canon, image) and runs after **every** turn against `TURN_STATE_SCHEMA`. The canon ids the narrator no longer sees are given here in `formatCanonTracking`, each with the rule for marking it. News and canon blocks in the narrator prompt describe events in plain words only.

---

## 6. Memory & retrieval (`lib/rpg/retrieval.ts`)

- `retrieveMemories(db, {recentMessages, userMessage}, limit)` scores events by:
  - entity presence in recent text,
  - tag/keyword overlap,
  - importance,
  - recency (in-story date),
  - pinning.
- `relevantFacts(db, entityIds, text)` returns matched facts (by subject) plus recent ones, capped at **10**.
- `triggeredLore(db, text)` matches keyword-triggered lore entries, capped at **4**.
- Events (memories) are created by `recordSceneEvent` (on `scene.ended`), by **every chapter summary** (`saveSummaryMemory` in `memoryJobs.ts`: tagged `summary`, linked to the characters it names, folding in the short scene-end events from the same stretch), time skips, and canon milestones.
- Summaries: chapter summaries feed the arc summary; the latest arc plus the newest chapters feed the prompt. `storyMessagesSinceLastSummary` is the summarization cadence guard.

### Entity identity resolution (`entities.ts`)

- `resolveEntity(db, name)` — exact name/alias → fuzzy word-boundary → identity-group fallback.
- Identity groups: `masked-man`, `real-madara`, `pain`, `zetsu`.
  - All masked-man aliases merge; real Madara never merges with the masked man.
  - Pain/Nagato/six paths merge; Zetsu halves merge.
- `mergeDuplicateEntities` runs on every turn; it and the manual merge both use `mergeEntityPair`, which folds one person into another (names become aliases, bonds combined, facts/event links/threads/jutsu/scene cast moved).
- `lastSeen` is stamped only for `characters_present` (physically present, not merely mentioned).

### Duplicate characters

- **Canon cast** (`canonCast.ts`): the main canon characters (Sasuke, Kakashi, Kisame, Kakuzu, Pain, the masked man, …) are in every save from the start, each once, with aliases, birthdays and roles as of year 13. They start with `met: false` and stay off the bonds list until they are present in a scene, get a bond, or are updated by the tracker. `ensureCanonCast` runs in `seedDatabase` and `normalizeDatabase`: older saves gain the people they lack, and a person they already have under any name gets the other names as aliases instead of a second entry. The real Madara is deliberately absent (bare "Madara" stays the masked man). Aliases avoid common words ("Guy", "Leader").
- **IDs for the state tracker** (`characterRefs.ts`): the extraction prompt lists `KNOWN CHARACTERS` as `- kisame-hoshigaki: Kisame Hoshigaki (Kisame, Hoshigaki Kisame) [not met yet]` (cached part), plus `CHARACTERS IN THIS TURN` details (dynamic part). IDs are slugs of the current name, `-2` on collisions. The schema uses `bonds[].character_id`, `character_updates[].character_id`, and IDs in `characters_present`, `facts.entity/who_knows`, `jutsu_used.user`, `news_relayed.from`.
- **Only `is_new: true` adds someone**: `new_characters[]` entries need `is_new: true`; `false` is dropped. `resolveCharacterRefs` (run in `extractTurnDiff`) maps each reference to a person: known ID → exact new name from this turn → name/alias fallback → otherwise dropped (a bond or update for an unknown ID never creates a person). A "new" person whose name resolves to someone known becomes an update.
- **Name mentions** (`mentionsName` / `mentionsEntity`): whole-word, Unicode-aware; "Pain" must be capitalized. Used for narrator scene cards, retrieval, image cast fallback and summary links, so "asleep" no longer finds Lee and "Sarutobi" no longer finds Tobi.
- **Merge with…** on the bond screen (`components/kan/MergeSheet.tsx`, `mergeCharacters` in `game.tsx`): pick the other person (likely duplicates by shared name words first), choose which name to keep, merge.

---

### Deaths (`deaths.ts`)

A death lives on the person's own record (`EntityRecord.deceased: { date?, cause?, known?, canonEventId? }`), not only as a fact, so it is never lost to the 10-fact cap.

- **Canon**: a milestone's `deaths` are marked when it fires (`fireMilestone`), stamped with its event id. Kan *knows* once that news is heard (or he witnessed it); until then the bonds screen shows them as before, so news is never spoiled.
- **Story**: the state tracker's `deaths[]` (`character_id`, `cause`) marks anyone who dies on screen, whose body Kan sees, or whose death he is told of — known at once. `revived[]` undoes it for a true return to life (never Edo Tensei) and tags the person `revived` so loading never kills them again.
- **Seeded**: Shisui (known) and Izumi (unknown until told, or until her funeral news arrives).
- **Prompts**: narrator gets `THE DEAD` every turn plus `[DECEASED]` on scene cards and bonds, with the rule that the dead never appear alive; the state tracker sees `deceased` in `KNOWN CHARACTERS`.
- **Effects**: the dead never get `lastSeen` stamped; the bonds screen lists known dead under "The dead"; the bond screen has **Mark as dead / Mark as alive** for corrections (`setCharacterDeceased`).
- `normalizeDeaths` runs in `normalizeDatabase`: older saves get records for canon deaths that already fired.

---

## 7. Canon (`canonData.ts` + `canon.ts`)

Data and logic are separate. `canonData.ts` holds only data; `canon.ts` is the engine and never hard-codes an event.

### Milestone shape (`canonData.ts`)

```ts
{
  id, era, title, description, canonPoint?,
  from: {year, month, day?}, to?: {year, month, day?},
  region?, location?,              // where it happens (defaults: "the shinobi world")
  knowledge?,                      // public (default) | village | akatsuki | witnesses | secret
  bearers?,                        // named confidants, only for secret events
  major?, playerDriven?,
  facts: string[],
  deaths?: string[],               // people it kills, by exact name/alias (marked dead on their record)
  encounter?: { who, where, context },
  attendanceFact?, opensThreads?, resolvesThreadTitles?
}
```

Everything about one event — when, where, who could know — sits in its one record. The courier tables (`BEARERS_BY_KNOWLEDGE`, `CHANNEL_BY_KNOWLEDGE`, `REGION_CHANNEL`) are also in `canonData.ts`.

- **90 milestones** from the Uchiha massacre aftermath to the post-war epilogue.
- Timeline spine: Kan/Itachi 13 at the massacre; Part 1 at 17–18; Shippuden 20–21; war 22–23.
- `playerDriven` = **personal beat** (join Akatsuki, missions, Team 3 reunions, war side, Edo Itachi, epilogue…). These **never auto-fire**; they fire when the narrator marks them.
- World milestones fire on the **in-story date + prerequisites only** — never on turn counts. There is no per-turn cap: a long time skip fires everything that came due, each stamped with the day it happened (clamped to the save's baseline), not the day the clock caught up.
- **Nothing fires during combat.** `advanceCanon(db, { inCombat })` (default: `state.scenePace` is `combat`/`chase`) does nothing but set `heldForCombat`; `applyStateStep` passes `inCombat = combat/chase pace && !scene_ended`. Everything due fires on the first turn after the fight.
- Windows use the **real calendar** (`daysFromCivil`).

### Scheduling (`advanceCanon` in `canon.ts`)

- `baselineDate` prevents a backlog dump on load/import.
- Milestones whose `to` closed before the baseline are marked completed **silently** (no journal entry) and tracked in `expired`.
- Encounter windows go into `active`; the narrator can resolve them.
- Personal beats appear in the prompt as pending offers with their id.

### Narrator marks (`applyCanonMarks`)

- `canon_completed` → fire if needed, add `attendanceFact`, mark **witnessed**, record facts/threads/canonPoint.
- `canon_engaged` → record the event, add to `active` + `engaged` (not completed).
- `canon_passed` → complete without attendance, log a “never crossed paths” fact.

### News & rumors

- Every fired world event is **unheard** until delivered.
- `unheardCanonNews` returns unheard events, major first, with region/location/bearers/channel.
- **One piece of news per turn** (`NEWS_PER_TURN`): the narrator and the state tracker are shown only the next unheard item, and `markNewsHeard` accepts only one relay per turn. During combat no news (and no "rumors of what's coming") is offered at all.
- Knowledge classes: `public`, `village`, `akatsuki`, `witnesses`, `secret`.
- Channels: Akatsuki → Itachi’s crow / Konan’s paper butterfly / Zetsu; Leaf → hawk/courier; Sand → caravan; Mist → sailor; Cloud → runner; Stone → stone-route courier; Iron → samurai rider; public → merchant/crier/bounty board.
- Major events unheard for 7+ in-story days are marked **OVERDUE** so the narrator delivers them through the courier channel.
- Secrets (mask identity, Itachi’s illness/truth) only travel via named confidants.
- `news_relayed: [{id, from}]` records delivery (`heard` map), and the Journal hides unheard events.

### Canon point

`state.canonPoint` is a short world-state line updated only by milestones that define `canonPoint` (the funeral deliberately does not set it).

---

## 8. Calendar, clock & pacing

### `lib/rpg/clock.ts`

- `applyClockChange(db, state)` applies the turn's `inStoryDate` / `elapsedSeconds` / `clockTime` (the step `resolveTurnClock` already chose) and ages characters without a birth year when the year changes.
- `applyClockTick(db, diff)` keeps `turnsWithoutTimeChange` (prompt nudge only).

### `lib/rpg/calendar.ts`

- `CalendarDate` = year/month/day/hour/minute/second.
- Real month lengths + leap years (`daysInMonth`, `isLeapYear`).
- `daysFromCivil` / `civilFromDays` (proleptic Gregorian).
- `advanceSeconds`, `shiftDate`, `setClock` (rolls to next day when the target time is earlier).
- `daysBetween`, `dateSortValue` (full timestamp sort key), `secondsBetween`, `shiftSeconds` (forward or back), `sameDate`, `isBirthday`.
- `formatElapsed(seconds)` — the reply chip label: `+15 s`, `+2 min`, `+1 h 30 min`, `+2 d 4 h`.
- `calculateAge`, `formatClock` (AM/PM), `formatDate`, `formatShortDate`, `formatDay`, `formatStoryDate`, `timeOfDayOf`.
- `paceCapSeconds(pace, sceneEnded)`:
  - combat 600 s (7200 if scene ends), chase 1800 s (7200),
  - conversation 3600 s, travel 3 days, downtime 7 days, default 1 day.

### `lib/rpg/timeparse.ts`

`detectNarrationTime(text, current)` returns `{ elapsedSeconds, clock?, explicitDate? }`:

- Fixed phrases: heartbeat/instant (2 s), few seconds (5 s), short rest/nap (30 min), seconds of fighting (15 s).
- A (good/full/long) night’s sleep or “slept through the night / until dawn” sets `sleptNight` instead of fixed hours.
- Number + unit only when elapsed markers are present (`later`, `after`, `passed`, `of travel`, past-tense verbs). Ignores “three nights of flight”, “four months ago”, “watched for a week”, “two-day march”.
- Exact clocks: `at 3:40 PM`, `03:40`, `at dawn/noon/dusk/midnight/nightfall`, “it is evening now”.
- Explicit dates: “the fifth of October”, “October 5”, with real-month clamping and year rollover.
- Period words only match in temporal context, so “a night’s sleep” is not 10 PM.

`applyParsedTime(current, parsed)` applies elapsed then clock (rolling days as needed).

### `lib/rpg/pacing.ts`

- `inferScenePace(text)` keyword fallback: combat → chase → downtime → travel → conversation.
- `PACE_MINIMUM_SECONDS` / `paceMinimumSeconds(pace)`: combat 15 s, chase 1 min, conversation 2 min, downtime 10 min, travel 30 min (no pace → conversation).
- `resolveElapsedSeconds({reportedSeconds, detectedSeconds, pace, sceneEnded})` = what the story says: max(reported, detected) capped by pace.
- `secondsUntilMorning(current)` — seconds to the next 7:00; going to bed after 3 AM sleeps 8 h instead.
- `resolveTurnClock({reportedSeconds, reportedClock, detected, pace, sceneEnded, current})` — the single source of truth used by `applyStateStep`. Returns `{ elapsedSeconds, minimumSeconds, storyTimed }`, where `elapsedSeconds` is the whole forward step:
  - story time (capped) → then a stated hour (parser first, then the state model’s `clock_time`) on the day the story reached, or the next occurrence of that hour; an hour up to 60 min behind the clock is treated as a restatement of “now” and ignored;
  - an explicit date jumps there when it is ahead of the clock;
  - `sleptNight` jumps to the next morning (or later if the story says so);
  - finally `max(minimum, that step)`, so the clock always moves forward;
  - combat/chase with an unfinished scene: no date jumps, no backward hours, no sleep jump.
- `storyTimed` is false when only the minimum moved the clock; it feeds `turnsWithoutTimeChange`.

### Reply time chip

- `applyStateStep` stores the seconds the turn actually moved the clock on the reply (`rawLog[].elapsedSeconds`).
- Story shows it as a `+2 min` chip under each reply (`TimeChip` in `app/(tabs)/index.tsx`); tapping opens a sheet with presets (15 s … 3 days) and a custom amount in min / hours / days.
- `correctTurnTime(db, logId, seconds)` (`memoryJobs.ts`, exposed as `useGame().correctTurnTime`) shifts the clock — and every later log entry’s `inStoryDate` — by the difference, marks the reply `timeCorrected`, and runs `advanceCanon` when time moved forward.

### Rules

Each turn, time passed = the largest of: what the narrator reports, what the text parser finds, or the minimum for the scene type.

- Minimums: combat ~15 s, chase ~1 min, conversation ~2 min, downtime ~10 min, travel ~30 min.
- Fights can’t skip days (10 min cap, 2 h once the scene ends; no date jumps).
- Travel only skips days when the story says so (capped 3 days per turn); otherwise it moves the 30 min minimum.
- A full night’s sleep jumps to morning.
- A `+N min` chip under each reply; tap it to correct the time for that turn.

---

## 9. Encounter realism (`lib/rpg/encounters.ts`)

- `classifyLocation(text)` uses first-mentioned place word → `settlement | road | wilderness | structure`.
- `state.locationKind` is preferred when set by the diff.
- Risk matrix:
  - settlement: high day, medium evening, low night
  - road: medium day, low evening, very-low night
  - wilderness: low day, none evening/night
  - structure: low day, none night
- `formatEncounterConditions(db)` adds a one-line crowd/time line with the clock (`ENCOUNTER CONDITIONS: wilderness, night (10:00 PM) — isolated …`). The narrator decides from that and the STYLE rule; there is no roll.

### Characters who come back (`lib/rpg/returning.ts`)

- Every character records `lastSeen` **and** `lastSeenAt` (the `state.location` at the time) when they are present or updated (`recordPresence`, `applyEntityDiff`; merges keep the place that goes with the newer date).
- Candidates: original characters only (no `canon` tag, not a `CANON_CAST` name, not Kan), met, alive, not in the scene cast, not named in the recent scene, and unseen for at least `RETURN_MIN_DAYS_AWAY` (14) in-story days.
- Fit to the current place, strongest first: last seen here (a distinctive place word in `lastSeenAt` matches the current location, after English place names) → role/notes tie them to this place → a travelling role (merchant, courier, mercenary, wanderer…) while Kan is on a road or in a town. No fit, no offer. A bond adds weight, a major bond more.
- Cadence: one offer turn per `RETURN_WINDOW_TURNS` (8) player turns, picked by a hash of slot + window, never before turn 6, never in combat/chase, never where `encounterRisk` is `none`. The pick rotates among the top three. Everything is deterministic, so a regenerated turn gets the same offer; once someone resurfaces, their `lastSeen` resets and they leave the pool.
- The block is optional for the narrator: use them only if it fits; if used, they are the turn's encounter.

---

## 10. Romance & lore (`lib/rpg/romance.ts`)

- `RelationshipStage`: stranger → friendly → close → romantic interest → partner / rejected.
- `Attraction`: none | warm | strong.
- `normalizeRelationship` / `normalizeAttraction` tolerate model wording.
- `CHARACTER_LORE` holds canon devotions, accessibility (`winnable` / `lore-locked`) and orientation.
- `ERA_NOTES` gives era-specific personality lines keyed by year (`eraKeyForYear`, `eraNoteFor`).
- `ROMANCE_RULES` is injected into the narrator system prompt.
- Bonds store relationship/attraction/romanceNote; a rejection stays until the narrator moves it on (never from affinity alone); a winnable heart that rejected Kan can slowly change its mind over time.
- Adult NPCs deflect while Kan is under 17; explicit intimacy only when both are 18+; the prompt instructs **never to censor** when ages permit.

---

## 11. Image pipeline (`lib/rpg/image.ts`, `referenceImages.ts`)

- Three static references: `kan-face-sheet.jpg`, `kan-outfit-black.jpg`, `kan-outfit-akatsuki.jpg`, plus up to two recent scene images.
- **Model capabilities (`imageCaps.ts`, `fetchImageModelCaps`)**: when an image model is picked in Settings, the app reads `GET /api/v1/images/models/{id}/endpoints` and keeps only what *every* endpoint accepts (enum values intersected, ranges narrowed), falling back to the model-level summary. Saved as `settings.imageModelCaps` (`maxReferences` from `input_references.max`) and re-checked when stale or when the model changes. Settings shows a line under Images ("Takes up to N reference images…", red when 0).
- `buildImageRequestBody(caps, …)` sends only accepted fields: `resolution` 1K, `aspect_ratio` (closest allowed ratio if 16:9 / 3:4 isn't offered), `quality`, `output_format` jpeg/webp + `output_compression`, and at most `maxReferences` references. On a 400/422 it retries once with just prompt + the same references; it never drops references silently.
- `referencePlan.ts` `planReferences` orders by priority **face → current outfit → recent scene images (newest first) → alternate outfit** and cuts at the model's limit, so Kan's face is the last to go. If the face can't be sent (model takes 0 references, or the sheet failed to load) the player gets a warning toast (`faceDroppedWarning`), and the prompt describes Kan in words instead.
- `buildSceneImagePrompt(db, references, action)` labels references in the order actually sent; previous scene images are style/palette/lighting only.
- **ACTION**: written fresh on every tap by `writeImageAction` — a small call to the memory (extraction) model with the latest reply, Kan's last input, location, outfit and cast; it returns one or two sentences naming who does what to whom. Logged in Debug as "Image description". Falls back to the last 700 chars of narration if the call fails. The state tracker no longer writes an image brief each turn.
  - actor rule (Kan performs the action unless stated otherwise), named cast only, no text in image.
- Portraits (`PortraitHeader.tsx`) use the same caps and plan: face → outfit → previous portrait.
- Images are generated **only when the player taps the image button** (`generateSceneImage` in `app/(tabs)/index.tsx`).
- **Storage (`imageStore.ts`)**: images never live in the save. `storeImage` writes the data URI to IndexedDB (`kan-images`) and returns a short `img:<id>` reference that goes into `rawLog[].image` / `portraits[].image`. `loadImage` / `useStoredImage` resolve references (in-memory cache). On load, switch and import, `externalizeImages` migrates any inline data URIs from older saves. Export inlines images again (`inlineImages`) so save files stay self-contained. Without IndexedDB, `storeImage` returns the data URI unchanged.
- **Portraits (`portrait.ts`)**: `portraitSignature(db)` reduces Kan to age, outfit (Akatsuki cloak in inventory), a coarse expression bucket from `state.mood`, and a setting bucket from `locationKind`. `portraitStaleReason(latest, current)` says why the latest portrait is outdated (outfit → age → expression → setting) or returns null. `buildPortraitPrompt` asks for a 3:4 head-and-shoulders portrait using the face sheet, the current outfit and the previous portrait as references. Portraits are generated only from the Kan tab's Refresh button and stored in `db.portraits` (last 24).

---

## 12. UI

- `app/_layout.tsx` — fonts (Manrope), navigation, GameProvider, toasts, Android nav bar.
Three tabs: **Story / Kan / Settings**. All list screens use the shared kit in `components/List.tsx` (`SectionLabel`, `ListCard`, `ListRow`, `FilterPills`, `Segmented`) and the type tokens in `constants/theme.ts` (`sectionLabel`, `rowTitle` 15 bold, `rowBody` 13, `rowMeta` 12, `prose` 16) — use them for new screens instead of one-off styles.

- `app/(tabs)/index.tsx` — Story: narration as plain prose, Kan's turns as tinted blocks (`*actions*` italic), header with clock/date/location (tap → status sheet with mood, date, scene), news strip, a `+N min` time chip under each reply (tap to correct), Image / Retry / Undo under the latest reply, single-row composer with `"` and `*` markers, fullscreen image viewer.
- `app/(tabs)/kan.tsx` — Kan hub: `components/kan/PortraitHeader.tsx` (current portrait, outdated reason, Refresh, history strip) plus a sticky Bonds / Jutsu / Journal switch.
  - `BondsSection.tsx` — search + compact rows (people you have met; unmet canon cast is hidden) (avatar, name, Major tag, affinity bar, relationship · last seen), sorted by most recent contact; rows open `app/(tabs)/bond/[id].tsx` (bond meter, chips, mood/personality/speech/appearance, shared memories, Merge with…).
  - `JutsuSection.tsx` — jutsu grouped by chakra nature; rows expand for appearance and notes.
  - `JournalSection.tsx` — Now (scene, missions, goals, threads), Recap (timeline of summaries, falls back to recent events), World (heard canon news with source, world state, lore), Memories (events with people). `titleAndBody` splits a summary into a short title and the rest.
- `app/(tabs)/world-clock.tsx` — hidden **World clock** (long-press the clock in the Story header; `href: null`, no tab). Read-only view of `worldClock(db)`: running/held-for-combat status, not heard yet (next in line first), due-but-waiting, queued with dates and days until, personal moments open to you, fired (with who told you), and missed beats. Contains spoilers by design.
- `app/(tabs)/settings.tsx` — Narrator (key status that expands into the editor, Story and Images models, Advanced: summary + memory models), World (canon toggle), Stories (slots with a ⋯ menu: play, copy, rename, delete; New story), Export / Import, Debug, version and credit.
- `components/settings/DebugPanel.tsx` — Settings → Debug. For each of the last 30 turns: the exact messages the narrator saw (newest 5 only; copyable), the state step's status, raw reply, applied diff and a field-by-field list of what changed in the save, and every call the turn made (narrator, state, summaries, images) with billed tokens, thinking/cached tokens, time and cost.

### Debug log (`lib/rpg/debug.ts`)

- Lives outside the save, in its own IndexedDB store (`kan-debug`), so it never costs save quota or travels with an export. Memory only where IndexedDB is missing.
- A turn is opened with a temporary id when the prompt is built and re-keyed to the narrator reply's log id once saved; background steps (state retries, summaries) record against `job.turnLogId`, so their spend lands on the turn that caused it.
- Costs are never estimated. Every chat request sends `usage: { include: true }`; `CallUsage.cost` comes from the reply, or from `GET /api/v1/generation?id=` when the reply had none. A `+` after a total means a call reported no cost.
- `describeStateChange(before, after)` diffs the save around `applyStateStep` (skips rawLog, snapshots, indices, meta, settings, memoryJobs).

---

## 13. Invariants (do not break these)

1. **Never control Kan.** The narrator stops when the player must act.
2. **The narrator writes prose only.** Never add JSON, field names or canon ids to the narrator prompt; state comes from the separate structured state call. `stripNarrationJson` / `streamingPreview` remain as safety nets. JSON must never appear in the chat.
3. **Canon truth**: no invented canon event, funeral, death or date; only milestones/news/facts count.
4. **Time always moves, by the largest of** the narrator’s report, the narration parser, or the scene-type minimum (combat 15 s, chase 1 min, conversation 2 min, downtime 10 min, travel 30 min). Every advance goes through `resolveTurnClock`, never forward-only hacks elsewhere; the player can correct any turn from its time chip.
5. **Combat cannot skip days** around the player; the cap is enforced in `resolveTurnClock`.
6. **Masked man identity** stays hidden until the war mask-break; real Madara is separate.
7. **Pain/Nagato** are one entity; six paths are one.
8. **Unheard canon events are invisible in the Journal** until delivered.
9. **Personal beats are offers**, never assumed; they only complete when narrated.
10. **Token ceiling**: prompts over `settings.promptTokenBudget` are trimmed; never add unbounded prompt data. Keep the rules and slow blocks first so the cached prefix survives.
11. **Images only on user action**, with Kan’s face/outfit references and the action brief.
12. **Version sync**: `package.json` → `app.json` → SW cache (`scripts/generate-sw.js`) → Settings display.

---

## 14. How to extend safely

### Add a canon milestone
Add an object to `CANON_MILESTONES` in `canonData.ts` in chronological position (order = prerequisite order), with a real date window, `region`/`location`, `knowledge` (+ `bearers` if secret), facts, optional encounter, and `playerDriven` if it depends on Kan. No engine change is needed. Add a test that it opens on the right day.

### Add a canon cast member
Add an entry to `CANON_CAST` in `canonCast.ts` (name, aliases without common words, birthday/birthYear counted from Kan's birth, role at year 13). Existing saves pick them up on next load.

### Add a character’s lore/heart
Add to `CHARACTER_LORE` (devotion, accessibility, orientation) and optionally `ERA_NOTES`.

### Change pacing
Edit `paceCapSeconds` in `calendar.ts` and `inferScenePace` in `pacing.ts`. Update tests.

### Add a prompt block
Add a `formatX` function and insert it into the `buildDynamic` array. Keep it short and capped; respect the token guard.

### Add a state field
`types.ts` → `db.normalizeState` default → `TURN_STATE_SCHEMA` (stateSchema.ts; add the key to `properties`, it is auto-required) + a rule line in `STATE_SYSTEM` → `convertStateBlock` (`stateBlock.ts`) → the matching apply function (`services.ts` `applyStateDiff`, or `entities/bonds/facts/clock.ts`) → tests.

---

## 15. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Clock only moving by minutes | The story gave no time cue, so only the pace minimum applied. Check the narrator's TIME rules, `time` in the state reply, `scene_pace`, and `detectNarrationTime`; the player can fix a turn from its time chip. |
| Date jumps during a fight | `resolveTurnClock` / `pace` not applied; check `scene_pace`. |
| Too many / too few strangers | Check the STYLE encounter rule in `NARRATION_SYSTEM` and `formatEncounterConditions` / `classifyLocation`. |
| Old acquaintances never come back | `returning.ts`: they need `lastSeenAt` (older saves only have role/notes and the traveller rule), 14+ days away, and a place fit; offers come once per 8 turns. |
| Canon events not appearing | Check `canonProgress.completed` and the hidden World clock screen. World milestones need their date plus every earlier world milestone, and nothing fires mid-fight. Personal beats need state-call marks — check `CANON TRACKING` in the state prompt. |
| Canon event visible too early | Journal only shows `heard` events; check `heard` map and `normalizeDatabase` migration. |
| JSON text in chat | Something put JSON back into the narrator prompt. Safety nets: `streamingPreview` (live), `stripNarrationJson` (save + render). Run tests. |
| Wrong characters in images | The ACTION line is written fresh on tap by `writeImageAction` (memory model); cast comes from `sceneCast`. Check Settings → Debug → Image description. |
| Prompt tokens growing | Budget guard trims recent messages; check `formatFacts`/canon caps. |
| Save quota error | `saveSlot` trims images/snapshots; clearing old slots helps. |
| Need to see what really happened | Settings → Debug: prompt, state diff, tokens and cost per turn. |
| PWA stale | Bump version so `generate-sw.js` changes the cache name; rebuild. |

---

## 16. Test coverage map (`scripts/verify-pipeline.test.ts`)

- Save compatibility & normalization
- JSON stripping (fenced, truncated, unfenced, labels)
- Identity resolution (masked man, real Madara, Pain/Nagato, Zetsu)
- Duplicate characters (canon cast seeding and migration, ID roster in the state prompt, `is_new` gate, ID resolution, manual merge, whole-word name mentions)
- Time parsing and clock arithmetic (seconds/minutes/days, leap years, month lengths)
- Pacing caps and combat date blocking
- Canon dataset (unique ids, ordered windows, secret events have bearers)
- Canon scheduling (baseline, real dates, personal vs world, passed/completed, news/heard, couriers)
- Romance persistence and lore era notes
- Image brief/cast/action rules
- Prompt composition (blocks, dedupe, no dice roll / style guard, encounter conditions, budget)
- Characters who come back (original-only pool, place fit, travellers, cadence, no offers in fights or empty places, `lastSeenAt` recording)
- Token stability over 60 turns
- Debug log (`scripts/debug-panel.test.ts`): state-change diff, per-turn cost totals, usage parsing from normal and streamed replies

Run: `bun test`.
