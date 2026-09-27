'use client';

import { useState, useEffect, useMemo } from 'react';
import { Save, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { calculateTax } from '@/lib/tax';
import { DividendRecord } from '@/types/database';

export default function TaxSimulationPage() {
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [taxYear, setTaxYear] = useState<number>(
    new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()
  );
  const [sales, setSales] = useState<number>(5000000);
  const [expenses, setExpenses] = useState<number>(1000000);
  const [nationalPension, setNationalPension] = useState<number>(200000);
  const [healthInsurance, setHealthInsurance] = useState<number>(300000);
  const [ideco, setIdeco] = useState<number>(0);
  const [donationDeduction, setDonationDeduction] = useState<number>(50000);
  const [medicalDeduction, setMedicalDeduction] = useState<number>(0);
  const [taxSaving, setTaxSaving] = useState(false);
  const [taxSavedMsg, setTaxSavedMsg] = useState(false);

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
        setSales(data.sales ?? 5000000);
        setExpenses(data.expenses ?? 1000000);
        setNationalPension(data.national_pension ?? 200000);
        setHealthInsurance(data.health_insurance ?? 300000);
        setIdeco(data.ideco ?? 0);
        setDonationDeduction(data.donation_deduction ?? 50000);
        setMedicalDeduction(data.medical_deduction ?? 0);
      }
    }
    loadTax();
  }, [taxYear]);

  const { divJpyTokutei, divUsdJpyTokutei, taxResult } = useMemo(() => {
    const yearDivs = dividends.filter((d) => d.year === taxYear);
    const jpyOri = yearDivs
      .filter((d) => d.currency === 'JPY')
      .reduce((acc, d) => acc + (d.amount_tokutei || 0), 0);
    const usdOri = yearDivs
      .filter((d) => d.currency === 'USD')
      .reduce((acc, d) => acc + (d.amount_tokutei || 0), 0);

    const jpyGross = Math.round((jpyOri * 100) / (100 - 20.315));
    const usdGross = Math.round((usdOri * 100) / (100 - 28.3));

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

    return {
      divJpyTokutei: jpyGross,
      divUsdJpyTokutei: usdGross,
      taxResult: res,
    };
  }, [
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
    try {
      await supabase.from('tax_simulations').upsert(
        {
          year: taxYear,
          sales,
          expenses,
          national_pension: nationalPension,
          health_insurance: healthInsurance,
          ideco,
          donation_deduction: donationDeduction,
          medical_deduction: medicalDeduction,
        },
        { onConflict: 'year' }
      );
      setTaxSavedMsg(true);
      setTimeout(() => setTaxSavedMsg(false), 3000);
    } catch (err) {
      console.error(err);
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
      <h1 className="text-2xl font-bold text-slate-800">確定申告シミュレーション</h1>

      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-800 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          ※このシミュレーションは概算です。正確な税額は国税庁確定申告書等作成コーナー等でご確認ください。
        </span>
      </div>

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
            <div>
              <label className="block text-xs text-slate-500 mb-1">売上（事業収入）</label>
              <input
                type="number"
                step={10000}
                value={sales}
                onChange={(e) => setSales(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">経費</label>
              <input
                type="number"
                step={10000}
                value={expenses}
                onChange={(e) => setExpenses(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
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
            <div>
              <label className="block text-xs text-slate-500 mb-1">国民年金保険料</label>
              <input
                type="number"
                step={1000}
                value={nationalPension}
                onChange={(e) => setNationalPension(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">国民健康保険料</label>
              <input
                type="number"
                step={1000}
                value={healthInsurance}
                onChange={(e) => setHealthInsurance(Number(e.target.value))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
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
          </div>
        </div>

        {/* Save Button */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={taxSaving}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition active:scale-95 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{taxSaving ? '保存中...' : `${taxYear}年度のデータを保存`}</span>
          </button>
          {taxSavedMsg && (
            <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> 保存しました！
            </span>
          )}
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
              ¥ {taxResult.furusato_limit.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
