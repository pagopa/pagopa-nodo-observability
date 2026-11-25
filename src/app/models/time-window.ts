export const PRESET_WINDOWS = [
  { value: '5m', label: 'Ultimi 5 minuti', milliseconds: 300_000 },
  { value: '15m', label: 'Ultimi 15 minuti', milliseconds: 900_000 },
  { value: '30m', label: 'Ultimi 30 minuti', milliseconds: 1_800_000 },
  { value: '1h', label: 'Ultima ora', milliseconds: 3_600_000 },
  { value: '24h', label: 'Ultime 24 ore', milliseconds: 86_400_000 },
  { value: '7d', label: 'Ultimi 7 giorni', milliseconds: 604_800_000 },
  { value: '60d', label: 'Ultimi 60 giorni', milliseconds: 5_184_000_000 },
] as const;

export type PresetWindow = (typeof PRESET_WINDOWS)[number]['value'];
export interface TimeWindowSelection {
  range: PresetWindow | 'custom';
  from: string;
  to: string;
}
export interface TimeWindowBounds {
  from: string;
  to: string;
}
type WindowResult = { bounds: TimeWindowBounds; error: null } | { bounds: null; error: string };

export function readTimeWindow(params: { get(name: string): string | null }): TimeWindowSelection {
  const value = params.get('window');
  return {
    range:
      value === 'custom'
        ? value
        : (PRESET_WINDOWS.find((preset) => preset.value === value)?.value ?? '1h'),
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

export function rangeStart(range: PresetWindow, end: Date): Date {
  const preset = PRESET_WINDOWS.find((preset) => preset.value === range);
  if (!preset) throw new RangeError('Intervallo non supportato.');
  return new Date(end.getTime() - preset.milliseconds);
}

export function resolveTimeWindow(selection: TimeWindowSelection, end = new Date()): WindowResult {
  if (selection.range !== 'custom') {
    return {
      bounds: { from: rangeStart(selection.range, end).toISOString(), to: end.toISOString() },
      error: null,
    };
  }
  const { from, to } = selection;
  const isUtcInstant = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  };
  if (!isUtcInstant(from) || !isUtcInstant(to)) {
    return { bounds: null, error: 'Inserisci entrambe le date e ore valide in UTC.' };
  }
  const duration = Date.parse(to) - Date.parse(from);
  if (duration <= 0) return { bounds: null, error: 'La data Da deve precedere la data A.' };
  if (duration > 5_184_000_000)
    return { bounds: null, error: 'L’intervallo non può superare 60 giorni.' };
  return { bounds: { from, to }, error: null };
}
