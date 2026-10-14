// 펫이 진화시켜 달라고 말을 걸 때 쓰는 대사. 말풍선을 펼칠 때마다 하나를 고른다.
//
// 펫의 1인칭이다. 레벨 같은 숫자는 넣지 않는다 — 친구가 하는 말이지 상태 알림이 아니다.
// 문구를 고치거나 늘릴 때는 이 배열만 바꾸면 된다.
export const EVOLVE_LINES = [
  '나 이제 진화할 준비 됐어!',
  '몸이 근질근질해… 진화시켜 줄래?',
  '두근두근… 나 진화해도 돼?',
  '새로운 모습, 같이 보러 갈래?',
  '힘이 넘쳐! 지금이면 변할 수 있을 것 같아',
  '나 좀 더 멋져지고 싶어!',
  '변신하는 거 지켜봐 줄래?',
  '너랑 여기까지 왔으니까, 다음 모습도 보여 줄게!',
];

/**
 * 대사 하나를 고른다. 방금 본 대사는 다시 고르지 않는다 — 접었다 펼쳤는데 같은 말이
 * 나오면 랜덤처럼 느껴지지 않는다.
 */
export function pickEvolveLine(previous, random = Math.random) {
  const candidates = EVOLVE_LINES.filter((line) => line !== previous);
  return candidates[Math.floor(random() * candidates.length)] ?? EVOLVE_LINES[0];
}
