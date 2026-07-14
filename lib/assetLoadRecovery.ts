const RECOVERABLE_ASSET_LOAD_PATTERNS = [
  'Failed to fetch dynamically imported module',
  'Importing a module script failed',
  'error loading dynamically imported module',
  'is not a valid JavaScript MIME type',
  'Expected a JavaScript-or-Wasm module script',
];

export const isRecoverableAssetLoadError = (error: Pick<Error, 'name' | 'message'>): boolean => {
  const message = error.message || '';
  return error.name === 'ChunkLoadError' || RECOVERABLE_ASSET_LOAD_PATTERNS.some(pattern => message.includes(pattern));
};
