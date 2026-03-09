import streamlit as st
import pandas as pd
import plotly.express as px
from database import load_data, load_forex_data

st.set_page_config(page_title="配当金ダッシュボード", layout="wide")

tab_div, tab_forex = st.tabs(["💵 配当金", "🌍 保有外貨"])

# ==========================================================
# タブ1: 配当金サマリー
# ==========================================================
with tab_div:
    st.header("配当金ダッシュボード")
    
    # --- アクションボタン (ヘッダー直下) ---
    c_header_l, c_header_r = st.columns([1, 5])
    with c_header_l:
        if st.button("📋 保有銘柄を確認", use_container_width=True, key="nav_to_stock_list"):
            st.switch_page("pages/stockList.py")
            
    df = load_data()

    if not df.empty:
        # 受取額の合計（円）を計算
        df['total_jpy'] = df['amount_tokutei'] + df['amount_nisa']
        
        # --- 1. フィルターエリア ---
        col_f1, col_f2, col_f3, col_f4 = st.columns(4) 
        with col_f1:
            years = sorted(df['year'].unique(), reverse=True)
            selected_year = st.selectbox("表示する年を選択", years)
        with col_f2:
            month_options = ["すべて"] + [f"{m}月" for m in range(1, 13)]
            selected_month_str = st.selectbox("表示する月を選択", month_options)
        with col_f3:
            type_options = ["すべて", "日本株", "米国株"]
            selected_type = st.selectbox("銘柄タイプを選択", type_options)
        with col_f4:
            tmp_df = df.copy()
            if selected_type == "日本株":
                tmp_df = tmp_df[tmp_df['currency'] == "JPY"]
            elif selected_type == "米国株":
                tmp_df = tmp_df[tmp_df['currency'] == "USD"]
            stock_list = sorted(tmp_df['ticker_name'].unique())
            selected_stock = st.selectbox("特定の銘柄を選択", ["すべて"] + stock_list)

        # --- 2. データの絞り込みと集計 ---
        base_df = df.copy()
        if selected_type == "日本株":
            base_df = base_df[base_df['currency'] == "JPY"]
        elif selected_type == "米国株":
            base_df = base_df[base_df['currency'] == "USD"]
            
        if selected_stock != "すべて":
            base_df = base_df[base_df['ticker_name'] == selected_stock]
            target_name = selected_stock
        else:
            target_name = selected_type

        if selected_month_str != "すべて":
            sel_m = int(selected_month_str.replace("月", ""))
            this_val = base_df[(base_df['year'] == selected_year) & (base_df['month'] == sel_m)]['total_jpy'].sum()
            prev_val = base_df[(base_df['year'] == selected_year - 1) & (base_df['month'] == sel_m)]['total_jpy'].sum()
            display_title = f"{selected_year}年{sel_m}月 配当金受取金総額（{target_name}）"
            delta_label = "前年同月比"
            filtered_df = base_df[(base_df['year'] == selected_year) & (base_df['month'] == sel_m)]
        else:
            this_val = base_df[base_df['year'] == selected_year]['total_jpy'].sum()
            prev_val = base_df[base_df['year'] == selected_year - 1]['total_jpy'].sum()
            display_title = f"{selected_year}年 配当金受取金総額（{target_name}）"
            delta_label = "前年比"
            filtered_df = base_df[base_df['year'] == selected_year]

        # --- 3. 指標の表示 ---
        diff = this_val - prev_val
        
        st.metric(
            label=display_title, 
            value=f"{this_val:,.0f} 円",
            delta=f"{diff:+,.0f} 円 ({delta_label})" if selected_year - 1 in years else None
        )
        
        # --- 4. グラフ描画 ---
        portfolio_df = filtered_df.groupby("ticker_name")["total_jpy"].sum().reset_index()
        if not portfolio_df.empty:
            fig = px.treemap(
                portfolio_df, path=['ticker_name'], values='total_jpy',
                color='total_jpy', color_continuous_scale='Turbo', 
            )
            fig.update_traces(texttemplate="<b>%{label}</b><br>%{value:,.0f}円")
            fig.update_coloraxes(showscale=False)
            fig.update_layout(margin=dict(t=30, b=10, l=10, r=10), height=450)
            st.plotly_chart(fig, use_container_width=True)
            
            st.subheader(f"📅 {selected_year}年 月別配当金受取額推移（{selected_type}）")
            all_months = pd.DataFrame({"month": range(1, 13)})
            monthly_summary = filtered_df.groupby("month")["total_jpy"].sum().reset_index()
            monthly_plot_df = pd.merge(all_months, monthly_summary, on="month", how="left").fillna(0)
            
            fig_bar = px.bar(monthly_plot_df, x="month", y="total_jpy", labels={"month": "月", "total_jpy": "受取額（円）"}, color_discrete_sequence=['#636EFA'])
            max_val = monthly_plot_df["total_jpy"].max()
            y_limit = max(max_val * 1.2, 10000)
            fig_bar.update_layout(
                xaxis=dict(tickmode='array', tickvals=list(range(1, 13)), ticktext=[f"{m}月" for m in range(1, 13)], range=[0.5, 12.5], title=None),
                yaxis=dict(range=[0, y_limit], tickformat=",d", ticksuffix="円", title=None),
                height=500,
            )
            st.plotly_chart(fig_bar, use_container_width=True)

            # --- 5. ステータス集計 ---
            st.subheader("🚥 配当金ステータス状況")
            inc_count, stay_count, dec_count, new_count = 0, 0, 0, 0
            this_year_names = filtered_df['ticker_name'].unique()
            prev_year_df = base_df[base_df['year'] == selected_year - 1]
            for stock in this_year_names:
                stock_this_df = filtered_df[filtered_df['ticker_name'] == stock]
                currency = stock_this_df['currency'].iloc[0]
                unit_col = 'dividend_unit_jpy' if currency == 'JPY' else 'dividend_unit_usd'
                t_val = stock_this_df[unit_col].max()
                stock_prev_df = prev_year_df[prev_year_df['ticker_name'] == stock]
                if not stock_prev_df.empty:
                    p_val = stock_prev_df[unit_col].max()
                    if t_val > p_val: inc_count += 1
                    elif t_val < p_val: dec_count += 1
                    else: stay_count += 1
                else: new_count += 1

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("増配 🟢", f"{inc_count} 銘柄")
            c2.metric("減配 🔴", f"{dec_count} 銘柄")
            c3.metric("維持 ⚪", f"{stay_count} 銘柄")
            c4.metric("新規 ✨", f"{new_count} 銘柄")
            st.caption(f"※ {selected_year}年と前年の最大配当単価（{selected_type}）を比較しています")

            st.subheader(f"🏆 {selected_year}年 配当金受取額ランキング（{selected_type}）")
            ranking_df = portfolio_df.sort_values("total_jpy", ascending=False).head(10)
            ranking_df.columns = ["銘柄名", "配当金（円）"]
            st.dataframe(ranking_df.style.format({"配当金（円）": "{:,.0f}"}), hide_index=True, use_container_width=True)
        else:
            st.info("該当するデータはありません。")
    else:
        st.info("配当金データがまだありません。")

# ==========================================================
# タブ2: 外貨資産サマリー
# ==========================================================
with tab_forex:
    st.header("保有外貨ダッシュボード")
    df_forex = load_forex_data()

    col_btn, _ = st.columns([1, 5]) 
    with col_btn:
        if st.button("📋 保有外貨を確認", use_container_width=True, key="nav_to_forex_list"):
            st.switch_page("pages/foreignCurrencyList.py")

    if not df_forex.empty:
        # 合計円換算額の算出
        total_forex_jpy = df_forex['jpy'].sum()

        # --- 2. メトリック表示 ---
        st.metric("保有外貨総額 (円換算)", f"{total_forex_jpy:,.0f} 円")
        
        # --- 3. グラフ表示（詳細テーブルを削除し、グラフをメインに） ---
        fig_pie = px.pie(
            df_forex, 
            values='jpy', 
            names='通貨', 
            hole=0.4,
            color_discrete_sequence=px.colors.qualitative.Pastel
        )
        fig_pie.update_traces(textposition='inside', textinfo='percent+label')
        fig_pie.update_layout(margin=dict(t=30, b=10, l=10, r=10), height=550) # 高さを少し調整
        
        # 1カラムでグラフを大きく表示
        st.plotly_chart(fig_pie, use_container_width=True)
        
    else:
        st.info("外貨資産データが登録されていません。")