import streamlit as st
import pandas as pd
import plotly.express as px
from database import load_data, load_forex_data, load_tax_simulation, save_tax_simulation

@st.cache_data
def get_cached_all_data():
    return load_data()

@st.cache_data
def get_cached_forex():
    return load_forex_data()

st.set_page_config(page_title="配当金ダッシュボード", layout="wide")

tab_div, tab_forex, tab_tax = st.tabs(["💵 配当金", "🌍 保有外貨", "🧾 税金シミュレーション"])

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
        
        # 前年比のテキストと色を決定
        delta_color = "#ff4b4b" if diff < 0 else "#09ab3b" # 赤 or 緑
        delta_icon = "↓" if diff < 0 else "↑"
        delta_text = f"{delta_icon} {diff:+,.0f} 円 ({delta_label})" if int(selected_year) - 1 in years else ""

        # Markdownでタイトル、金額、前年比を一気に描画
        st.markdown(f"""
            <div style="margin-bottom: -10px;">
                <h3 style="margin-bottom: 0px;">{display_title}</h3>
                <div style="display: flex; align-items: baseline; gap: 15px;">
                    <span style="font-size: 2.5rem;">{this_val:,.0f} <small style="font-size: 1.5rem;">円</small></span>
                    <span style="color: {delta_color}; font-size: 1.1rem; font-weight: 500;">{delta_text}</span>
                </div>
            </div>
            """, unsafe_allow_html=True)
        
        st.write("") # 下に少しだけスペースを空ける
        
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
            
            # 【重要】現在画面でフィルタリングされている銘柄のみを対象にする
            # (銘柄タイプや特定銘柄の選択がすでに反映された filtered_df を使用)
            this_year_filtered_names = filtered_df['ticker_name'].unique()
            
            for stock in this_year_filtered_names:
                stock_this_year_data = filtered_df[filtered_df['ticker_name'] == stock]
                
                if selected_month_str == "すべて":
                    target_month = int(stock_this_year_data['month'].max())
                else:
                    target_month = int(selected_month_str.replace("月", ""))
                
                this_month_data = stock_this_year_data[stock_this_year_data['month'] == target_month]
                if this_month_data.empty:
                    continue
                
                currency = this_month_data['currency'].iloc[0]
                unit_col = 'dividend_unit_jpy' if currency == 'JPY' else 'dividend_unit_usd'
                t_val = this_month_data[unit_col].max()
                
                # --- 前年データの探索 (同月 -> 前月 -> 次月の順) ---
                prev_year = int(selected_year) - 1
                
                # 候補となる月リスト [ターゲット月, 前の月, 次の月]
                # 1月の前は12月、12月の次は1月になるよう調整
                months_to_check = [
                    target_month, 
                    12 if target_month == 1 else target_month - 1, 
                    1 if target_month == 12 else target_month + 1
                ]
                
                found_prev = False
                for m in months_to_check:
                    stock_prev_df = base_df[
                        (base_df['year'] == prev_year) & 
                        (base_df['ticker_name'] == stock) & 
                        (base_df['month'] == m)
                    ]
                    
                    if not stock_prev_df.empty:
                        p_val = stock_prev_df[unit_col].max()
                        if t_val > p_val: inc_count += 1
                        elif t_val < p_val: dec_count += 1
                        else: stay_count += 1
                        found_prev = True
                        break # 見つかったらループ終了
                
                if not found_prev:
                    new_count += 1

            # メトリック表示
            c1, c2, c3, c4 = st.columns(4)
            c1.metric("増配 🟢", f"{inc_count} 銘柄")
            c2.metric("減配 🔴", f"{dec_count} 銘柄")
            c3.metric("維持 ⚪", f"{stay_count} 銘柄")
            c4.metric("新規 ✨", f"{new_count} 銘柄")
            
            # キャプションを動的に変更
            if selected_month_str == "すべて":
                caption_text = f"※ 各銘柄の{selected_year}年最新配当月と、その前年同月を比較"
            else:
                caption_text = f"※ 各銘柄の{selected_year}年{target_month}月と、前年同月を比較"
            st.caption(f"対象：{target_name} / {caption_text}")

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
        st.markdown(f"""
            <div style="margin-bottom: 20px;">
                <h3 style="margin-bottom: 0px;">保有外貨総額 (円換算)</h3>
                <div style="display: flex; align-items: baseline; gap: 10px;">
                    <span style="font-size: 2.5rem;">{total_forex_jpy:,.0f}</span>
                    <span style="font-size: 1.2rem; font-weight: 500;">円</span>
                </div>
            </div>
            """, unsafe_allow_html=True)
        
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

# ==========================================================
# タブ3: 確定申告シミュレーション
# ==========================================================
with tab_tax:
    st.header("税金シミュレーション")
    st.info("※このシミュレーションは概算です。正確な税額は確定申告書作成ソフト等でご確認ください。")

    # --- 1. データの読み込み ---
    # 【年度選択の動的ロジック】
    from datetime import datetime
    now = datetime.now()
    current_year = now.year
    # 3/31までは前年、4/1からは今年をデフォルトにする
    if now.month < 4:
        default_tax_year = current_year - 1
    else:
        default_tax_year = current_year
    
    # 2024年から現在の年までをリスト化
    year_options = list(range(2024, current_year + 1))
    
    # ラベル名「対象年度」を維持
    target_tax_year = st.selectbox(
        "対象年度", 
        year_options, 
        index=year_options.index(default_tax_year) if default_tax_year in year_options else 0
    )
    
    # 税金設定をDBから読込
    db_data = load_tax_simulation(target_tax_year) or {}
    
    # 配当金データの取得と分類
    all_div_df = load_data()
    div_jpy_tokutei_ori = 0 
    div_jpy_tokutei = 0 
    div_usd_jpy_tokutei_ori = 0 
    div_usd_jpy_tokutei = 0 
    
    if not all_div_df.empty:
        all_div_df['total_jpy'] = all_div_df['amount_tokutei'] + all_div_df['amount_nisa']
        year_div_df = all_div_df[all_div_df['year'] == target_tax_year]
        
        div_jpy_tokutei_ori = year_div_df[year_div_df['currency'] == 'JPY']['amount_tokutei'].sum()
        div_jpy_tokutei = round(div_jpy_tokutei_ori * 100 / (100-20.315), 0)
        div_usd_jpy_tokutei_ori = year_div_df[year_div_df['currency'] == 'USD']['amount_tokutei'].sum()
        div_usd_jpy_tokutei = round(div_usd_jpy_tokutei_ori * 100 / (100-28.3), 0)

    total_dividend_income = div_jpy_tokutei + div_usd_jpy_tokutei

    # --- 2. 入力セクション ---
    with st.form(key="tax_input_form"):
        with st.expander("基本データの入力", expanded=True):
            col1, col2 = st.columns(2)
            with col1:
                sales = st.number_input("売上（事業収入）", min_value=0, step=10000, value=int(db_data.get("sales", 5000000)))
                expenses = st.number_input("経費", min_value=0, step=10000, value=int(db_data.get("expenses", 1000000)))
                blue_deduction = 650000
            with col2:
                st.markdown("**📊 配当収入（税引き前、特定口座のみ）**")
                c_div1, c_div2 = st.columns(2)
                c_div1.caption("日本株")
                c_div1.text(f"{div_jpy_tokutei:,.0f} 円")
                c_div2.caption("米国株（円換算）")
                c_div2.text(f"{div_usd_jpy_tokutei:,.0f} 円")
                st.write(f"**申告対象の配当所得: {total_dividend_income:,.0f} 円**")

        with st.expander("社会保険料・その他の控除"):
            c_ded1, c_ded2 = st.columns(2)
            with c_ded1:
                pension = st.number_input("国民年金保険料", value=int(db_data.get("national_pension", 200000)))
                h_ins = st.number_input("国民健康保険料", value=int(db_data.get("health_insurance", 300000)))
                ideco = st.number_input("iDeCo・小規模企業共済等掛金", value=int(db_data.get("ideco", 0)))
            with c_ded2:
                furusato = st.number_input("ふるさと納税・寄付金控除", min_value=0, step=1000, value=int(db_data.get("donation_deduction", 50000)))
                medical = st.number_input("医療費控除", min_value=0, step=1000, value=int(db_data.get("medical_deduction", 0)))

        # フォーム内の送信ボタン（これが押されるまで再読み込みしません）
        submit_button = st.form_submit_button(f"📅 {target_tax_year}年度のデータを保存", use_container_width=True)

    # --- 3. 計算ロジック & 保存処理 ---
    # ボタンが押されたとき、または初回読み込み時に計算を実行
    business_income = max(0, sales - expenses - blue_deduction)
    total_income = business_income + total_dividend_income
    
    total_deductions = pension + h_ins + ideco + furusato + medical + 680000 
    taxable_income = max(0, total_income - total_deductions)
    calc_taxable = int((taxable_income // 1000) * 1000)

    if calc_taxable <= 1950000:
        income_tax = int(calc_taxable * 0.05)
    elif calc_taxable <= 3300000:
        income_tax = int((calc_taxable * 0.1) - 97500)
    elif calc_taxable <= 6950000:
        income_tax = int((calc_taxable * 0.2) - 427500)
    elif calc_taxable <= 8990000:
        income_tax = int((calc_taxable * 0.23) - 636000)
    elif calc_taxable <= 17990000:
        income_tax = int((calc_taxable * 0.33) - 1536000)
    elif calc_taxable <= 39990000:
        income_tax = int((calc_taxable * 0.40) - 2796000)
    else:
        income_tax = int((calc_taxable * 0.45) - 4796000)

    dividend_deduction = round(div_jpy_tokutei * 0.10, -1)
    standard_tax = max(0, income_tax - dividend_deduction)
    reconstruction_tax = int(standard_tax * 0.021)
    total_income_tax_with_reconstruction = standard_tax + reconstruction_tax

    foreign_withholding_tax = round(div_usd_jpy_tokutei * 0.10,-1)
    if total_income > 0:
        limit_foreign_tax_credit = int(total_income_tax_with_reconstruction * (div_usd_jpy_tokutei / total_income))
    else:
        limit_foreign_tax_credit = 0
    foreign_tax_credit = min(foreign_withholding_tax, limit_foreign_tax_credit)

    withholding_tax = int((div_jpy_tokutei + div_usd_jpy_tokutei*0.9) * 0.15315)
    final_tax_amount = round(total_income_tax_with_reconstruction - foreign_tax_credit - withholding_tax, -2)

    residence_total_deductions = pension + h_ins + ideco + medical + 430000
    residence_taxable_income = max(0, round(total_income - residence_total_deductions, -2))
    residence_income = residence_taxable_income * 0.10
    
    if residence_taxable_income <= 2000000:
        adjustment_deduction = min(50000, residence_taxable_income) * 0.05
    else:
        adjustment_deduction = max(2500, (50000 - (residence_taxable_income - 2000000)) * 0.05)

    residence_dividend_deduction = int(div_jpy_tokutei * 0.028)

    if furusato > 2000:
        target_furusato = furusato - 2000
        furusato_basic = target_furusato * 0.10
        current_tax_rate = (income_tax / calc_taxable) if calc_taxable > 0 else 0
        furusato_special = min(target_furusato * (0.90 - current_tax_rate * 1.021), residence_income * 0.20)
        furusato_residence_deduction = furusato_basic + furusato_special
    else:
        furusato_residence_deduction = 0

    residence_income_tax_final = max(0, residence_income - adjustment_deduction - residence_dividend_deduction - furusato_residence_deduction)
    residence_tax = int(residence_income_tax_final + 5000)
    
    consumption_tax = round((sales / 1.1 * 0.02), -2) 
    furusato_limit = int((taxable_income * 0.1 * 0.2) / (0.9 - income_tax / (calc_taxable if calc_taxable > 0 else 1) * 1.021) + 2000)

    # 保存処理の実行
    if submit_button:
        tax_payload = {
            "year": target_tax_year,
            "sales": sales,
            "expenses": expenses,
            "national_pension": pension,
            "health_insurance": h_ins,
            "ideco": ideco,
            "donation_deduction": furusato,
            "medical_deduction": medical
        }
        if save_tax_simulation(tax_payload):
            st.success(f"{target_tax_year}年度のデータを保存しました！")
            st.rerun()

    # --- 5. 結果表示 ---
    st.subheader("算出結果（概算）")
    m_col1, m_col2, m_col3 = st.columns(3)
    m_col1.metric("所得税", f"{final_tax_amount:,.0f} 円", help="マイナスは還付の目安です")
    m_col2.metric("住民税（次年度分）", f"{residence_tax:,.0f} 円")
    m_col3.metric("消費税", f"{consumption_tax:,.0f} 円")

    m_col4, m_col5 = st.columns(2)
    m_col4.metric("国民健康保険料（次年度分）", f"{h_ins:,.0f} 円")
    m_col5.metric("ふるさと納税限度額", f"{furusato_limit:,.0f} 円")