const ALLOWED_MODEL_ORIGINS = new Set([
  'null',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);

export function assistantModelCorsHeaders(origin) {
  if (!ALLOWED_MODEL_ORIGINS.has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
}
