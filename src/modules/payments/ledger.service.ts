import { LedgerEntryType } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../common/errors/AppError';
import { toDecimal } from '../../common/utils/money';

/**
 * Double-entry ledger.
 * Entries are immutable; corrections use reversal entries.
 */
export class LedgerService {
  async ensureAccounts(): Promise<void> {
    const accounts = [
      { code: 'CASH', name: 'Cash', type: 'ASSET' as const },
      { code: 'GATEWAY_CLEARING', name: 'Payment Gateway Clearing', type: 'ASSET' as const },
      { code: 'PILOT_PAYABLE', name: 'Pilot Payables', type: 'LIABILITY' as const },
      { code: 'COMMISSION_REVENUE', name: 'Commission Revenue', type: 'REVENUE' as const },
      { code: 'RIDE_REVENUE', name: 'Ride Revenue', type: 'REVENUE' as const },
      { code: 'GATEWAY_FEES', name: 'Gateway Fees', type: 'EXPENSE' as const },
      { code: 'REFUNDS', name: 'Refunds', type: 'EXPENSE' as const },
      { code: 'CUSTOMER_RECEIVABLE', name: 'Customer Receivables', type: 'ASSET' as const },
    ];

    for (const account of accounts) {
      await prisma.ledgerAccount.upsert({
        where: { code: account.code },
        create: account,
        update: { name: account.name },
      });
    }
  }

  async recordOnlinePayment(input: {
    rideId: string;
    paymentId: string;
    amount: number;
    commissionAmount: number;
    pilotPayable: number;
    gatewayFee?: number;
  }): Promise<void> {
    await this.ensureAccounts();
    const accounts = await this.getAccountMap();

    const entries: Array<{
      accountId: string;
      entryType: LedgerEntryType;
      amount: number;
      idempotencyKey: string;
      description: string;
    }> = [
      {
        accountId: accounts.GATEWAY_CLEARING!,
        entryType: LedgerEntryType.DEBIT,
        amount: input.amount,
        idempotencyKey: `pay:${input.paymentId}:gateway_debit`,
        description: 'Customer payment received via gateway',
      },
      {
        accountId: accounts.COMMISSION_REVENUE!,
        entryType: LedgerEntryType.CREDIT,
        amount: input.commissionAmount,
        idempotencyKey: `pay:${input.paymentId}:commission_credit`,
        description: 'FLYT commission',
      },
      {
        accountId: accounts.PILOT_PAYABLE!,
        entryType: LedgerEntryType.CREDIT,
        amount: input.pilotPayable,
        idempotencyKey: `pay:${input.paymentId}:pilot_payable`,
        description: 'Pilot payable',
      },
    ];

    if (input.gatewayFee && input.gatewayFee > 0) {
      entries.push(
        {
          accountId: accounts.GATEWAY_FEES!,
          entryType: LedgerEntryType.DEBIT,
          amount: input.gatewayFee,
          idempotencyKey: `pay:${input.paymentId}:gateway_fee`,
          description: 'Gateway fee',
        },
        {
          accountId: accounts.GATEWAY_CLEARING!,
          entryType: LedgerEntryType.CREDIT,
          amount: input.gatewayFee,
          idempotencyKey: `pay:${input.paymentId}:gateway_fee_clear`,
          description: 'Gateway fee deduction',
        },
      );
    }

    await this.postBalancedEntries({
      referenceType: 'PAYMENT',
      referenceId: input.paymentId,
      entries,
    });
  }

  async recordCashRideSettlement(input: {
    rideId: string;
    fareAmount: number;
    commissionAmount: number;
    pilotPayable: number;
  }): Promise<void> {
    await this.ensureAccounts();
    const accounts = await this.getAccountMap();

    await this.postBalancedEntries({
      referenceType: 'CASH_RIDE',
      referenceId: input.rideId,
      entries: [
        {
          accountId: accounts.CUSTOMER_RECEIVABLE!,
          entryType: LedgerEntryType.DEBIT,
          amount: input.commissionAmount,
          idempotencyKey: `cash:${input.rideId}:commission_due`,
          description: 'Pilot owes FLYT commission on cash ride',
        },
        {
          accountId: accounts.COMMISSION_REVENUE!,
          entryType: LedgerEntryType.CREDIT,
          amount: input.commissionAmount,
          idempotencyKey: `cash:${input.rideId}:commission_revenue`,
          description: 'Commission revenue (cash)',
        },
      ],
    });
  }

  async recordRefund(input: {
    refundId: string;
    paymentId: string;
    amount: number;
  }): Promise<void> {
    await this.ensureAccounts();
    const accounts = await this.getAccountMap();

    await this.postBalancedEntries({
      referenceType: 'REFUND',
      referenceId: input.refundId,
      entries: [
        {
          accountId: accounts.REFUNDS!,
          entryType: LedgerEntryType.DEBIT,
          amount: input.amount,
          idempotencyKey: `refund:${input.refundId}:expense`,
          description: 'Refund expense',
        },
        {
          accountId: accounts.GATEWAY_CLEARING!,
          entryType: LedgerEntryType.CREDIT,
          amount: input.amount,
          idempotencyKey: `refund:${input.refundId}:clearing`,
          description: 'Refund via gateway',
        },
      ],
    });
  }

  async postBalancedEntries(input: {
    referenceType: string;
    referenceId: string;
    entries: Array<{
      accountId: string;
      entryType: LedgerEntryType;
      amount: number;
      idempotencyKey: string;
      description: string;
    }>;
  }): Promise<void> {
    let debit = 0;
    let credit = 0;
    for (const e of input.entries) {
      if (e.amount <= 0) throw AppError.badRequest('Ledger amounts must be positive');
      if (e.entryType === LedgerEntryType.DEBIT) debit += e.amount;
      else credit += e.amount;
    }

    if (Math.abs(debit - credit) > 0.001) {
      throw AppError.badRequest(`Unbalanced ledger entry: debit=${debit} credit=${credit}`);
    }

    await prisma.$transaction(
      input.entries.map((e) =>
        prisma.ledgerEntry.upsert({
          where: { idempotencyKey: e.idempotencyKey },
          create: {
            accountId: e.accountId,
            entryType: e.entryType,
            amount: toDecimal(e.amount),
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            description: e.description,
            idempotencyKey: e.idempotencyKey,
          },
          update: {},
        }),
      ),
    );
  }

  async assertBalanced(referenceType: string, referenceId: string): Promise<boolean> {
    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType, referenceId },
    });
    let debit = 0;
    let credit = 0;
    for (const e of entries) {
      const amount = Number(e.amount);
      if (e.entryType === LedgerEntryType.DEBIT) debit += amount;
      else credit += amount;
    }
    return Math.abs(debit - credit) < 0.001;
  }

  private async getAccountMap(): Promise<Record<string, string>> {
    const accounts = await prisma.ledgerAccount.findMany();
    return Object.fromEntries(accounts.map((a) => [a.code, a.id]));
  }
}

export const ledgerService = new LedgerService();
