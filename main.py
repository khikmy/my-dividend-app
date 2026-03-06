import streamlit as st
from utils import setup_ssl_environment

# SSL設定
setup_ssl_environment()

# --- 重要：サイドバーの表示をここで定義 ---
pages = {
    "■メニュー": [
        # default=True をつけることで、リロード時にこのページが初期表示される
        st.Page("pages/dashboard.py", title="配当金ダッシュボード", default=True),
        st.Page("pages/stockList.py", title="保有銘柄一覧"),
        st.Page("pages/dividendRegistration.py", title="配当金データ登録"),
    ]
}

# ナビゲーションの実行
pg = st.navigation(pages)

# ページ全体の共通設定
st.set_page_config(page_title="配当管理アプリ", layout="wide")

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

# アプリを実行
pg.run()