// Shared scoring remains unchanged. Only supported source formats and subject identity differ.
export const SUBJECTS = Object.freeze({
  CIVIL: { name: '민법', stages: ['P1','P2'], format: 'case', focus: '청구권·요건·효과·사안 적용', folderId: '1SFpkJBP1c3hEf9Q8RCpjHt1MdGGwzPVl' },
  CONSTITUTION: { name: '헌법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '19GGzpLt8WxRz9fZsSeALPtdvwUHgxe1p' },
  COMMERCIAL: { name: '상법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '1-ATDXv2vxCJwwE7cL2lDq2p6EvUvjumP' },
  CIVIL_EXECUTION: { name: '민사집행법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '16NPHXicuyDfpI5mz4ASqZ-R_wc5juZwe' },
  FAMILY_REGISTRATION: { name: '가족관계등록법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '1ek_lGogDHT-FAulmwJl-wyfAYaW31Wt7' },
  DEPOSIT: { name: '공탁법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '1kpFf2Yv5MslYNR0A_chDEsVxoCx2haVd' },
  COMMERCIAL_REGISTRATION: { name: '상업등기법', stages: ['P1'], format: 'ox', focus: '공식 선지 O/X', folderId: '1v1E6xiYlpAK96SW8ORLiHwtoNtu6suYR' },
  REAL_ESTATE_REGISTRATION: { name: '부동산등기법', stages: ['P1','P2'], format: 'case', focus: '등기 요건·절차·신청과 효력', folderId: '1dw2gw5-3yTetvlWj-QpfBtQeD5uuJ6U2' },
  CRIMINAL: { name: '형법', stages: ['P2'], format: 'case', focus: '구성요건·위법성·책임·죄수', folderId: '18fkes9ukVvvPpEVPKzZeGLY_ws3okq-9' },
  CRIMINAL_PROCEDURE: { name: '형사소송법', stages: ['P2'], format: 'case', focus: '절차·증거·적법성·효과', folderId: '1NOinVB8wK197I5Wi2FqYwjrdl9xwQh66' },
  CIVIL_PROCEDURE: { name: '민사소송법', stages: ['P2'], format: 'case', focus: '소송요건·절차·효력·사안 적용', folderId: '1laygNRJ_48_Bxy-EJkWaf6wXWPU7tS9v' },
  CIVIL_DOCUMENT: { name: '민사서류작성', stages: ['P2'], format: 'document', focus: '원문 지정 서식·당사자·청구취지·원인·필수 기재', folderId: '14a3kdrji-Oah4XOErNS8_4B52vcZmGEC' },
  REGISTRATION_DOCUMENT: { name: '등기서류작성', stages: ['P2'], format: 'document', focus: '원문 지정 서식·신청정보·첨부정보·필수 기재', folderId: '1ZLSLC_xjaqLGh5vTg3tLPWymiHinxH9o' },
});
export const SUBJECT_IDS = Object.freeze(Object.keys(SUBJECTS));
export const EXAM_TOOL_ALIASES = Object.freeze({ getExamProgress:'getCivilExamProgress', issueP1:'issueCivilP1', gradeP1:'gradeCivilP1', issueP2:'issueCivilP2', prepareP2Grade:'prepareCivilP2Grade', commitP2Grade:'commitCivilP2Grade' });
export function requireSubject(subjectId, stage) {
  if (!Object.hasOwn(SUBJECTS, subjectId)) throw new Error('unsupported subject');
  if (stage && !SUBJECTS[subjectId].stages.includes(stage)) throw new Error('unsupported subject stage');
  return subjectId;
}
