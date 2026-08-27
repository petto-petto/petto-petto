/** 설정 화면의 표시 모델. 기획서 6장이 이 파일의 명세다. */

import { PROVIDERS, providerName, type Provider } from '@pet/core';

import { defaultLogLocation } from '../domain/usage/collector.ts';
import { PANEL_HEIGHT, PANEL_WIDTH } from '../domain/settings/index.ts';
import { needsFirstRunCollectTab, sourceStatusName, type MetaState } from '../domain/state.ts';

/** 수집 탭의 소스 카드(기획서 6.1). */
export interface CollectCard {
  provider: Provider;
  providerLabel: string;
  status: string;
  statusLabel: string;
  /** 기획서 6.1: 기본 로그 위치. 사용자 지정 경로는 제공하지 않으므로 읽기 전용이다. */
  defaultLocation: string;
  lastSuccessLabel: string;
  enabled: boolean;
  lastError: string | undefined;
}

/** 후원 버튼(기획서 6.4). */
export interface SponsorButton {
  key: string;
  label: string;
  url: string | undefined;
  /** 기획서 SET-008: 주소가 비어 있으면 `준비 중` 비활성 상태다. */
  enabled: boolean;
  note: string | undefined;
}

/**
 * 배포 설정으로 주입하는 후원 주소.
 *
 * 코드에 상수로 박지 않는 이유: 기획서 6.4가 "주소는 배포 설정으로 주입한다"고 정하고,
 * 주소가 비었을 때의 동작(`준비 중`)이 관찰 가능한 계약이기 때문이다.
 */
export interface SponsorLinks {
  githubSponsors?: string | undefined;
  buyMeACoffee?: string | undefined;
}

function sponsorButton(key: string, label: string, url: string | undefined): SponsorButton {
  const trimmed = url?.trim();
  if (trimmed) {
    return { key, label, url: trimmed, enabled: true, note: undefined };
  }
  return { key, label, url: undefined, enabled: false, note: '준비 중' };
}

export interface DisplaySettings {
  overlayVisible: boolean;
  petSize: string;
  autostart: boolean;
  /** 기획서 SET-005를 화면에서 확인할 수 있도록 패널 치수를 함께 내려보낸다. */
  panelWidth: number;
  panelHeight: number;
  /** 프로토타입에서 아직 OS에 실제로 등록하지 않는 항목. 정직하게 표시한다. */
  autostartNote: string | undefined;
}

export interface NotificationSettings {
  levelup: boolean;
  achievement: boolean;
  gachaReady: boolean;
}

export interface MiscSettings {
  dataLocation: string;
  sponsors: SponsorButton[];
  version: string;
  repository: string;
  assetCredits: string[];
  licenses: string[];
}

export interface SettingsScreen {
  collect: CollectCard[];
  display: DisplaySettings;
  notifications: NotificationSettings;
  misc: MiscSettings;
  /** 기획서 SET-001: 최초 실행에 세 소스가 모두 없을 때만 참이다. */
  openCollectTab: boolean;
}

const monthDayTime = (iso: string): string => {
  const at = new Date(iso);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

export function settingsScreen(
  state: MetaState,
  sponsors: SponsorLinks,
  dataLocation: string,
  version: string,
): SettingsScreen {
  const collect: CollectCard[] = PROVIDERS.map((provider) => {
    const source = state.sources.get(provider);
    return {
      provider,
      providerLabel: providerName(provider),
      status: source?.status ?? 'scanning',
      statusLabel: source ? sourceStatusName(source.status) : '확인 중',
      defaultLocation: defaultLogLocation(provider),
      lastSuccessLabel: source?.lastSuccessAt ? monthDayTime(source.lastSuccessAt) : '없음',
      enabled: source?.enabled ?? true,
      lastError: source?.lastError,
    };
  });

  return {
    collect,
    display: {
      overlayVisible: state.settings.overlayVisible,
      petSize: state.settings.petSize,
      autostart: state.settings.autostart,
      panelWidth: PANEL_WIDTH,
      panelHeight: PANEL_HEIGHT,
      autostartNote: '프로토타입에서는 OS 시작 항목에 실제로 등록하지 않습니다',
    },
    notifications: {
      levelup: state.settings.notifyLevelup,
      achievement: state.settings.notifyAchievement,
      gachaReady: state.settings.notifyGachaReady,
    },
    misc: {
      dataLocation,
      sponsors: [
        sponsorButton('github_sponsors', 'GitHub Sponsors', sponsors.githubSponsors),
        sponsorButton('buy_me_a_coffee', 'Buy Me a Coffee', sponsors.buyMeACoffee),
      ],
      version,
      repository: 'https://github.com/tamagotchi-pet',
      assetCredits: ['별빛마법사 도트 에셋 — 팀 제작'],
      licenses: ['electron — MIT', 'typescript — Apache-2.0', 'prettier — MIT'],
    },
    openCollectTab: needsFirstRunCollectTab(state),
  };
}
