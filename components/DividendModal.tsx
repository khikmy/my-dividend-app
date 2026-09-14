'use client';

import { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DividendRecord } from '@/types/database';

interface DividendModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: Partial<DividendRecord> | null;
}

export default function DividendModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
}: DividendModalProps) {
  const isEdit = Boolean(initialData && initialData.id);

  const [stockType, setStockType] = useState<'日本株' | '米国株'>('日本株');
  const [tickerCode, setTickerCode] = useState('');
  const [tickerName, setTickerName] = useState('');
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1);
  const [dividendUnit, setDividendUnit] = useState<number>(0);
  const [sharesTokutei, setSharesTokutei] = useState<number>(0);
  const [amountTokutei, setAmountTokutei] = useState<number>(0);
  const [sharesNisa, setSharesNisa] = useState<number>(0);
  const [amountNisa, setAmountNisa] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      setTickerCode(initialData.ticker_code || '');
      setTickerName(initialData.ticker_name || '');
      const cur = initialData.currency || (initialData.dividend_unit_usd ? 'USD' : 'JPY');
      setStockType(cur === 'USD' ? '米国株' : '日本株');
      setYear(initialData.year || new Date().getFullYear());
      setMonth(initialData.month || new Date().getMonth() + 1);
      setDividendUnit(
        cur === 'USD'
          ? initialData.dividend_unit_usd || 0
          : initialData.dividend_unit_jpy || 0
      );
      setSharesTokutei(initialData.shares_tokutei || 0);
      setAmountTokutei(initialData.amount_tokutei || 0);
      setSharesNisa(initialData.shares_nisa || 0);
      setAmountNisa(initialData.amount_nisa || 0);
    } else {
      setStockType('日本株');
      setTickerCode('');
      setTickerName('');
      setYear(new Date().getFullYear());
      setMonth(new Date().getMonth() + 1);
      setDividendUnit(0);
      setSharesTokutei(0);
      setAmountTokutei(0);
      setSharesNisa(0);
      setAmountNisa(0);
    }
    setErrorMsg(null);
  }, [initialData, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tickerCode.trim() || !tickerName.trim()) {
      setErrorMsg('銘柄コードと銘柄名を入力してください。');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    const currency = stockType === '日本株' ? 'JPY' : 'USD';
    const divUnitJpy = currency === 'JPY' ? dividendUnit : 0;
    const divUnitUsd = currency === 'USD' ? dividendUnit : 0;

    try {
      // 1. 銘柄情報のUpsert
      const { error: stockError } = await supabase.from('stocks').upsert(
        {
          ticker_code: tickerCode.trim(),
          ticker_name: tickerName.trim(),
          currency,
        },
        { onConflict: 'ticker_code' }
      );

      if (stockError) throw new Error(stockError.message);

      // 2. 配当金レコードの保存
      const recordPayload = {
        ticker_code: tickerCode.trim(),
        year: Number(year),
        month: Number(month),
        dividend_unit_jpy: Number(divUnitJpy),
        dividend_unit_usd: Number(divUnitUsd),
        shares_tokutei: Number(sharesTokutei),
        amount_tokutei: Number(amountTokutei),
        shares_nisa: Number(sharesNisa),
        amount_nisa: Number(amountNisa),
      };

      if (isEdit && initialData?.id) {
        const { error: recordError } = await supabase
          .from('dividend_records')
          .update(recordPayload)
          .eq('id', initialData.id);
        if (recordError) throw new Error(recordError.message);
      } else {
        const { error: recordError } = await supabase
          .from('dividend_records')
          .insert(recordPayload);
        if (recordError) throw new Error(recordError.message);
      }

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-800">
            {isEdit ? '配当金データの編集' : '配当金データの登録'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Stock Type */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              銘柄タイプ
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStockType('日本株')}
                className={`py-2 px-4 rounded-xl text-sm font-semibold border transition ${
                  stockType === '日本株'
                    ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                🇯🇵 日本株 (円)
              </button>
              <button
                type="button"
                onClick={() => setStockType('米国株')}
                className={`py-2 px-4 rounded-xl text-sm font-semibold border transition ${
                  stockType === '米国株'
                    ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                🇺🇸 米国株 (USD)
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Ticker Code */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                銘柄コード <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="例: 9101 または AAPL"
                value={tickerCode}
                onChange={(e) => setTickerCode(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Ticker Name */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                銘柄名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="例: 日本郵船"
                value={tickerName}
                onChange={(e) => setTickerName(e.target.value)}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Year */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                受取年 <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                required
                min={2000}
                max={2050}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* Month */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                受取月 <span className="text-red-500">*</span>
              </label>
              <select
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>

            {/* Dividend Unit */}
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                配当金単価 ({stockType === '日本株' ? '円' : 'USD'})
              </label>
              <input
                type="number"
                step="any"
                min={0}
                value={dividendUnit}
                onChange={(e) => setDividendUnit(Number(e.target.value))}
                className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">
              口座別 保有株数 & 受取金額（円）
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Tokutei Shares */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 space-y-3">
                <span className="text-xs font-bold text-slate-700 block">特定口座</span>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">保有株数 (株)</label>
                  <input
                    type="number"
                    min={0}
                    value={sharesTokutei}
                    onChange={(e) => setSharesTokutei(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">受取金額 (円)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={amountTokutei}
                    onChange={(e) => setAmountTokutei(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* NISA Shares */}
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/70 space-y-3">
                <span className="text-xs font-bold text-slate-700 block">NISA口座</span>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">保有株数 (株)</label>
                  <input
                    type="number"
                    min={0}
                    value={sharesNisa}
                    onChange={(e) => setSharesNisa(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">受取金額 (円)</label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={amountNisa}
                    onChange={(e) => setAmountNisa(Number(e.target.value))}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm shadow-blue-500/25 transition active:scale-95"
            >
              <Save className="w-4 h-4" />
              <span>{loading ? '保存中...' : '保存する'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

