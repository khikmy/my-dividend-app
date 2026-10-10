'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Trash2, Upload, Pencil, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  ACCOUNTS,
  setAccounts,
  AccountType,
  JournalRow,
  mergeSplitRows,
  householdSplit,
  OWNER_DRAW,
  buildCarryover,
  buildStatements,
  accountType,
  CAPITAL,
  needsReview,
  balanceFor,
  sumByAccount,
  sumByAccountSub,
  yearOf,
  yen,
} from '@/lib/accounting';
import AccountMaster, { SubAccount } from './AccountMaster';
import { CARD_FORMATS, CardKind, ImportPreview, buildCardImport, buildImport, decodeCsvFile, parseCsv } from '@/lib/accountingImport';

type Tab = 'import' | 'list' | 'statements' | 'carry' | 'master';
const TABS: { key: Tab; label: string }[] = [
  { key: 'import', label: 'CSV取込' },
  { key: 'list', label: '仕訳一覧' },
  { key: 'statements', label: '貸借対照表・損益計算書' },
  { key: 'carry', label: '残高確認・繰越' },
  { key: 'master', label: '科目マスタ' },
];

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
  // 入力しながら部分一致で候補を絞り込む。マスタにない値は赤枠にし、保存時にも弾く
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const text = value.trim();
  const candidates = ACCOUNTS.filter((a) => a.name.includes(text));
  const invalid = text !== '' && !ACCOUNTS.some((a) => a.name === text);
  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
  };
  const rect = open ? ref.current?.getBoundingClientRect() : undefined; // 表の横スクロール枠に切られないよう fixed で表示
  return (
    <div className="flex gap-1">
      <div className="w-full">
        <input
          ref={ref}
          className={`${input} w-full ${invalid ? 'border-red-500 focus:ring-red-500' : ''}`}
          placeholder="科目を入力・選択"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, candidates.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && open && candidates[active]) {
              e.preventDefault();
              pick(candidates[active].name);
            } else if (e.key === 'Escape') setOpen(false);
          }}
        />
        {open && rect && candidates.length > 0 && (
          <ul
            className="fixed z-50 max-h-60 overflow-y-auto rounded-lg border border-slate-300 bg-white shadow-lg text-sm"
            style={{ top: rect.bottom + 2, left: rect.left, minWidth: rect.width }}
          >
            {candidates.map((a, i) => (
              <li
                key={a.name}
                // blur より先に確定させるため mousedown で選択する
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(a.name);
                }}
                className={`px-2.5 py-1.5 cursor-pointer ${i === active ? 'bg-blue-50' : 'hover:bg-slate-100'}`}
              >
                {a.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <input className={`${input} w-28`} placeholder="補助科目" list={`sub-${value}`} value={sub} onChange={(e) => onSubChange(e.target.value)} />
    </div>
  );
}

// 繰越仕訳: 繰越機能で作成したもの、または1/1付けで元入金を含む取引(開始仕訳)。1/1付けの通常の取引は対象外
const isCarryover = (r: JournalRow, openingGroups: Set<string>) =>
  r.kind === 'carryover' || (r.entry_date.slice(5) === '01-01' && openingGroups.has(r.group_id));

// 決算整理: 12/31付けで事業主貸・事業主借を使う仕訳(按分・事業主勘定の振替など)。通常の取引は対象外
const isSettlement = (r: JournalRow) =>
  r.entry_date.slice(5) === '12-31' &&
  [r.debit_account, r.credit_account].some((a) => a === '事業主貸' || a === '事業主借');

const accLabel = (acc: string | null | undefined, sub: string | null | undefined) =>
  acc ? (sub ? `${acc}（${sub}）` : acc) : '';

interface BalanceGroup {
  name: string;
  total: number;
  leaves: { key: string; sub: string; book: number }[];
}

const cell = 'px-3 py-2 border-b border-slate-200 last:border-b-0';

function BalanceTable({ groups }: { groups: BalanceGroup[] }) {
  if (groups.length === 0) return <p className="text-sm text-slate-400 border border-slate-200 rounded-lg px-3 py-2">残高のある科目はありません</p>;
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden text-sm">
      {groups.map((g) => (
        <div key={g.name} className="border-b border-slate-200 last:border-b-0">
          <div className="flex items-center justify-between gap-2 bg-slate-50 font-semibold">
            <span className={cell}>{g.name}</span>
            <span className={`${cell} tabular-nums`}>{g.total.toLocaleString('ja-JP')}</span>
          </div>
          {g.leaves.filter((l) => l.sub).map((l) => (
            <div key={l.key} className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
              <span className="pl-4 font-medium">{l.sub}</span>
              <span className="tabular-nums">{l.book.toLocaleString('ja-JP')}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function BalanceTotal({ amount }: { amount: number }) {
  return (
    <div className="flex items-center justify-between border border-slate-200 rounded-lg bg-slate-50 font-semibold text-sm">
      <span className={cell}>合計</span>
      <span className={`${cell} tabular-nums`}>{amount.toLocaleString('ja-JP')}</span>
    </div>
  );
}

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
  const [tab, setTab] = useState<Tab>('list');
  const [rows, setRows] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [subs, setSubs] = useState<SubAccount[]>([]);
  const [masterReady, setMasterReady] = useState(true);
  const [masterEmpty, setMasterEmpty] = useState(false);
  const [masterVersion, setMasterVersion] = useState(0); // 科目マスタ更新時に集計を再計算する
  const [splitTarget, setSplitTarget] = useState<{ row: JournalRow; ratio: number; business: number; personal: number } | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());

  const [saving, setSaving] = useState(false);
  const NEW_ID = -1; // 新規入力行
  const [editId, setEditId] = useState<number | null>(null);
  const [editMsg, setEditMsg] = useState('');
  const [draft, setDraft] = useState({ date: '', desc: '', debit: '', debitSub: '', credit: '', creditSub: '', amount: '' });
  const [monthFilter, setMonthFilter] = useState('');
  const [query, setQuery] = useState('');

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  // 取込対象: 'journal'=仕訳帳CSV、それ以外=カード明細CSV
  const [importKind, setImportKind] = useState<'journal' | CardKind>('journal');

  const [carryMsg, setCarryMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Supabase は1回の取得が最大1000行のため、ページ分けして全件読み込む
    const PAGE = 1000;
    const data: any[] = [];
    let error: unknown = null;
    for (let from = 0; ; from += PAGE) {
      const res = await supabase
        .from('journal_entries')
        .select('*')
        .order('entry_date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1);
      if (res.error) {
        error = res.error;
        break;
      }
      data.push(...(res.data ?? []));
      if ((res.data ?? []).length < PAGE) break;
    }
    if (error) {
      setLoadError('仕訳の読み込みに失敗しました。supabase/accounting.sql のテーブルを作成済みか確認してください。');
    } else {
      setLoadError('');
      setRows(
        mergeSplitRows(
          (data ?? []).map((r: any) => ({
            ...r,
            debit_amount: Number(r.debit_amount),
            credit_amount: Number(r.credit_amount),
          }))
        )
      );
    }
    setLoading(false);
  }, []);
  const loadMaster = useCallback(async () => {
    const [acc, sub] = await Promise.all([
      supabase.from('accounts').select('name, type').order('sort_order').order('id'),
      supabase.from('sub_accounts').select('*').order('id'),
    ]);
    setMasterReady(!acc.error);
    const list = (acc.data ?? []) as { name: string; type: AccountType }[];
    setMasterEmpty(!acc.error && list.length === 0);
    // テーブル未作成・未登録の間は初期の科目で動作させる
    if (list.length > 0) setAccounts(list);
    setSubs(sub.error ? [] : ((sub.data ?? []) as SubAccount[]));
    setMasterVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    load();
    loadMaster();
  }, [load, loadMaster]);

  const years = useMemo(() => {
    const s = new Set<number>([new Date().getFullYear(), year]);
    rows.forEach((r) => s.add(yearOf(r)));
    return [...s].sort((a, b) => b - a);
  }, [rows, year]);
  const yearRows = useMemo(() => rows.filter((r) => yearOf(r) === year), [rows, year]);

  /* ---- 仕訳一覧のインライン編集 ---- */
  const startEdit = (r: JournalRow) => {
    setEditMsg('');
    setEditId(r.id ?? null);
    setDraft({
      date: r.entry_date,
      desc: r.description ?? '',
      debit: r.debit_account ?? '',
      debitSub: r.debit_sub ?? '',
      credit: r.credit_account ?? '',
      creditSub: r.credit_sub ?? '',
      amount: String(r.debit_amount || r.credit_amount),
    });
  };

  const startAdd = () => {
    setEditMsg('');
    setEditId(NEW_ID);
    setDraft({ date: today().slice(0, 4) === String(year) ? today() : `${year}-12-31`, desc: '', debit: '', debitSub: '', credit: '', creditSub: '', amount: '' });
  };

  const cancelEdit = () => {
    setEditId(null);
    setEditMsg('');
  };

  const saveEdit = async (r: JournalRow | null) => {
    const amount = Number(draft.amount) || 0;
    if (!draft.date || amount <= 0) return setEditMsg('日付と金額を入力してください');
    draft.debit = draft.debit.trim();
    draft.credit = draft.credit.trim();
    const unknown = [draft.debit, draft.credit].find((a) => a && !ACCOUNTS.some((x) => x.name === a));
    if (unknown) return setEditMsg(`「${unknown}」は科目マスタに登録されていません。登録済みの科目を入力・選択してください`);
    if (!draft.debit && !draft.credit) return setEditMsg('借方か貸方の科目を選択してください');
    const next = {
      entry_date: draft.date,
      description: draft.desc,
      debit_account: draft.debit || null,
      debit_sub: draft.debit ? draft.debitSub || null : null,
      debit_amount: draft.debit ? amount : 0,
      credit_account: draft.credit || null,
      credit_sub: draft.credit ? draft.creditSub || null : null,
      credit_amount: draft.credit ? amount : 0,
    };
    if (!r) {
      if (!draft.debit || !draft.credit) return setEditMsg('借方と貸方の科目を選択してください');
      setSaving(true);
      const { error: addError } = await supabase
        .from('journal_entries')
        .insert({ ...next, group_id: crypto.randomUUID(), kind: 'normal' });
      setSaving(false);
      if (addError) return setEditMsg('保存に失敗しました: ' + addError.message);
      setEditMsg('');
      setYear(Number(draft.date.slice(0, 4)));
      // 続けて入力できるよう、新規行は日付を残して空にする
      setDraft({ ...draft, desc: '', debit: '', debitSub: '', credit: '', creditSub: '', amount: '' });
      load();
      return;
    }
    // 取引内の貸借が一致することを確認する
    const diff = rows
      .filter((x) => x.group_id === r.group_id)
      .reduce((sum, x) => {
        const y = x.id === r.id ? next : x;
        return sum + y.debit_amount - y.credit_amount;
      }, 0);
    // 要確認の行は、科目が決まるまで貸借が揃わないため、科目未設定のままの保存は許可する
    if (diff !== 0 && !(r.needs_review && !(draft.debit && draft.credit))) return setEditMsg(`この取引の貸借が一致しません（差額 ${yen(Math.abs(diff))}）`);
    setSaving(true);
    // 借方・貸方の科目がそろったら「要確認」を解除する
    const patch = r.needs_review && draft.debit && draft.credit ? { ...next, needs_review: false } : next;
    const { error } = await supabase.from('journal_entries').update(patch).eq('id', r.id);
    if (!error && r.mate_id != null) await supabase.from('journal_entries').delete().eq('id', r.mate_id);
    if (!error && next.entry_date !== r.entry_date)
      await supabase.from('journal_entries').update({ entry_date: next.entry_date }).eq('group_id', r.group_id);
    setSaving(false);
    if (error) return setEditMsg('更新に失敗しました: ' + error.message);
    setEditId(null);
    setEditMsg('');
    load();
  };

  const remove = async (groupId: string) => {
    if (!confirm('この仕訳を削除しますか？')) return;
    await supabase.from('journal_entries').delete().eq('group_id', groupId);
    load();
  };

  /* ---- 家事按分 ---- */
  const ratioOf = (account: string, sub: string) => subs.find((s) => s.account === account && s.name === sub)?.business_ratio;
  const splitOf = (r: JournalRow) => householdSplit(r, rows, ratioOf);

  const runSplit = async () => {
    if (!splitTarget) return;
    const { row: r, business, personal } = splitTarget;
    setSaving(true);
    // 元の行を経費分に減額し、残りを事業主貸として同じ取引に追加する
    const { error } = await supabase.from('journal_entries').update({ debit_amount: business, credit_amount: business }).eq('id', r.id);
    const { error: addError } = error
      ? { error }
      : await supabase.from('journal_entries').insert({
          group_id: r.group_id,
          entry_date: r.entry_date,
          description: r.description,
          debit_account: OWNER_DRAW,
          debit_sub: null,
          debit_amount: personal,
          credit_account: r.credit_account,
          credit_sub: r.credit_sub ?? null,
          credit_amount: personal,
          kind: 'normal',
        });
    setSaving(false);
    setSplitTarget(null);
    if (addError) setEditMsg('家事按分に失敗しました: ' + addError.message);
    else setEditMsg('');
    load();
  };

  /* ---- CSV取込 ---- */
  // 補助科目の入力候補: マスタ登録分 + 仕訳で使用済みのもの(科目ごと)
  const subOptions = useMemo(() => {
    const m = new Map<string, Set<string>>();
    const add = (acc: string | null, sub?: string | null) => {
      if (acc && sub) m.set(acc, (m.get(acc) ?? new Set()).add(sub));
    };
    subs.forEach((x) => add(x.account, x.name));
    rows.forEach((r) => {
      add(r.debit_account, r.debit_sub);
      add(r.credit_account, r.credit_sub);
    });
    return [...m].map(([acc, set]) => ({ acc, list: [...set] }));
  }, [rows, subs]);

  const onPickFile = async (file: File | undefined) => {
    setImportMsg(null);
    setPreview(null);
    if (!file) return;
    const csv = parseCsv(await decodeCsvFile(file));
    const p = importKind === 'journal' ? buildImport(csv) : buildCardImport(csv, importKind);
    if (p.rows.length === 0)
      return setImportMsg({
        ok: false,
        text: `取り込める仕訳が見つかりませんでした。${importKind === 'journal' ? '仕訳帳CSV' : CARD_FORMATS[importKind].label + 'の明細CSV'}か確認してください。`,
      });
    setPreview(p);
  };

  const runImport = async () => {
    if (!preview) return;
    setImporting(true);
    // 取込済みの取引No(group_id)はスキップする
    const existing = new Set(rows.map((r) => r.group_id));
    // mate_id は画面表示用の項目で、DBには列がないため除外する
    const fresh = preview.rows.filter((r) => !existing.has(r.group_id)).map(({ mate_id, id, ...r }) => r);
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
  const openingGroups = useMemo(
    () => new Set(yearRows.filter((r) => r.debit_account === CAPITAL || r.credit_account === CAPITAL).map((r) => r.group_id)),
    [yearRows]
  );
  const listed = yearRows.filter(
    (r) =>
      (!monthFilter || Number(r.entry_date.slice(5, 7)) === Number(monthFilter)) &&
      (!query || [r.description, r.debit_account, r.credit_account].join(' ').includes(query))
  );

  /* ---- 財務諸表・残高 ---- */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const st = useMemo(() => buildStatements(yearRows), [yearRows, masterVersion]);

  // 繰り越される残高。資産・負債を勘定科目ごとにまとめ、補助科目別の行をぶら下げる(マネーフォワードの表示に合わせる)
  const subSums = useMemo(() => sumByAccountSub(yearRows), [yearRows]);
  const sections = useMemo(() => {
    const build = (type: 'asset' | 'liability') => {
      const byAccount = new Map<string, { sub: string; book: number }[]>();
      for (const [k, v] of Object.entries(subSums)) {
        const [name, sub] = k.split('\t');
        const book = balanceFor(type, v);
        if (accountType(name) !== type || book === 0) continue;
        byAccount.set(name, [...(byAccount.get(name) ?? []), { sub, book }]);
      }
      const order = (n: string) => ACCOUNTS.findIndex((a) => a.name === n);
      return [...byAccount.entries()]
        .sort((x, y) => (order(x[0]) < 0 ? 999 : order(x[0])) - (order(y[0]) < 0 ? 999 : order(y[0])))
        .map(([name, subs]) => ({
          name,
          total: subs.reduce((t, x) => t + x.book, 0),
          // 補助科目なしの残高と補助科目別の残高が混在するときは、補助なしも1行として出す
          leaves: subs.sort((x, y) => x.sub.localeCompare(y.sub, 'ja')).map((x) => ({ ...x, key: `${name}\t${x.sub}` })),
        }));
    };
    const assets = build('asset');
    const liabilities = build('liability');
    const sum = (l: { total: number }[]) => l.reduce((t, x) => t + x.total, 0);
    return { assets, liabilities, totalAssets: sum(assets), totalLiabilities: sum(liabilities) };
  }, [subSums]);
  const carry = async () => {
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

  const editRow = (r: JournalRow | null) => (
                      <tr key={r ? r.id : 'new'} className="bg-blue-50/60">
                        <td className={td}>
                          <input type="date" className={input} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                        </td>
                        <td className={td}>
                          <AccountSelect value={draft.debit} sub={draft.debitSub} onChange={(v) => setDraft({ ...draft, debit: v })} onSubChange={(v) => setDraft({ ...draft, debitSub: v })} />
                        </td>
                        <td className={td}>
                          <AccountSelect value={draft.credit} sub={draft.creditSub} onChange={(v) => setDraft({ ...draft, credit: v })} onSubChange={(v) => setDraft({ ...draft, creditSub: v })} />
                        </td>
                        <td className={td}>
                          <input type="number" min={0} className={`${input} w-28 text-right`} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                        </td>
                        <td className={td}>
                          <input className={`${input} w-full min-w-[160px]`} value={draft.desc} onChange={(e) => setDraft({ ...draft, desc: e.target.value })} />
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          <button aria-label="保存" onClick={() => saveEdit(r)} disabled={saving} className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50">
                            <Check className="w-4 h-4" />
                          </button>
                          <button aria-label="キャンセル" onClick={cancelEdit} className="p-1 text-slate-400 hover:text-slate-700">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
  );

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

      {subOptions.map(({ acc, list }) => (
        <datalist key={acc} id={`sub-${acc}`}>
          {list.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      ))}

      {splitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSplitTarget(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-semibold">家事按分を行いますか？</h2>
            <p className="text-sm text-slate-600">
              {splitTarget.row.entry_date.replace(/-/g, '/')} {splitTarget.row.description}
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr>
                  <td className={td}>{accLabel(splitTarget.row.debit_account, splitTarget.row.debit_sub)}（経費 {splitTarget.ratio}%）</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(splitTarget.business)}</td>
                </tr>
                <tr>
                  <td className={td}>{OWNER_DRAW}（{100 - splitTarget.ratio}%）</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(splitTarget.personal)}</td>
                </tr>
                <tr className="bg-slate-100 font-semibold">
                  <td className={td}>合計（{splitTarget.row.credit_account}）</td>
                  <td className={`${td} text-right tabular-nums`}>{yen(splitTarget.business + splitTarget.personal)}</td>
                </tr>
              </tbody>
            </table>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setSplitTarget(null)} className="rounded-lg border border-slate-300 text-sm px-4 py-2 hover:bg-slate-100">
                キャンセル
              </button>
              <button onClick={runSplit} disabled={saving} className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85 disabled:opacity-50">
                按分する
              </button>
            </div>
          </div>
        </div>
      )}

      {loadError && <p className="rounded-lg bg-red-50 text-red-700 text-sm p-3">{loadError}</p>}

      <section className="bg-white border border-slate-200 rounded-2xl p-5">
        {loading ? (
          <p className="text-sm text-slate-500">読み込み中...</p>
        ) : tab === 'import' ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-600">取込対象</span>
              <select
                className={input}
                value={importKind}
                onChange={(e) => {
                  setImportKind(e.target.value as 'journal' | CardKind);
                  setPreview(null);
                  setImportMsg(null);
                }}
              >
                <option value="journal">仕訳帳CSV（マネーフォワードなど）</option>
                {(Object.keys(CARD_FORMATS) as CardKind[]).map((k) => (
                  <option key={k} value={k}>{CARD_FORMATS[k].label}の明細CSV</option>
                ))}
              </select>
            </div>
            <p className="text-sm text-slate-600">
              {importKind === 'journal'
                ? 'マネーフォワードなどの仕訳帳CSV（Shift_JIS / UTF-8）を取り込みます。取引Noと取引年が同じ仕訳は取込済みとしてスキップするため、同じファイルを再度取り込んでも重複しません。'
                : `${CARD_FORMATS[importKind].label}の明細CSV（Shift_JIS / UTF-8）を取り込みます。日付・金額・利用店名（摘要）を取り込み、借方の勘定科目は未設定、貸方は${CARD_FORMATS[importKind].creditAccount}（${CARD_FORMATS[importKind].creditSub}）にします。取り込んだ仕訳には「要確認」が付き、仕訳一覧で借方の科目を設定すると外れます。同じ日付・金額の明細は取込済みとしてスキップします。`}
            </p>
            <label className={`${input} inline-flex items-center gap-2 cursor-pointer hover:bg-slate-100`}>
              <Upload className="w-4 h-4" />CSVファイルを選択
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onPickFile(e.target.files?.[0])} />
            </label>
            {preview && (
              <div className="space-y-3">
                <div className="text-sm rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
                  <p>{preview.groupCount} 仕訳 / {preview.rows.length} 行（{preview.years.join('・')}年）</p>
                  {importKind !== 'journal' && (
                    <p>合計 {yen(preview.rows.reduce((t, r) => t + r.credit_amount - r.debit_amount, 0))}</p>
                  )}
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
                          <td className={td}>{r.needs_review && !r.debit_account ? '未設定' : accLabel(r.debit_account, r.debit_sub)}</td>
                          <td className={td}>{r.needs_review && !r.credit_account ? '未設定' : accLabel(r.credit_account, r.credit_sub)}</td>
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
              <button
                onClick={startAdd}
                disabled={editId === NEW_ID}
                className="ml-auto rounded-lg bg-slate-900 text-white text-sm px-3 py-1.5 inline-flex items-center gap-1 hover:opacity-85 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />仕訳を追加
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr>
                    <th className={th}>日付</th>
                    <th className={th}>借方</th>
                    <th className={th}>貸方</th>
                    <th className={`${th} text-right`}>金額</th>
                    <th className={th}>摘要</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {editId === NEW_ID && editRow(null)}
                  {listed.map((r) =>
                    r.id != null && r.id === editId ? (
                      editRow(r)
                    ) : (
                    <tr key={r.id}>
                      <td className={`${td} whitespace-nowrap`}>
                        {r.entry_date.replace(/-/g, '/')}
                        {needsReview(r) && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-800">要確認</span>
                        )}
                        {isSettlement(r) && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">決算整理</span>
                        )}
                        {(() => {
                          const sp = splitOf(r);
                          return (
                            sp && (
                              <button
                                onClick={() => setSplitTarget({ row: r, ...sp })}
                                className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 hover:bg-orange-200"
                              >
                                家事按分
                              </button>
                            )
                          );
                        })()}
                        {isCarryover(r, openingGroups) && (
                          <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-sky-100 text-sky-800">繰越</span>
                        )}
                      </td>
                      <td className={td}>{accLabel(r.debit_account, r.debit_sub)}</td>
                      <td className={td}>{accLabel(r.credit_account, r.credit_sub)}</td>
                      <td className={`${td} text-right tabular-nums`}>{yen(r.debit_amount || r.credit_amount)}</td>
                      <td className={td}>{r.description}</td>
                      <td className={`${td} whitespace-nowrap`}>
                        <button aria-label="編集" onClick={() => startEdit(r)} className="p-1 text-slate-400 hover:text-blue-600">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button aria-label="削除" onClick={() => remove(r.group_id)} className="p-1 text-slate-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {editMsg && <p className="text-sm text-red-700">{editMsg}</p>}
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
        ) : tab === 'master' ? (
          <AccountMaster rows={rows} subs={subs} masterReady={masterReady} masterEmpty={masterEmpty} onChanged={() => { loadMaster(); load(); }} />
        ) : (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold border-l-4 border-blue-400 pl-2">参考. 繰り越される残高</h2>
              <p className="text-sm text-slate-500 mt-2">以下の残高が次年度の開始残高として繰り越されます。</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-sm text-slate-500">資産の部</p>
                <BalanceTable groups={sections.assets} />
                <BalanceTotal amount={sections.totalAssets} />
              </div>
              <div className="space-y-2">
                <p className="text-sm text-slate-500">負債の部</p>
                <BalanceTable groups={sections.liabilities} />
                <p className="text-sm text-slate-500 pt-2">資本の部</p>
                <BalanceTable groups={[{ name: CAPITAL, total: sections.totalAssets - sections.totalLiabilities, leaves: [] }]} />
                <BalanceTotal amount={sections.totalLiabilities + (sections.totalAssets - sections.totalLiabilities)} />
              </div>
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
