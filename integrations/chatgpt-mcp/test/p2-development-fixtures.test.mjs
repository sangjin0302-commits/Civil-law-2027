import test from 'node:test';
import assert from 'node:assert/strict';
import {rejectDevelopmentP2Items} from '../db/p2-development-fixtures.mjs';
test('known imported fixture is rejected despite sharing legacy source with normal items', () => {
  assert.doesNotThrow(() => rejectDevelopmentP2Items([{stable_key:'SRC-CIV-005|2023-제29회-문2-소문항1',source_document_id:'legacy-db:CIVIL'}]));
  assert.throws(() => rejectDevelopmentP2Items([{stable_key:'SRC-CIV-005|2026-제9001회-문1-소문항1',source_document_id:'legacy-db:CIVIL'}]), /development fixture/);
});
test('test Docs cannot bypass the exclusion with an ordinary-looking problem key', () => {
  assert.throws(() => rejectDevelopmentP2Items([{stable_key:'SRC-CIV-005|2023-제29회-문2-소문항1',source_document_id:'1sdWAsG7EcsO1RrV6Q0U0hHJpOu_9yD5zdKs63y9-N_g'}]), /development fixture/);
});
