// The models the phone app offers (on-device-ai: src/lib/chat-models.ts). Keep in sync.
export const MODELS = [
  { id: 'gemma4-e2b', name: 'Gemma 4 E2B' },
  { id: 'lfm2.5-1.2b', name: 'LFM 2.5 1.2B' },
  { id: 'qwen3-1.7b', name: 'Qwen 3 1.7B' },
  { id: 'lfm2.5-vl-450m', name: 'LFM 2.5 Vision 450M' },
  { id: 'lfm2.5-350m', name: 'LFM 2.5 350M' },
] as const;
