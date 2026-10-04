# 포장계획

주간 포장 작업계획을 모으고, 월간 달력에서 계획과 작업 결과를 확인하는 대시보드입니다.

## 주요 기능

- **작업 달력**: 월 이동, 날짜별 작업 상세, 계획·결과 구분, 담당자·포장·결과 상태 검색
- **주간 계획**: 원문 입력 후 항목 확인·수정, 작업 취소·복구, 다음 주로 선택 복사
- **작업 결과**: 완료·일부 완료·미실시, 실제 작업·확인일, 결과 메모와 기록자, 수정 이력
- **일정 점검**: 담당자·포장의 시간 겹침 및 확인이 필요한 항목 표시
- **제출 현황**: 제출 완료·확인 필요·작업 없음·미제출 구분, 보완 요청문 작성
- **취합·공지**: 계획 확정, 확정 이후 변경 확인, CSV·공지문 내려받기, 월별 결과 CSV

달력에서 `과거 작업 예시 보기`를 누르면 이전 달의 예시 결과를 살펴볼 수 있습니다. 예시를 수정한 상태라면 `예시 처음으로`로 초기화한 뒤 사용할 수 있습니다.

## 설치 및 실행

Node.js **22.13 이상**이 필요합니다. SQLite가 포함된 로컬 서버는 별도 데이터베이스 설치 없이 실행됩니다.

```bash
git clone https://github.com/Dj-Lee2/weekly-field-plan.git
cd weekly-field-plan
npm ci
npm run build
npm start
```

브라우저에서 **http://127.0.0.1:8788**을 엽니다. 종료는 실행한 터미널에서 `Ctrl+C`입니다.

### 저장 방식

- **공개 시연 빌드**: 방문자별 메모리에서 예시를 체험합니다. 입력한 계획·결과는 새로고침하면 초기화됩니다.
- **로컬 서버**: `runtime/weekly-field-plan.sqlite`에 저장되며 재시작 후에도 유지됩니다. 백업할 때는 서버를 종료한 뒤 `runtime/` 폴더를 복사하세요.
- **단일 HTML**: `npm run build`가 생성하는 `artifacts/주간포장계획_작동초안.html`을 Chrome 또는 Edge에서 열 수 있습니다. 해당 브라우저의 로컬 저장소를 사용하며 다른 기기와 공유되지 않습니다.

로컬 서버는 인증 없는 단일 사용자용으로 `127.0.0.1`에만 바인딩합니다. 팀 공용 운영에는 인증·접근 권한과 보관 정책을 별도로 구성해야 합니다.

### 공개 시연 빌드

```bash
npm run build:demo
```

`dist-demo/`에 정적 파일이 생성됩니다. 이 빌드는 API 호출·브라우저 저장소 코드를 포함하지 않습니다. 웹 서버의 루트 경로에서 제공하는 구성입니다.

`Dockerfile`과 `compose.yaml`은 로컬 서버를 컨테이너로 띄우는 참고 구성입니다. `FIELD_IMAGE`·`PUBLIC_ORIGIN`·`FIELD_DATA_DIR` 환경변수를 지정해야 하며, 인증하는 리버스 프록시 뒤에서만 사용해야 합니다.

## 사용 순서

1. `취합 대상`에서 구성원을 등록합니다.
2. `주간 계획`에서 주를 선택하고 원문 또는 개별 작업을 입력합니다.
3. 정리된 날짜·담당자·포장·작업 내용을 검토합니다.
4. `일정 점검`과 `제출 현황`에서 겹침·누락을 확인합니다.
5. `취합·공지`에서 계획을 확정하고 CSV·공지문을 내려받습니다.
6. 작업 후 `작업 달력`에서 결과를 기록하고 과거 이력을 조회합니다.

계획일과 실제 작업일은 구분됩니다. 날짜가 지났다는 이유로 자동 완료되지 않으며, 결과 미기록도 미실시로 간주하지 않습니다. 카카오톡 수신·자동 발송과 AI 해석은 아직 연결하지 않았습니다. 현재 원문 정리는 규칙 기반이며, 취합·공지 서식은 기본 제공 형식입니다.

## 검증

```bash
npm test
npm run build
npm run build:demo
```

브라우저 검증은 Chromium 설치 후 실행합니다. 기본 경로는 `/usr/bin/chromium-browser`이며 주요 검증 스크립트는 `CHROMIUM_PATH` 환경변수로 변경할 수 있습니다.

```bash
npm run test:calendar
npm run test:planning
npm run test:demo
TEST_MODE=server node scripts/verify-browser.mjs
TEST_MODE=offline node scripts/verify-browser.mjs
```

## 구성

- `src/`: React 화면, 스타일, 실행 모드별 저장소
- `lib/`: 계획·결과·달력·내보내기 로직
- `server.mjs`: HTTP API와 SQLite 로컬 서버
- `tests/`, `scripts/verify-*.mjs`: 단위·통합·브라우저 검증
- `Dockerfile`, `compose.yaml`: 컨테이너 실행 참고 구성

## 저작권

이 저장소의 코드와 문서는 참고용으로 공개한 것이며, 별도의 오픈소스 라이선스를 부여하지 않았습니다(모든 권리 보유). 복제·수정·재배포가 필요하면 저장소 이슈로 먼저 문의해 주세요.

사용한 외부 구성요소와 라이선스는 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)에 정리되어 있습니다. 폰트 Pretendard의 SIL Open Font License 원문은 [`public/fonts/OFL.txt`](public/fonts/OFL.txt)에 포함되어 있습니다.
