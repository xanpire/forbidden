import type { MemoryIndex, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  narrationModel: 'google/gemini-3.8-flash',
  summaryModel: 'google/gemini-3.8-flash',
  extractionModel: 'deepseek/deepseek-v4.1-flash-1017',
  imageModel: 'google/gemini-nano-banana-2.1',
  contextMessages: 16,
  retrievalLimit: 4,
  autoSummarizeThreshold: 12,
  temperature: 0.7,
  maxTokens: 5000,
  canonProgress: true,
  promptTokenBudget: 9500,
};

/** Choices offered in Settings for the narrator's prompt budget. */
export const PROMPT_BUDGET_OPTIONS = [6000, 8000, 9500, 12000] as const;

export function normalizePromptBudget(value: unknown): number {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SETTINGS.promptTokenBudget;
  return Math.min(16000, Math.max(4000, Math.round(number)));
}

export function emptyIndex(): MemoryIndex {
  return {
    eventsByTag: {},
    eventsByEntity: {},
    eventsByDate: {},
    factsBySubject: {},
    threadsByStatus: {},
    loreByKeyword: {},
  };
}
