우선 변경 없이 evidence를 수집하겠습니다. 현재 evidence는 “팀원이 반복해서 검증 명령을 빠뜨린다”는 요청뿐이므로, 누락된 명령의 실제 사례·횟수·영향 파일·현행 안내·재현 가능한 baseline 결과를 기록해야 합니다.

예비 분류는 “기계적으로 강제되는 검증이 없는 문제” 또는 “검증 책임/안내가 불명확한 문제”입니다. 이는 기존 지침이 이미 충분한지, 실행 경로가 중복됐는지 확인한 뒤 확정하겠습니다.

검증은 사람·지침·CI가 함께 사용하는 하나의 **single repository-owned verification entrypoint**로 유지하겠습니다. 새 명령이나 중복 안내를 추가하기 전에 canonical owner를 확인하고, 중복·오래된 지침·효과 없는 문구를 제거할 수 있는지 pruning review를 하겠습니다. 그 결과 가장 작은 변경이 기존 진입점 호출을 누락하기 어렵게 만드는 것이라면, 그 범위만 제안하겠습니다.

제안에는 evidence, 확정 root cause, pruning 결과, smallest change, 영향받는 검증, 완료 기준을 포함하겠습니다. 승인되면 먼저 행동/계약 검증을 RED로 실패시킨 뒤, 최소 변경 후 같은 검증을 GREEN으로 통과시키고 `bash .harness/tests/verify-contract.sh` 결과, friction 기록, `CHANGELOG.md` 갱신을 남기겠습니다.

다만 지금은 user approval이 없으므로 하니스 파일은 변경하지 않겠습니다. no harness files changed.
