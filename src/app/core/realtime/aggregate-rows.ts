export function applyAggregateRows<T extends object>(
  current: readonly T[],
  changes: readonly Partial<T>[],
  keys: readonly (keyof T)[],
  numbers: readonly (keyof T)[],
  keepZero = false,
): T[] {
  const rows = new Map(current.map(row => [JSON.stringify(keys.map(key => row[key])), { ...row }]));
  for (const change of changes) {
    const id = JSON.stringify(keys.map(key => change[key]));
    const existing = rows.get(id);
    const row = existing ?? { ...change } as T;
    for (const name of numbers) {
      const addition = change[name];
      if (typeof addition !== 'number') continue;
      const value = existing ? row[name] : 0;
      if (typeof value === 'number') (row as Record<keyof T, unknown>)[name] = value + addition;
    }
    rows.set(id, row);
  }
  return keepZero ? [...rows.values()] : [...rows.values()].filter(row => numbers.some(name => Number(row[name]) !== 0));
}
