// SBI証券・楽天証券の配当金CSVを dividend_records 用の月次データに変換する。
// amount_* は税引き後(円)、gross_* は税引き前(円)。
import { BrokerDetail, DividendRecord } from '@/types/database';

export const BROKERS = {
  SBI: { label: 'SBI証券', hint: '「分配金履歴」CSV(DISTRIBUTION_…csv)' },
  RAKUTEN: { label: '楽天証券', hint: '「配当・分配金」CSV(dividendlist_…csv)' },
} as const;
export type BrokerKind = keyof typeof BROKERS;

// 国内の源泉税(所得税15.315% + 住民税5%)と、米国株の現地課税(10%)
const JP_TAX = 0.20315;
const US_TAX = 0.1;
// 税引き後 → 税引き前 の逆算に使う手取り率
const NET_RATE = {
  tokutei: { JPY: 1 - JP_TAX, USD: (1 - US_TAX) * (1 - JP_TAX) },
  nisa: { JPY: 1, USD: 1 - US_TAX },
} as const;

type Account = 'tokutei' | 'nisa';
type Currency = 'JPY' | 'USD';

interface Payment {
  year: number;
  month: number;
  account: Account;
  ticker: string;
  name: string;
  currency: Currency;
  shares: number;
  net: number;
  gross: number;
  estimated: boolean;
  /** 配当金単価(JPY/USDは銘柄通貨)。取れない場合は0 */
  unit: number;
}

export interface ImportGroup {
  key: string;
  ticker: string;
  name: string;
  currency: Currency;
  year: number;
  month: number;
  unit: number;
  detail: BrokerDetail;
}

export interface DividendImportResult {
  groups: ImportGroup[];
  paymentCount: number;
}

const num = (s: string | undefined) => Number((s ?? '').replace(/,/g, '')) || 0;
const DATE_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/;
const accountOf = (s: string | undefined): Account =>
  /NISA|ニーサ/i.test((s ?? '').normalize('NFKC')) ? 'nisa' : 'tokutei';

/** SBI証券「分配金履歴」: 受渡日, 口座, 商品, 銘柄名(末尾に銘柄コード), 数量, 金額(税引後・円) */
function parseSbi(csvRows: string[][]): Payment[] {
  const out: Payment[] = [];
  for (const r of csvRows) {
    const m = (r[0] ?? '').match(DATE_RE);
    if (!m || r.length < 6) continue;
    const label = (r[3] ?? '').normalize('NFKC').trim();
    const sp = label.match(/^(.*\S)\s+(\S+)$/);
    const name = sp ? sp[1] : label;
    const ticker = sp ? sp[2] : label;
    const currency: Currency = /米国/.test(r[2] ?? '') || /^[A-Za-z][A-Za-z.\-]*$/.test(ticker) ? 'USD' : 'JPY';
    const account = accountOf(r[1]);
    const net = Math.round(num(r[5]));
    out.push({
      year: Number(m[1]),
      month: Number(m[2]),
      account,
      ticker,
      name,
      currency,
      shares: num(r[4]),
      net,
      // この明細には税額がないため、口座と通貨ごとの税率から逆算する
      gross: Math.round(net / NET_RATE[account][currency]),
      estimated: account === 'tokutei' || currency === 'USD',
      unit: 0,
    });
  }
  return out;
}

/**
 * 楽天証券「配当金・分配金一覧」(ヘッダー行はタイトルの次):
 * 0入金日, 1商品, 2口座, 3銘柄コード, 4銘柄, 5受取通貨, 6単価, 7数量, 8合計(税引前,現地通貨),
 * 9外国税額(円), 10為替レート, 11表示レート, 12国内の税額(円), 13受取金額(税引後,現地通貨)
 */
function parseRakuten(csvRows: string[][]): Payment[] {
  const out: Payment[] = [];
  for (const r of csvRows) {
    const m = (r[0] ?? '').match(DATE_RE);
    if (!m || r.length < 14) continue;
    const currency: Currency = /ドル|USD/i.test((r[5] ?? '').normalize('NFKC')) ? 'USD' : 'JPY';
    const grossLocal = num(r[8]);
    // 米国株は表示レートで円換算(税額の計算に使われているレート)
    const gross = currency === 'USD' ? Math.round(grossLocal * num(r[11])) : Math.round(grossLocal);
    const net = currency === 'USD' ? gross - num(r[9]) - num(r[12]) : Math.round(num(r[13]));
    out.push({
      year: Number(m[1]),
      month: Number(m[2]),
      account: accountOf(r[2]),
      ticker: (r[3] ?? '').normalize('NFKC').trim(),
      name: (r[4] ?? '').normalize('NFKC').trim(),
      currency,
      shares: num(r[7]),
      net,
      gross,
      estimated: false,
      unit: num(r[6]),
    });
  }
  return out;
}

const emptyDetail = (): BrokerDetail => ({
  net_tokutei: 0,
  net_nisa: 0,
  gross_tokutei: 0,
  gross_nisa: 0,
  shares_tokutei: 0,
  shares_nisa: 0,
  gross_estimated: false,
});

/** CSV行を (銘柄, 年, 月) ごとの月次データにまとめる。同月に複数回の入金があれば合算する */
export function buildDividendImport(csvRows: string[][], broker: BrokerKind): DividendImportResult {
  const payments = broker === 'SBI' ? parseSbi(csvRows) : parseRakuten(csvRows);
  const map = new Map<string, ImportGroup>();
  for (const p of payments) {
    if (!p.ticker) continue;
    const key = `${p.ticker}|${p.year}|${p.month}`;
    let g = map.get(key);
    if (!g) {
      g = { key, ticker: p.ticker, name: p.name, currency: p.currency, year: p.year, month: p.month, unit: 0, detail: emptyDetail() };
      map.set(key, g);
    }
    const d = g.detail;
    d[`net_${p.account}`] += p.net;
    d[`gross_${p.account}`] += p.gross;
    // 株数は同じ保有分に対する入金が複数回あっても二重に数えない
    d[`shares_${p.account}`] = Math.max(d[`shares_${p.account}`], p.shares);
    if (p.estimated) d.gross_estimated = true;
    if (p.unit > 0) g.unit = p.unit;
  }
  return {
    groups: [...map.values()].sort((a, b) => a.year - b.year || a.month - b.month || a.ticker.localeCompare(b.ticker)),
    paymentCount: payments.length,
  };
}

export interface ImportPlanItem {
  group: ImportGroup;
  existing?: DividendRecord;
  /** dividend_records に書き込む内容(銘柄コード・年・月を含む) */
  payload: Record<string, unknown>;
  action: 'insert' | 'update';
  /** 証券会社の取込履歴がない既存レコード(手入力)を置き換えるか */
  replacesManual: boolean;
}

const sum = (details: BrokerDetail[], f: keyof BrokerDetail) =>
  details.reduce((acc, d) => acc + (Number(d[f]) || 0), 0);

/**
 * 取込結果を既存の dividend_records に反映するための書き込み内容を作る。
 * 証券会社ごとの内訳(broker_detail)を保持し、同じ証券会社の再取込は置き換え、別の証券会社の分は合算する。
 */
export function planImport(groups: ImportGroup[], existing: DividendRecord[], broker: BrokerKind): ImportPlanItem[] {
  const byKey = new Map(existing.map((r) => [`${r.ticker_code}|${r.year}|${r.month}`, r]));
  return groups.map((group) => {
    const ex = byKey.get(group.key);
    const manual = !!ex && !ex.broker_detail;
    const details: Record<string, BrokerDetail> = { ...(ex?.broker_detail ?? {}), [broker]: group.detail };
    const all = Object.values(details);

    const payload: Record<string, unknown> = {
      ticker_code: group.ticker,
      year: group.year,
      month: group.month,
      broker_detail: details,
    };
    for (const acc of ['tokutei', 'nisa'] as const) {
      const keepManual = manual && group.detail[`net_${acc}`] === 0 && (ex![`amount_${acc}`] || 0) > 0;
      if (keepManual) continue; // 手入力の口座分は、CSVに該当口座の入金がなければそのまま残す
      payload[`amount_${acc}`] = sum(all, `net_${acc}`);
      payload[`gross_${acc}`] = sum(all, `gross_${acc}`);
      payload[`shares_${acc}`] = sum(all, `shares_${acc}`);
    }

    // 配当金単価: 楽天は明細の値、SBIは明細にないため新規または未設定のときだけ推定値を入れる
    const unitKey = group.currency === 'JPY' ? 'dividend_unit_jpy' : 'dividend_unit_usd';
    if (group.unit > 0) payload[unitKey] = group.unit;
    else if (group.currency === 'JPY' && !(ex?.[unitKey] ?? 0)) {
      const d = group.detail;
      const est = d.shares_nisa > 0 ? d.gross_nisa / d.shares_nisa : d.shares_tokutei > 0 ? d.gross_tokutei / d.shares_tokutei : 0;
      if (est > 0) payload[unitKey] = Math.round(est * 10) / 10;
    }
    if (!ex) {
      payload.dividend_unit_jpy ??= 0;
      payload.dividend_unit_usd ??= 0;
    }
    return { group, existing: ex, payload, action: ex ? 'update' : 'insert', replacesManual: manual };
  });
}

/** 税引き後(円)から税引き前(円)を逆算する。gross が保存されていればそれを優先 */
export function grossOf(
  d: Pick<DividendRecord, 'amount_tokutei' | 'gross_tokutei' | 'currency'>
): number {
  if (d.gross_tokutei != null) return Number(d.gross_tokutei);
  return (d.amount_tokutei || 0) / NET_RATE.tokutei[d.currency === 'USD' ? 'USD' : 'JPY'];
}
