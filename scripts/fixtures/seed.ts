// seedDatabase for the tests: the app's seedDatabase, with the test fixture as
// the default input (the app itself has no default story).
import { seedDatabase as seedApp } from '../../lib/rpg/seed';
import type { SeedInput } from '../../lib/rpg/types';
import { testSeedInput } from './testWorld';

export function seedDatabase(slotId: string, slotName: string, input: SeedInput = testSeedInput()) {
  return seedApp(slotId, slotName, input);
}
