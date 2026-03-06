import streamlit as st
import pandas as pd
import time
from datetime import datetime, timedelta, timezone
from database import load_data, delete_record, get_unique_stocks, update_stock_status
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

st.header("保有銘柄一覧")
progress_placeholder = st.empty()
df = load_data()

if not df.empty:
    if 'updated_at' in df.columns and df['updated_at'].notnull().any():
        last_update_dt = pd.to_datetime(df['updated_at']).max()
        JST = timezone(timedelta(hours=+9))
        if last_update_dt.tzinfo is None:
            last_update_dt = last_update_dt.tz_localize('UTC').tz_convert('Asia/Tokyo')
        else:
            last_update_dt = last_update_dt.tz_convert('Asia/Tokyo')
        last_update_str = last_update_dt.strftime("%Y/%m/%d %H:%M")
    else:
        last_update_str = "未実施"
    st.caption(f"配当金状況最終更新日: {last_update_str}")

    c_p1, c_p2, c_p3, c_p4 = st.columns([1.0, 3.0, 0.5, 2.0], vertical_alignment="bottom")
    with c_p1:
        type_options_list = ["すべて", "日本株", "米国株"]
        current_index = type_options_list.index(st.session_state.list_type_val)
        selected_list_type = st.selectbox("銘柄タイプ", type_options_list, index=current_index, key="list_type_widget")
        st.session_state.list_type_val = selected_list_type
    with c_p2:
        search_query = st.text_input("銘柄名・コードで検索", placeholder="例: 9101, NVDA", key="ticker_search")
    with c_p3:
        if st.button("🔍", use_container_width=True):
            st.session_state.list_type_val = "すべて"
            st.rerun()
    with c_p4:
        if st.button("🔄 最新配当金状況を更新", use_container_width=True):
            # --- 古いキャッシュをクリアする ---
            st.cache_data.clear()

            unique_stocks = get_unique_stocks()
            if unique_stocks:
                with progress_placeholder.container():
                    progress_bar = st.progress(0)
                    status_text = st.empty()
                
                JST = timezone(timedelta(hours=+9))
                target_now = datetime.now(JST).isoformat()
                
                for i, stock in enumerate(unique_stocks):
                    t_code = stock['ticker_code']
                    status_text.text(f"更新中 ({i+1}/{len(unique_stocks)})")
                    
                    # 各銘柄の配当状況をチェックして更新
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
                
                # 最後に再描画することで、最新の 'updated_at' が画面に反映される
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
                        st.session_state.pre_code, st.session_state.pre_name, st.session_state.pre_currency = t_code, ticker, currency
                        st.switch_page("pages/dividendRegistration.py")
                with col_b2:
                    db_status = ticker_df['last_check_status'].iloc[0] if 'last_check_status' in ticker_df.columns else None
                    if db_status:
                        st.markdown(f'<div style="display:flex;justify-content:center;align-items:center;width:100%;"><span style="background-color:{ticker_df["last_check_color"].iloc[0]};color:white;width:60%;height:38.4px;display:flex;justify-content:center;align-items:center;border-radius:8px;font-size:0.9em;font-weight:bold;">{db_status}：{ticker_df["last_check_info"].iloc[0]}</span></div>', unsafe_allow_html=True)
                unit_label = "（円）" if currency == "JPY" else "（USD）"
                col_widths = [0.6, 0.6, 1.0, 1.4, 1.4, 1.4, 1.4, 0.6, 0.6]
                h = st.columns(col_widths)
                h[0].write("**年**"); h[1].write("**月**"); h[2].write(f"単価{unit_label}"); h[3].write("**特定口座保有株数**"); h[4].write("**特定口座受取額**"); h[5].write("**NISA口座保有株数**"); h[6].write("**NISA口座受取額**")
                for _, r_data in ticker_df.iterrows():
                    r = st.columns(col_widths)
                    r[0].write(f"{r_data['year']}"); r[1].write(f"{r_data['month']}")
                    u_val = r_data['dividend_unit_jpy'] if currency == "JPY" else r_data['dividend_unit_usd']
                    r[2].write(f"{u_val}"); r[3].write(f"{r_data['shares_tokutei']}"); r[4].write(f"{r_data['amount_tokutei']:,.0f}"); r[5].write(f"{r_data['shares_nisa']}"); r[6].write(f"{r_data['amount_nisa']:,.0f}")
                    if r[7].button("📝", key=f"edit_{r_data['id']}"):
                        st.session_state.edit_data = r_data.to_dict()
                        st.switch_page("pages/dividendRegistration.py")
                    if r[8].button("🗑️", key=f"del_{r_data['id']}"):
                        delete_confirm_dialog(r_data['id'], ticker, r_data['year'], r_data['month'])
    else:
        st.info("条件に一致する銘柄が見つかりませんでした。")
else:
    st.info("データがまだありません。")