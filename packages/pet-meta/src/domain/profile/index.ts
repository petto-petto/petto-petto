/**
 * 조련사 프로필. 기획서 5.1의 `user_profile` 논리 모델이다.
 *
 * 조련사 이름은 없다. 계정도 동기화도 없는 앱에서 사용자를 부를 이름은 아무것도
 * 식별하지 않았고, 정체성은 오버레이 펫이 이미 맡고 있다. 지금 남은 것은 칭호뿐이다.
 */

/** 기획서 10장의 `user_profile`. */
export interface UserProfile {
  /** 기획서 7.3: 최대 한 개만 표시한다. 해제 상태를 허용하므로 `undefined` 가능. */
  equippedTitle: string | undefined;
  ownedTitles: string[];
}

export function createProfile(): UserProfile {
  return { equippedTitle: undefined, ownedTitles: [] };
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
