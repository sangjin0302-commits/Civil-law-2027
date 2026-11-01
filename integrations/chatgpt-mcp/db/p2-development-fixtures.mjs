// Explicit developer-created fixture exceptions, not an inference from exam numbering.
// Legacy imported fixtures share legacy-db:CIVIL with normal source documents.
const fixtureKeys = new Set([
  'SRC-CIV-005|2026-제9001회-문1-소문항1',
  'SRC-CIV-005|2026-제9001회-문1-소문항2',
]);
const fixtureDocuments = new Set([
  '1W9WZwSsM6OyJFo37lAnfa-at_SeM5TINNy1JTI2_2w4',
  '1sdWAsG7EcsO1RrV6Q0U0hHJpOu_9yD5zdKs63y9-N_g',
]);
export function rejectDevelopmentP2Items(items) {
  if (items.some(item => fixtureKeys.has(item.stable_key) || fixtureDocuments.has(item.source_document_id))) {
    throw new Error('development fixture is not eligible for learning score storage');
  }
}
