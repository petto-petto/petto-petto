import type {
  BattleCommand,
  BattleGateway,
  BattlePet,
  BattleResult,
  BattleState,
} from '../contracts.ts';

export type BattlePetSprites = NonNullable<BattleState['petSprites']>[string];

/** Battle presentation output, not a replacement for the owner's PetClient. */
export interface BattleSpritePort {
  resolve(pet: BattlePet): BattlePetSprites;
}

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
