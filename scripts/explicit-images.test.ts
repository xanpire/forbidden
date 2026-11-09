// Explicit pictures go through the one picture pipeline (paintScene.ts): the
// same director (with an explicit section), the scene as it is now, the last
// replies, the picture check, and every safeguard before the explicit provider.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => (/runware|wiro/i.test(key) ? 'test-provider-key' : null),
    setItem: async () => undefined,
    removeItem: async () => undefined,
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

type Call = { system: string; user: string };
const calls: { director: Call[]; check: string[]; standard: string[] } = { director: [], check: [], standard: [] };
let directorReply = '';
let directorFails = false;
let checkReply = '{ "roles_ok": true, "extra_people": false, "scene_ok": true, "note": "" }';

// OpenRouter is answered here: the director, the picture check and the standard image model.
const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const address = String(url);
  const body = JSON.parse(String(init?.body ?? '{}')) as { messages?: { role: string; content: unknown }[]; prompt?: string };
  if (address.includes('/chat/completions')) {
    const text = (content: unknown) => (typeof content === 'string' ? content : JSON.stringify(content));
    if (JSON.stringify(body.messages ?? []).includes('image_url')) {
      calls.check.push((body.messages ?? []).map((message) => text(message.content)).join('\n'));
      return json({ choices: [{ message: { content: checkReply } }], usage: {} });
    }
    calls.director.push({ system: text(body.messages?.[0]?.content), user: text(body.messages?.[1]?.content) });
    if (directorFails) return json({ error: { message: 'director down' } }, 500);
    return json({ choices: [{ message: { content: directorReply } }], usage: {} });
  }
  if (address.includes('/images')) {
    calls.standard.push(body.prompt ?? '');
    return json({ data: [{ b64_json: 'c3RhbmRhcmQ=', media_type: 'image/png' }] });
  }
  return realFetch(url, init);
}) as typeof fetch;
beforeAll(() => {
  globalThis.fetch = fakeFetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const { normalizeDatabase } = await import('../lib/rpg/db');
const { PROVIDERS, buildRunwareTask, buildWiroForm } = await import('../lib/explicitProviders');
const { ADULT_NEGATIVE, addExplicitRef, checkDirectorText, cleanSheetField, explicitReferences, referenceSheetPrompt } = await import('../lib/rpg/explicitImages');
const { appendStoryMessage } = await import('../lib/rpg/log');
const { applyStateStep } = await import('../lib/rpg/memoryJobs');
const { paintScene, pictureRoute, retouchSceneImage } = await import('../lib/rpg/paintScene');
const { resolveCharacterRefs } = await import('../lib/rpg/entities');
const { convertStateBlock } = await import('../lib/rpg/stateBlock');
const { resolveTurnMode } = await import('../lib/rpg/sceneMode');
const { SHOT_CHIPS } = await import('../lib/rpg/imageDirection');
const { seedDatabase } = await import('./fixtures/seed');
const { testSeedInput } = await import('./fixtures/testWorld');
type AppDatabase = import('../lib/rpg/types').AppDatabase;

const PLANTED = 'PURPLE ELEPHANT';
const sent: { positive: string; negative: string; references: string[] }[] = [];
PROVIDERS.runware.generate = async (prompt, references) => {
  sent.push({ positive: prompt.positive, negative: prompt.negative, references });
  return { dataUri: 'data:image/png;base64,ZXhwbGljaXQ=', cost: 0.0038 };
};

const caps = { modelId: 'test/image', params: {}, maxReferences: 4, source: 'model', fetchedAt: Date.now() } as Parameters<typeof paintScene>[0]['caps'];

function story(): AppDatabase {
  const input = testSeedInput();
  input.people = input.people.map((person) =>
    person.name === 'Mara Vance'
      ? { ...person, appearance: 'Petite, young-looking, short dark-red hair, sharp green eyes.', intimacy: { orientation: 'men', interestedInPlayer: 'yes', desires: [], boundaries: [] } }
      : person
  );
  input.people.push(
    {
      name: 'Lily',
      gender: 'female',
      role: 'Regular at the bar',
      appearance: 'Curly hair.',
      personality: 'Chatty.',
      speechStyle: 'Fast.',
      relationship: 'friendly',
      yourFeelings: { affinity: 4, note: '' },
      theirFeelings: { affinity: 4, note: '' },
      alive: true,
      knownName: true,
    },
    {
      name: 'Rex Starr',
      age: 40,
      gender: 'male',
      role: 'A famous actor',
      appearance: 'Square jaw.',
      personality: 'Charming.',
      speechStyle: 'Smooth.',
      relationship: 'stranger',
      yourFeelings: { affinity: 0, note: '' },
      theirFeelings: { affinity: 0, note: '' },
      alive: true,
      knownName: true,
      realPerson: true,
    }
  );
  input.opening = { ...input.opening, location: 'Your flat on Kell Street', castNames: ['Mara Vance'] };
  input.world = { ...input.world, artStyle: 'cinematic photo, 35mm film' };
  return normalizeDatabase(seedDatabase('slot_explicit', 'Explicit', input));
}

/** A turn the way game.tsx plays it: the mode first, saved on the reply, then the tracker. */
function play(db: AppDatabase, input: string, narration: string, state: Record<string, unknown>): AppDatabase {
  const mode = resolveTurnMode(db, input).mode;
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  next = { ...next, rawLog: next.rawLog.map((entry) => (entry.id === turnLogId ? { ...entry, sceneMode: mode } : entry)) };
  const reply = convertStateBlock(state).diff;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

const off = { on: null, with: [], phase: null, done: [], ended: null, options: [] };

/** Two people in bed, a bowl of chips, a horror film on the TV. */
function bedScene(): AppDatabase {
  let db = play(story(), '*I pull her down onto the bed.*', `You flop onto the bed with Mara, the ${PLANTED} film flickering on the TV.`, {
    characters_present: ['mara-vance'],
    sex: { ...off, on: true, with: ['mara-vance'] },
    scene_now: { props_added: ['a bowl of chips', 'the TV'], props_removed: [], screens: 'a horror film', mood: 'giddy, half-scared' },
    outfit_changed: [{ character_id: 'mara-vance', outfit: 'an oversized T-shirt', position: 'lying beside you under the duvet', doing: 'watching the film through her fingers' }],
  });
  db = play(db, '*I kiss her neck.*', 'She laughs into your mouth and pulls the duvet over you both.', {
    characters_present: ['mara-vance'],
    sex: { ...off, on: true, with: ['mara-vance'] },
  });
  return db;
}

beforeEach(() => {
  calls.director = [];
  calls.check = [];
  calls.standard = [];
  sent.length = 0;
  directorFails = false;
  directorReply =
    'ACTION: Alex Reyes and Mara Vance lie in bed under the duvet, Mara pulling her T-shirt over her head while Alex kisses her neck; a bowl of chips on the duvet, a horror film on the TV lighting the dark room.\nSHOT: from above, high angle, the TV glow on their skin\nCAPTION: You and Mara in bed with the film flickering.';
  checkReply = '{ "roles_ok": true, "extra_people": false, "scene_ok": true, "note": "" }';
});

describe('one pipeline', () => {
  test('a sexual scene goes to the explicit provider; other pictures where Settings says', () => {
    const db = bedScene();
    expect(pictureRoute(db)).toEqual({ kind: 'explicit', provider: 'runware', sexual: true });
    const plain = story();
    expect(pictureRoute(plain).kind).toBe('standard');
    expect(pictureRoute({ ...plain, settings: { ...plain.settings, picturesOn: 'explicit' } })).toEqual({ kind: 'explicit', provider: 'runware', sexual: false });
  });

  test('the director sees the whole scene: both people, the props, the screen, positions, clothes and the last replies', async () => {
    const base = bedScene();
    const db = { ...base, settings: { ...base.settings, imageModelCaps: { ...(caps as object), modelId: base.settings.imageModel, fetchedAt: Date.now() } as never } };
    const result = await paintScene({ apiKey: 'k', db, caps, updateSettings: async () => undefined });
    expect(result.refSheets.map((sheet) => sheet.entityId).sort()).toEqual(db.entities.filter((e) => ['Alex Reyes', 'Mara Vance'].includes(e.name)).map((e) => e.id).sort());
    const director = calls.director[0];
    expect(director.system).toContain('This is a sexual scene between adults');
    expect(director.system).toContain('never give an age');
    expect(director.user).toContain('In the scene: a bowl of chips, the TV.');
    expect(director.user).toContain('On screen: a horror film.');
    expect(director.user).toContain('position: lying beside you under the duvet');
    expect(director.user).toContain('wearing: an oversized T-shirt');
    expect(director.user).toContain('doing: watching the film through her fingers');
    expect(director.user).toContain('EARLIER IN THE SCENE');
    expect(director.user).toContain('You flop onto the bed with Mara');

    // The provider gets the director's description with everyone and everything in it.
    expect(sent).toHaveLength(1);
    const prompt = sent[0].positive;
    expect(prompt).toContain('Alex Reyes: an adult man, 29 years old, with a fully adult body');
    expect(prompt).toContain('Mara Vance: an adult woman, 31 years old, with a fully adult body');
    expect(prompt).toContain('a bowl of chips');
    expect(prompt).toContain('a horror film on the TV');
    expect(prompt).toContain('SHOT: from above');
    expect(sent[0].negative).toBe(ADULT_NEGATIVE);
    expect(result.takes[0].meta).toMatchObject({ provider: 'runware', cost: 0.0038 });
    expect(calls.standard.some((text) => text.includes('Character reference sheet'))).toBe(true);
    // The check is told who, where, what they wear and the key props.
    expect(calls.check[0]).toContain('Who must be in it: Alex Reyes, Mara Vance');
    expect(calls.check[0]).toContain('Mara Vance: an oversized T-shirt');
    expect(calls.check[0]).toContain('a bowl of chips');
  });

  test('the picture check redraws once on a miss', async () => {
    const db = bedScene();
    let n = 0;
    const original = checkReply;
    checkReply = '{ "roles_ok": true, "extra_people": false, "scene_ok": false, "note": "the chips are missing" }';
    const result = await paintScene({ apiKey: 'k', db, caps });
    n = sent.length;
    expect(n).toBe(2);
    expect(sent[1].positive).toContain('did not match the scene (the chips are missing)');
    expect(result.takes[0].meta.mightBeOff).toBe(true);
    checkReply = original;
  });
});

describe('safeguards', () => {
  test('raw story text never goes to the image model: no director description, no picture', async () => {
    const db = bedScene();
    directorFails = true;
    await expect(paintScene({ apiKey: 'k', db, caps })).rejects.toThrow('couldn’t be planned');
    expect(sent).toHaveLength(0);
    expect(calls.standard.filter((text) => !text.includes('Character reference sheet'))).toHaveLength(0);
  });

  test('a planted phrase in the story never reaches the prompt; the director writes a new description', async () => {
    const db = bedScene();
    await paintScene({ apiKey: 'k', db, caps });
    expect(calls.director[0].user).toContain(PLANTED);
    expect(sent[0].positive).not.toContain(PLANTED);
    expect(JSON.stringify(buildRunwareTask({ positive: sent[0].positive, negative: ADULT_NEGATIVE, references: [] }, [], 'm'))).not.toContain(PLANTED);
    expect(String(buildWiroForm({ positive: sent[0].positive, negative: ADULT_NEGATIVE, references: [] }, []).get('prompt'))).toBe(sent[0].positive);
  });

  test('a childlike word, an age or a real person in the description drops the picture', async () => {
    const db = bedScene();
    for (const bad of ['Mara giggles like a schoolgirl in bed with Alex Reyes.', 'Mara Vance, 19 years old, lies with Alex Reyes.', 'Alex Reyes and the young woman Mara lie in bed.', 'Rex Starr watches Mara Vance and Alex Reyes in bed.']) {
      directorReply = `ACTION: ${bad}\nSHOT: close-up\nCAPTION: x`;
      await expect(paintScene({ apiKey: 'k', db, caps })).rejects.toThrow('No picture');
    }
    expect(sent).toHaveLength(0);
    expect(checkDirectorText(db, 'Mara Vance kisses Alex Reyes.')).toEqual({ ok: true });
  });

  test('looks and ages come only from the checked sheets, cleaned of anything that pulls younger', async () => {
    expect(cleanSheetField('Petite, young-looking, short dark-red hair, sharp green eyes.')).toBe('short dark-red hair, sharp green eyes.');
    const db = bedScene();
    await paintScene({ apiKey: 'k', db, caps });
    expect(sent[0].positive).not.toMatch(/petite|young/i);
    expect(calls.director[0].system).toContain("Never describe anyone's age, body type, face or hair");
  });

  test('anyone under 18 or with no stated age blocks the explicit picture', async () => {
    let db = bedScene();
    db = { ...db, state: { ...db.state, sceneCast: ['Mara Vance', 'Lily'] } };
    directorReply = 'ACTION: Lily and Mara Vance lie in bed with Alex Reyes.\nSHOT: wide\nCAPTION: x';
    await expect(paintScene({ apiKey: 'k', db, caps })).rejects.toThrow('No picture: Lily has no stated age');
    const young = { ...bedScene(), state: { ...bedScene().state, player: { ...bedScene().state.player, age: 17, birthYear: 2009 } } };
    await expect(paintScene({ apiKey: 'k', db: young, caps })).rejects.toThrow('No picture');
    expect(sent).toHaveLength(0);
  });

  test('uploaded photos are never references for explicit pictures, and explicit pictures are never retouched on the standard model', async () => {
    let db = bedScene();
    const mara = db.entities.find((e) => e.name === 'Mara Vance')!.id;
    const player = db.entities.find((e) => e.tags.includes('player'))!.id;
    db = {
      ...db,
      state: { ...db.state, player: { ...db.state.player, faceImage: 'img:uploaded-player-face', outfitImage: 'img:uploaded-outfit' } },
      characterFaces: [{ entityId: mara, image: 'img:uploaded-mara-face', addedAt: 1 }],
      characterPortraits: [{ id: 'c1', entityId: mara, image: 'img:mara-from-face', signature: {} as never, usedFace: true, inStoryDate: db.state.inStoryDate, createdAt: 1 }],
    };
    expect(explicitReferences(db, [player, mara])).toEqual([]);
    db = addExplicitRef(db, player, 'img:player-sheet');
    db = addExplicitRef(db, mara, 'img:mara-sheet');
    expect(explicitReferences(db, [player, mara]).map((ref) => ref.image)).toEqual(['img:player-sheet', 'img:mara-sheet']);
    expect(referenceSheetPrompt(db, mara)).toContain('31 years old, with a fully adult face and body');
    expect(referenceSheetPrompt(db, mara)).not.toMatch(/explicit|nude/i);

    const painted = await paintScene({ apiKey: 'k', db, caps });
    expect(JSON.stringify(sent[0])).not.toMatch(/uploaded|from-face/);
    const entry = db.rawLog.filter((item) => item.role === 'assistant').at(-1)!;
    const withPicture = { ...db, rawLog: db.rawLog.map((item) => (item.id === entry.id ? { ...item, image: 'img:x', imageMeta: painted.takes[0].meta } : item)) };
    await expect(retouchSceneImage({ apiKey: 'k', db: withPicture, caps, logId: entry.id, image: 'data:x', tweak: 'brighter' })).rejects.toThrow('standard pictures only');
  });
});

describe('on request only, and the intimate shot chips', () => {
  test('nothing paints by itself; the intimate chips exist', () => {
    const labels = SHOT_CHIPS.filter((chip) => chip.intimate).map((chip) => chip.label);
    expect(labels).toEqual(['Close', 'From above', 'POV', 'Wide room']);
    const db = bedScene();
    expect(db.rawLog.some((entry) => entry.image)).toBe(false);
  });
});
