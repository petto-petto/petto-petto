import type { TokenClient } from '@pet/client';

/** 관리자 명령의 단일 양의 정수 인자를 검증한다. */
export function parseGrantAmount(args: readonly string[]): number {
  if (args.length !== 1 || !/^[0-9]+$/.test(args[0] ?? '')) {
    throw new Error('사용법: npm run token:grant -- <양의 정수>');
  }
  const amount = Number(args[0]);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('지급 금액은 양의 안전 정수여야 합니다.');
  }
  return amount;
}

/** 기존 재화 원장에 새 지급 한 건을 기록하고 변경 전후 잔액을 반환한다. */
export function grantAdminTokens(
  tokens: Pick<TokenClient, 'balance' | 'grantOnce'>,
  amount: number,
  key: string,
): { previousBalance: number; currentBalance: number } {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('지급 금액은 양의 안전 정수여야 합니다.');
  }
  const previousBalance = tokens.balance();
  if (
    !Number.isSafeInteger(previousBalance) ||
    previousBalance > Number.MAX_SAFE_INTEGER - amount
  ) {
    throw new Error('지급 후 잔액이 안전 정수 범위를 넘습니다.');
  }
  if (!tokens.grantOnce(key, amount, '관리자 지급')) {
    throw new Error('이미 사용된 관리자 지급 키입니다.');
  }
  return { previousBalance, currentBalance: tokens.balance() };
}
