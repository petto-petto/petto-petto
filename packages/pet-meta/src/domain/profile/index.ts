/** 조련사 프로필. 기획서 5.1의 `user_profile` 논리 모델이다. */

import { Rng } from '../rng.ts';

/** 익명 이름 생성용 형용사. 기획서 13장이 목록 구성은 구현 조정 범위로 둔다. */
const ADJECTIVES = [
  '까만',
  '졸린',
  '용감한',
  '느긋한',
  '재빠른',
  '포근한',
  '엉뚱한',
  '당당한',
  '수줍은',
  '꼼꼼한',
  '명랑한',
  '차분한',
  '장난꾸러기',
  '사려깊은',
  '씩씩한',
  '다정한',
] as const;

/** 익명 이름 생성용 동물. */
const ANIMALS = [
  '코뿔소',
  '수달',
  '참새',
  '너구리',
  '고슴도치',
  '다람쥐',
  '펭귄',
  '여우',
  '두더지',
  '올빼미',
  '해달',
  '산양',
  '물범',
  '왜가리',
  '청설모',
  '삵',
] as const;

/** 이름 저장 규칙 위반(기획서 5.1). */
export type NameErrorKind = 'empty' | 'too_long' | 'control_character';

const NAME_MESSAGES: Record<NameErrorKind, string> = {
  empty: '이름을 입력해 주세요',
  too_long: '이름은 20자까지 쓸 수 있어요',
  control_character: '줄바꿈과 특수 제어 문자는 쓸 수 없어요',
};

export class NameError extends Error {
  override readonly name = 'NameError';
  readonly kind: NameErrorKind;

  constructor(kind: NameErrorKind) {
    super(NAME_MESSAGES[kind]);
    this.kind = kind;
  }

  userMessage(): string {
    return NAME_MESSAGES[this.kind];
  }
}

/** 사용자 표시 문자 수. 이모지가 조각나지 않게 코드 포인트 단위로 센다. */
const displayLength = (value: string): number => [...value].length;

/**
 * 제어 문자가 섞였는가. 줄바꿈과 탭도 제어 문자로 본다.
 *
 * 정규식 대신 코드 포인트를 직접 보는 이유: 제어 문자를 정규식 리터럴에 넣으면 소스에
 * 보이지 않는 바이트가 들어가 리뷰에서 확인할 수 없다.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * 이름 저장 전 검증. 통과하면 **저장할 값**(공백 제거본)을 돌려준다.
 *
 * 검증과 정규화를 한 함수로 묶은 이유: 둘을 분리하면 호출자가 정규화를 잊고 원본을
 * 저장하는 실수가 생긴다. 통과한 값만 손에 쥐게 만든다.
 */
export function validateTrainerName(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new NameError('empty');
  if (hasControlCharacter(trimmed)) throw new NameError('control_character');
  if (displayLength(trimmed) > 20) throw new NameError('too_long');
  return trimmed;
}

/**
 * `형용사 + 동물` 조합을 만든다.
 *
 * 기획서 5.1이 금지한 것: OS 사용자 이름, MAC 주소, 계정 식별자. 그래서 이 함수는
 * **시드 숫자 외에는 어떤 기기 정보도 입력으로 받지 않는다.**
 */
export function generateTrainerName(seed: number): string {
  const rng = new Rng(seed);
  const adjective = ADJECTIVES[rng.below(ADJECTIVES.length)] ?? ADJECTIVES[0];
  const animal = ANIMALS[rng.below(ANIMALS.length)] ?? ANIMALS[0];
  return `${adjective} ${animal}`;
}

/** 기획서 10장의 `user_profile`. */
export interface UserProfile {
  displayName: string;
  /** 기획서 7.3: 최대 한 개만 표시한다. 해제 상태를 허용하므로 `undefined` 가능. */
  equippedTitle: string | undefined;
  ownedTitles: string[];
}

export function createProfile(nameSeed: number): UserProfile {
  return {
    displayName: generateTrainerName(nameSeed),
    equippedTitle: undefined,
    ownedTitles: [],
  };
}

/**
 * 칭호를 획득한다. 기획서 7.3·ACH-005의 자동 장착 규칙이 여기 한 곳에만 있다.
 *
 * 첫 칭호만 자동 장착하고, 이미 장착값이 있으면 건드리지 않는다. 사용자가 직접 해제해
 * 비어 있는 경우에도 자동 장착이 되살아나면 안 되므로, 판단 기준은 "장착값이 비었는가"가
 * 아니라 **"이번이 첫 칭호인가"**다.
 */
export function grantTitle(profile: UserProfile, title: string): void {
  if (profile.ownedTitles.includes(title)) return;
  const isFirstTitle = profile.ownedTitles.length === 0;
  profile.ownedTitles.push(title);
  if (isFirstTitle) profile.equippedTitle = title;
}

/** 보유한 칭호만 장착할 수 있다. `undefined`는 해제다. */
export function equipTitle(profile: UserProfile, title: string | undefined): boolean {
  if (title === undefined) {
    profile.equippedTitle = undefined;
    return true;
  }
  if (!profile.ownedTitles.includes(title)) return false;
  profile.equippedTitle = title;
  return true;
}

/** 이름을 바꾼다. 잘못된 이름이면 `NameError`를 던지고 기존 값은 그대로 둔다. */
export function renameTrainer(profile: UserProfile, input: string): void {
  profile.displayName = validateTrainerName(input);
}
