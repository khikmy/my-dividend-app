'use client';

import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { JournalRow, accountType, yen } from '@/lib/accounting';

// 年ごとの色: 今年=緑、前年=青、前々年=オレンジ。棒は濃い色が控除前所得、薄い色が経費(同じ色の濃淡)
const YEAR_STYLE = [
  { color: '#008300', tint: '#9ad09a', dashed: undefined as string | undefined },
  { color: '#2a78d6', tint: '#a9c9f0', dashed: '6 4' },
  { color: '#eb6834', tint: '#f7c3ad', dashed: '2 4' },
];
const OVER = '#b91c1c'; // 経費が売上高を超えた分(赤字)
const INK = '#0f172a';
const INK_2 = '#64748b';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

interface Monthly {
  revenue: number[];
  expense: number[];
}

/** 年ごとの月別の売上高・経費(損益科目のみ) */
function monthlyOf(rows: JournalRow[], year: number): Monthly {
  const revenue = Array(12).fill(0);
  const expense = Array(12).fill(0);
  for (const r of rows) {
    if (Number(r.entry_date.slice(0, 4)) !== year) continue;
    const m = Number(r.entry_date.slice(5, 7)) - 1;
    if (r.debit_account) {
      const t = accountType(r.debit_account);
      if (t === 'expense') expense[m] += Number(r.debit_amount);
      else if (t === 'revenue') revenue[m] -= Number(r.debit_amount);
    }
    if (r.credit_account) {
      const t = accountType(r.credit_account);
      if (t === 'revenue') revenue[m] += Number(r.credit_amount);
      else if (t === 'expense') expense[m] -= Number(r.credit_amount);
    }
  }
  return { revenue, expense };
}

const cumulative = (a: number[]) => a.reduce<number[]>((acc, v) => [...acc, (acc[acc.length - 1] ?? 0) + v], []);
const man = (n: number) => `${Math.round(n / 10000).toLocaleString('ja-JP')}万`;

interface Cell {
  rev: number;
  exp: number;
  inc: number;
}

// 系列キー: 所得(下の棒)・経費・経費超過・線 を年のインデックス k ごとに持つ
const K = {
  inc: (k: number) => `inc${k}`,
  exp: (k: number) => `exp${k}`,
  over: (k: number) => `over${k}`,
};

interface ChartRow {
  month: string;
  cells: (Cell | null)[];
  [key: string]: string | number | null | (Cell | null)[];
}

function Swatch({ color, dashed }: { color: string; dashed?: boolean }) {
  return dashed ? (
    <span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: color }} />
  ) : (
    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
  );
}

function TrendTooltip({ active, payload, label, years }: { active?: boolean; payload?: { payload?: ChartRow }[]; label?: string; years: number[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm space-y-2">
      <p className="font-semibold" style={{ color: INK }}>{label}（累計）</p>
      {years.map((y, k) => {
        const c = row.cells[k];
        return (
          <div key={y} className="space-y-0.5" style={{ color: INK_2 }}>
            <p className="flex items-center gap-1.5 font-medium" style={{ color: INK }}>
              <Swatch color={YEAR_STYLE[k].color} dashed={k > 0} />
              {y}年
            </p>
            {([['売上高', c?.rev], ['経費', c?.exp], ['控除前所得', c?.inc]] as const).map(([name, v]) => (
              <p key={name} className="flex justify-between gap-4 pl-4">
                <span>{name}</span>
                <span className="tabular-nums" style={{ color: INK }}>{v == null ? '—' : yen(v)}</span>
              </p>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 控除前所得金額の推移(累計)。棒は3年分の累計売上高を「控除前所得(濃)」と「経費(薄)」に分けて積み上げたもの
 * (経費が売上を上回る間は超過分を赤で積む)。今年=緑、前年=青、前々年=オレンジ。
 */
export default function IncomeTrend({ rows, year }: { rows: JournalRow[]; year: number }) {
  const { data, years } = useMemo(() => {
    const years = [year, year - 1, year - 2];
    const cum = years.map((y) => {
      const m = monthlyOf(rows, y);
      return { revenue: cumulative(m.revenue), expense: cumulative(m.expense) };
    });
    const now = new Date();
    const data: ChartRow[] = MONTHS.map((m, i) => {
      const cells = years.map((y, k) => {
        // 今年は当月までを表示し、先の月は空にする
        if (y === now.getFullYear() && m > now.getMonth() + 1) return null;
        const rev = cum[k].revenue[i];
        const exp = cum[k].expense[i];
        return { rev, exp, inc: rev - exp };
      });
      const row: ChartRow = { month: `${m}月`, cells };
      cells.forEach((c, k) => {
        const base = c ? Math.max(c.rev, 0) : 0;
        row[K.inc(k)] = c ? Math.max(base - c.exp, 0) : null;
        row[K.exp(k)] = c ? Math.max(Math.min(c.exp, base), 0) : null;
        row[K.over(k)] = c ? Math.max(c.exp - base, 0) : null;
      });
      return row;
    });
    return { data, years };
  }, [rows, year]);

  return (
    <section className="space-y-3">
      <h2 className="font-semibold border-l-4 border-blue-400 pl-2">控除前所得金額の推移（累計）</h2>
      <p className="text-sm text-slate-500">
        棒は累計の売上高を、控除前所得（濃い色）と経費（薄い色）に分けて積み上げたもので、高さが売上高です。
      </p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs" style={{ color: INK_2 }}>
        {years.map((y, k) => (
          <span key={y} className="inline-flex items-center gap-1.5">
            <Swatch color={YEAR_STYLE[k].color} />
            <Swatch color={YEAR_STYLE[k].tint} />
            <span style={{ color: INK }}>{y}年</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <Swatch color={OVER} />経費超過（赤字）
        </span>
        <span>濃い棒=控除前所得 / 薄い棒=経費</span>
      </div>
      <div className="border border-slate-200 rounded-lg p-3">
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fill: INK_2, fontSize: 12 }} tickLine={false} axisLine={{ stroke: '#cbd5e1' }} />
              <YAxis tick={{ fill: INK_2, fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={man} width={64} />
              <Tooltip content={<TrendTooltip years={years} />} cursor={{ fill: 'rgba(148,163,184,0.12)' }} />
              {/* 左から 前々年・前年・今年 の順に並べる */}
              {[2, 1, 0].flatMap((k) => [
                <Bar key={K.inc(k)} dataKey={K.inc(k)} stackId={`s${k}`} fill={YEAR_STYLE[k].color} stroke="#fff" strokeWidth={1.5} barSize={10} isAnimationActive={false} />,
                <Bar key={K.exp(k)} dataKey={K.exp(k)} stackId={`s${k}`} fill={YEAR_STYLE[k].tint} stroke="#fff" strokeWidth={1.5} radius={[3, 3, 0, 0]} isAnimationActive={false} />,
                <Bar key={K.over(k)} dataKey={K.over(k)} stackId={`s${k}`} fill={OVER} stroke="#fff" strokeWidth={1.5} radius={[3, 3, 0, 0]} isAnimationActive={false} />,
              ])}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">表で見る</summary>
        <div className="overflow-x-auto overflow-y-hidden mt-2 border border-slate-200 rounded-lg">
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr>
                <th className="border-b border-slate-200" />
                {years.map((y, k) => (
                  <th key={y} colSpan={3} className="text-center font-semibold px-3 py-1.5 border-b border-l border-slate-200" style={{ color: INK }}>
                    <span className="inline-flex items-center gap-1.5">
                      <Swatch color={YEAR_STYLE[k].color} dashed={k > 0} />
                      {y}年
                    </span>
                  </th>
                ))}
              </tr>
              <tr>
                <th className="text-left font-normal text-slate-500 px-3 py-1.5 border-b border-slate-200" />
                {years.flatMap((y) =>
                  ['売上高', '経費', '控除前所得'].map((h, j) => (
                    <th key={`${y}-${h}`} className={`text-right font-normal text-slate-500 px-3 py-1.5 border-b border-slate-200 ${j === 0 ? 'border-l' : ''}`}>{h}</th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.month}>
                  <td className="px-3 py-1.5 border-b border-slate-100">{d.month}</td>
                  {d.cells.flatMap((c, k) =>
                    [c?.rev, c?.exp, c?.inc].map((n, j) => (
                      <td key={`${k}-${j}`} className={`px-3 py-1.5 border-b border-slate-100 text-right tabular-nums ${j === 0 ? 'border-l border-slate-200' : ''}`}>
                        {n == null ? '—' : yen(n)}
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-1">すべて累計(1月からその月までの合計)です。</p>
      </details>
    </section>
  );
}
