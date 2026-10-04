import type { Range } from '../../shared/api.ts';
import { RANGES } from '../lib/format.ts';
import { Seg } from './ui.tsx';

export function RangeSelect({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return <Seg<Range> label="Date range" value={value} onChange={onChange} options={RANGES.map((r) => ({ value: r.value, label: r.label, title: r.long }))} />;
}
