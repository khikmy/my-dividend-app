import streamlit as st
import pandas as pd
import plotly.express as px
from datetime import datetime, timedelta, timezone
from database import (
    load_data, 
    delete_record, 
    get_unique_stocks,
    update_stock_status,
    save_dividend_data,
    SUPABASE_URL, 
    HEADERS, 
    API_URL
)
from utils import setup_ssl_environment, check_dividend_status

# --- 1.ページ基本設定 ---
setup_ssl_environment()
st.set_page_config(page_title="配当管理アプリ", layout="wide")

# 状態の管理
if "page" not in st.session_state:
    st.session_state.page = "配当金ダッシュボード"
if "pre_code" not in st.session_state:
    st.session_state.pre_code = ""
if "pre_name" not in st.session_state:
    st.session_state.pre_name = ""
if "edit_data" not in st.session_state:
    st.session_state.edit_data = None
if "pre_currency" not in st.session_state:
    st.session_state.pre_currency = ""
if "list_type_val" not in st.session_state:
    st.session_state.list_type_val = "すべて"
if "search_reset_seed" not in st.session_state:
    st.session_state.search_reset_seed = 0

# --- 2.サイドバーメニュー ---
st.sidebar.title("ナビゲーション")
menu_options = ["配当金ダッシュボード", "保有銘柄一覧", "配当金データ登録"]
selected_page = st.sidebar.radio("メニュー", menu_options, 
                                 index=menu_options.index(st.session_state.page) if st.session_state.page in menu_options else 0)

# --- 画面遷移したときの処理 ---
if selected_page != st.session_state.page:
    # もしナビゲーションから「保有銘柄一覧」に切り替えたなら、入力をクリアする
    if selected_page == "保有銘柄一覧":
        st.session_state.list_type_val = "すべて"
        st.session_state.search_reset_seed += 1
    # もしナビゲーションから「配当金データ登録」に切り替えたなら、入力をクリアする
    if selected_page == "配当金データ登録":
        st.session_state.pre_code = ""
        st.session_state.pre_name = ""
        st.session_state.pre_currency = ""
        st.session_state.edit_data = None
        
    st.session_state.page = selected_page
    st.rerun()

# --- 削除確認ダイアログ ---
@st.dialog("データの削除")
def delete_confirm_dialog(item_id, ticker_name, year, month):
    st.warning(f"【{ticker_name}】{year}年{month}月のデータを削除しますか？")
    st.write("この操作は取り消せません。")
    
    col1, col2 = st.columns(2)
    with col1:
        if st.button("はい、削除します", type="primary", use_container_width=True):
            if delete_record(item_id):
                st.success("削除しました")
                st.session_state.page = "保有銘柄一覧"
                st.rerun()
    with col2:
        if st.button("キャンセル", use_container_width=True):
            st.rerun()
    
# --- 3.【画面1】配当金ダッシュボード ---
if st.session_state.page == "配当金ダッシュボード":
    st.header("配当金ダッシュボード")
    df = load_data()

    if not df.empty:
        # 受取額の合計（円）を計算
        df['total_jpy'] = df['amount_tokutei'] + df['amount_nisa']
        
        # --- フィルターエリア ---
        col_f1, col_f2 = st.columns(2)
        with col_f1:
            years = sorted(df['year'].unique(), reverse=True)
            selected_year = st.selectbox("表示する年を選択", years)
        with col_f2:
            # 銘柄タイプの選択肢を追加
            type_options = ["すべて", "日本株", "米国株"]
            selected_type = st.selectbox("銘柄タイプを選択", type_options)
        
        # --- データの絞り込み ---
        # 1. 年で絞り込み
        filtered_df = df[df['year'] == selected_year]
        
        # 2. 銘柄タイプで絞り込み
        if selected_type == "日本株":
            filtered_df = filtered_df[filtered_df['currency'] == "JPY"]
        elif selected_type == "米国株":
            filtered_df = filtered_df[filtered_df['currency'] == "USD"]
            
        annual_total = filtered_df['total_jpy'].sum()
        
        # サマリー表示
        st.metric(f"{selected_year}年 {selected_type} 配当受取額", f"{annual_total:,.0f} 円")
        
        st.divider()

        # 銘柄ごとに集計
        portfolio_df = filtered_df.groupby("ticker_name")["total_jpy"].sum().reset_index()

        if not portfolio_df.empty:
            # --- 1. ツリーマップ ---      
            fig = px.treemap(
                portfolio_df,
                path=['ticker_name'],
                values='total_jpy',
                color='total_jpy',
                # カラフルなスケールに変更 (Turbo, Spectral, Rainbow などが選べます)
                color_continuous_scale='Turbo', 
            )

            # グラフ内のテキスト表示設定
            fig.update_traces(
                textinfo="label+value",
                texttemplate="<b>%{label}</b><br>%{value:,.0f}円",
                hovertemplate="<b>%{label}</b><br>配当金: %{value:,.0f} 円"
            )

            # カラーバー（右側の色見本）を消してスッキリさせる
            fig.update_layout(coloraxis_showscale=False)

            fig.update_layout(margin=dict(t=30, b=10, l=10, r=10), height=450)
            st.plotly_chart(fig, use_container_width=True)
            
            # --- 2.月別配当推移 ---
            st.subheader(f"📅 {selected_year}年 月別配当金受取額推移（{selected_type}）")
        
            # 1月〜12月のベースデータを作成（データがない月も0円として表示するため）
            all_months = pd.DataFrame({"month": range(1, 13)})
        
            # 選択されたデータの月別合計を算出
            monthly_summary = filtered_df.groupby("month")["total_jpy"].sum().reset_index()
        
            # ベースデータと結合
            monthly_plot_df = pd.merge(all_months, monthly_summary, on="month", how="left").fillna(0)
        
            # グラフ作成
            fig_bar = px.bar(
                monthly_plot_df, 
                x="month", 
                y="total_jpy",
                labels={"month": "月", "total_jpy": "受取額（円）"},
                color_discrete_sequence=['#636EFA'],
                color_continuous_scale="Blues" # 青系のグラデーション（お好みで変えられます）
            )
        
            # データの最大値を取得して、その1.2倍を上限にする（最低でも10,000円分は余裕を持たせる）
            max_val = monthly_plot_df["total_jpy"].max()
            y_limit = max(max_val * 1.2, 10000)

            fig_bar.update_layout(
                xaxis=dict(
                    tickmode='array',
                    tickvals=list(range(1, 13)), # 1から12まで強制表示
                    ticktext=[f"{m}月" for m in range(1, 13)], # 「1月」のような表記にする
                    range=[0.5, 12.5], # 左右に適切な余白
                    title=None
                ),
                yaxis=dict(
                    range=[0, y_limit],
                    tickformat=",d",
                    ticksuffix="円",
                    title=None,
                ),
                height=500,
            )
        
            # マウスを乗せた時の表示
            fig_bar.update_traces(
                hovertemplate="<b>%{x}月</b><br>受取額: %{y:,.0f} 円"
            )
        
            st.plotly_chart(fig_bar, use_container_width=True)

            # --- 3. ランキング表 ---
            st.subheader(f"🏆 {selected_year}年 配当金受取額ランキング（{selected_type}）")
            # 金額が大きい順に並び替え、上位10件のみ抽出
            ranking_df = portfolio_df.sort_values("total_jpy", ascending=False).head(10)
            ranking_df.columns = ["銘柄名", "配当金（円）"]
            
            st.dataframe(
                ranking_df.style.format({"配当金（円）": "{:,.0f}"}), 
                hide_index=True, 
                use_container_width=True
            )
        else:
            st.info(f"該当するデータ（{selected_year}年 / {selected_type}）はまだありません。")

    else:
        st.info("データがまだありません。")

# --- 4. 【画面2】保有銘柄一覧表示 ---
elif st.session_state.page == "保有銘柄一覧":
    st.header("保有銘柄一覧")

    progress_placeholder = st.empty()
    df = load_data()
    
    if not df.empty:

        # 進行状況を表示するプログレスバー
        progress_area = st.empty()
        
        # 最終更新日の表示
        if not df.empty and 'updated_at' in df.columns and df['updated_at'].notnull().any():
            last_update_dt = pd.to_datetime(df['updated_at']).max()
            
            # タイムゾーン処理
            if last_update_dt.tzinfo is None:
                last_update_dt = last_update_dt.tz_localize('UTC').tz_convert('Asia/Tokyo')
            else:
                last_update_dt = last_update_dt.tz_convert('Asia/Tokyo')
            last_update_str = last_update_dt.strftime("%Y/%m/%d %H:%M")
        else:
            last_update_str = "未実施"
        
        st.caption(f"配当金状況最終更新日: {last_update_str}")

        # カラム比率を調整（タイプ: 1.0, 検索窓: 3.0, 検索ボタン: 0.5, 一括更新: 1.5）
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
                # 1. まず銘柄リストを取得して変数に入れる（ここが抜けていたか、順番が逆だった可能性があります）
                from database import get_unique_stocks
                unique_stocks = get_unique_stocks()
                
                # 2. 取得できた場合のみ処理を進める
                if unique_stocks:
                    with progress_placeholder.container():
                        progress_bar = st.progress(0)
                        status_text = st.empty()

                    # 日本時間の準備
                    from datetime import datetime, timedelta, timezone
                    JST = timezone(timedelta(hours=+9))
                    target_now = datetime.now(JST).isoformat()

                    for i, stock in enumerate(unique_stocks):
                        t_code = stock['ticker_code']
                        status_text.text(f"更新中 ({i+1}/{len(unique_stocks)}): {t_code}")
                        
                        # Yahoo Financeから取得
                        label, color, info = check_dividend_status(t_code, stock['currency'])

                        # DB更新用のデータ作成
                        update_data = {
                            "last_check_status": label,
                            "last_check_color": color,
                            "last_check_info": info,
                            "updated_at": target_now
                        }
                        
                        # database.pyの関数で更新
                        from database import update_stock_status
                        update_stock_status(t_code, update_data)

                        progress_bar.progress((i + 1) / len(unique_stocks))
                    
                    status_text.success(f"完了！ {len(unique_stocks)}銘柄を更新しました。")
                    import time
                    time.sleep(1)
                    st.rerun()
                else:
                    st.warning("更新対象の銘柄が見つかりませんでした。")

        st.divider()

        # データの絞り込みロジック
        list_df = df.copy()

        if search_query:
            # 検索ワードがある場合は、タイプ設定を無視して全件から部分一致検索
            list_df = list_df[
                list_df['ticker_name'].str.contains(search_query, case=False, na=False) |
                list_df['ticker_code'].str.contains(search_query, case=False, na=False)
            ]
            st.caption(f"🔍 '{search_query}' の検索結果を表示中（全タイプ対象）")
        else:
            # 検索ワードがない場合は、選択されたタイプで絞り込み
            if st.session_state.list_type_val == "日本株":
                list_df = list_df[list_df['currency'] == "JPY"]
            elif st.session_state.list_type_val == "米国株":
                list_df = list_df[list_df['currency'] == "USD"]

        # 絞り込み後の銘柄リストを作成
        if not list_df.empty:
            unique_ticker_info = list_df[["ticker_name", "ticker_code"]].drop_duplicates()
            ticker_order_df = unique_ticker_info.sort_values("ticker_code")
            
            st.write(f"該当銘柄: {len(ticker_order_df)} 件")
            
            for _, row in ticker_order_df.iterrows():
                ticker = row['ticker_name']
                t_code = row['ticker_code']
                
                # 絞り込んだ list_df から該当銘柄のデータのみ抽出
                ticker_df = list_df[list_df["ticker_name"] == ticker].sort_values(by=["year", "month"], ascending=True)
                currency = ticker_df['currency'].iloc[0]
                
                with st.expander(f"{ticker}（{t_code}）"):
                    # 合計額の計算
                    total_tokutei = ticker_df["amount_tokutei"].sum()
                    total_nisa = ticker_df["amount_nisa"].sum()
                    grand_total = total_tokutei + total_nisa
                    
                    # サマリー表示
                    c1, c2, c3 = st.columns(3)
                    c1.metric("特定口座 累計", f"{total_tokutei:,.0f} 円")
                    c2.metric("NISA口座 累計", f"{total_nisa:,.0f} 円")
                    c3.metric("合計", f"{grand_total:,.0f} 円")
                    
                    # ボタンを横並びに配置
                    col_b1, col_b2 = st.columns([1, 1])
                    with col_b1:
                        if st.button(f"➕ 配当金データを追加する", key=f"add_{t_code}_{ticker}"):
                            st.session_state.pre_code = t_code
                            st.session_state.pre_name = ticker
                            st.session_state.pre_currency = currency
                            st.session_state.page = "配当金データ登録"
                            st.rerun()

                    with col_b2:
                        # 1. データの取得
                        db_status = ticker_df['last_check_status'].iloc[0] if 'last_check_status' in ticker_df.columns else None
                        db_color = ticker_df['last_check_color'].iloc[0] if 'last_check_color' in ticker_df.columns else "gray"
                        db_info = ticker_df['last_check_info'].iloc[0] if 'last_check_info' in ticker_df.columns else ""

                        # 2. デザインを整えたバッジ形式で表示
                        if db_status:
                            st.markdown(
                                f"""
                                <div style="display: flex; justify-content: center; align-items: center; width: 100%;">
                                    <span style="
                                        background-color: {db_color}; 
                                        color: white; 
                                        width: 60%;
                                        height: 38.4px; 
                                        display: flex; 
                                        justify-content: center; 
                                        align-items: center; 
                                        border-radius: 8px; 
                                        font-size: 0.9em; 
                                        font-weight: bold;
                                        box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
                                        white-space: nowrap;
                                        line-height: 1;
                                    ">
                                        {db_status}：{db_info}
                                    </span>
                                </div>
                                """, 
                                unsafe_allow_html=True
                            )

                    # --- カスタムテーブル表示 ---
                    unit_label = "（円）" if currency == "JPY" else "（USD）"
                    col_widths = [0.6, 0.6, 1.0, 1.4, 1.4, 1.4, 1.4, 0.6, 0.6]
                    
                    h = st.columns(col_widths)
                    h[0].write("**年**"); h[1].write("**月**"); h[2].write(f"単価{unit_label}")
                    h[3].write("**特定口座保有株数（株）**"); h[4].write("**特定口座受取額（円）**")
                    h[5].write("**NISA口座保有株数（株）**"); h[6].write("**NISA口座受取額（円）**")

                    for _, r_data in ticker_df.iterrows():
                        r = st.columns(col_widths)
                        r[0].write(f"{r_data['year']}")
                        r[1].write(f"{r_data['month']}")
                        u_val = r_data['dividend_unit_jpy'] if currency == "JPY" else r_data['dividend_unit_usd']
                        r[2].write(f"{u_val}")
                        r[3].write(f"{r_data['shares_tokutei']}")
                        r[4].write(f"{r_data['amount_tokutei']:,.0f}")
                        r[5].write(f"{r_data['shares_nisa']}")
                        r[6].write(f"{r_data['amount_nisa']:,.0f}")
                        
                        if r[7].button("📝", key=f"edit_{r_data['id']}"):
                            st.session_state.edit_data = r_data.to_dict()
                            st.session_state.page = "配当金データ登録"
                            st.rerun()
                        
                        if r[8].button("🗑️", key=f"del_{r_data['id']}"):
                            delete_confirm_dialog(r_data['id'], ticker, r_data['year'], r_data['month'])
        else:
            st.info("条件に一致する銘柄が見つかりませんでした。")
    else:
        st.info("データがまだありません。")

# --- 5. 【画面3】配当金データ登録画面 ---
else:
    # 編集モードか新規モードか判定
    is_edit = st.session_state.edit_data is not None
    st.header("データ編集" if is_edit else "配当金データ登録")

    if is_edit:
        st.info("現在、既存データの編集モードです。保存すると上書きされます。")
        if st.button("キャンセル（新規登録に戻る）"):
            st.session_state.edit_data = None
            st.rerun()

   # 編集用データの取り出し
    ed = st.session_state.edit_data if is_edit else {}

    # --- 銘柄タイプの初期値を決めるロジック ---
    if is_edit:
        # 編集時はそのデータの通貨に合わせる
        default_currency = ed.get("currency")
    elif "pre_currency" in st.session_state and st.session_state.pre_currency:
        # 一覧のボタンから来た時は、その銘柄の通貨に合わせる
        default_currency = st.session_state.pre_currency
    else:
        # それ以外は日本株をデフォルトに
        default_currency = "JPY"

    # ラジオボタンの index (0:日本株, 1:米国株)
    idx = 0 if default_currency == "JPY" else 1

    stock_type = st.radio("銘柄タイプ", ["日本株", "米国株"], 
                          index=idx, 
                          horizontal=True, key="reg_stock_type")
    
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
                div_unit_usd = 0.0
                currency = "JPY"
            else:
                div_unit_usd = st.number_input("配当金単価 (USD)", value=float(ed.get("dividend_unit_usd", 0.0)))
                div_unit_jpy = 0.0
                currency = "USD"
            
            shares_t = st.number_input("特定口座保有株数 (株)", value=int(ed.get("shares_tokutei", 0)))
            amount_t = st.number_input("特定口座受取金額 (円)", value=float(ed.get("amount_tokutei", 0.0)))
            shares_n = st.number_input("NISA口座保有株数 (株)", value=int(ed.get("shares_nisa", 0)))
            amount_n = st.number_input("NISA口座受取金額 (円)", value=float(ed.get("amount_nisa", 0.0)))

        # ★ 保存処理（編集時はPATCH、新規はPOST）
        if st.form_submit_button("保存"):
            stock_payload = {
                "ticker_code": ticker_code,
                "ticker_name": ticker_name,
                "currency": currency
            }
            
            history_payload = {
                "ticker_code": ticker_code,
                "year": int(year),
                "month": int(month),
                "dividend_unit_jpy": float(div_unit_jpy),
                "dividend_unit_usd": float(div_unit_usd),
                "shares_tokutei": int(shares_t),
                "amount_tokutei": float(amount_t),
                "shares_nisa": int(shares_n),
                "amount_nisa": float(amount_n),
            }
            
            success = save_dividend_data(
                stock_payload, 
            history_payload, 
            is_edit, 
            record_id=ed.get("id") if is_edit else None
            )

            if success:
                st.success("保存しました！")
                st.session_state.edit_data = None # 編集モード終了
                st.session_state.pre_code = ""
                st.session_state.pre_name = ""
                st.session_state.pre_currency = ""
                st.session_state.page = "配当金ダッシュボード"
                st.rerun() 
            else:
                st.error(f"保存エラー: {e}")