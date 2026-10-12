'use client';

import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { JournalRow, OWNER_DRAW, householdRatio, householdSplit, isSplitDone, yen, yearOf } from '@/lib/accounting';

const th = 'text-left font-normal text-slate-500 px-2 py-1.5 border-b border-slate-200 whitespace-nowrap';
const td = 'px-2 py-1.5 border-b border-slate-100';
const label = (acc: string | null, sub?: string | null) => (acc ? (sub ? `${acc}（${sub}）` : acc) : '');

/** 家事按分: 按分の対象になる仕訳を未按分一覧に出し、まとめて按分する。按分した仕訳は按分済一覧に移る */
export default function SplitPanel({
  rows,
  year,
  ratioOf,
  onChanged,
}: {
  rows: JournalRow[];
  year: number;
  ratioOf: (account: string, sub: string) => number | null | undefined;
  onChanged: () => void;
}) {
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { pending, done } = useMemo(() => {
    const inYear = rows.filter((r) => yearOf(r) === year);
    const byDate = (a: JournalRow, b: JournalRow) => a.entry_date.localeCompare(b.entry_date) || (a.id ?? 0) - (b.id ?? 0);
    const pending = inYear
      .map((r) => ({ r, sp: householdSplit(r, rows, ratioOf) }))
      .filter((x): x is { r: JournalRow; sp: NonNullable<typeof x.sp> } => !!x.sp)
      .sort((a, b) => byDate(a.r, b.r));
    const done = inYear
      .filter((r) => householdRatio(r, ratioOf) != null && isSplitDone(r, rows))
      .sort(byDate)
      .map((r) => {
        const ratio = householdRatio(r, ratioOf)!;
        // この画面で按分したものは、同じ取引内の事業主貸の行が家事分
        const personal = rows
          .filter((x) => x.group_id === r.group_id && x.id !== r.id && x.debit_account === OWNER_DRAW)
          .reduce((t, x) => t + x.debit_amount, 0);
        return { r, ratio, personal };
      });
    return { pending, done };
  }, [rows, year, ratioOf]);

  const targets = pending.filter((x) => x.r.id != null && !unchecked.has(x.r.id));

  const toggle = (id: number) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allChecked = pending.length > 0 && targets.length === pending.length;

  const runSplit = async () => {
    if (targets.length === 0) return;
    if (!confirm(`${targets.length}件の家事按分を実行します。経費分に減額し、残りを${OWNER_DRAW}に振り替えます。`)) return;
    setRunning(true);
    setMsg(null);
    let count = 0;
    for (const { r, sp } of targets) {
      // 元の行を経費分に減額して按分済みにし、残りを事業主貸として同じ取引に追加する
      const { error } = await supabase
        .from('journal_entries')
        .update({ debit_amount: sp.business, credit_amount: sp.business, split_done: true })
        .eq('id', r.id);
      const { error: addError } = error
        ? { error }
        : await supabase.from('journal_entries').insert({
            group_id: r.group_id,
            entry_date: r.entry_date,
            description: r.description,
            debit_account: OWNER_DRAW,
            debit_sub: null,
            debit_amount: sp.personal,
            credit_account: r.credit_account,
            credit_sub: r.credit_sub ?? null,
            credit_amount: sp.personal,
            kind: 'normal',
          });
      if (addError) {
        setRunning(false);
        setMsg({ ok: false, text: `${count}件を按分したところで失敗しました: ${addError.message}` });
        onChanged();
        return;
      }
      count++;
    }
    setRunning(false);
    setMsg({ ok: true, text: `${count}件の家事按分を実行しました` });
    onChanged();
  };

  return (
    <div className="space-y-8">
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">未按分（{pending.length}件）</h2>
          <button
            onClick={runSplit}
            disabled={running || targets.length === 0}
            className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85 disabled:opacity-50"
          >
            {running ? '按分中...' : `選択した${targets.length}件を一括で按分する`}
          </button>
        </div>
        <p className="text-sm text-slate-500">
          科目マスタで補助科目に按分率を設定した経費が対象です。按分すると、経費分に減額し、残りを{OWNER_DRAW}に振り替えます。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr>
                <th className={th}>
                  <input
                    type="checkbox"
                    aria-label="すべて選択"
                    checked={allChecked}
                    onChange={() => setUnchecked(allChecked ? new Set(pending.map((x) => x.r.id!)) : new Set())}
                  />
                </th>
                <th className={th}>日付</th>
                <th className={th}>摘要</th>
                <th className={th}>科目</th>
                <th className={`${th} text-right`}>按分率</th>
                <th className={`${th} text-right`}>金額</th>
                <th className={`${th} text-right`}>経費分</th>
                <th className={`${th} text-right`}>{OWNER_DRAW}分</th>
              </tr>
            </thead>
            <tbody>
              {pending.map(({ r, sp }) => (
                <tr key={r.id}>
                  <td className={td}>
                    <input type="checkbox" aria-label="選択" checked={!unchecked.has(r.id!)} onChange={() => toggle(r.id!)} />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{r.entry_date.replace(/-/g, '/')}</td>
                  <td className={td}>{r.description}</td>
                  <td className={td}>{label(r.debit_account, r.debit_sub)}</td>
                  <td className={`${td} text-right tabular-nums`}>{sp.ratio}%</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(r.debit_amount)}</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(sp.business)}</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(sp.personal)}</td>
                </tr>
              ))}
              {pending.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-4 text-center text-slate-400">未按分の仕訳はありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">按分済（{done.length}件）</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>摘要</th>
                <th className={th}>科目</th>
                <th className={`${th} text-right`}>按分率</th>
                <th className={`${th} text-right`}>経費分</th>
                <th className={`${th} text-right`}>{OWNER_DRAW}分</th>
              </tr>
            </thead>
            <tbody>
              {done.map(({ r, ratio, personal }) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{r.entry_date.replace(/-/g, '/')}</td>
                  <td className={td}>{r.description}</td>
                  <td className={td}>{label(r.debit_account, r.debit_sub)}</td>
                  <td className={`${td} text-right tabular-nums`}>{ratio}%</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(r.debit_amount)}</td>
                  <td className={`${td} text-right tabular-nums`}>{personal > 0 ? yen(personal) : '—'}</td>
                </tr>
              ))}
              {done.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2 py-4 text-center text-slate-400">按分済の仕訳はありません</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400">{OWNER_DRAW}分が「—」のものは、年末の按分仕訳などですでに処理済みの仕訳です。</p>
      </section>
    </div>
  );
}
