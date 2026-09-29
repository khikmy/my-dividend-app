'use client';

import { useEffect, useMemo, useState } from 'react';
import { Wallet, CheckCircle2 } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import {
  BudgetRow,
  ExpenseRow,
  IncomeRow,
  TaxRow,
  CATEGORIES,
  REGIONS,
  isTaxCategory,
  buildDashboardData,
  buildExpenseTabData,
  buildTaxTabData,
  shiftMonthKey,
  parseMonthKey,
} from '@/lib/budget';

const YEAR_RANGE_START = 2020;
const YEAR_RANGE_END_OFFSET = 1;

function yen(n: number): string {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return sign + '¥' + Math.abs(v).toLocaleString();
}

type Tab = 'dashboard' | 'expense' | 'tax';

const REGION_DISPLAY_NAMES: Record<string, string> = {
  引き落とし金額: '引き落とし金額',
  '投資・貯金額': '投資・貯金額',
  共有口座: '共有口座',
};

export default function BudgetPage() {
  const now = new Date();
  const years = useMemo(() => {
    const endYear = now.getFullYear() + YEAR_RANGE_END_OFFSET;
    const arr: number[] = [];
    for (let y = YEAR_RANGE_START; y <= endYear; y++) arr.push(y);
    return arr;
  }, []);
  const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  const [year, setYear] = useState<number>(now.getFullYear());
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [budgetRows, setBudgetRows] = useState<BudgetRow[]>([]);
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRow[]>([]);
  const [taxRows, setTaxRows] = useState<TaxRow[]>([]);

  const [expenseEditMode, setExpenseEditMode] = useState(false);
  const [editIncome, setEditIncome] = useState('');
  const [editItems, setEditItems] = useState<Record<string, { budget: string; expense: string }>>({});
  const [savingExpense, setSavingExpense] = useState(false);
  const [creatingNextMonth, setCreatingNextMonth] = useState(false);

  const [taxEditMode, setTaxEditMode] = useState(false);
  const [editPension, setEditPension] = useState('');
  const [editShaken, setEditShaken] = useState('');
  const [editJuuminzei, setEditJuuminzei] = useState('');
  const [savingTax, setSavingTax] = useState(false);
  const [shakenBreakdownOpen, setShakenBreakdownOpen] = useState(false);

  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), Math.max(1800, Math.min(6000, msg.length * 90)));
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const [budgetRes, expenseRes, incomeRes, taxRes] = await Promise.all([
        supabase.from('budget_items').select('*'),
        supabase.from('expense_items').select('*'),
        supabase.from('income_records').select('*'),
        supabase.from('tax_annual').select('*'),
      ]);
      if (budgetRes.error) throw budgetRes.error;
      if (expenseRes.error) throw expenseRes.error;
      if (incomeRes.error) throw incomeRes.error;
      if (taxRes.error) throw taxRes.error;
      setBudgetRows(budgetRes.data || []);
      setExpenseRows(expenseRes.data || []);
      setIncomeRows(incomeRes.data || []);
      setTaxRows(taxRes.data || []);
    } catch (err) {
      console.error('Failed to load budget data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setExpenseEditMode(false);
    setTaxEditMode(false);
  }, [monthKey]);

  const dashboardData = useMemo(
    () => buildDashboardData(monthKey, budgetRows, expenseRows, incomeRows, taxRows),
    [monthKey, budgetRows, expenseRows, incomeRows, taxRows]
  );
  const expenseData = useMemo(
    () => buildExpenseTabData(monthKey, budgetRows, expenseRows, incomeRows, taxRows),
    [monthKey, budgetRows, expenseRows, incomeRows, taxRows]
  );
  const taxData = useMemo(() => buildTaxTabData(year, taxRows), [year, taxRows]);

  // 累計プール金の推移(対象年の1〜12月、計12ヶ月分)
  const poolTrend = useMemo(() => {
    const points = [];
    const targetYear = parseMonthKey(monthKey).year;
    for (let m = 1; m <= 12; m++) {
      const k = `${targetYear}-${String(m).padStart(2, '0')}`;
      const y = targetYear;
      const d = buildDashboardData(k, budgetRows, expenseRows, incomeRows, taxRows);
      points.push({
        monthKey: k,
        label: `${String(y).slice(2)}/${m}`,
        poolTotal: d.poolTotal,
        isSelected: targetYear === now.getFullYear() && k === monthKey,
      });
    }
    return points;
  }, [monthKey, budgetRows, expenseRows, incomeRows, taxRows]);

  const startExpenseEdit = () => {
    setEditIncome(String(expenseData.income));
    const initial: Record<string, { budget: string; expense: string }> = {};
    expenseData.items.forEach((item) => {
      initial[`${item.region}|${item.label}`] = {
        budget: String(item.budget),
        expense: item.isDefault ? '' : String(item.amount),
      };
    });
    setEditItems(initial);
    setExpenseEditMode(true);
  };

  const saveExpenseBudgetTab = async () => {
    setSavingExpense(true);
    try {
      await supabase
        .from('income_records')
        .upsert({ month_key: monthKey, amount: Number(editIncome) || 0 }, { onConflict: 'month_key' });

      for (const cat of CATEGORIES) {
        const key = `${cat.region}|${cat.label}`;
        const edit = editItems[key];
        if (!edit) continue;

        if (!isTaxCategory(cat)) {
          await supabase.from('budget_items').upsert(
            {
              month_key: monthKey,
              region: cat.region,
              label: cat.label,
              amount: Number(edit.budget) || 0,
            },
            { onConflict: 'month_key,region,label' }
          );
        }

        if (edit.expense !== '') {
          await supabase.from('expense_items').upsert(
            {
              month_key: monthKey,
              region: cat.region,
              label: cat.label,
              amount: Number(edit.expense) || 0,
            },
            { onConflict: 'month_key,region,label' }
          );
        }
      }

      await loadAll();
      setExpenseEditMode(false);
      showToast('保存しました');
    } catch (err) {
      console.error('Failed to save expense/budget tab:', err);
      showToast('保存に失敗しました');
    } finally {
      setSavingExpense(false);
    }
  };

  const createNextMonthData = async () => {
    setCreatingNextMonth(true);
    try {
      const nextKey = shiftMonthKey(monthKey, 1);
      const nextLabel = `${nextKey.split('-')[0]}年${Number(nextKey.split('-')[1])}月`;
      const currentLabel = expenseData.monthLabel;

      const existingNextBudget = budgetRows.filter((r) => r.month_key === nextKey);
      const existingNextExpense = expenseRows.filter((r) => r.month_key === nextKey);
      const existingNextIncome = incomeRows.filter((r) => r.month_key === nextKey);

      if (existingNextBudget.length > 0 || existingNextExpense.length > 0 || existingNextIncome.length > 0) {
        showToast(`${nextLabel} の予算・支出・収入のいずれかがすでに存在するため、作成しませんでした。`);
        return;
      }

      const currentBudgetRows = budgetRows.filter((r) => r.month_key === monthKey);
      const currentIncomeRow = incomeRows.find((r) => r.month_key === monthKey);

      if (currentBudgetRows.length === 0 && !currentIncomeRow) {
        showToast(`${currentLabel} の予算・収入データが無いため、コピー元がありません。`);
        return;
      }

      for (const r of currentBudgetRows) {
        await supabase.from('budget_items').upsert(
          { month_key: nextKey, region: r.region, label: r.label, amount: r.amount },
          { onConflict: 'month_key,region,label' }
        );
        await supabase.from('expense_items').upsert(
          { month_key: nextKey, region: r.region, label: r.label, amount: r.amount },
          { onConflict: 'month_key,region,label' }
        );
      }

      if (currentIncomeRow) {
        await supabase
          .from('income_records')
          .upsert({ month_key: nextKey, amount: currentIncomeRow.amount }, { onConflict: 'month_key' });
      }

      await loadAll();
      showToast(`${nextLabel} の予算・支出・収入データを ${currentLabel} からコピーして作成しました。`);
    } catch (err) {
      console.error('Failed to create next month data:', err);
      showToast('作成に失敗しました');
    } finally {
      setCreatingNextMonth(false);
    }
  };

  const startTaxEdit = () => {
    setEditPension(String(taxData.pensionAnnual));
    setEditShaken(String(taxData.shakaihokenAnnual));
    setEditJuuminzei(String(taxData.juuminzeiAnnual));
    setTaxEditMode(true);
  };

  const saveTaxTab = async () => {
    setSavingTax(true);
    try {
      await supabase.from('tax_annual').upsert(
        {
          year,
          pension_annual: Number(editPension) || 0,
          shakaihoken_annual: Number(editShaken) || 0,
          juuminzei_annual: Number(editJuuminzei) || 0,
        },
        { onConflict: 'year' }
      );
      await loadAll();
      setTaxEditMode(false);
      showToast('保存しました');
    } catch (err) {
      console.error('Failed to save tax tab:', err);
      showToast('保存に失敗しました');
    } finally {
      setSavingTax(false);
    }
  };

  const balClass = (v: number) => (v < 0 ? 'text-red-600' : 'text-green-600');

  const calendarRows = taxData.schedule.slice(0, 12);
  const pensionCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.pension), 0);
  const kenpoCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.shakaihoken), 0);
  const juuCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.juuminzei), 0);
  const shakaihokenGroupTotal = pensionCalendarTotal + kenpoCalendarTotal;
  const grandTotal = shakaihokenGroupTotal + juuCalendarTotal;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white">
            <Wallet className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">資産管理(家計簿)</h1>
        </div>
      </div>

      {/* 月選択 */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-center gap-3 flex-wrap">
        <label className="text-sm font-bold text-slate-700">対象月</label>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}年
            </option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
      </div>

      {/* タブ */}
      <div className="bg-white p-1.5 rounded-2xl border border-slate-200/80 shadow-sm flex gap-1">
        {(
          [
            { key: 'dashboard', label: 'ダッシュボード' },
            { key: 'expense', label: '支出' },
            { key: 'tax', label: '税金' },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition ${
              activeTab === t.key ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
        <>
          {activeTab === 'dashboard' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="収入合計" value={dashboardData.income} />
                <StatCard label="当月プール金" value={dashboardData.poolThisMonth} />
                <StatCard label="累計プール金" value={dashboardData.poolTotal} />
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-1">累計プール金の推移</h2>
                <p className="text-xs text-slate-400 mb-3">
                  {parseMonthKey(monthKey).year}年の1〜12月を表示しています(対象月: {dashboardData.monthLabel})
                </p>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={poolTrend} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e2e8f0' }}
                      />
                      <YAxis
                        tickFormatter={(val) => `¥${(val / 10000).toLocaleString()}万`}
                        tick={{ fontSize: 12 }}
                        tickLine={false}
                        axisLine={{ stroke: '#e2e8f0' }}
                        width={64}
                      />
                      <Tooltip
                        formatter={(val: number) => [yen(val), '累計プール金']}
                        contentStyle={{
                          borderRadius: '12px',
                          border: '1px solid #e2e8f0',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                      {poolTrend.some((p) => p.isSelected) && (
                        <ReferenceLine
                          x={poolTrend.find((p) => p.isSelected)?.label}
                          stroke="#dc2626"
                          strokeDasharray="4 4"
                          label={{ value: '対象月', position: 'top', fill: '#dc2626', fontSize: 11, fontWeight: 700 }}
                        />
                      )}
                      <Line
                        type="monotone"
                        dataKey="poolTotal"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={<PoolTrendDot />}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
                <h2 className="text-base font-bold text-slate-800 mb-3">口座別内訳</h2>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-slate-400 text-xs">
                      <th className="text-left font-semibold pb-2">口座名</th>
                      <th className="text-right font-semibold pb-2">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboardData.accounts.map((a) => (
                      <tr key={a.name} className="border-t border-slate-100">
                        <td className="py-2.5 font-semibold text-slate-700">{a.name}</td>
                        <td className="py-2.5 text-right font-bold text-slate-800">{yen(a.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-slate-400 mt-3">
                  住信SBIネット銀行=iDeCoの支出額、SBI証券=個別株の支出額、あおぞら銀行=貯金の支出額、
                  楽天銀行=共有口座(入金-出金、0未満は0)、三菱UFJ銀行=収入からその他4口座を差し引いた額です。
                  入力はできません。収入・各支出額は「支出」タブで編集してください。
                </p>
              </div>
            </div>
          )}

          {activeTab === 'expense' && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex flex-col gap-3">
                <h2 className="text-base font-bold text-slate-800">{expenseData.monthLabel}の収入・予算・支出</h2>
                <div className="flex justify-end gap-2 flex-wrap">
                  {!expenseEditMode && (
                    <button
                      onClick={createNextMonthData}
                      disabled={creatingNextMonth}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
                    >
                      次月分を作成
                    </button>
                  )}
                  {expenseEditMode && (
                    <button
                      onClick={() => setExpenseEditMode(false)}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-slate-400 hover:bg-slate-500"
                    >
                      戻る
                    </button>
                  )}
                  <button
                    onClick={() => (expenseEditMode ? saveExpenseBudgetTab() : startExpenseEdit())}
                    disabled={savingExpense}
                    className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${
                      expenseEditMode ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {expenseEditMode ? '保存' : '編集'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatCard label="支出総額" value={dashboardData.totalExpense} />
                <StatCard label="予算総額" value={dashboardData.totalBudget} />
                <StatCard label="収支" value={dashboardData.balance} signed />
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-100 pb-3">
                <label className="text-sm font-bold text-slate-700">収入</label>
                {expenseEditMode ? (
                  <input
                    type="number"
                    value={editIncome}
                    onChange={(e) => setEditIncome(e.target.value)}
                    className="w-40 px-3 py-1.5 border border-slate-200 rounded-lg text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                ) : (
                  <span className="text-sm font-bold text-slate-800">{yen(expenseData.income)}</span>
                )}
              </div>

              {REGIONS.map((region) => {
                const regionItems = expenseData.items.filter((i) => i.region === region);
                const visibleItems = expenseEditMode ? regionItems : regionItems.filter((i) => !i.isDefault);

                const totalSourceItems = regionItems.filter((i) => !i.isDefault);
                let totalExpense: number, totalBudget: number;
                if (region === '共有口座') {
                  const w = totalSourceItems.find((i) => i.label === '支出額');
                  const dep = totalSourceItems.find((i) => i.label === '入金額');
                  const wBudget = regionItems.find((i) => i.label === '支出額');
                  const depBudget = regionItems.find((i) => i.label === '入金額');
                  totalExpense = Number(w ? w.amount : 0) - Number(dep ? dep.amount : 0);
                  totalBudget = Number(wBudget ? wBudget.budget : 0) - Number(depBudget ? depBudget.budget : 0);
                } else {
                  totalExpense = totalSourceItems.reduce((s, i) => s + Number(i.amount), 0);
                  totalBudget = regionItems.reduce((s, i) => s + Number(i.budget), 0);
                }
                const totalLabel = region === '共有口座' ? '合計(支出-入金)' : '合計';

                return (
                  <div key={region}>
                    <h3 className="text-xs font-bold text-slate-400 mb-2 mt-2">
                      {REGION_DISPLAY_NAMES[region] || region}
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-slate-400 text-xs">
                          <th className="text-left font-semibold pb-2">分類</th>
                          <th className="text-right font-semibold pb-2">支出実績</th>
                          <th className="text-right font-semibold pb-2">予算</th>
                          <th className="text-right font-semibold pb-2">収支</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItems.length === 0 && !expenseEditMode && (
                          <tr>
                            <td colSpan={4} className="py-3 text-xs text-slate-400">
                              まだ実績が入力されていません(編集ボタンから入力できます)
                            </td>
                          </tr>
                        )}
                        {visibleItems.map((item) => {
                          const key = `${item.region}|${item.label}`;
                          const isTaxCat = item.region === '引き落とし金額' && item.label === '税金等';
                          return (
                            <tr key={key} className="border-t border-slate-100">
                              <td className="py-2 font-semibold text-slate-700">{item.label}</td>
                              <td className="py-2 text-right">
                                {expenseEditMode ? (
                                  <input
                                    type="number"
                                    placeholder={item.isDefault ? '未入力' : ''}
                                    value={editItems[key]?.expense ?? ''}
                                    onChange={(e) =>
                                      setEditItems((prev) => ({
                                        ...prev,
                                        [key]: { ...(prev[key] || { budget: '0', expense: '' }), expense: e.target.value },
                                      }))
                                    }
                                    className="w-full max-w-[110px] px-2 py-1 border border-slate-200 rounded-lg text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                ) : (
                                  <span className="font-semibold text-slate-800">{yen(item.amount)}</span>
                                )}
                              </td>
                              <td className="py-2 text-right">
                                {isTaxCat ? (
                                  <span className="font-semibold text-slate-800">{yen(item.budget)}</span>
                                ) : expenseEditMode ? (
                                  <input
                                    type="number"
                                    value={editItems[key]?.budget ?? ''}
                                    onChange={(e) =>
                                      setEditItems((prev) => ({
                                        ...prev,
                                        [key]: { ...(prev[key] || { budget: '0', expense: '' }), budget: e.target.value },
                                      }))
                                    }
                                    className="w-full max-w-[110px] px-2 py-1 border border-slate-200 rounded-lg text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                ) : (
                                  <span className="font-semibold text-slate-800">{yen(item.budget)}</span>
                                )}
                              </td>
                              <td className={`py-2 text-right font-bold ${balClass(item.balance)}`}>{yen(item.balance)}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t-2 border-slate-200 font-bold">
                          <td className="py-2 text-slate-800">{totalLabel}</td>
                          <td className="py-2 text-right text-slate-800">{yen(totalExpense)}</td>
                          <td className="py-2 text-right text-slate-800">{yen(totalBudget)}</td>
                          <td className={`py-2 text-right ${balClass(totalBudget - totalExpense)}`}>
                            {yen(totalBudget - totalExpense)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'tax' && (
            <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-base font-bold text-slate-800">{taxData.year}年の税金</h2>
                <div className="flex gap-2">
                  {taxEditMode && (
                    <button
                      onClick={() => setTaxEditMode(false)}
                      className="px-4 py-2 rounded-lg text-sm font-bold text-white bg-slate-400 hover:bg-slate-500"
                    >
                      戻る
                    </button>
                  )}
                  <button
                    onClick={() => (taxEditMode ? saveTaxTab() : startTaxEdit())}
                    disabled={savingTax}
                    className={`px-4 py-2 rounded-lg text-sm font-bold text-white disabled:opacity-50 ${
                      taxEditMode ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'
                    }`}
                  >
                    {taxEditMode ? '保存' : '編集'}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <StatCard label="年間合計(1〜12月の実支払額)" value={grandTotal} />
                <StatCard label="住民税(1〜12月の実支払額)" value={juuCalendarTotal} />
              </div>
              <div
                className="bg-slate-50 rounded-2xl border border-slate-200 p-4 text-center cursor-pointer hover:bg-slate-100 transition"
                onClick={() => setShakenBreakdownOpen((v) => !v)}
              >
                <div className="text-xs font-semibold text-slate-500 flex items-center justify-center gap-1">
                  社会保険料(1〜12月の実支払額)
                  <span className="text-[10px]">{shakenBreakdownOpen ? '▾' : '▸'}</span>
                </div>
                <div className="text-lg font-extrabold text-slate-800 mt-1">{yen(shakaihokenGroupTotal)}</div>
              </div>
              {shakenBreakdownOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <StatCard label="国民年金" value={pensionCalendarTotal} />
                  <StatCard label="国民健康保険料" value={kenpoCalendarTotal} />
                </div>
              )}

              <div className="space-y-3 pt-2">
                <TaxEditRow
                  label={`国民年金(${taxData.year}年度年額)`}
                  editing={taxEditMode}
                  value={editPension}
                  onChange={setEditPension}
                  display={taxData.pensionAnnual}
                />
                <TaxEditRow
                  label={`国民健康保険料(${taxData.year}年度年額)`}
                  editing={taxEditMode}
                  value={editShaken}
                  onChange={setEditShaken}
                  display={taxData.shakaihokenAnnual}
                />
                <TaxEditRow
                  label={`住民税(${taxData.year}年度年額)`}
                  editing={taxEditMode}
                  value={editJuuminzei}
                  onChange={setEditJuuminzei}
                  display={taxData.juuminzeiAnnual}
                />
              </div>

              <h3 className="text-sm font-bold text-slate-700 pt-2">月別支払いスケジュール</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 text-xs">
                    <th className="text-left font-semibold pb-2">月</th>
                    <th className="text-right font-semibold pb-2">国民年金</th>
                    <th className="text-right font-semibold pb-2">国民健康保険料</th>
                    <th className="text-right font-semibold pb-2">住民税</th>
                    <th className="text-right font-semibold pb-2">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {taxData.schedule.map((row, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="py-2 font-semibold text-slate-700">
                        {row.label}
                        {row.year !== taxData.year && (
                          <span className="block text-[10px] text-slate-400 font-medium">{row.year}年</span>
                        )}
                      </td>
                      <td className="py-2 text-right text-slate-800">{yen(row.pension)}</td>
                      <td className="py-2 text-right text-slate-800">{yen(row.shakaihoken)}</td>
                      <td className="py-2 text-right text-slate-800">{yen(row.juuminzei)}</td>
                      <td className="py-2 text-right font-bold text-slate-800">{yen(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm shadow-lg flex items-center gap-2 z-50 max-w-[90vw] text-center">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

function PoolTrendDot(props: any) {
  const { cx, cy, payload } = props;
  if (payload?.isSelected) {
    return (
      <g>
        <circle cx={cx} cy={cy} r={9} fill="#dc2626" fillOpacity={0.15} />
        <circle cx={cx} cy={cy} r={5} fill="#dc2626" stroke="#fff" strokeWidth={2} />
      </g>
    );
  }
  return <circle cx={cx} cy={cy} r={3} fill="#2563eb" />;
}

function StatCard({ label, value, signed }: { label: string; value: number; signed?: boolean }) {
  const cls = signed ? (value < 0 ? 'text-red-600' : 'text-green-600') : 'text-slate-800';
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm text-center">
      <div className="text-xs font-semibold text-slate-400 mb-1">{label}</div>
      <div className={`text-xl font-extrabold ${cls}`}>{yen(value)}</div>
    </div>
  );
}

function TaxEditRow({
  label,
  editing,
  value,
  onChange,
  display,
}: {
  label: string;
  editing: boolean;
  value: string;
  onChange: (v: string) => void;
  display: number;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <label className="text-sm font-bold text-slate-700">{label}</label>
      {editing ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-40 px-3 py-1.5 border border-slate-200 rounded-lg text-right text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <span className="text-sm font-bold text-slate-800">{yen(display)}</span>
      )}
    </div>
  );
}
