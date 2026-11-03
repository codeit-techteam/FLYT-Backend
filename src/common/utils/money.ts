import { Decimal } from '@prisma/client/runtime/library';

export function toDecimal(value: number | string | Decimal): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

export function roundMoney(value: Decimal | number): Decimal {
  return toDecimal(value).toDecimalPlaces(2);
}

export function percentOf(amount: Decimal | number, percent: Decimal | number): Decimal {
  return roundMoney(toDecimal(amount).mul(toDecimal(percent)).div(100));
}

export function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
}
