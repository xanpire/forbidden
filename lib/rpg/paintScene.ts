// Painting a picture, start to finish, for every picture the app makes: the
// director frames the moment from the latest replies and the scene as it is
// now, the references are planned (cast sheets for big scenes), the image is
// made (one or two takes), and the picture check runs and redraws once on a
// miss. Also the quick retouch. Only the last step differs for an explicit
// picture: the checked prompt goes to the explicit provider (Runware or
// Wiro), with in-app reference sheets only (explicitImages.ts). Pictures are
// only ever made when the player asks. The Story screen only shows results.

import { generateImage, type ImageModelCaps } from '../openrouter';
import { PROVIDERS, explicitModel, loadProviderKey } from '../explicitProviders';
import { resolveEntity } from './entities';
import { EXPLICIT_PROVIDERS, checkPictureCast, explicitScenePrompt, missingReferences, type ExplicitProviderId } from './explicitImages';
import { mentionsEntity } from './characterRefs';
import { loadImages } from './imageStore';
import { paintReferenceSheet } from './paintExplicit';
import { sexPartners, sexualMove } from './sexMode';
import { packPeopleReferences } from './castSheet';
import { recordDebugImage, recordDebugSideCall } from './debug';
import {
  buildRetouchPrompt,
  buildSceneImagePrompt,
  collectRecentSceneImages,
  personReferenceSlots,
  sceneCharacterReferences,
  usePreviousForStyle,
  writeImageAction,
  ENSEMBLE_CAST_LIMIT,
  SCENE_CAST_LIMIT,
} from './image';
import { checkSceneImage, expectedScene, imageCheckEnabled, sharperActorRule, type ImageCheck } from './imageCheck';
import { wantsEnsemble, type ShotChip, type ShotType } from './imageDirection';
import { loadImage } from './imageStore';
import { faceDroppedWarning, loadPlayerReferenceImages, planReferences, type PlannedReference } from './referenceImages';
import type { AppDatabase, EntityRecord, SceneImageMeta } from './types';
import { playerEntity, playerName } from './player';

export type PaintedTake = { dataUri: string; meta: SceneImageMeta };

/** Where a picture goes: the standard image model, or an explicit provider. */
export type PictureRoute = { kind: 'standard' } | { kind: 'explicit'; provider: ExplicitProviderId; sexual: boolean };

/** A sexual scene is under way, or the latest reply was part of one. */
export function sexualMoment(db: AppDatabase): boolean {
  if (sexPartners(db).length > 0) return true;
  const latest = [...db.rawLog].reverse().find((message) => message.kind === 'story' && message.role === 'assistant');
  return latest?.intimate === true;
}

/**
 * A sexual moment always goes to the explicit provider. Everything else goes
 * where Settings says: the standard image model (default) or the explicit
 * provider for all pictures.
 */
export function pictureRoute(db: AppDatabase): PictureRoute {
  const provider = db.settings.explicitProvider ?? 'wiro';
  if (sexualMoment(db)) return { kind: 'explicit', provider, sexual: true };
  if (db.settings.picturesOn === 'explicit') return { kind: 'explicit', provider, sexual: false };
  return { kind: 'standard' };
}

/** Everyone in an explicit picture: the sex partners, anyone the action names, and the player when they are part of it. */
export function pictureCast(db: AppDatabase, action: string): EntityRecord[] {
  const player = playerEntity(db);
  const people = new Map<string, EntityRecord>();
  for (const id of sexPartners(db)) {
    const entity = db.entities.find((item) => item.id === id);
    if (entity) people.set(entity.id, entity);
  }
  for (const name of db.state.sceneCast ?? []) {
    const entity = resolveEntity(db, name);
    if (entity && entity.type === 'character' && mentionsEntity(action, entity)) people.set(entity.id, entity);
  }
  const named = player && mentionsEntity(action, player);
  const ordered = [...people.values()].filter((entity) => !entity.tags.includes('player'));
  return player && (named || sexPartners(db).length > 0) ? [player, ...ordered] : ordered;
}

function recordCheck(turnId: string, apiKey: string, check: ImageCheck | null) {
  if (check) {
    recordDebugSideCall(turnId, { kind: 'imageCheck', model: check.model, usage: check.usage, apiKey });
  }
}

/** Paints the latest reply. Two takes when asked; each comes back with its record. */
export async function paintScene({
  apiKey,
  db,
  caps,
  chip,
  takes = 1,
  onWarning,
  updateSettings,
}: {
  apiKey: string;
  db: AppDatabase;
  caps: ImageModelCaps;
  chip?: ShotChip;
  takes?: 1 | 2;
  onWarning?: (message: string) => void;
  /** For reference sheets painted on the standard model before an explicit picture. */
  updateSettings?: (patch: Partial<AppDatabase['settings']>) => Promise<void>;
}): Promise<{ turnId: string; takes: PaintedTake[]; refSheets: { entityId: string; image: string }[] }> {
  const latestAssistant = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');

  if (!latestAssistant) {
    throw new Error('Start the story first — there’s nothing to paint yet.');
  }

  const turnId = latestAssistant.id;
  let route = pictureRoute(db);
  const written = await writeImageAction(apiKey, db, undefined, { chip, explicit: route.kind === 'explicit' && route.sexual });

  // Raw story text never goes to an image model: without the director's own description there is no picture.
  if (!written) {
    throw new Error('The picture couldn’t be planned (the director model didn’t answer). Try again.');
  }

  recordDebugSideCall(turnId, { kind: 'imageAction', model: written.model, usage: written.usage, apiKey });

  const action = written.action;
  const shot = written.shot;
  const shotType = written.shotType ?? null;

  if (route.kind === 'explicit') {
    const cast = checkPictureCast(db, pictureCast(db, action));
    if (!cast.ok) {
      // A sexual picture with anyone who fails the adult checks is never made;
      // any other picture goes to the standard model instead.
      if (route.sexual) throw new Error(`No picture: ${cast.reason}.`);
      onWarning?.(`This one goes to the standard image model: ${cast.reason}.`);
      route = { kind: 'standard' };
    } else {
      return paintExplicitScene({ apiKey, db, turnId, route, written: { action, shot, shotType, caption: written.caption }, people: cast.members.map((member) => member.entity), takes, updateSettings, onWarning });
    }
  }

  const recentRefs = collectRecentSceneImages(db);
  const [recentLoaded, playerRefImages] = await Promise.all([
    Promise.all(recentRefs.map((ref) => loadImage(ref))),
    loadPlayerReferenceImages(db),
  ]);
  const ensemble = wantsEnsemble(chip, shotType);
  // People named in the action with a face reference or a portrait.
  const sceneRefs = sceneCharacterReferences(db, action, ensemble ? ENSEMBLE_CAST_LIMIT : SCENE_CAST_LIMIT);
  const loaded = await Promise.all(
    sceneRefs.map(async (person) => ({
      name: person.name,
      uri: (await loadImage(person.image)) ?? '',
      source: person.source,
      ref: person.image,
    }))
  );
  const people = await packPeopleReferences(loaded, personReferenceSlots(caps.maxReferences));

  // Which stored image each sent reference came from, for the image's record.
  const refOf = new Map<string, string>();
  loaded.forEach((person) => person.uri && refOf.set(person.uri, person.ref));
  recentLoaded.forEach((uri, index) => uri && refOf.set(uri, recentRefs[index]));
  // The last image guides rendering style only when it was framed the same way.
  const recentImages = usePreviousForStyle(db, shotType)
    ? recentLoaded.filter((uri): uri is string => Boolean(uri))
    : [];

  const plan = planReferences(
    [
      { kind: 'face', uri: playerRefImages.face },
      { kind: 'outfit', uri: playerRefImages.outfit },
      ...people,
      ...recentImages.map((uri) => ({ kind: 'previous' as const, uri })),
      { kind: 'alternate', uri: playerRefImages.alternate },
    ],
    caps.maxReferences
  );

  if (plan.faceDropped) {
    onWarning?.(faceDroppedWarning(plan.faceDropped, caps.modelId));
  }

  const prompt = buildSceneImagePrompt(db, plan.references, action, { shot, shotType });
  const inputReferences = plan.references.map((reference) => reference.uri);

  const makeOne = async (text: string) => {
    const startedAt = Date.now();
    const result = await generateImage({ apiKey, caps, prompt: text, inputReferences });
    recordDebugImage(turnId, 'image', caps.modelId, result.cost, Date.now() - startedAt);
    return result.dataUri;
  };

  const metaFor = (text: string, mightBeOff: boolean): SceneImageMeta => ({
    prompt: text,
    action,
    ...(written.caption ? { caption: written.caption } : {}),
    ...(db.state.location ? { location: db.state.location } : {}),
    ...(shot ? { shot } : {}),
    ...(shotType ? { shotType } : {}),
    ...(mightBeOff ? { mightBeOff: true } : {}),
    references: plan.references.map((reference) => referenceRecord(reference, refOf)),
    model: caps.modelId,
    createdAt: Date.now(),
  });

  const takesOut = await drawWithCheck({ apiKey, db, turnId, action, prompt, takes, makeOne: (text) => makeOne(text), metaFor });
  return { turnId, takes: takesOut, refSheets: [] };
}

const SEXUAL_PHOTO = /\b(nude|naked|topless|bottomless|lingerie|underwear|bra|panties|explicit|nsfw|undress\w*|bare (?:breasts?|chest|ass)|breasts?|nipples?|cock|dick|pussy|ass|spread|touching (?:herself|himself|themselves))\b/i;

/**
 * A picture someone sent by text, painted when the player opens it. The
 * texting model's description is the director's line; the sender is the only
 * person in it. A sexual photo goes to the explicit provider (with the same
 * adult checks); any other follows the Settings route.
 */
export async function paintTextPhoto({
  apiKey,
  db,
  caps,
  senderId,
  description,
  updateSettings,
  onWarning,
}: {
  apiKey: string;
  db: AppDatabase;
  caps: ImageModelCaps;
  senderId: string;
  description: string;
  updateSettings?: (patch: Partial<AppDatabase['settings']>) => Promise<void>;
  onWarning?: (message: string) => void;
}): Promise<{ take: PaintedTake; refSheets: { entityId: string; image: string }[] }> {
  const sender = db.entities.find((entity) => entity.id === senderId);

  if (!sender) throw new Error('No picture: nobody to paint.');

  const turnId = [...db.rawLog].reverse().find((entry) => entry.role === 'assistant')?.id ?? '';
  const action = `${sender.name}'s photo, sent by text: ${description}`;
  const written = { action, shot: 'a phone photo as sent by text: phone camera, casual framing, natural light', shotType: 'close-up' as ShotType, caption: `${sender.name} sent you this.` };
  const provider = db.settings.explicitProvider ?? 'wiro';
  const sexual = SEXUAL_PHOTO.test(description) || sexualMove(description);
  const route: PictureRoute = sexual ? { kind: 'explicit', provider, sexual: true } : db.settings.picturesOn === 'explicit' ? { kind: 'explicit', provider, sexual: false } : { kind: 'standard' };

  if (route.kind === 'explicit') {
    const cast = checkPictureCast(db, [sender]);

    if (cast.ok) {
      const result = await paintExplicitScene({ apiKey, db, turnId, route, written, people: [sender], takes: 1, updateSettings, onWarning });
      return { take: result.takes[0], refSheets: result.refSheets };
    }
    if (route.sexual) throw new Error(`No picture: ${cast.reason}.`);
  }

  const refs = sceneCharacterReferences(db, action, 1);
  const loaded = await Promise.all(refs.map(async (person) => ({ kind: 'character' as const, uri: (await loadImage(person.image)) ?? '', name: person.name, source: person.source })));
  const plan = planReferences(loaded.filter((item) => item.uri), caps.maxReferences);
  const prompt = buildSceneImagePrompt(db, plan.references, action, { shot: written.shot, shotType: written.shotType });
  const makeOne = async (text: string) => {
    const startedAt = Date.now();
    const result = await generateImage({ apiKey, caps, prompt: text, inputReferences: plan.references.map((reference) => reference.uri) });
    recordDebugImage(turnId, 'image', caps.modelId, result.cost, Date.now() - startedAt);
    return result.dataUri;
  };
  const metaFor = (text: string, mightBeOff: boolean): SceneImageMeta => ({
    prompt: text,
    action,
    caption: written.caption,
    shot: written.shot,
    ...(mightBeOff ? { mightBeOff: true } : {}),
    references: plan.references.map((reference) => ({ kind: reference.kind, ...(reference.name ? { name: String(reference.name) } : {}) })),
    model: caps.modelId,
    createdAt: Date.now(),
  });
  const takes = await drawWithCheck({ apiKey, db, turnId, action, prompt, takes: 1, makeOne, metaFor });

  return { take: takes[0], refSheets: [] };
}

/**
 * One or two takes, then the picture check: a miss (roles swapped, someone
 * missing, the wrong position, clothes or props) is redrawn once with a
 * sharper rule; extra people are only flagged.
 */
async function drawWithCheck({
  apiKey,
  db,
  turnId,
  action,
  prompt,
  takes,
  makeOne,
  metaFor,
}: {
  apiKey: string;
  db: AppDatabase;
  turnId: string;
  action: string;
  prompt: string;
  takes: 1 | 2;
  makeOne: (text: string) => Promise<string>;
  metaFor: (text: string, mightBeOff: boolean) => SceneImageMeta;
}): Promise<PaintedTake[]> {
  const check = imageCheckEnabled(db);
  const expected = expectedScene(db, action);
  const off = (result: ImageCheck | null) => Boolean(result && (!result.rolesOk || result.extraPeople || result.missing));

  if (takes === 2) {
    const images = await Promise.all([makeOne(prompt), makeOne(prompt)]);
    const checks = check ? await Promise.all(images.map((image) => checkSceneImage(apiKey, db, image, action, expected))) : [null, null];
    checks.forEach((result) => recordCheck(turnId, apiKey, result));
    return images.map((image, index) => ({ dataUri: image, meta: metaFor(prompt, off(checks[index])) }));
  }

  const first = await makeOne(prompt);
  if (!check) return [{ dataUri: first, meta: metaFor(prompt, false) }];

  const firstCheck = await checkSceneImage(apiKey, db, first, action, expected);
  recordCheck(turnId, apiKey, firstCheck);

  // Only a real miss is worth a second picture; extra people are flagged.
  if (!firstCheck || (firstCheck.rolesOk && !firstCheck.missing)) {
    return [{ dataUri: first, meta: metaFor(prompt, Boolean(firstCheck?.extraPeople)) }];
  }

  const retryPrompt = `${prompt}\n${sharperActorRule(action, firstCheck)}`;

  try {
    const second = await makeOne(retryPrompt);
    const secondCheck = await checkSceneImage(apiKey, db, second, action, expected);
    recordCheck(turnId, apiKey, secondCheck);

    if (!secondCheck || (secondCheck.rolesOk && !secondCheck.missing)) {
      return [{ dataUri: second, meta: metaFor(retryPrompt, Boolean(secondCheck?.extraPeople)) }];
    }

    // Both missed: keep the one with fewer problems, flagged.
    const score = (result: ImageCheck) => Number(!result.rolesOk) + Number(result.missing) + Number(result.extraPeople);
    return [score(secondCheck) < score(firstCheck) ? { dataUri: second, meta: metaFor(retryPrompt, true) } : { dataUri: first, meta: metaFor(prompt, true) }];
  } catch {
    return [{ dataUri: first, meta: metaFor(prompt, true) }];
  }
}

/**
 * The explicit picture: the same director, check and takes, with the checked
 * prompt sent to the explicit provider and only in-app reference sheets. Anyone
 * without a sheet gets one painted on the standard model first, from their
 * written appearance only.
 */
async function paintExplicitScene({
  apiKey,
  db,
  turnId,
  route,
  written,
  people,
  takes,
  updateSettings,
  onWarning,
}: {
  apiKey: string;
  db: AppDatabase;
  turnId: string;
  route: Extract<PictureRoute, { kind: 'explicit' }>;
  written: { action: string; shot?: string; shotType: string | null; caption?: string };
  people: EntityRecord[];
  takes: 1 | 2;
  updateSettings?: (patch: Partial<AppDatabase['settings']>) => Promise<void>;
  onWarning?: (message: string) => void;
}): Promise<{ turnId: string; takes: PaintedTake[]; refSheets: { entityId: string; image: string }[] }> {
  const adapter = PROVIDERS[route.provider];
  const providerKey = await loadProviderKey(route.provider);
  if (!providerKey) {
    throw new Error(`Add your ${route.provider === 'runware' ? 'Runware' : 'Wiro'} key in Settings to make this picture.`);
  }

  // Reference sheets keep faces and bodies the same from picture to picture.
  let working = db;
  const refSheets: { entityId: string; image: string }[] = [];
  if (updateSettings) {
    for (const entity of missingReferences(db, people.map((person) => person.id))) {
      try {
        const image = await paintReferenceSheet(working, entity.id, apiKey, updateSettings);
        refSheets.push({ entityId: entity.id, image });
        working = { ...working, explicitRefs: [...(working.explicitRefs ?? []), { entityId: entity.id, image, createdAt: Date.now() }] };
      } catch {
        onWarning?.(`No reference sheet for ${entity.name} yet; their looks come from their sheet's words only.`);
      }
    }
  }

  const prompt = explicitScenePrompt(working, people, written, { maxReferences: adapter.caps.maxReferences });
  const references = (await loadImages(prompt.references.map((ref) => ref.image))).filter((uri): uri is string => Boolean(uri));
  const model = explicitModel(route.provider, db.settings);
  let cost = 0;
  let priced = false;

  const makeOne = async (text: string) => {
    const startedAt = Date.now();
    const result = await adapter.generate({ ...prompt, positive: text }, references, { apiKey: providerKey, model });
    if (typeof result.cost === 'number') {
      cost += result.cost;
      priced = true;
    }
    recordDebugImage(turnId, 'image', `${route.provider}:${model}`, result.cost ?? null, Date.now() - startedAt, EXPLICIT_PROVIDERS.find((item) => item.id === route.provider)?.estimate);
    return result.dataUri;
  };

  const metaFor = (text: string, mightBeOff: boolean): SceneImageMeta => ({
    prompt: text,
    action: written.action,
    ...(written.caption ? { caption: written.caption } : {}),
    ...(db.state.location ? { location: db.state.location } : {}),
    ...(written.shot ? { shot: written.shot } : {}),
    ...(written.shotType ? { shotType: written.shotType } : {}),
    ...(mightBeOff ? { mightBeOff: true } : {}),
    references: prompt.references.map((reference) => ({ kind: reference.label, name: people.find((person) => person.id === reference.entityId)?.name, ref: reference.image })),
    model,
    provider: route.provider,
    ...(priced ? { cost } : {}),
    createdAt: Date.now(),
  });

  const takesOut = await drawWithCheck({ apiKey, db: working, turnId, action: written.action, prompt: prompt.positive, takes, makeOne, metaFor });
  return { turnId, takes: takesOut, refSheets };
}

function referenceRecord(reference: PlannedReference, refOf: Map<string, string>) {
  const name = reference.kind === 'cast' ? reference.names?.join(', ') : reference.name;

  return {
    kind: reference.kind,
    ...(name ? { name: String(name) } : {}),
    ...(refOf.get(reference.uri) ? { ref: refOf.get(reference.uri) } : {}),
  };
}

/**
 * The quick retouch (#12): edits an existing scene image with a short tweak
 * instead of painting a new one. Sends the image and the player's face.
 */
export async function retouchSceneImage({
  apiKey,
  db,
  caps,
  logId,
  image,
  tweak,
}: {
  apiKey: string;
  db: AppDatabase;
  caps: ImageModelCaps;
  logId: string;
  /** The image as shown (a data URI). */
  image: string;
  tweak: string;
}): Promise<PaintedTake> {
  if (caps.maxReferences === 0) {
    throw new Error(`${caps.modelId} can’t take an image to edit. Pick a reference-capable image model in Settings.`);
  }

  const entry = db.rawLog.find((item) => item.id === logId);
  // An explicit picture is never sent to the standard model, or next to an uploaded photo.
  if (entry?.imageMeta?.provider) {
    throw new Error('Retouch works on standard pictures only. Paint this moment again instead.');
  }
  const playerRefImages = await loadPlayerReferenceImages(db);
  const plan = planReferences(
    [
      { kind: 'edit', uri: image },
      { kind: 'face', uri: playerRefImages.face },
    ],
    caps.maxReferences
  );
  const prompt = buildRetouchPrompt(tweak, plan.references, playerName(db));
  const startedAt = Date.now();
  const result = await generateImage({
    apiKey,
    caps,
    prompt,
    inputReferences: plan.references.map((reference) => reference.uri),
  });
  recordDebugImage(logId, 'image', caps.modelId, result.cost, Date.now() - startedAt);

  const old = entry?.imageMeta;

  return {
    dataUri: result.dataUri,
    meta: {
      ...(old ?? { action: '', references: [] }),
      prompt,
      tweak: tweak.trim().slice(0, 200),
      ...(entry?.image ? { previous: entry.image } : {}),
      mightBeOff: undefined,
      model: caps.modelId,
      createdAt: Date.now(),
    },
  };
}
