import type { BattleCommand, BattleResult } from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import type { BattleDisplaySettingsPort } from '../ports/display-settings.ts';
import { assertBattleClientCommand } from './client-policy.ts';

/** Serialize display changes with polling; the owner persists before they become visible. */
export class DisplaySettingsBattleGateway implements BattleGateway {
  readonly #gateway: BattleGateway;
  readonly #settings: BattleDisplaySettingsPort;
  #queue: Promise<unknown> = Promise.resolve();
  #opacity: number | undefined;

  constructor(gateway: BattleGateway, settings: BattleDisplaySettingsPort) {
    this.#gateway = gateway;
    this.#settings = settings;
  }

  execute(command: BattleCommand): Promise<BattleResult> {
    const result = this.#queue.then(() => this.#execute(command));
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #execute(command: BattleCommand): Promise<BattleResult> {
    assertBattleClientCommand(command);
    if (command.type === 'SET_DISPLAY_OPACITY') {
      if (!Number.isInteger(command.percent) || command.percent < 0 || command.percent > 100)
        throw new Error('투명도는 0~100 사이의 정수여야 합니다');
      this.#settings.setOpacity(command.percent);
    }
    const settings = this.#settings.read();
    if (this.#opacity !== settings.opacity) {
      await this.#gateway.execute({ type: 'SET_DISPLAY_OPACITY', percent: settings.opacity });
      this.#opacity = settings.opacity;
    }
    const result = await this.#gateway.execute(command);
    return {
      ...result,
      state: {
        ...result.state,
        preview: { ...result.state.preview, animationsEnabled: settings.animationsEnabled },
      },
    };
  }
}
