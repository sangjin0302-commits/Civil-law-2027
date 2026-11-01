import test from 'node:test';
import assert from 'node:assert/strict';
import {snapshotFromGoogleDoc} from '../db/google-docs-snapshot.mjs';
import {parseP2Document} from '../db/google-docs-parser.mjs';
const source='SRC-CRIMINAL-AUTO-'+'a'.repeat(32);
const doc=lines=>({documentId:'synthetic',revisionId:'r1',body:{content:lines.map((text,i)=>({startIndex:i+1,paragraph:{elements:[{textRun:{content:text+'\n'}}]}}))}});
const block=(n,facts,points)=>['문 '+n,'문제',facts,'현실답안 및 해설',...points.map((p,i)=>`현실답안 ${i+1} (${p}점)`)];
test('source zero points hold entire noncivil case without changing parser ordinals',()=>{
 const d=doc(['2020년도 (제26회)',...block(1,'합성 사실 A',[0,10]),...block(2,'합성 사실 B',[15])]);
 assert.equal(parseP2Document(d,source).problems.length,3);
 const s=snapshotFromGoogleDoc(d,source,'P2','CRIMINAL');
 assert.equal(s.problems.length,1);assert.equal(s.problems[0].stableKey,source+'|2020-제26회-문2-소문항1');
 assert.deepEqual(s.heldCases,[{caseKey:source+'|2020-제26회-문1',reasons:['SOURCE_INVALID_MAX_POINTS']}]);
});
test('conflicting duplicate holds whole case including nonconflicting siblings',()=>{
 const d=doc(['2020년도 (제26회)',...block(1,'합성 사실 A',[10,20]),...block(1,'합성 사실 B',[10]),...block(2,'합성 사실 C',[15])]);
 const s=snapshotFromGoogleDoc(d,source,'P2','CRIMINAL');assert.equal(s.problems.length,1);
 assert.deepEqual(s.heldCases[0].reasons,['CONFLICTING_SOURCE_OCCURRENCES']);
 assert.equal(s.problems[0].maxPoints,15);
});
test('all held returns explicit empty snapshot; civil retains existing validation',()=>{
 const d=doc(['2020년도 (제26회)',...block(1,'합성 사실',[0,10])]);
 const s=snapshotFromGoogleDoc(d,source,'P2','CRIMINAL');assert.equal(s.problems.length,0);assert.equal(s.heldCases.length,1);
 assert.throws(()=>snapshotFromGoogleDoc(d,'SRC-CIV-005','P2','CIVIL'),/maxPoints/);
});
test('same-case repeated target holds whole case but identical cross-case text is not newly held',()=>{
 const d=doc(['2020년도 (제26회)',...block(1,'합성 사실',[5]),'현실답안 1 (5점)',
   ...block(2,'다른 합성 사실',[10]),...block(3,'다른 합성 사실',[10])]);
 const s=snapshotFromGoogleDoc(d,source,'P2','CRIMINAL');
 assert.equal(s.problems.length,2);
 assert.deepEqual(s.heldCases,[{caseKey:source+'|2020-제26회-문1',reasons:['DUPLICATE_SOURCE_TARGET']}]);
 assert.equal(s.problems[0].promptDigest,s.problems[1].promptDigest);
});
