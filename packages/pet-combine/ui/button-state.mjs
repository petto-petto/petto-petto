const costs = { common: 30_000, rare: 100_000 };
const requiredMaterials = 10;

export function combineButtonState(grade, balance, selectedCount) {
  if (balance < costs[grade]) return { disabled: true, label: '토큰 부족' };
  if (selectedCount !== requiredMaterials) {
    return { disabled: true, label: `${selectedCount}/${requiredMaterials}` };
  }
  return { disabled: false, label: '합성하기' };
}
