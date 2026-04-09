---
description: MD 문서를 읽어 도메인별 구조화된 JSON 온톨로지 파일로 변환한다. AI가 읽기 위한 JSON 표현을 생성하며, 원본 MD는 사람용으로 유지된다.
---

# Ontology Extract

MD 문서(기획서, API 명세 등)를 분석하여 도메인별 JSON 온톨로지 파일을 생성한다.

**MD = 사람이 읽는 문서 → JSON = AI가 읽는 구조화된 온톨로지**

## Usage

```
/ontology-extract <path>
```

**Examples:**
```
/ontology-extract docs/archive/
/ontology-extract docs/archive/api/01_인증.md
/ontology-extract docs/design/
```

`<path>`는 파일, 디렉터리 모두 가능하다.

---

## Step 0 — 범위 확인

이 커맨드는 **외부 문서(기획서, API 명세 등)에서 `domain_*.json` 상세 파일을 생성**한다.

`.claude/ontology/index.json`이 존재하면 형식을 확인한다:

**정상 형식 (GPS 라우팅 인덱스)**: `$schema` 키 + `domain_*` 키에 `files[]`, `spec`, `codexWorkerHint` 포함.
→ **index.json을 수정하지 않는다.** `domain_*.json` 상세 파일만 생성/업데이트 후 Step 1로 진행.

**존재하지 않는 경우**: 바로 Step 1로 진행. `/ontology-sync`를 먼저 실행하여 index.json을 구성할 것을 안내한다.

> ⚠️ **주의**: 이 커맨드는 ECC 내부 `index.json`(GPS 라우팅 인덱스)을 교체하거나 초기화하지 않는다.
> ECC 내부 온톨로지 구조를 수정하려면 `/ontology-sync`를 사용하라.

---

## Step 1 — 경로 확장 및 파일 읽기

`<path>`를 기준으로 대상 파일 목록을 결정하고 **전체 내용을 읽는다**.

- **단일 파일**: 그 파일 하나
- **디렉터리**: 디렉터리 내 모든 `.md` 파일 (재귀, `node_modules` 제외)
- **존재하지 않는 경로**: "경로를 찾을 수 없습니다" 출력 후 중단

---

## Step 2 — 도메인 분리

읽은 MD 파일들을 분석하여 **도메인 경계**를 식별한다.

도메인은 다음 기준으로 분리한다:
- 별도 파일로 존재하는 경우 (예: `01_인증.md` → `domain_auth`)
- 단일 파일 내 `## 섹션`으로 구분된 경우 → 섹션별로 분리
- 공통/전역 설정은 `domain_common`으로 분리

각 도메인에서 다음을 추출한다:

### 2a. 엔드포인트 (API 명세 문서인 경우)
```json
{
  "method": "POST",
  "path": "/auth/login",
  "auth": false,
  "summary": "이메일/비밀번호로 로그인",
  "request": {
    "body": {
      "email": "string",
      "password": "string"
    }
  },
  "response": {
    "200": {
      "accessToken": "string",
      "user": { "id": "number", "nickname": "string" }
    }
  },
  "errors": ["401:INVALID_CREDENTIALS", "404:USER_NOT_FOUND"]
}
```

### 2b. 데이터 모델/엔티티
문서에서 언급된 필드, 타입, 제약을 추출:
```json
{
  "name": "User",
  "fields": {
    "id": "number",
    "email": "string (unique)",
    "nickname": "string (2-20자)",
    "profileImage": "string (URL, optional)"
  }
}
```

### 2c. 비즈니스 규칙/제약
문서에서 **규칙, 조건, 제한** 문장을 추출:
```json
[
  "비밀번호: 8자 이상, 영문·숫자·특수문자 각 1개 이상",
  "Access Token 유효기간 1시간",
  "Refresh Token 14일, HttpOnly Secure Cookie, Rotation 방식"
]
```

### 2d. 도메인 간 의존성
다른 도메인 데이터를 참조/호출하는 경우 추출:
```json
["domain_auth", "domain_user"]
```

---

## Step 3 — JSON 파일 구조

각 도메인마다 `.claude/ontology/domain_<name>.json` 파일을 생성한다.

```json
{
  "domain": "domain_<name>",
  "version": "1.0",
  "source": ["docs/archive/api/01_인증.md"],
  "summary": "<도메인 한 줄 설명>",
  "endpoints": [...],
  "models": [...],
  "constraints": [...],
  "dependsOn": [...]
}
```

공통 설정은 `.claude/ontology/domain_common.json`:
```json
{
  "domain": "domain_common",
  "version": "1.0",
  "source": ["docs/archive/api/00_공통.md"],
  "summary": "전역 공통 설정",
  "baseUrl": "https://api.example.com/v1",
  "auth": {
    "type": "Bearer JWT",
    "header": "Authorization: Bearer {accessToken}"
  },
  "responseStructure": {
    "success": { "success": true, "data": "..." },
    "error": { "success": false, "error": { "code": "string", "message": "string" } }
  },
  "errorCodes": {
    "UNAUTHORIZED": 401,
    "NOT_FOUND": 404
  },
  "constraints": [...]
}
```

---

## Step 4 — index.json의 detail 필드 업데이트 (선택)

`.claude/ontology/index.json`이 GPS 라우팅 포맷인 경우, 생성된 `domain_*.json` 파일을 `detail` 필드로 연결할 수 있다.

기존 `domain_*` 엔트리에 `detail` 필드가 없으면 추가 여부를 확인한다:

```json
"domain_auth": {
  "files": [...],
  "spec": "docs/features/auth.md",
  "detail": ".claude/ontology/domain_auth.json",
  ...
}
```

> 이 단계는 index.json의 다른 필드(`files`, `spec`, `codexWorkerHint` 등)는 변경하지 않는다.
> `--fix` 모드에서는 확인 없이 `detail` 필드만 추가한다.

---

## Step 5 — 초안 미리보기 출력

생성될 파일 목록과 각 도메인의 요약을 출력한다:

```
생성될 파일:
  .claude/ontology/index.json (매니페스트)
  .claude/ontology/domain_common.json — 공통 응답 구조, 전역 에러 코드, Base URL
  .claude/ontology/domain_auth.json — 회원가입 3단계, JWT 전략, 비밀번호 재설정 (엔드포인트 8개)
  .claude/ontology/domain_user.json — 프로필, 온보딩, 닉네임 변경 (엔드포인트 5개)
  ...

위 내용을 적용하시겠습니까?
  [1] 전체 생성 (도메인 JSON 파일 + index.json)
  [2] 특정 도메인만 선택
  [3] 출력만 (파일 수정 없음)
  [4] 취소
```

---

## Step 6 — 파일 생성

**[1] 선택 시:**
1. `.claude/ontology/` 디렉터리 생성 (없으면)
2. 각 도메인별 JSON 파일 생성
3. `index.json` 생성/업데이트

**규칙:**
- 기존 도메인 JSON 파일이 있으면 덮어쓰기 전 확인
- 원본 MD 파일은 **절대 수정하지 않는다**
- 추론이 불확실한 필드는 `"// TODO": "확인 필요"` 주석 추가

---

## 주의사항

- 원본 MD는 사람용 문서다 — 수정하지 않는다
- JSON 온톨로지는 AI가 코드 생성 시 참조하는 소스다
- 엔드포인트 request/response 스키마는 문서에 명시된 것만 추출 (추측 금지)
- 문서에 타입이 명시되지 않은 필드는 `"type": "unknown"` 으로 표기
