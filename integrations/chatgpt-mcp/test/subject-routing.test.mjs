import test from 'node:test';
import assert from 'node:assert/strict';
import {validateToolInput,callTool} from '../server.mjs';
import {SUBJECT_IDS,SUBJECTS} from '../subjects.mjs';
test('all configured subjects route only their supported stages and retain authenticated owner',async()=>{
 for(const subjectId of SUBJECT_IDS){
  const stage=SUBJECTS[subjectId].stages[0];
  const name=stage==='P1'?'issueP1':'issueP2';
  let received;
  await callTool(name,{subjectId,requestId:'isolated-existing-fixture'}, {ownerId:'authenticated-owner',executor:async(...args)=>{received=args;return{};}});
  assert.equal(received[0],name);assert.equal(received[1].subjectId,subjectId);assert.equal(received[2].ownerId,'authenticated-owner');
 }
 assert.throws(()=>validateToolInput('issueP1',{subjectId:'CRIMINAL',requestId:'x'}),/unsupported subject stage/);
 assert.throws(()=>validateToolInput('issueP1',{subjectId:'unknown'}),/unsupported subject/);
 assert.throws(()=>validateToolInput('issueCivilP1',{subjectId:'CONSTITUTION'}),/허용되지 않은 입력/);
});
