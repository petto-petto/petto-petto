export interface BattleDisplaySettingsPort {
  read(): { animationsEnabled: boolean; opacity: number };
  setOpacity(percent: number): void;
}
