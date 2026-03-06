import streamlit as st
import pandas as pd
import requests
import ssl
# database.py から必要な関数だけ呼ぶ
from database import load_forex_data, save_forex_data, delete_forex_data, setup_ssl_environment

# SSL設定実行
setup_ssl_environment()

COUNTRY_TO_CURRENCY = {
    "台湾 (TWD)": "TWD",
    "ユーロ圏 (EUR)": "EUR",
    "モロッコ (MAD)": "MAD",
    "タイ (THB)": "THB",
    "カナダ (CAD)": "CAD",
    "アメリカ (USD)": "USD",
    "香港 (HKD)": "HKD",
    "マレーシア (MYR)": "MYR",
    "マカオ (MOP)": "MOP",
    "カンボジア (KHR)": "KHR",
    "シンガポール (SGD)": "SGD",
    "ラオス (LAK)": "LAK",
    "フィリピン (PHP)": "PHP",
    "UAE (AED)": "AED",
    "トルコ (TRY)": "TRY",
    "インド (INR)": "INR",
    "ベトナム (VND)": "VND"
}

@st.cache_data(ttl=600)
def get_jpy_rate(currency):
    if currency == "JPY": return 1.0
    try:
        # frankfurter ではなく、より広範囲な api.exchangerate-api.com を使用
        url = f"https://api.exchangerate-api.com/v4/latest/{currency}"
        response = requests.get(url, timeout=5)
        if response.status_code == 200:
            data = response.json()
            # 指定した通貨から見た「JPY」のレートを直接取得
            return data['rates']['JPY']
    except Exception as e:
        print(f"Error fetching rate for {currency}: {e}")
        return None
    return None

@st.dialog("外貨金額の入力")
def show_input_dialog(default_country="アメリカ (USA)"):
    st.write("保有金額を入力してください。")
    country_list = list(COUNTRY_TO_CURRENCY.keys())
    default_index = country_list.index(default_country) if default_country in country_list else 0
    selected_country = st.selectbox("国名を選択", country_list, index=default_index)
    target_currency = COUNTRY_TO_CURRENCY[selected_country]
    
    # 既存データの読み込み
    tmp_df = load_forex_data()
    current_val = 0.0
    if not tmp_df.empty and target_currency in tmp_df['通貨'].values:
        current_val = float(tmp_df[tmp_df['通貨'] == target_currency]['保有金額'].iloc[0])
    
    with st.form(key="dialog_form"):
        new_amount = st.number_input(f"{target_currency} の保有金額", min_value=0.0, value=current_val, step=0.01, format="%.2f")
        if st.form_submit_button("保存", use_container_width=True):
            if save_forex_data(target_currency, new_amount):
                st.rerun()

# --- UI構築 ---
st.title("保有外貨一覧")

df_assets = load_forex_data()
total_jpy_all = 0
display_items = []

if not df_assets.empty:
    with st.spinner('最新レートを取得中...'):
        for _, row in df_assets.iterrows():
            currency = row['通貨']
            amount = row['保有金額']
            rate = get_jpy_rate(currency)
            
            if rate is not None:
                jpy_value = amount * rate
                total_jpy_all += jpy_value
                expander_title = f"{currency} : {jpy_value:,.0f} 円"
                rate_display = f"{rate:.2f} JPY"
                jpy_display = f"¥ {jpy_value:,.0f}"
            else:
                expander_title = f"⚠️ {currency} : レート取得エラー"
                rate_display = "取得失敗"
                jpy_display = "--- 円"
            
            display_items.append({
                "title": expander_title, "currency": currency,
                "amount": amount, "rate": rate_display, "jpy": jpy_display
            })

# 合計表示
col_total, col_btn = st.columns([2, 1], vertical_alignment="bottom")
with col_total:
    st.metric("外貨資産総額 (円換算)", f"¥ {total_jpy_all:,.0f}")
with col_btn:
    if st.button("➕ 新規外貨金額を入力する", use_container_width=True):
        show_input_dialog()

st.divider()

if not display_items:
    st.info("データがありません。右上のボタンから登録してください。")
else:
    for item in display_items:
        with st.expander(item["title"]):
            col_a, col_b, col_c = st.columns(3)
            with col_a:
                st.metric("保有金額", f"{item['amount']:,.2f} {item['currency']}")
            with col_b:
                st.metric("為替レート", item["rate"])
            with col_c:
                st.metric("日本円換算", item["jpy"])
            
            col_edit, col_del, _ = st.columns([1, 1, 2])
            with col_edit:
                if st.button(f"📝 編集", key=f"edit_{item['currency']}"):
                    c_name = [k for k, v in COUNTRY_TO_CURRENCY.items() if v == item['currency']][0]
                    show_input_dialog(default_country=c_name)
            with col_del:
                if st.button(f"🗑️ 削除", key=f"del_{item['currency']}"):
                    if delete_forex_data(item['currency']):
                        st.rerun()