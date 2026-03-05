import streamlit as st
import httpx
import pandas as pd

# --- Supabase接続設定 ---
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
API_URL = f"{SUPABASE_URL}/rest/v1/dividend_records"
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json; charset=utf-8",
}

@st.cache_data(ttl=600)  # 10分間はネットから取らずに保存したデータを使う
def load_data():
    """Supabaseから配当データを取得し、DataFrameに整形する"""
    try:
        with httpx.Client(timeout=10.0) as client:
            url = f"{SUPABASE_URL}/rest/v1/dividend_records?select=*,stocks(*)&order=year.asc,month.asc"
            response = client.get(url, headers=HEADERS)
            response.raise_for_status()
            data = response.json()
            if not data:
                return pd.DataFrame()
            
            df = pd.json_normalize(data)

            # stocks.ticker_codeを削除して重複回避
            if 'stocks.ticker_code' in df.columns:
                df = df.drop(columns=['stocks.ticker_code'])
            
            # 残りの stocks. を消す
            df.columns = [c.replace('stocks.', '') for c in df.columns]
            
            # 数値型に変換
            for col in ['amount_tokutei', 'amount_nisa', 'dividend_unit_jpy', 'dividend_unit_usd']:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
            
            return df
    except Exception as e:
        st.error(f"データ取得エラー: {e}")
        return pd.DataFrame()

def delete_record(item_id):
    """指定したIDのレコードを削除する"""
    try:
        with httpx.Client() as client:
            res = client.delete(f"{API_URL}?id=eq.{item_id}", headers=HEADERS)
            res.raise_for_status()
            return True
    except Exception as e:
        st.error(f"削除失敗: {e}")
        return False
    
# database.py に追加/修正

def update_stock_status(ticker_code, update_data):
    """銘柄の増減配ステータス（last_check_status等）を更新する"""
    try:
        with httpx.Client() as client:
            res = client.patch(
                f"{SUPABASE_URL}/rest/v1/stocks?ticker_code=eq.{ticker_code}",
                headers=HEADERS,
                json=update_data
            )
            res.raise_for_status()
            return True
    except Exception as e:
        st.error(f"銘柄ステータス更新失敗({ticker_code}): {e}")
        return False

def save_dividend_data(stock_payload, history_payload, is_edit, record_id=None):
    """銘柄情報と配当記録をセットで保存（新規または編集）する"""
    try:
        with httpx.Client() as client:
            # 1. stocks テーブルを upsert
            client.post(
                f"{SUPABASE_URL}/rest/v1/stocks", 
                headers={**HEADERS, "Prefer": "resolution=merge-duplicates"}, 
                json=stock_payload
            )

            # 2. dividend_records テーブルを保存
            if is_edit and record_id:
                # 編集時は PATCH
                res = client.patch(f"{API_URL}?id=eq.{record_id}", headers=HEADERS, json=history_payload)
            else:
                # 新規なら POST
                res = client.post(API_URL, headers=HEADERS, json=history_payload)
            
            res.raise_for_status()
            return True
    except Exception as e:
        st.error(f"保存エラー: {e}")
        return False

def get_unique_stocks():
    """全銘柄のリストを取得する"""
    try:
        with httpx.Client() as client:
            res = client.get(f"{SUPABASE_URL}/rest/v1/stocks", headers=HEADERS)
            res.raise_for_status()
            return res.json()
    except Exception as e:
        st.error(f"銘柄リスト取得失敗: {e}")
        return []