import pandas as pd
import httpx
import time

# --- 設定（アプリと同じものを使用） ---
SUPABASE_URL = "https://jushuxfkluesdatkruxn.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp1c2h1eGZrbHVlc2RhdGtydXhuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMDQ1MjYsImV4cCI6MjA4NzU4MDUyNn0.FsZ18VbBnG8aBocSEXzCWjwKCjZHAnkqyMGrBAcRiL4"  # ここを自分のキーに書き換えてください
API_URL = f"{SUPABASE_URL}/rest/v1/dividends"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=minimal"
}

def import_from_excel(file_path):
    # 1. ファイルの読み込み（2行目からデータが始まっている想定）
    # スプレッドシートの列順：年月, 銘柄コード, 銘柄名, 通貨, 単価, 特定株数, 特定受取額, NISA株数, NISA受取額
    df = pd.read_excel(file_path)

    # 2. データのクレンジングと加工
    success_count = 0
    error_count = 0

    print("インポートを開始します...")

    for index, row in df.iterrows():
        try:
            # 年月の分割 (例: "2024/03" -> year: 2024, month: 3)
            date_str = str(row['年月'])
            year, month = map(int, date_str.split('/'))

            # 通貨の判定
            currency = "USD" if "USD" in str(row['単価']) else "JPY"
            
            # 数値変換（¥やUSDなどの文字、カンマを除去）
            def clean_num(val):
                if pd.isna(val): return 0.0
                s = str(val).replace('¥', '').replace('USD', '').replace(',', '').strip()
                return float(s) if s else 0.0

            div_unit = clean_num(row['単価'])
            
            # データベース用辞書の作成
            payload = {
                "ticker_code": str(row['銘柄コード']),
                "ticker_name": str(row['銘柄名']),
                "year": year,
                "month": month,
                "dividend_unit_jpy": div_unit if currency == "JPY" else 0.0,
                "dividend_unit_usd": div_unit if currency == "USD" else 0.0,
                "shares_tokutei": int(row['特定口座（保有株数）']),
                "amount_tokutei": clean_num(row['特定口座（受取金額）']),
                "shares_nisa": int(row['NISA口座（保有株数）']),
                "amount_nisa": clean_num(row['NISA口座（受取金額）']),
                "currency": currency
            }

            # 3. API経由で送信
            with httpx.Client() as client:
                response = client.post(API_URL, headers=HEADERS, json=payload)
                response.raise_for_status()
                print(f"[{index+1}] 成功: {payload['ticker_name']} ({year}/{month})")
                success_count += 1
            
            # サーバー負荷軽減のためわずかに待機
            time.sleep(0.1)

        except Exception as e:
            print(f"[{index+1}] エラー: {e}")
            error_count += 1

    print(f"\n完了！ 成功: {success_count}件, 失敗: {error_count}件")

if __name__ == "__main__":
    import_from_excel("dividend_data.xlsx")