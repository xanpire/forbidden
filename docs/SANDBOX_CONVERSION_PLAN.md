# Sandbox Conversion Plan — session prompts

Turn **Kan** (a Naruto-only AI roleplay PWA) into **frbddn**, a **sandbox roleplay game**: the player chooses who they are and which world they live in, writes their own backstory and characters, and plays. Every Naruto element, every canon character and Kan's whole backstory are removed.

This file is written for an AI coding agent working across **several separate sessions**. Each session below is a self-contained prompt. Paste it (or say "do session N from SANDBOX_CONVERSION_PLAN.md") to start one.

---

## READ THIS FIRST (every session)

**Who you're working for:** Xan. Xan can't code at all. You write all the code, fix all the bugs and run all the tests. Never hand Xan a manual step that needs coding knowledge. Talk casually, directly and concisely.

**Decisions already made (don't reopen them):**
1. **Replace, don't fork.** Work directly in this codebase. Xan keeps a separate copy of Kan. Old Kan saves do **not** need to load. Drop migrations that exist only for Naruto saves.
2. **Known universes are supported.** The canon engine stays, renamed to a generic **world timeline**. It's empty by default. The player can write events by hand, or optionally import them for a known universe (session 6).
3. **Mostly manual.** The player writes their world, character, backstory and people in plain forms. The AI only helps when the player presses a "help me fill this" button. The build step only converts what the player wrote into save records; it never adds story of its own.
4. **App name: frbddn** (chosen 2026-11-09). It lives in one constant, `APP_NAME` in `lib/brand.ts`, together with every storage key. `app.json`, the manifest, `+html.tsx` and the service worker cache already use it. Only the icon is still Kan's (session 7).

**Before you change anything:**
- The code lives in the GitHub repo **`xanpire/forbidden`** (default branch `master`). Attach it, branch from the last session's branch (or `master` once it's merged), and push your branch. Keep this plan in both places, updated: `docs/SANDBOX_CONVERSION_PLAN.md` in the repo and `kan-master/docs/SANDBOX_CONVERSION_PLAN.md` in the claude.ai Project.
- Read `docs/PROJECT_GUIDE.md`. It's the full technical map, and its invariants (§13) still apply unless this plan says otherwise.
- Read the **Progress log** at the bottom of this file to see which sessions are done.

**How to work:**
- Do one session per run. Don't start the next one unless Xan asks.
- After the session, run `bun test` and get it green (rewrite or delete tests as the session says).
- Run `tsc --noEmit` with no errors.
- Then update the **Progress log** in this file: what was done, what was left, and anything the next session must know.
- Keep `PROJECT_GUIDE.md` true. When a system changes, rewrite its section. Remove Naruto sections as their code goes.
- Never put JSON, field names or ids into the narrator prompt (invariant 2). Keep the cached prompt prefix stable (invariant 10).

**Naming used in this plan:**
- *Player*: the character the user plays (was Kan).
- *World*: `db.world`, a `WorldDefinition`.
- *Character*: `db.state.player`, a `CharacterDefinition`.

---

## Target data model (sessions 1–3 build toward this)

```ts
// lib/rpg/types.ts
WorldDefinition {
  id, name, premise,                 // one-paragraph pitch, written by the player
  genre, tone,                       // free text: "dark fantasy", "grim, slow-burn"
  knownUniverse?: { name, canonStrictness: 'loose' | 'faithful' | 'strict' },
  techLevel?, magicSystem?,          // free text
  abilityCategories: string[],       // e.g. ["Fire magic","Swordsmanship"] — replaces chakra natures
  abilityLabel: string,              // what abilities are called: "Spells", "Jutsu", "Skills"
  currency: { name, symbol?, priceGuide: string },  // priceGuide = plain-text price scale for narrator and tracker
  calendar: { yearLabel: string, start: CalendarDate, monthNames?: string[] },
  factions: FactionDef[],            // { id, name, description, territoryRegionIds?, hasBounties?, carriers? }
  regions: RegionDef[],              // { id, name, description, climate: ClimateType, neighbours: [{id, days}] }
  places: PlaceDef[],                // { id, name, regionId, kind: 'settlement'|'road'|'wilderness'|'structure', description }
  lore: LoreRecord[],                // the player's own lore entries (keyword-triggered, existing type)
  timeline: TimelineEvent[],         // ex-canon milestones, same shape as CanonMilestone minus Naruto fields
  festivals: FestivalDef[],
  letterCarriers: string[],          // "courier", "raven", "radio"…
  artStyle: string,                  // image style opener, e.g. "painterly dark-fantasy concept art"
  narratorNotes?: string,            // the player's own extra rules for the narrator
}

CharacterDefinition {               // replaces PlayerSheet + Kan's hard-coded seed
  name, aliases, age, birthday?, gender, appearance, outfit,
  personality, speechStyle, backstory,   // backstory = the player's own text, kept verbatim
  role, abilities: AbilityDef[], inventory: string[], money: number,
  secrets: string[], goals: string[],
  faceImage?, outfitImage?,          // img: refs, uploaded by the player
}

StartingPerson {                     // people the player adds by hand
  name, aliases?, age?, gender, role, appearance, personality, speechStyle,
  relationship, yourFeelings: { affinity, note }, theirFeelings: { affinity, note },
  attraction?, romanceAccessibility?: 'winnable'|'taken'|'not-interested'|'not-applicable',
  alive: boolean, knownName: boolean, secrets?: string[], whereabouts?
}

OpeningScene { location, placeId?, date: CalendarDate, situation, castNames: string[], threads?: string[] }
```

`ClimateType`: `temperate | continental | desert | tundra | tropical | monsoon | rainy | coastal | mountain | none` (`none` = indoors, space, underground: always "no weather").

---

## SESSION 1 — Rename Kan → player, add the new types ✅ done

**Goal:** no hard-coded "Kan" left anywhere; the World/Character types exist; the app still compiles.

Do:
1. Add `lib/brand.ts` with `APP_NAME = 'frbddn'` and storage key prefixes. Change every `kan.*` storage key (`kan.meta.v1`, `kan.slot.*`, `kan.apiKey.v1`, `kan.ambience.v1`, IndexedDB `kan-saves` / `kan-images` / `kan-debug`) to the new prefix.
2. Add `WorldDefinition`, `CharacterDefinition`, `StartingPerson`, `OpeningScene`, `FactionDef`, `RegionDef`, `PlaceDef`, `TimelineEvent`, `FestivalDef`, `AbilityDef`, `ClimateType` to `types.ts`. Add `world: WorldDefinition` to `AppDatabase`. Replace `PlayerSheet` with `CharacterDefinition`.
3. Add a helper `playerName(db)` and `playerEntity(db)` (the entity tagged `player`). Replace every literal `'Kan'` / `Kan` reference in code, prompt strings, tracker rules, UI copy and comments with these helpers, or with "the player" / "you" in prose. Search widely: `prompt.ts`, `names.ts`, `entities.ts`, `deaths.ts`, `companions.ts`, `disclosure.ts`, `flashbacks.ts`, `letters.ts`, `renown.ts`, `consequences.ts`, `image*.ts`, `portrait.ts`, `scrapbook.ts`, every component. Function names like `kanKnowsDeath`, `kanKnowsLine`, `readKanInput`, `kanThen`, `kanLookAt` → `playerKnowsDeath`, etc.
4. Rename the `kan.tsx` tab to `you.tsx` (label "You"), `components/kan/` → `components/player/`, `Wordmark` → uses `APP_NAME`.
5. `normalizeDatabase`: drop migrations that exist only for old Naruto saves (hiddenAliases, BIRTHDAY_FIXES, GEOGRAPHY swap, names v1 backfill for the canon cast). Keep the generic repairs.

Done when: `grep -ri "kan" lib app components` only matches unrelated words (e.g. "kanji"), types compile, and tests that don't depend on Naruto data still pass (others may be skipped with a `TODO session 3` note).

---

## SESSION 2 — Delete the Naruto data, make systems read from the World

**Goal:** zero Naruto content in code; every system that used Naruto data now reads `db.world`.

Delete:
- `canonData.ts`, `canonDataMore.ts`, `canonCast.ts`, `canonCastMore.ts`, `canonEndgame.ts`, `nameData.ts`, `yearlyData.ts`, `flashbackData.ts`, `mapShapes.ts`, `hooks.ts`
- `CHARACTER_LORE` and `ERA_NOTES` in `romance.ts`; `GEOGRAPHY_LORE`, `ROADS`, `CLIMATES`, `MAP_PLACES`, `REGION_SHAPES`, `PRICE_GUIDE`, `STARTING_RYO`, `KAN_PARENTS`, `IDENTITIES`, `FAME`, `LABELS`, `KNOWN_AT_START`, `BEARER_TENURE`, `BEARERS_BY_KNOWLEDGE`, `REGION_CHANNEL`, `DISCLOSURES`, `OWNER_KEYS`
- `assets/images/kan-*.jpg`, `vulture-mark.png`, and their references
- Akatsuki cloak detection (inventory → outfit), Leaf auto-listing (`ensureLeafListing`), lore flags (`hasSharingan`, `knowsIzumiDead`, `headbandScratched`)

Generalize (how):
- **`jutsu.ts` → `abilities.ts`**: `JutsuRecord` → `AbilityRecord` (`category` instead of `chakraNature`; categories from `world.abilityCategories`, anything else goes to "Other"). The tracker field `jutsu_used` → `abilities_used`. `JutsuSection` → `AbilitiesSection` titled with `world.abilityLabel`. `natures_gained` → `categories_gained`.
- **`canon.ts` → `timeline.ts`**: same engine (scheduling by date, knowledge classes, encounters, player-driven beats, news queue, escalation, catch-up reports). Reads `db.world.timeline`. Knowledge classes become `public | faction | witnesses | secret` (`faction` = members of `event.factionId`). Bearers: anyone in the scene who could know, then named `bearers`, then a generic local/traveller. Channels come from the faction's `carriers` or `world.letterCarriers`. Remove `canonPoint` text from milestones; keep `state.worldPoint` as a free line the timeline can set.
- **`newsDelivery.ts`**: delivery styles keyed by place kind and knowledge class only, no Naruto couriers.
- **`reputation.ts`**: `villages` → `factions: Record<factionId, {heat, listedOn?, known, standing?}>`. Bingo-book ranks/bounties only for factions with `hasBounties`, paid in `world.currency`. Akatsuki standing → plain `standing` on any faction. `territoryOf` uses `faction.territoryRegionIds`.
- **`renown.ts`**: audiences = the world's factions plus a generic "common folk".
- **`money.ts`**: `ryo` → `amount`; `formatPurseLine` uses `world.currency.name`; price guide text from `world.currency.priceGuide`; start money from `CharacterDefinition.money`.
- **`geography.ts`**: regions and travel days from `world.regions[].neighbours` (shortest path); unknown → 3–9 days as letters already do.
- **`weather.ts`**: a built-in `CLIMATE_TYPES` table (one entry per `ClimateType`, same shape as the old `CLIMATES`). Region → its climate type. `none` → no WEATHER line.
- **`mapData.ts`**: drop coordinates. Keep `recordTravel`, `placeVisits`, `travelEstimate`, `knownWhereabouts`; `placeIdOf` matches `world.places`. `MapSection` becomes a list view (regions → places, your road, people as far as you know) until session 7.
- **`ambience.ts`**: water/forest/village beds keyed by place kind, climate type and location words, never by Naruto place ids.
- **`letters.ts`**: carriers from `world.letterCarriers` with a default speed table (fast/normal/slow); interception by factions with `hasBounties` or a secret-police style flag on the faction (`readsMail?: number`).
- **`names.ts`**: keep labels, learned names, identities (generic `identities` on any entity), recognise-on-sight via an entity field `fame?: 'sight' | 'heard'`. People the player marks `knownName` are known at the start.
- **`romance.ts`**: per-entity `romanceAccessibility`, `canonDevotion`, `orientation` come from the entity (StartingPerson or the tracker). Keep the age rules: adults deflect while the player is under 17, explicit content only when both are 18+.
- **`yearly.ts`**: festivals from `world.festivals`; the player's own dates from the backstory facts; birthdays from entities.
- **`flashbacks.ts`**: engine unchanged; records live in `db.world.flashbacks` (filled in session 4). Empty by default = no offers.
- **`safehouses.ts`**: `base` kind uses faction membership facts and `world.factions`, not `OWNER_KEYS`.
- **Images**: style opener from `world.artStyle`; the face/outfit references are `character.faceImage` / `outfitImage` (optional; without them, describe the player in words); "the model knows the canon cast" logic only when `world.knownUniverse` is set.

Done when: `grep -ri "naruto\|chakra\|jutsu\|ryo\|ryō\|hokage\|uchiha\|akatsuki\|itachi\|konoha\|leaf village\|shinobi\|ninja" lib app components` finds nothing, and types compile.

---

## SESSION 3 — Generic prompts, test seed, tests

**Goal:** the app plays a full story in a test world with no Naruto text in any prompt.

Do:
1. **`NARRATION_SYSTEM`**: rewrite as world-neutral. Keep CORE (never control the player, supplied context is truth, binding threads), TIME, NAMES, STYLE, ROMANCE (age rules), SCENE MODES, ENEMIES, OUTPUT. CANON becomes **WORLD TIMELINE**: never invent timeline events; news only through bearers; for a known universe, stay true to its canon to the level of `canonStrictness`. Delete the Tobi/Pain/Zetsu identity rules (the generic identities rule covers them).
2. Add two cached blocks after the rules, before the slow context: **THE WORLD** (premise, genre, tone, tech/magic, ability label and categories, currency + price guide, factions, regions with travel times, the player's `narratorNotes`) and **WHO YOU ARE** (the CharacterDefinition, backstory verbatim, secrets marked narrator-only). Both change only when the player edits them, so the cache holds.
3. **`STATE_SYSTEM` + `TURN_STATE_SCHEMA`**: rename the fields from session 2 (`abilities_used`, `categories_gained`, faction ids instead of village names, `timeline_completed`/`engaged`/`passed`). Faction and region ids are listed in the tracker prompt so it can reference them.
4. **`seed.ts`**: `seedDatabase(slotId, slotName, world, character, people, opening)` builds the save from those four inputs: the player entity, one entity + bond per StartingPerson, facts from secrets and backstory lines the player marked, threads from `opening.threads`, an opening memory from `opening.situation`, purse, ability records, inventory, the clock at `opening.date`.
5. Add `lib/rpg/testWorld.ts`: a small hand-written fantasy world (one kingdom, 3 regions, 5 places, 2 factions, a currency, a character, 2 starting people, an opening scene). Until session 4, **New story** uses it.
6. **Tests**: delete the Naruto test cases. Rewrite `names`, `enemies`, `living-world-stage2/3/4`, `flashbacks`, `safehouses`, `money`, `immersion`, `fixlist-*` against `testWorld`. Add a test that no prompt (narrator, tracker, summary, image) contains any word from the session 2 grep list.
7. Update `PROJECT_GUIDE.md`: remove every Naruto section, document `db.world`, the two new prompt blocks and the timeline engine.

Done when: `bun test` is green, a 20-turn run in the test world works (clock, memory, bonds, money, abilities, a letter, an image), and Debug shows no Naruto text in any call.

---

## SESSION 4 — Creation wizard (manual first)

**Goal:** the player builds their own world and character in the app.

Screens (`app/new-story/…`, reached from Settings → Stories → New story and from the first launch):
1. **World**: start from blank, a genre preset (fantasy, sci-fi, modern, post-apocalyptic, historical, horror; presets only prefill fields), a saved world template (session 5), or a known universe (a name + canon strictness). Fields: name, premise, genre, tone, tech/magic, ability label + categories, currency + price guide, calendar start, art style, narrator notes.
2. **Places**: regions (name, description, climate type picker, travel days to neighbours), places inside them (name, kind, description), factions (name, description, territory, has bounties, carriers).
3. **Lore**: a list of entries (keywords + text, always-on toggle, hidden-from-player toggle).
4. **You**: every CharacterDefinition field; abilities (name, category, what it does, how it looks); inventory list; starting money; face/outfit image upload (the existing `pickImageFile`).
5. **Backstory**: one big text field, kept verbatim, plus a list of "things that are true" (each becomes a fact; mark who knows it) and secrets.
6. **People**: add/edit StartingPerson cards; mark the dead ("died before the story"), whether the player knows their name, and how each side feels.
7. **Opening**: start place, date and time, what's happening, who's there, starting goals → threads.
8. **Timeline (optional)**: add world events by hand (title, description, date window, region, who knows, player-driven or not).
9. **Review → Start**: shows everything; Start calls `seedDatabase`.

Rules:
- Every field is manual. Each section has one optional **"Help me fill this"** button that sends what the player already wrote and asks the AI to suggest the empty fields only. Suggestions appear as drafts the player accepts, edits or discards; nothing is saved unasked.
- Only name, premise, character name and the opening situation are required. Everything else has a sensible default.
- Drafts autosave (so closing the app doesn't lose the wizard).
- Use the shared list kit (`components/List.tsx`) and theme tokens.

Done when: a story can be created entirely by hand and played, and a test covers `seedDatabase` from wizard output.

---

## SESSION 5 — World editor during play + reusable worlds

**Goal:** change the world mid-story and reuse worlds.

Do:
1. **World editor** (You tab → World, or Settings): edit every world field, lore, factions, regions, places and timeline during play; add a person by hand (creates an entity + optional bond, `met` as the player chooses); edit your own character sheet. Edits take effect next turn (they change the cached blocks, which is fine).
2. **World templates**: "Save this world as a template" (world only, no character or story); "New story in this world". Stored device-side alongside slots.
3. **Export/import** a world template as a JSON file, so Xan can share or back up worlds.

Done when: an edit shows up in the next narrator prompt (checked in Debug), and a template starts a second character in the same world.

---

## SESSION 6 — Import a known universe (optional AI draft)

**Goal:** "I want to live in <universe>" gives a drafted cast and timeline the player edits.

Do:
1. In the World step, when a known universe is set, offer **"Draft from canon"** with toggles: main cast, factions, regions/places, timeline, lore. Ask for an era / start point.
2. One call per toggle (keeps replies small), each returning the plain shape the wizard edits (not save records). Show the drafts in the normal editors; the player accepts per item.
3. Timeline drafts follow the old milestone discipline: real date windows, region, who could know, player-driven beats only if the player asks.
4. Cast drafts set `fame`, `romanceAccessibility`/`canonDevotion`, birthdays when known, and `alive` at the start point.

Done when: drafting a known universe produces editable cast + timeline, and the timeline engine runs those events by date.

---

## SESSION 7 — Extras (pick any, one per session)

- **Backstory flashbacks**: from the backstory + people, the AI proposes memory scenes (title, date, place, cast, triggers, fixed facts, what stays hidden); the player approves each; they go into `db.world.flashbacks` and the existing engine offers them.
- **Drawn map**: the player places regions/places on a simple grid, or an auto-layout from the travel graph; reuse the old map UI with generated shapes.
- **More ambience**: city, sci-fi interior, ship, dungeon beds.
- **App icon**: the name (frbddn) is already in `lib/brand.ts`, `app.json`, the manifest and the service worker cache. Still to do: new icons (`assets/images/icon.png`, `adaptive-icon.png`, `favicon.png`, `public/icon-*.png`, `apple-touch-icon.png`) and the Wordmark's mark; version sync per invariant 12.

---

## Progress log

Update this after every session: date, session number, what was done, what's left, notes for the next session.

- 2026-11-09 — Plan written. No code changed yet. Next: session 1.
- 2026-11-09 — **Session 1 done.** Branch `sandbox-session-1` on `xanpire/forbidden`, app version 2.0.0. `bun test`: 488 pass, 0 fail. `tsc --noEmit`: clean.
  - **Brand:** `lib/brand.ts` has `APP_NAME = 'frbddn'`, `STORAGE_KEYS` and `IDB_NAMES`. Every `kan.*` key and the `kan-saves` / `kan-images` / `kan-debug` databases now use the `frbddn` prefix. The name is also in `app.json` (slug, scheme, bundle ids `com.frbddn.app`), `package.json`, the manifest, `+html.tsx`, the SW cache (`frbddn-shell-…`), the Wordmark, Settings, export file names and the OpenRouter `X-Title`.
  - **Types:** `types.ts` now has `WorldDefinition`, `CharacterDefinition`, `StartingPerson`, `OpeningScene`, `FactionDef` (with `readsMail?`), `RegionDef`, `PlaceDef`, `TimelineEvent` (+ `TimelineKnowledge`, `TimelineWindow`), `FestivalDef`, `AbilityDef` and `ClimateType`. `AppDatabase.world` is added, and `lib/rpg/world.ts` has `emptyWorld`, `normalizeWorld` and `CLIMATE_TYPE_LIST`. `PlayerSheet` is gone: `state.player` is a `CharacterDefinition`. Its fields that play keeps up to date are `birthYear`, `natures` and `abilityStages`. `abilityStages` was called `player.abilities` before; that name now holds the player's own `AbilityDef[]`.
  - **Player helpers:** `lib/rpg/player.ts` has `playerEntity`, `playerName`, `playerId`, `isPlayerEntity`, `isPlayer`, `isPlayerName`, `playerRefs`, `isPlayerRef`, `playerDisplayNames`, `playerAge`, `playerAgeAt` and `normalizeCharacter`. Every `name === 'kan'` check, every local `isKan` and every `'Kan'` literal in logic now goes through them. In the tracker, the player's id is always `player` (`PLAYER_REF` in characterRefs.ts). `convertStateBlock(block, statePlayerOf(db))` takes the player's refs. `secondPerson(text, names)` needs the player's names (`playerDisplayNames(db)`).
  - **Renames:**
    - `kanKnowsDeath`, `kanKnowsName`, `kanKnowsOf`, `kanKnowsLine`, `kanKnowsMask`, `kanKnowsFully` → `playerKnows…`.
    - `readKanInput` / `KanInput` → `readPlayerInput` / `PlayerInput`. `kanThen`, `kanLookAt`, `kanAgeAt` → `playerThen`, `playerLookAt`, `playerAgeAt`. Also `playerRegion`, `playerJutsuFromMessage`, `loadPlayerReferenceImages` and `keepPlayersWords`.
    - Letter directions `to-kan` / `from-kan` → `to-player` / `from-player`. The yearly `kan-birthday` → `player-birthday`. The schema name is now `turn_state`.
    - The tab `kan.tsx` → `you.tsx` (label "You"), and `components/kan/` → `components/player/`.
  - **Prompt and UI text:** narrator, tracker and summary prompts, letters, news, names, flashbacks, grudges, reputation, safehouses, scene mode, the romance rules, the image director, scene images, portraits and retouch all say "the player" / "you" now. So do the UI copy and the code comments. The "Kan is straight" rule became a generic one: romance only with someone whose heart is open to the player. Image prompts name the player with `playerName(db)`. Without a face reference, they describe the player from `state.player.appearance`.
  - **Migrations dropped:** `migrateCanonV2` (and its test), the GEOGRAPHY lore swap, `hiddenAliases` (type, load step and test), `BIRTHDAY_FIXES`, and the names-v1 backfill (`namesVersion`, `NAMES_VERSION`). The generic repairs stay: `normalizeFactKnowers`, `normalizeDeaths`, `repairUnmetLabels`, `dropBareNatureJutsu`, and the identities part of `ensureNames`.
  - **Left for session 2 on purpose.** All of this is Naruto data the plan deletes there, so renaming it now would be wasted. The word "Kan" still appears in:
    - `canonData*.ts`, `canonCast*.ts`, `canonEndgame.ts`, `nameData.ts`, `flashbackData.ts`, `yearlyData.ts`, `hooks.ts` and `mapShapes.ts`.
    - `CHARACTER_LORE` / `ERA_NOTES` in `romance.ts`, and `KAN_PARENTS` in `flashbacks.ts`.
    - Milestone ids like `kan-joins-akatsuki`, read in `lore.ts`, `yearly.ts` and `reputation.ts`.
    - The `kan-*.jpg` assets in `referenceImages.ts`.
    - The Naruto seed in `seed.ts`, whose player is still called Kan until session 3 replaces the seed. The tests still run on that seed, as planned.
  - **Notes for session 2:**
    - `db.world` exists, but nothing reads it yet. The seed sets an empty "Legacy world".
    - `normalizeDatabase` still forces male characters to `romanceAccessibility: 'not-applicable'`, and `ensureCanonCast` still adds the canon cast on load. Both go with the romance and cast work.
    - `TimelineEvent` uses `grantsAbilityRecords` in place of the old `grantsJutsu`, and `worldPoint` in place of `canonPoint`.
    - `WorldDefinition` has no `flashbacks` field yet. Add it when `flashbacks.ts` moves to `db.world`.
- Next: session 2.
