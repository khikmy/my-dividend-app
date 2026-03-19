import streamlit as st
import pandas as pd
import plotly.express as px
from database import load_data, load_forex_data, load_tax_simulation, save_tax_simulation

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

# ==========================================================
# タブ3: 確定申告シミュレーション
# ==========================================================
with tab_tax:
    st.header("税金シミュレーション")
    st.info("※このシミュレーションは概算です。正確な税額は確定申告書作成ソフト等でご確認ください。")

    # --- 1. データの読み込み ---
    target_tax_year = st.selectbox("対象年度", [2024, 2025, 2026], index=1)
    
    # 税金設定をDBから読込
    db_data = load_tax_simulation(target_tax_year) or {}
    
    # 配当金データの取得と分類
    all_div_df = load_data()
    div_jpy_tokutei_ori = 0 #DBからの特定口座日本株取得金額
    div_jpy_tokutei = 0 #税引き前特定口座日本株取得金額（概算額）
    div_usd_jpy_tokutei_ori = 0 #DBからの特定口座米国株取得金額
    div_usd_jpy_tokutei = 0 #税引き前特定口座米国株取得金額（概算額）
    
    if not all_div_df.empty:
        all_div_df['total_jpy'] = all_div_df['amount_tokutei'] + all_div_df['amount_nisa']
        year_div_df = all_div_df[all_div_df['year'] == target_tax_year]
        
        # 日本株 (JPY) の特定口座分をDBから取得
        div_jpy_tokutei_ori = year_div_df[year_div_df['currency'] == 'JPY']['amount_tokutei'].sum()
        # 税抜き前の概算額を算出（20.315%）
        div_jpy_tokutei = round(div_jpy_tokutei_ori * 100 / (100-20.315), 0)
        # 米国株 (USD) の特定口座分をDBから取得
        div_usd_jpy_tokutei_ori = year_div_df[year_div_df['currency'] == 'USD']['amount_tokutei'].sum()
        # 税抜き前の概算額を算出（約28.3%）
        div_usd_jpy_tokutei = round(div_usd_jpy_tokutei_ori * 100 / (100-28.3), 0)

    total_dividend_income = div_jpy_tokutei + div_usd_jpy_tokutei

    # --- 2. 入力セクション ---
    with st.expander("基本データの入力", expanded=True):
        col1, col2 = st.columns(2)
        with col1:
            sales = st.number_input("売上（事業収入）", min_value=0, step=10000, value=int(db_data.get("sales", 5000000)))
            expenses = st.number_input("経費", min_value=0, step=10000, value=int(db_data.get("expenses", 1000000)))
            # 青色申告特別控除
            blue_deduction = 650000
        with col2:
            # 配当金セクション（閲覧専用）
            st.markdown("**📊 配当収入（税引き前、特定口座のみ）**")
            c_div1, c_div2 = st.columns(2)
            
            # 日本株の内訳を表示
            c_div1.caption("日本株")
            c_div1.text(f"{div_jpy_tokutei:,.0f} 円")
            
            # 米国株の合計を表示
            c_div2.caption("米国株（円換算）")
            c_div2.text(f"{div_usd_jpy_tokutei:,.0f} 円")
            
            # 合計所得（申告対象のみ）
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

    # --- 3. 計算ロジック（表示用） ---
    business_income = max(0, sales - expenses - blue_deduction)
    # 申告対象の配当所得を合算
    total_income = business_income + total_dividend_income
    
    total_deductions = pension + h_ins + ideco + furusato + medical + 680000 # 基礎控除680,000円
    taxable_income = max(0, total_income - total_deductions)

    # 【所得税】
    calc_taxable = int((taxable_income // 1000) * 1000)

    # ㉜番：所得税額の算出
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

    # ㉝ 配当控除 (日本株特定口座配当の10%)
    dividend_deduction = round(div_jpy_tokutei * 0.10, -1)

    # ㊶ 差引所得税額 (㉜ - ㉝)
    standard_tax = max(0, income_tax - dividend_deduction)

    # ㊹ 復興特別所得税 (基準所得税額 × 2.1%)
    reconstruction_tax = int(standard_tax * 0.021)

    # ㊺ 所得税及び復興特別所得税の額 (㊸ + ㊹)
    total_income_tax_with_reconstruction = standard_tax + reconstruction_tax

    # ㊼ 外国税額控除等
    foreign_withholding_tax = round(div_usd_jpy_tokutei * 0.10,-1)
    
    # 所得税控除限度額の計算
    if total_income > 0:
        limit_foreign_tax_credit = int(total_income_tax_with_reconstruction * (div_usd_jpy_tokutei / total_income))
    else:
        limit_foreign_tax_credit = 0
        
    # 3. 実際の控除額 (現地税と限度額の小さい方)
    foreign_tax_credit = min(foreign_withholding_tax, limit_foreign_tax_credit)

    # ㊾ 源泉徴収税額 (所得税分 15.315%)
    withholding_tax = int((div_jpy_tokutei + div_usd_jpy_tokutei*0.9) * 0.15315)

    # ㊿ 申告納税額 (㊺ - ㊼ - ㊾)
    final_tax_amount = round(total_income_tax_with_reconstruction - foreign_tax_credit - withholding_tax, -2)

    # 【住民税】
    # 1. 住民税用の課税所得
    residence_total_deductions = pension + h_ins + ideco + medical + 430000
    residence_taxable_income = max(0, round(total_income - residence_total_deductions, -2))
    
    # 2. 所得割（10%）の計算
    residence_income = residence_taxable_income * 0.10
    
    # 3. 調整控除（人的控除の差の調整）
    if residence_taxable_income <= 2000000:
        adjustment_deduction = min(50000, residence_taxable_income) * 0.05
    else:
        adjustment_deduction = max(2500, (50000 - (residence_taxable_income - 2000000)) * 0.05)

    # 4. 配当控除（住民税分 2.8%）
    residence_dividend_deduction = int(div_jpy_tokutei * 0.028)

    # 5. ★ ふるさと納税控除（寄附金税額控除）
    if furusato > 2000:
        target_furusato = furusato - 2000
        # 基本分
        furusato_basic = target_furusato * 0.10
        # 特例分（所得税率を適用して計算）
        # ※所得税率 = income_tax / calc_taxable (概算)
        current_tax_rate = (income_tax / calc_taxable) if calc_taxable > 0 else 0
        furusato_special = target_furusato * (0.90 - current_tax_rate * 1.021)
        
        # 特例分は所得割の20%が上限
        furusato_special = min(furusato_special, residence_income * 0.20)
        
        furusato_residence_deduction = furusato_basic + furusato_special
    else:
        furusato_residence_deduction = 0

    # 6. 所得割の確定 (所得割 - 調整控除 - 配当控除 - ふるさと納税控除)
    residence_income_tax_final = max(0, residence_income - adjustment_deduction - residence_dividend_deduction - furusato_residence_deduction)
    
    # 7. 均等割 (5,000円)
    residence_fixed = 5000
    
    # 最終的な住民税額
    residence_tax = int(residence_income_tax_final + residence_fixed)
    
    # 【消費税】
    consumption_tax = int(sales * 0.1) 
    
    # ふるさと納税限度額
    furusato_limit = int((taxable_income * 0.1 * 0.2) / (0.9 - income_tax / (calc_taxable if calc_taxable > 0 else 1) * 1.021) + 2000)

    # --- 4. 保存ボタン ---
    if st.button(f"📅 {target_tax_year}年度のデータを保存", use_container_width=True):
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
    # 表示も新しい最終納税額（㊿）に変更
    m_col1.metric("所得税", f"{final_tax_amount:,.0f} 円", help="マイナスは還付の目安です")
    m_col2.metric("住民税（次年度分）", f"{residence_tax:,.0f} 円")
    m_col3.metric("消費税", f"{consumption_tax:,.0f} 円")

    m_col4, m_col5 = st.columns(2)
    m_col4.metric("国民健康保険料（次年度分）", f"{h_ins:,.0f} 円")
    m_col5.metric("ふるさと納税限度額", f"{furusato_limit:,.0f} 円")

    tax_vis_data = {
        "項目": ["所得税", "住民税", "消費税", "社会保険料"],
        "金額": [total_income_tax_with_reconstruction, residence_tax, consumption_tax, pension + h_ins]
    }
    st.plotly_chart(px.bar(tax_vis_data, x="項目", y="金額", color="項目", title="支払うべき公租公課の内訳"), use_container_width=True)