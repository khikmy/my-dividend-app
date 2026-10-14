export function yen(n: number): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return sign + '¥' + Math.abs(v).toLocaleString();
}

export default function StatCard({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const cls = signed ? (value < 0 ? 'text-red-600' : 'text-green-600') : 'text-slate-800';
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm text-center">
      <div className="text-xs font-semibold text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-extrabold ${cls}`}>{yen(value)}</div>
    </div>
  );
}
