// マネーフォワード等の仕訳帳CSV(Shift_JIS)を JournalRow に変換する。
import { CAPITAL, JournalRow, isKnownAccount } from './accounting';

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
  const rows: JournalRow[] = [];
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
    rows.push({
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
