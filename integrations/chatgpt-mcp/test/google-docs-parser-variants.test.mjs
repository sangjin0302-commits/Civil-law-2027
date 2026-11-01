import test from 'node:test';
import assert from 'node:assert/strict';
import {parseP1Document,parseP1GradingKeys,parseP2Document} from '../db/google-docs-parser.mjs';
const doc = lines => ({body:{content:lines.map((text,i)=>({startIndex:i+1,paragraph:{elements:[{textRun:{content:text+'\n'}}]}}))}});
test('separate item headers keep multiline prompts and exclude explanation/answer',()=>{
 const d=doc(['문항 상법00001','★★','합성 제목','〔합성〕 첫 줄','둘째 줄','정답: O','해설','비공개 합성 설명',
 '문항 부서00002','제목: 합성','〔합성〕 다른 지문','해설','비공개 합성 설명','정답: X']);
 const p=parseP1Document(d,'S');assert.equal(p.problems.length,2);
 assert.equal(p.problems[0].promptText,'〔합성〕 첫 줄\n둘째 줄');
 assert.equal(p.problems[1].promptText,'〔합성〕 다른 지문');
 assert.deepEqual(parseP1GradingKeys(d,'S').keys,[{stableKey:'S|상법00001',answer:'O'},{stableKey:'S|부서00002',answer:'X'}]);
});
test('legacy inline and next-line grading keys remain separate from prompts',()=>{
 const d=doc(['[A1] 제목 | O 지문: 합성 지문','[A2] 제목 | X','지문: 다른 지문 정정 해설: 합성 설명']);
 assert.deepEqual(parseP1Document(d,'S').problems.map(p=>p.promptText),['합성 지문','다른 지문']);
 assert.equal(parseP1GradingKeys(d,'S').keys.length,2);
});
test('conflicting keys never select an answer; multiple-choice is not converted',()=>{
 const d=doc(['[A1] 제목 | O','지문: 합성','[A1] 제목 | X','지문: 합성','[A2] 제목 | ③','지문: 객관식',
 '문항 합성3','〔합성〕 지문','정답: ②']);
 assert.deepEqual(parseP1GradingKeys(d,'S').keys,[]);
 assert.deepEqual(parseP1GradingKeys(d,'S').conflictingKeys,['S|A1']);
 assert.equal(parseP1Document(d,'S').problems.length,1);
});
test('unnumbered drafting answer heading exposes only question block',()=>{
 const d=doc(['2020년도 (제26회)','문 1','문제','합성 서류작성 지시','현실답안 및 해설','현실답안 (30점)','비공개 합성 정답']);
 const p=parseP2Document(d,'S').problems;assert.equal(p.length,1);assert.equal(p[0].maxPoints,30);
 assert.equal(p[0].stableKey,'S|2020-제26회-문1-소문항1');
 assert.equal(p[0].promptText,'합성 서류작성 지시\n\n▶ 풀이 대상: 현실답안 (30점)');
});
test('mixed numbered bank retains original target ordinals and numbered fractions',()=>{
 const d=doc(['2020년도 (제26회)','문 1','문제','합성 사실','현실답안 및 해설',
 '현실답안 (30점)','합성 설명','현실답안 1 - (20점의 1/4)','합성 답안']);
 const p=parseP2Document(d,'S').problems;
 assert.equal(p.length,1);assert.equal(p[0].maxPoints,5);
 assert.equal(p[0].stableKey,'S|2020-제26회-문1-소문항1');
});
