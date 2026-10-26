import type { MemoryIndex, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  narrationModel: 'deepseek/deepseek-v4.1-flash-1017',
  summaryModel: 'deepseek/deepseek-v4.1-flash-1017',
  extractionModel: 'deepseek/deepseek-v4.1-flash-1017',
  imageModel: 'google/gemini-3.1-flash-image',
  contextMessages: 8,
  retrievalLimit: 4,
  autoSummarizeThreshold: 12,
  temperature: 0.7,
  maxTokens: 1100,
  canonProgress: true,
  autoAdvanceTime: true,
};

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
