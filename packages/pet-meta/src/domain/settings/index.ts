/** 설정 화면의 저장 상태. 기획서 6.2·6.3의 `meta_settings` 논리 모델이다. */

/**
 * 펫 크기. 기획서 SET-005: 이 값은 **패널 크기에 영향을 주지 않는다.**
 * 패널은 항상 400×462다.
 */
export type PetSize = 'small' | 'normal' | 'large';

export const PET_SIZES: readonly PetSize[] = ['small', 'normal', 'large'];

const PET_PIXELS: Record<PetSize, number> = { small: 96, normal: 128, large: 176 };

/** 자리표시 펫 창의 한 변 길이(논리 픽셀). */
export const petSizePixels = (size: PetSize): number => PET_PIXELS[size];

export const isPetSize = (value: string): value is PetSize =>
  (PET_SIZES as readonly string[]).includes(value);

export interface MetaSettings {
  /** 오버레이 표시 — 초기값 켜짐. */
  overlayVisible: boolean;
  /** 펫 크기 — 초기값 보통. */
  petSize: PetSize;
  /** 부팅 시 자동 실행 — 초기값 꺼짐(SET-006). */
  autostart: boolean;
  /** 레벨업 알림 — 초기값 켜짐. */
  notifyLevelup: boolean;
  /** 업적 달성 알림 — 초기값 켜짐. */
  notifyAchievement: boolean;
  /** 뽑기 가능 알림 — 초기값 꺼짐. */
  notifyGachaReady: boolean;
}

/** 기획서 6.2·6.3의 초기값을 한곳에 못박는다. */
export function defaultSettings(): MetaSettings {
  return {
    overlayVisible: true,
    petSize: 'normal',
    autostart: false,
    notifyLevelup: true,
    notifyAchievement: true,
    notifyGachaReady: false,
  };
}

/** 패널 규약(기획서 4.2). 값이 코드 여기저기 흩어지지 않도록 상수로 모은다. */
export const PANEL_WIDTH = 400;
export const PANEL_HEIGHT = 510;
