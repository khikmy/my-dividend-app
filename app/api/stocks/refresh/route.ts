import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { checkDividendStatus } from '@/lib/yahooFinance';
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
    const results = [];

    for (const stock of stocksToUpdate) {
      const { status, color, info } = await checkDividendStatus(
        stock.ticker_code,
        stock.currency
      );

      const { error: updateError } = await supabase
        .from('stocks')
        .update({
          last_check_status: status,
          last_check_color: color,
          last_check_info: info,
          updated_at: now,
        })
        .eq('ticker_code', stock.ticker_code);

      if (!updateError) {
        results.push({
          ticker_code: stock.ticker_code,
          status,
          color,
          info,
        });
      }
    }

    return NextResponse.json({
      success: true,
      updated_at: now,
      count: results.length,
      data: results,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

