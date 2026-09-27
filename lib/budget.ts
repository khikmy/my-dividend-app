// 資産管理(家計簿)機能のロジック。GASアプリ(Code.gs)から移植。
// Supabaseの4テーブル(budget_items / expense_items / income_records / tax_annual)の
// 全行データを受け取り、画面表示用データを組み立てる純粋関数群。

export interface Category {
  region: string;
  label: string;
  match?: string;
}

export const CATEGORIES: Category[] = [
  { region: '引き落とし金額', label: '奨学金' },
  { region: '引き落とし金額', label: 'MBAカード' },
  { region: '引き落とし金額', label: 'AGPカード' },
  { region: '引き落とし金額', label: 'VIEWカード' },
  { region: '引き落とし金額', label: 'NLカード' },
  { region: '引き落とし金額', label: 'エポスカード' },
  { region: '引き落とし金額', label: '税金等' },
  { region: '引き落とし金額', label: '現金' },
  { region: '投資・貯金額', label: 'NISA積立投資' },
  { region: '投資・貯金額', label: 'iDeCo' },
  { region: '投資・貯金額', label: '個別株' },
  { region: '投資・貯金額', label: '貯金' },
  { region: '共有口座', label: '入金額', match: '入金' },
  { region: '共有口座', label: '支出額', match: '支出' },
];

export const REGIONS = ['引き落とし金額', '投資・貯金額', '共有口座'] as const;

export const TAX_CONFIG = {
  PENSION_MONTH: 4,
};

// 累計プール金の起点(この月の498,208円を「集計開始前からの繰越分」として加算する)
export const POOL_START_MONTH_KEY = '2026-01';
export const INITIAL_POOL_ADJUSTMENT = 498208;

const MAX_LOOKBACK_MONTHS = 240;

export interface BudgetRow {
  id?: number;
  month_key: string;
  region: string;
  label: string;
  amount: number;
}

export interface ExpenseRow {
  id?: number;
  month_key: string;
  region: string;
  label: string;
  amount: number;
}

export interface IncomeRow {
  id?: number;
  month_key: string;
  amount: number;
}

export interface TaxRow {
  id?: number;
  year: number;
  pension_annual: number;
  shakaihoken_annual: number;
  juuminzei_annual: number;
}

export function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split('-');
  return { year: Number(y), month: Number(m) };
}

export function toMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function shiftMonthKey(monthKey: string, deltaMonths: number): string {
  const { year, month } = parseMonthKey(monthKey);
  const total = year * 12 + (month - 1) + deltaMonths;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toMonthKey(y, m);
}

export function monthKeyToDisplayLabel(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  return `${year}年${month}月`;
}

export function isTaxCategory(cat: Category): boolean {
  return cat.region === '引き落とし金額' && cat.label === '税金等';
}

function matchCategoryRow<T extends { region: string; label: string }>(
  rows: T[],
  cat: Category
): T | undefined {
  return rows.find((r) => {
    if (r.region !== cat.region) return false;
    if (cat.match) return r.label.indexOf(cat.match) !== -1;
    return r.label === cat.label;
  });
}

/* ============================================================
 * 税金(国民年金・社会保険料・住民税の月別支払いスケジュール)
 * ============================================================ */

export interface TaxScheduleMonth {
  label: string;
  year: number;
  pension: number;
  shakaihoken: number;
  juuminzei: number;
  total: number;
}

function getTaxRowForYear(rows: TaxRow[], year: number): TaxRow | undefined {
  return rows.find((r) => r.year === year);
}

function getTaxYearRawData(taxRows: TaxRow[], year: number) {
  const row = getTaxRowForYear(taxRows, year);
  return {
    pensionAnnual: row ? Number(row.pension_annual) : 0,
    shakaihokenAnnual: row ? Number(row.shakaihoken_annual) : 0,
    juuminzeiAnnual: row ? Number(row.juuminzei_annual) : 0,
  };
}

/**
 * 月別の支払いスケジュールを計算する。
 * - 国民年金: 指定した月(pensionMonth、対象年内)に年額を一括で計上する。
 * - 社会保険料: 当年6月〜翌年3月の10ヶ月に分割。端数は初月(6月)に加算する。
 * - 住民税(普通徴収): 年4回(6月・8月・10月・翌年1月)に分割。端数は初回(6月)に加算する。
 * 対象年の1月〜翌年3月までの15ヶ月分を返す。
 */
export function computeTaxSchedule(
  year: number,
  pensionAnnual: number,
  pensionMonth: number,
  shakaihokenAnnual: number,
  juuminzeiAnnual: number
): TaxScheduleMonth[] {
  const shakenBase = Math.floor(shakaihokenAnnual / 10 / 10) * 10;
  const shakenRemainder = shakaihokenAnnual - shakenBase * 10;
  const shakenFirst = shakenBase + shakenRemainder;

  const juuBase = Math.floor(juuminzeiAnnual / 4 / 1000) * 1000;
  const juuRemainder = juuminzeiAnnual - juuBase * 4;
  const juuFirst = juuBase + juuRemainder;

  const months: TaxScheduleMonth[] = [];
  for (let i = 0; i < 15; i++) {
    const m = (i % 12) + 1;
    const y = year + Math.floor(i / 12);

    const pension = y === year && m === pensionMonth ? pensionAnnual : 0;

    let shaken = 0;
    if (i >= 5 && i <= 14) {
      shaken = i === 5 ? shakenFirst : shakenBase;
    }

    let juuminzei = 0;
    if (i === 5) juuminzei = juuFirst;
    else if (i === 7 || i === 9 || i === 12) juuminzei = juuBase;

    months.push({
      label: `${m}月`,
      year: y,
      pension,
      shakaihoken: shaken,
      juuminzei,
      total: pension + shaken + juuminzei,
    });
  }

  return months;
}

/** 指定した「対象月」に計上される税金(国民年金+社会保険料+住民税)の合計額を返す */
export function computeTaxMonthTotal(taxRows: TaxRow[], monthKey: string): number {
  const { year: y, month: m } = parseMonthKey(monthKey);

  const cur = getTaxYearRawData(taxRows, y);
  const prev = getTaxYearRawData(taxRows, y - 1);

  const curSchedule = computeTaxSchedule(
    y,
    cur.pensionAnnual,
    TAX_CONFIG.PENSION_MONTH,
    cur.shakaihokenAnnual,
    cur.juuminzeiAnnual
  );
  const prevSchedule = computeTaxSchedule(
    y - 1,
    prev.pensionAnnual,
    TAX_CONFIG.PENSION_MONTH,
    prev.shakaihokenAnnual,
    prev.juuminzeiAnnual
  );

  function findAmt(schedule: TaxScheduleMonth[]): number {
    const label = `${m}月`;
    const entry = schedule.find((e) => e.year === y && e.label === label);
    return entry ? entry.total : 0;
  }

  return findAmt(curSchedule) + findAmt(prevSchedule);
}

export interface TaxTabData {
  year: number;
  pensionAnnual: number;
  pensionMonth: number;
  shakaihokenAnnual: number;
  juuminzeiAnnual: number;
  schedule: TaxScheduleMonth[];
}

/**
 * 表示するスケジュールは「対象年1月〜翌年3月」の15ヶ月分。
 * うち1〜3月分は、社会保険料・住民税が前年から繰り越されるため前年データから計算した該当月を反映する。
 */
export function buildTaxTabData(year: number, taxRows: TaxRow[]): TaxTabData {
  const raw = getTaxYearRawData(taxRows, year);
  const prevRaw = getTaxYearRawData(taxRows, year - 1);

  const curSchedule = computeTaxSchedule(
    year,
    raw.pensionAnnual,
    TAX_CONFIG.PENSION_MONTH,
    raw.shakaihokenAnnual,
    raw.juuminzeiAnnual
  );
  const prevSchedule = computeTaxSchedule(
    year - 1,
    prevRaw.pensionAnnual,
    TAX_CONFIG.PENSION_MONTH,
    prevRaw.shakaihokenAnnual,
    prevRaw.juuminzeiAnnual
  );

  const schedule = prevSchedule.slice(12, 15).concat(curSchedule.slice(3, 15));

  return {
    year,
    pensionAnnual: raw.pensionAnnual,
    pensionMonth: TAX_CONFIG.PENSION_MONTH,
    shakaihokenAnnual: raw.shakaihokenAnnual,
    juuminzeiAnnual: raw.juuminzeiAnnual,
    schedule,
  };
}

/* ============================================================
 * 予算タブ
 * ============================================================ */

export interface BudgetTabItem {
  region: string;
  label: string;
  amount: number;
}

export interface BudgetTabData {
  monthLabel: string;
  monthKey: string;
  income: number;
  items: BudgetTabItem[];
}

export function buildBudgetTabData(
  monthKey: string,
  budgetRows: BudgetRow[],
  incomeRows: IncomeRow[],
  taxRows: TaxRow[]
): BudgetTabData {
  const currentBudgetRows = budgetRows.filter((r) => r.month_key === monthKey);

  const items: BudgetTabItem[] = CATEGORIES.map((cat) => {
    if (isTaxCategory(cat)) {
      return { region: cat.region, label: cat.label, amount: computeTaxMonthTotal(taxRows, monthKey) };
    }
    const match = matchCategoryRow(currentBudgetRows, cat);
    return { region: cat.region, label: cat.label, amount: match ? Number(match.amount) : 0 };
  });

  const incomeRow = incomeRows.find((r) => r.month_key === monthKey);

  return {
    monthLabel: monthKeyToDisplayLabel(monthKey),
    monthKey,
    income: incomeRow ? Number(incomeRow.amount) : 0,
    items,
  };
}

/* ============================================================
 * 支出タブ
 * ============================================================ */

export interface ExpenseTabItem {
  region: string;
  label: string;
  amount: number;
  budget: number;
  balance: number;
  isDefault: boolean;
}

export interface ExpenseTabData {
  monthLabel: string;
  monthKey: string;
  income: number;
  items: ExpenseTabItem[];
  hasAnyDefault: boolean;
}

export function buildExpenseTabData(
  monthKey: string,
  budgetRows: BudgetRow[],
  expenseRows: ExpenseRow[],
  incomeRows: IncomeRow[],
  taxRows: TaxRow[]
): ExpenseTabData {
  const budgetTab = buildBudgetTabData(monthKey, budgetRows, incomeRows, taxRows);
  const currentExpenseRows = expenseRows.filter((r) => r.month_key === monthKey);

  const items: ExpenseTabItem[] = CATEGORIES.map((cat) => {
    const budgetItem = budgetTab.items.find((b) => b.region === cat.region && b.label === cat.label);
    const budgetAmount = budgetItem ? Number(budgetItem.amount) : 0;

    const expenseRow = matchCategoryRow(currentExpenseRows, cat);
    const hasRow = !!expenseRow;
    const amount = hasRow ? Number(expenseRow!.amount) : budgetAmount;

    return {
      region: cat.region,
      label: cat.label,
      amount,
      budget: budgetAmount,
      balance: budgetAmount - amount,
      isDefault: !hasRow,
    };
  });

  return {
    monthLabel: monthKeyToDisplayLabel(monthKey),
    monthKey,
    income: budgetTab.income,
    items,
    hasAnyDefault: items.some((i) => i.isDefault),
  };
}

/* ============================================================
 * ダッシュボード
 * ============================================================ */

export interface MonthTotals {
  income: number;
  totalExpense: number;
  totalBudget: number;
  items: { region: string; label: string; amount: number; budget: number; isDefault: boolean }[];
}

function computeMonthTotals(
  monthKey: string,
  budgetRows: BudgetRow[],
  expenseRows: ExpenseRow[],
  incomeRows: IncomeRow[],
  taxRows: TaxRow[]
): MonthTotals {
  function incomeForMonth(key: string): number {
    let k = key;
    for (let i = 0; i <= MAX_LOOKBACK_MONTHS; i++) {
      const row = incomeRows.find((r) => r.month_key === k);
      if (row) return Number(row.amount);
      k = shiftMonthKey(k, -1);
    }
    return 0;
  }

  function budgetItemsForMonth(key: string): BudgetTabItem[] {
    let k = key;
    for (let i = 0; i <= MAX_LOOKBACK_MONTHS; i++) {
      const rows = budgetRows.filter((r) => r.month_key === k);
      if (rows.length > 0) {
        return CATEGORIES.map((cat) => {
          const m = matchCategoryRow(rows, cat);
          return { region: cat.region, label: cat.label, amount: m ? Number(m.amount) : 0 };
        });
      }
      k = shiftMonthKey(k, -1);
    }
    return CATEGORIES.map((cat) => ({ region: cat.region, label: cat.label, amount: 0 }));
  }

  const budgetItems = budgetItemsForMonth(monthKey);

  const taxIdx = budgetItems.findIndex((b) => b.region === '引き落とし金額' && b.label === '税金等');
  if (taxIdx !== -1) {
    budgetItems[taxIdx] = { region: '引き落とし金額', label: '税金等', amount: computeTaxMonthTotal(taxRows, monthKey) };
  }

  const eRows = expenseRows.filter((r) => r.month_key === monthKey);

  const items = CATEGORIES.map((cat, i) => {
    const m = matchCategoryRow(eRows, cat);
    const budgetAmount = budgetItems[i].amount;
    return {
      region: cat.region,
      label: cat.label,
      amount: m ? Number(m.amount) : budgetAmount,
      budget: budgetAmount,
      isDefault: !m,
    };
  });

  const income = incomeForMonth(monthKey);

  function sumBy(field: 'amount' | 'budget', filterFn: (i: (typeof items)[number]) => boolean): number {
    return items.filter(filterFn).reduce((s, i) => s + i[field], 0);
  }
  function calcTotal(field: 'amount' | 'budget'): number {
    const withdrawTotal = sumBy(field, (i) => i.region === '引き落とし金額');
    const investTotal = sumBy(field, (i) => i.region === '投資・貯金額' && i.label !== 'NISA積立投資');
    const sharedDeposit = items.find((i) => i.region === '共有口座' && i.label === '入金額');
    const sharedWithdraw = items.find((i) => i.region === '共有口座' && i.label === '支出額');
    const sharedTotal = (sharedDeposit ? sharedDeposit[field] : 0) - (sharedWithdraw ? sharedWithdraw[field] : 0);
    return withdrawTotal + investTotal + sharedTotal;
  }

  return {
    income,
    totalExpense: calcTotal('amount'),
    totalBudget: calcTotal('budget'),
    items,
  };
}

export interface DashboardAccount {
  name: string;
  amount: number;
}

export interface DashboardData {
  monthLabel: string;
  monthKey: string;
  income: number;
  totalExpense: number;
  totalBudget: number;
  balance: number;
  poolThisMonth: number;
  poolTotal: number;
  accounts: DashboardAccount[];
}

export function buildDashboardData(
  monthKey: string,
  budgetRows: BudgetRow[],
  expenseRows: ExpenseRow[],
  incomeRows: IncomeRow[],
  taxRows: TaxRow[]
): DashboardData {
  const current = computeMonthTotals(monthKey, budgetRows, expenseRows, incomeRows, taxRows);

  let poolTotal: number;
  if (monthKey < POOL_START_MONTH_KEY) {
    poolTotal = current.income - current.totalExpense;
  } else {
    poolTotal = INITIAL_POOL_ADJUSTMENT;
    let k = POOL_START_MONTH_KEY;
    while (k <= monthKey) {
      const t = computeMonthTotals(k, budgetRows, expenseRows, incomeRows, taxRows);
      poolTotal += t.income - t.totalExpense;
      k = shiftMonthKey(k, 1);
    }
  }
  const poolThisMonth = current.income - current.totalExpense;

  function getAmt(region: string, label: string): number {
    const it = current.items.find((i) => i.region === region && i.label === label);
    return it ? Number(it.amount) : 0;
  }
  const ideco = getAmt('投資・貯金額', 'iDeCo');
  const kobetsu = getAmt('投資・貯金額', '個別株');
  const chokin = getAmt('投資・貯金額', '貯金');
  const shareDeposit = getAmt('共有口座', '入金額');
  const shareWithdraw = getAmt('共有口座', '支出額');
  const rakuten = Math.max(0, shareDeposit - shareWithdraw);
  const mitsubishi = current.income - ideco - kobetsu - chokin - rakuten;

  return {
    monthLabel: monthKeyToDisplayLabel(monthKey),
    monthKey,
    income: current.income,
    totalExpense: current.totalExpense,
    totalBudget: current.totalBudget,
    balance: current.totalBudget - current.totalExpense,
    poolThisMonth,
    poolTotal,
    accounts: [
      { name: '住信SBIネット銀行', amount: ideco },
      { name: 'SBI証券', amount: kobetsu },
      { name: 'あおぞら銀行', amount: chokin },
      { name: '楽天銀行', amount: rakuten },
      { name: '三菱UFJ銀行', amount: mitsubishi },
    ],
  };
}
