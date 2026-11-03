import { describe, expect, it } from 'vitest';
import { LedgerEntryType } from '@prisma/client';
import { AppError } from '../../src/common/errors/AppError';
import { LedgerService } from '../../src/modules/payments/ledger.service';

describe('LedgerService balancing', () => {
  const service = new LedgerService();

  it('rejects unbalanced entries before posting', async () => {
    await expect(
      service.postBalancedEntries({
        referenceType: 'TEST',
        referenceId: '00000000-0000-0000-0000-000000000099',
        entries: [
          {
            accountId: '00000000-0000-0000-0000-000000000001',
            entryType: LedgerEntryType.DEBIT,
            amount: 200,
            idempotencyKey: `test-unbalanced-${Date.now()}`,
            description: 'unbalanced',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
