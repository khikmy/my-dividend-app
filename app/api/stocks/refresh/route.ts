import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchStockData } from '@/lib/yahooFinance';
import { Stock } from '@/types/database';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { ticker_code } = body;

    let stocksToUpdate: Stock[] = [];

    if (ticker_code) {
      const { data, error } = await supabase
        .from('stocks')
        .select('*')
        .eq('ticker_code', ticker_code);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      stocksToUpdate = data || [];
    } else {
      const { data, error } = await supabase.from('stocks').select('*');
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      stocksToUpdate = data || [];
    }

    if (stocksToUpdate.length === 0) {
      return NextResponse.json({ message: 'No stocks found to update', count: 0 });
    }

    const now = new Date().toISOString();
    const results: { ticker_code: string; status: string; color: string; info: string }[] = [];
    let priceCount = 0;
    let priceErrorMsg: string | null = null;

    // Yahooの制限(429)を避けるため、同時に処理する銘柄数は控えめにする
    const CONCURRENCY = 5;
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < stocksToUpdate.length) {
        const stock = stocksToUpdate[nextIndex++];
        const { dividend, prices } = await fetchStockData(stock.ticker_code, stock.currency);
        const { status, color, info } = dividend;

        // 配当状況と株価推移を1回の更新で保存する(株価が取れなかった銘柄は前回値を残す)
        const { error: updateError } = await supabase
          .from('stocks')
          .update({
            last_check_status: status,
            last_check_color: color,
            last_check_info: info,
            updated_at: now,
            ...(prices && {
              price_current: prices.current,
              price_1m: prices.price_1m,
              price_3m: prices.price_3m,
              price_6m: prices.price_6m,
              price_1y: prices.price_1y,
              price_updated_at: now,
            }),
          })
          .eq('ticker_code', stock.ticker_code);

        if (updateError) {
          // 株価の列が未作成(supabase/stock_prices.sql 未実行)の場合もここに来る
          priceErrorMsg = updateError.message;
          continue;
        }
        results.push({ ticker_code: stock.ticker_code, status, color, info });
        if (prices) priceCount++;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, stocksToUpdate.length) }, worker));

    return NextResponse.json({
      success: true,
      updated_at: now,
      count: results.length,
      price_count: priceCount,
      price_error: priceErrorMsg,
      data: results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

