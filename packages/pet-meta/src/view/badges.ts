/**
 * 업적 배지. 업적 줄 맨 앞, 예전에 자물쇠가 있던 자리에 그리는 16×16 픽셀 그림이다.
 *
 * ## 그림이 왜 코드에 있는가
 *
 * 배지는 업적 정의와 한 쌍이다. 업적을 추가하면서 배지를 빠뜨리면 그 줄만 기본 배지로 보이는데,
 * 그림이 파일로 따로 있으면 그걸 잡아 줄 것이 없다. 여기 두면 계약 테스트가 "모든 업적에 자기
 * 배지가 있다"를 확인한다.
 *
 * ## 형식
 *
 * 배지 하나는 16글자짜리 문자열 16줄이다. 글자 하나가 픽셀 하나이고, `.` 은 투명이다. 나머지
 * 글자는 `BADGE_PALETTE` 의 색이다. 색은 디자인 가이드의 토큰만 쓴다 — 에픽 보라는 가이드대로
 * 에픽 등급을 뜻하는 배지(행운아 · 연금술의 기적)에만 썼다.
 *
 * 화면은 이것을 정수 배율(2배)로 그린다. 달성한 업적은 색 그대로, 잠긴 업적은 나무색 두 톤으로
 * 눌러 그려서 모양만 남긴다. 어떻게 누를지는 화면이 정한다.
 *
 * ## 가려진 히든 업적
 *
 * 달성 전의 히든 업적에는 자기 배지 대신 `MYSTERY_BADGE` 를 내보낸다. 이름과 조건을 `? ? ?` 로
 * 가리는 것과 같은 이유다 — 그림이 조건을 미리 알려 주면 안 된다.
 */

/** 배지 한 장. 16글자 문자열 16줄. */
export type BadgePixels = readonly string[];

/** 배지 한 변의 픽셀 수. */
export const BADGE_SIZE = 16;

/** 글자 → 색. `.` (투명)은 여기 없다. */
export const BADGE_PALETTE: Readonly<Record<string, string>> = {
  k: '#2C2438', // 외곽선
  w: '#F5ECD8', // 밝은 면
  y: '#FFD166', // 금색
  o: '#F0B775', // 따뜻한 주황
  h: '#A5763F', // 나무 하이라이트
  b: '#6B4A2E', // 나무 면
  d: '#3A2A1C', // 나무 테두리
  l: '#8FD68A', // 숲의 빛
  g: '#3C7A4A', // 잎
  f: '#1C4A34', // 짙은 숲
  s: '#9AA0A6', // 밝은 회색
  S: '#62676C', // 어두운 회색
  p: '#B46BFF', // 에픽 밝은 색
  P: '#6C37A0', // 에픽 어두운 색
};

/** 가려진 히든 업적에 쓰는 물음표. */
export const MYSTERY_BADGE: BadgePixels = [
  '................',
  '.....kkkkkk.....',
  '....kwwwwwwk....',
  '...kwwkkkkwwk...',
  '...kwwk..kwwk...',
  '....kk...kwwk...',
  '........kwwk....',
  '.......kwwk.....',
  '......kwwk......',
  '......kwwk......',
  '......kkkk......',
  '................',
  '......kkkk......',
  '......kwwk......',
  '......kkkk......',
  '................',
];

/** 자기 배지가 없는 업적에 쓰는 별 메달. 정의를 추가하고 배지를 아직 그리지 않았을 때 보인다. */
export const DEFAULT_BADGE: BadgePixels = [
  '................',
  '.....kkkkkk.....',
  '...kkyyyyyykk...',
  '..kyyyyyyyyyyk..',
  '..kywyykkyyyyk..',
  '.kywyyykkyyyyhk.',
  '.kyykkkkkkkkyhk.',
  '.kyyykkkkkkyyhk.',
  '.kyyyykkkkyyyhk.',
  '.kyyykkyykkyyhk.',
  '..kyykyyyykyhk..',
  '..kyyyyyyyyhhk..',
  '...kkhhhhhhkk...',
  '.....kkkkkk.....',
  '................',
  '................',
];

/** 업적 id → 배지. */
const BADGES: Readonly<Record<string, BadgePixels>> = {
  // 첫 만남 — 금이 간 알
  'collection.first_pet': [
    '................',
    '......kkkk......',
    '.....kwwwwk.....',
    '....kwwwwwwk....',
    '...kwwwwwwwwk...',
    '...kwwwwwwwwk...',
    '..kwwwwwwwwwwk..',
    '..kwkwwkwwkwwk..',
    '..kkokkokkokwk..',
    '..koooooooookk..',
    '..kooooooooook..',
    '..kooooooooook..',
    '...kooooooook...',
    '...khooooohhk...',
    '....kkhhhhkk....',
    '......kkkk......',
  ],
  // 수집가 Ⅰ — 도감 한 권
  'collection.dex_5': [
    '................',
    '................',
    '...kkkkkkkkkk...',
    '..kggggggggggk..',
    '..kglgggggggyk..',
    '..kglgggggggyk..',
    '..kglggyyggggk..',
    '..kglgyyyygggk..',
    '..kglgyyyygggk..',
    '..kglggyyggggk..',
    '..kglggggggggk..',
    '..kglggggggggk..',
    '..kgffffffffgk..',
    '..kwwwwwwwwwwk..',
    '...kkkkkkkkkk...',
    '................',
  ],
  // 수집가 Ⅱ — 쌓인 도감
  'collection.dex_15': [
    '................',
    '....kkkkkkkkk...',
    '...kgggggggggk..',
    '...kglgggyyggk..',
    '...kffffffffgk..',
    '...kwwwwwwwwwk..',
    '..kkkkkkkkkkkk..',
    '..khhhhhhhhhhk..',
    '..khohhhyyhhhk..',
    '..kbbbbbbbbbhk..',
    '..kwwwwwwwwwwk..',
    '.kkkkkkkkkkkkkk.',
    '.kSSSSSSSSSSSSk.',
    '.kSsSSSSyySSSSk.',
    '.kwwwwwwwwwwwwk.',
    '..kkkkkkkkkkkk..',
  ],
  // 도감 마스터 — 왕관을 쓴 펼친 도감
  'collection.dex_complete': [
    '......k..k......',
    '.....kyk.kyk....',
    '...k.kyykyyk.k..',
    '..kykkyyyyykkyk.',
    '..kyyyyyyyyyyyk.',
    '...kyyyyyyyyyk..',
    '...kkkkkkkkkkk..',
    '................',
    '.kkkkkk..kkkkkk.',
    '.kwwwwwkkwwwwwk.',
    '.kwsswwkkwwsswk.',
    '.kwwwwwkkwwwwwk.',
    '.kwsswwkkwwsswk.',
    '.kwwwwwkkwwwwwk.',
    '.kgggggkkgggggk.',
    '..kkkkkkkkkkkk..',
  ],
  // 행운아 — 에픽 보석
  'collection.first_epic': [
    '................',
    '.......kk.....w.',
    '......kppk...www',
    '.....kpwppk...w.',
    '....kpwpppPk....',
    '...kpwpppppPk...',
    '..kppppppppPPk..',
    '..kkkkkkkkkkkk..',
    '..kpppppPPPPPk..',
    '...kpppPPPPPk...',
    '....kppPPPPk....',
    '.w...kpPPPk.....',
    'www...kPPk......',
    '.w.....kk.......',
    '................',
    '................',
  ],
  // 연금술사 Ⅰ — 플라스크
  'collection.fusion_5': [
    '................',
    '.....kkkkkk.....',
    '.....kwwwwk.....',
    '......kwwk......',
    '......kwwk......',
    '......kwwk......',
    '.....kwwwwk.....',
    '....kwwwwwwk....',
    '...kwwwwwwwwk...',
    '..kwllllllllwk..',
    '..kllwlllllllk..',
    '..klllllllgggk..',
    '..kllllllggggk..',
    '...klllgggggk...',
    '....kkkkkkkk....',
    '................',
  ],
  // 연금술사 Ⅱ — 끓는 솥
  'collection.fusion_50': [
    '.....l....l.....',
    '........l.......',
    '...l.......l....',
    '.kkkkkkkkkkkkkk.',
    '.kSSSSSSSSSSSSk.',
    '..kllllllllllk..',
    '.kkSSSSSSSSSSkk.',
    'kSkSsSSSSSSSSkSk',
    'kSkSsSSSSSSSSkSk',
    '.kkSsSSSSSSSSkk.',
    '..kSSSSSSSSSSk..',
    '..kSSSSSSSSSSk..',
    '...kSSSSSSSSk...',
    '....kkkkkkkk....',
    '...kk......kk...',
    '..kk........kk..',
  ],
  // 첫 걸음 — 새싹
  'growth.level_5': [
    '................',
    '................',
    '................',
    '...kkk....kkk...',
    '..kllgk..kllgk..',
    '..klllgkklllgk..',
    '..kglllggllggk..',
    '...kgglggggkk...',
    '....kkkggkk.....',
    '......kggk......',
    '......kggk......',
    '......kggk......',
    '...kkkkggkkkk...',
    '..kbbbbbbbbbbk..',
    '..khhhbbbbbbbk..',
    '...kkkkkkkkkk...',
  ],
  // 오랜 친구 Ⅰ — 어린 나무
  'growth.level_10': [
    '................',
    '......kkkk......',
    '.....kllllk.....',
    '....kllllggk....',
    '...kllllllggk...',
    '...klllllgggk...',
    '...kgllggggfk...',
    '....kggggffk....',
    '.....kkbbkk.....',
    '.......bb.......',
    '......kbbk......',
    '......kbbk......',
    '......kbbk......',
    '....kkkbbkkk....',
    '...kgggggggfk...',
    '....kkkkkkkk....',
  ],
  // 오랜 친구 Ⅱ — 큰 나무
  'growth.level_20': [
    '.....kkkkkk.....',
    '...kkllllllkk...',
    '..kllllllllggk..',
    '.klllwllllllggk.',
    '.kllllllllgggfk.',
    'kllllllllggggffk',
    'kgllllglgggggffk',
    'kgglggggggggfffk',
    '.kgggggggggfffk.',
    '..kkgggfffffkk..',
    '....kkkbbkkk....',
    '......kbbk......',
    '......kbbk......',
    '.....khbbbk.....',
    '...kkhbbbbbkk...',
    '...kkkkkkkkkk...',
  ],
  // 오랜 친구 Ⅲ — 왕관
  'growth.max_level': [
    '................',
    '................',
    '..k....kk....k..',
    '.kyk..kyyk..kyk.',
    '.kyk..kyyk..kyk.',
    '.kyyk.kyyk.kyyk.',
    '.kyyykyyyykyyyk.',
    '.kyyyyyyyyyyyyk.',
    '.kywyyyyyyyyyyk.',
    '.kyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkk.',
    '.kopoyylyyopoyk.',
    '.kyyyyyyyyyyyyk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ],
  // 진화의 순간 — 위로 솟는 화살표 둘
  'growth.first_evolution': [
    '.......kk.......',
    '......kyyk......',
    '.....kywyyk.....',
    '....kywyyyyk....',
    '...kyyyyyyyyk...',
    '..kkkkyyyykkkk..',
    '.....kyyyyk.....',
    '.......kk.......',
    '......kllk......',
    '.....klwllk.....',
    '....klwllllk....',
    '...kllllllllk...',
    '..kkkkllllkkkk..',
    '.....kllllk.....',
    '.....kllllk.....',
    '.....kkkkkk.....',
  ],
  // 첫 승리 — 검
  'battle.first_win': [
    '.............kkk',
    '............kwsk',
    '...........kwssk',
    '..........kwssk.',
    '.........kwssk..',
    '........kwssk...',
    '.......kwssk....',
    '.k....kwssk.....',
    'kyk..kwssk......',
    'kyykkwssk.......',
    '.kyykssk........',
    '..kyyyk.........',
    '.kbkyyyk........',
    'kbbk.kyyk.......',
    'kbk...kkk.......',
    '.k..............',
  ],
  // 백전노장 Ⅰ — 교차한 검
  'battle.win_50': [
    'kkk..........kkk',
    'kswk........kwsk',
    'kssk........kssk',
    '.kssk......kssk.',
    '..kssk....kssk..',
    '...kssk..kssk...',
    '....ksskkssk....',
    '.....kssssk.....',
    '.....kssssk.....',
    '.k..kssksskk..k.',
    'kykkssk..ksskkyk',
    'kyykkk....kkkyyk',
    '.kyyk......kyyk.',
    'kbkyyk....kyykbk',
    'kbk.kk....kk.kbk',
    '.k............k.',
  ],
  // 백전노장 Ⅱ — 별 방패
  'battle.win_500': [
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kyyyyyyyyyyyyk.',
    '.kyhhhhhhhhhhyk.',
    '.kyhhhhkkhhhhyk.',
    '.kyhhhkyykhhhyk.',
    '.kyhkkkyykkkhyk.',
    '.kyhkyyyyyykhyk.',
    '.kyhhkyyyykhhyk.',
    '.kyhhkyyyykhhyk.',
    '..kyhkykkykhyk..',
    '..kyhkkhhkkhyk..',
    '...kyhhhhhhyk...',
    '....kyyhhyyk....',
    '.....kkyykk.....',
    '.......kk.......',
  ],
  // 무패 — 불꽃
  'battle.streak_10': [
    '.......k........',
    '......kok.......',
    '......kook......',
    '.....koook.k....',
    '.....koyookok...',
    '....kooyyookok..',
    '...kooyyyyoook..',
    '...koyyyyyyook..',
    '..kooyywwyyyook.',
    '..koyywwwwyyook.',
    '..koyywwwwyyook.',
    '..kooyywwyyoook.',
    '...kooyyyyoook..',
    '....kooooook....',
    '.....kkkkkk.....',
    '................',
  ],
  // 토큰 마일스톤 Ⅰ — 동전
  'usage.tokens_1m': [
    '................',
    '.....kkkkkk.....',
    '...kkyyyyyykk...',
    '..kyyyyyyyyyyk..',
    '..kywyykkyyyhk..',
    '.kywyykyykyyyhk.',
    '.kywyykyyyyyyhk.',
    '.kyyyyykkyyyyhk.',
    '.kyyyyyyykyyyhk.',
    '.kyyyykyykyyyhk.',
    '..kyyyykkyyyhk..',
    '..kyyyyyyyyhhk..',
    '...kkhhhhhhkk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ],
  // 토큰 마일스톤 Ⅱ — 동전 더미
  'usage.tokens_10m': [
    '................',
    '....kkkkkkkk....',
    '...kyyyyyyyyk...',
    '...kywyyyyyhk...',
    '...khhhhhhhhk...',
    '..kkkkkkkkkkkk..',
    '..kyyyyyyyyyyk..',
    '..kywyyyyyyyhk..',
    '..khhhhhhhhhhk..',
    '.kkkkkkkkkkkkkk.',
    '.kyyyyyyyyyyyyk.',
    '.kywyyyyyyyyyhk.',
    '.khhhhhhhhhhhhk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
  ],
  // 토큰 마일스톤 Ⅲ — 보물 상자
  'usage.tokens_100m': [
    '................',
    '....y......y....',
    '..kkkkkkkkkkkk..',
    '.kyyyyyyyyyyyyk.',
    '.kywyyyyyyyyyyk.',
    'kkkkkkkkkkkkkkkk',
    'khhhhhhhhhhhhhhk',
    'khbbbbbkkbbbbbhk',
    'kkkkkkkyykkkkkkk',
    'khbbbbkyykbbbbhk',
    'khbbbbbkkbbbbbhk',
    'khbbbbbbbbbbbbhk',
    'khbbbbbbbbbbbbhk',
    'khhhhhhhhhhhhhhk',
    'kkkkkkkkkkkkkkkk',
    '................',
  ],
  // 함께한 시간 Ⅰ — 시계
  'usage.active_24h': [
    '................',
    '.....kkkkkk.....',
    '...kkwwwwwwkk...',
    '..kwwwwkwwwwwk..',
    '.kwwwwwkwwwwwwk.',
    '.kwwwwwkwwwwwwk.',
    'kwwwwwwkwwwwwwwk',
    'kwwwwwwkwwwwwwwk',
    'kwwwwwwkkkkkwwwk',
    'kwwwwwwwwwwwwwwk',
    '.kwwwwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kkwwwwwwkk...',
    '.....kkkkkk.....',
    '................',
  ],
  // 세 도구의 조련사 — 별 셋
  'hidden.three_tools_day': [
    '.......kk.......',
    '......kyyk......',
    '...kkkkyykkkk...',
    '...kyyyyyyyyk...',
    '....kyyyyyyk....',
    '....kyykkyyk....',
    '...kykk..kkyk...',
    '..kkk......kkk..',
    '.kllk......kook.',
    'kkllkkk..kkkookk',
    'klllllk..koooook',
    '.klllk....koook.',
    '.klklk....kokok.',
    'kkk.kkk..kkk.kkk',
    '................',
    '................',
  ],
  // 연금술의 기적 — 에픽 플라스크
  'hidden.common_fusion_epic': [
    '..y.............',
    '.yyy....kkkkkk..',
    '..y.....kwwwwk..',
    '.........kwwk...',
    '.........kwwk...',
    '....y....kwwk...',
    '........kwwwwk..',
    '.......kwwwwwwk.',
    '......kwppppppwk',
    '.....kppwpppppPk',
    '.y...kppppppPPPk',
    'yyy..kpppppPPPPk',
    '.y....kppPPPPPk.',
    '.......kkkkkkk..',
    '................',
    '................',
  ],
};

/**
 * 보상 종류의 아이콘. 8×8 이고 배지와 같은 팔레트, 같은 배율로 그린다.
 *
 * 보상 셋이 전부 같은 네모 칩이면 무엇이 토큰이고 무엇이 칭호인지 글자를 읽어야 안다. 종류마다
 * 그림을 달리해 한눈에 갈리게 한다 — 토큰은 금색 동전, 칭호는 초록 깃발, 트로피는 잔이다.
 *
 * 칭호를 금색 리본 장식으로 그렸더니 동전과 같은 금색 동그라미로 보여 둘이 헷갈렸다. 그래서
 * 칭호는 모양(세로로 긴 깃발)과 색(초록)을 모두 달리했고, 금색은 쓰지 않는다.
 *
 * 토큰 아이콘은 업적 보상뿐 아니라 정보 화면의 토큰 숫자 옆에도 그린다. 같은 그림이 같은 것을
 * 가리키게 하려는 것이다.
 */
export const REWARD_ICONS: Readonly<Record<'token' | 'title' | 'trophy', BadgePixels>> = {
  // 토큰 — 동전
  token: [
    '..kkkk..',
    '.kyyyyk.',
    'kywyyyhk',
    'kyyyyyhk',
    'kyyyyyhk',
    'kyyyyhhk',
    '.khhhhk.',
    '..kkkk..',
  ],
  // 칭호 — 가로대에 건 초록 깃발
  title: [
    'kbbbbbbk',
    '.kllllk.',
    '.klwllk.',
    '.kllllk.',
    '.kllggk.',
    '.klgggk.',
    '.kgkkgk.',
    '.kk..kk.',
  ],
  // 트로피 — 잔
  trophy: [
    'kkkkkkkk',
    'kywyyyyk',
    'kyyyyyyk',
    '.kyyyyk.',
    '..kyyk..',
    '...kk...',
    '..kyyk..',
    '.kkkkkk.',
  ],
};

/** 화면이 한 번 받아 두고 쓰는 그림 — 팔레트와 종류 아이콘. 줄마다 달라지지 않는 것들이다. */
export interface UiIcons {
  palette: Readonly<Record<string, string>>;
  rewards: typeof REWARD_ICONS;
}

/** 화면 공용 아이콘. 정보 탭과 업적 탭이 같은 그림을 쓰도록 한곳에서 내려보낸다. */
export function uiIcons(): UiIcons {
  return { palette: BADGE_PALETTE, rewards: REWARD_ICONS };
}

/** 이 업적의 배지. 자기 배지가 없으면 기본 배지다. */
export function badgeFor(achievementId: string): BadgePixels {
  return BADGES[achievementId] ?? DEFAULT_BADGE;
}

/** 자기 배지를 가진 업적 id 들. 계약 테스트가 업적 정의와 대조한다. */
export const BADGED_ACHIEVEMENT_IDS: readonly string[] = Object.keys(BADGES);
