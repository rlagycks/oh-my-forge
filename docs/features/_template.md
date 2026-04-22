# [기능 이름]

<!--
  OMF 기능 문서 템플릿
  이 파일을 복사해서 docs/features/[domain].md 를 만드세요.
  4개 H2 섹션은 반드시 유지하세요 — Claude JIT 쿼리가 이 섹션명을 파싱합니다.
  섹션명 변경 시 validate-ontology.js CI 검증이 실패합니다.
-->

## 목적

<!-- 1~3문장. Claude가 "왜 이 기능이 있는가"를 파악하는 유일한 근거.
     Codex BRIEF의 TASK 필드 작성 시 여기서 의도를 추출합니다. -->

## 진입점

<!-- 핵심 파일과 함수 목록. ontology/index.json의 files[] 와 symbols[] 를 보완합니다.
     Codex BRIEF의 FILES 필드가 여기서 시작됩니다. -->

- `path/to/file.js` — 역할 설명

## 핵심 제약

<!-- 이 도메인에서 절대 어기면 안 되는 규칙.
     Codex BRIEF의 CONSTRAINTS 섹션으로 그대로 복사됩니다. -->

- 규칙 1

## 관련 도메인

<!-- ontology/index.json 의 다른 domain_* 키. 이 도메인을 수정하면 영향받는 도메인을 나열합니다. -->

- `domain_xxx` — 연관 이유
