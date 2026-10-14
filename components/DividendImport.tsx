'use client';

import { useMemo, useState } from 'react';
import { Upload, CheckCircle2, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { decodeCsvFile, parseCsv } from '@/lib/accountingImport';
import {
  BROKERS,
  BrokerKind,
  DividendImportResult,
  ImportPlanItem,
  buildDividendImport,
  planImport,
} from '@/lib/dividendImport';
import { DividendRecord } from '@/types/database';

const yen = (n: number) => `¥ ${Math.round(n).toLocaleString()}`;

export default function DividendImport() {
  const [broker, setBroker] = useState<BrokerKind>('SBI');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<DividendImportResult | null>(null);
  const [existing, setExisting] = useState<DividendRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const plan: ImportPlanItem[] = useMemo(
    () => (result ? planImport(result.groups, existing, broker) : []),
    [result, existing, broker]
  );

  const totals = useMemo(() => {
    const t = { netT: 0, grossT: 0, netN: 0, grossN: 0 };
    for (const { group: g } of plan) {
      t.netT += g.detail.net_tokutei;
      t.grossT += g.detail.gross_tokutei;
      t.netN += g.detail.net_nisa;
      t.grossN += g.detail.gross_nisa;
    }
    return t;
  }, [plan]);

  const reset = () => {
    setResult(null);
    setFileName('');
    setMessage(null);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    setResult(null);
    setFileName(file.name);
    try {
      const parsed = buildDividendImport(parseCsv(await decodeCsvFile(file)), broker);
      if (parsed.groups.length === 0) {
        setMessage({ ok: false, text: `${BROKERS[broker].label}の配当金CSVとして読み取れませんでした。証券会社の選択とファイルを確認してください。` });
        return;
      }
      // 該当銘柄の既存レコードを取得して、新規・更新を判定する
      const codes = [...new Set(parsed.groups.map((g) => g.ticker))];
      const { data, error } = await supabase.from('dividend_records').select('*').in('ticker_code', codes);
      if (error) throw new Error(error.message);
      setExisting((data ?? []) as DividendRecord[]);
      setResult(parsed);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message || 'CSVの読み込みに失敗しました' });
    }
  };

  const handleImport = async () => {
    if (!result) return;
    setBusy(true);
    setMessage(null);
    try {
      // 未登録の銘柄は銘柄マスタに追加する(既存の銘柄名は変更しない)
      const codes = plan.map((p) => p.group.ticker);
      const { data: stockRows, error: stockErr } = await supabase.from('stocks').select('ticker_code').in('ticker_code', codes);
      if (stockErr) throw new Error(stockErr.message);
      const known = new Set((stockRows ?? []).map((s: any) => s.ticker_code));
      const newStocks = new Map<string, { ticker_code: string; ticker_name: string; currency: string }>();
      for (const { group: g } of plan) {
        if (!known.has(g.ticker)) newStocks.set(g.ticker, { ticker_code: g.ticker, ticker_name: g.name, currency: g.currency });
      }
      if (newStocks.size > 0) {
        const { error } = await supabase.from('stocks').insert([...newStocks.values()]);
        if (error) throw new Error(error.message);
      }

      const inserts = plan.filter((p) => p.action === 'insert').map((p) => p.payload);
      if (inserts.length > 0) {
        const { error } = await supabase.from('dividend_records').insert(inserts);
        if (error) throw new Error(error.message);
      }
      for (const p of plan.filter((p) => p.action === 'update')) {
        const { error } = await supabase.from('dividend_records').update(p.payload).eq('id', p.existing!.id);
        if (error) throw new Error(error.message);
      }
      setMessage({
        ok: true,
        text: `${BROKERS[broker].label}の配当金を取り込みました(新規${inserts.length}件・更新${plan.length - inserts.length}件)`,
      });
      setResult(null);
      setFileName('');
    } catch (err: any) {
      const hint = /gross_|broker_detail/.test(err.message ?? '')
        ? ' (supabase/dividend_import.sql を SQL Editor で実行してください)'
        : '';
      setMessage({ ok: false, text: `取り込みに失敗しました: ${err.message}${hint}` });
    } finally {
      setBusy(false);
    }
  };

  const hasEstimate = plan.some((p) => p.group.detail.gross_estimated);
  const manualCount = plan.filter((p) => p.replacesManual).length;

  return (
    <div className="space-y-6">
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        <h3 className="text-sm font-bold text-slate-700">配当金CSVの取込</h3>
        <div className="grid grid-cols-2 gap-3 max-w-md">
          {(Object.keys(BROKERS) as BrokerKind[]).map((b) => (
            <button
              key={b}
              type="button"
              onClick={() => {
                setBroker(b);
                reset();
              }}
              className={`py-2 px-4 rounded-xl text-sm font-semibold border transition ${
                broker === b
                  ? 'bg-blue-50 border-blue-600 text-blue-700 shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {BROKERS[b].label}
            </button>
          ))}
        </div>
        <label className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm cursor-pointer transition">
          <Upload className="w-4 h-4" />
          <span>CSVを選択</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {fileName && <span className="ml-3 text-xs text-slate-500">{fileName}</span>}
        <div className="text-xs text-slate-400 leading-relaxed">
          受取額(税引き後)は保有銘柄一覧・ダッシュボードに、税引き前は税金画面のシミュレーションに反映されます。
          同じ証券会社のCSVを再取込すると、該当月の取込分は置き換わります(別の証券会社の分は合算)。
        </div>
      </div>

      {message && (
        <div
          className={`flex items-start gap-2 p-3 text-sm rounded-lg border ${
            message.ok ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200'
          }`}
        >
          {message.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {result && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-700">
              取込プレビュー(入金{result.paymentCount}件 → {plan.length}レコード)
            </h3>
            <button
              onClick={handleImport}
              disabled={busy}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition active:scale-95"
            >
              {busy ? '取込中...' : `${plan.length}件を取り込む`}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-slate-400">特定 税引き後</div>
              <div className="font-bold text-slate-800">{yen(totals.netT)}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-slate-400">特定 税引き前</div>
              <div className="font-bold text-slate-800">{yen(totals.grossT)}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-slate-400">NISA 税引き後</div>
              <div className="font-bold text-slate-800">{yen(totals.netN)}</div>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
              <div className="text-slate-400">NISA 税引き前</div>
              <div className="font-bold text-slate-800">{yen(totals.grossN)}</div>
            </div>
          </div>

          {result.zeroAmountCount > 0 && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              金額を読み取れず0円になる入金が{result.zeroAmountCount}件あります。CSVの形式が想定と違う可能性があるため、このまま取り込む前に内容を確認してください。
            </div>
          )}
          {hasEstimate && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              ※ このCSVには税額がないため、税引き前は税率(国内20.315%・米国10%)からの逆算です(「推定」表示)。実額とは数十円ずれることがあります。
            </div>
          )}
          {manualCount > 0 && (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
              手入力済みの{manualCount}レコードは、CSVに入金がある口座の金額を置き換えます(「手入力を置換」表示)。
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 pr-3">受取月</th>
                  <th className="py-2 pr-3">銘柄</th>
                  <th className="py-2 pr-3 text-right">特定 税引後</th>
                  <th className="py-2 pr-3 text-right">特定 税引前</th>
                  <th className="py-2 pr-3 text-right">NISA 税引後</th>
                  <th className="py-2 pr-3 text-right">NISA 税引前</th>
                  <th className="py-2">状態</th>
                </tr>
              </thead>
              <tbody>
                {plan.map(({ group: g, action, replacesManual }) => {
                  const d = g.detail;
                  return (
                    <tr key={g.key} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{g.year}/{g.month}</td>
                      <td className="py-1.5 pr-3">
                        {g.name} <span className="text-slate-400">{g.ticker}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right">{d.net_tokutei ? yen(d.net_tokutei) : '-'}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {d.gross_tokutei ? yen(d.gross_tokutei) : '-'}
                        {d.gross_tokutei > 0 && d.gross_estimated && <span className="text-amber-600">(推定)</span>}
                      </td>
                      <td className="py-1.5 pr-3 text-right">{d.net_nisa ? yen(d.net_nisa) : '-'}</td>
                      <td className="py-1.5 pr-3 text-right">
                        {d.gross_nisa ? yen(d.gross_nisa) : '-'}
                        {d.gross_nisa > 0 && d.gross_estimated && g.currency === 'USD' && <span className="text-amber-600">(推定)</span>}
                      </td>
                      <td className="py-1.5 whitespace-nowrap">
                        {action === 'insert' ? (
                          <span className="text-emerald-600">新規</span>
                        ) : replacesManual ? (
                          <span className="text-amber-600">手入力を置換</span>
                        ) : (
                          <span className="text-blue-600">更新</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
