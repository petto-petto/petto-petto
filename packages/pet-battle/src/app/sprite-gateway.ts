import type { BattleCommand, BattlePet, BattleResult, BattleState } from '../contracts.ts';
import type { BattleGateway } from '../ports/battle-gateway.ts';
import type { BattlePetSprites, BattleSpritePort } from '../ports/sprites.ts';

export class SpriteBattleGateway implements BattleGateway {
  readonly #engine: BattleGateway;
  readonly #sprites: BattleSpritePort;

  constructor(engine: BattleGateway, sprites: BattleSpritePort) {
    this.#engine = engine;
    this.#sprites = sprites;
  }

  async execute(command: BattleCommand): Promise<BattleResult> {
    const result = await this.#engine.execute(command);
    const petSprites = Object.fromEntries(
      result.state.roster.map((pet) => [pet.petId, this.#sprites.resolve(pet)]),
    );
    return { ...result, state: { ...result.state, petSprites } };
  }
}
