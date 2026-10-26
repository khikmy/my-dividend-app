export interface DividendStatusResult {
  status: string;
  color: string;
  info: string;
}

export interface PriceHistoryResult {
  current: number;
  price_1m: number | null;
  price_3m: number | null;
  price_6m: number | null;
  price_1y: number | null;
}

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 配当・分割イベント付きの3年分の日次チャートを1回で取得する(配当判定と株価推移の両方に使う)。
 * 429(制限)のときは待って再試行する。失敗時は status にHTTPステータス(通信エラーは 0)を返す
 */
async function fetchChart(symbol: string): Promise<{ data?: any; status?: number }> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?events=div%7Csplit&interval=1d&range=3y`;

  let status = 0;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        cache: 'no-store',
      });
      if (res.ok) return { data: await res.json() };
      status = res.status;
      if (status !== 429) break;
    } catch (err) {
      console.error(`Error fetching chart for ${symbol}:`, err);
      status = 0;
    }
    if (attempt < MAX_RETRIES) await sleep(1000 * (attempt + 1));
  }
  return { status };
}

/** 銘柄1つ分の配当状況と株価推移を、Yahooへの1回の問い合わせで取得する */
export async function fetchStockData(
  tickerCode: string,
  currency: 'JPY' | 'USD'
): Promise<{ dividend: DividendStatusResult; prices: PriceHistoryResult | null }> {
  const symbol = currency === 'JPY' ? `${tickerCode}.T` : tickerCode;
  const { data, status } = await fetchChart(symbol);

  if (!data) {
    const dividend: DividendStatusResult =
      status === 429
        ? { status: '制限中 ⏳', color: 'orange', info: 'Yahoo制限中' }
        : { status: 'エラー', color: 'gray', info: '取得失敗' };
    return { dividend, prices: null };
  }
  return { dividend: analyzeDividend(data, tickerCode, currency), prices: analyzePrices(data, tickerCode) };
}

/** 現在株価と、1ヶ月・3ヶ月・6ヶ月・1年前(直近の営業日終値)の株価を取り出す。失敗時は null */
function analyzePrices(data: any, tickerCode: string): PriceHistoryResult | null {
  try {
    const result = data?.chart?.result?.[0];
    const timestamps: number[] = result?.timestamp ?? [];
    const closes: (number | null)[] = result?.indicators?.quote?.[0]?.close ?? [];

    const series = timestamps
      .map((t, i) => ({ time: t * 1000, close: closes[i] }))
      .filter((p): p is { time: number; close: number } => typeof p.close === 'number');
    if (series.length === 0) return null;

    const current = Number(result?.meta?.regularMarketPrice) || series[series.length - 1].close;

    // 基準日(今日からNヶ月前)以前で最も新しい終値。基準日より前のデータが無ければ null
    const priceBefore = (months: number): number | null => {
      const target = new Date();
      target.setMonth(target.getMonth() - months);
      const targetTime = target.getTime();
      let found: number | null = null;
      for (const p of series) {
        if (p.time <= targetTime) found = p.close;
        else break;
      }
      return found;
    };

    return {
      current,
      price_1m: priceBefore(1),
      price_3m: priceBefore(3),
      price_6m: priceBefore(6),
      price_1y: priceBefore(12),
    };
  } catch (err) {
    console.error(`Error fetching price history for ${tickerCode}:`, err);
    return null;
  }
}

function analyzeDividend(data: any, tickerCode: string, currency: 'JPY' | 'USD'): DividendStatusResult {
  const unit = currency === 'JPY' ? '円' : '＄';

  try {
    const dividendsObj = data?.chart?.result?.[0]?.events?.dividends;

    if (!dividendsObj || Object.keys(dividendsObj).length === 0) {
      return { status: 'データなし', color: 'black', info: '配当履歴なし' };
    }

    // 株式分割(日付と倍率)。Yahooは過去の配当を分割後の基準に換算して返すが、
    // 分割と同日の配当は分割前の基準のままなので、比較前に同じ基準へそろえる
    const splits: { time: number; ratio: number }[] = Object.values(data?.chart?.result?.[0]?.events?.splits ?? {})
      .map((s: any) => ({
        time: Number(s.date || 0),
        ratio: Number(s.denominator) > 0 ? Number(s.numerator) / Number(s.denominator) : 1,
      }))
      .filter((s) => s.ratio > 0);

    // 配当リストを日付順にソート
    const divList: { date: Date; amount: number }[] = Object.values(dividendsObj)
      .map((d: any) => {
        const time = Number(d.date || 0);
        const ratio = splits.filter((s) => Math.abs(s.time - time) < 86400).reduce((acc, s) => acc * s.ratio, 1);
        return { date: new Date(time * 1000), amount: Number(d.amount || 0) / ratio };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (divList.length === 0) {
      return { status: 'データなし', color: 'black', info: '配当履歴なし' };
    }

    const latest = divList[divList.length - 1];
    const latestVal = latest.amount;
    const latestDate = latest.date;

    const targetYear = latestDate.getFullYear() - 1;
    const targetMonth = latestDate.getMonth(); // 0-indexed

    // 前年同月または前後1ヶ月の配当を探す
    let prevCandidates = divList.filter(
      (d) =>
        d.date.getFullYear() === targetYear &&
        d.date.getMonth() === targetMonth
    );

    if (prevCandidates.length === 0) {
      prevCandidates = divList.filter(
        (d) =>
          d.date.getFullYear() === targetYear &&
          Math.abs(d.date.getMonth() - targetMonth) <= 1
      );
    }

    // 日本株は小数点第一位まで、米国株は小数点第三位まで表示
    const decimals = currency === 'JPY' ? 1 : 3;
    const lDisp = latestVal.toFixed(decimals);

    if (prevCandidates.length > 0) {
      const prev = prevCandidates[prevCandidates.length - 1];
      const prevVal = prev.amount;
      const pDisp = prevVal.toFixed(decimals);

      let rateStr = '';
      if (prevVal > 0) {
        const changeRate = ((latestVal - prevVal) / prevVal) * 100;
        rateStr = `(${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(1)}%)`;
      }

      if (latestVal > prevVal) {
        return {
          status: '増配',
          color: '#16a34a', // green-600
          info: `${pDisp}${unit} → ${lDisp}${unit} ${rateStr}`,
        };
      } else if (latestVal < prevVal) {
        return {
          status: '減配',
          color: '#dc2626', // red-600
          info: `${pDisp}${unit} → ${lDisp}${unit} ${rateStr}`,
        };
      } else {
        return {
          status: '維持',
          color: '#4b5563', // gray-600
          info: `${pDisp}${unit} → ${lDisp}${unit} (0.0%)`,
        };
      }
    } else {
      return {
        status: '前年データなし',
        color: '#111827', // gray-900
        info: `最新: ${lDisp}${unit}`,
      };
    }
  } catch (err: any) {
    console.error(`Error checking dividend for ${tickerCode}:`, err);
    return { status: 'エラー', color: 'gray', info: '取得失敗' };
  }
}

