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
        const legacy = rows.filter((x) => x.group_id === r.group_id && x.id !== r.id && x.debit_account === OWNER_DRAW);
        const personal = legacy.length
          ? legacy.reduce((t, x) => t + x.debit_amount, 0)
          : r.debit_amount - Math.round((r.debit_amount * ratio) / 100); // 決算整理仕訳に加算済み(元の仕訳は減額しない)
        // 旧方式は元の仕訳が経費分に減額済み。新方式は減額しないので、全額から家事分を引く
        const business = legacy.length ? r.debit_amount : r.debit_amount - personal;
        return { r, ratio, personal, business };
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
    if (!confirm(`${targets.length}件の家事按分を実行します。家事分は、年末(12/31)の「${OWNER_DRAW} / 経費科目」の決算整理仕訳に加算します。`)) return;
    setRunning(true);
    setMsg(null);
    let count = 0;
    // 家事分を(経費科目・補助科目)ごとに集計し、12/31の決算整理仕訳1件に加算する
    const totals = new Map<string, { account: string; sub: string | null; amount: number }>();
    for (const { r, sp } of targets) {
      const key = `${r.debit_account}\t${r.debit_sub ?? ''}`;
      const t = totals.get(key) ?? { account: r.debit_account!, sub: r.debit_sub ?? null, amount: 0 };
      t.amount += sp.personal;
      totals.set(key, t);
    }
    const settleDate = `${year}-12-31`;
    for (const t of totals.values()) {
      const existing = rows.find(
        (x) =>
          x.entry_date === settleDate &&
          x.debit_account === OWNER_DRAW &&
          x.credit_account === t.account &&
          (x.credit_sub ?? null) === t.sub &&
          x.id != null
      );
      // 既存レコードが借方行・貸方行の2行(一覧で統合表示)の場合も、両方の金額を更新する
      const ids = [existing?.id, existing?.mate_id].filter((v): v is number => v != null);
      const { error } = existing
        ? await (async () => {
            const d = await supabase
              .from('journal_entries')
              .update({ debit_amount: Number(existing.debit_amount) + t.amount })
              .in('id', ids)
              .not('debit_account', 'is', null);
            if (d.error) return d;
            return supabase
              .from('journal_entries')
              .update({ credit_amount: Number(existing.credit_amount) + t.amount })
              .in('id', ids)
              .not('credit_account', 'is', null);
          })()
        : await supabase.from('journal_entries').insert({
            group_id: crypto.randomUUID(),
            entry_date: settleDate,
            description: '家事按分',
            debit_account: OWNER_DRAW,
            debit_sub: null,
            debit_amount: t.amount,
            credit_account: t.account,
            credit_sub: t.sub,
            credit_amount: t.amount,
            kind: 'normal',
          });
      if (error) {
        setRunning(false);
        setMsg({ ok: false, text: `決算整理仕訳の更新に失敗しました: ${error.message}` });
        onChanged();
        return;
      }
    }
    // 元の仕訳は減額せず、按分済みにするだけ(経費は決算整理の貸方で減る)
    for (const { r } of targets) {
      const { error } = await supabase.from('journal_entries').update({ split_done: true }).eq('id', r.id);
      if (error) {
        setRunning(false);
        setMsg({ ok: false, text: `${count}件を按分済みにしたところで失敗しました: ${error.message}` });
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
        <div className="overflow-x-auto overflow-y-hidden">
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
        <div className="overflow-x-auto overflow-y-hidden">
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
              {done.map(({ r, ratio, personal, business }) => (
                <tr key={r.id}>
                  <td className={`${td} whitespace-nowrap`}>{r.entry_date.replace(/-/g, '/')}</td>
                  <td className={td}>{r.description}</td>
                  <td className={td}>{label(r.debit_account, r.debit_sub)}</td>
                  <td className={`${td} text-right tabular-nums`}>{ratio}%</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(business)}</td>
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
