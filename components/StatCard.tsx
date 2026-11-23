export function yen(n: number): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return sign + '¥' + Math.abs(v).toLocaleString();
}

// 金額は明朝の大きな数字、ラベルは小さく。マイナスは朱、プラスは松葉。
export default function StatCard({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const cls = signed ? (value < 0 ? 'text-red-600' : 'text-green-600') : 'text-slate-900';
  return (
    <div className="bg-slate-50 px-4 py-3.5 rounded-xl border border-slate-200">
      <div className="text-xs font-bold text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-extrabold leading-tight ${cls}`}>{yen(value)}</div>
    </div>
  );
}
