// What the app has spent, per provider: pictures made and money, for this
// session and this month. Kept on this device, outside any save. A provider's
// returned price is used when there is one; otherwise pictures get an
// estimate (marked as one) and text calls are counted as unpriced.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { STORAGE_KEYS } from './brand';

export type CostProvider = 'openrouter' | 'runware' | 'wiro';

export type CostLine = {
  /** Pictures made (image calls). */
  images: number;
  /** Text calls (narrator, memory, summaries, director, checks). */
  textCalls: number;
  /** Dollars the provider reported. */
  cost: number;
  /** Dollars estimated where the provider didn't say. */
  estimated: number;
  /** Calls with no price at all. */
  unpriced: number;
};

export type CostTotals = Record<CostProvider, CostLine>;
type Stored = { month: string; totals: CostTotals };

const empty = (): CostTotals => ({
  openrouter: { images: 0, textCalls: 0, cost: 0, estimated: 0, unpriced: 0 },
  runware: { images: 0, textCalls: 0, cost: 0, estimated: 0, unpriced: 0 },
  wiro: { images: 0, textCalls: 0, cost: 0, estimated: 0, unpriced: 0 },
});

function thisMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

let session = empty();
let month: Stored = { month: thisMonth(), totals: empty() };
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (!loaded) {
    loaded = AsyncStorage.getItem(STORAGE_KEYS.costs)
      .then((raw) => {
        const stored = raw ? (JSON.parse(raw) as Stored) : null;
        if (stored && stored.month === thisMonth() && stored.totals) month = { month: stored.month, totals: { ...empty(), ...stored.totals } };
      })
      .catch(() => undefined);
  }
  return loaded;
}

function add(totals: CostTotals, provider: CostProvider, entry: { image: boolean; cost: number | null; estimate?: number }) {
  const line = totals[provider];
  if (entry.image) line.images += 1;
  else line.textCalls += 1;
  if (typeof entry.cost === 'number') line.cost += entry.cost;
  else if (typeof entry.estimate === 'number') line.estimated += entry.estimate;
  else line.unpriced += 1;
}

/** Which provider a model id belongs to ("runware:runware:101@1" style ids come from explicit pictures). */
export function providerOf(model: string): CostProvider {
  return /^runware:/.test(model) ? 'runware' : /^wiro:/.test(model) ? 'wiro' : 'openrouter';
}

/** Records one call. `estimate` is used only when the provider returned no price. */
export function recordCost(entry: { provider: CostProvider; image: boolean; cost: number | null; estimate?: number }) {
  add(session, entry.provider, entry);
  void load().then(() => {
    if (month.month !== thisMonth()) month = { month: thisMonth(), totals: empty() };
    add(month.totals, entry.provider, entry);
    void AsyncStorage.setItem(STORAGE_KEYS.costs, JSON.stringify(month)).catch(() => undefined);
    for (const listener of listeners) listener();
  });
}

/** A price that turned up later (OpenRouter's generation lookup) for a call already counted as unpriced. */
export function settleCost(provider: CostProvider, cost: number) {
  const settle = (line: CostLine) => {
    line.cost += cost;
    if (line.unpriced > 0) line.unpriced -= 1;
  };
  settle(session[provider]);
  void load().then(() => {
    settle(month.totals[provider]);
    void AsyncStorage.setItem(STORAGE_KEYS.costs, JSON.stringify(month)).catch(() => undefined);
    for (const listener of listeners) listener();
  });
}

/** This session's and this month's totals, kept up to date. */
export function useCosts(): { session: CostTotals; month: CostTotals; monthLabel: string } {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((tick) => tick + 1);
    listeners.add(listener);
    void load().then(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return { session, month: month.totals, monthLabel: month.month };
}

function money(value: number) {
  return value === 0 ? '$0' : value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

/** One provider's line in Settings → Costs. */
export function costLineText(line: CostLine): string {
  const parts = [
    line.textCalls ? `${line.textCalls} text call${line.textCalls === 1 ? '' : 's'}` : '',
    line.images ? `${line.images} picture${line.images === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (parts.length === 0) return 'Nothing yet';
  const spent = [
    line.cost ? money(line.cost) : '',
    line.estimated ? `about ${money(line.estimated)} (estimate)` : '',
  ].filter(Boolean);
  return [
    parts.join(', '),
    spent.length ? spent.join(' + ') : '',
    line.unpriced ? `${line.unpriced} without a price` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function resetCostsForTests() {
  session = empty();
  month = { month: thisMonth(), totals: empty() };
  loaded = Promise.resolve();
}
