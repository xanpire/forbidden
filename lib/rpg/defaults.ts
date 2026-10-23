import type { MemoryIndex, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  narrationModel: 'deepseek/deepseek-v4.1-flash-1017',
  summaryModel: 'deepseek/deepseek-v4.1-flash-1017',
  extractionModel: 'deepseek/deepseek-v4.1-flash-1017',
  contextMessages: 10,
  retrievalLimit: 4,
  autoSummarizeThreshold: 16,
  temperature: 0.7,
  maxTokens: 900,
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
