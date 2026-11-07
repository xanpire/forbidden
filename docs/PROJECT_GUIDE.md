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
| `companions.ts` | People travelling with Kan: `startCompanion`, `endCompanion`, `setCompanion`, `applyCompanionChanges`, `castWithCompanions`, `applySharedScene` (§6a) |
| `facts.ts` | `applyFactDiff`, `applyThreadDiff`, `recordSceneEvent` |
| `deaths.ts` | Who is dead: `isDeceased`, `kanKnowsDeath`, `markDeceased`, `markDeathsByName` (canon, exact names only), `markAlive`, `normalizeDeaths` (load-time backfill) |
| `clock.ts` | `applyClockChange` (date/elapsed/clock from the diff, ageing across years), `applyClockTick` (stall counter) |
| `jutsu.ts` | Chakra natures, grouping, and `applyJutsuDiff` (the permanent jutsu library) |
| `log.ts` | Story log + undo snapshots: `appendStoryMessage`, `pushSnapshot`, `restoreLastSnapshot`, `cloneDatabase`, `storyMessagesSinceLastSummary` |
| `util.ts` | `trimToSentence`, `uniqueList`, `clamp` |
| `canonData.ts` / `canonDataMore.ts` | **Data only**: the 220 milestones (dates, place, who could know), sorted by opening date on export, canon types, courier tables, era order. `canonDataMore.ts` holds the living-world Stage 2 additions (`STAGE_TWO_WORLD`, `STAGE_TWO_PERSONAL`) |
| `canon.ts` | **Canon engine**: scheduling (`advanceCanon`), state-tracker marks (`applyCanonMarks`), the unheard-news queue and its escalation (`unheardCanonNews`, `newsUrgency`), world clock |
| `newsDelivery.ts` | How news reaches Kan this turn: `newsOffer` (bearers in the scene first, the living fallbacks, one delivery style, catch-up reports), `newsAllowance`, the narrator/tracker text |
| `reputation.ts` | Bingo books and Akatsuki standing (`state.reputation`): `applyReputationChanges`, `ensureLeafListing`, `bingoListings`, `currentHeat`, `territoryOf`, `formatReputationBlock` (YOUR NAME OUT THERE), `hunterOffer` (§9b) |
| `grudges.ts` | Grudges, the dark mirror of romance (`BondRecord.grudge`): `applyGrudgeChanges`, `grudgeStage`, `grudgeHeat`, `grudgeOffer` (SOMEONE WANTS YOU TO PAY), `GRUDGE_RULES` (§10a) |
| `letters.ts` | Personal letters to and from Kan (`state.post`): `letterOffer`, `sendLetters`, `receiveLetters`, `deliverLetters`, `lettersInTransit` |
| `yearly.ts` / `yearlyData.ts` | The yearly calendar (§8b, `state.yearly`): birthdays, anniversaries, New Year and festivals: `yearlyOffer`, `applyYearly`, `knowsBirthday`, `upcomingBirthdays`, `todayNotes`; habits and festivals are data in `yearlyData.ts` |
| `prompt.ts` | Narrator and state prompts |
| `calendar.ts` / `timeparse.ts` / `pacing.ts` | Clock arithmetic, reading time from prose, the per-turn clock step (`resolveTurnClock`) |
| `sceneMode.ts` | Conversation and fight mode (§8a): `readKanInput`, `resolveTurnMode`, `applySceneBeat`, `setSceneModeOverride`, the SCENE MODE prompt lines |
| `encounters.ts` | Location kind and crowd level (`ENCOUNTER CONDITIONS`) |
| `returning.ts` | Characters who come back: the occasional optional `A FAMILIAR FACE` offer |
| `db.ts` / `slotStore.ts` / `seed.ts` / `canonCast.ts` / `canonCastMore.ts` | Persistence + migration (slots in IndexedDB), new saves, the canon cast (`canonCastMore.ts`: the 67 people added in Stage 2) |
| `retrieval.ts` | Memory/fact/lore retrieval |
| `romance.ts` | Hearts, lore locks, era notes |
| `canonEndgame.ts` | Canon-bound hearts: winnable, then settled with their canon partner (§10) |
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

| Key | Where | Contents |
|---|---|---|
| `kan.meta.v1` | AsyncStorage (localStorage) | `StorageMeta`: active slot id, slot list |
| `kan.slot.<slotId>.v1` | IndexedDB `kan-saves` / `slots` (`slotStore.ts`) | One `AppDatabase` JSON per save slot |
| `kan.apiKey.v1` | AsyncStorage (localStorage) | OpenRouter API key (never stored in slots or exports) |

Slots live in IndexedDB because localStorage is ~5 MB for the whole app, shared by every slot, and a long story with its 3 undo snapshots (each a full copy) outgrows that after a few hundred turns. `slotStore.ts` picks the backend once per session (IndexedDB, or AsyncStorage on native / when IndexedDB can't open), moves an old localStorage copy into IndexedDB on first read (newer `meta.updatedAt` wins if both exist) and then removes it, and asks for `navigator.storage.persist()` so the browser doesn't evict the data under storage pressure. Images are in a separate IndexedDB (`kan-images`, `imageStore.ts`).

Important functions:

- `loadSlot`, `saveSlot`, `createSlot`, `duplicateSlot`, `deleteSlot`, `renameSlot`, `switchSlot`, `listSlots`, `loadActiveSlot`
- `exportDatabase(db)` → pretty JSON string; `importDatabase(json, name?)` → new slot
- `normalizeDatabase(db)` → migration + repair + JSON stripping + default fields. **Every load/import passes through it.**
- `buildIndices(db)` → the `MemoryIndex` used by retrieval

### Storage quota strategy

`saveSlot` tries progressively smaller writes until one succeeds (a safety net; with IndexedDB it should practically never trigger):

1. full database
2. max 3 assistant images, 1 snapshot (`MAX_STORED_IMAGES`, `MAX_SNAPSHOTS`)
3. 1 image, 0 snapshots
4. 0 images, 0 snapshots

Images are normally stored as `img:` references, so only inline data URIs (native / no IndexedDB) are trimmed.

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
  sceneMode?: { current, exchangeStreak, partners, lastBeat?, override? }   // §8a
  yearly?: { knownBirthdays: string[], offered: Record<key, year> }        // §8b
}
```

`EntityRecord.birthdayInvented?: true` marks a birthday the app chose (canon gives none).

`EntityRecord.companion?: { since, sinceLocation?, reason?, sharedScenes, bondPoints }` — set while that person travels with Kan (§6a).

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

### `state.post` (personal letters, `letters.ts`)

```ts
{
  letters: [{
    id, direction: 'to-kan' | 'from-kan', entityId, name,
    sentOn, arrivesOn, gist?, status: 'travelling' | 'delivered' | 'lost',
    replyTo?, deliveredOn?
  }],                            // everything travelling + the last 40 done
  lastLetterIn?: CalendarDate    // when a letter last reached Kan
}
```

### `state.reputation` (`reputation.ts`)

```ts
{
  villages: { leaf?|sand?|mist?|cloud?|stone?: {
    heat: number,                // 0-100 before cooling
    listedOn?: CalendarDate,     // in the bingo book since; never removed
    lastDeedOn?: CalendarDate,   // cooling counts from here
    lastReason?: string,
    known: boolean               // Kan has seen or been told of it
  } },
  akatsuki?: { standing: number /* -100..100 */, lastReason?, updatedOn? },
  recent: [{ faction, change, reason?, date }]   // last 12
}
```

`BondRecord.grudge?: { since, reason, heat, updatedOn, lastStrike?, strikes }` — set while that person holds a grudge against Kan (§10a).

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
  beat?: { kind: 'exchange'|'instruction'|'remark'|'action'|'travel'|'combat', with: string[] },
  fightOptions?: string[],
  entities?: [{ entityId?, isNew?, name, age?, role?, personality?, speechStyle?, mood?, appearance? }],
  jutsuUsed?: [{ name, user, chakraNature?, effect?, visual? }],
  bonds?: [{ entityId?, character, affinityDelta?, status?, note?, isMajor?, relationship?, attraction?, romanceNote? }],
  facts?: [{ action, type?, text, subject?, whoKnows?, validFrom?, ... }],
  threads?: [{ action, title, description?, type?, participants? }],
  canonCompleted?: string[], canonEngaged?: string[], canonPassed?: string[],
  newsRelayed?: [{ id, from? }],
  lettersSent?: [{ entityId?, name, gist? }], lettersReceived?: [{ entityId?, name }],
  birthdaysLearned?: [{ entityId?, name }],
  companionsJoined?: [{ entityId?, name, reason? }], companionsLeft?: [{ entityId?, name, reason? }],
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

1. `extraction = extractTurnDiff(...)`: the memory model (`settings.extractionModel`, a cheap one) gets `buildExtractionPrompt` — `STATE_SYSTEM` rules, current state/characters/jutsu/bonds/facts/threads, `TIME BEFORE THIS TURN`, `CANON TRACKING` (active/personal beat ids and the offered news ids with the rule for each), `LETTERS` (the letters_sent rule, and the offered letter's sender id), the previous beat for context, then this turn's player line and prose. It is sent with OpenRouter structured output (`response_format: json_schema`, `strict: true`, `provider.require_parameters: true`). If no provider for that model supports it, `completeChat` falls back to `json_object`, then to a plain reply; `parseJsonObject` + `convertStateBlock` read whatever comes back. If the call fails, a `state` job is stored as pending and nothing else changes; an unreadable reply applies `null` (the prose clock parser still runs).
2. **Narration clock**: `detectNarrationTime`, pace via `extraction.state.scenePace ?? inferScenePace`, then `resolveTurnClock(...)` returns the one forward step for the turn (largest of reported, parsed and the pace minimum; combat cannot skip days; a full night's sleep jumps to morning). The diff carries only that `elapsedSeconds`; the applied seconds are stored on the reply as `rawLog[].elapsedSeconds` for the time chip.
3. `applyTurnDiff` (`services.ts`) in this order: state + clock (`clock.ts`), entities (`entities.ts`), revivals and deaths (`deaths.ts`), jutsu (`jutsu.ts`), companion joins/partings (`companions.ts`), bonds incl. romance (`bonds.ts`), facts and threads (`facts.ts`), scene event (with companions) + shared-scene bond step, duplicate merge, presence (companions always included), stall counter.
4. `applyCanonMarks` → `markNewsHeard` (up to `newsAllowance(latest)`: 1, or the size of the catch-up report the prompt offered) → `advanceCanon` → letters: `receiveLetters` → `sendLetters` → `deliverLetters`.
5. Queue follow-up jobs in `db.memoryJobs`:
   - `timeSkip` if `daysBetween(before, after) >= 180`,
   - `scene` when `imageWorthy`, `scene.ended`, or `storyMessagesSinceLastSummary >= autoSummarizeThreshold`. It covers only story messages no chapter summary covers yet (`unsummarizedStory`, oldest first, up to 16; at least 4 unless the scene ended). A pending scene job is re-pointed at those instead of stacking a new one.
6. Commit. The clock, bonds, facts and canon are now saved.

**Phase 2 — summary jobs (`drainJobs`)**, one at a time, never blocking the next turn:

- Each job reads the latest save, calls the model (`runSummaryJob`), then `applySummaryJob` applies the result to the save **as it is at that moment**. If the turn it came from was undone or the job was removed, the result is discarded.
- Summary replies are `TITLE:` / `MEMORY:` (chapter only) / `SUMMARY:` lines, read by `parseTitledSummary` (`util.ts`); a reply without labels is taken as the summary. Caps: 2000 tokens (2400 for arc/year), low reasoning excluded, and one retry with 1.75× room if a reply is cut off.
- A chapter summary is saved only for messages no other summary covers (a job that ran twice, or overlapped one that landed, saves nothing) and never with the same text twice; `normalizeDatabase` drops duplicate summaries from older saves. It stores its `title` and the `chapter` it closes, and moves `state.chapter` on by one.
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
   - **CANON** — never invent canon; news only through bearers; identity rules (Tobi = the man in the orange mask who calls himself Madara, real Madara separate, mask breaks only in the war, no spoiler names; Pain = one mind in six bodies; Zetsu = one being; other masked people are not Tobi).
   - **STYLE** — plain English, 2–4 paragraphs, no repeats, rare encounters, new characters, Kan's `"speech"` / `*action*` markers.
   - **ROMANCE** (from `romance.ts`): lore-locked vs winnable, adults deflect under 17, explicit intimacy only 18+, rejections hold by default but can slowly thaw when the story earns it.
   - **OUTPUT** — prose only, changes legible in the prose.
2. **Slow context** — `formatCharacterSheet`, `formatStorySoFar` (latest arc summary + up to 3 newest chapter summaries the arc doesn't cover, never fewer than 2), `formatJutsu`, `formatThreads`, `formatBonds`, `formatTheDead` (everyone dead, flagged when Kan does not know yet). Changes only when a summary lands, a jutsu is used, a thread or bond moves.

Each block is sent as a text part with `cache_control` for models that need explicit breakpoints (`anthropic/`, `google/`, `qwen/` — see `toWireMessages` in `lib/openrouter.ts`; Gemini uses only the last one). Other providers (OpenAI, DeepSeek, …) cache a repeated prefix automatically and get plain string content. `OpenRouterMessage.content` is always the full text; `parts` is only the split.

### Dynamic user block (in order)

1. `formatState` (date, place, mood, world, inventory, canon point)
1a. `formatCompanions` — `TRAVELLING WITH KAN`: each companion, how long together, why/where they joined, shared scenes, how they feel (only when someone travels with Kan). Their character cards are always in `CHARACTERS IN SCENE`, companions first.
2. `formatTimeLine` — `Year 13 · Day 4, October · 9:40 PM` plus a nudge to state durations once `turnsWithoutTimeChange >= 2`
3. `formatMatchedEntities` (with lore hearts + era notes), `formatFacts` (≤10), `formatLore`
4. `formatNewsBlock` — `newsOffer`: the next unheard event (or one catch-up report), with location, bearers in the scene first, the living fallbacks, this turn's delivery style and urgency (none in combat)
4a. `formatLetterBlock` — `A LETTER FOR YOU`: a reply that has arrived, or an unprompted letter (none in combat or during a catch-up report)
5. `formatUpcomingWorldBlock` — planned world events in the next ~10 days (“RUMORS OF WHAT'S COMING”)
6. `formatCanonBlock` — recent heard world events, pending personal beats (“do not assume”), active beats + encounter context, recently concluded
7. `formatMemories` — retrieved events (≤ retrieval limit, 400 chars each), skipping any that repeat a summary already in STORY SO FAR
8. `formatRecentMessages` — last `contextMessages` (default 16). The newest narration keeps its last 2200 chars; older narrations keep their **start and end** (`headAndTail`, 1400 chars: ~40% opening, ~60% ending); player input 500 the same way
9. `formatLastBeat` — final 450 chars of the newest narration
10. `formatEncounterConditions` — place kind, hour and how crowded it is
11. `formatReturningCharacter` — occasionally, “A FAMILIAR FACE (optional)”: one original character Kan has not seen in a while who fits the current place (see §9)
12. `CONTINUITY` line + location kind
12a. `formatSceneModeLine` — `SCENE MODE: …` (conversation with whom / talk is building / the conversation ends / fight, with Kan's current wounds and conditions / normal narration chosen by the player). Absent on plain normal turns. See §8a.
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
- Events (memories) are created by `recordSceneEvent` (on `scene.ended`; raw prose titled with the scene's name until replaced), by **every chapter summary** (`saveSummaryMemory` in `memoryJobs.ts`: tagged `summary`, `title` from the summary, `summary` = the model's one-to-two sentence MEMORY line, `summaryId` back to the chapter summary, linked as `present` to everyone in the scene cast on the turns it was written from (never to people it merely names), folding in the scene-end events made on those same turns), time skips, and canon milestones.
- **One memory, one scene**: `applyStateStep` stamps each turn's two story entries with `sceneSeq` and `sceneCastIds` (the scene cast's entity ids). `state.sceneSeq` moves on the turn after `scene_ended`, or on a turn whose `location` changes. `queueSceneJob` only ever takes the oldest scene's stretch (`firstSceneStretch`), so a summary never spans two scenes; once it lands, a finished scene waiting behind it is queued next. Scene-end events carry `turnLogId`, and a summary takes in only the ones whose turn it was built from (its `sourceLogIds`), never by time. The bond page (`sharedMemories`) shows only `present`/`participant` links. `formatMemories` gives the narrator the full chapter summary behind a `summaryId`.
- The scene name moves through the state schema's `scene_title` (only when a new scene starts) → `state.scene`.
- Summaries: chapter summaries feed the arc summary; the latest arc plus the newest chapters feed the prompt. `storyMessagesSinceLastSummary` is the summarization cadence guard.

### Entity identity resolution (`entities.ts`)

- `resolveEntity(db, name)` — exact name or visible alias only (titles and honorifics allowed: "Lady Tsunade", "Itachi-san"). Descriptions ("the masked man", "the leader", "the woman" — `isGenericDescription`) never match and never become a person. The one group rule left: a bare "Madara" is Tobi until the real Madara exists.
- **Hidden aliases** (`hiddenAliases`): spoiler names (Tobi's Obito / Obito Uchiha, Pain's Nagato / Nagato Uzumaki) live apart from `aliases`, so they are never matched in story text, shown, or sent to a model. `revealHiddenAliases` (in `applyStateStep`) moves one into `aliases` once its `revealedBy` milestone has reached Kan (heard or engaged). Canon death data (`markDeathsByName`) may still use them.
- Identity groups (for duplicate merging, visible names only): `masked-man` (Tobi), `real-madara`, `pain` (Pain and the six paths), `zetsu`.
- `mergeDuplicateEntities` runs on every turn; it and the manual merge both use `mergeEntityPair`, which folds one person into another (names become aliases, bonds combined, facts/event links/threads/jutsu/scene cast moved).
- **Only the scene cast meets people**: `met: true`, `lastSeen` and `lastSeenAt` come only from `characters_present` (plus companions), via `recordPresence` and `settleNewlyMet`. People from `new_characters` start `met: false`, "Not yet met". Character updates, facts, bonds and grudges never meet anyone; a bond, grudge or companion join for someone unmet who isn't in this turn's cast is ignored (`presentIds`). The prose fallback only suggests a cast (`suggestedCast`), never applies it.

### Duplicate characters

- **Canon cast** (`canonCast.ts`): the main canon characters (Sasuke, Kakashi, Kisame, Kakuzu, Pain, Tobi, …) are in every save from the start, each once, with aliases, birthdays and roles as of year 13. They start with `met: false` and stay off the bonds list until they are present in a scene. `ensureCanonCast` runs in `seedDatabase` and `normalizeDatabase`: older saves gain the people they lack, and a person they already have under any name gets the other names as aliases instead of a second entry. Some people enter the save only when a milestone fires (`appearsWith`, added by `fireMilestone` and on load once the milestone is completed): the real Madara (`madara-revived`; until then bare "Madara" stays Tobi), Kaguya (`kaguya-awakens`) and the children born during the story (Mirai, then Boruto, Sarada, Himawari, Shikadai, Inojin, Chōchō, Metal Lee, as small children only). Until then they do not exist for the story. Aliases avoid common words ("Guy", "Leader"). The cast (168 canon people plus the five seeded) covers the Leaf's clans, elders and village life, the dead the story looks back on (Minato, Kushina, Fugaku, Mikoto, Rin, the first two Hokage, Dan, Yahiko — `status: 'Deceased'`), the Sand, Mist, Cloud and Stone (Kage, jonin, the next generation), all nine jinchūriki, Hanzō, Mifune, Fukasaku, Chiriku and Orochimaru's people (Kimimaro, Jūgo, the Sound Four); since Stage 2 also the old Seven Swordsmen, the Uchiha coup plotters, Kagami, Izuna, Mito, the nine tailed beasts (`gender: 'unknown'`, status "Sealed"; Kurama's name is a hidden alias of the Nine-Tails until `naruto-joins-war`), the summons, and supporting people of every village. Everyone named in a milestone's `deaths` is in the cast (or arrives before it fires), so canon deaths always land on someone; `setsStatus` on a milestone changes a status by name (Kaguya "Sealed", the freed beasts "Free"). Every person has a birthday except the beasts and summons; canon dates where the databooks or official columns give one, otherwise an app-chosen date marked `birthdayInvented`. `BIRTHDAY_FIXES` moves older saves off dates that were wrong, and `ensureCanonCast` backfills missing birthdays. A stranger without a birthday gets an age from the birth year (`entityAge`). The state tracker's KNOWN CHARACTERS roster leaves out people in the background (unmet, and long dead, sealed or a summon) to stay short; when a turn names them they appear with their id under CHARACTERS IN THIS TURN. A new person (`is_new`) only matches an existing one by an exact name or visible alias ("Hayate Moriya" is not Gekko Hayate).
- **IDs for the state tracker** (`characterRefs.ts`): the extraction prompt lists `KNOWN CHARACTERS` as `- kisame-hoshigaki: Kisame Hoshigaki (Kisame, Hoshigaki Kisame) [not met yet]` (cached part), plus `CHARACTERS IN THIS TURN` details (dynamic part). IDs are slugs of the current name, `-2` on collisions. The schema uses `bonds[].character_id`, `character_updates[].character_id`, and IDs in `characters_present`, `facts.entity/who_knows`, `jutsu_used.user`, `news_relayed.from`.
- **Only `is_new: true` adds someone**: `new_characters[]` entries need `is_new: true`; `false` is dropped. `resolveCharacterRefs` (run in `extractTurnDiff`) maps each reference to a person: known ID → exact new name from this turn → name/alias fallback → otherwise dropped (a bond or update for an unknown ID never creates a person). A "new" person whose name resolves to someone known becomes an update.
- **Name mentions** (`mentionsName` / `mentionsEntity`): whole-word, Unicode-aware; "Pain" must be capitalized. Used for narrator scene cards, retrieval, the image cast fallback and memory tags (never memory links), so "asleep" no longer finds Lee and "Sarutobi" no longer finds Tobi.
- **Merge with…** on the bond screen (`components/kan/MergeSheet.tsx`, `mergeCharacters` in `game.tsx`): pick the other person (likely duplicates by shared name words first), choose which name to keep, merge.

---

### 6a. Companions (`companions.ts`)

A companion is someone travelling with Kan: `EntityRecord.companion` is set until the story parts them.

- **Joining / leaving**: the state tracker's `companions_joined` / `companions_left` (`character_id`, `reason`). It sees `TRAVELLING WITH KAN: <ids>` in the dynamic block, `[travelling with Kan]` in `KNOWN CHARACTERS` and `CHARACTERS IN THIS TURN`, and the COMPANIONS rule in `STATE_SYSTEM` (scouting ahead or sleeping in the next room is not leaving). Someone added under `new_characters` can join the same turn. Kan, the dead and a full party (`MAX_COMPANIONS` = 4) never join. Joining creates a bond if there is none and a fact; parting ends the flag, records "parted ways after N days together (reason)" and takes them out of the scene cast. Death ends it automatically (state tracker, canon, or **Mark as dead**).
- **In every scene**: `castWithCompanions` puts them first in `sceneCast` on every applied diff, presence (`lastSeen`/`lastSeenAt`) is stamped for them, and scene-end memories link them, so they show under Shared memories and in images. The narrator gets a CORE rule (in the cached rules) that anyone under TRAVELLING WITH KAN is present every turn with their own voice and only leaves when the story makes it happen.
- **Bond moves with shared events**: the state tracker is told to give companions a `bonds` entry whenever shared events move their feelings (fighting side by side, being protected, secrets, arguments, betrayal). On top of that, `applySharedScene` runs when a scene ends: `sharedScenes += 1`, and if the story did not move that bond this turn, shared time adds `bondPoints` (1, or 2 after combat/chase); every `BOND_POINTS_PER_STEP` (3) points lift affinity by 1 — never above `SHARED_TIME_AFFINITY_CAP` (+6) and never when affinity is below `SHARED_TIME_AFFINITY_FLOOR` (−2), so time alone builds familiarity but cannot fix real hostility. A bond the story moved resets the points.
- **UI**: Bonds lists companions first under "Travelling with you"; the bond screen shows a chip, how long and why, shared scene count, and **Travel together / Part ways** for corrections (`setTravelling` in `game.tsx`); the Story status sheet lists who is with you.
- Not offered as "A FAMILIAR FACE" (`returning.ts`), since they never left.

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
  setsStatus?: {name: status},     // status changes by exact name ("Sealed", "Free")
  encounter?: { who, where, context },
  attendanceFact?, opensThreads?, resolvesThreadTitles?
}
```

Everything about one event — when, where, who could know — sits in its one record. The courier tables (`BEARERS_BY_KNOWLEDGE`, `CHANNEL_BY_KNOWLEDGE`, `REGION_CHANNEL`) are also in `canonData.ts`.

- **220 milestones** (123 world events, 97 personal beats) from the Uchiha massacre aftermath to Naruto's years as Hokage: the core spine plus Kan’s own beats (Thousand Souls, the Uzumaki blood, the Mangekyō at Izumi’s grave with his own ability and Susanoo, its cost to his eyes, Itachi, the Root hunter Nagi, Akatsuki bonds, Team 3 in every era, and endings) and a living-world layer (village news, the Mist's civil war, every beast hunt with an offer for Kan to join, the four-day Fourth War, and the births and weddings after). Stage 2 added the missing canon events (Kimimaro's illness, Root's last test for Sai, Orochimaru's stopgap body, Jiraiya's reports, Hashirama's history lesson, the post-war Hiden stories, every birth the cast needs), personal beats for the long gaps (the Akatsuki years, the Karin arc, Kan's eyes failing in stages, peacetime, romance and family beats behind the `inRomance` flag) and the canon threads (the Naka Shrine tablet, Shisui's other eye, the Uzumaki masks and Uzushio, the Seven Swordsmen's blades).
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
- `unheardCanonNews` returns unheard events, most pressing first: priority = (days waiting + 1) × 4 for major news, × 1 for minor, so fresh major news leads but old minor news is never starved.
- **One piece of news per turn** (`NEWS_PER_TURN`): the narrator and the state tracker are shown only the next unheard item, and `markNewsHeard` accepts only one relay per turn. During combat no news (and no "rumors of what's coming") is offered at all.
- **Catch-up reports** (`newsDelivery.ts`): when Kan has heard no news for `CATCH_UP_QUIET_DAYS` (14) in-story days (`lastNewsHeardDate`, ignoring beats he witnessed) and 2+ events piled up, the offer becomes one report of up to `CATCH_UP_MAX` (4) events — a bundle of letters at an inn, a companion catching him up over a fire, a stuffed dead drop. Secret and eyewitness news never travels in a bundle. `newsAllowance` lets `markNewsHeard` record that many relays for the turn.
- **Bearers**: anyone in the scene (`sceneCast` + companions, alive) who could plausibly know comes first — anyone for public news, Leaf people for village news, Akatsuki members for Akatsuki news, named confidants for secrets — plus a local in a town or a traveler on a road for public news. Then the fixed `BEARERS_BY_KNOWLEDGE` list (now with Kakuzu, Hidan and Tobi), with the dead, anyone already present, and members outside their tenure removed (`livingBearers`). `BEARER_TENURE` (canonData.ts) ties late joiners to their milestones: Kisame from `kisame-joins`, Deidara from `deidara-recruited`, Hidan from `roster-completes` until `hidan-kakuzu` (buried alive, not dead). The same check stops them knowing Akatsuki news in a scene before they join.
- **Delivery style**: one per turn, picked deterministically (slot + player turn + event) from the place (teahouse gossip, a bounty poster, a merchant grumbling about a closed border, a wounded messenger, a dead drop, a summoned animal…) and the kind of news (Itachi's crow, Zetsu, a ring summons, a Leaf hawk…). Secrets are always face to face; overdue news comes looking for Kan.
- Knowledge classes: `public`, `village`, `akatsuki`, `witnesses`, `secret`.
- Channels: Akatsuki → Itachi’s crow / Konan’s paper butterfly / Zetsu; Leaf → hawk/courier; Sand → caravan; Mist → sailor; Cloud → runner; Stone → stone-route courier; Iron → samurai rider; public → merchant/crier/bounty board.
- **Escalation** (`newsUrgency`, weighted days = days × 4 for major): `due` at 12 weighted days (3 for major, 12 for minor) — bring it in if anything fits; `overdue` at 28 (7 for major, 28 for minor) — deliver it this turn, through the courier channel if nobody present could know. Fresh minor news is offered only if it comes up naturally.
- Secrets (mask identity, Itachi’s illness/truth) only travel via named confidants.
- `news_relayed: [{id, from}]` records delivery (`heard` map), and the Journal hides unheard events.

### Personal letters (`letters.ts`)

- Not canon news: people Kan is close to write about their own lives. Everything is delivered on the page, never as an app notification.
- **Unprompted**: once `LETTER_GAP_DAYS` (21) have passed since the last letter reached Kan (or the story began), the warmest `correspondents` candidate writes: a met, living person with affinity ≥ 5 (or a close/romantic/partner stage), not travelling with Kan, not in the scene, not seen for 10+ days, who has not written in 45 days and has no letter on the road.
- **Kan writes**: `letters_sent: [{to, gist}]` (someone not in the scene) sets out with `travelDays` of 3–9 days. When it arrives (`deliverLetters`, every turn): +2 affinity (+1 if they are cold toward him), a fact that they received it, and — unless affinity is below −3 — a reply sets out that arrives 3–9 days later. A letter to someone who died is `lost`.
- **Delivery**: `letterOffer` offers an arrived reply first (it waits while the writer is in the scene), else an unprompted letter; never in combat or during a catch-up report. The carrier fits the writer (Itachi's crow, Hana's ninken, Suzume's Team 3 cipher, Konan's paper butterfly, a Leaf hawk, an Akatsuki dead drop, or a generic courier/bird/dead drop). After 5 days waiting, the offer is pressed. `letters_received: [id]` marks it read and sets `lastLetterIn`.
- The hidden world-clock screen lists letters on the road.

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

## 8a. Conversation and fight mode (`lib/rpg/sceneMode.ts`)

Living-world Stage 1. The narrator writes a turn in one of three modes: normal prose, **conversation** (mostly speech, short `*action*` lines, length follows the talk, several voices) or **fight** (what Kan's move does, then the opponent's one specific next move, stopping before it lands; aftermath in normal prose when the fight ends). The rules for each live in `NARRATION_SYSTEM` (SCENE MODES, cached); each turn only gets one `SCENE MODE:` line.

- **Deciding the mode** (`resolveTurnMode(db, input)`, run inside `buildNarrationPrompt`, pure): Kan's input is read by `readKanInput` (speech in quotes, an attack, a fight-back move, a scene-changing move like leaving, following, travelling, sleeping; negated attacks and words inside quotes don't count). Order: chip override `fight`/`normal` → a fight going on (`scenePace` combat or last beat combat, scene not closed) or Kan attacking → override `conversation` → Kan's scene-changing move (normal, with `ending: 'conversation'` for a short transition if a talk was on) → conversation once `exchangeStreak >= 2`, or `>= 1` and Kan answers in speech → otherwise normal, **leaning** spoken when a talk has started or Kan speaks to someone present.
- **The beat** (state tracker, BEAT rule): `beat` = exchange (talk, including small moves in place and silences), instruction ("follow me"), remark (a passing line), action (a scene-changing move), travel, combat; `beat_with` = ids of who Kan talks with; `fight_options` = 3-4 short moves (verb first, no pronouns) while the fight goes on. The tracker also sees `SCENE MODE THIS TURN`.
- **After the turn** (`applySceneBeat`, in `applyStateStep`): exchange with overlapping people → streak +1 (people joining make it a group); different people → 1; instruction/remark break an unsettled talk but not a settled one; action/travel/combat/scene end → 0. Without a beat, `fallbackBeat` reads pace, input and quotes. `current` = the mode the reply used.
- **Saved on the reply**: `rawLog[].sceneMode` (set by `game.tsx` when the reply is saved) and `rawLog[].fightOptions` (only while the fight goes on).
- **Clock**: a conversation-mode turn at conversation pace has a 20 s minimum (`CONVERSATION_MODE_MINIMUM_SECONDS`, passed as `minimumSeconds` to `resolveTurnClock`) instead of 2 min. Fights keep the combat rules (15 s, no day skips, nothing fires mid-fight).
- **Chip override** (`setSceneModeOverride`, `useGame().setSceneMode`): Automatic / Conversation / Fight / Normal narration. Forced conversation lasts through travel and ends when a fight starts; forced fight ends when the fight does; normal holds until the current talk or fight is over, then automatic resumes.
- **UI** (Story): a mode chip above the composer, read live from what you are typing (Narration / Conversation / Fight, "· set by you", who it's with, "Talk is building"); tap → sheet with the four choices. While a fight goes on, the reply's fight options show as buttons above the composer; a tap sends `*<move>.*`. Narration renders `*…*` in italics.
- Tests: `scripts/scene-mode.test.ts`.

## 8b. Birthdays, anniversaries and festivals (`lib/rpg/yearly.ts`)

Living-world Stage 2. The narrator gets at most one `THE DAY` line per turn, never in a fight, and each offer at most once a year (`state.yearly.offered`: key → year, set by `applyYearly` in `applyStateStep` from the offer the turn's prompt was built on).

- **Order** (`yearlyCandidates`): Kan's own days first (the massacre anniversary on Oct 1, the Nine-Tails night on Oct 10 that took his parents, Itachi's death, joining the Akatsuki, Kan's own birthday with who might remember it), then a birthday of someone in the scene, then remembrance days of the dead he was close to, then festivals and New Year where he is, then (some years, by hash) a close person's birthday far away.
- **Who Kan knows** (`knowsBirthday`): the people he grew up with (Itachi, Izumi, Shisui, Hana, Suzume), anyone with affinity ≥ 6 or a close relationship, and anyone in `state.yearly.knownBirthdays` (the tracker's `birthdays_learned`). Only those are given as his own knowledge; a stranger whose `BIRTHDAY_HABITS` kind is `announces` or `ritual` can let it slip.
- **Habits** (`yearlyData.ts`): how each notable person treats their birthday (announces, hides, hates, ritual, quiet), including the Akatsuki (Kisame finds it funny, Deidara wants a bang, Sasori doesn't age, Kakuzu asks what it costs, Hidan makes it a ritual).
- **Bonds**: the tracker gets a `THE DAY` line for a present birthday: +1 for remembering it, +2 for a real gift, -1 for letting it pass beside them.
- **Festivals** (`FESTIVALS`): canon (the Leaf's winter Rinne Festival) plus a couple invented per village (`invented`), matched to Kan's location; the Mist keeps its quietly until Mei is Mizukage, Paper Flower Day starts with the Rain stronghold. A leap-day birthday (Kabuto) is kept on Feb 28 in other years.
- **UI**: an "Upcoming birthdays" card on the bonds list (next 30 days) and a "Today" row on the Journal's Now view (`todayNotes`).
- Tests: `scripts/living-world-stage2.test.ts`.

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

### 9b. Reputation & bounty hunters (`lib/rpg/reputation.ts`)

- **Bingo books**: each great village keeps a `heat` (0-100). The tracker's `reputation: [{faction, change, reason}]` moves it (one move per faction per turn, clamped to −15..+25) when that village's people saw Kan and lived, he hurt or killed its people, or worked openly in its land. At `LIST_HEAT` (15) he is listed; ranks C 15 / B 35 / A 60 / S 85; bounty `heat² × 6000` ryō rounded to 100k (≈1.4M C, 7M B, 22M A, 43M+ S).
- **Cooling**: after `COOL_AFTER_DAYS` (60) without a new deed, −1 heat per `COOL_DAYS_PER_POINT` (20) days, computed lazily (`currentHeat`) and baked in on the next change. A listed entry never drops below 15 and is never removed.
- **The Leaf**: `ensureLeafListing` (every turn, inside `applyReputationChanges`) writes Kan into the Leaf's book at B-rank (40) once the clock passes the morning after the massacre night (`LEAF_LISTS_ON`, Year 13 · 2 Oct 06:00). Older saves get it on their next turn.
- **What Kan knows**: entries start `known: false`. `bounty_seen: [village]` (a poster, a hunter naming his price, someone telling him) marks one known and shows a news-strip notice. The narrator always sees every entry (so strangers react honestly) plus a line saying which ones Kan has not seen; the Kan tab shows only known ones.
- **Akatsuki standing** (−100..100, `akatsuki` faction, usually ±10): bands suspected / doubted / unproven / trusted / valued. Shown to the narrator only once `kan-joins-akatsuki` is completed.
- **YOUR NAME OUT THERE** (narrator, after ENCOUNTER CONDITIONS): `territoryOf(location)` picks the great village whose land Kan is in (or none for small countries); one line on how its shinobi would react by rank, other villages that want him, civilians (wanted posters only at S), the Akatsuki cloak (feared by everyone from Year 17, by hunter-nin and the underworld before), and the standing line. Skipped where `encounterRisk` is `none`, except the standing line. Recognition needs a good look and someone who would know.
- **A PRICE ON YOUR HEAD (optional)**: `hunterOffer` — one possible turn per `HUNTER_WINDOW_TURNS` (10), never before turn 8, only on roads and in towns, never in combat or empty places, only if Kan is listed somewhere; the chance per window rises with the top rank (C ¼ … S always). Hunter-nin only on their own village's land. Deterministic per slot + window.
- **One pressure per turn**: the prompt takes a due grudge first, else a bounty hunter, else A FAMILIAR FACE (`formatPressure` in `prompt.ts`).

---

## 10. Romance & lore (`lib/rpg/romance.ts`)

- `RelationshipStage`: stranger → friendly → close → romantic interest → partner / rejected.
- `Attraction`: none | warm | strong.
- `normalizeRelationship` / `normalizeAttraction` tolerate model wording.
- `CHARACTER_LORE` holds canon devotions, accessibility (`winnable` / `lore-locked`) and orientation.
- `ERA_NOTES` gives era-specific personality lines keyed by year (`eraKeyForYear`, `eraNoteFor`).
- `ROMANCE_RULES` is injected into the narrator system prompt.
- **Canon-bound hearts** (`canonEndgame.ts`): a winnable heart with `canonEndgame: { partner, from }` (Temari→Shikamaru 24/10, Ino→Sai 25/3, Karui→Choji 25/6) can truly be with Kan, but canon wins. Her scene card says so (`endgameNote`); in the last `ENDGAME_LEAD_MONTHS` (18) it tells the narrator to let it end naturally. From the date, `applyCanonEndgames` (after every turn, canon advance and time correction) turns `partner` into `ex` (relationship stage added for this), cools an unbegun `romantic interest` to `close` and `strong` attraction to `warm`, and stamps the romanceNote; the story cannot set her back. If the canon partner is dead, nothing is forced.
- Bonds store relationship/attraction/romanceNote; a rejection stays until the narrator moves it on (never from affinity alone); a winnable heart that rejected Kan can slowly change its mind over time.
- Adult NPCs deflect while Kan is under 17; explicit intimacy only when both are 18+; the prompt instructs **never to censor** when ages permit.

### 10a. Grudges (`lib/rpg/grudges.ts`)

The dark mirror of romance: slow, earned, lasting.

- **Start**: a bond diff that leaves affinity at or below `GRUDGE_AFFINITY` (−6), or the tracker's `grudges: [{character_id, event: 'wronged', reason}]` (Kan kills or maims someone they love, betrays, humiliates or ruins them; creates a bond if there is none). Opens a `grudge` thread (`<name>'s grudge against you`) and a fact.
- **Heat** (0-100): starts at 30 + 5 per point below −6 (45 for `wronged`; +25 for a further `wronged`); a negative bond move adds 4 per point, a positive one removes 5; left alone it stews +1 per `STEW_DAYS` (10), up to +20 since it last moved (`grudgeHeat`).
- **Stage**: resentful < 40 ≤ vengeful < 70 ≤ hunting. Only original characters can hunt; canon characters (`isOriginalCharacter` false) stop at vengeful and act within their canon path — the mirror of lore-locked hearts.
- **Strikes**: `grudgeOffer` offers one vengeful/hunting grudge (not a companion, not in the scene, not mid-fight) once `STRIKE_GAP_DAYS` passed since the last strike (vengeful 30, hunting 14): on one turn in five, or every turn once `STRIKE_PRESS_DAYS` (10) overdue. The style is deterministic per turn: hunting → ambush (at night in towns), trap, hired blades, signs they are close, or — after a failed strike — a threat against someone Kan cares about; vengeful → his movements sold, a message, paid blades, or them turning up if this place is on their path. `struck` records `lastStrike`.
- **End**: the bond climbing back to `LET_GO_AFFINITY` (−2) → let go; `settled` (a reckoning they accept) or `forgiven` from the tracker; death. Each resolves the thread; all but death add a fact.
- Prompts: `GRUDGE_RULES` (ENEMIES) sits in the narrator rules; BONDS shows `[grudge: stage, reason]`; the state prompt gets REPUTATION & GRUDGES (field rules + the offered grudge's id).
- UI: Bonds → "Your name out there" card (known listings, Akatsuki standing bar), a "Want you to pay" group with a red stage tag; the bond screen shows a Grudge card.

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
- **People in scene images**: after the ACTION is written, `sceneCharacterReferences(db, action)` picks up to `SCENE_CHARACTER_LIMIT` (3) people named in it (name or alias, in the order named) who have a face reference (preferred) or a painted portrait, and they go in as `character` references. `planReferences` order is face → outfit → character → previous → alternate, so other people's faces outrank older scenes for style. The prompt labels each by name ("match their face…", face references ignore their own clothes and art style) and says every reference is for its own person only.
- Images are generated **only when the player taps the image button** (`generateSceneImage` in `app/(tabs)/index.tsx`).
- **Storage (`imageStore.ts`)**: images never live in the save. `storeImage` writes the data URI to IndexedDB (`kan-images`) and returns a short `img:<id>` reference that goes into `rawLog[].image` / `portraits[].image`. `loadImage` / `useStoredImage` resolve references (in-memory cache). On load, switch and import, `externalizeImages` migrates any inline data URIs from older saves. Export inlines images again (`inlineImages`) so save files stay self-contained. Without IndexedDB, `storeImage` returns the data URI unchanged.
- **Portraits (`portrait.ts`)**: `portraitSignature(db)` reduces Kan to age, outfit (Akatsuki cloak in inventory), a coarse expression bucket from `state.mood`, and a setting bucket from `locationKind`. `portraitStaleReason(latest, current)` says why the latest portrait is outdated (outfit → age → expression → setting) or returns null. `buildPortraitPrompt` asks for a 3:4 head-and-shoulders portrait using the face sheet, the current outfit and the previous portrait as references. Portraits are generated only from the Kan tab's Refresh button and stored in `db.portraits` (last 24).
- **Character portraits (`characterPortrait.ts`, `components/kan/CharacterPortraitCard.tsx`)**: portraits of people in your bonds, painted only from the Paint/Repaint button at the top of their bond page. `characterPortraitSignature(db, entity)` = age (frozen at death), expression bucket from `entity.mood`, and `entity.appearance`; `characterPortraitStaleReason` checks face reference added → age → appearance → expression (the dead never go stale otherwise). `buildCharacterPortraitPrompt` sends a 3:4 head-and-shoulders request with references face → previous portrait of that person; without a face reference it asks for the canon design if they are a Naruto character, else follows the appearance text. Stored in `db.characterPortraits` (last `PORTRAITS_PER_CHARACTER` = 4 per person, each with `usedFace`). **Face references** (`db.characterFaces`, one per person) are images the player chooses (`pickImageFile` in `file.ts`, scaled to 768px JPEG) — nothing is fetched from the web and nothing ships in the repo; they live in IndexedDB like every other image and are inlined on export. `mergeEntityPair` moves portraits and the face reference to the person kept (`moveCharacterImages`). The bonds list shows the latest portrait in each avatar circle.

---

## 12. UI

- `app/_layout.tsx` — fonts (Manrope), navigation, GameProvider, toasts, Android nav bar.
Three tabs: **Story / Kan / Settings**. All list screens use the shared kit in `components/List.tsx` (`SectionLabel`, `ListCard`, `ListRow`, `FilterPills`, `Segmented`) and the type tokens in `constants/theme.ts` (`sectionLabel`, `rowTitle` 15 bold, `rowBody` 13, `rowMeta` 12, `prose` 16) — use them for new screens instead of one-off styles.

- `app/(tabs)/index.tsx` — Story: narration as plain prose, Kan's turns as tinted blocks (`*actions*` italic), header with clock/date/location (tap → status sheet with mood, date, scene), news strip, a `+N min` time chip under each reply (tap to correct), Image / Retry / Undo under the latest reply, single-row composer with `"` and `*` markers, fullscreen image viewer.
- `app/(tabs)/kan.tsx` — Kan hub: `components/kan/PortraitHeader.tsx` (current portrait, outdated reason, Refresh, history strip) plus a sticky Bonds / Jutsu / Journal switch.
  - `BondsSection.tsx` — search + compact rows (people you have met; unmet canon cast is hidden) (avatar — their latest portrait when painted, name, Major tag, affinity bar, relationship · last seen), sorted by most recent contact; rows open `app/(tabs)/bond/[id].tsx` (portrait with Paint/Repaint and face reference, bond meter, chips, mood/personality/speech/appearance, shared memories, Merge with…).
  - `JutsuSection.tsx` — jutsu grouped by chakra nature; rows expand for appearance and notes.
  - `JournalSection.tsx` — Now (scene, missions, goals, threads), Recap (timeline of summaries, falls back to recent events), World (heard canon news with source, world state, lore), Memories (events with people). Rows use an event's own `title` when it has one (`memoryTitle`); otherwise `titleAndBody` (`util.ts`) splits the text: "Title: …", a first sentence under 90 characters, or the first words cut at a word boundary with the rest kept as the description. Recap titles come from `summary.title`.
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
4. **Time always moves, by the largest of** the narrator’s report, the narration parser, or the scene-type minimum (combat 15 s, chase 1 min, conversation 2 min — 20 s in conversation mode, downtime 10 min, travel 30 min). Every advance goes through `resolveTurnClock`, never forward-only hacks elsewhere; the player can correct any turn from its time chip.
5. **Combat cannot skip days** around the player; the cap is enforced in `resolveTurnClock`.
6. **Tobi's identity** (hidden aliases) stays hidden until the war mask-break; real Madara is separate.
7. **Pain/Nagato** are one entity; six paths are one.
8. **Unheard canon events are invisible in the Journal** until delivered.
9. **Personal beats are offers**, never assumed; they only complete when narrated.
10. **Token ceiling**: prompts over `settings.promptTokenBudget` are trimmed; never add unbounded prompt data. Keep the rules and slow blocks first so the cached prefix survives.
11. **Images only on user action**, with Kan’s face/outfit references and the action brief.
12. **Version sync**: `package.json` → `app.json` → SW cache (`scripts/generate-sw.js`) → Settings display.

---

## 13b. Save-analysis fixes (Nov 2026)

How the fixes from the save-analysis list work, and where they live. Tests: `scripts/fixlist-memory.test.ts` (5–8), `fixlist-people.test.ts` (10–14), `fixlist-world.test.ts` (15–21), `fixlist-story.test.ts` (22–28), `met-and-memories.test.ts` (1–4).

- **One clock** (`correctTurnTime`, `shiftDatesAfter` in calendar.ts): correcting a turn's length shifts every in-story date stamped after the turn began, anywhere in the save.
- **Fact lifecycle** (facts.ts): the state tracker sees `ACTIVE FACTS` with refs (`f-xxxxxx`) and can `supersedes` / `facts_ended` them; a new fact overtakes a matching "does not know yet"; `lasts` gives conditions `untilRest` and injuries/plans an `expiresAt`; `expireFacts` runs every turn (rest = 5+ hours outside a fight). `whoKnows` holds entity ids, `whoKnowsGroups` group tags; claims are `confidence: 'claimed'` with `claimedBy`; every fact has a subject and a `sourceEventId` or `sourceLogId`. The prompt budget cuts memories, then facts and lore, before recent story.
- **Lore conditions** (lore.ts): `activeAfter` / `activeUntil` with a milestone, thread status, fact text or flag (`hasSharingan`, `knowsIzumiDead`, `headbandScratched`…); `always` entries (geography) are always sent. Seed lore is in second person.
- **Milestone stages** (canon.ts): offered → accepted (`canon_engaged`, nothing written) → completed (`canon_completed`, the moment in `completesWhen`): only completion writes facts (real date, subject, who was there), opens threads and grants jutsu/abilities. `requires` gates a beat (the Mangekyō waits until you know Izumi died).
- **Chapters** (`applyChapterBreak` in memoryJobs.ts): summaries never end chapters. A chapter opens on `chapter_title`, a completed major milestone or a 2+ day skip, once the chapter has 6 turns or 12 hours (60 turns closes one anyway). `state.chapterTitle`, `chapterStart`, `chapters`.
- **People**: `gender` on everyone; men are `romanceAccessibility: 'not-applicable'`, Kan has none; new people from `gender` + `attracted_to`. `tier: 'minor'` people get no bond until a second scene. `appearance` is the lasting base look, `currentLook` the look of the moment (cleared by a new scene or rest), `whereabouts` where someone absent is.
- **Bonds**: `theirFeelings` (mirrors `affinity`/`note`, kept in step by `syncBondSides`) and `yourFeelings` (`your_change`, `your_note`). Relationship labels are fixed; `partner` is an Akatsuki partner, romance is `lover`. A bond reads "Deceased · …" once you know of the death.
- **Kan's sheet**: `player.natures` (innate / Thousand Souls) and `player.abilities` (stage + history), from `natures_gained` / `abilities_changed`; shown on the Kan tab.
- **Threads**: matched on normalized titles and wording before opening; casing kept; `participantIds`, `sourceEventId`, `sourceLogId`. Story hooks (hooks.ts) open and close Izumi's grave, Survive Kakuzu and the bingo-book thread by condition.
- **Narrator**: exact time and earliest end time, FIGURES ALREADY SAID, ELSEWHERE, VARIETY (question endings, repeated motifs, settled decisions), geography, inventory rule.
- **Images**: WebP recompression (imageCompress.ts) and binary IndexedDB storage; `imageMeta` on scene images; export with or without images; older chat images load on tap; portrait painting lock (`beginPainting`) and duplicate guard.
- **Undo**: snapshots (last 5) survive saves and hold no images; restore takes images from the live save.

## 14. How to extend safely

### Add a canon milestone
Add an object to `CORE_MILESTONES` or `WORLD_EXPANSION` in `canonData.ts` (the exported `CANON_MILESTONES` is sorted by opening date, which is the prerequisite order; give same-day events distinct days when one must come first), with a real date window, `region`/`location`, `knowledge` (+ `bearers` if secret), facts, optional encounter, and `playerDriven` if it depends on Kan. Personal beats can set `priority` (always offered while open), `after` (offered only once another beat has happened) and `grantsJutsu` (signature jutsu Kan gains when it happens). No engine change is needed. Add a test that it opens on the right day.

### Add a canon cast member
Add an entry to `BASE_CAST` in `canonCast.ts` or `CAST_ADDITIONS` in `canonCastMore.ts` (name, aliases without common words or another person's names, a birthday — canon, or a chosen one with `birthdayInvented: true` — birthYear counted from Kan's birth — 17 minus their Part I age — role at year 13, `status: 'Deceased'` if dead by then, `appearsWith` if they only enter the story with a milestone, and their name in `FEMALE_CAST` if she is a woman) and a matching `CHARACTER_LORE` entry in `romance.ts` (the tests require both). Existing saves pick them up on next load.

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
| Save quota error | Slots should be in IndexedDB — check `slotBackend()`. On the AsyncStorage fallback `saveSlot` trims images/snapshots; clearing old slots helps. |
| Need to see what really happened | Settings → Debug: prompt, state diff, tokens and cost per turn. |
| PWA stale | Bump version so `generate-sw.js` changes the cache name; rebuild. |

---

## 16. Test coverage map (`scripts/verify-pipeline.test.ts`)

- Save compatibility & normalization
- Slot storage (`scripts/slot-store.test.ts`): IndexedDB backend, localStorage migration, newer-copy-wins, long stories past the localStorage cap, AsyncStorage fallback
- JSON stripping (fenced, truncated, unfenced, labels)
- Identity resolution (Tobi and hidden Obito, real Madara, Pain and hidden Nagato, Zetsu, descriptions never matching)
- Meeting and shared memories (`scripts/met-and-memories.test.ts`): mentioned-only stays unmet with no bond, the scene cast meets people, "the masked man" about Kakuzu leaves Tobi alone, a failed state reply meets no one, everyone in the room shares a memory, memories never span two scenes, the bond page drops mentioned-only links
- Duplicate characters (canon cast seeding and migration, ID roster in the state prompt, `is_new` gate, ID resolution, manual merge, whole-word name mentions)
- Time parsing and clock arithmetic (seconds/minutes/days, leap years, month lengths)
- Pacing caps and combat date blocking
- Canon dataset (unique ids, ordered windows, secret events have bearers)
- Canon scheduling (baseline, real dates, personal vs world, passed/completed, news/heard, couriers)
- Romance persistence and lore era notes
- Image brief/cast/action rules
- Prompt composition (blocks, dedupe, no dice roll / style guard, encounter conditions, budget)
- Companions (state reply → diff, always in the scene cast, shared-scene bond steps, cap and hostility floor, parting and death, new person joining, party limit, both prompts, reload and merge)
- Characters who come back (original-only pool, place fit, travellers, cadence, no offers in fights or empty places, `lastSeenAt` recording)
- Reputation & grudges (`scripts/enemies.test.ts`): Leaf listing timing, heat → rank/bounty, per-turn clamp, cooling floor, `bounty_seen`, territory lines, empty places, Akatsuki standing, hunter cadence; grudges from soured bonds and `wronged`, stewing, canon hunt cap, due/pressed/combat/in-scene offers, `struck`, let go / settled / death, schema and reload
- Token stability over 60 turns
- Scene modes (`scripts/scene-mode.test.ts`): input reading, instruction never flips it, lean then settle, small actions stay in, remark carries, leaving ends with a transition, group talk, 20 s conversation turns, attack → fight with options, ambush → fight, options cleared when it ends, overrides and their clearing, reload, prompt and schema
- Living-world Stage 2 (`scripts/living-world-stage2.test.ts`): the 67 new people, birthday fixes and backfill, the unborn / real Madara / Kaguya arriving with their milestones, every canon death landing on someone, beasts and children never romance, the shorter tracker roster, the new milestones' order, the Karin arc, the eyes and Shisui threads, the yearly offers (present, unknown, learned, once a year, anniversaries, remembrance, festivals, none in fights) and upcoming birthdays
- Debug log (`scripts/debug-panel.test.ts`): state-change diff, per-turn cost totals, usage parsing from normal and streamed replies

Run: `bun test`.
