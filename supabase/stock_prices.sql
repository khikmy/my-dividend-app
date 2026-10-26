-- 株価推移(現在値と1ヶ月・3ヶ月・6ヶ月・1年前の株価)用の列追加。Supabase の SQL Editor で実行してください。
-- 「最新株価情報を更新」ボタン押下時に保存されます。推移(%)は画面側で現在値との比較から算出します。
alter table stocks add column if not exists price_current numeric;       -- 現在株価(通貨は銘柄の通貨)
alter table stocks add column if not exists price_1m numeric;            -- 1ヶ月前の株価(終値)
alter table stocks add column if not exists price_3m numeric;            -- 3ヶ月前の株価
alter table stocks add column if not exists price_6m numeric;            -- 6ヶ月前の株価
alter table stocks add column if not exists price_1y numeric;            -- 1年前の株価
alter table stocks add column if not exists price_updated_at timestamptz; -- 株価の最終更新日時
