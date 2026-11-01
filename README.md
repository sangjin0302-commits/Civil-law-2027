# 법무사 공식 문제 관리 시스템

범위: 승인 Google Docs 기반 과목별 공식 O/X·사례·서류작성 문제의 출제·원답 제출·채점·기록. 공통 엔진과 PostgreSQL을 재사용한다. 실제 발행·채점 가능한 범위와 앱 연결은 [실사용 안내](docs/all-subject-usage.md), 과목별 설정은 [subjects.mjs](integrations/chatgpt-mcp/subjects.mjs)를 따른다. 기존 개념 학습 데이터와 이력은 보존하며 학습 도구로 노출하지 않는다.

## 사용자 도구

`getExamProgress`, `issueP1`, `gradeP1`, `issueP2`, `prepareP2Grade`, `commitP2Grade`는 `subjectId`로 과목을 선택한다. 기존 민법 도구 6개는 호환을 유지한다. 모두 WorkOS 인증과 세트 소유권·과목 검증을 거친다. 2차 기준은 원답 확정 후 조회하며 고정 의미요소의 1·0.5·0 비례 점수를 서버가 계산한다. 결과는 **AI 학습평가 점수**다. 7요소 진단은 별도이며 공식 채점자 점수가 아니다.

기여·공개 자료 원칙은 [CONTRIBUTING.md](CONTRIBUTING.md), 보안·데이터 보호는 [SECURITY.md](SECURITY.md)를 참고한다. 비공개 문제·정답·원답은 공개 저장소에 올리지 않는다.

## 관리 경로

Google Docs 대조·미리보기·후보 기록은 `MAINTENANCE_TOKEN`으로 보호한 별도 POST 경로다. 실제 적용은 승인된 후보와 유지보수 절차로 제한한다. 안정키·문제 버전·기존 답안·암호화 채점키를 보존한다. 기존 Sheets 사용자 출제 선택권은 PostgreSQL에서 구현하되 운영 Sheets·Docs·Apps Script 원본은 변경하지 않는다.

## 상태

기존 Railway 테스트 DB, Vercel, WorkOS, PITR을 재사용한다. PR 통합 브랜치의 검증과 테스트 배포는 운영 전환 또는 main 병합 승인이 아니다. 과거 개념 테이블·이력은 삭제하지 않는다. 현재 통합 대상과 남은 시험은 [START.md](START.md)에 기록한다.
