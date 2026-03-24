import httpx
import streamlit as st
import pandas as pd
import ssl

def setup_ssl_environment():
    try:
        _create_unverified_https_context = ssl._create_unverified_context
    except AttributeError:
        pass
    else:
        ssl._create_default_https_context = _create_unverified_https_context

# --- Supabase接続設定 ---
SUPABASE_URL = st.secrets["SUPABASE_URL"]
SUPABASE_KEY = st.secrets["SUPABASE_KEY"]
HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json; charset=utf-8",
}

# 各テーブルのURL
DIVIDEND_API_URL = f"{SUPABASE_URL}/rest/v1/dividend_records"
FOREX_API_URL = f"{SUPABASE_URL}/rest/v1/foreignCurrency_records"
STOCKS_API_URL = f"{SUPABASE_URL}/rest/v1/stocks"
TAX_API_URL = f"{SUPABASE_URL}/rest/v1/tax_simulations"

# --- 【爆速化の鍵】HTTPクライアントの共通化 ---
@st.cache_resource
def get_client():
    """
    HTTPクライアントをキャッシュし、コネクションを維持する。
    これにより保存・読み込みごとの接続オーバーヘッドを劇的に減らす。
    """
    return httpx.Client(
        headers=HEADERS,
        timeout=10.0,
        limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)
    )

# --- 1. 配当金データ関連 ---

def save_dividend_data(stock_payload, record_payload, is_edit=False, record_id=None):
    """配当金データを保存・更新する。"""
    client = get_client()
    try:
        # 1. 銘柄情報の保存 (upsert)
        client.post(
            STOCKS_API_URL,
            headers={"Prefer": "resolution=merge-duplicates"},
            json=stock_payload
        )
        
        # 2. 配当レコードの保存
        if is_edit and record_id:
            res = client.patch(
                f"{DIVIDEND_API_URL}?id=eq.{record_id}",
                json=record_payload
            )
        else:
            res = client.post(
                DIVIDEND_API_URL,
                headers={"Prefer": "resolution=merge-duplicates"},
                json=record_payload
            )
        
        if res.status_code not in [200, 201, 204]:
            st.error(f"DB保存失敗: {res.text}")
            return False
        return True
    except Exception as e:
        st.error(f"配当保存エラー: {e}")
        return False

def load_data():
    """Supabaseから全配当データを取得"""
    client = get_client()
    try:
        url = f"{DIVIDEND_API_URL}?select=*,stocks(*)&order=year.asc,month.asc"
        res = client.get(url)
        res.raise_for_status()
        data = res.json()
        if not data:
            return pd.DataFrame()
        
        df = pd.json_normalize(data)
        if 'stocks.ticker_code' in df.columns:
            df = df.drop(columns=['stocks.ticker_code'])
        df.columns = [c.replace('stocks.', '') for c in df.columns]
        
        cols = ['amount_tokutei', 'amount_nisa', 'dividend_unit_jpy', 'dividend_unit_usd']
        for col in cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
        return df
    except Exception as e:
        st.error(f"配当データ取得エラー: {e}")
        return pd.DataFrame()

def delete_record(item_id):
    client = get_client()
    try:
        res = client.delete(f"{DIVIDEND_API_URL}?id=eq.{item_id}")
        res.raise_for_status()
        return True
    except Exception as e:
        st.error(f"削除失敗: {e}")
        return False

# --- 2. 銘柄ステータス関連 ---

def get_unique_stocks():
    client = get_client()
    try:
        res = client.get(STOCKS_API_URL)
        res.raise_for_status()
        return res.json()
    except Exception as e:
        st.error(f"銘柄リスト取得失敗: {e}")
        return []

def update_stock_status(ticker_code, update_data):
    client = get_client()
    try:
        res = client.patch(
            f"{STOCKS_API_URL}?ticker_code=eq.{ticker_code}",
            json=update_data
        )
        res.raise_for_status()
        return True
    except Exception as e:
        st.error(f"銘柄ステータス更新失敗({ticker_code}): {e}")
        return False

# --- 3. 外貨資産関連 ---

def load_forex_data():
    client = get_client()
    try:
        res = client.get(f"{FOREX_API_URL}?select=*")
        res.raise_for_status()
        data = res.json()
        if not data:
            return pd.DataFrame(columns=['通貨', '保有金額', 'rate', 'jpy'])
        df = pd.DataFrame(data)
        return df.rename(columns={"currency": "通貨", "amount": "保有金額"})
    except Exception as e:
        st.error(f"外貨データ取得エラー: {e}")
        return pd.DataFrame(columns=['通貨', '保有金額', 'rate', 'jpy'])

def save_forex_data(currency, amount, rate=None, jpy_total=None, updated_at=None):
    client = get_client()
    try:
        payload = {"currency": currency, "amount": amount}
        if rate is not None: payload["rate"] = rate
        if jpy_total is not None: payload["jpy"] = jpy_total
        if updated_at is not None: payload["updated_at"] = updated_at

        res = client.post(
            FOREX_API_URL,
            headers={"Prefer": "resolution=merge-duplicates"},
            json=payload
        )
        if res.status_code not in [200, 201]:
            st.error(f"外貨DB保存失敗: {res.text}")
            return False
        return True
    except Exception as e:
        st.error(f"外貨保存エラー: {e}")
        return False

def delete_forex_data(currency):
    client = get_client()
    try:
        res = client.delete(f"{FOREX_API_URL}?currency=eq.{currency}")
        res.raise_for_status()
        return True
    except Exception as e:
        st.error(f"外貨削除エラー: {e}")
        return False

# --- 4. 税金シミュレーション関連 ---

def save_tax_simulation(tax_payload):
    client = get_client()
    try:
        upsert_url = f"{TAX_API_URL}?on_conflict=year"
        res = client.post(
            upsert_url,
            headers={"Prefer": "resolution=merge-duplicates"},
            json=tax_payload
        )
        if res.status_code not in [200, 201, 204]:
            st.error(f"税金データ保存失敗: {res.text}")
            return False
        return True
    except Exception as e:
        st.error(f"税金保存エラー: {e}")
        return False

def load_tax_simulation(year):
    client = get_client()
    try:
        url = f"{TAX_API_URL}?year=eq.{year}&select=*"
        res = client.get(url)
        res.raise_for_status()
        data = res.json()
        return data[0] if data else None
    except Exception as e:
        return None