// マネーフォワード等の仕訳帳CSV(Shift_JIS)を JournalRow に変換する。
import { CAPITAL, JournalRow, isKnownAccount, mergeSplitRows } from './accounting';

/** ダブルクォート対応の簡易CSVパーサ */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const endRow = () => {
    row.push(cell);
    cell = '';
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length) endRow();
  return rows;
}

export async function decodeCsvFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // UTF-8として不正(置換文字を含む)ならShift_JISとして読み直す
  return utf8.includes('�') ? new TextDecoder('shift_jis').decode(buf) : utf8;
}

export interface ImportPreview {
  rows: JournalRow[];
  groupCount: number;
  unbalancedGroups: string[];
  unknownAccounts: string[];
  blankAccountRows: number;
  years: number[];
}

// 仕訳帳CSVの列位置(取引No, 取引日, 借方科目, 借方補助, ..., 借方金額, 貸方科目, 貸方補助, ..., 貸方金額, 摘要)
const COL = { no: 0, date: 1, dAcc: 2, dSub: 3, dAmt: 8, cAcc: 9, cSub: 10, cAmt: 15, desc: 16 };
const num = (s: string | undefined) => Number((s ?? '').replace(/,/g, '')) || 0;

export function buildImport(csvRows: string[][]): ImportPreview {
  const body = csvRows.slice(1).filter((r) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(r[COL.date] ?? ''));
  const raw: JournalRow[] = [];
  const unknown = new Set<string>();
  let blankAccountRows = 0;

  for (const r of body) {
    const [y, m, d] = r[COL.date].split('/');
    const debitAmount = num(r[COL.dAmt]);
    const creditAmount = num(r[COL.cAmt]);
    // 金額があるのに科目が空の行は元入金として扱う(開始仕訳の相手科目)
    const fix = (acc: string, amt: number) => {
      if (acc) return acc;
      if (amt > 0) {
        blankAccountRows++;
        return CAPITAL;
      }
      return null;
    };
    const debit = fix(r[COL.dAcc], debitAmount);
    const credit = fix(r[COL.cAcc], creditAmount);
    for (const a of [debit, credit]) if (a && !isKnownAccount(a)) unknown.add(a);
    raw.push({
      group_id: `import-${y}-${r[COL.no]}`,
      entry_date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`,
      description: r[COL.desc] ?? '',
      debit_account: debit,
      debit_sub: r[COL.dSub] || null,
      debit_amount: debitAmount,
      credit_account: credit,
      credit_sub: r[COL.cSub] || null,
      credit_amount: creditAmount,
      kind: 'normal',
    });
  }

  const rows = mergeSplitRows(raw);
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.group_id, (sums.get(r.group_id) ?? 0) + r.debit_amount - r.credit_amount);
  return {
    rows,
    groupCount: sums.size,
    unbalancedGroups: [...sums].filter(([, v]) => v !== 0).map(([k]) => k.replace('import-', '')),
    unknownAccounts: [...unknown],
    blankAccountRows,
    years: [...new Set(rows.map((r) => Number(r.entry_date.slice(0, 4))))].sort(),
  };
}

/** クレジットカード明細CSVの型。取り込む対象を増やすときはここに追加する */
export const CARD_FORMATS = {
  NL: {
    label: 'NLカード',
    group: 'nl',
    creditAccount: '未払金',
    creditSub: 'NL',
    // 明細CSVはヘッダーなし。0列目=利用日、1列目=利用店名、6列目=利用金額
    dateCol: 0,
    descCol: 1,
    amountCol: 6,
  },
} as const;
export type CardKind = keyof typeof CARD_FORMATS;

/**
 * カード明細CSVを仕訳に変換する。日付・金額・利用店名(摘要)を取り込み、借方の科目は未設定、
 * 貸方はカードの未払金とする。取り込んだ行は「要確認」(needs_review)になる。
 * 返金(マイナス金額)は貸借を逆にして、貸方を未設定とする。
 */
export function buildCardImport(csvRows: string[][], kind: CardKind): ImportPreview {
  const f = CARD_FORMATS[kind];
  const seen = new Map<string, number>();
  const rows: JournalRow[] = [];
  for (const r of csvRows) {
    const m = (r[f.dateCol] ?? '').match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
    const amount = num(r[f.amountCol]);
    if (!m || amount === 0) continue;
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    // 同じ日付・金額の明細は出現順で区別し、同じファイルを再度取り込んでも重複しないようにする
    const base = `${f.group}-${date}-${Math.abs(amount)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const abs = Math.abs(amount);
    rows.push({
      group_id: `${base}-${n}`,
      entry_date: date,
      // 全角英数を半角にそろえ、連続する空白を1つにする
      description: (r[f.descCol] ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
      debit_account: amount < 0 ? f.creditAccount : null,
      debit_sub: amount < 0 ? f.creditSub : null,
      debit_amount: amount < 0 ? abs : 0,
      credit_account: amount > 0 ? f.creditAccount : null,
      credit_sub: amount > 0 ? f.creditSub : null,
      credit_amount: amount > 0 ? abs : 0,
      kind: 'normal',
      needs_review: true,
    });
  }
  return {
    rows,
    groupCount: rows.length,
    unbalancedGroups: [],
    unknownAccounts: [],
    blankAccountRows: 0,
    years: [...new Set(rows.map((r) => Number(r.entry_date.slice(0, 4))))].sort(),
  };
}
