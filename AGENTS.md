# AGENTS.md

이 저장소에서 일하는 모든 도구(Claude Code, Hermes, Codex)가 따르는 규칙.

## 작업 위치

- 원본은 GitHub `Dj-Lee2/weekly-field-plan`의 main이다. 공공 GitLab(`gov`)은 같은 기록의 사본이다.
- 공개 저장소다. 이 저장소에 들어가는 모든 파일·커밋 메시지는 공개된다고 생각하고 쓴다.

## 순서

1. 시작 전에 `git pull --ff-only`로 최신 main을 받는다.
2. 고친 뒤 `npm test`·`npm run build`·`npm run build:demo`를 통과시키고 커밋한다. 메시지는 짧은 제목 한 줄, AI 표기(Co-Authored-By 등)는 넣지 않는다.
3. `git push gov main`(GitLab)을 먼저 하고, 통과하면 `git push origin main`(GitHub). GitLab은 push 때 보안 검사를 하며 걸리면 거부된다. 거부되면 고쳐서 커밋한 뒤 다시 GitLab부터.
4. 서버 반영은 이 저장소 밖의 배포 도구로 한다. 배포 도구·서버 설정은 여기에 두지 않는다.

## 지키는 것

- 서버 IP·호스트 이름·계정명·경로·포트·다른 서비스 이름 같은 운영 정보를 저장소에 적지 않는다. 호스트 주소는 환경변수(`PUBLIC_ORIGIN` 등)로 받는다.
- 실명·개인 메일·소속·연락처 같은 개인정보를 파일·커밋 메시지에 적지 않는다. 커밋 메일은 GitHub 가림 주소(`…@users.noreply.github.com`)를 쓴다.
- 실제 작업 자료·구성원 명단을 넣지 않는다. 예시 자료는 모두 '예시'로 표시한다.
- `.env`, `runtime/`, `artifacts/`, `*.sqlite`는 커밋하지 않는다.
- 외부 코드·그림·폰트를 가져오면 `THIRD-PARTY-NOTICES.md`에 출처와 라이선스를 적는다.
