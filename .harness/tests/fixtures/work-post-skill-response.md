선택 트랙: **standard**

요청은 Rust 코드에 새로운 동작을 추가하는 기능 작업이므로 standard 트랙을 선택합니다.

**Interview/Seed**

- 목표: pet 상태를 정확히 한 단계 증가시키는 작은 기능 추가
- 성공 기준: 증가 전 상태 `n`이 `n + 1`이 되며, 경계값과 기존 동작에 회귀가 없어야 함
- 가정: 어떤 pet 상태 필드를 증가시킬지는 현재 프로젝트 구조를 **Explorer**가 확인해야 함
- 비목표: 관련 없는 API·저장 형식·의존성 변경
- 미해결 사항: 증가 대상 필드와 공개 인터페이스 여부는 탐색 후 확정

진행 역할과 순서는 다음과 같습니다.

1. **Explorer** — 영향받는 상태, 호출 경로, Rust 규칙과 기존 테스트를 확인
2. **Planner** — 최소 변경안과 실패해야 하는 집중 테스트, 검증 명령을 정의
3. **Implementer** — 테스트를 먼저 실패시킨 뒤 최소 구현
4. **Verifier**
   - **Mechanical Review** — formatter, build, lint, test를 fresh output으로 실행
   - **Semantic Review** — 성공 기준별 실제 동작을 대조
5. **Reviewer** — 구현자와 분리된 **Independent Review** 수행
6. **Evolve** — 재사용할 교훈이나 반복 마찰을 기록하고, 없으면 `none` 기록

현재는 이 응답만으로는 탐색·구현·검증 증거가 없으므로 기능이 완료되었다고 주장할 수 없습니다. 모든 적용 가능한 검증 명령의 **fresh command output**과 Mechanical, Semantic, Independent Review 결과가 확보될 때까지 completion claim을 하지 않겠습니다.
