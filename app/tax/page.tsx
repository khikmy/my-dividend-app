'use client';

import { useState } from 'react';
import TaxPayments from '@/components/TaxPayments';
import TaxSimulation from '@/components/TaxSimulation';

const TABS = [
  { key: 'payments', label: '支払い状況' },
  { key: 'simulation', label: '確定申告シミュレーション' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function TaxPage() {
  const [activeTab, setActiveTab] = useState<Tab>('payments');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">税金</h1>

      <div className="flex border-b border-slate-200 overflow-x-auto whitespace-nowrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-3 sm:px-5 py-3 text-sm font-semibold border-b-2 transition -mb-px flex-shrink-0 ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'payments' && <TaxPayments />}
      {activeTab === 'simulation' && <TaxSimulation />}
    </div>
  );
}
