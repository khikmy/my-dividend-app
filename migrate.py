import httpx
import pandas as pd

# --- 設定（既存のものを利用してください） ---
SUPABASE_URL = "https://jushuxfkluesdatkruxn.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1c2h1eGZrbHVlc2RhdGtydXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMDQ1MjYsImV4cCI6MjA4NzU4MDUyNn0.FsZ18VbBnG8aBocSEXzCWjwKCjZHAnkqyMGrBAcRiL4" 

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates" # 重複時に上書きする設定
}

OLD_API_URL = f"{SUPABASE_URL}/rest/v1/dividends"
STOCKS_API_URL = f"{SUPABASE_URL}/rest/v1/stocks"
RECORDS_API_URL = f"{SUPABASE_URL}/rest/v1/dividend_records"

def migrate_data():
    with httpx.Client() as client:
        # 1. 旧テーブルから全データを取得
        print("旧データを取得中...")
        res = client.get(OLD_API_URL, headers=HEADERS)
        old_data = res.json()
        if not old_data:
            print("データが見つかりませんでした。")
            return
        
        df = pd.DataFrame(old_data)

        # 2. stocksテーブル（銘柄マスター）のデータを作成
        # ticker_codeで重複を除去して最新のステータス情報を残す
        print("銘柄マスターを移行中...")
        stocks_df = df[[
            "ticker_code", "ticker_name", "currency", 
            "last_check_status", "last_check_color", "last_check_info", "updated_at"
        ]].drop_duplicates(subset="ticker_code")
        
        stocks_payload = stocks_df.to_dict(orient="records")
        # upsert (conflict時は更新)
        res_s = client.post(STOCKS_API_URL, headers=HEADERS, json=stocks_payload)
        res_s.raise_for_status()
        print(f"銘柄マスター: {len(stocks_payload)}件 完了")

        # 3. dividend_recordsテーブル（履歴）のデータを作成
        print("配当受取履歴を移行中...")
        records_df = df[[
            "ticker_code", "year", "month", 
            "dividend_unit_jpy", "dividend_unit_usd", 
            "shares_tokutei", "amount_tokutei", 
            "shares_nisa", "amount_nisa"
        ]]
        
        records_payload = records_df.to_dict(orient="records")
        res_r = client.post(RECORDS_API_URL, headers=HEADERS, json=records_payload)
        res_r.raise_for_status()
        print(f"配当受取履歴: {len(records_payload)}件 完了")

        print("\n✨ 全ての移行が完了しました！")

if __name__ == "__main__":
    migrate_data()