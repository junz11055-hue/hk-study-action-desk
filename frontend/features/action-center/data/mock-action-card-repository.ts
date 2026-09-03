import { AppError } from "../../../lib/errors/app-error";
import {
  deepFreeze,
  type ReadonlyDeep,
} from "../../../lib/types/readonly-deep";
import {
  actionCardViewModelSchema,
  type ActionCardViewModel,
} from "../model/action-card-view-model";
import { syntheticActionCardFixtures } from "./synthetic-action-card.fixtures";

export interface ActionCardRepository {
  getById(
    notificationId: string,
  ): Promise<ReadonlyDeep<ActionCardViewModel>>;
  list(): Promise<readonly ReadonlyDeep<ActionCardViewModel>[]>;
}

export class MockActionCardRepository implements ActionCardRepository {
  readonly #cards: ReadonlyMap<
    string,
    ReadonlyDeep<ActionCardViewModel>
  >;

  constructor(fixtures: readonly unknown[] = syntheticActionCardFixtures) {
    const parsedCards = fixtures.map((fixture) => {
      const result = actionCardViewModelSchema.safeParse(fixture);

      if (!result.success) {
        throw new AppError({
          code: "VIEW_MODEL_CONTRACT_INVALID",
          safeMessage: "合成行动卡不符合前端数据合同。",
          retryable: false,
          cause: result.error,
        });
      }

      return deepFreeze(result.data);
    });

    this.#cards = new Map(
      parsedCards.map((card) => [card.notification.id, card]),
    );
  }

  async getById(
    notificationId: string,
  ): Promise<ReadonlyDeep<ActionCardViewModel>> {
    const card = this.#cards.get(notificationId);
    if (card === undefined) {
      throw new AppError({
        code: "ACTION_CARD_NOT_FOUND",
        safeMessage: "没有找到这条合成通知。",
        retryable: false,
      });
    }

    return card;
  }

  async list(): Promise<readonly ReadonlyDeep<ActionCardViewModel>[]> {
    return [...this.#cards.values()];
  }
}

export const mockActionCardRepository = new MockActionCardRepository();
