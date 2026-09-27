'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Calendar,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { DividendRecord } from '@/types/database';
import StockList from '@/components/StockList';

const COLORS = [
  '#2563eb', '#3b82f6', '#60a5fa', '#93c5fd', '#0d9488',
  '#14b8a6', '#2dd4bf', '#f59e0b', '#fbbf24', '#ec4899',
  '#8b5cf6', '#6366f1', '#10b981', '#64748b'
];

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'dividend' | 'stocks'>('dividend');

  // Data states
  const [dividends, setDividends] = useState<DividendRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Filter states
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<string>('すべて');
  const [selectedType, setSelectedType] = useState<'すべて' | '日本株' | '米国株'>('すべて');
  const [selectedStock, setSelectedStock] = useState<string>('すべて');

  // Load all data
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      try {
        // 1. Dividend records with joined stocks
        const { data: divData } = await supabase
          .from('dividend_records')
          .select('*, stocks(*)');

        if (divData) {
          const flat = divData.map((d: any) => {
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
              dividend_unit_jpy: Number(d.dividend_unit_jpy || 0),
              dividend_unit_usd: Number(d.dividend_unit_usd || 0),
            };
          });
          setDividends(flat);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Derived: available years
  const availableYears = useMemo(() => {
    const yearsSet = new Set(dividends.map((d) => d.year));
    if (yearsSet.size === 0) yearsSet.add(new Date().getFullYear());
    return Array.from(yearsSet).sort((a, b) => b - a);
  }, [dividends]);

  // Ensure selectedYear is valid
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0]);
    }
  }, [availableYears, selectedYear]);

  // Filtered stocks list for dropdown
  const stockOptions = useMemo(() => {
    let list = dividends;
    if (selectedType === '日本株') list = list.filter((d) => d.currency === 'JPY');
    if (selectedType === '米国株') list = list.filter((d) => d.currency === 'USD');
    const names = Array.from(new Set(list.map((d) => d.ticker_name || d.ticker_code)));
    return ['すべて', ...names.sort()];
  }, [dividends, selectedType]);

  // Filtered dataset for dividend summary
  const { currentTotal, prevTotal, diff, filteredRecords } = useMemo(() => {
    let base = dividends.map((d) => ({
      ...d,
      total_jpy: (d.amount_tokutei || 0) + (d.amount_nisa || 0),
    }));

    if (selectedType === '日本株') base = base.filter((d) => d.currency === 'JPY');
    if (selectedType === '米国株') base = base.filter((d) => d.currency === 'USD');
    if (selectedStock !== 'すべて') {
      base = base.filter((d) => (d.ticker_name || d.ticker_code) === selectedStock);
    }

    let cur = 0;
    let prev = 0;
    let filtered: typeof base = [];

    if (selectedMonth !== 'すべて') {
      const m = parseInt(selectedMonth.replace('月', ''), 10);
      filtered = base.filter((d) => d.year === selectedYear && d.month === m);
      cur = filtered.reduce((acc, d) => acc + d.total_jpy, 0);
      const prevFiltered = base.filter((d) => d.year === selectedYear - 1 && d.month === m);
      prev = prevFiltered.reduce((acc, d) => acc + d.total_jpy, 0);
    } else {
      filtered = base.filter((d) => d.year === selectedYear);
      cur = filtered.reduce((acc, d) => acc + d.total_jpy, 0);
      const prevFiltered = base.filter((d) => d.year === selectedYear - 1);
      prev = prevFiltered.reduce((acc, d) => acc + d.total_jpy, 0);
    }

    return {
      currentTotal: cur,
      prevTotal: prev,
      diff: cur - prev,
      filteredRecords: filtered,
    };
  }, [dividends, selectedYear, selectedMonth, selectedType, selectedStock]);

  // Monthly breakdown chart data (1-12)
  const monthlyChartData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `${i + 1}月`,
      monthNum: i + 1,
      total: 0,
    }));
    filteredRecords.forEach((d) => {
      const idx = d.month - 1;
      if (idx >= 0 && idx < 12) {
        months[idx].total += (d.amount_tokutei || 0) + (d.amount_nisa || 0);
      }
    });
    return months;
  }, [filteredRecords]);

  // Portfolio distribution (group by stock name)
  const portfolioData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredRecords.forEach((d) => {
      const name = d.ticker_name || d.ticker_code;
      const val = (d.amount_tokutei || 0) + (d.amount_nisa || 0);
      map[name] = (map[name] || 0) + val;
    });
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRecords]);

  // Ranking Top 10
  const top10Ranking = useMemo(() => {
    return portfolioData.slice(0, 10);
  }, [portfolioData]);

  // Pie chart data: top N stocks + rest grouped into "その他" to keep slices readable
  const PIE_TOP_N = 10;
  const portfolioPieData = useMemo(() => {
    if (portfolioData.length <= PIE_TOP_N) return portfolioData;
    const top = portfolioData.slice(0, PIE_TOP_N);
    const otherValue = portfolioData
      .slice(PIE_TOP_N)
      .reduce((sum, d) => sum + d.value, 0);
    return [...top, { name: 'その他', value: otherValue }];
  }, [portfolioData]);

  const portfolioPieTotal = useMemo(
    () => portfolioPieData.reduce((sum, d) => sum + d.value, 0),
    [portfolioPieData]
  );

  // Status counts (増配 / 減配 / 維持 / 新規)
  const statusCounts = useMemo(() => {
    let base = dividends;
    if (selectedType === '日本株') base = base.filter((d) => d.currency === 'JPY');
    if (selectedType === '米国株') base = base.filter((d) => d.currency === 'USD');

    const prevYear = selectedYear - 1;
    const prevMap: Record<string, number> = {};
    base
      .filter((d) => d.year === prevYear)
      .forEach((d) => {
        const key = `${d.ticker_name || d.ticker_code}_${d.month}`;
        const unit = d.currency === 'JPY' ? d.dividend_unit_jpy : d.dividend_unit_usd;
        prevMap[key] = unit;
      });

    let inc = 0,
      dec = 0,
      stay = 0,
      newCnt = 0;

    const currentYearStocks = Array.from(
      new Set(filteredRecords.map((d) => d.ticker_name || d.ticker_code))
    );

    currentYearStocks.forEach((stock) => {
      const stockRecords = filteredRecords.filter(
        (d) => (d.ticker_name || d.ticker_code) === stock
      );
      if (stockRecords.length === 0) return;

      let targetMonth =
        selectedMonth === 'すべて'
          ? Math.max(...stockRecords.map((d) => d.month))
          : parseInt(selectedMonth.replace('月', ''), 10);

      const targetRec = stockRecords.find((d) => d.month === targetMonth);
      if (!targetRec) return;

      const tVal =
        targetRec.currency === 'JPY'
          ? targetRec.dividend_unit_jpy
          : targetRec.dividend_unit_usd;

      const monthsToCheck = [
        targetMonth,
        targetMonth === 1 ? 12 : targetMonth - 1,
        targetMonth === 12 ? 1 : targetMonth + 1,
      ];

      let pVal: number | undefined;
      for (const m of monthsToCheck) {
        const key = `${stock}_${m}`;
        if (prevMap[key] !== undefined) {
          pVal = prevMap[key];
          break;
        }
      }

      if (pVal === undefined) {
        newCnt++;
      } else if (tVal > pVal) {
        inc++;
      } else if (tVal < pVal) {
        dec++;
      } else {
        stay++;
      }
    });

    return { inc, dec, stay, newCnt };
  }, [dividends, filteredRecords, selectedYear, selectedMonth, selectedType]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('dividend')}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px flex items-center gap-2 ${
            activeTab === 'dividend'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>配当金ダッシュボード</span>
        </button>
        <button
          onClick={() => setActiveTab('stocks')}
          className={`px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px flex items-center gap-2 ${
            activeTab === 'stocks'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <span>保有銘柄一覧</span>
        </button>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: DIVIDEND DASHBOARD */}
      {/* ========================================================= */}
      {activeTab === 'dividend' && (
        <div className="space-y-6">
          {/* Filters Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">表示する年</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {availableYears.map((y) => (
                  <option key={y} value={y}>
                    {y}年
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">表示する月</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="すべて">すべて</option>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={`${i + 1}月`}>
                    {i + 1}月
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">銘柄タイプ</label>
              <select
                value={selectedType}
                onChange={(e) => {
                  setSelectedType(e.target.value as any);
                  setSelectedStock('すべて');
                }}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="すべて">すべて</option>
                <option value="日本株">日本株</option>
                <option value="米国株">米国株</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">特定銘柄</label>
              <select
                value={selectedStock}
                onChange={(e) => setSelectedStock(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {stockOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* KPI Card */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-500">
              {selectedYear}年{selectedMonth !== 'すべて' ? selectedMonth : ''} 配当金受取総額（
              {selectedStock !== 'すべて' ? selectedStock : selectedType}）
            </h3>
            <div className="flex flex-wrap items-baseline gap-4 mt-2">
              <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                ¥ {currentTotal.toLocaleString()}
              </span>
              {availableYears.includes(selectedYear - 1) && (
                <span
                  className={`inline-flex items-center text-sm font-bold px-2.5 py-1 rounded-full ${
                    diff >= 0
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-rose-50 text-rose-600'
                  }`}
                >
                  {diff >= 0 ? (
                    <TrendingUp className="w-4 h-4 mr-1" />
                  ) : (
                    <TrendingDown className="w-4 h-4 mr-1" />
                  )}
                  {diff >= 0 ? '+' : ''}
                  {diff.toLocaleString()} 円 ({selectedMonth !== 'すべて' ? '前年同月比' : '前年比'})
                </span>
              )}
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Bar Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-blue-600" />
                <span>{selectedYear}年 月別配当金受取推移</span>
              </h3>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <XAxis dataKey="month" tickLine={false} axisLine={{ stroke: '#e2e8f0' }} textAnchor="middle" />
                    <YAxis
                      tickFormatter={(val) => `¥${(val / 1000).toLocaleString()}k`}
                      tickLine={false}
                      axisLine={{ stroke: '#e2e8f0' }}
                    />
                    <Tooltip
                      formatter={(val: number) => [`¥ ${val.toLocaleString()}`, '受取額']}
                      contentStyle={{
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                      }}
                    />
                    <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Portfolio Distribution Pie Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
              <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
                <PieChart className="w-4 h-4 text-blue-600" />
                <span>ポートフォリオ銘柄構成比</span>
              </h3>
              {portfolioData.length > 0 ? (
                <>
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={portfolioPieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={95}
                          paddingAngle={2}
                        >
                          {portfolioPieData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.name === 'その他' ? '#cbd5e1' : COLORS[index % COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: number, name: string) => {
                            const percent = portfolioPieTotal > 0 ? ((val / portfolioPieTotal) * 100).toFixed(1) : '0.0';
                            return [`¥ ${val.toLocaleString()} (${percent}%)`, name];
                          }}
                          contentStyle={{
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-2">
                    {portfolioPieData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: entry.name === 'その他' ? '#cbd5e1' : COLORS[index % COLORS.length] }}
                        />
                        <span>{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-72 flex items-center justify-center text-sm text-slate-400">
                  該当データがありません
                </div>
              )}
            </div>
          </div>

          {/* Status Counts Metric Cards */}
          <div>
            <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
              <span>配当金ステータス状況</span>
              <span className="text-xs font-normal text-slate-400">
                (前年同月比較)
              </span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="text-xs font-semibold text-emerald-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  増配
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{statusCounts.inc} <small className="text-xs font-normal text-slate-500">銘柄</small></div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="text-xs font-semibold text-rose-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  減配
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{statusCounts.dec} <small className="text-xs font-normal text-slate-500">銘柄</small></div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                  維持
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{statusCounts.stay} <small className="text-xs font-normal text-slate-500">銘柄</small></div>
              </div>
              <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="text-xs font-semibold text-amber-600 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                  新規
                </div>
                <div className="text-2xl font-bold text-slate-900 mt-1">{statusCounts.newCnt} <small className="text-xs font-normal text-slate-500">銘柄</small></div>
              </div>
            </div>
          </div>

          {/* Ranking Top 10 */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
            <h3 className="text-sm font-bold text-slate-700 mb-4">
              {selectedYear}年 配当金受取額ランキング TOP10
            </h3>
            {top10Ranking.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {top10Ranking.map((item, idx) => (
                  <div
                    key={item.name}
                    className="flex items-center justify-between p-3.5 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                          idx === 0
                            ? 'bg-amber-400 text-white'
                            : idx === 1
                            ? 'bg-slate-300 text-slate-700'
                            : idx === 2
                            ? 'bg-amber-600 text-white'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="text-sm font-semibold text-slate-800">{item.name}</span>
                    </div>
                    <span className="text-sm font-bold text-slate-900">
                      ¥ {item.value.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-slate-400 py-4 text-center">
                該当する配当金データがありません
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: STOCK LIST */}
      {/* ========================================================= */}
      {activeTab === 'stocks' && <StockList />}
    </div>
  );
}

