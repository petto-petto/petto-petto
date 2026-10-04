# 전투 상태와 독립적인 펫 카메라

## 범위와 기준

- Track: `work` standard. Seed: 승인된 `battle-ui.md`의 카메라 규칙과 이번 요청(전투 여부와 무관하게 펫 추적). 이전의 보행 중에만 추적하는 제한을 대체한다.
- 성공 기준: 500ms 전 펫 지면 위치를 공격·정지·메뉴·정복 중에도 추적하고, 멈춘 펫까지 따라온 뒤 안정된다. 배경은 함께 움직이고 HUD는 고정된다.
- 비목표: 공격·추격 속도, XP·HP 규칙, 창 옵션, 에셋, 다른 패키지 변경. 수동 모션의 장식 오프셋과 발구름 높이는 지면 이동으로 취급하지 않는다.
- 기존 모션 감소 설정과 화면 이탈 방지를 유지한다. 배경 여백 32px에 맞춘 카메라 안전 범위도 유지한다.

## 역할별 결과

- Explorer: `ArenaDirector`의 카메라 시계가 `active`, 추적 보간이 `petGait.step`에 종속되어 공격·정지 시 추적이 끊겼다. 실제 렌더러는 카메라를 배경과 캐릭터에 이미 함께 적용한다.
- Planner: 전투 시계는 유지하고 카메라의 기록·보간만 분리한다. 실제 이동 좌표와 화면 투영 좌표를 나누어 정지 테스트를 검증한다.
- Implementer: `9034236`에서 의도한 오류 6건을 재현(RED), `f5522e5`에서 같은 테스트 34/34 통과(GREEN). 생산 코드 변경은 `src/view/arena.ts` 한 파일이다.
- Verifier / Mechanical: `bash .harness/scripts/verify-electron.sh` 통과 — 포맷, 타입 검사, 전체 테스트 381/381. 관련 회귀·커버리지 테스트 50/50; `arena.ts` line/function 100%, branch 97.92%.
- Verifier / Semantic: `node packages/pet-battle/test/arena.browser.cjs --camera-only` 통과. 실제 DOM 960프레임 중 보행 외 카메라 이동 471프레임, 공격·도약·내려찍기 포함. STOP·메뉴에서는 개체 월드 좌표 고정, 카메라 추적 후 안정, HUD 고정을 확인했다. 브라우저 오류 없음.
- Reviewer: 독립 검토에서 수정할 결함 없음. 관련 테스트 50/50 독립 재실행 통과, 전투 외 변경 없음.
- 전체 브라우저 회귀: PASS, 오류 0. 360×180·640×420·960×540·360×640 창, HP 100%·60%·25%, 수동 공격, STOP·메뉴, 처치·등장, HP 연출, 공통 펫 18종/단계 스프라이트와 말풍선 검증 통과. 화면 증거: `/var/folders/99/0pkzqg252ks87k97sc4shm880000gn/T/pet-battle-arena-evidence-UrRNBx/`.
- Evolve: none. 공유 하네스 변경 없이 전투 문서의 기존 규칙만 교체했다.

## 재현 명령

```bash
node --test packages/pet-battle/test/arena.test.ts packages/pet-battle/test/camera-follow.test.ts
bash .harness/scripts/verify-electron.sh
node packages/pet-battle/test/arena.browser.cjs --camera-only
node packages/pet-battle/test/arena.browser.cjs
```

브라우저 검증은 임시 프로필과 격리된 HTTP fixture를 사용하며 실제 사용자 펫·DB는 변경하지 않는다. 기존 미추적 `2026-09-29-battle-hp-chip-effect.md`는 이 작업에서 수정하거나 커밋하지 않는다.
