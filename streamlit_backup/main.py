import streamlit as st
from utils import setup_ssl_environment

# SSL設定
setup_ssl_environment()

# ページ全体の共通設定
st.set_page_config(page_title="資産管理アプリ", layout="wide")

# --- メニューバー、フッター、ヘッダーを全ページで非表示にする ---
st.markdown("""
    <style>
        #MainMenu {visibility: hidden;}
        footer {visibility: hidden;}
        header {visibility: hidden;}
        
        /* サイドバーを非表示にする */
        [data-testid="stSidebar"] {
            display: none;
        }
        /* コンテンツエリアを左に寄せて全幅にする */
        [data-testid="stSidebarCollapsedControl"] {
            display: none;
        }
    </style>
""", unsafe_allow_html=True)

# 1. 各ページをオブジェクトとして定義
dash_page = st.Page("pages/dashboard.py", title="配当金ダッシュボード", default=True)
reg_page  = st.Page("pages/dividendRegistration.py", title="配当金データ登録")
forex_page = st.Page("pages/foreignCurrencyList.py", title="保有外貨一覧")
stock_page = st.Page("pages/stockList.py", title="保有銘柄一覧")

# 2. ナビゲーションの定義
# 辞書形式のキーを「None」にすると、そのセクションはサイドバーで「ラベル無し」扱いになります。
# 完全にサイドバーから消すことはStreamlitの仕様（セキュリティと整合性）上できないため、
# 「隠しメニュー」として一番下に配置する構成が最も安定します。
pg = st.navigation({
    "■メニュー": [dash_page, reg_page, forex_page],
    " ": [stock_page]  # 半角スペースをキーにすることで、目立たない位置に配置
})

# セッション状態の初期化
initial_states = {
    "edit_data": None,
    "pre_code": "",
    "pre_name": "",
    "pre_currency": "JPY",
    "list_type_val": "すべて",
    "search_reset_seed": 0
}
for key, value in initial_states.items():
    if key not in st.session_state:
        st.session_state[key] = value

# 4. アプリを実行 (ここでpgが確実に定義されている必要があります)
pg.run()