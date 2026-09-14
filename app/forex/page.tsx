'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  RefreshCw, 
  PlusCircle, 
  Coins, 
  Edit2, 
  Trash2, 
  CheckCircle2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { ForeignCurrencyRecord } from '@/types/database';
import { CURRENCY_TO_COUNTRY } from '@/lib/forex';
import ForexModal from '@/components/ForexModal';
import ConfirmModal from '@/components/ConfirmModal';

export default function ForexPage() {
  const [records, setRecords] = useState<ForeignCurrencyRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Sorting
  const [sortOption, setSortOption] = useState<'high' | 'low' | 'name'>('high');

  // Refresh
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ForeignCurrencyRecord | null>(null);

  // Delete modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<ForeignCurrencyRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadForexData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('foreignCurrency_records')
        .select('*');
      if (error) throw error;
      setRecords(data || []);
    } catch (err) {
      console.error('Failed to load forex data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadForexData();
  }, []);

  // Last update string
  const lastUpdateStr = useMemo(() => {
    const dates = records
      .map((r) => r.updated_at)
      .filter(Boolean) as string[];
    if (dates.length === 0) return '未実施';
    const latest = new Date(Math.max(...dates.map((d) => new Date(d).getTime())));
    return latest.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [records]);

  // Handle refresh rates
  const handleRefreshRates = async () => {
    setRefreshing(true);
    setRefreshMsg('最新の為替レートを取得・更新中...');
    try {
      const res = await fetch('/api/forex/refresh', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRefreshMsg(`レート更新が完了しました。（${data.updatedCount || 0}通貨）`);
        await loadForexData();
      } else {
        setRefreshMsg(`レート更新エラー: ${data.error || '不明なエラー'}`);
      }
    } catch (err: any) {
      setRefreshMsg(`更新失敗: ${err.message}`);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  };

  // Sorted items
  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => {
      const jpyA = a.jpy || 0;
      const jpyB = b.jpy || 0;
      const nameA = CURRENCY_TO_COUNTRY[a.currency] || a.currency;
      const nameB = CURRENCY_TO_COUNTRY[b.currency] || b.currency;

      if (sortOption === 'high') return jpyB - jpyA;
      if (sortOption === 'low') return jpyA - jpyB;
      return nameA.localeCompare(nameB);
    });
  }, [records, sortOption]);

  // Total JPY
  const totalJpy = useMemo(() => {
    return records.reduce((acc, r) => acc + (r.jpy || 0), 0);
  }, [records]);

  // Delete confirm
  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('foreignCurrency_records')
        .delete()
        .eq('currency', recordToDelete.currency);
      if (error) throw error;
      setDeleteModalOpen(false);
      setRecordToDelete(null);
      await loadForexData();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">保有外貨一覧</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            為替レート状況最終更新日時: {lastUpdateStr}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>ダッシュボードへ</span>
          </Link>

          <button
            onClick={handleRefreshRates}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-blue-600 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? '更新中...' : '為替レートを更新'}</span>
          </button>

          <button
            onClick={() => {
              setEditingRecord(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition active:scale-95"
          >
            <PlusCircle className="w-4 h-4" />
            <span>新規外貨金額を登録</span>
          </button>
        </div>
      </div>

      {/* Message alert */}
      {refreshMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>{refreshMsg}</span>
        </div>
      )}

      {/* Total & Sort Panel */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-xs font-semibold text-slate-400 block">外貨資産総額 (円換算)</span>
          <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-0.5 block">
            ¥ {totalJpy.toLocaleString()}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">並べ替え:</span>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="high">保有額が高い順</option>
            <option value="low">保有額が低い順</option>
            <option value="name">国名順</option>
          </select>
        </div>
      </div>

      {/* Currency Cards List */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : sortedRecords.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-sm">
          外貨データがありません。「新規外貨金額を登録」から追加してください。
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {sortedRecords.map((r) => {
            const countryName = CURRENCY_TO_COUNTRY[r.currency] || r.currency;
            const jpyVal = r.jpy || 0;
            const rateStr = r.rate ? `${r.rate.toFixed(2)} JPY` : '未取得';

            return (
              <div
                key={r.currency}
                className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-sm border border-blue-100 flex-shrink-0">
                      {r.currency}
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{countryName}</h3>
                      <span className="text-xs text-slate-400 font-mono">1 {r.currency} = {rateStr}</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-slate-400 block">日本円換算</span>
                    <span className="text-lg font-extrabold text-blue-700">
                      ¥ {jpyVal.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block">保有金額</span>
                    <span className="text-sm font-bold text-slate-800 mt-0.5 block">
                      {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {r.currency}
                    </span>
                  </div>

                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block">為替レート</span>
                    <span className="text-sm font-bold text-slate-800 mt-0.5 block">
                      {rateStr}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setEditingRecord(r);
                      setModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>編集</span>
                  </button>
                  <button
                    onClick={() => {
                      setRecordToDelete(r);
                      setDeleteModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>削除</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Forex Add / Edit Modal */}
      {modalOpen && (
        <ForexModal
          isOpen={modalOpen}
          initialData={editingRecord}
          onClose={() => {
            setModalOpen(false);
            setEditingRecord(null);
          }}
          onSuccess={() => {
            setModalOpen(false);
            setEditingRecord(null);
            loadForexData();
          }}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteModalOpen && recordToDelete && (
        <ConfirmModal
          isOpen={deleteModalOpen}
          title="外貨データの削除"
          message={`【${CURRENCY_TO_COUNTRY[recordToDelete.currency] || recordToDelete.currency}】の保有データを削除しますか？この操作は取り消せません。`}
          confirmLabel="はい、削除します"
          loading={deleting}
          onConfirm={handleDeleteConfirm}
          onCancel={() => {
            setDeleteModalOpen(false);
            setRecordToDelete(null);
          }}
        />
      )}
    </div>
  );
}

