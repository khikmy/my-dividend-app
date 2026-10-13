-- 配当金CSV取込(SBI証券・楽天証券)用の列追加。Supabase の SQL Editor で実行してください。
-- amount_tokutei / amount_nisa は従来どおり「税引き後(円)」。税引き前は以下の列に保存します。
alter table dividend_records add column if not exists gross_tokutei numeric;   -- 特定口座の税引き前(円)。null=未取込(逆算で代用)
alter table dividend_records add column if not exists gross_nisa numeric;      -- NISA口座の税引き前(円)
alter table dividend_records add column if not exists broker_detail jsonb;     -- 証券会社別の取込内訳(再取込で置換するため)
