import streamlit as st
from database import save_dividend_data

st.set_page_config(page_title="配当金データ登録", layout="wide")
# app.pyを経由せずに直接このページを開いてもエラーにならないようにする
initial_states = {
    "edit_data": None,
    "pre_code": "",
    "pre_name": "",
    "pre_currency": "JPY",  # エラーが出ていた変数
    "page": "dividendRegistration.py"
}

for key, value in initial_states.items():
    if key not in st.session_state:
        st.session_state[key] = value

is_edit = st.session_state.edit_data is not None
st.header("データ編集" if is_edit else "配当金データ登録")

if is_edit:
    st.info("現在、既存データの編集モードです。保存すると上書きされます。")
    if st.button("キャンセル（新規登録に戻る）"):
        st.session_state.edit_data = None
        st.rerun()

ed = st.session_state.edit_data if is_edit else {}
if is_edit:
    default_currency = ed.get("currency")
elif st.session_state.pre_currency:
    default_currency = st.session_state.pre_currency
else:
    default_currency = "JPY"

idx = 0 if default_currency == "JPY" else 1
stock_type = st.radio("銘柄タイプ", ["日本株", "米国株"], index=idx, horizontal=True, key="reg_stock_type")

with st.form("dividend_entry_form", clear_on_submit=not is_edit):
    col1, col2 = st.columns(2)
    with col1:
        ticker_code = st.text_input("銘柄コード", value=ed.get("ticker_code", st.session_state.pre_code))
        ticker_name = st.text_input("銘柄名", value=ed.get("ticker_name", st.session_state.pre_name))
        year = st.number_input("配当金受取年", value=int(ed.get("year", 2025)))
        month = st.number_input("配当金受取月", min_value=1, max_value=12, value=int(ed.get("month", 1)))
    with col2:
        if stock_type == "日本株":
            div_unit_jpy = st.number_input("配当金単価 (円)", value=float(ed.get("dividend_unit_jpy", 0.0)))
            div_unit_usd, currency = 0.0, "JPY"
        else:
            div_unit_usd = st.number_input("配当金単価 (USD)", value=float(ed.get("dividend_unit_usd", 0.0)))
            div_unit_jpy, currency = 0.0, "USD"
        shares_t = st.number_input("特定口座保有株数 (株)", value=int(ed.get("shares_tokutei", 0)))
        amount_t = st.number_input("特定口座受取金額 (円)", value=float(ed.get("amount_tokutei", 0.0)))
        shares_n = st.number_input("NISA口座保有株数 (株)", value=int(ed.get("shares_nisa", 0)))
        amount_n = st.number_input("NISA口座受取金額 (円)", value=float(ed.get("amount_nisa", 0.0)))

    if st.form_submit_button("保存"):
        success = save_dividend_data(
            {"ticker_code": ticker_code, "ticker_name": ticker_name, "currency": currency},
            {"ticker_code": ticker_code, "year": int(year), "month": int(month), "dividend_unit_jpy": float(div_unit_jpy), "dividend_unit_usd": float(div_unit_usd), "shares_tokutei": int(shares_t), "amount_tokutei": float(amount_t), "shares_nisa": int(shares_n), "amount_nisa": float(amount_n)},
            is_edit, record_id=ed.get("id") if is_edit else None
        )
        if success:
            st.success("保存しました！")
            st.session_state.edit_data = None
            st.session_state.pre_code = st.session_state.pre_name = st.session_state.pre_currency = ""
            st.switch_page("pages/dividendRegistration.py")