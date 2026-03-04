import os
import yfinance as yf
from curl_cffi import requests as curl_requests

def setup_ssl_environment():
    """通信エラーを回避するための環境変数設定"""
    os.environ['CURL_CA_BUNDLE'] = ""
    os.environ['SSL_CERT_FILE'] = ""

def check_dividend_status(ticker_code, currency):
    """Yahoo Financeから配当情報を取得し、増減配を判定する"""
    setup_ssl_environment()
    
    symbol = f"{ticker_code}.T" if currency == "JPY" else ticker_code
    
    try:
        custom_session = curl_requests.Session()
        custom_session.verify = False 
        custom_session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })

        stock = yf.Ticker(symbol, session=custom_session)
        divs = stock.dividends
        
        if divs.empty:
            return "データなし", "black", "配当履歴なし"

        divs.index = divs.index.tz_localize(None)
        latest_val = divs.iloc[-1]
        latest_date = divs.index[-1]
        
        target_year = latest_date.year - 1
        target_month = latest_date.month
        
        prev_divs = divs[(divs.index.year == target_year) & (divs.index.month == target_month)]
        
        if prev_divs.empty:
            prev_divs = divs[(divs.index.year == target_year) & 
                             (divs.index.month >= target_month - 1) & 
                             (divs.index.month <= target_month + 1)]

        unit = "円" if currency == "JPY" else "＄"
        l_disp = round(latest_val, 1)

        if not prev_divs.empty:
            prev_val = prev_divs.iloc[-1]
            p_disp = round(prev_val, 1)
            
            if prev_val > 0:
                change_rate = ((latest_val - prev_val) / prev_val) * 100
                rate_str = f"({change_rate:+.1f}%)"
            else:
                rate_str = ""

            if latest_val > prev_val:
                return "増配", "green", f"{p_disp}{unit} → {l_disp}{unit} {rate_str}"
            elif latest_val < prev_val:
                return "減配", "red", f"{p_disp}{unit} → {l_disp}{unit} {rate_str}"
            else:
                return "維持", "gray", f"{p_disp}{unit} → {l_disp}{unit} (0.0%)"
        else:
            return "前年データなし", "black", f"最新: {l_disp}{unit}"

    except Exception as e:
        if "429" in str(e):
            return "制限中 ⏳", "orange", "Yahoo制限中"
        return "エラー", "gray", f"取得失敗"