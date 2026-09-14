import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchJpyRate, COUNTRY_TO_CURRENCY } from '@/lib/forex';

export async function POST() {
  try {
    const { data: records, error } = await supabase
      .from('foreignCurrency_records')
      .select('*');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!records || records.length === 0) {
      return NextResponse.json({ message: 'No currency records found', count: 0 });
    }

    const now = new Date().toISOString();
    const updatedList = [];

    for (const record of records) {
      const rate = await fetchJpyRate(record.currency);
      if (rate !== null) {
        const jpy = Math.round(record.amount * rate);
        const { error: updateError } = await supabase
          .from('foreignCurrency_records')
          .update({
            rate,
            jpy,
            updated_at: now,
          })
          .eq('currency', record.currency);

        if (!updateError) {
          updatedList.push({ currency: record.currency, rate, jpy });
        }
      }
    }

    return NextResponse.json({
      success: true,
      updated_at: now,
      updatedCount: updatedList.length,
      data: updatedList,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Unknown error' }, { status: 500 });
  }
}

