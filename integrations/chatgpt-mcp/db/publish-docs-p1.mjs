import crypto from 'node:crypto';
import {parseP1Document,parseP1GradingKeys,digestText} from './google-docs-parser.mjs';
import {gradingAad,gradingKey} from './postgres-adapter.mjs';
import {requireSubject} from '../subjects.mjs';
import {sha256} from './google-docs-sync.mjs';

// The owner approved source folders. Only explicit source O/X answers are accepted.
// Existing changed text, keys, versions and learner records are never overwritten.
export async function publishDocsP1(pool, {document,sourceId,subjectId,env=process.env}) {
 requireSubject(subjectId,'P1');
 const documentId=document.documentId;
 if(['1W9WZwSsM6OyJFo37lAnfa-at_SeM5TINNy1JTI2_2w4','1sdWAsG7EcsO1RrV6Q0U0hHJpOu_9yD5zdKs63y9-N_g'].includes(documentId))throw Error('development source excluded');
 const parsed=parseP1Document(document,sourceId), answers=parseP1GradingKeys(document,sourceId);
 const blocked=new Set([...parsed.conflictingKeys,...answers.conflictingKeys]);
 const answerMap=new Map(answers.keys.map(k=>[k.stableKey,k.answer]));
 const revisionId=document.revisionId||digestText(JSON.stringify(document));
 const key=gradingKey(env), keyId=env.GRADING_ENCRYPTION_KEY_ID;
 if(!keyId)throw Error('grading key ID required');
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`source-order:${subjectId}`]);
  const registry=await client.query(`SELECT 1 FROM document_registry r JOIN document_folders f ON f.folder_id=r.folder_id
    WHERE r.document_id=$1 AND r.subject_id=$2 AND r.source_id=$3 AND r.stage='P1' AND r.registration_kind='FOLDER'
    AND r.registration_status IN ('DISCOVERED','STAGED','READY') AND f.enabled AND f.subject_id=r.subject_id AND f.stage=r.stage`,[documentId,subjectId,sourceId]);
  if(registry.rowCount!==1)throw Error('approved registered P1 source required');
  const prior=await client.query(`SELECT p.stable_key,p.prompt_text,p.content_digest,p.current_problem_version_id,p.published,
    v.source_document_id,v.source_revision_id,EXISTS(SELECT 1 FROM private_grading_keys k WHERE k.subject_id=p.subject_id AND k.stable_key=p.stable_key) AS has_key,
    (SELECT payload_digest FROM private_grading_keys k WHERE k.subject_id=p.subject_id AND k.stable_key=p.stable_key AND k.active_for_grading AND k.verification_state='verified' LIMIT 1) AS active_payload_digest
    FROM problems p LEFT JOIN problem_versions v ON v.version_id=p.current_problem_version_id WHERE p.subject_id=$1`,[subjectId]);
  const byKey=new Map(prior.rows.map(p=>[p.stable_key,p]));
  const otherRaw=new Set(prior.rows.filter(p=>!p.stable_key.startsWith(sourceId+'|')).map(p=>p.stable_key.split('|').slice(1).join('|')));
  const otherPrompt=new Set(prior.rows.filter(p=>!p.stable_key.startsWith(sourceId+'|')).map(p=>p.content_digest));
  const next=Number((await client.query('SELECT COALESCE(MAX(source_order),-1)+1 AS n FROM problems WHERE subject_id=$1',[subjectId])).rows[0].n);
  const rows=[];let held=0,reused=0;
  for(const p of parsed.problems){
   const answer=answerMap.get(p.stableKey),old=byKey.get(p.stableKey);
   if(blocked.has(p.stableKey)||!['O','X'].includes(answer)||otherRaw.has(p.stableKey.split('|').slice(1).join('|'))||otherPrompt.has(p.promptDigest)){held++;continue;}
   if(old){
    if(old.content_digest===p.promptDigest&&old.published&&old.active_payload_digest===digestText(JSON.stringify({answer,rationale:'Owner-approved Google Docs O/X answer'}))){reused++;continue;}
    if(old.content_digest!==p.promptDigest||old.has_key||old.source_document_id!==documentId||old.source_revision_id!==revisionId){held++;continue;}
   }
   const keyVersion='docs-ox-'+digestText(revisionId+'|'+p.promptDigest+'|'+answer).slice(0,24);
   const payload=JSON.stringify({answer,rationale:'Owner-approved Google Docs O/X answer'});
   const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
   cipher.setAAD(gradingAad(subjectId,p.stableKey,keyVersion,keyId));
   const body=Buffer.concat([cipher.update(payload,'utf8'),cipher.final()]);
   rows.push({stable_key:p.stableKey,prompt_text:p.promptText,prompt_digest:p.promptDigest,source_locator:p.sourceLocator,
    source_order:next+rows.length,version_id:old?.current_problem_version_id||crypto.randomUUID(),is_new:!old,
    key_version:keyVersion,answer_digest:digestText(answer),payload_digest:digestText(payload),encrypted:Buffer.concat([iv,cipher.getAuthTag(),body]).toString('hex')});
  }
  const json=JSON.stringify(rows), def='stable_key text,prompt_text text,prompt_digest text,source_locator text,source_order bigint,version_id uuid,is_new boolean,key_version text,answer_digest text,payload_digest text,encrypted text';
  await client.query(`INSERT INTO document_revisions(document_id,revision_id,content_digest,parser_version,parsed_problem_count)
   VALUES($1,$2,$3,'approved-docs-ox-v1',$4) ON CONFLICT DO NOTHING`,[documentId,revisionId,sha256(document.tabs?.length?document.tabs:document.body),parsed.problems.length]);
  const revision=await client.query('SELECT content_digest FROM document_revisions WHERE document_id=$1 AND revision_id=$2',[documentId,revisionId]);
  if(revision.rows[0]?.content_digest!==sha256(document.tabs?.length?document.tabs:document.body))throw Error('revision content digest mismatch');
  await client.query(`INSERT INTO problems(subject_id,stable_key,stage,source_order,source_ref,source_version,prompt_text,published,content_digest)
   SELECT $1,x.stable_key,'P1',x.source_order,'gdoc:'||$2||'#'||x.source_locator,$3,x.prompt_text,false,x.prompt_digest FROM jsonb_to_recordset($4::jsonb) AS x(${def}) WHERE x.is_new`,[subjectId,documentId,revisionId,json]);
  await client.query(`INSERT INTO problem_versions(version_id,subject_id,stable_key,source_document_id,source_revision_id,source_version,stage,source_order,prompt_text,prompt_digest,answer_digest,grading_key_version)
   SELECT x.version_id,$1,x.stable_key,$2,$3,$3,'P1',x.source_order,x.prompt_text,x.prompt_digest,x.answer_digest,x.key_version FROM jsonb_to_recordset($4::jsonb) AS x(${def}) WHERE x.is_new`,[subjectId,documentId,revisionId,json]);
  await client.query(`INSERT INTO private_grading_keys(subject_id,stable_key,key_version,encrypted_payload,payload_digest,encryption_key_id,verification_state,active_for_grading)
   SELECT $1,x.stable_key,x.key_version,decode(x.encrypted,'hex'),x.payload_digest,$2,'verified',true FROM jsonb_to_recordset($3::jsonb) AS x(${def})`,[subjectId,keyId,json]);
  await client.query(`UPDATE problems p SET current_problem_version_id=x.version_id,published=true FROM jsonb_to_recordset($2::jsonb) AS x(${def}) WHERE p.subject_id=$1 AND p.stable_key=x.stable_key`,[subjectId,json]);
  await client.query(`INSERT INTO problem_source_map(subject_id,stable_key,document_id,source_locator,current_version_id,active)
   SELECT $1,x.stable_key,$2,x.source_locator,x.version_id,true FROM jsonb_to_recordset($3::jsonb) AS x(${def}) ON CONFLICT DO NOTHING`,[subjectId,documentId,json]);
  await client.query(`INSERT INTO audit_events(actor_id,subject_id,action,aggregate_type,aggregate_id,payload_digest,metadata)
   VALUES('maintenance:owner-approved-docs',$1,'DOCS_P1_PUBLISH','source_document',$2,$3,$4::jsonb)`,[subjectId,documentId,digestText(json),JSON.stringify({published:rows.length,held,reused,revisionId})]);
  await client.query('COMMIT');return{published:rows.length,held,reused,parsed:parsed.problems.length};
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
