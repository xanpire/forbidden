# frbddn — Engineering & AI Handoff Guide

> **Conversion in progress.** frbddn (`APP_NAME` in `lib/brand.ts`) was Kan, a Naruto-only RPG, and is becoming a grounded sandbox roleplay game. The session plan and progress log live in the claude.ai Project (`kan-master/docs/SANDBOX_CONVERSION_PLAN.md`), not in this repo. Session 2 removed all Naruto data: every system now reads the player's world (`db.world`). Session 3 gave the narrator the player-written THE WORLD and WHO YOU ARE blocks and moved every test onto the test world (`lib/rpg/testWorld.ts`).

This document is the complete technical map of the app. It is written so a developer **or an AI coding agent** can understand, debug and extend it without prior context.

Read it top to bottom once. Then use the file map and invariants as a checklist when changing anything.

---

## 0. File map (`lib/rpg/`)

| File | What lives there |
|---|---|
| `../brand.ts` | `APP_NAME` (frbddn) and every storage key / IndexedDB name |
| `player.ts` | Who the player is: `playerEntity`, `playerName`, `isPlayer`, `isPlayerName`, `playerRefs`, `playerDisplayNames`, `playerAge`, `normalizeCharacter` |
| `world.ts` | `emptyWorld`, `normalizeWorld`, `CLIMATE_TYPE_LIST` |
| `game.tsx` | `GameProvider`: the turn loop, undo/regenerate, slot switching |
| `memoryJobs.ts` | `applyStateStep` (phase 1) and the summary job queue (phase 2) |
| `services.ts` | `applyTurnDiff` (applies one `TurnDiff` by calling the modules below) and the model calls: `extractTurnDiff`, `summarizeScene`, `summarizeTimeSkip`, `rollArcSummary` |
| `stateBlock.ts` | Reading the state model's reply: `parseJsonObject`, `convertStateBlock` (snake_case → `TurnDiff`) |
| `entities.ts` | People/places: `resolveEntity`, identity groups, `resolveCharacterRefs`, `applyEntityDiff`, presence, `mergeDuplicateEntities`, `mergeEntityPair` |
| `bonds.ts` | `applyBondDiff`: affinity, status, relationship stage, attraction |
| `companions.ts` | People travelling with the player: `startCompanion`, `endCompanion`, `setCompanion`, `applyCompanionChanges`, `castWithCompanions`, `applySharedScene` (§6a) |
| `facts.ts` | `applyFactDiff`, `applyThreadDiff`, `recordSceneEvent` |
| `deaths.ts` | Who is dead: `isDeceased`, `playerKnowsDeath`, `markDeceased`, `markDeathsByName` (timeline events, exact names only), `markAlive`, `normalizeDeaths` (load-time backfill) |
| `clock.ts` | `applyClockChange` (date/elapsed/clock from the diff, ageing across years), `applyClockTick` (stall counter) |
| `log.ts` | Story log + undo snapshots: `appendStoryMessage`, `pushSnapshot`, `restoreLastSnapshot`, `cloneDatabase`, `storyMessagesSinceLastSummary` |
| `util.ts` | `trimToSentence`, `uniqueList`, `clamp` |
| `timeline.ts` | **World timeline engine** over `db.world.timeline` (empty by default): scheduling (`advanceTimeline`), state-tracker marks (`applyTimelineMarks`), the unheard-news queue and its escalation (`unheardNews`, `newsUrgency`, `markNewsHeard`), bearers and channels (`timelineBearers`, `timelineChannel`), the world clock (`worldClock`) |
| `newsDelivery.ts` | How news reaches the player this turn: `newsOffer` (bearers in the scene first, the living fallbacks, one delivery style, catch-up reports), `newsAllowance`, the narrator/tracker text |
| `reputation.ts` | What each faction has on the player (`state.reputation.factions`): `applyReputationChanges`, `wantedListings` (factions with `hasBounties`), `factionStandings`, `currentHeat`, `territoryOf`, `formatReputationBlock` (YOUR NAME OUT THERE), `hunterOffer` (§9b) |
| `grudges.ts` | Grudges, the dark mirror of romance (`BondRecord.grudge`): `applyGrudgeChanges`, `grudgeStage`, `grudgeHeat`, `grudgeOffer` (SOMEONE WANTS YOU TO PAY), `GRUDGE_RULES` (§10a) |
| `letters.ts` | Personal letters to and from the player (`state.post`): `letterOffer`, `sendLetters`, `receiveLetters`, `deliverLetters`, `lettersInTransit`, `letterArchive`, `interceptionRisks`, `tidyLetter` (§8c) |
| `geography.ts` | Regions and travel days from `world.regions[].neighbours` (shortest path; unknown pairs `UNKNOWN_DISTANCE_DAYS`): `regionOf`, `regionName`, `travelDaysBetween`, `whereaboutsRegion`, `currentRegion` (§8c) |
| `lives.ts` | People with their own lives (§8c): `advanceLives`, `applyLifeEvents`, `markReunions`, `sinceYouLastSaw`, `reunionNotes`, `knownLife` |
| `consequences.ts` | Delayed consequences (`state.consequences`, §8c): `plantSeed`, `applyConsequences`, `advanceConsequences`, `canReturn`, `consequenceOffer` (SOMETHING COMES BACK), `waitingConsequences` |
| `renown.ts` | Deeds, rumours, posters and the player's epithets (`state.renown`, §8c): `recordDeeds`, `applyEpithet`, `markEpithetsSeen`, `localEpithet`, `knownEpithets`, `rumourOffer` (TALK OF YOU), `posterLine` |
| `povMemories.ts` | Memories from each person's point of view (`EventRecord.povs`, §8c): `povCandidates`, `parsePovLines`, `resolvePovs`, `povOf`, `latestPov` |
| `weather.ts` | Seasons and weather (§8d): `weatherAt` (per save, region and 6-hour block), `currentWeather` (the scene's held weather), `applyWeather`, `conditionFromText`, `formatWeatherLine` (WEATHER), `formatWeatherTracking`, `seasonLabel`, `climateOf`, `CLIMATE_TYPES` (one entry per `ClimateType`) |
| `mapData.ts` | Places and the player's road (§8d), no coordinates: `mapPlace`, `placeIdOf` (matches `world.places`), `recordTravel` (`state.travelLog`), `placeVisits`, `regionsVisited`, `travelEstimate`, `knownWhereabouts` (as far as the player knows) |
| `ambience.ts` | Ambient sound (§8e): `ambienceInputOf`, `ambienceMix` (bed levels from weather, place kind, climate type, location words, clock, season, scene mode), `currentAmbience`, `isIndoors`, `describeAmbience`. Pure; the player lives in `lib/audio/` |
| `scrapbook.ts` | The scrapbook (§8d): `scrapbook` (photos by era and chapter; flashback photos under `MEMORY_ERA`), `eraOfDate`, `captionOf`, `placeAt` |
| `flashbacks.ts` | Playable flashbacks (§8f); records live in `db.world.flashbacks` (empty by default). The engine: `flashbacksOf`, `flashbackById`, `flashbackOffer`, `beginFlashback`, `applyFlashbackMarks`, `applyFlashbackTurn`, `endFlashback`, `applyFlashbackWriteUp`, `flashbackView` (the memory's date, place and weather), `formatFlashbackBlock` / `formatFlashbackOffer` / `formatFlashbackReturn`, `flashbackTrackingLines`, `flashbackImageNote`, `rememberChip` |
| `safehouses.ts` | Safehouses (§8g, `state.safehouses`): `applySafehouses` (tagging, leaving and coming back, stash, upgrades, residents, who knows, rest), `advanceSafehouses` (rooms running out, hosts, residents, found places searched), `currentSafehouse`, `restQuality` / `restBlocked`, `formatSafehouseLine` (SAFEHOUSE), `placesLine`, `formatSafehouseTracking` (SAFEHOUSES), `letterAddress`, `headingTo` |
| `names.ts` | Names the player knows (§8i): `displayName` (the one name everything shows), `alsoKnownAs`, `searchableNames`, `narratorName`, `labelOf` / `ensureLabels`, `learnName`, `applyNameStep` (tracker names, names told, recognition on sight, names said aloud, identities from timeline news), `nameKnownBy` / `identityLine` (who calls whom what), `playerKnowsLine`, `nameLeaks`, `ensureNames` (load-time setup), `fameOf` (the entity's `fame`) |
| `money.ts` | The player's money (§8h, `state.purse`): `applyPurse` (the tracker's changes and stated totals; never below zero), `formatPurseLine` (Purse in CURRENT STATE), `currencyOf` / `priceGuideOf` (from `world.currency`), `formatMoney`, `formatChange`, `readAmount`, `purseFeel`, `lowPurseAmount` |
| `yearly.ts` | The yearly calendar (§8b, `state.yearly`): birthdays, anniversaries, New Year and `world.festivals`: `yearlyOffer`, `applyYearly`, `knowsBirthday`, `upcomingBirthdays`, `todayNotes` |
| `prompt.ts` | Narrator and state prompts |
| `calendar.ts` / `timeparse.ts` / `pacing.ts` | Clock arithmetic, reading time from prose, the per-turn clock step (`resolveTurnClock`) |
| `sceneMode.ts` | Conversation and fight mode (§8a): `readPlayerInput`, `resolveTurnMode`, `applySceneBeat`, `setSceneModeOverride`, the SCENE MODE prompt lines |
| `encounters.ts` | Location kind and crowd level (`ENCOUNTER CONDITIONS`) |
| `returning.ts` | Characters who come back: the occasional optional `A FAMILIAR FACE` offer |
| `db.ts` / `slotStore.ts` / `seed.ts` / `testWorld.ts` | Persistence + migration (slots in IndexedDB); `seedDatabase(slotId, slotName, { world, character, people, opening })` builds a save from the player's input; `testWorld.ts` is a small present-day test setting (Harbourside) used by **New story** until the wizard (session 4) |
| `retrieval.ts` | Memory/fact/lore retrieval |
| `romance.ts` | Relationship stages, attraction, `romanceFor` (who someone is drawn to vs the player's gender), `ROMANCE_RULES` (session A renames it `intimacy.ts`) |
| `image*.ts`, `reference*.ts`, `portrait.ts` | Image pipeline |
| `debug.ts` | Debug log (outside the save) |

Dependency direction: `services.ts` → `entities/bonds/facts/clock/log/stateBlock` → `util/calendar/characterRefs/id`. `timeline.ts` reads only `db.world.timeline`. The leaf modules never import `services.ts`.

---

## 1. What the app is

- A **client-only** interactive roleplay PWA. The player writes their own world (`db.world`) and character (`db.state.player`), and plays them. Settings are grounded in reality: no magic, powers or ability systems; the player only picks *when* (past, present or future).
- An LLM **narrator** writes the story in second person (prose only); a separate **state call** turns that prose into a structured diff.
- A deterministic engine applies that diff, advances the clock, runs the world timeline, delivers news, records memories, updates bonds, and persists everything.
- No server, no database service: `AsyncStorage` (localStorage on web) + OpenRouter API.

Tech: Expo SDK 54, Expo Router, React Native Web, TypeScript, `bun` as package manager.

---

## 2. Persistence

`lib/rpg/db.ts`

| Key | Where | Contents |
|---|---|---|
| `frbddn.meta.v1` | AsyncStorage (localStorage) | `StorageMeta`: active slot id, slot list |
| `frbddn.slot.<slotId>.v1` | IndexedDB `frbddn-saves` / `slots` (`slotStore.ts`) | One `AppDatabase` JSON per save slot |
| `frbddn.apiKey.v1` | AsyncStorage (localStorage) | OpenRouter API key (never stored in slots or exports) |

Every key and IndexedDB name comes from `lib/brand.ts` (`STORAGE_KEYS`, `IDB_NAMES`), next to `APP_NAME`; a rename is one edit there. Saves from Kan (the `kan.*` keys) do not load: the sandbox starts fresh.

Slots live in IndexedDB because localStorage is ~5 MB for the whole app, shared by every slot, and a long story with its 3 undo snapshots (each a full copy) outgrows that after a few hundred turns. `slotStore.ts` picks the backend once per session (IndexedDB, or AsyncStorage on native / when IndexedDB can't open), moves an old localStorage copy into IndexedDB on first read (newer `meta.updatedAt` wins if both exist) and then removes it, and asks for `navigator.storage.persist()` so the browser doesn't evict the data under storage pressure. Images are in a separate IndexedDB (`frbddn-images`, `imageStore.ts`).

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
  events: EventRecord[]          // memories, world timeline events, time skips
  eventEntities: EventEntityRecord[]
  bonds: BondRecord[]            // affinity, status, relationship, attraction, romanceNote
  facts: FactRecord[]            // permanent facts with whoKnows + validity
  threads: ThreadRecord[]        // open/resolved plot threads
  loreEntries: LoreRecord[]      // keyword-triggered world lore
  summaries: SummaryRecord[]     // chapter / arc / year summaries
  world: WorldDefinition         // the world the player wrote (world.ts); every system reads it
  state: GameState
  indices: MemoryIndex
  snapshots: TurnSnapshot[]
}
```

### The player's world and character

`db.world` is a `WorldDefinition`: name, premise, genre, tone, `era` (`when`: past/present/future, free-text `period`, optional `techNotes`), optional `knownUniverse` (`canonStrictness`), `currency` (name, symbol, plain-text `priceGuide`), `calendar`, `factions` (`FactionDef`: any group — a company, a family, a gang, a police force — with optional `territoryRegionIds`, `hasBounties`, `carriers`, `readsMail`), `regions` (`RegionDef`: a `ClimateType` and travel days to neighbours), `places` (`PlaceDef`: settlement/road/wilderness/structure), the player's own `lore`, a `timeline` (`TimelineEvent`), `flashbacks`, `festivals`, `letterCarriers`, `artStyle`, `narratorNotes`. `emptyWorld()` makes a blank one; `normalizeWorld()` runs on every load and drops the old ability/magic fields.

`db.state.player` is a `CharacterDefinition`: what the player wrote (name, aliases, age, birthday, gender, appearance, outfit, personality, speech style, backstory kept verbatim, role, plain-text `skills`, inventory, money, secrets, goals, face/outfit image refs) plus `birthYear`. There is no ability system of any kind. `normalizeCharacter()` (player.ts) repairs it on load. `StartingPerson` and `OpeningScene` are the inputs `seedDatabase` turns into entities, bonds, facts, threads and the opening memory.

**Who the player is** (`lib/rpg/player.ts`): nothing else names the player. The player's entity is the one tagged `player` (`PLAYER_TAG`). Use `playerEntity(db)`, `playerName(db)`, `playerId(db)`, `isPlayerEntity(entity)`, `isPlayer(db, entity)`, `isPlayerName(db, name)` (name, aliases, id, or "player"/"you"), `playerRefs(db)` / `isPlayerRef(refs, value)` for code without a db, `playerDisplayNames(db)` (for `secondPerson`, which rewrites the player's name into "you"), and `playerAge(db)` / `playerAgeAt(db, date)`. In the tracker prompt the player's id is always `player` (`PLAYER_REF` in characterRefs.ts); `convertStateBlock(block, statePlayerOf(db))` drops the player from cast lists.

### `CalendarDate` — the clock

```ts
{ year, month, day, hour, minute, second? }
```

No `timeOfDay` field. Period labels (`morning/afternoon/evening/night`) are derived with `timeOfDayOf(date)` (05–11 morning, 12–16 afternoon, 17–20 evening, otherwise night).

### `GameState`

```ts
{
  player: CharacterDefinition   // see above
  mood: string
  worldDescription: string
  inventory: string[]
  location: string
  locationKind?: 'settlement' | 'road' | 'wilderness' | 'structure'
  inStoryDate: CalendarDate
  turnsWithoutTimeChange?: number   // turns where only the pace minimum moved the clock; drives a prompt nudge
  worldPoint: string           // a free line on where the world stands; timeline events can set it
  timelineProgress?: TimelineProgress
  chapter: number
  scene: string
  scenePace?: 'combat' | 'chase' | 'conversation' | 'travel' | 'downtime'
  sceneCast?: string[]
  sceneMode?: { current, exchangeStreak, partners, lastBeat?, override? }   // §8a
  yearly?: { knownBirthdays: string[], offered: Record<key, year> }        // §8b
  weather?: { region, condition, text?, since, sceneSeq?, source: 'world'|'story' }   // §8d
  travelLog?: [{ place, region?, placeId?, date }]                          // §8d, last 400
  flashbacks?: { played, offered, lastOfferOn?, pending?, active?, returned? } // §8f
  safehouses?: { places: Safehouse[], current? }                            // §8g
  purse?: { amount, history: [{ date, change, reason, counted? }], estimatedStart? }  // §8h, last 40, in world.currency
}
```

`EntityRecord.birthdayInvented?: true` marks a birthday the app chose. `EntityRecord.fame?: 'sight' | 'heard'` says whether the player would recognise someone famous on sight or only by name (§8i).

`RawLogEntry.flashback?: { id, date }` marks a turn played inside a flashback (both entries, with the memory's clock when it began); `RawLogEntry.flashbackOffer?: id` marks a reply whose prompt offered one (§8f).

`EntityRecord.companion?: { since, sinceLocation?, reason?, sharedScenes, bondPoints }` — set while that person travels with the player (§6a).

### `TimelineProgress`

```ts
{
  version?: number
  baselineDate?: CalendarDate
  completed: string[]           // timeline event ids (including expired/silent)
  active: string[]              // open encounter windows
  engaged: string[]             // personal beats started but not finished
  expired?: string[]            // windows that closed before they could happen
  heard?: Record<eventId, { from: string; date: CalendarDate }>
  heldForCombat?: boolean       // last advance was held because the player was mid-fight
}
```

### `state.post` (personal letters, `letters.ts`)

```ts
{
  letters: [{
    id, direction: 'to-player' | 'from-player', entityId, name,
    sentOn, arrivesOn, gist?, text?,           // text: the letter's words, for the archive
    status: 'travelling' | 'delivered' | 'lost' | 'unsent',   // unsent: a letter to the dead
    lostReason?, carrier?: string,            // one of world.letterCarriers, or 'hand'
    coded?, toRegion?, interceptedBy?: factionId, occasion?: 'birthday',
    replyTo?, deliveredOn?
  }],                            // everything travelling + the last 200 done with words + 40 without
  lastLetterIn?: CalendarDate    // when a letter last reached the player
}
```

### `state.reputation` (`reputation.ts`)

```ts
{
  factions: Record<factionId, {
    heat: number,                // 0-100 before cooling
    standing?: number,           // -100..100: how they regard the player
    listedOn?: CalendarDate,     // on their wanted list since (hasBounties factions); never removed
    lastDeedOn?: CalendarDate,   // cooling counts from here
    lastReason?: string,
    known: boolean               // the player has seen or been told of it
  }>,
  recent: [{ faction, change, reason?, date }]   // last 12
}
```

### `state.renown` and `state.consequences` (§8c)

```ts
renown: {
  deeds: [{ id, date, text, faction?, region?, weight }],          // last 40
  epithets: { [factionId | 'common']: {
    name, since, theme /* or 'story' */, known, history?: [{ name, since }]
  } }
}
consequences: [{
  id, kind: 'spared'|'lie'|'helped'|'witness'|'betrayal'|'humiliated'|'promise'|'debt'|'intercepted'|'found',
  createdOn, entityId?, who, what, want?, witnesses: string[], faction?, region?,
  after, before, status: 'waiting'|'returned'|'faded', letterId?, safehouseId?, offeredOn?, resolvedOn?
}]                               // up to 24 waiting + 20 ended
```

`EntityRecord.lifeEvents?: [{ date, text, kind, source: 'world'|'story', known? }]` (last 8) and `EntityRecord.reunion?: { on, lastSeen, lastSeenAt?, seq? }`. `EventRecord.povs?: [{ entityId, text }]` (up to 3).

`BondRecord.grudge?: { since, reason, heat, updatedOn, lastStrike?, strikes }` — set while that person holds a grudge against the player (§10a).

### `TurnDiff` (what the state call produces)

```ts
{
  state?: {
    mood?, worldDescription?,
    inventoryAdded?, inventoryRemoved?, location?, locationKind?,
    inStoryDate?, elapsedSeconds?, clockTime?: {hour,minute},
    scenePace?, worldPoint?, chapter?, scene?, sceneCast?
  },
  imageWorthy?: boolean,
  beat?: { kind: 'exchange'|'instruction'|'remark'|'action'|'travel'|'combat', with: string[] },
  fightOptions?: string[],
  entities?: [{ entityId?, isNew?, name, age?, role?, personality?, speechStyle?, mood?, appearance? }],
  bonds?: [{ entityId?, character, affinityDelta?, status?, note?, isMajor?, relationship?, attraction?, romanceNote? }],
  facts?: [{ action, type?, text, subject?, whoKnows?, validFrom?, ... }],
  threads?: [{ action, title, description?, type?, participants? }],
  timelineCompleted?: string[], timelineEngaged?: string[], timelinePassed?: string[],
  newsRelayed?: [{ id, from? }],
  lettersSent?: [{ entityId?, name, gist?, text?, carrier?, coded? }], lettersReceived?: [{ entityId?, name, text? }],
  lifeEvents?: [{ entityId?, name, text }], epithet?: { audience, name },
  consequences?: [{ kind, entityId?, who, what, want?, witnesses?, faction?, when? }], consequencesReturned?: string[],
  birthdaysLearned?: [{ entityId?, name }], weather?: string, flashback?: 'offered'|'started'|'ended',
  safehouse?: { id?, name?, kind?, paidNights?, host?, stored?, taken?, upgrade?, shownTo?, residentsJoined?, residentsLeft?, ended? },
  money?: [{ amount /* world currency, negative when the player pays */, reason }], moneyCounted?: number,
  reputation?: [{ faction /* faction id */, change, reason }], bountySeen?: string[] /* faction ids */,
  companionsJoined?: [{ entityId?, name, reason? }], companionsLeft?: [{ entityId?, name, reason? }],
  scene?: { ended, summary?, tags?, entities?, importance? }
}
```

Note: the state model returns **snake_case** JSON matching `TURN_STATE_SCHEMA` (`lib/rpg/stateSchema.ts`): flat `location`, `time.elapsed`, `affinity_change`, `characters_present`, `character_updates`, `scene_ended`, `image_worthy`, `news_relayed`, `timeline_completed`, … Strict mode means every field is always present, with `null` / `[]` for “unchanged”. `convertStateBlock` (`stateBlock.ts`) ignores those and translates the rest → `TurnDiff` camelCase. It still accepts the older nested `state: { location, … }` shape.

---

## 4. Turn lifecycle

Main file: `lib/rpg/game.tsx` (`GameProvider`).

### `sendTurn(input)`

1. Validate API key and action text.
2. Snapshot the database (undo).
3. Append the player message to `rawLog`.
4. `buildNarrationPrompt(db, action)` → messages + estimated tokens. The narrator prompt contains **no JSON instructions and no timeline ids**; it only asks for prose and for time, place, people and outcomes to be legible in it.
5. **Call 1 — narrator.** `streamChatCompletion` (SSE) with the story model. Text streams to the screen live (`streamingText`, throttled to ~60 ms; `streamingPreview` hides anything from a stray ``` or `{"` onwards). The player's line is shown meanwhile via `pendingAction`.
6. `stripNarrationJson` runs once on the final text as a safety net only. If the finish reason is `length` or the prose ends mid-sentence, it is trimmed to the last complete sentence (`trimToSentence`). There is no continuation request.
7. Snapshot + append the player and assistant messages onto the **latest** copy of the slot (`updateLatest`), not the copy the prompt was built from.
8. **Call 2 — state.** `runStateStep(...)` starts in the background; the next turn, undo and regenerate wait for it.

### Saving a turn: two phases (`lib/rpg/memoryJobs.ts`)

**Phase 1 — state step (`runStateStep` → `applyStateStep`)**, saved immediately:

1. `extraction = extractTurnDiff(...)`: the memory model (`settings.extractionModel`, a cheap one) gets `buildExtractionPrompt` — `STATE_SYSTEM` rules, current state/characters/bonds/facts/threads, `TIME BEFORE THIS TURN`, `TIMELINE TRACKING` (active/personal beat ids and the offered news ids with the rule for each), `LETTERS` (the letters_sent rule, and the offered letter's sender id), the previous beat for context, then this turn's player line and prose. It is sent with OpenRouter structured output (`response_format: json_schema`, `strict: true`, `provider.require_parameters: true`). If no provider for that model supports it, `completeChat` falls back to `json_object`, then to a plain reply; `parseJsonObject` + `convertStateBlock` read whatever comes back. If the call fails, a `state` job is stored as pending and nothing else changes; an unreadable reply applies `null` (the prose clock parser still runs).
2. **Narration clock**: `detectNarrationTime`, pace via `extraction.state.scenePace ?? inferScenePace`, then `resolveTurnClock(...)` returns the one forward step for the turn (largest of reported, parsed and the pace minimum; combat cannot skip days; a full night's sleep jumps to morning). The diff carries only that `elapsedSeconds`; the applied seconds are stored on the reply as `rawLog[].elapsedSeconds` for the time chip.
3. `applyTurnDiff` (`services.ts`) in this order: state + clock (`clock.ts`), entities (`entities.ts`), revivals and deaths (`deaths.ts`), companion joins/partings (`companions.ts`), bonds incl. romance (`bonds.ts`), facts and threads (`facts.ts`), scene event (with companions) + shared-scene bond step, duplicate merge, presence (companions always included), stall counter.
4. `applyTimelineMarks` → `markNewsHeard` (up to `newsAllowance(latest)`: 1, or the size of the catch-up report the prompt offered) → `advanceTimeline` → letters: `receiveLetters` → `sendLetters` → `deliverLetters`.
5. Queue follow-up jobs in `db.memoryJobs`:
   - `timeSkip` if `daysBetween(before, after) >= 180`,
   - `scene` when `imageWorthy`, `scene.ended`, or `storyMessagesSinceLastSummary >= autoSummarizeThreshold`. It covers only story messages no chapter summary covers yet (`unsummarizedStory`, oldest first, up to 16; at least 4 unless the scene ended). A pending scene job is re-pointed at those instead of stacking a new one.
6. Commit. The clock, bonds, facts and timeline are now saved.

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

### System message (three cacheable blocks)

1. **Rules** — `NARRATION_SYSTEM`, identical on every turn of every story (~1.3k tokens):
   - **CORE** — never control the player, place-name rule (English names), date/rank/knowledge discipline, supplied context is truth, binding threads.
   - **TIME** — TIME block is the only date, relative time only, durations made explicit and honest.
   - **REALISM** — the real world at its time and place: no magic, powers or supernatural events; technology, money, medicine, travel and customs fit the era; injuries heal at real speed.
   - **WORLD TIMELINE** — never invent a world event, death or date; news only through bearers; in a known setting stay true to it as far as WORLD says; someone with several identities is one person whose card says which identity is in use.
   - **NAMES** — narration uses only the names the player knows; strangers keep one description; characters say names aloud as they would, each with the name they know; a name the player says that he couldn't know gets a reaction (§8i).
   - **STYLE** — plain English, 2–4 paragraphs, no repeats, rare encounters, new characters, the player's `"speech"` / `*action*` markers.
   - **ROMANCE** (from `romance.ts`): only someone whose heart is open to the player becomes a romance; romance and intimacy only between adults (18+, stated age); rejections hold by default but can slowly thaw when the story earns it.
   - **OUTPUT** — prose only, changes legible in the prose.
2. **What the player wrote** (`lib/rpg/worldBlocks.ts`) — **THE WORLD** (`formatWorldBlock`: name, premise, genre, tone, when/period/what exists, known setting and how strictly to follow it, money and prices, how messages travel, groups with their territory, areas with places and travel times, the player's own narrator notes) and **WHO YOU ARE** (`formatWhoYouAre`: the `CharacterDefinition` as prose, the backstory verbatim, secrets marked narrator-only). Plain prose, no ids (invariant 2). They change only when the player edits the world or the character, so the cache holds (invariant 10).
3. **Slow context** — `formatStorySoFar` (latest arc summary + up to 3 newest chapter summaries the arc doesn't cover, never fewer than 2), `formatThreads`, `formatBonds`, `formatTheDead` (everyone dead, flagged when the player does not know yet). Changes only when a summary lands, a thread or bond moves.

Each block is sent as a text part with `cache_control` for models that need explicit breakpoints (`anthropic/`, `google/`, `qwen/` — see `toWireMessages` in `lib/openrouter.ts`; Gemini uses only the last one). Other providers (OpenAI, DeepSeek, …) cache a repeated prefix automatically and get plain string content. `OpenRouterMessage.content` is always the full text; `parts` is only the split.

### Dynamic user block (in order)

1. `formatState` (date, place, mood, world, inventory, purse, world point)
1a. `formatCompanions` — `TRAVELLING WITH YOU`: each companion, how long together, why/where they joined, shared scenes, how they feel (only when someone travels with the player). Their character cards are always in `CHARACTERS IN SCENE`, companions first.
2. `formatTimeLine` — `Year 13 · Day 4, October · 9:40 PM` plus a nudge to state durations once `turnsWithoutTimeChange >= 2`
2a. `formatWeatherLine` — `WEATHER (the Land of Rain, late autumn; it almost never stops raining here): steady rain. …` with what it does, shaped by the mode (§8d)
3. `formatMatchedEntities` (with lore hearts + era notes), `formatFacts` (≤10), `formatLore`
4. `formatNewsBlock` — `newsOffer`: the next unheard event (or one catch-up report), with location, bearers in the scene first, the living fallbacks, this turn's delivery style and urgency (none in combat)
4a. `formatLetterBlock` — `A LETTER FOR YOU`: a reply that has arrived, or an unprompted letter (none in combat or during a catch-up report)
5. `formatUpcomingWorldBlock` — planned world events in the next ~10 days (“RUMORS OF WHAT'S COMING”)
6. `formatTimelineBlock` (WORLD TIMELINE) — recent heard world events, pending personal beats (“do not assume”), active beats + encounter context, recently concluded; "the world is quiet" when the timeline is empty
7. `formatMemories` — retrieved events (≤ retrieval limit, 400 chars each), skipping any that repeat a summary already in STORY SO FAR
8. `formatRecentMessages` — last `contextMessages` (default 16). The newest narration keeps its last 2200 chars; older narrations keep their **start and end** (`headAndTail`, 1400 chars: ~40% opening, ~60% ending); player input 500 the same way
9. `formatLastBeat` — final 450 chars of the newest narration
10. `formatEncounterConditions` — place kind, hour and how crowded it is
11. `formatReturningCharacter` — occasionally, “A FAMILIAR FACE (optional)”: one original character the player has not seen in a while who fits the current place (see §9)
12. `CONTINUITY` line + location kind
12a. `formatSceneModeLine` — `SCENE MODE: …` (conversation with whom / talk is building / the conversation ends / fight, with the player's current wounds and conditions / normal narration chosen by the player). Absent on plain normal turns. See §8a.
13. `YOU DO OR SAY: <action>`

There is no dice roll and no repeated-word list. Encounter frequency comes from the STYLE rule (rare, must fit the conditions, never two in a row) plus `ENCOUNTER CONDITIONS`; freshness comes from the STYLE rule against reusing descriptions and the `CONTINUITY` line. (Both blocks were removed: the roll added random events that fought the story's pacing, and listing overused words put those words back in front of the model.)

The current action appears **once** (it is excluded from the recent-message block).

### Token budget

`settings.promptTokenBudget` (default 9500; Settings → Advanced → Story context offers 6k / 8k / 9.5k / 12k). After building, the prompt drops the oldest scene messages (never below 4) until `estimateTokens` is under budget.

### State prompt (call 2)

`buildExtractionPrompt` puts `STATE_SYSTEM` first as its own cacheable block (field-by-field rules: time, place, people, memory, timeline, money, reputation, image) and runs after **every** turn against `TURN_STATE_SCHEMA`. The timeline ids the narrator never sees are given here (TIMELINE TRACKING), each with the rule for marking it; faction and region ids are listed so the tracker can reference them. News and timeline blocks in the narrator prompt describe events in plain words only.

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
- Events (memories) are created by `recordSceneEvent` (on `scene.ended`; raw prose titled with the scene's name until replaced), by **every chapter summary** (`saveSummaryMemory` in `memoryJobs.ts`: tagged `summary`, `title` from the summary, `summary` = the model's one-to-two sentence MEMORY line, `summaryId` back to the chapter summary, linked as `present` to everyone in the scene cast on the turns it was written from (never to people it merely names), folding in the scene-end events made on those same turns), time skips, and world timeline events.
- **One memory, one scene**: `applyStateStep` stamps each turn's two story entries with `sceneSeq` and `sceneCastIds` (the scene cast's entity ids). `state.sceneSeq` moves on the turn after `scene_ended`, or on a turn whose `location` changes. `queueSceneJob` only ever takes the oldest scene's stretch (`firstSceneStretch`), so a summary never spans two scenes; once it lands, a finished scene waiting behind it is queued next. Scene-end events carry `turnLogId`, and a summary takes in only the ones whose turn it was built from (its `sourceLogIds`), never by time. The bond page (`sharedMemories`) shows only `present`/`participant` links. `formatMemories` gives the narrator the full chapter summary behind a `summaryId`.
- The scene name moves through the state schema's `scene_title` (only when a new scene starts) → `state.scene`.
- Summaries: chapter summaries feed the arc summary; the latest arc plus the newest chapters feed the prompt. `storyMessagesSinceLastSummary` is the summarization cadence guard.

### Entity identity resolution (`entities.ts`)

- `resolveEntity(db, name)` — exact name or visible alias only (titles and honorifics allowed: "Dr. Okafor", "Mrs. Vance"). Descriptions ("the masked man", "the leader", "the woman" — `isGenericDescription`) never match and never become a person.
- **Identities** (`EntityRecord.identities`, §8i) replaced the old hidden aliases: an identity the player hasn't learned (a real name behind a stage name, an alias) is never matched in story text or shown; once they learn it (`learnFromTimeline`, the tracker's `names_learned`) it becomes an alias, first word included. The narrator sees it only as a narrator-only truth on the person's card; the state tracker sees every identity in KNOWN CHARACTERS. Timeline deaths (`markDeathsByName`) use identities, never a name another person owns (`alias: false` on a claimed identity).
- `mergeDuplicateEntities` runs on every turn; it and the manual merge both use `mergeEntityPair`, which folds one person into another (names become aliases, bonds combined, facts/event links/threads/scene cast moved).
- **Only the scene cast meets people**: `met: true`, `lastSeen` and `lastSeenAt` come only from `characters_present` (plus companions), via `recordPresence` and `settleNewlyMet`. People from `new_characters` start `met: false`, "Not yet met". Character updates, facts, bonds and grudges never meet anyone; a bond, grudge or companion join for someone unmet who isn't in this turn's cast is ignored (`presentIds`). The prose fallback only suggests a cast (`suggestedCast`), never applies it.

### Duplicate characters

- **Who is in a save**: the player, plus one entity (and a bond) per `StartingPerson` the player wrote, plus everyone the story introduces. There is no built-in cast. The state tracker's KNOWN CHARACTERS roster leaves out people in the background (unmet and long dead) to stay short; when a turn names them they appear with their id under CHARACTERS IN THIS TURN. A new person (`is_new`) only matches an existing one by an exact name or visible alias.
- **IDs for the state tracker** (`characterRefs.ts`): the extraction prompt lists `KNOWN CHARACTERS` as `- mara-vance: Mara Vance (Mara) [not met yet]` (cached part), plus `CHARACTERS IN THIS TURN` details (dynamic part). IDs are slugs of the current name, `-2` on collisions. The schema uses `bonds[].character_id`, `character_updates[].character_id`, and IDs in `characters_present`, `facts.entity/who_knows`, `news_relayed.from`.
- **Only `is_new: true` adds someone**: `new_characters[]` entries need `is_new: true`; `false` is dropped. `resolveCharacterRefs` (run in `extractTurnDiff`) maps each reference to a person: known ID → exact new name from this turn → name/alias fallback → otherwise dropped (a bond or update for an unknown ID never creates a person). A "new" person whose name resolves to someone known becomes an update.
- **Name mentions** (`mentionsName` / `mentionsEntity`): whole-word, Unicode-aware; names that are also everyday words ("Hope", "Will", "Rose") must be capitalized. Used for narrator scene cards, retrieval, the image cast fallback and memory tags (never memory links), so "asleep" never finds "Lee" and "Banana" never finds "Ana".
- **Merge with…** on the bond screen (`components/player/MergeSheet.tsx`, `mergeCharacters` in `game.tsx`): pick the other person (likely duplicates by shared name words first), choose which name to keep, merge.

---

### 6a. Companions (`companions.ts`)

A companion is someone travelling with the player: `EntityRecord.companion` is set until the story parts them.

- **Joining / leaving**: the state tracker's `companions_joined` / `companions_left` (`character_id`, `reason`). It sees `TRAVELLING WITH YOU: <ids>` in the dynamic block, `[travelling with the player]` in `KNOWN CHARACTERS` and `CHARACTERS IN THIS TURN`, and the COMPANIONS rule in `STATE_SYSTEM` (scouting ahead or sleeping in the next room is not leaving). Someone added under `new_characters` can join the same turn. The player, the dead and a full party (`MAX_COMPANIONS` = 4) never join. Joining creates a bond if there is none and a fact; parting ends the flag, records "parted ways after N days together (reason)" and takes them out of the scene cast. Death ends it automatically (state tracker, canon, or **Mark as dead**).
- **In every scene**: `castWithCompanions` puts them first in `sceneCast` on every applied diff, presence (`lastSeen`/`lastSeenAt`) is stamped for them, and scene-end memories link them, so they show under Shared memories and in images. The narrator gets a CORE rule (in the cached rules) that anyone under TRAVELLING WITH YOU is present every turn with their own voice and only leaves when the story makes it happen.
- **Bond moves with shared events**: the state tracker is told to give companions a `bonds` entry whenever shared events move their feelings (fighting side by side, being protected, secrets, arguments, betrayal). On top of that, `applySharedScene` runs when a scene ends: `sharedScenes += 1`, and if the story did not move that bond this turn, shared time adds `bondPoints` (1, or 2 after combat/chase); every `BOND_POINTS_PER_STEP` (3) points lift affinity by 1 — never above `SHARED_TIME_AFFINITY_CAP` (+6) and never when affinity is below `SHARED_TIME_AFFINITY_FLOOR` (−2), so time alone builds familiarity but cannot fix real hostility. A bond the story moved resets the points.
- **UI**: Bonds lists companions first under "Travelling with you"; the bond screen shows a chip, how long and why, shared scene count, and **Travel together / Part ways** for corrections (`setTravelling` in `game.tsx`); the Story status sheet lists who is with you.
- Not offered as "A FAMILIAR FACE" (`returning.ts`), since they never left.

### Deaths (`deaths.ts`)

A death lives on the person's own record (`EntityRecord.deceased: { date?, cause?, known?, timelineEventId? }`), not only as a fact, so it is never lost to the 10-fact cap.

- **Timeline**: an event's `deaths` are marked when it fires (`fireEvent` in timeline.ts), stamped with its event id (`timelineEventId`). The player *knows* once that news is heard (or he witnessed it); until then the bonds screen shows them as before, so news is never spoiled.
- **Story**: the state tracker's `deaths[]` (`character_id`, `cause`) marks anyone who dies on screen, whose body the player sees, or whose death he is told of — known at once. `revived[]` undoes it for a true return to life  and tags the person `revived` so loading never kills them again.
- **Seeded**: people the player marks "died before the story" start dead and known.
- **Prompts**: narrator gets `THE DEAD` every turn plus `[DECEASED]` on scene cards and bonds, with the rule that the dead never appear alive; the state tracker sees `deceased` in `KNOWN CHARACTERS`.
- **Effects**: the dead never get `lastSeen` stamped; the bonds screen lists known dead under "The dead"; the bond screen has **Mark as dead / Mark as alive** for corrections (`setCharacterDeceased`).
- `normalizeDeaths` runs in `normalizeDatabase` and repairs death records.

---

## 7. World timeline (`timeline.ts`)

The player's own world events, in `db.world.timeline` (written by hand in the wizard, or drafted for a known setting in session 6). **Empty by default: then nothing here fires** and the narrator's WORLD TIMELINE block says the world is quiet. `timeline.ts` never hard-codes an event.

### Event shape (`TimelineEvent`, types.ts)

```ts
{
  id, era?, title, description, worldPoint?, artDirection?,
  from: {year, month, day?}, to?: {year, month, day?},
  regionId?, location?,            // where it happens (default: the world's name)
  knowledge?,                      // public (default) | faction | witnesses | secret
  factionId?,                      // for 'faction': whose members know
  bearers?,                        // named people who can carry the news
  major?, playerDriven?, priority?, after?, requires?, completesWhen?,
  facts: string[],
  deaths?: string[],               // people it kills, by exact name/alias
  setsStatus?: {name: status},
  encounter?: { who, where, context },
  attendanceFact?, opensThreads?, resolvesThreadTitles?
}
```

- `playerDriven` = **personal beat**: it **never fires by itself**; it is offered and fires only when the state tracker marks it.
- World events fire on the **in-story date + every earlier world event** — never on turn counts. A long time skip fires everything that came due, each stamped with the day it happened (clamped to the save's baseline).
- **Nothing fires during combat.** `advanceTimeline(db, { inCombat })` only sets `heldForCombat`; everything due fires on the first turn after the fight.
- Windows use the **real calendar** (`daysFromCivil`). Fired events are `EventRecord`s with id `event_timeline_<id>` and the `timeline` tag.

### Scheduling (`advanceTimeline`)

- `baselineDate` prevents a backlog dump on load/import.
- Events whose `to` closed before the baseline are completed **silently** and tracked in `expired`.
- Encounter windows go into `active`; personal beats appear in the prompt as pending offers.

### Tracker marks (`applyTimelineMarks`)

- `timeline_completed` → fire if needed, add `attendanceFact`, mark **witnessed**, record facts/threads/`worldPoint`.
- `timeline_engaged` → record the event, add to `active` + `engaged` (not completed).
- `timeline_passed` → complete without attendance, log a “never crossed paths” fact.

### News & rumors

- Every fired world event is **unheard** until delivered. `unheardNews` returns them most pressing first (major news weighs ×4, so old minor news is never starved).
- **One piece of news per turn** (`NEWS_PER_TURN`); none during combat.
- **Catch-up reports** (`newsDelivery.ts`): after a long quiet stretch with 2+ events piled up, the offer becomes one report covering several (a stack of messages, a friend catching them up). Secret and eyewitness news never travels in a bundle.
- **Knowledge classes**: `public`, `faction` (members of `event.factionId`), `witnesses`, `secret`.
- **Bearers**: anyone in the scene (scene cast + companions, alive) who could plausibly know comes first; then the event's named `bearers`; then a generic local or traveller for public news. The dead are removed (`livingBearers`).
- **Channels** (`timelineChannel`): the faction's own `carriers`, else `world.letterCarriers`; secrets only face to face from a named confidant; witness news only from someone who was there.
- **Delivery style**: one per turn, picked deterministically (slot + player turn + event) from the place kind and the knowledge class (gossip at the next table, a notice, a call, a message from the group itself…). Overdue news comes looking for the player.
- **Escalation** (`newsUrgency`): `due` → bring it in if anything fits; `overdue` → deliver it this turn, through the channel if nobody present could know.
- `news_relayed: [{id, from}]` records delivery (`heard`), and the Journal hides unheard events.

### Personal letters (`letters.ts`)

- Not world news: people the player is close to write about their own lives. Everything is delivered on the page, never as an app notification.
- **Unprompted**: once `LETTER_GAP_DAYS` (21) have passed since the last letter reached the player (or the story began), the warmest `correspondents` candidate writes: a met, living person with affinity ≥ 5 (or a close/romantic/partner stage), not travelling with the player, not in the scene, not seen for 10+ days, who has not written in 45 days and has no letter on the road.
- **The player writes**: `letters_sent: [{to, gist, text, carrier, coded}]` (someone not in the scene) sets out for as long as the distance and carrier take (§8c). When it arrives (`deliverLetters`, every turn): +2 affinity (+1 if they are cold toward him, +1 for a birthday letter), a fact that they received it, and — unless affinity is below −3 — a reply sets out the same way. Interception, real losses, letters to the dead and the archive: §8c.
- **Delivery**: `letterOffer` offers an arrived reply first (it waits while the writer is in the scene), else an unprompted letter; never in combat or during a catch-up report. The carrier comes from `world.letterCarriers` ("post", "courier", "text message"… fitting the era), with a default speed table (fast/normal/slow). After 5 days waiting, the offer is pressed. `letters_received: [id]` marks it read and sets `lastLetterIn`.
- The hidden world-clock screen lists letters on the road.

### World point

`state.worldPoint` is a free line on where the world stands; a timeline event with `worldPoint` sets it when it happens.

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

Living-world Stage 1. The narrator writes a turn in one of three modes: normal prose, **conversation** (mostly speech, short `*action*` lines, length follows the talk, several voices) or **fight** (what the player's move does, then the opponent's one specific next move, stopping before it lands; aftermath in normal prose when the fight ends). The rules for each live in `NARRATION_SYSTEM` (SCENE MODES, cached); each turn only gets one `SCENE MODE:` line.

- **Deciding the mode** (`resolveTurnMode(db, input)`, run inside `buildNarrationPrompt`, pure): The player's input is read by `readPlayerInput` (speech in quotes, an attack, a fight-back move, a scene-changing move like leaving, following, travelling, sleeping; negated attacks and words inside quotes don't count). Order: chip override `fight`/`normal` → a fight going on (`scenePace` combat or last beat combat, scene not closed) or the player attacking → override `conversation` → the player's scene-changing move (normal, with `ending: 'conversation'` for a short transition if a talk was on) → conversation once `exchangeStreak >= 2`, or `>= 1` and the player answers in speech → otherwise normal, **leaning** spoken when a talk has started or the player speaks to someone present.
- **The beat** (state tracker, BEAT rule): `beat` = exchange (talk, including small moves in place and silences), instruction ("follow me"), remark (a passing line), action (a scene-changing move), travel, combat; `beat_with` = ids of who the player talks with; `fight_options` = 3-4 short moves (verb first, no pronouns) while the fight goes on. The tracker also sees `SCENE MODE THIS TURN`.
- **After the turn** (`applySceneBeat`, in `applyStateStep`): exchange with overlapping people → streak +1 (people joining make it a group); different people → 1; instruction/remark break an unsettled talk but not a settled one; action/travel/combat/scene end → 0. Without a beat, `fallbackBeat` reads pace, input and quotes. `current` = the mode the reply used.
- **Saved on the reply**: `rawLog[].sceneMode` (set by `game.tsx` when the reply is saved) and `rawLog[].fightOptions` (only while the fight goes on).
- **Clock**: a conversation-mode turn at conversation pace has a 20 s minimum (`CONVERSATION_MODE_MINIMUM_SECONDS`, passed as `minimumSeconds` to `resolveTurnClock`) instead of 2 min. Fights keep the combat rules (15 s, no day skips, nothing fires mid-fight).
- **Chip override** (`setSceneModeOverride`, `useGame().setSceneMode`): Automatic / Conversation / Fight / Normal narration. Forced conversation lasts through travel and ends when a fight starts; forced fight ends when the fight does; normal holds until the current talk or fight is over, then automatic resumes.
- **UI** (Story): a mode chip above the composer, read live from what you are typing (Narration / Conversation / Fight, "· set by you", who it's with, "Talk is building"); tap → sheet with the four choices. While a fight goes on, the reply's fight options show as buttons above the composer; a tap sends `*<move>.*`. Narration renders `*…*` in italics.
- Tests: `scripts/scene-mode.test.ts`.

## 8b. Birthdays, anniversaries and festivals (`lib/rpg/yearly.ts`)

Living-world Stage 2. The narrator gets at most one `THE DAY` line per turn, never in a fight, and each offer at most once a year (`state.yearly.offered`: key → year, set by `applyYearly` in `applyStateStep` from the offer the turn's prompt was built on).

- **Order** (`yearlyCandidates`): the player's own days first (their birthday with who might remember it, the anniversary of a close person's death once they know it), then a birthday of someone in the scene, then remembrance days of the dead they were close to, then `world.festivals` and New Year where they are, then (some years, by hash) a close person's birthday far away.
- **Who the player knows** (`knowsBirthday`): anyone with affinity ≥ 6 or a close relationship, and anyone in `state.yearly.knownBirthdays` (the tracker's `birthdays_learned`). Only those are given as the player's own knowledge.
- **Habits**: `birthdayHabit` returns a neutral habit for everyone (no built-in data); the narrator plays each person from their personality.
- **Bonds**: the tracker gets a `THE DAY` line for a present birthday: +1 for remembering it, +2 for a real gift, -1 for letting it pass beside them.
- **Festivals** (`world.festivals`, `festivalsOf`): the player's own, matched to where they are. None by default.
- **UI**: an "Upcoming birthdays" card on the bonds list (next 30 days) and a "Today" row on the Journal's Now view (`todayNotes`).
- Tests: `scripts/yearly.test.ts`, `scripts/living-world.test.ts`.

## 8c. People and consequences (living-world Stage 3)

Five systems that build on each other. Each only reaches the narrator when it matters this turn, in a line or two. Tests: `scripts/living-world.test.ts`, `scripts/enemies.test.ts`.

**Geography** (`geography.ts`): the world's regions and the travel days between them (`world.regions[].neighbours`, shortest path). `regionOf(text)` reads a place; `whereaboutsRegion(entity)` = what the story said (`whereabouts`), else where the player last saw them. Used by letters, rumours and consequences.

**People with their own lives** (`lives.ts`, section 8)
- `advanceLives` (every turn): side characters the player has met (`isSideCharacter`: anyone not on the world timeline's path, `onTimelinePath`) get a small `world` life event every 60–150 days while the player is away: a hard week at work, an injury, a move, a new job. People on the timeline's path only get events that can't change it. Deterministic per save and person; 8 kept each.
- `life_events` (tracker): things the page said about someone's own life are kept as `story` events.
- **Reunions** (`markReunions`, after the state step): meeting someone again after 30+ days apart sets `entity.reunion`. The next narrator turns get a "since you last saw them" note on their character card (`sinceYouLastSaw`, at most 2 per turn): fired timeline events that name them, their life events since, and room for one small change of the narrator's own (which the tracker then keeps). Those events become `known`.
- A letter can carry news of the writer's life (`newsOfTheirLife`), which marks it known.
- UI: a "Their life" list on the bond page (known events only).

**Better letters** (`letters.ts`, section 9)
- **Travel time** (`letterDays`): travel days between the player's region and the reader's × the carrier's speed (instant 0 — a call or a text —, fast 0.5, normal 1.2, slow 1.8; carriers from `world.letterCarriers`) plus a small jitter; a few days when either end is unknown.
- **The player's words** (`tidyLetter`, `keepPlayersWords`): the tracker passes the letter as written; the app fixes spacing, capitals, "i" → "I" and a closing full stop, never wording or tone. Replies keep the words the narrator gave the writer (`letters_received[].text`).
- **Archive** (`letterArchive`): the Journal's Letters view, newest first, tap to read the whole letter; "Never sent" below. 200 letters with words and 40 without are kept.
- **Interception** (`interceptionRisks`, rolled once per letter): a faction that reads mail (`FactionDef.readsMail`, 0–1) on whose ground the reader is, or one that has the player wanted. Hand delivery and codes are safer. An interception plants an `intercepted` consequence.
- **Real losses** (`lossOnTheRoad`, when due): it went astray (grows with distance and slower carriers; an instant message only fails to go through), the reader moved on (their region changed since it set out), or the reader died.
- **Letters to the dead**: `unsent`, kept, never delivered, no reply.
- **Birthdays**: someone close and far away who knows the player's birthday writes for it once a year (`birthdayWriter`); a letter the player sends within 3 days of a close person's birthday is a birthday letter.
- The world-clock screen shows each letter's carrier, coded, and who read it.

**Rumours, posters and the player's name** (`renown.ts`, section 10)
- **Deeds** (`recordDeeds`): every `reputation` change the tracker reports is kept as a deed with where, when and whose people saw it (last 40).
- **Epithets**: each audience (each faction, plus ordinary people, `COMMON_AUDIENCE`) names the player after the theme its deeds weigh most (12+ weight), never one the player picks. A new theme renames them only when it leads by 25% and the old name has stood 120 days; old names go to `history`. A name the story gives them (`epithet` from the tracker) sticks for that audience and is `known`. Seeing a wanted notice (`bounty_seen`) teaches that faction's name.
- **Narrator**: one line in YOUR NAME OUT THERE with what strangers here call him (`localEpithet`, by territory), the wanted-notice line (`posterLine`: where a faction that has the player wanted holds the land; the picture poor at first, good at the top), and now and then (1 turn in 5, places where people talk) an optional TALK OF YOU rumour (`rumourOffer`): a deed whose news could have reached here by now, close to the truth nearby, grown with distance, a monster story far away.
- UI: "What they call you" on the Journal's World view (known names only); wanted rows show that faction's name for the player.

**Delayed consequences** (`consequences.ts`, section 11)
- **Seeds**: the tracker's `consequences` (spared, lie, helped, witness, betrayal, humiliated, promise, debt; who, what, want, witnesses, faction, when) plus interceptions. `when` sets when it can first return: weeks (14–41 days), months (45–164, the default), years (300–899); it fades `max(120, 3 × that)` days later.
- **Coming back** (`canReturn`): only once the window opens, only if the person is alive, and only where it is realistic: lies, betrayals, promises and debts face to face (the person in the scene); spared or humiliated people on a road or in a town within 2.5 days of where they are; help repaid in the same region; an interception with someone from that faction present. A **witness** doesn't need to find the player: when the time comes, they talk and that faction's heat rises (`advanceConsequences`). Seeds fade when the window closes or the person dies.
- **Offer**: one optional SOMETHING COMES BACK line (`turnConsequenceOffer`), never in a fight, pressed after 90 days eligible; people on the timeline's path carry "they stay on their path; this changes only how they see you". The tracker marks it `consequences_returned`.
- **No notice**: nothing tells you a choice landed; the people involved simply remember it (the seed, the bond, their point-of-view memory).
- UI: a "Could come back" list on the hidden world-clock screen.

**Point-of-view memories** (`povMemories.ts`, section 12, fix 29)
- No extra call: the scene summary asks for one line per person it mattered to (`povCandidates`: present, alive, not minor, a major bond, |affinity| ≥ 5 or a companion; up to 3), in their voice, to the player as "you", limited to what they saw or heard. Stored as `EventRecord.povs`.
- The narrator gets each person's latest line on their character card ("remembers of you"). It is their inner view, so it is never shown on the bond page.

**Prompt size**: on a quiet turn nothing new reaches the narrator; the 60-turn token sample settles at about 6,770 (6,670 after Stage 2).

## 8d. The world around the player (living-world Stage 4)

Tests: `scripts/living-world-stage4.test.ts`.

**Seasons and weather** (`weather.ts`)
- Seasons from the month (Dec–Feb winter …), named as people there would say it (`seasonLabel`): "the rainy season" or "monsoon heat" for those climate types, "a deep winter" for continental and tundra, "early/mid/late <season>" elsewhere.
- Each region has a `ClimateType` (`RegionDef.climate`; `climateOf`, temperate when unset). `CLIMATE_TYPES` (weather.ts) has one entry per type: weights per season (per month for the rainy and monsoon types), how long spells last, and a note. The desert never snows; tundra and continental are snowy in winter. `none` (indoors, underground, a station) has no weather at all: no WEATHER line.
- `weatherAt(seed, region, date)` is deterministic per save (`meta.slotId`), region and 6-hour block. Spells are walked forward from a fixed anchor every 4 days (2 days of warm-up), each block keeping the last one's weather with the region's persistence (0.78 by default), so neighbouring hours agree and the sky changes about once a day or less. Fog gathers around dawn; summer thunder builds in the afternoon.
- The region is `currentRegion(db)` (`geography.ts`): the one the location names, else the last region on the player's road, else the world's first region (or none).
- **Held for the scene** (`state.weather`, `applyWeather` after every state step): a new scene holds the world's weather; the same scene keeps it (up to 12 h). The tracker's `weather` (a few words, only when the prose changes it from WEATHER NOW) is read by `conditionFromText` ("the rain stops" → overcast, "thunder" → storm, "the fog lifts" → clear) and holds 8 h in that region, across scenes. Another region always gets its own weather.
- **Narrator**: one WEATHER line after TIME (`formatWeatherLine`): region, season, climate note, the weather at this hour (clear nights, cold desert nights), and by mode: normal → how much slower travel is (`CONDITION_INFO.travel`: rain ×1.25, snow ×1.4, sandstorm ×1.8, blizzard ×2), tracks and scent, footing, feel; fight → footing, sight and sound only; conversation or indoors → just the feel ("outside, steady rain"). A STYLE rule says weather follows that line all scene. About 80 tokens.
- **Tracker**: `WEATHER NOW` in the state prompt, the `weather` field in `TURN_STATE_SCHEMA`.
- UI: the Story header's icon shows the weather (sun/moon when clear); the status sheet has a Weather row.

**Places and the road** (`mapData.ts`, `components/player/MapSection.tsx`)
- No coordinates and no drawn map (a drawn map is a session 7 extra). `placeIdOf(db, location)` matches `world.places` by name in the location text; `mapPlace` returns the `PlaceDef`.
- **Travel days** (`geography.ts`): `travelDaysBetween` walks `world.regions[].neighbours` (shortest path); pairs with no path get `UNKNOWN_DISTANCE_DAYS`. `travelEstimate` gives the days from the player's region, and the same in the worse weather of the two ends.
- **The player's road** (`state.travelLog`, `recordTravel` after every state step): each new location once, with its region (a place that names none stays in the last one) and place id; 400 kept. `placeVisits` counts visits.
- **Where people are, as far as the player knows** (`knownWhereabouts`): met people; companions are with them; otherwise what the story said (`whereabouts`, "told"), else where they last saw them (`lastSeenAt`, "seen"), else "assumed". Someone who died without the player knowing is still shown where they think they are. It is never the truth the save holds.
- UI: You tab → **Map**: a list view — you are here (place, region, weather, season, companions), regions with their places and visits, travel time, people as far as you know, and your road (newest first). Your places and former places (§8g) sit under it.

**The scrapbook** (`scrapbook.ts`, `components/player/ScrapbookView.tsx`)
- Read from the story log, nothing stored twice: every assistant reply with an `image`, oldest first, grouped by era (`eraOfDate`: the era of the last world timeline event that had begun by then, never moving backwards; one era when the timeline is empty) and chapter (title from `state.chapters` or the current chapter).
- Each photo: the caption (`imageMeta.caption`, written in second person by the same call that writes the image's action line; older images use the reply's first sentence, which the narrator already writes as "you"; the third-person action line is never rewritten into a caption), the in-story date and time, the player's age, and where he was (`placeAt`, from the road).
- UI: The player tab → Journal → **Scrapbook**: era headers with counts, chapter titles, a three-column grid; tap for a full view with caption, date, age and place, and earlier/later buttons.

**Prompt size**: one WEATHER line (~80 tokens) per narrator turn, and two short lines in the state prompt; nothing else new.

## 8e. Ambient sound (living-world Stage 5)

Tests: `scripts/ambience.test.ts`.

Ambience only: no music, no stingers, no recordings. Every sound is synthesised live with Web Audio from noise and oscillators, so nothing is downloaded or licensed, nothing ships with the install, and no loop ever repeats. Web only; on native the player does nothing. The narrator's and the tracker's prompts are untouched.

**The mix** (`lib/rpg/ambience.ts`, pure)
- `ambienceInputOf(db)` reads what the app already tracks: the scene's weather (`currentWeather`, so a held or story-set weather sounds the same as it reads), the time of day and hour, the season, the region's climate type, the location kind (`locationKindOf`), the location text (the scene title is ignored) and its place (`placeIdOf`) with its kind, and whether the scene is in fight mode.
- `ambienceMix(input)` returns a level 0–1 for each of 20 beds, plus `indoors` and `fight`:
  - Weather: `rain-light`, `rain-heavy` (by intensity; drizzle → downpour), `rain-roof` (instead of rain when indoors), `storm` (thunder rolls every 18–45 s), `wind-light` (a little wind on roads and in the open even on calm days), `wind-strong` (wind, storms, blizzards, sandstorms), `wind-high` (mountains, passes, cliffs; blizzards), `snow-quiet`.
  - Life: `forest-day` (birds: louder at dawn, fewer in winter, rain, fog and on roads, gone in heavy rain), `forest-night` (crickets and an owl; evenings fade between the two; no insects in winter), `cicadas` (summer afternoons in temperate, monsoon, tropical and coastal climates). Never in the desert.
  - Water: only when the location names a river, stream, sea or falls, plus a little sea in coastal climates outdoors (never keyed to fixed place ids).
  - People and places: `village` (street voices, footsteps, wood knocks; markets, ports and festivals louder, nights near silent, heavy weather empties the street), `murmur` (inside an inn, teahouse, tavern or bathhouse), `room` (room tone), `fire` (a hearth, fireplace or campfire, or a camp in the wilds at evening and night), `cave` (dripping stone with an echo).
- **Indoors** (`isIndoors`): the location's own words (room, inn, house, hut, tent, hideout, hall… vs courtyard, street, roof of…), else a `structure` kind. Caves count. Indoors, outside beds drop (wind ×0.35, life ×0.3 or nothing in a cave, water ×0.45) and go through a low-pass.
- **Fight mode** adds nothing and changes no bed: it only sets `fight`, and the player lowers everything to 30 %. The weather stays.
- `key` is a stable string of the mix; the player ignores a new mix with the same key, so a quiet turn changes nothing.
- A flashback (§8f): `currentAmbience` reads `flashbackView(db)`, the memory's date, place and weather, so it never touches the present scene.

**The player** (`lib/audio/`)
- `synth.ts`: the 20 bed builders, three 7-second stereo noise buffers (white, pink, brown; seams cross-faded) made once, and small helpers: steady filtered noise layers, `drifter` (wanders a gain or a filter frequency), `striker` (struck noise for raindrops, crackles, footsteps, one envelope at a time per voice), `tone` (bird notes, bubbles, drips, hoots, a cup set down). Events are scheduled 0.6 s ahead by each bed's `tick`. **Only linear and exponential ramps are chained**, never `setTargetAtTime` (implementations disagree on chained targets), and every parameter is anchored with `setValueAtTime` when made.
- `ambienceEngine.ts` (`AmbienceEngine`, one per app): bed → bed gain → outdoor bus (low-pass, 18 kHz outside → 650 Hz indoors) or indoor bus → fight duck → volume → speakers. A mix change glides every bed to its new level over 4 s (`CROSSFADE_SECONDS`), so place, weather and time of day crossfade, never cut. Levels are squared for loudness and evened out by `BED_TRIM`. A bed silent for 10 s is stopped to save battery. The volume curve is squared too.
- `AmbiencePlayer.tsx` (mounted in `app/_layout.tsx` inside `GameProvider`, renders nothing): builds the audio graph on the first tap or key press (browsers require one), feeds `currentAmbience(db)` whenever the save changes, pauses at once when the app goes to the background (`visibilitychange`, `pagehide`) and resumes when it comes back.
- `ambienceSettings.ts`: on/off and volume (default on, 60 %), kept on the device in AsyncStorage (`frbddn.ambience.v1`), not in a save, so every story shares them.
- Levels were checked by rendering each bed offline (40 s): all finite and unclipped, roughly −22 dB (waterfall) to −36 dB (room tone) RMS at full level.

UI: Settings → **Sound**: Ambience switch (its line says what's playing now, e.g. "Now: rain on the roof, a quiet room, voices") and a Volume slider (`components/Slider.tsx`) that changes the sound live while dragging.

## 8f. Playable flashbacks (`lib/rpg/flashbacks.ts`)

Living-world section 19. Short scenes from the player's life before the story. Offered, never requested; each plays once. **The records live in `db.world.flashbacks` and are empty by default**, so nothing is offered until the player writes some (or approves drafted ones, session 7). Tests: `scripts/flashbacks.test.ts`.

**Data** (`FlashbackRecord`): id, title, date, place and location kind, cast (entity names), the scene, notes on how people were then, triggers (`people`, `places` by place id or words, `dates`, `beats` reached in the last 7 days, `words`, `afterFight`), what is fixed, what must stay hidden, `requires`, a one-line memory and its importance. `ensureFlashbackPeople` adds a cast member who isn't in the save yet (dead and met) the first time a memory needs them.

**Offer** (`flashbackOffer`, inside `buildNarrationPrompt`): never while one plays or waits, never in a fight, a chase or on the road (pace downtime or conversation only), never on a turn with a grudge, hunter or other pressure, not before story turn 12 or in the story's first 3 days, and at most once per 30 in-story days (`lastOfferOn`). Each record scores the moment (date or beat 3, place or person 2, words 2, or 1 + 1 after a fight for the `afterFight` ones; people and words only count after a fight there); 2 is enough, the highest wins. A date trigger fits within 2 days of its day; a world beat counts from the day the player heard it. The narrator gets one optional `A MEMORY` line (let one small trigger touch the player, don't start the memory); `game.tsx` stamps the reply with `flashbackOffer`.

**Taking it**: the state step marks the offer (`applyFlashbackMarks`): the month gap starts either way; if the tracker says `flashback: "offered"` (the reply showed the trigger), it waits as `pending` for 2 turns and the reply gets a **Remember** chip. Tapping it calls `sendTurn(REMEMBER_INPUT, { remember: id })`, which runs `beginFlashback` on the snapshot it saves (so Undo undoes it) and narrates that turn inside the memory. The player can also follow it in his own words: the tracker's `"started"` begins it from the next turn. Regenerate re-enters a memory the regenerated turn stepped into.

**Playing**: `state.flashbacks.active` holds the memory's own clock, place, kind, weather, turn count, cast, bond nudges, and the present pace and scene mode to put back. Both story entries of a memory turn carry `flashback: { id, date }`.
- Narrator (`formatFlashbackBlock` instead of the present's dynamic block: no state, news, letters, timeline, pressure, encounters): the memory's date and the player's age, WHERE, its WEATHER line (`formatWeatherLine(flashbackView(db))`), THE PLAYER THEN (`playerThen(age)`: a child, a teenager, a young adult…; present inventory and money don't exist there), who is there at their age then (`entityAge` on the memory's date; the dead marked alive here), fixed facts, the hidden list, pacing by turn (begin → play → from turn 6 look for the end → from turn 9 end it this reply, carrying the player back to the same second), and THE PRESENT frozen with its last line. RECENT SCENE shows the present lead-in and this memory's turns (`getRecentMessages`). Fight mode works; its line leaves out the present's wounds.
- Tracker: THIS TURN IS A MEMORY (report the memory's time and place, who is in it, the dead included, bonds −1..1, everything else empty; `"ended"` when it closes), CURRENT STATE and TIME from the memory, no timeline/letters/yearly/enemy tracking.
- State step (`applyMemoryStep` → `applyFlashbackTurn`): `resolveTurnClock` on the memory's clock; place, kind, weather (`conditionFromText`), cast and bond nudges kept on `active`; scene beat and fight options as usual. Nothing in the present moves: clock, location, inventory, money, facts, threads, deaths, timeline, letters, travel log, held weather. Memory turns are never chapter material (`unsummarizedStory`, `storyMessagesSinceLastSummary` skip them) and carry no time chip.
- Header, ambience and images read `flashbackView(db)`: the memory's date, place and weather, so `state.weather` and `state.travelLog` are never touched. The Story header shows "Memory · Year 5 · …".

**Ending** (`endFlashback`, on the tracker's `"ended"`, or forced after `FLASHBACK_HARD_CAP` = 12 turns): an `EventRecord` dated on the memory's date, tagged `flashback` + its id, `present`-linked to everyone in it; each living person's bond moves by the sum of its nudges capped at ±1; the id goes to `played`; the present's pace and mode come back; `returned` gives the next present turn one `BACK FROM A MEMORY` line (same second, how it ended, never retold) and is cleared after it. A `flashback` memory job (`runSummaryJob` → `summarizeScene` with a memory note) writes it up: `applyFlashbackWriteUp` puts the MEMORY line on the event and keeps point-of-view lines from the living people in it. In the present, memories show as "(from Year N, before the story)" in RELEVANT MEMORIES; a remembrance day names one lived with the dead.

**UI** (Story): memory turns in a muted warm tint (`colors.memory*`), opened by a date line ("Year 2009, Sep 20. You are nine."); the Remember chip under the reply that showed the trigger; the live reply is tinted while it streams. Journal → Memories lists it under its own past date. Scrapbook: flashback photos go in "Before the story", grouped by memory title, with the memory's date, place and the player's age. Images of a memory send no outfit references and tell the model the player's age and look then (`playerLookAt`) and everyone's age then, in a faded warm tint.

**Prompt size**: nothing on a quiet turn; one line on an offer turn; the memory block replaces the present's dynamic block while one plays.

## 8g. Safehouses (`lib/rpg/safehouses.ts`)

Living-world section 20. Any place the player stays can become a safehouse by itself, and it goes when it stops working. Tests: `scripts/safehouses.test.ts`.

**Data** (`state.safehouses`): `places` (active and ended; 16 active, 24 former kept) and `current` (the one the player is at). Each `Safehouse`: id (`sh_…`), name, kind, place (the location when it became his), region, map place, since, lastVisit, nights, `until` (rented), host (borrowed), `knownBy` (entity ids) and `knownGroups` ("the landlord", a faction's name), stash, upgrades (name + date), residents, `compromised`, `raided` (`lost`, `seen`), status, `ended` (reason + note).

**Kinds**: `own` (a place they take or build; lasts until lost), `rented` (a hotel, inn or rented room; check-out at 10 AM after the last paid night; known to "the landlord"), `borrowed` (someone's home; ends when the player knows the host died, or the host's grudge is known or they are an enemy), `base` (a faction's place the player belongs to; their room, not their secret: it never plants a found seed), `camp`. **Belonging** (`belongsTo`): the player's newest membership fact naming the faction ("left", "quit", "fired", "defected"… mean out); with none, the player's or a companion's tag for that faction counts. A base the player no longer belongs to ends.

**Becoming one** (`applySafehouses`, after the consequences in the present state step; never in a fight; never in a flashback):
- The tracker's `safehouse` (schema object, all fields nullable): `id` (a listed one, also when the player comes back to it in other words), `name`, `kind`, `paid_nights`, `host`, `stored` / `taken`, `upgrade`, `shown_to`, `residents_joined` / `residents_left`, `ended` (expired, destroyed, compromised, withdrawn, given-up). The tracker sees `SAFEHOUSES` (the list with ids, the player's marked, stashes) and the rule, every present turn (~300 tokens).
- A night's rest without a tag still makes one when the place says what it is: an inn or hotel word → rented for one night; a faction's place named in the location (`baseOwner`: a faction from `world.factions`, else "the people who run it") → base; wilderness or road, wild words, caves and ruins → camp. "Camp" alone only makes a camp outside a settlement or a building. "Rest" here is 5+ hours of `downtime` pace, never a long day of travel.
- Where the player is: the tracker's id, else `matchesSafehouse` (same place text, its name in the location, or 2+ shared words; a different region never matches).
- Leaving a camp ends it (`left`) unless it has upgrades; resting again at the same spot within 60 days brings it back as `own`. A second stay at a camp, or any upgrade there, makes it `own`.
- Everyone in the scene learns where he stays; `shown_to` adds people or groups.

**Its course** (`advanceSafehouses`, every present turn): a rented room past its time ends `expired` once the player isn't in it (still in it: the line says the landlord wants more; `paid_nights` again extends it); a borrowed place ends `withdrawn`; the dead leave `residents`; residents get `whereabouts` = the place while the player is away (so the map, letters and lives see them there). Overgrown (`isOvergrown`): own, borrowed or base places not visited in 730 days.

**Being found**: someone added to who knows with a reason to come after the player plants a `found` consequence (`plantSeed`, `when: weeks`, `safehouseId`): a grudge, an enemy or affinity ≤ −10, or a faction that has the player wanted. It comes back (`canReturn`) only while the player is at that place, through the usual SOMETHING COMES BACK offer; when the tracker marks it returned, the place is `compromised`. If the player is away 7+ days after its time comes, they search it instead: the stash goes (`raided.lost`), the place is compromised, and the player only sees it when he is back (`raided.seen`; until then the Places list shows the old stash).

**Rest** (`restQuality`): safe (own, borrowed, base) heals injuries 2 extra days per night (`restAt`, the player's injuries only); rough (camp, rented, nowhere) is the ordinary rest; unsafe (compromised) means he may not sleep: `applyTurnDiff` doesn't end the "until rest" conditions there (`restBlocked`).

**Stash**: `stored` items leave the inventory under their inventory name (fuzzy match), `taken` items come back; 30 kept.

**Narrator**: one `SAFEHOUSE (where you are)` line after WEATHER: name, kind, since, who knows, the rented time, stash, upgrades, residents, a search the player finds, compromised, overgrown, shelter (walls keep the weather out; a camp by its cover: rock overhead but cold and damp in a cave, half a shelter in ruins, walls of a sort in a hut, no roof in the open) and how sleep goes there. `SAFEHOUSE (where you are heading)` when the player's words head back to one (its name, or "the safehouse/home/my place" with one fitting place). Otherwise only `Places you can go back to: …` in CURRENT STATE (names, up to 4, no camps). Nothing on a story with none.

**Letters**: a writer who knows the place the player is at (not a camp, not compromised; `letterAddress`): the letter offer says it may have waited for him there.

**Ambience**: `ambienceInputOf` adds `shelter` (the kind) and reads the place's name with the location ("the cave above the falls" gets the cave and the falls); any kind but a camp counts as indoors unless the words say outside. A camp sounds like its cover: a cave is indoors (dripping stone, rain only beyond the mouth through the filter), a hut is indoors (room tone, rain on the roof), ruins stay outdoors but half-sheltered (rain ×0.6 plus some on what's left of the roof and wet-stone drips, wind through the gaps when it isn't pouring, fewer birds, never the street; ruins with no place of the player's in them sound the same), the open is open. Every camp gets the fire at evening and night.

**UI** (You tab → Map): squares on the board for active places (hollow for camps); **Your places** (kind, country, "You are here" or last there, paid until / paid time ran out, Found, Overgrown; place, who knows, living there, stashed, built up, searched while you were away) and **Former places** (what happened and when; 5 then "Show all").

**Prompt size**: nothing on a quiet turn without places; one CURRENT STATE line (~20 tokens) while he has some; the SAFEHOUSE line (~90 tokens) only at or heading to one. The tracker's SAFEHOUSES block (~300 tokens) is in every present tracker prompt.

## 8h. Money (`lib/rpg/money.ts`)

The player's own money, in the world's currency (`world.currency`: name, optional symbol, plain-text `priceGuide`). Tests: `scripts/money.test.ts`.

**Data** (`state.purse`): `amount` (never below 0), `history` (the last 40 changes: date, signed change, reason, `counted` when a stated total set it), `estimatedStart`. New stories start with `CharacterDefinition.money`.

**Tracker**: `money: [{ amount, reason }]` for every change to the player's own money on the page (negative when they pay, lose, give away or are robbed), and `money_counted` only when the prose states their exact total. Someone else paying changes nothing; money only talked about hasn't moved; money is never an inventory item. With no amount in the prose, it estimates from the price guide. `readAmount` accepts numbers and strings ("-1,200", "$300", "−300"); zeros are dropped, 6 changes a turn at most.

**Applying** (`applyPurse`, in the present state step just before the safehouses; never in a flashback): changes in order, a payment larger than the purse pays what they have; then a stated total sets the count and clears `estimatedStart`.

**Narrator**: `Purse: $600` (or "600 <currency name>" without a symbol, `formatMoney`) in CURRENT STATE (both prompts), with "(nearly empty)" under `lowPurseAmount` (a fifth of the starting money) and "(empty: …)" at 0. The CORE rule: they can't pay more than they have, say how much whenever money changes hands, someone else may pay. `PRICES (<currency>)` carries the world's price guide in the cached rules.

**UI** (You tab → Journal → Now): **Your purse**: how it feels (scaled to the starting money) with the total, the note on a guessed start, and the changes newest first (4, then "Show all").

## 8i. Names the player knows (`lib/rpg/names.ts`)

The narrator and the UI only call someone by a name the player has actually learned. Strangers are described by how they look until they give their name, someone else says it, a letter or document shows it, or the player recognises them because they are famous (`fame`). Tests: `scripts/names.test.ts`.

**Data, per person** (`EntityRecord`):
- `known?: { label?, given?, family?, identities?, history? }` — what the player knows. **Missing means he knows the name** (older saves, and anyone the story introduced by name); `{}` means nothing yet. `history` (last 12): which name, part, how (`introduced`, `told`, `written`, `overheard`, `recognised`, `news`) and when.
- `nameParts?` (worked out from the name when missing: first word given, last word family).
- `identities?`: `{ name, kind: 'true'|'claimed'|'persona', learnedWith?, knownBy?: [{ who, from?, on?, playsAlong?, note? }], publicFrom?, existsFrom?, renamed?, alias?: false, note? }` — a stage name, a cover identity, a real name behind an alias. `publicFrom` / `existsFrom` / `renamed.from` name timeline events.
- `unnamed?: true` — a stranger the story hasn't named: `name` is their label until `names_learned` gives one (then the record, its bond and the scene cast take the name).

**The display name** (`displayName`, used by every screen and every text the app writes): the best identity the player knows (true > claimed > persona; a claimed one reads `renamed.name` once that milestone has reached him), else the parts they have heard (given only "Mara"; both "Mara Vance"; family only "Vance"), else the label. `BondRecord.characterName` is no longer shown. `alsoKnownAs` gives the other names he has learned ("Also known as" on the bond screen); `searchableNames` is all the bonds search and the merge sheet match, so a hidden name never finds or spoils anyone.

**Labels**: built from age, gender and the first feature in their appearance ("the woman with red hair"). `ensureLabels` stores one for everyone present the player can't name, unique on the bonds list (`uniqueLabel` adds the place, then a number).

**At the start**: people the player adds are known by name when marked `knownName`; otherwise they start under a label (their role). People the story introduces follow the NAMES rules.

**People with more than one identity** (`EntityRecord.identities`):
- `nameKnownBy(db, person, viewer)`: what one person calls them (someone who plays along uses the name they go by). The player's own telling is the tracker's `names_told` (`applyNamesTold`): a dated `knownBy` entry and a secret fact.
- `identityLine` (on the card in CHARACTERS IN SCENE): the truth for the narrator only, the identity in use this scene (the persona whenever anyone who only knows it is present; the claimed name when alone with those who know it; the true name once public), and what each person present knows them as.

**Recognising the famous** (`EntityRecord.fame`, `fameOf`): `sight` (a face everyone knows), `heard` (a name everyone knows), or unknown. `recogniseOnSight` teaches a `sight` person's name the moment they are in the scene cast; `heard` people are named on their card ("they have heard the name but don't know the face") and need the tracker's `recognised` or an introduction.

**Turn flow** (`applyNameStep`, in `applyStateStep` right after the timeline advances, on the turn's `sceneCastIds`): the tracker's `names_learned` → `names_told` → recognition on sight → names said aloud (backup: a present person's own, unshared name inside quoted dialogue counts as overheard; a name two people share is left to the tracker) → identities from timeline news (`learnFromTimeline`) → labels. All silent: no notice, as in life.

**The narrator**: the NAMES rules in `NARRATION_SYSTEM` (cached). CHARACTERS IN SCENE is built from the people actually present (`state.sceneCast`) plus names in the text, since a label never matches: each card leads with the name the player knows, or `label [narrator only: Name]`, then "the player knows them as …" / "call them "…" every time", and `identityLine` for people with identities. BONDS, THE DEAD (people the player never knew are marked "unknown to the player"), ELSEWHERE, TRAVELLING WITH YOU, news bearers, letters, grudges, the familiar face, birthdays, and the names in facts all go through `displayName` / `narratorName`. Summaries, the image action and scrapbook captions are told to name people only as the player knew them.

**The state tracker**: KNOWN CHARACTERS lists every identity ("identities: Red (persona), Mara Vance (true)"); CHARACTERS IN THIS TURN says "you know them as …" or "you don't know their name (you see "…")". The NAMES rule in `STATE_SYSTEM`: `names_learned: [{character_id, name, part: given|family|full|identity, how}]` only for a name spoken, written or recognised within the player's hearing or reading; `names_told: [{character_id, name, told_to}]`; `new_characters[].name_known: false` adds a stranger under a label; every text it writes uses the names the player knew at that moment.

**Leak check**: `nameLeaks` lists names the narration used outside quotes that the player can't know yet (whole, capitalised words; known names of other people excluded). They are shown on the turn in Settings → Debug ("Names the player couldn't know yet…").

**Prompt size**: the NAMES rules are cached; one or two lines per person on the scene cards.

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
- Candidates: free characters only (`isFreeCharacter`: not the player, not someone whose path is set by the world timeline), met, alive, not in the scene cast, not named in the recent scene, and unseen for at least `RETURN_MIN_DAYS_AWAY` (14) in-story days.
- Fit to the current place, strongest first: last seen here (a distinctive place word in `lastSeenAt` matches the current location, after English place names) → role/notes tie them to this place → a travelling role (merchant, courier, mercenary, wanderer…) while the player is on a road or in a town. No fit, no offer. A bond adds weight, a major bond more.
- Cadence: one offer turn per `RETURN_WINDOW_TURNS` (8) player turns, picked by a hash of slot + window, never before turn 6, never in combat/chase, never where `encounterRisk` is `none`. The pick rotates among the top three. Everything is deterministic, so a regenerated turn gets the same offer; once someone resurfaces, their `lastSeen` resets and they leave the pool.
- The block is optional for the narrator: use them only if it fits; if used, they are the turn's encounter.

### 9b. Reputation & bounty hunters (`lib/rpg/reputation.ts`)

- **Factions** are the world's own groups (`world.factions`). Each keeps a `heat` (0-100) and a `standing` (−100..100) in `state.reputation.factions[factionId]`. The tracker's `reputation: [{faction, change, reason}]` (faction ids are listed in the tracker prompt) moves heat (one move per faction per turn, clamped to −15..+25) when that group's people saw the player and lived, were hurt by them, or saw them work openly on its ground.
- **Wanted lists**: only factions with `hasBounties` list the player. At `LIST_HEAT` (15) they are listed; levels `noted` / `wanted` / `high` / `top` (`WANTED_LABEL`). `bountyFor` prices it in the world's currency, scaled to the player's starting money (about 3× at the first level, 50× at the top), rounded to two significant figures.
- **Cooling**: after `COOL_AFTER_DAYS` (60) without a new deed, −1 heat per `COOL_DAYS_PER_POINT` (20) days, computed lazily (`currentHeat`). A listed entry never drops below 15 and is never removed.
- **What the player knows**: entries start `known: false`. `bounty_seen: [factionId]` (a poster, a warrant, someone naming the price) marks one known and shows a news-strip notice. The narrator always sees every entry plus which ones the player hasn't seen; the You tab shows only known ones.
- **Standing** bands: suspected / doubted / unproven / trusted / valued (`factionStandings`, shown on the You tab once it moves).
- **YOUR NAME OUT THERE** (narrator, after ENCOUNTER CONDITIONS): `territoryOf(location)` picks the faction whose `territoryRegionIds` contain the player's region; one line on how its people would react, other factions that want them, and standings. Skipped where `encounterRisk` is `none`, except standings.
- **A PRICE ON YOUR HEAD (optional)**: `hunterOffer` — one possible turn per `HUNTER_WINDOW_TURNS` (10), never before turn 8, only on roads and in towns, never in combat or empty places, only if the player is listed somewhere. Deterministic per slot + window.
- **One pressure per turn**: the prompt takes a due grudge first, else a bounty hunter, else A FAMILIAR FACE (`formatPressure` in `prompt.ts`).

---

## 10. Romance (`lib/rpg/romance.ts`)

- `RelationshipStage`: stranger → friendly → close → romantic interest → lover / ex / rejected.
- `Attraction`: none | warm | strong. `normalizeRelationship` / `normalizeAttraction` tolerate model wording.
- `romanceAccessibility` lives on each entity (from the `StartingPerson` or the tracker's `attracted_to`, via `romanceFor` and the player's gender). No orientation is hard-coded. Session A folds this into `IntimacyProfile`.
- `ROMANCE_RULES` is injected into the narrator system prompt: romance is earned and can fail; only someone whose heart is open to the player can become a romance; a rejection holds by default.
- **Adults only**: romance and intimacy only when everyone involved is 18 or older in-story; anyone under 18 or with no stated age is never romantic or sexual, in any scene, flashback or framing. Session A hardens this into `canBeIntimate` checks in code.

### 10a. Grudges (`lib/rpg/grudges.ts`)

The dark mirror of romance: slow, earned, lasting.

- **Start**: a bond diff that leaves affinity at or below `GRUDGE_AFFINITY` (−6), or the tracker's `grudges: [{character_id, event: 'wronged', reason}]` (the player kills or maims someone they love, betrays, humiliates or ruins them; creates a bond if there is none). Opens a `grudge` thread (`<name>'s grudge against you`) and a fact.
- **Heat** (0-100): starts at 30 + 5 per point below −6 (45 for `wronged`; +25 for a further `wronged`); a negative bond move adds 4 per point, a positive one removes 5; left alone it stews +1 per `STEW_DAYS` (10), up to +20 since it last moved (`grudgeHeat`).
- **Stage**: resentful < 40 ≤ vengeful < 70 ≤ hunting. People whose path the world timeline sets stop at vengeful and act within that path.
- **Strikes**: `grudgeOffer` offers one vengeful/hunting grudge (not a companion, not in the scene, not mid-fight) once `STRIKE_GAP_DAYS` passed since the last strike (vengeful 30, hunting 14): on one turn in five, or every turn once `STRIKE_PRESS_DAYS` (10) overdue. The style is deterministic per turn: hunting → ambush (at night in towns), trap, hired blades, signs they are close, or — after a failed strike — a threat against someone the player cares about; vengeful → his movements sold, a message, paid blades, or them turning up if this place is on their path. `struck` records `lastStrike`.
- **End**: the bond climbing back to `LET_GO_AFFINITY` (−2) → let go; `settled` (a reckoning they accept) or `forgiven` from the tracker; death. Each resolves the thread; all but death add a fact.
- Prompts: `GRUDGE_RULES` (ENEMIES) sits in the narrator rules; BONDS shows `[grudge: stage, reason]`; the state prompt gets REPUTATION & GRUDGES (field rules + the offered grudge's id).
- UI: Bonds → "Your name out there" card (known wanted listings, faction standing bars), a "Want you to pay" group with a red stage tag; the bond screen shows a Grudge card.

---

## 11. Image pipeline (`lib/rpg/image.ts`, `imageDirection.ts`, `paintScene.ts`, `referenceImages.ts`)

Goal: wide, cinematic frames in the world's own art style (`world.artStyle`, default "cinematic photo, natural light"), not evenly lit mid-shots. `paintScene.ts` runs a scene image start to finish; the Story screen only shows the results.

- References for the player: their own uploaded face and outfit images (`character.faceImage` / `outfitImage`, `loadPlayerReferenceImages`), both optional — without them the prompt describes the player from their written appearance and outfit. Plus at most **one** earlier scene image, for rendering style only, and only when the new shot type matches the last image's (`usePreviousForStyle`), so compositions don't converge.
- **Model capabilities (`imageCaps.ts`, `fetchImageModelCaps`)**: when an image model is picked in Settings, the app reads `GET /api/v1/images/models/{id}/endpoints` and keeps only what *every* endpoint accepts (enum values intersected, ranges narrowed), falling back to the model-level summary. Saved as `settings.imageModelCaps` (`maxReferences` from `input_references.max`) and re-checked when stale or when the model changes. Settings shows a line under Images ("Takes up to N reference images…", red when 0).
- `buildImageRequestBody(caps, …)` sends only accepted fields: `resolution` 1K, `aspect_ratio` (always 16:9 for scenes; closest allowed ratio if not offered), `quality`, `output_format` jpeg/webp + `output_compression`, and at most `maxReferences` references. On a 400/422 it retries once with just prompt + the same references; it never drops references silently.
- **The director (`writeImageAction`)**: on every tap, one call on `settings.imageDirectorModel` (Settings → Advanced → Image director; defaults to the narrator model) at temperature 0.75, falling back to the memory model at 0.5. It picks the most dramatic instant and returns `ACTION:` (who does what to whom, ≤45 words, ≤80 for ensembles), `SHOT:` (shot type, angle, lens, composition, focal person, peak emotion, light and effects) and `CAPTION:` (second person, for the scrapbook), read by `parseImageAction` (missing SHOT is fine; no labels = all action). `directorContext` gives it the reply, the player's last input, location, outfit, cast with their mood and `currentLook`, `state.mood`, the time and weather, timeline art direction, "This is a key moment: go big" when the reply was `imageWorthy`, a forced shot from a chip, the last 3 shots (variety tracker), and "no impact frame" when one was used among the last five images. Logged in Debug as "Image director". Falls back to the last 700 chars of narration if both calls fail.
- **The prompt (`buildSceneImagePrompt(db, references, action, { shot, shotType })`)**, vision first, rules after: style opener (`world.artStyle`) → SHOT → ACTION → ART DIRECTION → `lightLine` (light from the clock hour: dawn, noon, golden hour, night, lamplight indoors; weather from `currentWeather` or the memory's own; a colour accent from the scene's words — never hard-coded rain) → location → the player's look/outfit → look tags for the others → reference labels (all **identity only**: copy face, hair, eyes, clothing; ignore pose, expression, framing, lighting, background) → rules (actor rule, who may appear, ensemble focus, compose for 16:9, no text). No `Timeline:` or `Scene:` lines.
- **Shot types (`imageDirection.ts`)**: `shotTypeOf` reads the type from the SHOT line's opening words. Wide / extreme wide / aerial are scale shots: tiny distant faceless figures, rooftops and armies are allowed; only unnamed recognisable faces stay banned. The type is stored as `imageMeta.shot` / `shotType`.
- **Ensembles**: an ensemble shot (or the Ensemble chip) takes up to 10 people from `sceneCast` (5 otherwise). People slots = the model's `maxReferences` minus the player's face and outfit (`personReferenceSlots`). `sceneCharacterReferences(db, action, limit, originalsFirst)` can spend slots on people the model won't know first (`modelKnowsCharacter`: only famous people in a known-universe world); every person named gets a look tag from `appearance` / `currentLook` (and age). When there are more people than slots, `castSheet.ts` draws up to six faces side by side on one canvas with their names baked in and sends it as one `cast` reference ("left to right …"); without a canvas (native) they go one per slot. The director has five ensemble layouts (line-up, battle lines, circle, depth layers, clash) and always names one focal person.
- **Timeline art direction (#13)**: `TimelineEvent.artDirection`; `timelineArtDirection` uses it while the player has taken on that beat, or for two days after it happened where they are.
- **Swapped-roles check (`imageCheck.ts`, #14)**: after each image (Settings → Check images, on by default) a vision call on the director model asks whether the actor is the one doing it and whether extra people appear. Reversed roles → one retry with `sharperActorRule`; if that is wrong too the better one is kept and flagged (`imageMeta.mightBeOff`, a toast). Logged in Debug as "Image check".
- **Shot chips and two takes**: tap Paint for Auto; long-press it for Auto · Close-up · Action · Impact · Epic wide · Ensemble · Aftermath and the Two takes switch (`settings.imageTwoTakes`, off by default; also in Settings). Two takes paints both, checks both, and lets you keep one. A reply the state tracker flagged `image_worthy` (stamped on its log entry as `imageWorthy`) shows a glowing "Paint this".
- **Retouch (#12)**: in the fullscreen viewer, Retouch opens a one-line field; `retouchSceneImage` sends the image (as an `edit` reference, first) and the player's face with `Edit this image: <tweak>. Keep everything else the same…`. The new version shows with Keep / Discard; keeping it stores `imageMeta.tweak` and `previous` (the old image).
- `referencePlan.ts` `planReferences` order: **edit → face → outfit → character / cast → previous → alternate**, cut at the model's limit, so the player's face is the last to go. If the face can't be sent the player gets a warning toast (`faceDroppedWarning`), and the prompt describes the player in words instead.
- Portraits (`PortraitHeader.tsx`) use the same caps and plan: face → outfit → previous portrait.
- Images are generated **only when the player taps Paint**.
- **Storage (`imageStore.ts`)**: images never live in the save. `storeImage` writes the data URI to IndexedDB (`frbddn-images`) and returns a short `img:<id>` reference that goes into `rawLog[].image` / `portraits[].image`. `loadImage` / `useStoredImage` resolve references (in-memory cache). On load, switch and import, `externalizeImages` migrates any inline data URIs from older saves. Export inlines images again (`inlineImages`) so save files stay self-contained. Without IndexedDB, `storeImage` returns the data URI unchanged.
- **Portraits (`portrait.ts`)**: `portraitSignature(db)` reduces the player to age, outfit (their sheet's outfit), a coarse expression bucket from `state.mood`, and a setting bucket from `locationKind`. `portraitStaleReason(latest, current)` says why the latest portrait is outdated (outfit → age → expression → setting) or returns null. `buildPortraitPrompt` asks for a 3:4 head-and-shoulders portrait using the player's face and outfit images (when uploaded) and the previous portrait as references, in `world.artStyle`. Portraits are generated only from the You tab's Refresh button and stored in `db.portraits` (last 24).
- **Character portraits (`characterPortrait.ts`, `components/player/CharacterPortraitCard.tsx`)**: portraits of people in your bonds, painted only from the Paint/Repaint button at the top of their bond page. `characterPortraitSignature(db, entity)` = age (frozen at death), expression bucket from `entity.mood`, and `entity.appearance`; `characterPortraitStaleReason` checks face reference added → age → appearance → expression (the dead never go stale otherwise). `buildCharacterPortraitPrompt` sends a 3:4 head-and-shoulders request with references face → previous portrait of that person; without a face reference it follows the appearance text. Stored in `db.characterPortraits` (last `PORTRAITS_PER_CHARACTER` = 4 per person, each with `usedFace`). **Face references** (`db.characterFaces`, one per person) are images the player chooses (`pickImageFile` in `file.ts`, scaled to 768px JPEG) — nothing is fetched from the web and nothing ships in the repo; they live in IndexedDB like every other image and are inlined on export. `mergeEntityPair` moves portraits and the face reference to the person kept (`moveCharacterImages`). The bonds list shows the latest portrait in each avatar circle.

---

## 12. UI

- `app/_layout.tsx` — fonts (Manrope), navigation, GameProvider, toasts, Android nav bar.
Three tabs: **Story / You / Settings** (the You tab switches Bonds / Journal / Map). All list screens use the shared kit in `components/List.tsx` (`SectionLabel`, `ListCard`, `ListRow`, `FilterPills`, `Segmented`) and the type tokens in `constants/theme.ts` (`sectionLabel`, `rowTitle` 15 bold, `rowBody` 13, `rowMeta` 12, `prose` 16) — use them for new screens instead of one-off styles.

- `app/(tabs)/index.tsx` — Story: before the first turn, the opening (location + the opening situation the player wrote) with a Begin button; narration as plain prose, the player's turns as tinted blocks (`*actions*` italic), header with clock/date/location (tap → status sheet with mood, date, scene), news strip, a `+N min` time chip under each reply (tap to correct), Image / Retry / Undo under the latest reply, single-row composer with `"` and `*` markers, fullscreen image viewer.
- `app/(tabs)/you.tsx` — the You tab: `components/player/PortraitHeader.tsx` (current portrait, outdated reason, Refresh, history strip) plus a sticky Bonds / Journal / Map switch.
  - `BondsSection.tsx` — search + compact rows (people you have met; unmet people are hidden) (avatar — their latest portrait when painted, name, Major tag, affinity bar, relationship · last seen), sorted by most recent contact; rows open `app/(tabs)/bond/[id].tsx` (portrait with Paint/Repaint and face reference, bond meter, chips, mood/personality/speech/appearance, shared memories, Merge with…).
  - **Only what the player could know** (`lib/rpg/disclosure.ts`): the bond meter and list bar show *your* feelings (`yourFeelings`); theirs only as a word ("Toward you they seem warm", `howTheySeem`), with no note, attraction chip or romance note. Mood shows only while they are with you; otherwise "Last you saw them" with the date. A grudge (bond page, list label, enemies group, Journal thread) shows only once they have struck (`grudgeKnown`). Profile fields and portrait prompts go through `shownField` (today it shows the field as written; it is the one place to hide a secret from the player later). The narrator still gets everything. The "Your name out there" card never hints at listings you haven't seen. Tests: `scripts/immersion.test.ts`.
  - `MapSection.tsx` — the map (§8d) and your places (§8g).
  - `JournalSection.tsx` — Now (scene, missions, goals, threads), Recap (timeline of summaries, falls back to recent events), World (heard timeline news with source, what they call you, where things stand, lore), Memories (events with people), Letters, Scrapbook (§8d). Rows use an event's own `title` when it has one (`memoryTitle`); otherwise `titleAndBody` (`util.ts`) splits the text: "Title: …", a first sentence under 90 characters, or the first words cut at a word boundary with the rest kept as the description. Recap titles come from `summary.title`.
- `app/(tabs)/world-clock.tsx` — hidden **World clock** (long-press the clock in the Story header; `href: null`, no tab). Read-only view of `worldClock(db)`: running/held-for-combat status, not heard yet (next in line first), due-but-waiting, queued with dates and days until, personal moments open to you, fired (with who told you), and missed beats. Contains spoilers by design.
- `app/(tabs)/settings.tsx` — Narrator (key status that expands into the editor, Story and Images models, Advanced: summary + memory models), Sound (ambience switch and volume, §8e), Stories (slots with a ⋯ menu: play, copy, rename, delete; New story), Export / Import, Debug, version and credit.
- `components/settings/DebugPanel.tsx` — Settings → Debug. For each of the last 30 turns: the exact messages the narrator saw (newest 5 only; copyable), the state step's status, raw reply, applied diff and a field-by-field list of what changed in the save, and every call the turn made (narrator, state, summaries, images) with billed tokens, thinking/cached tokens, time and cost.

### Debug log (`lib/rpg/debug.ts`)

- Lives outside the save, in its own IndexedDB store (`frbddn-debug`), so it never costs save quota or travels with an export. Memory only where IndexedDB is missing.
- A turn is opened with a temporary id when the prompt is built and re-keyed to the narrator reply's log id once saved; background steps (state retries, summaries) record against `job.turnLogId`, so their spend lands on the turn that caused it.
- Costs are never estimated. Every chat request sends `usage: { include: true }`; `CallUsage.cost` comes from the reply, or from `GET /api/v1/generation?id=` when the reply had none. A `+` after a total means a call reported no cost.
- `describeStateChange(before, after)` diffs the save around `applyStateStep` (skips rawLog, snapshots, indices, meta, settings, memoryJobs).

---

## 13. Invariants (do not break these)

1. **Never control the player.** The narrator stops when the player must act.
2. **The narrator writes prose only.** Never add JSON, field names or timeline ids to the narrator prompt; state comes from the separate structured state call. `stripNarrationJson` / `streamingPreview` remain as safety nets. JSON must never appear in the chat.
3. **World truth**: no invented world event, death or date; only timeline events, news and facts count. **Realism**: no magic, powers or impossible technology for the era.
4. **Time always moves, by the largest of** the narrator’s report, the narration parser, or the scene-type minimum (combat 15 s, chase 1 min, conversation 2 min — 20 s in conversation mode, downtime 10 min, travel 30 min). Every advance goes through `resolveTurnClock`, never forward-only hacks elsewhere; the player can correct any turn from its time chip.
5. **Combat cannot skip days** around the player; the cap is enforced in `resolveTurnClock`.
6. **Names the player knows** (§8i): narration, the UI and every text the app writes use `displayName`; a name the player hasn't learned is shown only as a narrator-only truth, and search finds only known names. A hidden identity stays unknown to the player until the story reveals it.
7. **One person, one entity**: every identity of someone (a persona, a cover name, a real name) lives on that one entity.
8. **Unheard timeline events are invisible in the Journal** until delivered.
9. **Personal beats are offers**, never assumed; they only complete when narrated.
10. **Token ceiling**: prompts over `settings.promptTokenBudget` are trimmed; never add unbounded prompt data. Keep the rules and slow blocks first so the cached prefix survives.
11. **Images only on user action**, with the player’s face/outfit references (when uploaded) and the action brief.
12. **Version sync**: `package.json` → `app.json` → SW cache (`scripts/generate-sw.js`) → Settings display.
13. **A flashback never moves the present**: its turns change only `state.flashbacks.active`; the present's clock, place, inventory, money, facts, timeline and weather stand still, and its turns stay out of chapter summaries.
14. **A safehouse comes from the story**: the tracker tags it (or a night's downtime at an inn, a camp or a group's base makes one); upgrades, stash moves and endings only come from what the page shows, never a menu. Its line reaches the narrator only when the player is at one or heading to one.

---

## 13b. Save-analysis fixes (Nov 2026)

How the fixes from the save-analysis list work, and where they live. Tests: `scripts/fixlist-memory.test.ts` (5–8), `fixlist-people.test.ts` (10–14), `fixlist-world.test.ts` (15–21), `fixlist-story.test.ts` (22–28), `met-and-memories.test.ts` (1–4); all run on the test world.

- **One clock** (`correctTurnTime`, `shiftDatesAfter` in calendar.ts): correcting a turn's length shifts every in-story date stamped after the turn began, anywhere in the save.
- **Fact lifecycle** (facts.ts): the state tracker sees `ACTIVE FACTS` with refs (`f-xxxxxx`) and can `supersedes` / `facts_ended` them; a new fact overtakes a matching "does not know yet"; `lasts` gives conditions `untilRest` and injuries/plans an `expiresAt`; `expireFacts` runs every turn (rest = 5+ hours outside a fight). `whoKnows` holds entity ids, `whoKnowsGroups` group tags; claims are `confidence: 'claimed'` with `claimedBy`; every fact has a subject and a `sourceEventId` or `sourceLogId`. The prompt budget cuts memories, then facts and lore, before recent story.
- **Lore conditions** (lore.ts): `activeAfter` / `activeUntil` with a timeline event, thread status, fact text or flag (`inRomance`); `always` entries are always sent.
- **Timeline stages** (timeline.ts): offered → accepted (`timeline_engaged`, nothing written) → completed (`timeline_completed`, the moment in `completesWhen`): only completion writes facts (real date, subject, who was there) and opens threads. `requires` gates a beat.
- **Chapters** (`applyChapterBreak` in memoryJobs.ts): summaries never end chapters. A chapter opens on `chapter_title`, a completed major timeline event or a 2+ day skip, once the chapter has 6 turns or 12 hours (60 turns closes one anyway). `state.chapterTitle`, `chapterStart`, `chapters`.
- **People**: `gender` on everyone; romance accessibility comes from who each person is drawn to (`attracted_to`) and the player's gender, never from gender alone. `tier: 'minor'` people get no bond until a second scene. `appearance` is the lasting base look, `currentLook` the look of the moment (cleared by a new scene or rest), `whereabouts` where someone absent is.
- **Bonds**: `theirFeelings` (mirrors `affinity`/`note`, kept in step by `syncBondSides`) and `yourFeelings` (`your_change`, `your_note`). Relationship labels are fixed; `partner` is a work or crime partner, romance is `lover`. A bond reads "Deceased · …" once you know of the death.
- **Threads**: matched on normalized titles and wording before opening; casing kept; `participantIds`, `sourceEventId`, `sourceLogId`. Threads come from the opening, the character's goals, timeline events and the story.
- **Narrator**: exact time and earliest end time, FIGURES ALREADY SAID, ELSEWHERE, VARIETY (question endings, repeated motifs, settled decisions), inventory rule.
- **Images**: WebP recompression (imageCompress.ts) and binary IndexedDB storage; `imageMeta` on scene images; export with or without images; older chat images load on tap; portrait painting lock (`beginPainting`) and duplicate guard.
- **Undo**: snapshots (last 5) survive saves and hold no images; restore takes images from the live save.

## 14. How to extend safely

### Add a world timeline event
Add a `TimelineEvent` to `db.world.timeline` (through the wizard or world editor once they exist; in code, in the world you seed). Give it a real date window, `regionId`/`location`, `knowledge` (+ `factionId` for faction news, `bearers` for secrets), facts, an optional encounter, and `playerDriven` if it depends on the player. Never hard-code an event in `timeline.ts`.

### Add a person at the start
Add a `StartingPerson` to the seed input (name, age, gender, role, appearance, personality, speech style, relationship, both sides' feelings, `alive`, `knownName`, optional `fame`). `seedDatabase` makes the entity and bond.

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
| Timeline events not appearing | Check `db.world.timeline` (empty by default), `timelineProgress.completed` and the hidden World clock screen. World events need their date plus every earlier world event, and nothing fires mid-fight. Personal beats need state-call marks — check `TIMELINE TRACKING` in the state prompt. |
| Timeline event visible too early | Journal only shows `heard` events; check `heard` map and `normalizeDatabase` migration. |
| JSON text in chat | Something put JSON back into the narrator prompt. Safety nets: `streamingPreview` (live), `stripNarrationJson` (save + render). Run tests. |
| Wrong characters in images | The ACTION line is written fresh on tap by `writeImageAction` (memory model); cast comes from `sceneCast`. Check Settings → Debug → Image description. |
| Prompt tokens growing | Budget guard trims recent messages; check `formatFacts`/timeline caps. |
| Save quota error | Slots should be in IndexedDB — check `slotBackend()`. On the AsyncStorage fallback `saveSlot` trims images/snapshots; clearing old slots helps. |
| Need to see what really happened | Settings → Debug: prompt, state diff, tokens and cost per turn. |
| PWA stale | Bump version so `generate-sw.js` changes the cache name; rebuild. |

---

## 16. Test coverage map

Run: `bun test`. Every test runs against the hand-written test world (`lib/rpg/testWorld.ts`: Harbourside, a present-day port city; player Alex Reyes; Mara Vance, Daniel Okafor, Theo Marsh (dead before the story) and Jonah Pike (not met yet)). `seedDatabase(slotId, name)` with no input seeds it.

- Pipeline (`scripts/verify-pipeline.test.ts`): save compatibility, JSON stripping, identity resolution, time parsing, pacing, timeline scheduling and deaths, prompt composition, companions, letters, returning characters, portraits and scene references, token stability over 60 turns
- No legacy words (`scripts/no-legacy-words.test.ts`): no prompt (narrator, tracker, summaries, time skip, scene image, portraits) carries a word from the old setting; the narrator gets THE WORLD and WHO YOU ARE as prose
- Enemies (`enemies`), living world (`living-world`), yearly offers (`yearly`), weather and map (`weather-map`), flashbacks, money, names, image director, state fallback
- Slot storage, debug log, journal, ambience, scene modes, safehouses, save-analysis fixes (`fixlist-*`), meeting and shared memories, immersion
