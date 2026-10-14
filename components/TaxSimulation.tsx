'use client';

import { useState, useEffect, useMemo } from 'react';
import { Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { calculateTax } from '@/lib/tax';
import { grossOf } from '@/lib/dividendImport';
import { DividendRecord } from '@/types/database';
import { AccountType, JournalRow, buildStatements, mergeSplitRows, setAccounts } from '@/lib/accounting';

export default function TaxSimulation() {
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [taxYear, setTaxYear] = useState<number>(
    new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()
  );
  // 売上・経費・国民年金・国民健康保険料は、会計と税金の支払い状況から自動で取得する
  const [sales, setSales] = useState<number>(0);
  const [expenses, setExpenses] = useState<number>(0);
  const [nationalPension, setNationalPension] = useState<number>(0);
  const [healthInsurance, setHealthInsurance] = useState<number>(0);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoError, setAutoError] = useState<string | null>(null);
  // 12月までの予測用: 売上のある直近の月と、その月の売上・経費(当年のみ)
  const [recent, setRecent] = useState<{ month: number; sales: number; expenses: number } | null>(null);
  const [ideco, setIdeco] = useState<number>(0);
  const [donationDeduction, setDonationDeduction] = useState<number>(50000);
  const [medicalDeduction, setMedicalDeduction] = useState<number>(0);
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxSavedMsg, setTaxSavedMsg] = useState(false);
  const [taxSaveError, setTaxSaveError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDividends() {
      setLoading(true);
      try {
        const { data: divData } = await supabase
          .from('dividend_records')
          .select('*, stocks(*)');

        if (divData) {
          const flat = divData.map((d: any) => {
            const st = Array.isArray(d.stocks) ? d.stocks[0] : d.stocks;
            return {
              ...d,
              currency: st?.currency || (d.dividend_unit_usd > 0 ? 'USD' : 'JPY'),
              amount_tokutei: Number(d.amount_tokutei || 0),
              amount_nisa: Number(d.amount_nisa || 0),
              gross_tokutei: d.gross_tokutei == null ? null : Number(d.gross_tokutei),
            };
          });
          setDividends(flat);
        }
      } catch (err) {
        console.error('Failed to load dividend data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchDividends();
  }, []);

  useEffect(() => {
    async function loadTax() {
      const { data } = await supabase
        .from('tax_simulations')
        .select('*')
        .eq('year', taxYear)
        .single();
      if (data) {
        setIdeco(data.ideco ?? 0);
        setDonationDeduction(data.donation_deduction ?? 50000);
        setMedicalDeduction(data.medical_deduction ?? 0);
      }
    }
    loadTax();
  }, [taxYear]);

  // 売上・経費は会計の損益計算書、国民年金・国民健康保険料は税金の支払い状況から取得する
  useEffect(() => {
    let cancelled = false;
    async function loadAuto() {
      setAutoLoading(true);
      setAutoError(null);
      try {
        const [acc, tax] = await Promise.all([
          supabase.from('accounts').select('name, type').order('sort_order').order('id'),
          supabase.from('tax_annual').select('*').eq('year', taxYear).maybeSingle(),
        ]);
        // 科目マスタを反映して、収益・費用の区分を会計画面と同じにする
        const list = (acc.data ?? []) as { name: string; type: AccountType }[];
        if (!acc.error && list.length > 0) setAccounts(list);

        // 1回の取得は最大1000行のため、ページ分けして対象年の仕訳を全件読み込む
        const PAGE = 1000;
        const data: any[] = [];
        for (let from = 0; ; from += PAGE) {
          const res = await supabase
            .from('journal_entries')
            .select('*')
            .gte('entry_date', `${taxYear}-01-01`)
            .lte('entry_date', `${taxYear}-12-31`)
            .order('id')
            .range(from, from + PAGE - 1);
          if (res.error) throw res.error;
          data.push(...(res.data ?? []));
          if ((res.data ?? []).length < PAGE) break;
        }
        const rows: JournalRow[] = mergeSplitRows(
          data.map((r: any) => ({ ...r, debit_amount: Number(r.debit_amount), credit_amount: Number(r.credit_amount) }))
        );
        const st = buildStatements(rows);

        // 当年は、売上のある最後の月を「直近」として、その月の売上・経費を12月まで繰り返す予測に使う
        let recentMonth: { month: number; sales: number; expenses: number } | null = null;
        if (taxYear === new Date().getFullYear()) {
          for (let m = 12; m >= 1; m--) {
            const ms = buildStatements(rows.filter((r) => Number(r.entry_date.slice(5, 7)) === m));
            const monthSales = ms.revenues.filter((a) => a.name !== '受取利息').reduce((sum, a) => sum + a.amount, 0);
            if (monthSales !== 0) {
              recentMonth = { month: m, sales: monthSales, expenses: ms.totalExpense };
              break;
            }
          }
        }
        if (cancelled) return;
        setRecent(recentMonth);
        // 受取利息は利子所得なので、事業収入には含めない
        setSales(st.revenues.filter((a) => a.name !== '受取利息').reduce((sum, a) => sum + a.amount, 0));
        setExpenses(st.totalExpense);
        setNationalPension(Number(tax.data?.pension_annual) || 0);
        setHealthInsurance(Number(tax.data?.shakaihoken_annual) || 0);
      } catch (err) {
        console.error('Failed to load auto values:', err);
        if (!cancelled) setAutoError('会計・税金のデータの読み込みに失敗しました');
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    }
    loadAuto();
    return () => {
      cancelled = true;
    };
  }, [taxYear]);

  // 12月までの予測: 実績に、直近月の売上・経費を残りの月数ぶん加算する
  const forecast = useMemo(() => {
    const remaining = recent ? 12 - recent.month : 0;
    return {
      remaining,
      sales: sales + (recent?.sales ?? 0) * remaining,
      expenses: expenses + (recent?.expenses ?? 0) * remaining,
    };
  }, [recent, sales, expenses]);

  const { divJpyTokutei, divUsdJpyTokutei, taxResult, forecastResult } = useMemo(() => {
    const yearDivs = dividends.filter((d) => d.year === taxYear);
    // 税引き前: CSV取込で保存した実額を優先し、なければ税引き後(特定口座)から逆算する
    const sumGross = (cur: 'JPY' | 'USD') =>
      Math.round(yearDivs.filter((d) => d.currency === cur).reduce((acc, d) => acc + grossOf(d), 0));
    const jpyGross = sumGross('JPY');
    const usdGross = sumGross('USD');

    const res = calculateTax({
      year: taxYear,
      sales,
      expenses,
      national_pension: nationalPension,
      health_insurance: healthInsurance,
      ideco,
      donation_deduction: donationDeduction,
      medical_deduction: medicalDeduction,
      div_jpy_tokutei: jpyGross,
      div_usd_jpy_tokutei: usdGross,
    });

    const forecastRes = calculateTax({
      year: taxYear,
      sales: forecast.sales,
      expenses: forecast.expenses,
      national_pension: nationalPension,
      health_insurance: healthInsurance,
      ideco,
      donation_deduction: donationDeduction,
      medical_deduction: medicalDeduction,
      div_jpy_tokutei: jpyGross,
      div_usd_jpy_tokutei: usdGross,
    });

    return {
      divJpyTokutei: jpyGross,
      divUsdJpyTokutei: usdGross,
      taxResult: res,
      forecastResult: forecastRes,
    };
  }, [
    forecast,
    dividends,
    taxYear,
    sales,
    expenses,
    nationalPension,
    healthInsurance,
    ideco,
    donationDeduction,
    medicalDeduction,
  ]);

  const handleSaveTax = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaxSaving(true);
    setTaxSavedMsg(false);
    setTaxSaveError(null);
    try {
      // 売上・経費・国民年金・国民健康保険料は自動取得なので保存せず、手入力の3項目だけを保存する
      const { error } = await supabase.from('tax_simulations').upsert(
        {
          year: taxYear,
          ideco,
          donation_deduction: donationDeduction,
          medical_deduction: medicalDeduction,
        },
        { onConflict: 'year' }
      );
      if (error) throw new Error(error.message);
      setTaxSavedMsg(true);
      setTimeout(() => setTaxSavedMsg(false), 3000);
    } catch (err: any) {
      console.error(err);
      setTaxSaveError(`保存に失敗しました: ${err.message}`);
    } finally {
      setTaxSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          ※このシミュレーションは概算です。正確な税額は国税庁確定申告書等作成コーナー等でご確認ください。
        </span>
      </div>

      {autoError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{autoError}</span>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSaveTax} className="space-y-6">
        {/* Year selector */}
        <div className="flex items-center gap-3">
          <label className="text-sm font-semibold text-slate-700">対象年度:</label>
          <select
            value={taxYear}
            onChange={(e) => setTaxYear(Number(e.target.value))}
            className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {[2024, 2025, 2026, 2027].map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>

        {/* Inputs grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Business Income & Dividend Income */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              基本データ（事業・配当収入）
            </h4>
            <AutoValue label="売上（事業収入）" value={sales} source="会計の損益計算書より" loading={autoLoading} />
            <AutoValue label="経費" value={expenses} source="会計の損益計算書より" loading={autoLoading} />
            <div className="p-3 bg-slate-50 rounded-xl space-y-2 border border-slate-100">
              <div className="text-xs font-semibold text-slate-600">
                配当収入（税引き前・特定口座のみ自動集計）
              </div>
              <div className="grid grid-cols-2 text-xs">
                <div>
                  <span className="text-slate-400 block">日本株</span>
                  <span className="font-bold text-slate-800">¥ {divJpyTokutei.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">米国株（円換算）</span>
                  <span className="font-bold text-slate-800">¥ {divUsdJpyTokutei.toLocaleString()}</span>
                </div>
              </div>
              <div className="text-xs pt-1 border-t border-slate-200/60 font-semibold text-blue-700">
                申告対象の配当所得: ¥ {(divJpyTokutei + divUsdJpyTokutei).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Deductions */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
              社会保険料・各種控除
            </h4>
            <AutoValue label="国民年金保険料" value={nationalPension} source="「支払い状況」の年額より" loading={autoLoading} />
            <AutoValue label="国民健康保険料" value={healthInsurance} source="「支払い状況」の年額より" loading={autoLoading} />
            <div className="border-t border-slate-100 pt-4 space-y-4">
              <div className="text-xs font-semibold text-slate-600">
                手入力する控除（{taxYear}年度分として保存）
              </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">iDeCo・小規模企業共済掛金</label>
              <input
                type="number"
                step={1000}
                value={ideco}
                onChange={(e) => setIdeco(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">ふるさと納税・寄付金控除</label>
                <input
                  type="number"
                  step={1000}
                  value={donationDeduction}
                  onChange={(e) => setDonationDeduction(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">医療費控除</label>
                <input
                  type="number"
                  step={1000}
                  value={medicalDeduction}
                  onChange={(e) => setMedicalDeduction(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

              {/* Save Button: 上の3つの手入力項目だけを保存する */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={taxSaving}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition active:scale-95 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{taxSaving ? '保存中...' : 'iDeCo・寄付金・医療費を保存'}</span>
                </button>
                {taxSavedMsg && (
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> 保存しました！
                  </span>
                )}
                {taxSaveError && <span className="text-xs font-semibold text-red-600">{taxSaveError}</span>}
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Results Summary */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <h4 className="text-sm font-bold text-slate-800 border-b border-slate-100 pb-2">
          算出結果（概算）
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60">
            <span className="text-xs text-slate-500 font-medium block">
              所得税 (納付 / 還付)
            </span>
            <span
              className={`text-2xl font-bold block mt-1 ${
                taxResult.final_tax_amount < 0 ? 'text-emerald-600' : 'text-slate-900'
              }`}
            >
              ¥ {taxResult.final_tax_amount.toLocaleString()}
            </span>
            <span className="text-xs text-slate-400 mt-0.5 block">
              {taxResult.final_tax_amount < 0 ? '※還付される見込みです' : '※確定申告時の納付目安'}
            </span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60">
            <span className="text-xs text-slate-500 font-medium block">
              住民税（次年度分）
            </span>
            <span className="text-2xl font-bold text-slate-900 block mt-1">
              ¥ {taxResult.residence_tax.toLocaleString()}
            </span>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200/60">
            <span className="text-xs text-slate-500 font-medium block">消費税</span>
            <span className="text-2xl font-bold text-slate-900 block mt-1">
              ¥ {taxResult.consumption_tax.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
          <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
            <span className="text-xs text-blue-700 font-semibold block">
              国民健康保険料（次年度分概算）
            </span>
            <span className="text-2xl font-bold text-blue-900 block mt-1">
              ¥ {taxResult.calculated_h_ins.toLocaleString()}
            </span>
          </div>

          <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100">
            <span className="text-xs text-emerald-700 font-semibold block">
              ふるさと納税限度額
            </span>
            <span className="text-2xl font-bold text-emerald-900 block mt-1">
              ¥ {forecastResult.furusato_limit.toLocaleString()}
            </span>
            {recent && forecast.remaining > 0 ? (
              <div className="text-xs text-emerald-800/80 mt-1.5 space-y-0.5">
                <div>
                  12月までの予測ベース(直近の{recent.month}月の売上・経費を残り{forecast.remaining}か月に加算)
                </div>
                <div>
                  売上 ¥{forecast.sales.toLocaleString()}(実績 ¥{sales.toLocaleString()} + ¥{recent.sales.toLocaleString()}×{forecast.remaining})
                </div>
                <div>
                  経費 ¥{forecast.expenses.toLocaleString()}(実績 ¥{expenses.toLocaleString()} + ¥{recent.expenses.toLocaleString()}×{forecast.remaining})
                </div>
                <div className="text-emerald-700/70">
                  参考: 現時点の実績ベースは ¥{taxResult.furusato_limit.toLocaleString()}
                </div>
              </div>
            ) : (
              <div className="text-xs text-emerald-800/80 mt-1.5">実績ベース(予測の加算なし)</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AutoValue({ label, value, source, loading }: { label: string; value: number; source: string; loading: boolean }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-slate-600">{label}</span>
        <span className="text-[10px] text-slate-400">{source}</span>
      </div>
      <div className="text-sm font-bold text-slate-800 mt-1">{loading ? '読み込み中...' : `¥ ${value.toLocaleString()}`}</div>
    </div>
  );
}
