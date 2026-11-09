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

import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from './fixtures/seed';
import {
  buildRetouchPrompt,
  buildSceneImagePrompt,
  directorContext,
  parseImageAction,
  personReferenceSlots,
  sceneCharacterReferences,
  usePreviousForStyle,
} from '../lib/rpg/image';
import {
  colourAccent,
  impactFrameAllowed,
  lightLine,
  recentShots,
  shotTypeOf,
} from '../lib/rpg/imageDirection';
import { packPeopleReferences } from '../lib/rpg/castSheet';
import { parseImageCheck, sharperActorRule } from '../lib/rpg/imageCheck';
import { planReferences } from '../lib/rpg/referencePlan';
import { currentRegion } from '../lib/rpg/geography';
import type { AppDatabase, RawLogEntry } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_director', 'Director'));

function reply(db: AppDatabase, content: string, extra: Partial<RawLogEntry> = {}): AppDatabase {
  const entry: RawLogEntry = {
    id: `log_${db.rawLog.length + 1}`,
    turn: db.rawLog.length + 1,
    kind: 'story',
    role: 'assistant',
    content,
    model: 'm',
    promptTokens: 0,
    completionTokens: 0,
    chapter: 1,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    createdAt: Date.now(),
    ...extra,
  };
  return { ...db, rawLog: [...db.rawLog, entry] };
}

const at = (db: AppDatabase, hour: number, condition: 'clear' | 'snow' | 'storm' = 'clear'): AppDatabase => {
  const date = { ...db.state.inStoryDate, hour, minute: 0 };
  return {
    ...db,
    state: {
      ...db.state,
      inStoryDate: date,
      location: 'Coast Road',
      locationKind: 'road',
      weather: { region: currentRegion({ ...db, state: { ...db.state, location: 'Coast Road' } }), condition, since: date, source: 'story', sceneSeq: db.state.sceneSeq },
    },
  };
};

describe('the director', () => {
  test('reads ACTION, SHOT and CAPTION, in any order, and survives a missing SHOT', () => {
    const full = parseImageAction(
      'ACTION: Alex Reyes slams the thug into the wall.\nSHOT: low angle, wide-angle distortion, Alex lower third, focus: Alex\nCAPTION: You slam him into the wall.'
    );
    expect(full.action).toBe('Alex Reyes slams the thug into the wall.');
    expect(full.shot).toContain('low angle');
    expect(full.caption).toBe('You slam him into the wall.');

    const old = parseImageAction('ACTION: Alex waits.\nCAPTION: You wait.');
    expect(old.shot).toBeUndefined();
    expect(old.action).toBe('Alex waits.');

    expect(parseImageAction('Alex waits in the rain.').action).toBe('Alex waits in the rain.');
  });

  test('shot types come from the opening words', () => {
    expect(shotTypeOf('extreme close-up, worm’s-eye')).toBe('extreme close-up');
    expect(shotTypeOf('close-up on his face, a wide sky behind')).toBe('close-up');
    expect(shotTypeOf("aerial, bird's-eye over the crater")).toBe('aerial');
    expect(shotTypeOf('ensemble, line-up in a staggered V')).toBe('ensemble');
    expect(shotTypeOf('impact frame, inverted')).toBe('impact frame');
    expect(shotTypeOf('dutch tilt')).toBeNull();
  });

  test('the director reads mood, weather, recent shots and a key moment', () => {
    let db = at(seed(), 18, 'storm');
    db = { ...db, state: { ...db.state, mood: 'furious' } };
    db = reply(db, 'Earlier.', { image: 'img:a', imageMeta: { prompt: '', action: '', shot: 'close-up, eye level', shotType: 'close-up', references: [], model: 'x', createdAt: 0 } });
    db = reply(db, 'You hurl the bottle through the bar window.', { imageWorthy: true });

    const context = directorContext(db)!;
    expect(context).toContain("Alex Reyes's mood: furious");
    expect(context).toContain('thunder');
    expect(context).toContain('This is a key moment: go big.');
    expect(context).toContain('"close-up, eye level"');

    const chip = directorContext(db, { chip: 'epic' })!;
    expect(chip).toContain('The player asked for this shot: extreme wide');
    expect(chip).not.toContain('go big');
  });

  test('impact frames stay rare and recent shots are tracked', () => {
    let db = seed();
    expect(impactFrameAllowed(db)).toBe(true);
    db = reply(db, 'Bang.', { image: 'img:a', imageMeta: { prompt: '', action: '', shot: 'impact frame', references: [], model: 'x', createdAt: 0 } });
    expect(impactFrameAllowed(db)).toBe(false);
    expect(recentShots(db)).toEqual(['impact frame']);
    for (let i = 0; i < 5; i += 1) {
      db = reply(db, 'Calm.', { image: 'img:b', imageMeta: { prompt: '', action: '', shot: 'wide', references: [], model: 'x', createdAt: 0 } });
    }
    expect(impactFrameAllowed(db)).toBe(true);
  });
});

describe('the scene prompt', () => {
  test('vision first: style opener, SHOT, ACTION before the references and rules', () => {
    const db = reply(at(seed(), 12), 'You wait.');
    const prompt = buildSceneImagePrompt(db, [{ kind: 'face', uri: 'data:f' }], 'Alex waits on a cliff.', {
      shot: 'extreme wide, tiny in frame',
    });
    const lines = prompt.split('\n');
    expect(lines[0]).toContain('cinematic photo, 35mm film');
    expect(prompt.indexOf('SHOT:')).toBeLessThan(prompt.indexOf('ACTION'));
    expect(prompt.indexOf('ACTION')).toBeLessThan(prompt.indexOf('Reference image 1'));
    expect(prompt.indexOf('Reference image 1')).toBeLessThan(prompt.indexOf('ACTOR RULE'));
    expect(prompt).not.toContain('Timeline:');
    expect(prompt).not.toContain('Cinematic dark anime illustration');
    expect(prompt).not.toContain('guarded expression');
    // A scale shot allows tiny faceless figures.
    expect(prompt).toContain('tiny, distant, faceless figures');
  });

  test('light comes from the real weather and clock, never hard-coded rain', () => {
    const noon = buildSceneImagePrompt(reply(at(seed(), 12), 'x'), [], 'Alex waits.');
    expect(noon).toContain('harsh noon sun');
    expect(noon).not.toMatch(/\brain\b/);

    expect(lightLine(at(seed(), 5, 'snow'), 'Alex waits.')).toContain('dawn');
    expect(lightLine(at(seed(), 5, 'snow'), 'Alex waits.')).toContain('snow');
    expect(lightLine(at(seed(), 18), 'Alex waits.')).toContain('golden hour');
    expect(colourAccent('Police sirens wail down the street')).toContain('red and blue');
    expect(colourAccent('Lightning splits the sky over the harbour')).toContain('white-blue');
  });

  test('the style opener is the world\'s art style', () => {
    const db = reply(at(seed(), 12), 'x');
    const painted = { ...db, world: { ...db.world, artStyle: 'loose watercolour illustration' } };
    expect(buildSceneImagePrompt(painted, [], 'Alex waits.').split('\n')[0]).toContain('loose watercolour illustration');
  });

  test('references are identity-only and the previous image is style-only', () => {
    const db = reply(seed(), 'x');
    const prompt = buildSceneImagePrompt(
      db,
      [
        { kind: 'face', uri: 'data:f' },
        { kind: 'cast', uri: 'data:c', names: ['Mara Vance', 'Daniel Okafor'] },
        { kind: 'previous', uri: 'data:p' },
      ],
      'Alex stands between Mara and Daniel.',
      { shot: 'ensemble, line-up' }
    );
    expect(prompt).toContain('Identity only');
    expect(prompt).toContain('Reference image 2 is a cast sheet: left to right Mara Vance, Daniel Okafor.');
    expect(prompt).toContain('rendering style and line quality only, not composition');
    expect(prompt).toContain('Ensemble:');
  });

  test('the previous image only guides style when the shot type matches', () => {
    let db = seed();
    expect(usePreviousForStyle(db, 'close-up')).toBe(true);
    db = reply(db, 'x', { image: 'img:a', imageMeta: { prompt: '', action: '', shotType: 'aerial', references: [], model: 'x', createdAt: 0 } });
    expect(usePreviousForStyle(db, 'close-up')).toBe(false);
    expect(usePreviousForStyle(db, 'aerial')).toBe(true);
  });

  test('people without a reference get look tags from their appearance', () => {
    const db = reply(seed(), 'x');
    const prompt = buildSceneImagePrompt(db, [], 'Alex faces Mara Vance across the bar.');
    expect(prompt).toContain('How the others look:');
    expect(prompt).toContain('Mara Vance');
    expect(prompt).toContain('dark-red hair');
  });

  test('the retouch prompt edits the same image and keeps the player’s face', () => {
    const plan = planReferences([{ kind: 'face', uri: 'data:f' }, { kind: 'edit', uri: 'data:e' }], 4);
    expect(plan.references.map((ref) => ref.kind)).toEqual(['edit', 'face']);
    const prompt = buildRetouchPrompt('make him angrier', plan.references, 'Alex Reyes');
    expect(prompt).toContain('Edit this image: make him angrier.');
    expect(prompt).toContain('Keep everything else the same');
    expect(prompt).toContain('Reference image 2: Alex Reyes');
  });
});

describe('ensembles', () => {
  test('person slots follow the model, not a fixed three', () => {
    expect(personReferenceSlots(8)).toBe(6);
    expect(personReferenceSlots(1)).toBe(0);
  });

  test('more people than slots go onto cast sheets of up to six', async () => {
    const people = Array.from({ length: 8 }, (_, i) => ({ name: `P${i}`, uri: `data:${i}` }));
    const drawn: string[][] = [];
    const draw = async (group: { name: string }[]) => {
      drawn.push(group.map((person) => person.name));
      return 'data:sheet';
    };

    const two = await packPeopleReferences(people, 2, draw);
    expect(two.map((ref) => ref.kind)).toEqual(['cast', 'cast']);
    expect(drawn).toEqual([['P0', 'P1', 'P2', 'P3'], ['P4', 'P5', 'P6', 'P7']]);

    const fits = await packPeopleReferences(people.slice(0, 2), 3, draw);
    expect(fits.map((ref) => ref.kind)).toEqual(['character', 'character']);

    // No canvas: one per slot, the first ones first.
    const none = await packPeopleReferences(people, 2, async () => null);
    expect(none.map((ref) => ref.name)).toEqual(['P0', 'P1']);

    expect(await packPeopleReferences(people, 0, draw)).toEqual([]);
  });
});

describe('the swapped-roles check', () => {
  test('reads its JSON and sharpens the actor rule', () => {
    expect(parseImageCheck('```json\n{"roles_ok": false, "extra_people": true, "note": "Alex is the one choked."}\n```')).toEqual({
      rolesOk: false,
      extraPeople: true,
      note: 'Alex is the one choked.',
    });
    expect(parseImageCheck('no idea')).toBeNull();
    const rule = sharperActorRule('Alex chokes the thug.', { rolesOk: false, extraPeople: true, note: 'Alex is the one choked.' });
    expect(rule).toContain('Alex is the one DOING the action');
    expect(rule).toContain('only the people the ACTION names');
  });
});
