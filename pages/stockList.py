import streamlit as st
import pandas as pd
import time
from datetime import datetime, timedelta, timezone
from database import load_data, delete_record, get_unique_stocks, update_stock_status, save_dividend_data
from utils import check_dividend_status

st.set_page_config(page_title="保有銘柄一覧", layout="wide")

# セッション状態の初期化
if "list_type_val" not in st.session_state:
    st.session_state.list_type_val = "すべて"
if "search_reset_seed" not in st.session_state:
    st.session_state.search_reset_seed = 0
if "edit_data" not in st.session_state:
    st.session_state.edit_data = None

@st.dialog("データの削除")
def delete_confirm_dialog(item_id, ticker_name, year, month):
    st.warning(f"【{ticker_name}】{year}年{month}月のデータを削除しますか？")
    st.write("この操作は取り消せません。")
    col1, col2 = st.columns(2)
    with col1:
        if st.button("はい、削除します", type="primary", use_container_width=True):
            if delete_record(item_id):
                st.success("削除しました")
                st.rerun()
    with col2:
        if st.button("キャンセル", use_container_width=True):
            st.rerun()

@st.dialog("配当金データの登録・編集", width="large")
def show_dividend_dialog(edit_data=None):
    is_edit = edit_data is not None
    st.subheader("データ編集" if is_edit else "配当金データ登録")
    
    ed = edit_data if is_edit else {}
    
    # 銘柄タイプの判定
    if is_edit:
        default_currency = ed.get("currency")
    elif st.session_state.get("pre_currency"):
        default_currency = st.session_state.pre_currency
    else:
        default_currency = "JPY"

    idx = 0 if default_currency == "JPY" else 1
    stock_type = st.radio("銘柄タイプ", ["日本株", "米国株"], index=idx, horizontal=True, key="dialog_stock_type")

    with st.form("dialog_dividend_form", clear_on_submit=not is_edit):
        col1, col2 = st.columns(2)
        with col1:
            ticker_code = st.text_input("銘柄コード", value=ed.get("ticker_code", st.session_state.get("pre_code", "")))
            ticker_name = st.text_input("銘柄名", value=ed.get("ticker_name", st.session_state.get("pre_name", "")))
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

        _, col_btn, _ = st.columns([3, 1, 3]) 
        
        with col_btn:
            if st.form_submit_button("保存", use_container_width=True):
                # --- 保存処理 ---
                success = save_dividend_data(
                    {"ticker_code": ticker_code, "ticker_name": ticker_name, "currency": currency},
                    {
                        "ticker_code": ticker_code, 
                        "year": int(year), 
                        "month": int(month), 
                        "dividend_unit_jpy": float(div_unit_jpy), 
                        "dividend_unit_usd": float(div_unit_usd), 
                        "shares_tokutei": int(shares_t), 
                        "amount_tokutei": float(amount_t), 
                        "shares_nisa": int(shares_n), 
                        "amount_nisa": float(amount_n)
                    },
                    is_edit, 
                    record_id=ed.get("id") if is_edit else None
                )
                if success:
                    st.success("保存しました！")
                    st.session_state.pre_code = st.session_state.pre_name = st.session_state.pre_currency = ""
                    st.rerun()

st.subheader("保有銘柄一覧")

top_info_container = st.empty()

df = load_data()
last_update_str = "未実施"
if not df.empty:
    if 'updated_at' in df.columns and df['updated_at'].notnull().any():
        last_update_dt = pd.to_datetime(df['updated_at']).max()
        JST = timezone(timedelta(hours=+9))
        if last_update_dt.tzinfo is None:
            last_update_dt = last_update_dt.tz_localize('UTC').tz_convert('Asia/Tokyo')
        else:
            last_update_dt = last_update_dt.tz_convert('Asia/Tokyo')
        last_update_str = last_update_dt.strftime("%Y/%m/%d %H:%M")

# 最上部コンテナに最終更新日を表示
top_info_container.caption(f"配当金状況最終更新日: {last_update_str}")

# 操作ボタン列
c_btn1, c_btn2, c_btn3 = st.columns([1, 1, 1])

with c_btn1:
    # ダッシュボードへ戻るボタン
    if st.button("⬅️ ダッシュボードへ戻る", use_container_width=True):
        st.switch_page("pages/dashboard.py")

with c_btn2:
    # 更新ボタン
    if st.button("🔄 最新配当金状況を更新", use_container_width=True):
        st.cache_data.clear()
        unique_stocks = get_unique_stocks()
        if unique_stocks:
            with top_info_container.container():
                progress_bar = st.progress(0)
                status_text = st.empty()
                JST = timezone(timedelta(hours=+9))
                target_now = datetime.now(JST).isoformat()
                for i, stock in enumerate(unique_stocks):
                    t_code = stock['ticker_code']
                    status_text.text(f"更新中 ({i+1}/{len(unique_stocks)})")
                    label, color, info = check_dividend_status(t_code, stock['currency'])
                    update_stock_status(t_code, {
                        "last_check_status": label, 
                        "last_check_color": color, 
                        "last_check_info": info, 
                        "updated_at": target_now
                    })
                    progress_bar.progress((i + 1) / len(unique_stocks))
                status_text.success(f"完了！ {len(unique_stocks)}銘柄を更新しました。")
                time.sleep(1)
                st.rerun()

with c_btn3:
    # 既存の新規登録ボタン
    if st.button("➕ 新規配当金データを登録", use_container_width=True):
        st.session_state.pre_code = ""
        st.session_state.pre_name = ""
        st.session_state.pre_currency = "JPY"
        show_dividend_dialog()

df = load_data()
if not df.empty:
    c_p1, c_p2, c_p3 = st.columns([1.0, 2.0, 0.5], vertical_alignment="bottom")
    with c_p1:
        type_options_list = ["すべて", "日本株", "米国株"]
        current_index = type_options_list.index(st.session_state.list_type_val)
        selected_list_type = st.selectbox("銘柄タイプ", type_options_list, index=current_index, key="list_type_widget")
        st.session_state.list_type_val = selected_list_type
    with c_p2:
        search_query = st.text_input("銘柄名・コードで検索", placeholder="例: 9101, NVDA", key="ticker_search")
    with c_p3:
        if st.button("🔍", use_container_width=True):
            st.rerun()
                
    st.divider()
    list_df = df.copy()
    if search_query:
        list_df = list_df[list_df['ticker_name'].str.contains(search_query, case=False, na=False) | list_df['ticker_code'].str.contains(search_query, case=False, na=False)]
    else:
        if st.session_state.list_type_val == "日本株":
            list_df = list_df[list_df['currency'] == "JPY"]
        elif st.session_state.list_type_val == "米国株":
            list_df = list_df[list_df['currency'] == "USD"]

    if not list_df.empty:
        unique_ticker_info = list_df[["ticker_name", "ticker_code"]].drop_duplicates()
        ticker_order_df = unique_ticker_info.sort_values("ticker_code")
        for _, row in ticker_order_df.iterrows():
            ticker, t_code = row['ticker_name'], row['ticker_code']
            ticker_df = list_df[list_df["ticker_code"] == t_code].sort_values(by=["year", "month"])
            currency = ticker_df['currency'].iloc[0]
            with st.expander(f"{ticker}（{t_code}）"):
                c1, c2, c3 = st.columns(3)
                c1.metric("特定口座 累計", f"{ticker_df['amount_tokutei'].sum():,.0f} 円")
                c2.metric("NISA口座 累計", f"{ticker_df['amount_nisa'].sum():,.0f} 円")
                c3.metric("合計", f"{(ticker_df['amount_tokutei'].sum()+ticker_df['amount_nisa'].sum()):,.0f} 円")
                col_b1, col_b2 = st.columns([1, 1])
                with col_b1:
                    if st.button(f"➕ 配当金データを追加する", key=f"add_{t_code}"):
                        # セッションに値をセット（ダイアログ内の初期値として使われます）
                        st.session_state.pre_code = t_code
                        st.session_state.pre_name = ticker
                        st.session_state.pre_currency = currency
                        # ダイアログを起動（edit_dataはNoneなので新規登録モードで開く）
                        show_dividend_dialog()
                with col_b2:
                    db_status = ticker_df['last_check_status'].iloc[0] if 'last_check_status' in ticker_df.columns else None
                    if db_status:
                        st.markdown(f'<div style="display:flex;justify-content:center;align-items:center;width:100%;"><span style="background-color:{ticker_df["last_check_color"].iloc[0]};color:white;width:60%;height:38.4px;display:flex;justify-content:center;align-items:center;border-radius:8px;font-size:0.9em;font-weight:bold;">{db_status}：{ticker_df["last_check_info"].iloc[0]}</span></div>', unsafe_allow_html=True)
                unit_label = "（円）" if currency == "JPY" else "（USD）"
                col_widths = [0.6, 0.6, 1.0, 1.4, 1.4, 1.4, 1.4, 0.6, 0.6]
                h = st.columns(col_widths)
                h[0].write("**年**"); h[1].write("**月**"); h[2].write(f"単価{unit_label}"); h[3].write("**特定口座保有株数（株）**"); h[4].write("**特定口座受取金額（円）**"); h[5].write("**NISA口座保有株数（株）**"); h[6].write("**NISA口座受取金額（円）**")
                for _, r_data in ticker_df.iterrows():
                    r = st.columns(col_widths)
                    r[0].write(f"{r_data['year']}"); r[1].write(f"{r_data['month']}")
                    u_val = r_data['dividend_unit_jpy'] if currency == "JPY" else r_data['dividend_unit_usd']
                    r[2].write(f"{u_val}"); r[3].write(f"{r_data['shares_tokutei']}"); r[4].write(f"{r_data['amount_tokutei']:,.0f}"); r[5].write(f"{r_data['shares_nisa']}"); r[6].write(f"{r_data['amount_nisa']:,.0f}")
                    if r[7].button("📝", key=f"edit_{r_data['id']}"):
                        show_dividend_dialog(edit_data=r_data.to_dict())
                    if r[8].button("🗑️", key=f"del_{r_data['id']}"):
                        delete_confirm_dialog(r_data['id'], ticker, r_data['year'], r_data['month'])
    else:
        st.info("条件に一致する銘柄が見つかりませんでした。")
else:
    st.info("データがまだありません。")