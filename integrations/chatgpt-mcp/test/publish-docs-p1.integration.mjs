// Reuses the existing local P1 fixture. Never run against a user database.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { publishDocsP1 } from '../db/publish-docs-p1.mjs';
import { createPostgresExecutor, decryptGradingPayload, gradingAad } from '../db/postgres-adapter.mjs';

const target = new URL(process.env.TEST_DATABASE_URL || 'http://invalid');
if (!['127.0.0.1','localhost'].includes(target.hostname) || !['55432','55534'].includes(target.port) ||
    !/^exam_flow_docs_p1[a-z0-9_]*$/.test(target.pathname.slice(1))) {
  throw new Error('requires a disposable localhost exam_flow_docs_p1 database');
}
const pool = new pg.Pool({connectionString:target.toString(),max:2});
const subjectId='CONSTITUTION',documentId='isolated-docs-p1',folderId='isolated-p1-folder';
const sourceId='SRC-CONSTITUTION-AUTO-'+ 'a'.repeat(32);
const key=crypto.randomBytes(32), keyId='isolated-docs-key';
const env={GRADING_KEY_BASE64:key.toString('base64'),GRADING_ENCRYPTION_KEY_ID:keyId};
const paragraph=(text,index)=>({startIndex:index,endIndex:index+text.length+1,
  paragraph:{elements:[{textRun:{content:text+'\n'}}]}});
const document={documentId,revisionId:'r1',title:'Existing local fixture',body:{content:[
  paragraph('[Q1] local | O',1),paragraph('지문: Local fixture.',30),
]}};
try {
  assert.equal((await pool.query("SELECT to_regclass('public.problems') AS existing")).rows[0].existing,null);
  for(const name of ['0001_learning_ledger.sql','0002_grading_key_rotation.sql','0004_google_docs_sync.sql',
    '0008_exam_selection_indexes.sql','0009_exam_review_due.sql']) {
    await pool.query(await readFile(new URL('../db/migrations/'+name,import.meta.url),'utf8'));
  }
  await pool.query("INSERT INTO subjects(subject_id,name) VALUES('CIVIL','Local civil'),($1,'Local constitution')",[subjectId]);
  await pool.query(await readFile(new URL('../db/migrations/0010_drive_document_registry.sql',import.meta.url),'utf8'));
  await pool.query("INSERT INTO document_folders(folder_id,subject_id,stage,title) VALUES($1,$2,'P1','Local folder')",[folderId,subjectId]);
  await pool.query("INSERT INTO source_documents(document_id,subject_id,title) VALUES($1,$2,'Local document')",[documentId,subjectId]);
  await pool.query(`INSERT INTO document_registry(document_id,source_id,subject_id,stage,folder_id,title,registration_kind)
    VALUES($1,$2,$3,'P1',$4,'Local document','FOLDER')`,[documentId,sourceId,subjectId,folderId]);
  const published=await publishDocsP1(pool,{document,sourceId,subjectId,env});
  assert.deepEqual(published,{published:1,held:0,reused:0,parsed:1});
  const encrypted=(await pool.query('SELECT * FROM private_grading_keys WHERE subject_id=$1',[subjectId])).rows[0];
  const payload=decryptGradingPayload(encrypted.encrypted_payload,key,
    gradingAad(subjectId,sourceId+'|Q1',encrypted.key_version,keyId),encrypted.payload_digest);
  assert.equal(payload.answer,'O');
  const execute=createPostgresExecutor({pool,env});
  const context={ownerId:'isolated-p1-owner'};
  const issued=await execute('issueP1',{subjectId,requestId:'local-docs-p1',mode:'문제지정',count:1,specificKeys:[sourceId+'|Q1']},context);
  assert.equal(issued.questions.length,1);
  assert.equal(Object.hasOwn(issued.questions[0],'answer'),false);
  const graded=await execute('gradeP1',{subjectId,setId:issued.setId,answers:['O']},context);
  assert.equal(graded.correct,1);
  const stored=(await pool.query(`SELECT g.is_correct,a.answer_text FROM p1_grades g
    JOIN original_answers a ON a.submission_id=g.submission_id AND a.subject_id=g.subject_id AND a.stable_key=g.stable_key
    JOIN submissions s ON s.submission_id=g.submission_id WHERE s.set_id=$1`,[issued.setId])).rows[0];
  assert.equal(stored.is_correct,true);
  assert.equal(stored.answer_text,'O');
  const replay=await publishDocsP1(pool,{document,sourceId,subjectId,env});
  assert.deepEqual(replay,{published:0,held:0,reused:1,parsed:1});
  for(const [status,code] of [['REVIEW',null],['ERROR','SYNC_FAILED'],['ERROR','NO_PROBLEMS']]) {
    await pool.query('UPDATE document_registry SET registration_status=$2,failure_code=$3 WHERE document_id=$1',[documentId,status,code]);
    assert.deepEqual(await publishDocsP1(pool,{document,sourceId,subjectId,env}),replay);
  }
  for(const [status,code] of [['REVIEW','FOLDER_MOVE'],['REVIEW','NOT_FOUND'],['REVIEW','UNKNOWN'],['ERROR','FOLDER_MOVE'],['ERROR','NOT_FOUND'],['ERROR','UNKNOWN'],['ERROR',null]]) {
    await pool.query('UPDATE document_registry SET registration_status=$2,failure_code=$3 WHERE document_id=$1',[documentId,status,code]);
    await assert.rejects(publishDocsP1(pool,{document,sourceId,subjectId,env}),/approved registered P1 source required/);
  }
  await pool.query("UPDATE document_registry SET registration_status='REVIEW',failure_code=NULL WHERE document_id=$1",[documentId]);
  await pool.query('UPDATE document_folders SET enabled=false WHERE folder_id=$1',[folderId]);
  await assert.rejects(publishDocsP1(pool,{document,sourceId,subjectId,env}),/approved registered P1 source required/);
  await pool.query('UPDATE document_folders SET enabled=true WHERE folder_id=$1',[folderId]);
  await assert.rejects(publishDocsP1(pool,{document,sourceId:sourceId+'-wrong',subjectId,env}),/approved registered P1 source required/);
  const changed=structuredClone(document);changed.revisionId='r2';
  changed.body.content[0]=paragraph('[Q1] local | X',1);
  const held=await publishDocsP1(pool,{document:changed,sourceId,subjectId,env});
  assert.deepEqual(held,{published:0,held:1,reused:0,parsed:1});
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM private_grading_keys WHERE subject_id=$1',[subjectId])).rows[0].n,1);
  assert.equal((await pool.query('SELECT payload_digest FROM private_grading_keys WHERE subject_id=$1',[subjectId])).rows[0].payload_digest,encrypted.payload_digest);
  const collision=structuredClone(changed);collision.revisionId='r1';
  await assert.rejects(publishDocsP1(pool,{document:collision,sourceId,subjectId,env}),/revision.*digest mismatch/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM private_grading_keys WHERE subject_id=$1',[subjectId])).rows[0].n,1);
  await assert.rejects(publishDocsP1(pool,{document:{...document,documentId:'1W9WZwSsM6OyJFo37lAnfa-at_SeM5TINNy1JTI2_2w4'},sourceId,subjectId,env}),/development source excluded/);
  console.log(JSON.stringify({ok:true,docsToEncryptedSql:true,genericIssueGradeStored:true,replayPublished:0,
    changedAnswerHeld:true,revisionCollisionDenied:true,priorKeyAndGradePreserved:true,developmentDocDenied:true,
    retryStatesPassed:3,protectedStatesDenied:7,disabledFolderDenied:true,wrongSourceDenied:true,environment:'localhost disposable'}));
} finally { await pool.end(); }
