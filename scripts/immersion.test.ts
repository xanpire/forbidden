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
describe('profiles show what the save holds', () => {
  test('profile fields are what the player wrote or the story kept; secrets live in facts', () => {
    const db = seed();
    const mara = person(db, 'Mara Vance');
    const profile = shownProfile(db, mara);

    expect(profile.role).toBe(mara.role);
    expect(profile.appearance).toContain('dark-red hair');
    expect(shownField(db, mara, 'personality')).toBe(mara.personality);
    // The player's secret is never on a profile field.
    expect(Object.values(profile).join(' ')).not.toContain('shipments');
  });

  test('what the story itself wrote shows as it is', () => {
    const db = seed();
    const mara: EntityRecord = { ...person(db, 'Mara Vance'), appearance: 'Soaked through, laughing, hair plastered to her face.' };

    expect(shownField(db, mara, 'appearance')).toBe('Soaked through, laughing, hair plastered to her face.');
  });

  test('portraits are painted from the written look', () => {
    const db = seed();
    const mara = person(db, 'Mara Vance');
    const prompt = buildCharacterPortraitPrompt(db, mara, characterPortraitSignature(db, mara), []);

    expect(prompt).toContain('dark-red hair');
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
    const db = { ...seed(), state: { ...seed().state, sceneCast: ['Mara Vance'] } };
    const text = buildNarrationPrompt(db, '*You look at Mara.*').messages.map((message) => message.content).join('\n');

    expect(text).toContain('dark-red hair');
  });
});
