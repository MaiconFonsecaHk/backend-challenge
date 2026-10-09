import { z } from 'zod';

import { WagerTransactionKind } from '../../domain/wagering/wager-transaction.js';
import { InvalidSqsWagerMessageError } from './sqs-wager-message.error.js';

const nonBlank = z.string().refine((value) => value.trim().length > 0);
const uuid = z.uuid();
const money = z
  .object({
    amount: z
      .string()
      .regex(/^\d+\.\d{2}$/)
      .refine((amount) => !/^0+\.00$/.test(amount)),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const commonData = {
  providerId: nonBlank,
  externalTransactionId: nonBlank,
  idempotencyKey: nonBlank,
  playerId: uuid,
  walletId: uuid,
  roundId: nonBlank,
  gameId: nonBlank,
  money,
} as const;

const wagerData = z.discriminatedUnion('kind', [
  z
    .object({
      ...commonData,
      kind: z.enum([WagerTransactionKind.Bet, WagerTransactionKind.Loss]),
    })
    .strict(),
  z
    .object({
      ...commonData,
      kind: z.literal(WagerTransactionKind.Win),
      referenceExternalTransactionId: nonBlank.optional(),
    })
    .strict(),
  z
    .object({
      ...commonData,
      kind: z.enum([
        WagerTransactionKind.Refund,
        WagerTransactionKind.Rollback,
      ]),
      referenceExternalTransactionId: nonBlank,
    })
    .strict(),
]);

const wagerMessageSchema = z
  .object({
    messageId: nonBlank,
    type: z.literal('WagerTransactionRequested'),
    occurredAt: z.iso.datetime({ offset: true }),
    data: wagerData,
  })
  .strict();

export type SqsWagerMessage = z.infer<typeof wagerMessageSchema>;

export function parseSqsWagerMessage(body: string | undefined): SqsWagerMessage {
  if (body === undefined) {
    throw new InvalidSqsWagerMessageError();
  }

  try {
    const parsed: unknown = JSON.parse(body);
    const result = wagerMessageSchema.safeParse(parsed);
    if (!result.success) {
      throw new InvalidSqsWagerMessageError();
    }

    return result.data;
  } catch (error) {
    if (error instanceof InvalidSqsWagerMessageError) {
      throw error;
    }

    throw new InvalidSqsWagerMessageError();
  }
}
