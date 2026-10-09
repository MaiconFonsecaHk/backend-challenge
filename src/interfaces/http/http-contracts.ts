import { z } from 'zod';

import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.js';

const nonBlankIdentifierSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: 'Identifier must contain at least one non-whitespace character.',
  });

const uuidSchema = z.uuid();

export const MAX_LEDGER_PAGE_LIMIT = 50;

const moneySchema = z
  .object({
    amount: z.string().regex(/^\d+\.\d{2}$/, {
      message: 'Amount must be a non-negative decimal string with two places.',
    }),
    currency: z.string().regex(/^[A-Z]{3}$/, {
      message: 'Currency must be a three-letter uppercase code.',
    }),
  })
  .strict();

const positiveMoneySchema = moneySchema.refine(
  ({ amount }) => !/^0+\.00$/.test(amount),
  {
    path: ['amount'],
    message: 'Amount must be greater than zero.',
  },
);

export const createWalletBodySchema = z
  .object({
    playerId: uuidSchema,
    initialBalance: moneySchema,
  })
  .strict();

export const walletIdParamsSchema = z
  .object({
    walletId: uuidSchema,
  })
  .strict();

const ledgerLimitSchema = z
  .string()
  .regex(/^[1-9]\d*$/, {
    message: 'Limit must be a positive integer.',
  })
  .transform((value) => Number(value))
  .refine(Number.isSafeInteger, {
    message: 'Limit must be a safe integer.',
  })
  .refine((value) => value <= MAX_LEDGER_PAGE_LIMIT, {
    message: `Limit must not exceed ${MAX_LEDGER_PAGE_LIMIT}.`,
  });

export const walletLedgerQuerySchema = z
  .object({
    cursor: nonBlankIdentifierSchema.optional(),
    limit: ledgerLimitSchema.optional(),
  })
  .strict();

export const transactionIdParamsSchema = z
  .object({
    transactionId: uuidSchema,
  })
  .strict();

export const providerTransactionParamsSchema = z
  .object({
    providerId: nonBlankIdentifierSchema,
    externalTransactionId: nonBlankIdentifierSchema,
  })
  .strict();

const commonWagerShape = {
  providerId: nonBlankIdentifierSchema,
  externalTransactionId: nonBlankIdentifierSchema,
  playerId: uuidSchema,
  walletId: uuidSchema,
  roundId: nonBlankIdentifierSchema,
  gameId: nonBlankIdentifierSchema,
  money: positiveMoneySchema,
} as const;

const wagerWithoutReferenceSchema = z
  .object({
    ...commonWagerShape,
    kind: z.enum([WagerTransactionKind.Bet, WagerTransactionKind.Loss]),
  })
  .strict();

const winSchema = z
  .object({
    ...commonWagerShape,
    kind: z.literal(WagerTransactionKind.Win),
    referenceExternalTransactionId: nonBlankIdentifierSchema.optional(),
  })
  .strict();

const reversalSchema = z
  .object({
    ...commonWagerShape,
    kind: z.enum([
      WagerTransactionKind.Refund,
      WagerTransactionKind.Rollback,
    ]),
    referenceExternalTransactionId: nonBlankIdentifierSchema,
  })
  .strict();

export const processWagerBodySchema = z.discriminatedUnion('kind', [
  wagerWithoutReferenceSchema,
  winSchema,
  reversalSchema,
]);

export const idempotencyKeyHeaderSchema = nonBlankIdentifierSchema;
export const correlationIdHeaderSchema = nonBlankIdentifierSchema;
