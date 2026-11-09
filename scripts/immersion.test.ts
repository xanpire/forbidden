import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

import { buildCharacterPortraitPrompt, characterPortraitSignature } from '../lib/rpg/characterPortrait';
import { normalizeDatabase } from '../lib/rpg/db';
import { grudgeKnown, howTheySeem, shownField, shownProfile } from '../lib/rpg/disclosure';
import { buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from '../lib/rpg/seed';
import type { AppDatabase, EntityRecord } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_immersion', 'Immersion'));
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const hear = (db: AppDatabase, milestoneId: string): AppDatabase => ({
  ...db,
  state: {
    ...db.state,
    canonProgress: {
      ...db.state.canonProgress!,
      heard: { ...(db.state.canonProgress?.heard ?? {}), [`event_canon_${milestoneId}`]: db.state.inStoryDate },
    },
  } as AppDatabase['state'],
});

describe('profiles show only what Kan could know', () => {
  // TODO session 3: rewrite against testWorld (uses the old Naruto seed).
  test.skip("Sasori's real body stays hidden until he falls; the narrator still knows", () => {
    const db = seed();
    const sasori = person(db, 'Sasori');

    expect(sasori.appearance).toContain('red-haired');
    expect(shownField(db, sasori, 'appearance')).not.toContain('red-haired');
    expect(shownField(hear(db, 'sasori-falls'), sasori, 'appearance')).toContain('red-haired');
  });

  // TODO session 3: rewrite against testWorld (uses the old Naruto seed).
  test.skip("the masked man's profile gives nothing away", () => {
    const db = seed();
    const profile = shownProfile(db, person(db, 'Tobi'));

    expect(profile.role).not.toContain('hidden hand');
    expect(profile.personality).not.toContain('true self');
    expect(profile.speechStyle).not.toContain('Tobi');
  });

  // TODO session 3: rewrite against testWorld (uses the old Naruto seed).
  test.skip('Kabuto is a Leaf medic until his spying is known; Minato is only the Fourth Hokage', () => {
    const db = seed();

    expect(shownField(db, person(db, 'Kabuto Yakushi'), 'role')).toBe('Leaf medical ninja');
    expect(shownField(hear(db, 'kabuto-embedded'), person(db, 'Kabuto Yakushi'), 'role')).toContain('Spy');
    expect(shownField(db, person(db, 'Minato Namikaze'), 'role')).toBe('Fourth Hokage');
  });

  test('what the story itself wrote shows as it is', () => {
    const db = seed();
    const sasori: EntityRecord = { ...person(db, 'Sasori'), appearance: 'A red-haired youth stepping out of a broken puppet.' };

    expect(shownField(db, sasori, 'appearance')).toBe('A red-haired youth stepping out of a broken puppet.');
  });

  // TODO session 3: rewrite against testWorld (uses the old Naruto seed).
  test.skip("portraits are painted from Kan's view", () => {
    const db = seed();
    const sasori = person(db, 'Sasori');
    const prompt = buildCharacterPortraitPrompt(db, sasori, characterPortraitSignature(db, sasori), []);

    expect(prompt).not.toContain('red-haired');
  });
});

describe('feelings and grudges', () => {
  test('their feelings read as words, not numbers', () => {
    expect(howTheySeem(-8)).toBe('hostile');
    expect(howTheySeem(-2)).toBe('guarded');
    expect(howTheySeem(0)).toBe('hard to read');
    expect(howTheySeem(5)).toBe('warm');
    expect(howTheySeem(10)).toBe('devoted');
  });

  test('a grudge is known only once they have acted on it', () => {
    expect(grudgeKnown(undefined)).toBe(false);
    expect(grudgeKnown({ strikes: 0 })).toBe(false);
    expect(grudgeKnown({ strikes: 1 })).toBe(true);
  });

  test('the narrator still gets the full truth', () => {
    const db = { ...seed(), state: { ...seed().state, sceneCast: ['Sasori'] } };
    const text = buildNarrationPrompt(db, '*You look at Sasori.*').messages.map((message) => message.content).join('\n');

    expect(text).toContain('red-haired');
  });
});
