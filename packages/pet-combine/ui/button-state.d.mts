export function combineButtonState(
  grade: 'common' | 'rare',
  balance: number,
  selectedCount: number,
): { readonly disabled: boolean; readonly label: string };
