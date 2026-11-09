// Backstory flashbacks (session 7): from the player's backstory and people,
// the AI proposes memory scenes; the player approves each, and approved ones
// go into world.flashbacks, where the existing flashback engine offers them
// at fitting moments. Nothing is added unless approved.
import { makeId, slug } from './id';
import { playerName } from './player';
import type { AppDatabase, FlashbackRecord, LocationKind, OpenRouterMessage } from './types';

export function flashbackDraftMessages(db: AppDatabase): OpenRouterMessage[] {
  const player = db.state.player;
  const people = db.entities
    .filter((entity) => entity.type === 'character' && !entity.tags.includes('player'))
    .slice(0, 12)
    .map((entity) => `${entity.name} (${entity.role ?? 'someone'})`);
  const system = [
    "You propose short playable memories from a roleplay character's life before the story begins, drawn only from what the player wrote. Never invent major new facts; a memory shows a moment the backstory implies.",
    'Grounded in reality: no magic or powers. Nothing sexual involving anyone under 18; memories from childhood stay innocent.',
    'Reply with one JSON object: {"memories": [{"title": string, "year": number, "month": number, "day": number, "place": string, "kind": one of settlement|structure|road|wilderness, "cast": [names from the list], "scene": string (what the scene is, two sentences), "fixed": string[] (what the memory cannot change), "hidden": string[] (what it must never reveal), "triggerWords": string[] (words in the present that bring it back), "triggerPeople": [names], "memoryLine": string (the memory in one sentence, second person)}]}. At most 4.',
  ].join('\n');
  const user = [
    `The player: ${playerName(db)}, ${player.age}, ${player.role}.`,
    `Born: ${player.birthYear ?? db.state.inStoryDate.year - player.age}. The story starts in ${db.state.inStoryDate.year}.`,
    `Backstory, in the player's words:\n${player.backstory || '(none written)'}`,
    people.length ? `People: ${people.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strs = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
const KINDS: LocationKind[] = ['settlement', 'structure', 'road', 'wilderness'];

/** Proposed memories, checked: dated before the story, cast limited to people in it. */
export function parseFlashbackDraft(db: AppDatabase, text: string): FlashbackRecord[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let json: { memories?: unknown };
  try {
    json = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const names = new Set(db.entities.filter((entity) => entity.type === 'character').map((entity) => entity.name));
  const now = db.state.inStoryDate;
  const existing = db.world.flashbacks.length;
  const memories = Array.isArray(json.memories) ? json.memories : [];
  return memories
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((raw) => {
      const year = Number(raw.year);
      const month = Math.max(1, Math.min(12, Math.round(Number(raw.month) || 1)));
      const day = Math.max(1, Math.min(28, Math.round(Number(raw.day) || 1)));
      const kind = str(raw.kind) as LocationKind;
      const title = str(raw.title);
      return { raw, year, month, day, kind, title };
    })
    .filter(({ title, year, month }) => title && Number.isFinite(year) && (year < now.year || (year === now.year && month < now.month)))
    .slice(0, 4)
    .map(({ raw, year, month, day, kind, title }, index) => ({
      id: `${slug(title) || 'memory'}-${makeId('fb').slice(-4)}`,
      number: existing + index + 1,
      title,
      date: { year: Math.round(year), month, day, hour: 18, minute: 0, second: 0 },
      place: str(raw.place) || 'somewhere you remember',
      locationKind: KINDS.includes(kind) ? kind : 'structure',
      cast: strs(raw.cast).filter((name) => names.has(name)),
      scene: str(raw.scene),
      hint: strs(raw.triggerWords).join(', '),
      triggers: {
        words: strs(raw.triggerWords).map((word) => word.toLowerCase()).slice(0, 6),
        people: strs(raw.triggerPeople).filter((name) => names.has(name)),
      },
      fixed: strs(raw.fixed),
      hidden: strs(raw.hidden),
      memoryLine: str(raw.memoryLine) || title,
      importance: 4 as const,
    }));
}

export function approveFlashback(db: AppDatabase, record: FlashbackRecord): AppDatabase {
  if (db.world.flashbacks.some((item) => item.id === record.id)) return db;
  return { ...db, world: { ...db.world, flashbacks: [...db.world.flashbacks, { ...record, number: db.world.flashbacks.length + 1 }] } };
}
