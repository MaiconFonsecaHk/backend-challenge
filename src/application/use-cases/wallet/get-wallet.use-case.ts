import { WalletNotFoundError } from '../../errors/wallet-application.error.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { MoneyProps } from '../../../domain/shared/value-objects/money.js';

export interface GetWalletResult {
  readonly id: string;
  readonly playerId: string;
  readonly balance: MoneyProps;
  readonly version: number;
}

export class GetWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(walletId: string): Promise<GetWalletResult> {
    return this.unitOfWork.execute(async (repositories) => {
      const wallet = await repositories.wallets.findById(walletId);
      if (wallet === undefined) {
        throw new WalletNotFoundError(walletId);
      }

      return Object.freeze({
        id: wallet.id,
        playerId: wallet.playerId,
        balance: Object.freeze(wallet.balance.toJSON()),
        version: wallet.version,
      });
    });
  }
}
