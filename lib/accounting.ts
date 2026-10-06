// 会計(経費管理)機能のロジック。仕訳データから貸借対照表・損益計算書・残高を組み立てる純粋関数群。

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

const names = (type: AccountType, list: string[]) => list.map((name) => ({ name, type }));

export const ACCOUNTS: { name: string; type: AccountType }[] = [
  ...names('asset', ['現金', '普通預金', '当座預金', '定期預金', '売掛金', '未収入金', '前払金', '立替金', '仮払金', '敷金・保証金', '敷金', '保証金', '差入保証金']),
  ...names('liability', ['未払金', '買掛金', '預り金', '仮受金', '前受金', '借入金', '未払費用']),
  ...names('equity', ['元入金', '事業主貸', '事業主借']),
  ...names('revenue', ['売上高', '雑収入', '受取利息']),
  ...names('expense', [
    '租税公課', '荷造運賃', '水道光熱費', '旅費交通費', '通信費', '広告宣伝費', '接待交際費', '損害保険料', '修繕費',
    '消耗品費', '減価償却費', '福利厚生費', '給料賃金', '外注費', '地代家賃', '会議費', '新聞図書費', '支払手数料',
    '諸会費', '研修費', '車両費', '事務用品費', '仕入高', '利子割引料', '雑費',
  ]),
];

export const CAPITAL = '元入金';
export const RECONCILE_ACCOUNTS = ['現金', '普通預金', '売掛金', '未払金', '預り金'];

export const isKnownAccount = (name: string): boolean => ACCOUNTS.some((a) => a.name === name);

// 未登録の科目(取込データ由来など)は費用として扱う
export const accountType = (name: string): AccountType => ACCOUNTS.find((a) => a.name === name)?.type ?? 'expense';

export interface JournalRow {
  id?: number;
  group_id: string;
  entry_date: string; // YYYY-MM-DD
  description: string;
  debit_account: string | null;
  debit_sub?: string | null;
  debit_amount: number;
  credit_account: string | null;
  credit_sub?: string | null;
  credit_amount: number;
  kind: 'normal' | 'carryover';
}

export const yearOf = (r: JournalRow) => Number(r.entry_date.slice(0, 4));

type Sums = Record<string, { debit: number; credit: number }>;

/** 科目ごとの借方・貸方の合計 */
export function sumByAccount(rows: JournalRow[]): Sums {
  const m: Sums = {};
  const get = (a: string) => (m[a] ??= { debit: 0, credit: 0 });
  for (const r of rows) {
    if (r.debit_account) get(r.debit_account).debit += Number(r.debit_amount);
    if (r.credit_account) get(r.credit_account).credit += Number(r.credit_amount);
  }
  return m;
}

/** 補助科目単位の借方・貸方合計。キーは「科目\t補助科目」 */
export function sumByAccountSub(rows: JournalRow[]): Sums {
  const m: Sums = {};
  const get = (a: string, sub?: string | null) => (m[`${a}\t${sub ?? ''}`] ??= { debit: 0, credit: 0 });
  for (const r of rows) {
    if (r.debit_account) get(r.debit_account, r.debit_sub).debit += Number(r.debit_amount);
    if (r.credit_account) get(r.credit_account, r.credit_sub).credit += Number(r.credit_amount);
  }
  return m;
}

/** 残高(資産・費用は借方プラス、負債・純資産・収益は貸方プラス) */
export function balanceFor(type: AccountType, s: { debit: number; credit: number }): number {
  return type === 'asset' || type === 'expense' ? s.debit - s.credit : s.credit - s.debit;
}

export function balanceOf(sums: Sums, name: string): number {
  return balanceFor(accountType(name), sums[name] ?? { debit: 0, credit: 0 });
}

export interface Statements {
  assets: { name: string; amount: number }[];
  liabilities: { name: string; amount: number }[];
  equity: { name: string; amount: number }[];
  revenues: { name: string; amount: number }[];
  expenses: { name: string; amount: number }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  totalRevenue: number;
  totalExpense: number;
  netIncome: number;
}

export function buildStatements(yearRows: JournalRow[]): Statements {
  const sums = sumByAccount(yearRows);
  // 登録済み科目 + 取込などで増えた未登録科目
  const allNames = [...ACCOUNTS.map((a) => a.name), ...Object.keys(sums).filter((n) => !isKnownAccount(n))];
  const pick = (t: AccountType) =>
    allNames
      .filter((n) => accountType(n) === t)
      .map((name) => ({ name, amount: balanceOf(sums, name) }))
      .filter((a) => a.amount !== 0);
  const total = (l: { amount: number }[]) => l.reduce((s, a) => s + a.amount, 0);

  const assets = pick('asset');
  const liabilities = pick('liability');
  const revenues = pick('revenue');
  const expenses = pick('expense');
  const totalRevenue = total(revenues);
  const totalExpense = total(expenses);
  const netIncome = totalRevenue - totalExpense;
  // 事業主貸は借方残高になるため、純資産(貸方−借方)では自然にマイナス表示になる
  const equity = pick('equity');
  const totalEquity = total(equity) + netIncome;

  return {
    assets,
    liabilities,
    equity,
    revenues,
    expenses,
    totalAssets: total(assets),
    totalLiabilities: total(liabilities),
    totalEquity,
    totalRevenue,
    totalExpense,
    netIncome,
  };
}

/**
 * 繰越仕訳を作る。年末の資産・負債の残高(補助科目単位)を翌年1/1付で引き継ぎ、差額を元入金とする。
 * (当期純利益・事業主貸借は元入金に吸収される)
 */
export function buildCarryover(yearRows: JournalRow[], toYear: number, groupId: string): JournalRow[] {
  const sums = sumByAccountSub(yearRows);
  const base = { group_id: groupId, entry_date: `${toYear}-01-01`, kind: 'carryover' as const };
  const desc = `${toYear - 1}年からの繰越`;
  const out: JournalRow[] = [];
  for (const [key, v] of Object.entries(sums)) {
    const [name, sub] = key.split('\t');
    const type = accountType(name);
    if (type !== 'asset' && type !== 'liability') continue;
    const bal = balanceFor(type, v);
    if (bal === 0) continue;
    const abs = Math.abs(bal);
    // 資産(正残)・負債(負残)は借方側、負債(正残)・資産(負残)は貸方側
    const debitSide = (type === 'asset') === bal > 0;
    out.push(
      debitSide
        ? { ...base, description: desc, debit_account: name, debit_sub: sub || null, debit_amount: abs, credit_account: CAPITAL, credit_sub: null, credit_amount: abs }
        : { ...base, description: desc, debit_account: CAPITAL, debit_sub: null, debit_amount: abs, credit_account: name, credit_sub: sub || null, credit_amount: abs }
    );
  }
  return out;
}

export const yen = (n: number) => (n < 0 ? '-' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
