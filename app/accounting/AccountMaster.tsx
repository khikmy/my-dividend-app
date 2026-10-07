'use client';

import { useMemo, useState } from 'react';
import { Plus, X, Trash2, Pencil, Check, ChevronRight, ChevronDown } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  ACCOUNTS,
  AccountType,
  DEFAULT_ACCOUNTS,
  JournalRow,
  PROTECTED_ACCOUNTS,
  TYPE_LABEL,
  TYPE_ORDER,
} from '@/lib/accounting';

export interface SubAccount {
  id: number;
  account: string;
  name: string;
  business_ratio?: number | null; // 家事按分: 経費にする割合(%)。残りは事業主貸。未設定は按分なし
}

const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const iconBtn = 'p-1 text-slate-400 disabled:opacity-30 disabled:hover:text-slate-400';

type Msg = { ok: boolean; text: string } | null;

export default function AccountMaster({
  rows,
  subs,
  masterReady,
  masterEmpty,
  onChanged,
}: {
  rows: JournalRow[];
  subs: SubAccount[];
  masterReady: boolean; // accounts テーブルが存在するか
  masterEmpty: boolean; // 存在するが未登録か
  onChanged: () => void;
}) {
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<AccountType>('expense');

  const [editAcc, setEditAcc] = useState<string | null>(null);
  const [editAccName, setEditAccName] = useState('');
  const [editAccType, setEditAccType] = useState<AccountType>('expense');

  const [newSub, setNewSub] = useState('');
  const [editSub, setEditSub] = useState<number | null>(null);
  const [editSubName, setEditSubName] = useState('');
  const [editSubRatio, setEditSubRatio] = useState('');

  // 仕訳での使用状況(科目別の件数、科目+補助科目別の件数)
  const { accUse, subUse } = useMemo(() => {
    const accUse = new Map<string, number>();
    const subUse = new Map<string, number>();
    const count = (acc: string | null, sub: string | null | undefined) => {
      if (!acc) return;
      accUse.set(acc, (accUse.get(acc) ?? 0) + 1);
      if (sub) subUse.set(`${acc}\t${sub}`, (subUse.get(`${acc}\t${sub}`) ?? 0) + 1);
    };
    for (const r of rows) {
      count(r.debit_account, r.debit_sub);
      count(r.credit_account, r.credit_sub);
    }
    return { accUse, subUse };
  }, [rows]);

  // 仕訳で使われているが、マスタに無い科目・補助科目
  const unregisteredAccounts = [...accUse.keys()].filter((n) => !ACCOUNTS.some((a) => a.name === n));
  const unregisteredSubs = [...subUse.keys()]
    .map((k) => k.split('\t'))
    .filter(([acc, sub]) => !subs.some((s) => s.account === acc && s.name === sub));

  const run = async (fn: () => Promise<string | null>, okText: string) => {
    setBusy(true);
    setMsg(null);
    const err = await fn();
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: okText });
    onChanged();
  };

  const nextSort = () => ACCOUNTS.length + 1;

  const seedDefaults = () =>
    run(async () => {
      const { error } = await supabase
        .from('accounts')
        .insert(DEFAULT_ACCOUNTS.map((a, i) => ({ name: a.name, type: a.type, sort_order: i + 1 })));
      return error?.message ?? null;
    }, '初期の勘定科目を登録しました');

  /* ---- 勘定科目 ---- */
  const addAccount = () => {
    const name = newName.trim();
    if (!name) return setMsg({ ok: false, text: '科目名を入力してください' });
    if (ACCOUNTS.some((a) => a.name === name)) return setMsg({ ok: false, text: `「${name}」は既に登録されています` });
    run(async () => {
      const { error } = await supabase.from('accounts').insert({ name, type: newType, sort_order: nextSort() });
      if (!error) setNewName('');
      return error?.message ?? null;
    }, `「${name}」を追加しました`);
  };

  const registerAccount = (name: string) =>
    run(async () => {
      // 取込データ由来の未登録科目は、これまでと同じく費用として登録する
      const { error } = await supabase.from('accounts').insert({ name, type: 'expense', sort_order: nextSort() });
      return error?.message ?? null;
    }, `「${name}」を費用として登録しました。区分が違う場合は編集してください`);

  const saveAccount = (old: string) => {
    const name = editAccName.trim();
    if (!name) return setMsg({ ok: false, text: '科目名を入力してください' });
    if (name !== old && ACCOUNTS.some((a) => a.name === name))
      return setMsg({ ok: false, text: `「${name}」は既に登録されています` });
    run(async () => {
      const { error } = await supabase.from('accounts').update({ name, type: editAccType }).eq('name', old);
      if (error) return error.message;
      if (name !== old) {
        // 仕訳・補助科目マスタ側の科目名も追従させる
        const results = await Promise.all([
          supabase.from('journal_entries').update({ debit_account: name }).eq('debit_account', old),
          supabase.from('journal_entries').update({ credit_account: name }).eq('credit_account', old),
          supabase.from('sub_accounts').update({ account: name }).eq('account', old),
        ]);
        const failed = results.find((r) => r.error);
        if (failed?.error) return '仕訳への反映に失敗しました: ' + failed.error.message;
        if (open === old) setOpen(name);
      }
      setEditAcc(null);
      return null;
    }, name !== old ? `「${old}」を「${name}」に変更し、仕訳にも反映しました` : '更新しました');
  };

  const removeAccount = (name: string) => {
    if (!confirm(`勘定科目「${name}」を削除しますか？（補助科目も削除されます）`)) return;
    run(async () => {
      const a = await supabase.from('sub_accounts').delete().eq('account', name);
      if (a.error) return a.error.message;
      const { error } = await supabase.from('accounts').delete().eq('name', name);
      return error?.message ?? null;
    }, `「${name}」を削除しました`);
  };

  /* ---- 補助科目 ---- */
  const addSub = (account: string) => {
    const name = newSub.trim();
    if (!name) return;
    if (subs.some((s) => s.account === account && s.name === name))
      return setMsg({ ok: false, text: `「${name}」は既に登録されています` });
    run(async () => {
      const { error } = await supabase.from('sub_accounts').insert({ account, name });
      if (!error) setNewSub('');
      return error?.message ?? null;
    }, `補助科目「${name}」を追加しました`);
  };

  const registerSubs = () =>
    run(async () => {
      const { error } = await supabase
        .from('sub_accounts')
        .insert(unregisteredSubs.map(([account, name]) => ({ account, name })));
      return error?.message ?? null;
    }, `${unregisteredSubs.length} 件の補助科目を登録しました`);

  const saveSub = (s: SubAccount) => {
    const name = editSubName.trim();
    if (!name) return setMsg({ ok: false, text: '補助科目名を入力してください' });
    if (name !== s.name && subs.some((o) => o.account === s.account && o.name === name))
      return setMsg({ ok: false, text: `「${name}」は既に登録されています` });
    const ratioText = editSubRatio.trim();
    const ratio = ratioText === '' ? null : Number(ratioText);
    if (ratio != null && (!Number.isFinite(ratio) || ratio < 0 || ratio > 100))
      return setMsg({ ok: false, text: '経費にする割合は 0〜100 で入力してください' });
    run(async () => {
      const patch: { name: string; business_ratio?: number | null } = { name };
      // 按分列が未作成の環境でも名称変更はできるよう、按分を変更するときだけ送る
      if (ratio !== (s.business_ratio ?? null)) patch.business_ratio = ratio;
      const { error } = await supabase.from('sub_accounts').update(patch).eq('id', s.id);
      if (error) return error.message;
      if (name !== s.name) {
        const results = await Promise.all([
          supabase.from('journal_entries').update({ debit_sub: name }).eq('debit_account', s.account).eq('debit_sub', s.name),
          supabase.from('journal_entries').update({ credit_sub: name }).eq('credit_account', s.account).eq('credit_sub', s.name),
        ]);
        const failed = results.find((r) => r.error);
        if (failed?.error) return '仕訳への反映に失敗しました: ' + failed.error.message;
      }
      setEditSub(null);
      return null;
    }, name !== s.name ? `「${s.name}」を「${name}」に変更し、仕訳にも反映しました` : '更新しました');
  };

  const removeSub = (s: SubAccount) => {
    if (!confirm(`補助科目「${s.name}」を削除しますか？`)) return;
    run(async () => {
      const { error } = await supabase.from('sub_accounts').delete().eq('id', s.id);
      return error?.message ?? null;
    }, `補助科目「${s.name}」を削除しました`);
  };

  if (!masterReady)
    return (
      <p className="text-sm text-amber-700">
        科目マスタのテーブルが見つかりません。supabase/accounting.sql の「科目マスタ」部分（accounts / sub_accounts）を SQL Editor で実行してください。
        それまでは初期の勘定科目で動作します。
      </p>
    );

  if (masterEmpty)
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          勘定科目がまだ登録されていません（現在は初期の科目で動作しています）。初期の科目を登録すると、追加・変更・削除ができるようになります。
        </p>
        <button onClick={seedDefaults} disabled={busy} className="rounded-lg bg-slate-900 text-white text-sm px-4 py-2 hover:opacity-85 disabled:opacity-50">
          初期の勘定科目を登録
        </button>
        {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={newType} onChange={(e) => setNewType(e.target.value as AccountType)}>
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>{TYPE_LABEL[t]}</option>
          ))}
        </select>
        <input
          className={`${input} w-48`}
          placeholder="新しい勘定科目"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addAccount()}
        />
        <button onClick={addAccount} disabled={busy} className="rounded-lg bg-slate-900 text-white text-sm px-3 py-1.5 inline-flex items-center gap-1 hover:opacity-85 disabled:opacity-50">
          <Plus className="w-4 h-4" />科目を追加
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}

      {(unregisteredAccounts.length > 0 || unregisteredSubs.length > 0) && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 text-sm p-3 space-y-2">
          {unregisteredAccounts.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-amber-800">仕訳で使われている未登録の科目:</span>
              {unregisteredAccounts.map((n) => (
                <button key={n} onClick={() => registerAccount(n)} disabled={busy} className="px-2 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-50">
                  {n} を登録
                </button>
              ))}
            </div>
          )}
          {unregisteredSubs.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-amber-800">仕訳で使われている未登録の補助科目が {unregisteredSubs.length} 件あります。</span>
              <button onClick={registerSubs} disabled={busy} className="px-2 py-0.5 rounded bg-white border border-amber-300 hover:bg-amber-100 disabled:opacity-50">
                まとめて登録
              </button>
            </div>
          )}
        </div>
      )}

      {TYPE_ORDER.map((t) => {
        const list = ACCOUNTS.filter((a) => a.type === t);
        if (list.length === 0) return null;
        return (
          <div key={t}>
            <h2 className="text-xs text-slate-500 mb-1">{TYPE_LABEL[t]}</h2>
            <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {list.map((a) => {
                const protectedAcc = PROTECTED_ACCOUNTS.includes(a.name);
                const used = accUse.get(a.name) ?? 0;
                const mySubs = subs.filter((s) => s.account === a.name);
                const isOpen = open === a.name;
                const editing = editAcc === a.name;
                return (
                  <li key={a.name}>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm">
                      <button aria-label="補助科目を開閉" onClick={() => { setOpen(isOpen ? null : a.name); setNewSub(''); setEditSub(null); }} className="p-1 text-slate-400 hover:text-slate-700">
                        {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      {editing ? (
                        <>
                          <input className={`${input} w-44`} value={editAccName} onChange={(e) => setEditAccName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveAccount(a.name)} />
                          <select className={input} value={editAccType} onChange={(e) => setEditAccType(e.target.value as AccountType)}>
                            {TYPE_ORDER.map((x) => (
                              <option key={x} value={x}>{TYPE_LABEL[x]}</option>
                            ))}
                          </select>
                          <button aria-label="保存" onClick={() => saveAccount(a.name)} disabled={busy} className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50">
                            <Check className="w-4 h-4" />
                          </button>
                          <button aria-label="キャンセル" onClick={() => setEditAcc(null)} className={`${iconBtn} hover:text-slate-700`}>
                            <X className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="font-medium">{a.name}</span>
                          <span className="text-xs text-slate-500">補助 {mySubs.length} ／ 仕訳 {used} 件</span>
                          {protectedAcc && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">システム科目</span>}
                          <span className="ml-auto whitespace-nowrap">
                            <button
                              aria-label="編集"
                              disabled={protectedAcc}
                              title={protectedAcc ? 'システムで使用する科目のため変更できません' : undefined}
                              onClick={() => { setEditAcc(a.name); setEditAccName(a.name); setEditAccType(a.type); setMsg(null); }}
                              className={`${iconBtn} hover:text-blue-600`}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              aria-label="削除"
                              disabled={protectedAcc || used > 0}
                              title={protectedAcc ? 'システムで使用する科目のため削除できません' : used > 0 ? '仕訳で使用中のため削除できません' : undefined}
                              onClick={() => removeAccount(a.name)}
                              className={`${iconBtn} hover:text-red-600`}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </span>
                        </>
                      )}
                    </div>
                    {isOpen && (
                      <div className="bg-slate-50 px-9 py-2 space-y-1 text-sm">
                        {mySubs.length === 0 && <p className="text-xs text-slate-500">補助科目は未登録です</p>}
                        {mySubs.map((s) => {
                          const su = subUse.get(`${s.account}\t${s.name}`) ?? 0;
                          return (
                            <div key={s.id} className="flex items-center gap-2">
                              {editSub === s.id ? (
                                <>
                                  <input className={`${input} w-44`} value={editSubName} onChange={(e) => setEditSubName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveSub(s)} />
                                  {a.type === 'expense' && (
                                    <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                                      家事按分: 経費
                                      <input type="number" min={0} max={100} placeholder="なし" className={`${input} w-20 text-right`} value={editSubRatio} onChange={(e) => setEditSubRatio(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveSub(s)} />
                                      %
                                    </label>
                                  )}
                                  <button aria-label="保存" onClick={() => saveSub(s)} disabled={busy} className="p-1 text-green-600 hover:text-green-800 disabled:opacity-50">
                                    <Check className="w-4 h-4" />
                                  </button>
                                  <button aria-label="キャンセル" onClick={() => setEditSub(null)} className={`${iconBtn} hover:text-slate-700`}>
                                    <X className="w-4 h-4" />
                                  </button>
                                </>
                              ) : (
                                <>
                                  <span>{s.name}</span>
                                  {s.business_ratio != null && (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                      家事按分 経費{s.business_ratio}% / 事業主貸{100 - s.business_ratio}%
                                    </span>
                                  )}
                                  <span className="text-xs text-slate-500">仕訳 {su} 件</span>
                                  <span className="ml-auto whitespace-nowrap">
                                    <button aria-label="編集" onClick={() => { setEditSub(s.id); setEditSubName(s.name); setEditSubRatio(s.business_ratio == null ? '' : String(s.business_ratio)); setMsg(null); }} className={`${iconBtn} hover:text-blue-600`}>
                                      <Pencil className="w-4 h-4" />
                                    </button>
                                    <button
                                      aria-label="削除"
                                      disabled={su > 0}
                                      title={su > 0 ? '仕訳で使用中のため削除できません' : undefined}
                                      onClick={() => removeSub(s)}
                                      className={`${iconBtn} hover:text-red-600`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex items-center gap-2 pt-1">
                          <input className={`${input} w-44`} placeholder="補助科目を追加" value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addSub(a.name)} />
                          <button onClick={() => addSub(a.name)} disabled={busy} className="rounded-lg border border-slate-300 bg-white text-sm px-2.5 py-1.5 hover:bg-slate-100 disabled:opacity-50">
                            追加
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
