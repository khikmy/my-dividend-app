export interface Stock {
  ticker_code: string;
  ticker_name: string;
  currency: 'JPY' | 'USD';
  last_check_status?: string | null;
  last_check_color?: string | null;
  last_check_info?: string | null;
  updated_at?: string | null;
}

/** 証券会社1社分の月次配当(取込結果)。税引き後=net、税引き前=gross(円) */
export interface BrokerDetail {
  net_tokutei: number;
  net_nisa: number;
  gross_tokutei: number;
  gross_nisa: number;
  shares_tokutei: number;
  shares_nisa: number;
  /** 税引き前が税率からの逆算(推定)か。楽天の明細は実額 */
  gross_estimated: boolean;
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
  // 税引き前(円)。CSV取込で保存。null/未設定なら税引き後からの逆算で代用する
  gross_tokutei?: number | null;
  gross_nisa?: number | null;
  broker_detail?: Record<string, BrokerDetail> | null;
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

