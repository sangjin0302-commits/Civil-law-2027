import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotFromGoogleDoc } from '../db/google-docs-snapshot.mjs';
import { registerDiscoveredDocument } from '../db/drive-document-registry.mjs';
import { findCrossDocumentDuplicates } from '../db/sync-drive-folder-documents.mjs';
import { applyApprovedSyncCandidate } from '../db/google-docs-sync.mjs';

test('registered non-civil Docs preserve subject and never infer grading keys', () => {
  const document = { documentId: 'isolated-doc', revisionId: 'r1', title: 'Local only', body: { content: [
    { startIndex: 1, paragraph: { elements: [{ textRun: { content: '[Q1] local | O\n' } }] } },
    { startIndex: 20, paragraph: { elements: [{ textRun: { content: '지문: Local fixture.\n' } }] } },
  ] } };
  const source = 'SRC-CONSTITUTION-AUTO-' + 'a'.repeat(32);
  const snapshot = snapshotFromGoogleDoc(document, source, 'P1', 'CONSTITUTION');
  assert.equal(snapshot.subjectId, 'CONSTITUTION');
  assert.equal(snapshot.problems[0].gradingKeyVersion, null);
  assert.throws(() => snapshotFromGoogleDoc(document, source, 'P1', 'COMMERCIAL'), /unapproved/);
  assert.throws(() => snapshotFromGoogleDoc(document, source, 'P2', 'CONSTITUTION'), /unsupported subject stage/);
});

test('registry rejects reuse under another subject before document updates', async () => {
  const queries = [];
  const client = { query: async (sql) => {
    queries.push(sql);
    if (sql.startsWith('SELECT 1')) return { rowCount: 1 };
    if (sql.startsWith('SELECT source_id')) return { rowCount: 1, rows: [{ subject_id: 'CIVIL', stage: 'P1' }] };
    return { rowCount: 0 };
  } };
  await assert.rejects(registerDiscoveredDocument(client, { documentId: 'document-id-1234',
    folderId: 'folder-id-12345', title: 'Local only', subjectId: 'CONSTITUTION', stage: 'P1' }), /subject or stage mismatch/);
  assert.ok(queries.includes('ROLLBACK'));
  assert.ok(!queries.some(sql => sql.startsWith('UPDATE')));
});

test('cross-document duplicate lookup scopes identical IDs to the selected subject', async () => {
  let parameters;
  await findCrossDocumentDuplicates({ query: async (sql, args) => {
    assert.match(sql, /p.subject_id=\$3/); parameters = args; return { rows: [] };
  } }, { subjectId: 'COMMERCIAL', documentId: 'doc', problems: [{ stableKey: 'source|Q1', promptDigest: 'd' }] });
  assert.equal(parameters[2], 'COMMERCIAL');
});

test('applying a registered non-civil candidate writes only its persisted subject', async () => {
  const writes = [];
  const client = { release() {}, query: async (sql, args = []) => {
    if (sql.includes('FROM sync_candidates c')) return { rowCount: 1, rows: [{
      candidate_id: 'candidate', subject_id: 'COMMERCIAL', state: 'PENDING', candidate_kind: 'NEW',
      stable_key: 'SRC-COMMERCIAL-AUTO-local|Q1', document_id: 'doc', revision_id: 'r1',
      prompt_changed: true, candidate_payload: { stage: 'P1', promptText: 'Local only', promptDigest: 'd',
        sourceVersion: 'docs:v1', sourceLocator: 'body:1', selectionMetadata: {} },
    }] };
    if (sql.includes('SELECT p.stable_key')) return { rowCount: 0, rows: [] };
    if (sql.includes('MAX(source_order)')) return { rows: [{ source_order: 0 }] };
    writes.push({ sql, args });
    if (sql.includes('INSERT INTO problem_versions')) return { rows: [{ version_id: 'v1' }] };
    return { rowCount: 1, rows: [] };
  } };
  await applyApprovedSyncCandidate({ connect: async () => client }, { candidateId: 'candidate', actorId: 'local', autoStageNew: true });
  for (const table of ['problems', 'problem_versions', 'problem_source_map']) {
    assert.equal(writes.find(w => w.sql.includes('INSERT INTO '+table+'(')).args[0], 'COMMERCIAL');
  }
});
