import streamlit as st
import pandas as pd
import requests
import ssl
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

def refresh_forex_data(placeholder):
    df_assets = load_forex_data()
    display_items = []
    total_jpy = 0
    
    if not df_assets.empty:
        # placeholderの中身を一度空にしてからバーを作成
        placeholder.empty()
        my_bar = placeholder.progress(0, text="最新レートを取得中...")
        total_count = len(df_assets)

        for i, (_, row) in enumerate(df_assets.iterrows()):
            currency, amount = row['通貨'], row['保有金額']
            rate = get_jpy_rate(currency)
            m_key = [k for k, v in COUNTRY_TO_CURRENCY.items() if v == currency]
            c_name = m_key[0] if m_key else currency
            
            if rate is not None:
                jpy_v = amount * rate
                total_jpy += jpy_v
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
        
        # 処理が終わったらplaceholderを完全に破壊して消去
        placeholder.empty()
    
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
                # ダイアログを閉じる前にデータを再読込
                st.session_state.pop('forex_display_items', None)
                st.rerun()

# --- 3. メインUI表示 ---

st.title("保有外貨一覧")

# プログレスバー専用の「透明な箱」をボタンの上に設置
bar_placeholder = st.empty()

if 'forex_display_items' not in st.session_state:
    refresh_forex_data(bar_placeholder)

# 合計金額
st.metric("保有外貨総額 (円換算)", f"¥ {st.session_state.get('forex_total_jpy', 0):,.0f}")

# 並び替え設定
sort_options = {
    "保有額が高い順": {"key": lambda x: x["sort_val"], "reverse": True},
    "保有額が低い順": {"key": lambda x: x["sort_val"], "reverse": False},
    "国名順": {"key": lambda x: x["full_country_name"], "reverse": False},
    "通貨コード順": {"key": lambda x: x["currency"], "reverse": False},
}

# 操作パネル（1行に横並び）
col_sort, col_refresh, col_add = st.columns([2, 1, 1], vertical_alignment="bottom")

with col_sort:
    # keyを完全に新しいシリーズに変更
    sort_choice = st.selectbox("並べ替え", list(sort_options.keys()), key="sort_v_final_1")

with col_refresh:
    if st.button("🔄 為替レート更新", use_container_width=True, key="ref_v_final_1"):
        st.cache_data.clear() 
        refresh_forex_data(bar_placeholder)
        st.rerun()

with col_add:
    if st.button("➕ 新規外貨金額入力", use_container_width=True, key="add_v_final_1"):
        show_input_dialog()

st.divider()

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
                if st.button(f"📝 編集", key=f"edit_v_final_{item['currency']}"):
                    show_input_dialog(default_country=item["full_country_name"])
            with cd:
                if st.button(f"🗑️ 削除", key=f"del_v_final_{item['currency']}"):
                    if delete_forex_data(item['currency']):
                        st.session_state.pop('forex_display_items', None)
                        st.rerun()