'use client';

import { useState, useEffect } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { COUNTRY_TO_CURRENCY, CURRENCY_TO_COUNTRY } from '@/lib/forex';
import { ForeignCurrencyRecord } from '@/types/database';

interface ForexModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  initialData?: ForeignCurrencyRecord | null;
  defaultCountry?: string;
}

export default function ForexModal({
  isOpen,
  onClose,
  onSuccess,
  initialData,
  defaultCountry,
}: ForexModalProps) {
  const countryList = Object.keys(COUNTRY_TO_CURRENCY);
  const [selectedCountry, setSelectedCountry] = useState(
    defaultCountry || 'アメリカ (USD)'
  );
  const [amount, setAmount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (initialData) {
      const country = CURRENCY_TO_COUNTRY[initialData.currency] || initialData.currency;
      setSelectedCountry(country);
      setAmount(initialData.amount || 0);
    } else if (defaultCountry) {
      setSelectedCountry(defaultCountry);
      setAmount(0);
    } else {
      setSelectedCountry('アメリカ (USD)');
      setAmount(0);
    }
    setErrorMsg(null);
  }, [initialData, defaultCountry, isOpen]);

  if (!isOpen) return null;

  const currentCurrency = COUNTRY_TO_CURRENCY[selectedCountry] || selectedCountry;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amount < 0) {
      setErrorMsg('保有金額は0以上を入力してください。');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { error } = await supabase.from('foreignCurrency_records').upsert(
        {
          currency: currentCurrency,
          amount: Number(amount),
        },
        { onConflict: 'currency' }
      );

      if (error) throw new Error(error.message);

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || '保存に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden border border-slate-200 animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h2 className="text-base font-bold text-slate-800">
            {initialData ? '外貨保有量の編集' : '新規外貨金額の登録'}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {errorMsg && (
            <div className="flex items-center gap-2 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              国名・通貨
            </label>
            <select
              value={selectedCountry}
              onChange={(e) => setSelectedCountry(e.target.value)}
              disabled={Boolean(initialData)}
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-500"
            >
              {countryList.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              保有金額 ({currentCurrency})
            </label>
            <input
              type="number"
              step="any"
              min={0}
              required
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              placeholder="0.00"
              className="w-full px-3.5 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

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
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition active:scale-95"
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

