export interface Stock {
  ticker_code: string;
  ticker_name: string;
  currency: 'JPY' | 'USD';
  last_check_status?: string | null;
  last_check_color?: string | null;
  last_check_info?: string | null;
  updated_at?: string | null;
}

export interface DividendRecord {
  id?: number;
  ticker_code: string;
  year: number;
  month: number;
  dividend_unit_jpy: number;
  dividend_unit_usd: number;
  shares_tokutei: number;
  amount_tokutei: number;
  shares_nisa: number;
  amount_nisa: number;
  created_at?: string;
  // Join stocks
  stocks?: Stock | Stock[];
  // Flattened fields for convenience
  ticker_name?: string;
  currency?: 'JPY' | 'USD';
  last_check_status?: string | null;
  last_check_color?: string | null;
  last_check_info?: string | null;
  updated_at?: string | null;
}

export interface ForeignCurrencyRecord {
  currency: string;
  amount: number;
  rate?: number | null;
  jpy?: number | null;
  updated_at?: string | null;
}

export interface TaxSimulation {
  year: number;
  sales: number;
  expenses: number;
  national_pension: number;
  health_insurance: number;
  ideco: number;
  donation_deduction: number;
  medical_deduction: number;
  updated_at?: string | null;
}

