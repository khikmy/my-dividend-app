'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { 
  ArrowLeft, 
  RefreshCw, 
  PlusCircle, 
  Search, 
  ChevronDown, 
  ChevronUp, 
  Edit2, 
  Trash2, 
  Layers,
  Calendar,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DividendRecord, Stock } from '@/types/database';
import DividendModal from '@/components/DividendModal';
import ConfirmModal from '@/components/ConfirmModal';

export default function StocksPage() {
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [stockType, setStockType] = useState<'すべて' | '日本株' | '米国株'>('すべて');
  const [searchQuery, setSearchQuery] = useState('');

  // Accordion open state
  const [openTickers, setOpenTickers] = useState<Record<string, boolean>>({});

  // Refresh status state
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  // Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<Partial<DividendRecord> | null>(null);

  // Delete modal states
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<DividendRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [divRes, stockRes] = await Promise.all([
        supabase.from('dividend_records').select('*, stocks(*)').order('year', { ascending: false }).order('month', { ascending: false }),
        supabase.from('stocks').select('*'),
      ]);

      if (stockRes.data) setStocks(stockRes.data);

      if (divRes.data) {
        const flat = divRes.data.map((d: any) => {
          const st = Array.isArray(d.stocks) ? d.stocks[0] : d.stocks;
          return {
            ...d,
            ticker_name: st?.ticker_name || d.ticker_code,
            currency: st?.currency || (d.dividend_unit_usd > 0 ? 'USD' : 'JPY'),
            last_check_status: st?.last_check_status,
            last_check_color: st?.last_check_color,
            last_check_info: st?.last_check_info,
            amount_tokutei: Number(d.amount_tokutei || 0),
            amount_nisa: Number(d.amount_nisa || 0),
            shares_tokutei: Number(d.shares_tokutei || 0),
            shares_nisa: Number(d.shares_nisa || 0),
            dividend_unit_jpy: Number(d.dividend_unit_jpy || 0),
            dividend_unit_usd: Number(d.dividend_unit_usd || 0),
          };
        });
        setDividends(flat);

        // Open the first few accordions by default
        const initialOpens: Record<string, boolean> = {};
        const unique = Array.from(new Set(flat.map((d) => d.ticker_code)));
        unique.slice(0, 3).forEach((code) => {
          initialOpens[code] = true;
        });
        setOpenTickers((prev) => ({ ...initialOpens, ...prev }));
      }
    } catch (err) {
      console.error('Failed to load stocks data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Last update timestamp from stocks
  const lastUpdateStr = useMemo(() => {
    const dates = stocks
      .map((s) => s.updated_at)
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
  }, [stocks]);

  // Handle Refresh
  const handleRefreshAll = async () => {
    setRefreshing(true);
    setRefreshMsg('最新配当金状況を取得・更新中...');
    try {
      const res = await fetch('/api/stocks/refresh', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setRefreshMsg(`完了！ ${data.count || 0}銘柄の配当金状況を更新しました。`);
        await loadData();
      } else {
        setRefreshMsg(`更新エラー: ${data.error || '不明なエラー'}`);
      }
    } catch (err: any) {
      setRefreshMsg(`更新失敗: ${err.message}`);
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshMsg(null), 5000);
    }
  };

  // Filtered list
  const filteredDividends = useMemo(() => {
    let list = dividends;
    if (stockType === '日本株') list = list.filter((d) => d.currency === 'JPY');
    if (stockType === '米国株') list = list.filter((d) => d.currency === 'USD');

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (d) =>
          d.ticker_name?.toLowerCase().includes(q) ||
          d.ticker_code.toLowerCase().includes(q)
      );
    }
    return list;
  }, [dividends, stockType, searchQuery]);

  // Grouped by ticker_code
  const groupedStocks = useMemo(() => {
    const map: Record<
      string,
      {
        ticker_code: string;
        ticker_name: string;
        currency: 'JPY' | 'USD';
        last_check_status?: string | null;
        last_check_color?: string | null;
        last_check_info?: string | null;
        total_tokutei: number;
        total_nisa: number;
        records: DividendRecord[];
      }
    > = {};

    filteredDividends.forEach((d) => {
      if (!map[d.ticker_code]) {
        const st = stocks.find((s) => s.ticker_code === d.ticker_code);
        map[d.ticker_code] = {
          ticker_code: d.ticker_code,
          ticker_name: d.ticker_name || d.ticker_code,
          currency: d.currency || 'JPY',
          last_check_status: st?.last_check_status || d.last_check_status,
          last_check_color: st?.last_check_color || d.last_check_color,
          last_check_info: st?.last_check_info || d.last_check_info,
          total_tokutei: 0,
          total_nisa: 0,
          records: [],
        };
      }
      map[d.ticker_code].total_tokutei += d.amount_tokutei || 0;
      map[d.ticker_code].total_nisa += d.amount_nisa || 0;
      map[d.ticker_code].records.push(d);
    });

    return Object.values(map).sort((a, b) => a.ticker_code.localeCompare(b.ticker_code));
  }, [filteredDividends, stocks]);

  // Delete Action
  const handleDeleteConfirm = async () => {
    if (!recordToDelete?.id) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('dividend_records')
        .delete()
        .eq('id', recordToDelete.id);
      if (error) throw error;
      setDeleteModalOpen(false);
      setRecordToDelete(null);
      await loadData();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setDeleting(false);
    }
  };

  const toggleAccordion = (code: string) => {
    setOpenTickers((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">保有銘柄一覧</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            配当金状況最終更新日時: {lastUpdateStr}
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
            onClick={handleRefreshAll}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 shadow-sm transition disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-blue-600 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? '更新中...' : '最新配当金状況を更新'}</span>
          </button>

          <button
            onClick={() => {
              setSelectedRecord(null);
              setModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold shadow-sm transition active:scale-95"
          >
            <PlusCircle className="w-4 h-4" />
            <span>新規配当データ登録</span>
          </button>
        </div>
      </div>

      {/* Refresh message alert */}
      {refreshMsg && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <span>{refreshMsg}</span>
        </div>
      )}

      {/* Filter and Search */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-center gap-4">
        {/* Stock Type Filter */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">銘柄タイプ:</span>
          <select
            value={stockType}
            onChange={(e) => setStockType(e.target.value as any)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
          >
            <option value="すべて">すべて</option>
            <option value="日本株">日本株</option>
            <option value="米国株">米国株</option>
          </select>
        </div>

        {/* Search Query */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="銘柄名・コードで検索（例: 9101, AAPL）"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
          />
        </div>
      </div>

      {/* Stock Cards (Accordions) */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : groupedStocks.length === 0 ? (
        <div className="bg-white p-12 text-center rounded-2xl border border-slate-200 text-slate-400 text-sm">
          条件に一致する銘柄が見つかりませんでした。
        </div>
      ) : (
        <div className="space-y-4">
          {groupedStocks.map((stock) => {
            const isOpen = Boolean(openTickers[stock.ticker_code]);
            const totalSum = stock.total_tokutei + stock.total_nisa;
            const unitLabel = stock.currency === 'JPY' ? '円' : 'USD';

            return (
              <div
                key={stock.ticker_code}
                className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden transition"
              >
                {/* Accordion Header */}
                <div
                  onClick={() => toggleAccordion(stock.ticker_code)}
                  className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 cursor-pointer hover:bg-slate-50/50 select-none transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 font-bold flex items-center justify-center text-sm border border-blue-100 flex-shrink-0">
                      {stock.currency === 'JPY' ? 'JP' : 'US'}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-base font-bold text-slate-900">{stock.ticker_name}</h3>
                        <span className="text-xs font-mono font-semibold text-slate-400">
                          ({stock.ticker_code})
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        配当履歴: {stock.records.length}件
                      </div>
                    </div>
                  </div>

                  {/* Summary metrics */}
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block">特定口座 累計</span>
                      <span className="text-sm font-bold text-slate-700">
                        ¥ {stock.total_tokutei.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-slate-400 block">NISA口座 累計</span>
                      <span className="text-sm font-bold text-slate-700">
                        ¥ {stock.total_nisa.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-right pr-2">
                      <span className="text-xs text-blue-600 font-semibold block">合計受取額</span>
                      <span className="text-base font-extrabold text-slate-900">
                        ¥ {totalSum.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </div>
                  </div>
                </div>

                {/* Accordion Content */}
                {isOpen && (
                  <div className="border-t border-slate-100 p-5 space-y-4 bg-slate-50/30">
                    {/* Status & Add button bar */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                      {/* Dividend Status Badge */}
                      {stock.last_check_status ? (
                        <div
                          className="px-4 py-2 rounded-xl text-white text-xs font-bold shadow-sm flex items-center gap-2"
                          style={{ backgroundColor: stock.last_check_color || '#4b5563' }}
                        >
                          <span className="px-1.5 py-0.5 rounded bg-black/20 text-[11px]">
                            {stock.last_check_status}
                          </span>
                          <span>{stock.last_check_info}</span>
                        </div>
                      ) : (
                        <div className="text-xs text-slate-400">配当状況データ未取得</div>
                      )}

                      <button
                        onClick={() => {
                          setSelectedRecord({
                            ticker_code: stock.ticker_code,
                            ticker_name: stock.ticker_name,
                            currency: stock.currency,
                          });
                          setModalOpen(true);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-sm transition active:scale-95"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>配当金データを追加</span>
                      </button>
                    </div>

                    {/* History Cards List */}
                    <div className="grid grid-cols-1 gap-3">
                      {stock.records.map((r) => {
                        const mTotal = (r.amount_tokutei || 0) + (r.amount_nisa || 0);
                        const unitVal =
                          stock.currency === 'JPY' ? r.dividend_unit_jpy : r.dividend_unit_usd;

                        return (
                          <div
                            key={r.id}
                            className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm space-y-3"
                          >
                            {/* Card Header */}
                            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                              <div className="flex items-center gap-2">
                                <span className="text-base font-bold text-slate-900">
                                  {r.year}年{r.month}月
                                </span>
                                <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                                  配当単価: {unitVal} {unitLabel}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-xs text-slate-400 mr-2">合計受取額:</span>
                                <span className="text-base font-extrabold text-blue-700">
                                  ¥ {mTotal.toLocaleString()}
                                </span>
                              </div>
                            </div>

                            {/* Account Breakdown */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                <span className="font-bold text-slate-700 block mb-1">【特定口座】</span>
                                <div className="flex justify-between text-slate-600">
                                  <span>保有株数: {r.shares_tokutei?.toLocaleString()} 株</span>
                                  <span className="font-semibold">受取金額: ¥ {r.amount_tokutei?.toLocaleString()}</span>
                                </div>
                              </div>

                              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                <span className="font-bold text-slate-700 block mb-1">【NISA口座】</span>
                                <div className="flex justify-between text-slate-600">
                                  <span>保有株数: {r.shares_nisa?.toLocaleString()} 株</span>
                                  <span className="font-semibold">受取金額: ¥ {r.amount_nisa?.toLocaleString()}</span>
                                </div>
                              </div>
                            </div>

                            {/* Actions (Edit / Delete) */}
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                onClick={() => {
                                  setSelectedRecord(r);
                                  setModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                                <span>編集</span>
                              </button>
                              <button
                                onClick={() => {
                                  setRecordToDelete(r);
                                  setDeleteModalOpen(true);
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 transition"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>削除</span>
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Dividend Modal */}
      {modalOpen && (
        <DividendModal
          isOpen={modalOpen}
          initialData={selectedRecord}
          onClose={() => {
            setModalOpen(false);
            setSelectedRecord(null);
          }}
          onSuccess={() => {
            setModalOpen(false);
            setSelectedRecord(null);
            loadData();
          }}
        />
      )}

      {/* Delete Confirm Modal */}
      {deleteModalOpen && recordToDelete && (
        <ConfirmModal
          isOpen={deleteModalOpen}
          title="配当金レコードの削除"
          message={`【${recordToDelete.ticker_name || recordToDelete.ticker_code}】${recordToDelete.year}年${recordToDelete.month}月の配当金データを削除しますか？この操作は取り消せません。`}
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

