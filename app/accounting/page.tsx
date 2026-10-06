'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, X, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  ACCOUNTS,
  RECONCILE_ACCOUNTS,
  JournalRow,
  buildCarryover,
  buildStatements,
  accountType,
  balanceFor,
  sumByAccount,
  sumByAccountSub,
  yearOf,
  yen,
} from '@/lib/accounting';
import { ImportPreview, buildImport, decodeCsvFile, parseCsv } from '@/lib/accountingImport';

type Tab = 'input' | 'import' | 'list' | 'statements' | 'carry';
const TABS: { key: Tab; label: string }[] = [
  { key: 'input', label: '仕訳入力' },
  { key: 'import', label: 'CSV取込' },
  { key: 'list', label: '仕訳一覧' },
  { key: 'statements', label: '貸借対照表・損益計算書' },
  { key: 'carry', label: '残高確認・繰越' },
];

interface Line {
  debit: string;
  debitSub: string;
  debitAmount: string;
  credit: string;
  creditSub: string;
  creditAmount: string;
}
const emptyLine = (): Line => ({ debit: '', debitSub: '', debitAmount: '', credit: '', creditSub: '', creditAmount: '' });
const today = () => new Date().toISOString().slice(0, 10);

const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const th = 'text-left font-normal text-slate-500 px-2 py-1.5 border-b border-slate-200';
const td = 'px-2 py-1.5 border-b border-slate-100';

function AccountSelect({
  value,
  sub,
  onChange,
  onSubChange,
}: {
  value: string;
  sub: string;
  onChange: (v: string) => void;
  onSubChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1">
      <select className={`${input} w-full`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">選択</option>
        {ACCOUNTS.map((a) => (
          <option key={a.name}>{a.name}</option>
        ))}
      </select>
      <input className={`${input} w-28`} placeholder="補助科目" list="sub-accounts" value={sub} onChange={(e) => onSubChange(e.target.value)} />
    </div>
  );
}

const accLabel = (acc: string | null | undefined, sub: string | null | undefined) =>
  acc ? (sub ? `${acc}（${sub}）` : acc) : '';

function Section({ children }: { children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={2} className="pt-3 pb-1 text-xs text-slate-500">{children}</td>
    </tr>
  );
}

function Item({ name, amount, total }: { name: string; amount: number; total?: boolean }) {
  return (
    <tr className={total ? 'bg-slate-100 font-semibold' : ''}>
      <td className={td}>{name}</td>
      <td className={`${td} text-right tabular-nums`}>{yen(amount)}</td>
    </tr>
  );
}

export default function AccountingPage() {
  const [tab, setTab] = useState<Tab>('input');
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());

  const [date, setDate] = useState(today());
  const [desc, setDesc] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const [monthFilter, setMonthFilter] = useState('');
  const [query, setQuery] = useState('');

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const [actual, setActual] = useState<Record<string, string>>({});
  const [carryMsg, setCarryMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .order('entry_date', { ascending: false })
      .order('id', { ascending: false });
    if (error) {
      setLoadError('仕訳の読み込みに失敗しました。supabase/accounting.sql のテーブルを作成済みか確認してください。');
    } else {
      setLoadError('');
      setRows(
        (data ?? []).map((r: any) => ({
          ...r,
          debit_amount: Number(r.debit_amount),
          credit_amount: Number(r.credit_amount),
        }))
      );
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear(), year]);
    rows.forEach((r) => s.add(yearOf(r)));
    return [...s].sort((a, b) => b - a);
  }, [rows, year]);
  const yearRows = useMemo(() => rows.filter((r) => yearOf(r) === year), [rows, year]);

  /* ---- 仕訳入力 ---- */
  const debitTotal = lines.reduce((s, l) => s + (Number(l.debitAmount) || 0), 0);
  const creditTotal = lines.reduce((s, l) => s + (Number(l.creditAmount) || 0), 0);
  const balanced = debitTotal === creditTotal && debitTotal > 0;
  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!balanced) return setMsg({ ok: false, text: '借方と貸方の合計を一致させてください' });
    const bad = lines.some(
      (l) => (Number(l.debitAmount) > 0) !== !!l.debit || (Number(l.creditAmount) > 0) !== !!l.credit
    );
    if (bad) return setMsg({ ok: false, text: '科目と金額はセットで入力してください' });
    setSaving(true);
    const groupId = crypto.randomUUID();
    const payload = lines
      .filter((l) => l.debit || l.credit)
      .map((l) => ({
        group_id: groupId,
        entry_date: date,
        description: desc,
        debit_account: l.debit || null,
        debit_sub: l.debitSub || null,
        debit_amount: Number(l.debitAmount) || 0,
        credit_account: l.credit || null,
        credit_sub: l.creditSub || null,
        credit_amount: Number(l.creditAmount) || 0,
        kind: 'normal',
      }));
    const { error } = await supabase.from('journal_entries').insert(payload);
    setSaving(false);
    if (error) return setMsg({ ok: false, text: '保存に失敗しました: ' + error.message });
    setMsg({ ok: true, text: '仕訳を保存しました' });
    setDesc('');
    setLines([emptyLine()]);
    setYear(Number(date.slice(0, 4)));
    load();
  };

  const remove = async (groupId: string) => {
    if (!confirm('この仕訳を削除しますか？')) return;
    await supabase.from('journal_entries').delete().eq('group_id', groupId);
    load();
  };

  /* ---- CSV取込 ---- */
  const subOptions = useMemo(
    () => [...new Set(rows.flatMap((r) => [r.debit_sub, r.credit_sub]).filter((v): v is string => !!v))],
    [rows]
  );

  const onPickFile = async (file: File | undefined) => {
    setImportMsg(null);
    setPreview(null);
    if (!file) return;
    const p = buildImport(parseCsv(await decodeCsvFile(file)));
    if (p.rows.length === 0) return setImportMsg({ ok: false, text: '取り込める仕訳が見つかりませんでした。仕訳帳CSVか確認してください。' });
    setPreview(p);
  };

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    // 取込済みの取引No(group_id)はスキップする
    const existing = new Set(rows.map((r) => r.group_id));
    const fresh = preview.rows.filter((r) => !existing.has(r.group_id));
    const skipped = new Set(preview.rows.filter((r) => existing.has(r.group_id)).map((r) => r.group_id)).size;
    for (let i = 0; i < fresh.length; i += 500) {
      const { error } = await supabase.from('journal_entries').insert(fresh.slice(i, i + 500));
      if (error) {
        setImporting(false);
        return setImportMsg({ ok: false, text: '取込に失敗しました: ' + error.message });
      }
    }
    setImporting(false);
    setImportMsg({ ok: true, text: `${fresh.length} 行を取り込みました${skipped ? `（取込済みの ${skipped} 仕訳はスキップ）` : ''}` });
    setPreview(null);
    if (fresh.length) setYear(Number(fresh[0].entry_date.slice(0, 4)));
    load();
  };

  /* ---- 仕訳一覧 ---- */
  const listed = yearRows.filter(
    (r) =>
      (!monthFilter || Number(r.entry_date.slice(5, 7)) === Number(monthFilter)) &&
      (!query || [r.description, r.debit_account, r.credit_account].join(' ').includes(query))
  );

  /* ---- 財務諸表・残高 ---- */
  const st = useMemo(() => buildStatements(yearRows), [yearRows]);

  // 帳簿残高は補助科目単位。現金・預金など基本の科目は残高0でも常に表示する
  const subSums = useMemo(() => sumByAccountSub(yearRows), [yearRows]);
  const reconcileKeys = useMemo(() => {
    const keys = new Set<string>(RECONCILE_ACCOUNTS.map((n) => `${n}\t`));
    for (const [k, v] of Object.entries(subSums)) {
      const t = accountType(k.split('\t')[0]);
      if ((t === 'asset' || t === 'liability') && balanceFor(t, v) !== 0) keys.add(k);
    }
    // 補助科目別の行がある科目は、補助なしの0円行を出さない
    for (const k of [...keys]) {
      const [name, sub] = k.split('\t');
      if (!sub && [...keys].some((o) => o !== k && o.startsWith(`${name}\t`))) keys.delete(k);
    }
    return [...keys].sort();
  }, [subSums]);
  const diffs = reconcileKeys.map((key) => {
    const [name, sub] = key.split('\t');
    const book = balanceFor(accountType(name), subSums[key] ?? { debit: 0, credit: 0 });
    const a = actual[key];
    const diff = a === undefined || a === '' ? 0 : Number(a) - book;
    return { key, name: accLabel(name, sub), book, diff };
  });
  const ngCount = diffs.filter((d) => d.diff !== 0).length;

  const carry = async () => {
    if (ngCount > 0 && !confirm(`差異が ${ngCount} 件あります。このまま繰り越しますか？`)) return;
    if (!confirm(`${year + 1}年の繰越仕訳を作成します。既存の繰越仕訳があれば置き換えます。`)) return;
    const rowsNew = buildCarryover(yearRows, year + 1, crypto.randomUUID());
    await supabase
      .from('journal_entries')
      .delete()
      .eq('kind', 'carryover')
      .gte('entry_date', `${year + 1}-01-01`)
      .lte('entry_date', `${year + 1}-12-31`);
    const { error } = rowsNew.length ? await supabase.from('journal_entries').insert(rowsNew) : { error: null };
    if (error) return setCarryMsg({ ok: false, text: '繰越に失敗しました: ' + error.message });
    setCarryMsg({ ok: true, text: `${year + 1}年1月1日付の繰越仕訳を作成しました` });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">会計（経費管理）</h1>
        <select className={input} value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{y}年</option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3.5 py-2 rounded-lg text-sm border transition ${
              tab === t.key
                ? 'bg-blue-50 text-blue-700 border-blue-600 font-semibold'
                : 'bg-white border-slate-300 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <datalist id="sub-accounts">
        {subOptions.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>

      {loadError && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{loadError}</p>}

      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : tab === 'input' ? (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
              <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
              <input
                className={input}
                placeholder="摘要（例: Amazon 事務用品）"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr>
                    <th className={th}>借方科目</th>
                    <th className={`${th} text-right`}>借方金額</th>
                    <th className={th}>貸方科目</th>
                    <th className={`${th} text-right`}>貸方金額</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i}>
                      <td className={td}><AccountSelect value={l.debit} sub={l.debitSub} onChange={(v) => updateLine(i, { debit: v })} onSubChange={(v) => updateLine(i, { debitSub: v })} /></td>
                      <td className={td}>
                        <input type="number" min={0} className={`${input} w-28 text-right`} value={l.debitAmount} onChange={(e) => updateLine(i, { debitAmount: e.target.value })} />
                      </td>
                      <td className={td}><AccountSelect value={l.credit} sub={l.creditSub} onChange={(v) => updateLine(i, { credit: v })} onSubChange={(v) => updateLine(i, { creditSub: v })} /></td>
                      <td className={td}>
                        <input type="number" min={0} className={`${input} w-28 text-right`} value={l.creditAmount} onChange={(e) => updateLine(i, { creditAmount: e.target.value })} />
                      </td>
                      <td className={td}>
                        {lines.length > 1 && (
                          <button aria-label="行を削除" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="p-1 text-slate-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={() => setLines((ls) => [...ls, emptyLine()])} className={`${input} inline-flex items-center gap-1 hover:bg-slate-100`}>
              <Plus className="w-4 h-4" />行を追加
            </button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={`text-xs px-2 py-1 rounded-lg ${balanced ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                借方 {yen(debitTotal)} / 貸方 {yen(creditTotal)}
                {balanced ? '貸借一致' : debitTotal === creditTotal ? '金額を入力' : `差額 ${yen(Math.abs(debitTotal - creditTotal))}`}
              </span>
              <button onClick={save} disabled={saving} className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85 disabled:opacity-50">
                保存
              </button>
            </div>
            {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
          </div>
        ) : tab === 'import' ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              マネーフォワードなどの仕訳帳CSV（Shift_JIS / UTF-8）を取り込みます。取引Noと取引年が同じ仕訳は取込済みとしてスキップするため、同じファイルを再度取り込んでも重複しません。
            </p>
            <label className={`${input} inline-flex items-center gap-2 cursor-pointer hover:bg-slate-100`}>
              <Upload className="w-4 h-4" />CSVファイルを選択
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            </label>
            {preview && (
              <div className="space-y-3">
                <div className="text-sm rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
                  <p>{preview.groupCount} 仕訳 / {preview.rows.length} 行（{preview.years.join('・')}年）</p>
                  {preview.blankAccountRows > 0 && (
                    <p className="text-amber-700">科目が空欄で金額のある {preview.blankAccountRows} 行を「元入金」として取り込みます。</p>
                  )}
                  {preview.unknownAccounts.length > 0 && (
                    <p className="text-amber-700">未登録の科目は費用として扱います: {preview.unknownAccounts.join('、')}</p>
                  )}
                  {preview.unbalancedGroups.length > 0 && (
                    <p className="text-red-700">貸借が一致しない取引No: {preview.unbalancedGroups.join('、')}</p>
                  )}
                </div>
                <div className="overflow-x-auto max-h-72 overflow-y-auto border border-slate-200 rounded-lg">
                  <table className="w-full text-sm min-w-[600px]">
                    <thead>
                      <tr>
                        <th className={th}>日付</th>
                        <th className={th}>摘要</th>
                        <th className={th}>借方</th>
                        <th className={th}>貸方</th>
                        <th className={`${th} text-right`}>借方金額</th>
                        <th className={`${th} text-right`}>貸方金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 100).map((r, i) => (
                        <tr key={i}>
                          <td className={td}>{r.entry_date.replace(/-/g, '/')}</td>
                          <td className={td}>{r.description}</td>
                          <td className={td}>{accLabel(r.debit_account, r.debit_sub)}</td>
                          <td className={td}>{accLabel(r.credit_account, r.credit_sub)}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.debit_amount ? yen(r.debit_amount) : ''}</td>
                          <td className={`${td} text-right tabular-nums`}>{r.credit_amount ? yen(r.credit_amount) : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 100 && <p className="text-xs text-slate-500">先頭100行を表示しています</p>}
                <button
                  onClick={runImport}
                  disabled={importing || preview.unbalancedGroups.length > 0}
                  className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85 disabled:opacity-50"
                >
                  {importing ? '取込中...' : '取り込む'}
                </button>
              </div>
            )}
            {importMsg && <p className={`text-sm ${importMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{importMsg.text}</p>}
          </div>
        ) : tab === 'list' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select className={input} value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
                <option value="">全月</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}月</option>
                ))}
              </select>
              <input className={`${input} w-48`} placeholder="摘要・科目で検索" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr>
                    <th className={th}>日付</th>
                    <th className={th}>摘要</th>
                    <th className={th}>借方</th>
                    <th className={th}>貸方</th>
                    <th className={`${th} text-right`}>金額</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {listed.map((r) => (
                    <tr key={r.id}>
                      <td className={td}>{r.entry_date.replace(/-/g, '/')}</td>
                      <td className={td}>{r.description}</td>
                      <td className={td}>{accLabel(r.debit_account, r.debit_sub)}</td>
                      <td className={td}>{accLabel(r.credit_account, r.credit_sub)}</td>
                      <td className={`${td} text-right tabular-nums`}>{yen(r.debit_amount || r.credit_amount)}</td>
                      <td className={td}>
                        <button aria-label="削除" onClick={() => remove(r.group_id)} className="p-1 text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-slate-500">{listed.length} 件</p>
          </div>
        ) : tab === 'statements' ? (
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="font-semibold mb-1">貸借対照表</h2>
              <table className="w-full text-sm">
                <tbody>
                  <Section>資産の部</Section>
                  {st.assets.map((a) => <Item key={a.name} {...a} />)}
                  <Item name="資産合計" amount={st.totalAssets} total />
                  <Section>負債の部</Section>
                  {st.liabilities.map((a) => <Item key={a.name} {...a} />)}
                  <Item name="負債合計" amount={st.totalLiabilities} total />
                  <Section>純資産の部</Section>
                  {st.equity.map((a) => <Item key={a.name} {...a} />)}
                  <Item name="控除前所得金額" amount={st.netIncome} />
                  <Item name="純資産合計" amount={st.totalEquity} total />
                  <Item name="負債・純資産合計" amount={st.totalLiabilities + st.totalEquity} total />
                </tbody>
              </table>
              {st.totalAssets !== st.totalLiabilities + st.totalEquity && (
                <p className="mt-2 text-xs text-amber-700">
                  貸借が一致していません。年初の繰越仕訳（元入金）が未登録の可能性があります。
                </p>
              )}
            </div>
            <div>
              <h2 className="font-semibold mb-1">損益計算書</h2>
              <table className="w-full text-sm">
                <tbody>
                  <Section>収益</Section>
                  {st.revenues.map((a) => <Item key={a.name} {...a} />)}
                  <Item name="収益合計" amount={st.totalRevenue} total />
                  <Section>費用</Section>
                  {st.expenses.map((a) => <Item key={a.name} {...a} />)}
                  <Item name="費用合計" amount={st.totalExpense} total />
                  <Item name="当期純利益" amount={st.netIncome} total />
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead>
                  <tr>
                    <th className={th}>科目</th>
                    <th className={`${th} text-right`}>帳簿残高</th>
                    <th className={`${th} text-right`}>実残高（通帳など）</th>
                    <th className={`${th} text-right`}>差異</th>
                  </tr>
                </thead>
                <tbody>
                  {diffs.map((d) => (
                    <tr key={d.key}>
                      <td className={td}>{d.name}</td>
                      <td className={`${td} text-right tabular-nums`}>{yen(d.book)}</td>
                      <td className={`${td} text-right`}>
                        <input
                          type="number"
                          className={`${input} w-32 text-right`}
                          placeholder={String(d.book)}
                          value={actual[d.key] ?? ''}
                          onChange={(e) => setActual((a) => ({ ...a, [d.key]: e.target.value }))}
                        />
                      </td>
                      <td className={`${td} text-right`}>
                        <span className={`text-xs px-2 py-0.5 rounded-lg ${d.diff === 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                          {d.diff === 0 ? '一致' : (d.diff > 0 ? '+' : '') + yen(d.diff)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-slate-500">
                繰越仕訳: 資産・負債を引き継ぎ、差額を元入金へ（当期純利益 {yen(st.netIncome)} を含む）
              </span>
              <button onClick={carry} className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85">
                {year + 1}年へ繰り越す
              </button>
            </div>
            {carryMsg && <p className={`text-sm ${carryMsg.ok ? 'text-green-700' : 'text-red-700'}`}>{carryMsg.text}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
