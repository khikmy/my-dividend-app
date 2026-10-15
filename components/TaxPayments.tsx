'use client';

import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { TaxRow, buildTaxTabData } from '@/lib/budget';
import StatCard, { yen } from '@/components/StatCard';

const YEAR_RANGE_START = 2020;

export default function TaxPayments() {
  const now = new Date();
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = YEAR_RANGE_START; y <= now.getFullYear() + 1; y++) arr.push(y);
    return arr;
  }, []);

  const [year, setYear] = useState<number>(now.getFullYear());
  const [taxRows, setTaxRows] = useState<TaxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const [taxEditMode, setTaxEditMode] = useState(false);
  const [editPension, setEditPension] = useState('');
  const [editShaken, setEditShaken] = useState('');
  const [editJuuminzei, setEditJuuminzei] = useState('');
  const [savingTax, setSavingTax] = useState(false);
  const [shakenBreakdownOpen, setShakenBreakdownOpen] = useState(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), Math.max(1800, Math.min(6000, msg.length * 90)));
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('tax_annual').select('*');
      if (error) throw error;
      setTaxRows(data || []);
    } catch (err) {
      console.error('Failed to load tax data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setTaxEditMode(false);
  }, [year]);

  const taxData = useMemo(() => buildTaxTabData(year, taxRows), [year, taxRows]);

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

  const calendarRows = taxData.schedule.slice(0, 12);
  const pensionCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.pension), 0);
  const kenpoCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.shakaihoken), 0);
  const juuCalendarTotal = calendarRows.reduce((s, r) => s + Number(r.juuminzei), 0);
  const shakaihokenGroupTotal = pensionCalendarTotal + kenpoCalendarTotal;
  const grandTotal = shakaihokenGroupTotal + juuCalendarTotal;

  return (
    <div className="space-y-6">
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm flex items-center justify-center gap-3 flex-wrap">
        <label className="text-sm font-bold text-slate-700">対象年</label>
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
      </div>

      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      ) : (
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
          <div className="overflow-x-auto overflow-y-hidden"><table className="w-full text-sm min-w-[520px]">
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
          </table></div>
        </div>
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
