import { WalletNotFoundError } from '../../errors/wallet-application.error.js';
import type { UnitOfWork } from '../../ports/persistence/unit-of-work.js';
import type { MoneyProps } from '../../../domain/shared/value-objects/money.js';

export interface ReconcileWalletResult {
  readonly walletId: string;
  readonly storedBalance: MoneyProps;
  readonly calculatedBalance: MoneyProps;
  readonly difference: MoneyProps;
  readonly consistent: boolean;
  readonly checkedEntries: number;
}

export class ReconcileWalletUseCase {
  constructor(private readonly unitOfWork: UnitOfWork) {}

  execute(walletId: string): Promise<ReconcileWalletResult> {
    return this.unitOfWork.execute(async (repositories) => {
      const snapshot =
        await repositories.walletReconciliations.findByWalletId(walletId);
      if (snapshot === undefined) {
        throw new WalletNotFoundError(walletId);
      }

      const difference = snapshot.storedBalance.subtract(
        snapshot.calculatedBalance,
      );

      return Object.freeze({
        walletId,
        storedBalance: Object.freeze(snapshot.storedBalance.toJSON()),
        calculatedBalance: Object.freeze(
          snapshot.calculatedBalance.toJSON(),
        ),
        difference: Object.freeze(difference.toJSON()),
        consistent: difference.isZero(),
        checkedEntries: snapshot.checkedEntries,
      });
    });
  }
}
