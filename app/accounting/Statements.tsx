'use client';

import { JournalRow, Statements, yen } from '@/lib/accounting';
import IncomeTrend from './IncomeTrend';

type Line = { name: string; amount: number };

// 固定資産(投資その他の資産)に表示する科目。これ以外の資産は流動資産
const INVESTMENT_ASSETS = ['敷金・保証金', '敷金', '保証金', '差入保証金'];
const COST_OF_SALES = '仕入高';
const OWNER_DRAW = '事業主貸';
const OWNER_LOAN = '事業主借';

const sum = (l: Line[]) => l.reduce((t, x) => t + x.amount, 0);
const num = (n: number) => n.toLocaleString('ja-JP');

/** 見出し行(科目の区分と合計)。他の画面の残高表と同じ見た目 */
function GroupRow({ label, amount }: { label: string; amount?: number }) {
  return (
    <div className="flex items-center justify-between gap-2 bg-slate-50 font-semibold px-3 py-2 border-t border-slate-200 first:border-t-0">
      <span>{label}</span>
      <span className="tabular-nums">{amount != null ? num(amount) : ''}</span>
    </div>
  );
}

function LeafRow({ label, amount, indent = 1 }: { label: string; amount: number; indent?: 1 | 2 }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-1.5">
      <span className={`${indent === 2 ? 'pl-8' : 'pl-4'} font-medium`}>{label}</span>
      <span className="tabular-nums">{num(amount)}</span>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="border border-slate-200 rounded-lg overflow-hidden text-sm">{children}</div>;
}

function Empty() {
  return <p className="text-sm text-slate-400 border border-slate-200 rounded-lg px-3 py-2">該当する科目はありません</p>;
}

function Total({ label, amount, strong }: { label: string; amount: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between border border-slate-200 rounded-lg bg-slate-50 text-sm px-3 py-2 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{num(amount)}</span>
    </div>
  );
}

function BalanceSheet({ st }: { st: Statements }) {
  const draw = st.assets.filter((a) => a.name === OWNER_DRAW);
  const invest = st.assets.filter((a) => INVESTMENT_ASSETS.includes(a.name));
  const current = st.assets.filter((a) => a.name !== OWNER_DRAW && !INVESTMENT_ASSETS.includes(a.name));
  const loan = st.liabilities.filter((a) => a.name === OWNER_LOAN);
  const currentLiab = st.liabilities.filter((a) => a.name !== OWNER_LOAN);
  const capital = sum(st.equity) + st.netIncome;
  const liabAndCapital = st.totalLiabilities + capital;

  return (
    <section className="space-y-3">
      <h2 className="font-semibold border-l-4 border-blue-400 pl-2">貸借対照表</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm text-slate-500">資産の部</p>
          {st.assets.length === 0 ? (
            <Empty />
          ) : (
            <Card>
              {current.length > 0 && <GroupRow label="流動資産" amount={sum(current)} />}
              {current.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
              {invest.length > 0 && <GroupRow label="固定資産（投資その他の資産）" amount={sum(invest)} />}
              {invest.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
              {draw.length > 0 && <GroupRow label="事業主貸" amount={sum(draw)} />}
              {draw.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
            </Card>
          )}
          <Total label="資産の部合計" amount={st.totalAssets} strong />
        </div>

        <div className="space-y-2">
          <p className="text-sm text-slate-500">負債の部</p>
          {st.liabilities.length === 0 ? (
            <Empty />
          ) : (
            <Card>
              {currentLiab.length > 0 && <GroupRow label="流動負債" amount={sum(currentLiab)} />}
              {currentLiab.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
              {loan.length > 0 && <GroupRow label="事業主借" amount={sum(loan)} />}
              {loan.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
            </Card>
          )}
          <Total label="負債の部合計" amount={st.totalLiabilities} />

          <p className="text-sm text-slate-500 pt-2">資本の部</p>
          <Card>
            <GroupRow label="資本の部" amount={capital} />
            {st.equity.map((a) => <LeafRow key={a.name} label={a.name} amount={a.amount} />)}
            <LeafRow label="控除前所得金額" amount={st.netIncome} />
          </Card>
          <Total label="資本の部合計" amount={capital} />
          <Total label="負債・資本の部合計" amount={liabAndCapital} strong />
        </div>
      </div>
      {st.totalAssets !== liabAndCapital && (
        <p className="text-xs text-amber-700">
          貸借が一致していません（差額 {yen(Math.abs(st.totalAssets - liabAndCapital))}）。年初の繰越仕訳（元入金）が未登録か、科目が未設定の仕訳がある可能性があります。
        </p>
      )}
    </section>
  );
}

const th = 'text-left font-normal text-slate-500 px-3 py-1.5 border-b border-slate-200';
const td = 'px-3 py-1.5 border-b border-slate-100';

function ProfitAndLoss({ st }: { st: Statements }) {
  const cost = st.expenses.filter((e) => e.name === COST_OF_SALES);
  const costTotal = sum(cost);
  const expenses = st.expenses.filter((e) => e.name !== COST_OF_SALES);
  const gross = st.totalRevenue - costTotal;
  const afterExpense = gross - sum(expenses);

  // 金額列は「内訳」「集計」の2列
  const Section = ({ label }: { label: string }) => (
    <tr className="bg-slate-50 font-semibold">
      <td className={td} colSpan={3}>{label}</td>
    </tr>
  );
  const Row = ({ label, inner, total, bold }: { label: string; inner?: number; total?: number; bold?: boolean }) => (
    <tr className={bold ? 'font-semibold' : ''}>
      <td className={`${td} pl-7`}>{label}</td>
      <td className={`${td} text-right tabular-nums w-36`}>{inner != null ? num(inner) : ''}</td>
      <td className={`${td} text-right tabular-nums w-36`}>{total != null ? num(total) : ''}</td>
    </tr>
  );

  return (
    <section className="space-y-3">
      <h2 className="font-semibold border-l-4 border-blue-400 pl-2">損益計算書</h2>
      <div className="border border-slate-200 rounded-lg overflow-x-auto overflow-y-hidden">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr>
              <th className={th}>科目</th>
              <th className={`${th} text-right`}>内訳</th>
              <th className={`${th} text-right`}>金額</th>
            </tr>
          </thead>
          <tbody>
            <Section label="売上高" />
            <Row label="売上（収入）金額" inner={st.totalRevenue} total={st.totalRevenue} />
            <Section label="売上原価" />
            <Row label="小計" inner={costTotal} />
            <Row label="売上原価" total={costTotal} />
            <Row label="差引金額" total={gross} />
            <Section label="経費" />
            {expenses.map((e) => (
              <Row key={e.name} label={e.name} inner={e.amount} />
            ))}
            <Row label="計" total={sum(expenses)} />
            <Row label="差引金額" total={afterExpense} />
            <Section label="繰戻額等" />
            <Row label="繰戻額等" total={0} />
            <Section label="繰入額等" />
            <Row label="繰入額等" total={0} />
            <Section label="控除前所得金額" />
            <Row label="控除前所得金額" total={st.netIncome} bold />
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 貸借対照表・損益計算書(青色申告決算書に近い構成) */
export default function StatementsView({ st, rows, year }: { st: Statements; rows: JournalRow[]; year: number }) {
  return (
    <div className="space-y-8">
      <IncomeTrend rows={rows} year={year} />
      <BalanceSheet st={st} />
      <ProfitAndLoss st={st} />
    </div>
  );
}
