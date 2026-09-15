export interface DividendStatusResult {
  status: string;
  color: string;
  info: string;
}

export async function checkDividendStatus(
  tickerCode: string,
  currency: 'JPY' | 'USD'
): Promise<DividendStatusResult> {
  const symbol = currency === 'JPY' ? `${tickerCode}.T` : tickerCode;
  const unit = currency === 'JPY' ? '円' : '＄';

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
      symbol
    )}?events=div&interval=1mo&range=3y`;

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      if (res.status === 429) {
        return { status: '制限中 ⏳', color: 'orange', info: 'Yahoo制限中' };
      }
      return { status: 'エラー', color: 'gray', info: '取得失敗' };
    }

    const data = await res.json();
    const dividendsObj = data?.chart?.result?.[0]?.events?.dividends;

    if (!dividendsObj || Object.keys(dividendsObj).length === 0) {
      return { status: 'データなし', color: 'black', info: '配当履歴なし' };
    }

    // 配当リストを日付順にソート
    const divList: { date: Date; amount: number }[] = Object.values(dividendsObj)
      .map((d: any) => ({
        date: new Date((d.date || 0) * 1000),
        amount: Number(d.amount || 0),
      }))
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

