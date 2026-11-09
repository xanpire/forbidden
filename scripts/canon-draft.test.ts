// Session 6: drafting a real period or known grounded setting.
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

import { acceptCanonItem, canonDraftMessages, parseCanonDraft, type CanonRequest } from '../lib/rpg/canonDraft';
import { normalizeDatabase } from '../lib/rpg/db';
import { isDeceased } from '../lib/rpg/deaths';
import { canBeIntimate } from '../lib/rpg/intimacy';
import { seedDatabase } from './fixtures/seed';
import { advanceTimeline, hasFired } from '../lib/rpg/timeline';
import { draftToSeedInput, emptyDraft, type WizardDraft } from '../lib/rpg/wizard';

function victorian(): WizardDraft {
  const draft = emptyDraft();
  return {
    ...draft,
    world: {
      ...draft.world,
      name: 'London, 1888',
      premise: 'Fog, gaslight and a city that never stops talking.',
      era: { when: 'past', period: 'London, autumn 1888' },
      knownUniverse: { name: 'Victorian London', canonStrictness: 'faithful' },
      currency: { name: 'pounds', priceGuide: 'a pint 2d; a cab 1s' },
    },
    character: { ...draft.character, name: 'Eliza Hart', age: 27, role: 'Seamstress' },
    opening: { location: 'Whitechapel', date: { year: 1888, month: 9, day: 1, hour: 20, minute: 0 }, situation: 'The fog rolls in off the river.', castNames: [], threads: [] },
  };
}

const request = (kind: CanonRequest['kind'], personalBeats = false): CanonRequest => ({ kind, setting: 'Victorian London', startPoint: 'September 1888', personalBeats });

describe('draft from canon', () => {
  test('the prompts ask for a grounded world, adults only, and real people as background', () => {
    const [system, user] = canonDraftMessages(request('cast'), victorian());
    expect(system.content).toContain('no magic, powers, supernatural beings');
    expect(system.content).toContain('adult with a stated age of 18 or older');
    expect(system.content).toContain('realPerson true');
    expect(user.content).toContain('Start point: September 1888');
  });

  test('a setting that needs magic is refused', () => {
    expect(parseCanonDraft(request('cast'), '{"error": "needs magic or powers"}', victorian())).toEqual({ items: [], error: "Can't draft this setting: needs magic or powers." });
  });

  test('cast drafts: adults only, real people background only, hearts and fame kept', () => {
    const reply = JSON.stringify({
      people: [
        { name: 'Inspector Frederick Abberline', age: 45, gender: 'male', role: 'Police inspector', realPerson: true, fame: 'heard', alive: true, openToRomance: true },
        { name: 'Mary Kelly', age: 25, gender: 'female', role: 'Lodger in Miller\'s Court', realPerson: true, fame: null, alive: true, openToRomance: true },
        { name: 'Thomas Reed', age: 32, gender: 'male', role: 'Printer', realPerson: false, fame: null, alive: true, heartTaken: 'his wife Ada', birthday: { month: 4, day: 2 } },
        { name: 'Annie Doyle', age: 29, gender: 'female', role: 'Barmaid', realPerson: false, openToRomance: true, alive: true },
        { name: 'Billy the Errand Boy', age: 12, gender: 'male', role: 'Errand boy', realPerson: false },
        { name: 'Nobody Knows', gender: 'female', role: 'Stranger', realPerson: false },
      ],
    });
    const { items } = parseCanonDraft(request('cast'), reply, victorian());
    const people = items.flatMap((item) => (item.kind === 'person' ? [item.value] : []));
    expect(people.map((person) => person.name)).toEqual(['Inspector Frederick Abberline', 'Mary Kelly', 'Thomas Reed', 'Annie Doyle']);
    const abberline = people[0];
    expect(abberline).toMatchObject({ realPerson: true, fame: 'heard', knownName: true, met: false });
    expect(abberline.intimacy).toBeUndefined();
    expect(people[1].intimacy).toBeUndefined();
    expect(canBeIntimate({ age: abberline.age, realPerson: abberline.realPerson }).ok).toBe(false);
    expect(people[2]).toMatchObject({ birthday: { month: 4, day: 2 }, intimacy: { interestedInPlayer: 'taken', devotion: 'his wife Ada' } });
    expect(people[3].intimacy?.interestedInPlayer).toBe('could-grow');
  });

  test('places link up both ways; timeline events are dated, placed and personal only when asked', () => {
    let draft = victorian();
    const places = parseCanonDraft(
      request('places'),
      JSON.stringify({
        regions: [
          { name: 'Whitechapel', description: 'Crowded, poor, loud.', climate: 'rainy', travelDaysTo: {} },
          { name: 'Westminster', description: 'Parliament and money.', climate: 'rainy', travelDaysTo: { Whitechapel: 0.05 } },
        ],
        places: [{ name: 'The Ten Bells', region: 'Whitechapel', kind: 'structure', description: 'A pub on Commercial Street.' }],
      }),
      draft
    );
    for (const item of places.items) draft = acceptCanonItem(draft, item);
    const [whitechapel, westminster] = draft.world.regions;
    expect(westminster.neighbours).toEqual([{ id: whitechapel.id, days: 0.05 }]);
    expect(whitechapel.neighbours).toEqual([{ id: westminster.id, days: 0.05 }]);
    expect(draft.world.places[0].regionId).toBe(whitechapel.id);

    const reply = JSON.stringify({
      timeline: [
        { title: 'Murder on Hanbury Street', description: 'A woman is found dead in a yard on Hanbury Street.', year: 1888, month: 9, day: 8, region: 'Whitechapel', knowledge: 'public', major: true, deaths: ['Annie Doyle'], personal: false },
        { title: 'A letter to the press', description: 'A taunting letter reaches the Central News Agency.', year: 1888, month: 9, day: 27, region: 'Westminster', knowledge: 'public', major: false, deaths: [], personal: true },
        { title: 'Undated rumour', description: 'No date.', knowledge: 'public' },
      ],
    });
    const withoutPersonal = parseCanonDraft(request('timeline'), reply, draft).items;
    expect(withoutPersonal).toHaveLength(2);
    expect(withoutPersonal.every((item) => item.kind === 'event' && !item.value.playerDriven)).toBe(true);
    const withPersonal = parseCanonDraft(request('timeline', true), reply, draft).items;
    expect(withPersonal[1].kind === 'event' && withPersonal[1].value.playerDriven).toBe(true);
    for (const item of withoutPersonal) draft = acceptCanonItem(draft, item);
    expect(draft.world.timeline[0]).toMatchObject({ title: 'Murder on Hanbury Street', from: { year: 1888, month: 9, day: 8 }, regionId: whitechapel.id, deaths: ['Annie Doyle'] });
  });

  test('a drafted cast and timeline become a save whose timeline runs by date', () => {
    let draft = victorian();
    const cast = parseCanonDraft(
      request('cast'),
      JSON.stringify({ people: [{ name: 'Annie Doyle', age: 29, gender: 'female', role: 'Barmaid', alive: true }] }),
      draft
    );
    const timeline = parseCanonDraft(
      request('timeline'),
      JSON.stringify({ timeline: [{ title: 'Murder on Hanbury Street', description: 'A woman is found dead on Hanbury Street.', year: 1888, month: 9, day: 8, knowledge: 'public', major: true, deaths: ['Annie Doyle'] }] }),
      draft
    );
    for (const item of [...cast.items, ...timeline.items]) draft = acceptCanonItem(draft, item);

    const db = normalizeDatabase(seedDatabase('slot_canon', 'Canon', draftToSeedInput(draft)));
    expect(db.world.timeline[0].id).toBe('murder-on-hanbury-street');
    expect(hasFired(db, 'murder-on-hanbury-street')).toBe(false);

    const later = advanceTimeline({ ...db, state: { ...db.state, inStoryDate: { year: 1888, month: 9, day: 10, hour: 9, minute: 0, second: 0 } } }, { inCombat: false });
    expect(hasFired(later, 'murder-on-hanbury-street')).toBe(true);
    expect(isDeceased(later.entities.find((entity) => entity.name === 'Annie Doyle')!)).toBe(true);
  });
});
