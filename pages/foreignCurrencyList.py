import streamlit as st
import pandas as pd
import time
import requests
from datetime import datetime, timedelta, timezone
from database import load_forex_data, save_forex_data, delete_forex_data, setup_ssl_environment

# --- 1. 初期設定 ---
setup_ssl_environment()

COUNTRY_TO_CURRENCY = {
    "台湾 (TWD)": "TWD", "ユーロ圏 (EUR)": "EUR", "モロッコ (MAD)": "MAD",
    "タイ (THB)": "THB", "カナダ (CAD)": "CAD", "アメリカ (USD)": "USD",
    "香港 (HKD)": "HKD", "マレーシア (MYR)": "MYR", "マカオ (MOP)": "MOP",
    "カンボジア (KHR)": "KHR", "シンガポール (SGD)": "SGD", "ラオス (LAK)": "LAK",
    "フィリピン (PHP)": "PHP", "UAE (AED)": "AED", "トルコ (TRY)": "TRY",
    "インド (INR)": "INR", "ベトナム (VND)": "VND"
}

# --- 2. 関数定義 ---
@st.cache_data(ttl=600, show_spinner=False)
def get_jpy_rate(currency):
    if currency == "JPY": return 1.0
    try:
        url = f"https://api.exchangerate-api.com/v4/latest/{currency}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            return response.json()['rates']['JPY']
    except:
        return None
    return None

def refresh_forex_data(top_container):
    df_assets = load_forex_data()
    display_items = []
    total_jpy = 0
    
    # このバッチ処理共通の更新時刻を生成 (日本時間)
    jst = timezone(timedelta(hours=+9))
    current_now = datetime.now(jst).isoformat()
    
    if not df_assets.empty:
        # コンテナの中身を進捗表示に書き換える
        with top_container.container():
            my_bar = st.progress(0)
            status_text = st.empty()
            total_count = len(df_assets)

            for i, (_, row) in enumerate(df_assets.iterrows()):
                currency, amount = row['通貨'], row['保有金額']
                status_text.text(f"最新レートを取得中 ({i+1}/{total_count})")
                
                rate = get_jpy_rate(currency)
                m_key = [k for k, v in COUNTRY_TO_CURRENCY.items() if v == currency]
                c_name = m_key[0] if m_key else currency
                
                if rate is not None:
                    jpy_v = amount * rate
                    total_jpy += jpy_v
                    save_forex_data(currency, amount, rate=rate, jpy_total=jpy_v, updated_at=current_now)
                    
                    item = {
                        "title": f"{c_name} : {jpy_v:,.0f} 円", "currency": currency, "amount": amount, 
                        "rate": f"{rate:.2f} JPY", "jpy": f"¥ {jpy_v:,.0f}", "full_country_name": c_name, "sort_val": jpy_v
                    }
                else:
                    item = {
                        "title": f"⚠️ {c_name} : エラー", "currency": currency, "amount": amount, 
                        "rate": "失敗", "jpy": "--- 円", "full_country_name": c_name, "sort_val": 0
                    }
                display_items.append(item)
                my_bar.progress((i + 1) / total_count)
            
            status_text.success("レート更新が完了しました。")
            time.sleep(1)
    
    st.session_state.forex_display_items = display_items
    st.session_state.forex_total_jpy = total_jpy

@st.dialog("外貨金額の入力")
def show_input_dialog(default_country="アメリカ (USD)"):
    st.write("保有金額を入力してください。")
    country_list = list(COUNTRY_TO_CURRENCY.keys())
    default_index = country_list.index(default_country) if default_country in country_list else 5
    selected_country = st.selectbox("国名を選択", country_list, index=default_index, key="dialog_country_v_final")
    target_currency = COUNTRY_TO_CURRENCY[selected_country]
    
    tmp_df = load_forex_data()
    current_val = float(tmp_df[tmp_df['通貨'] == target_currency]['保有金額'].iloc[0]) if not tmp_df.empty and target_currency in tmp_df['通貨'].values else 0.0
    
    with st.form(key="dialog_form_v_final"):
        new_amount = st.number_input(f"{target_currency} の保有量", min_value=0.0, value=current_val, step=0.01, format="%.2f")
        if st.form_submit_button("保存", use_container_width=True):
            if save_forex_data(target_currency, new_amount):
                st.session_state.pop('forex_display_items', None)
                st.rerun()

# --- 3. メインUI表示 ---

st.header("保有外貨一覧")

# 最上部コンテナ（進捗バー等が表示される場所）
top_info_container = st.empty()

# データのロードと「最終更新日」の取得
df_assets = load_forex_data()
last_update_str = "未実施"

if not df_assets.empty:
    if 'updated_at' in df_assets.columns and df_assets['updated_at'].notnull().any():
        last_update_dt = pd.to_datetime(df_assets['updated_at']).max()
        JST = timezone(timedelta(hours=+9))
        if last_update_dt.tzinfo is None:
            last_update_dt = last_update_dt.tz_localize('UTC').tz_convert('Asia/Tokyo')
        else:
            last_update_dt = last_update_dt.tz_convert('Asia/Tokyo')
        last_update_str = last_update_dt.strftime("%Y/%m/%d %H:%M")

# 初期状態：最上部コンテナに最終更新日を表示
top_info_container.caption(f"為替レート状況最終更新日: {last_update_str}")

# 起動時：セッションにデータがない場合はDBから既存値をロード
if 'forex_display_items' not in st.session_state:
    df_assets = load_forex_data()
    display_items = []
    total_jpy_sum = 0
    
    if not df_assets.empty:
        for _, row in df_assets.iterrows():
            currency = row['通貨']
            amount = row['保有金額']
            l_rate = row.get('rate', 0) if pd.notnull(row.get('rate')) else 0
            l_jpy = row.get('jpy', 0) if pd.notnull(row.get('jpy')) else 0
            
            m_key = [k for k, v in COUNTRY_TO_CURRENCY.items() if v == currency]
            c_name = m_key[0] if m_key else currency
            
            display_items.append({
                "title": f"{c_name} : {l_jpy:,.0f} 円" if l_jpy > 0 else f"{c_name} : (前回値なし)",
                "currency": currency, "amount": amount,
                "rate": f"{l_rate:.2f} JPY" if l_rate > 0 else "未取得",
                "jpy": f"¥ {l_jpy:,.0f}" if l_jpy > 0 else "--- 円",
                "full_country_name": c_name, "sort_val": l_jpy
            })
            total_jpy_sum += l_jpy
            
    st.session_state.forex_display_items = display_items
    st.session_state.forex_total_jpy = total_jpy_sum

# 操作ボタン列 (一番上に配置)
c_btn1, c_btn2, c_btn3 = st.columns([1, 1, 1])

with c_btn1:
    if st.button("⬅️ ダッシュボードへ戻る", use_container_width=True):
        st.switch_page("pages/dashboard.py")

with c_btn2:
    if st.button("🔄 為替レートを更新", use_container_width=True, key="ref_final_v10"):
        st.cache_data.clear() 
        refresh_forex_data(top_info_container)
        st.rerun()

with c_btn3:
    if st.button("➕ 新規外貨金額を登録", use_container_width=True, key="add_final_v10"):
        show_input_dialog()

# 並び替えパネル
sort_options = {
    "保有額が高い順": {"key": lambda x: x["sort_val"], "reverse": True},
    "保有額が低い順": {"key": lambda x: x["sort_val"], "reverse": False},
    "国名順": {"key": lambda x: x["full_country_name"], "reverse": False},
}

col_sort, _ = st.columns([2, 2])
with col_sort:
    sort_choice = st.selectbox("並べ替え", list(sort_options.keys()), key="sort_final_v10")

# --- 4. リスト表示 ---
if not st.session_state.forex_display_items:
    st.info("データがありません。")
else:
    s_conf = sort_options[sort_choice]
    sorted_items = sorted(st.session_state.forex_display_items, key=s_conf["key"], reverse=s_conf["reverse"])

    for item in sorted_items:
        with st.expander(item["title"]):
            ca, cb, cc = st.columns(3)
            ca.metric("保有金額", f"{item['amount']:,.2f} {item['currency']}")
            cb.metric("為替レート", item["rate"])
            cc.metric("日本円換算", item["jpy"])
            
            ce, cd, _ = st.columns([1, 1, 2])
            with ce:
                if st.button(f"📝 編集", key=f"edit_v10_{item['currency']}"):
                    show_input_dialog(default_country=item["full_country_name"])
            with cd:
                if st.button(f"🗑️ 削除", key=f"del_v10_{item['currency']}"):
                    if delete_forex_data(item['currency']):
                        st.session_state.pop('forex_display_items', None)
                        st.rerun()