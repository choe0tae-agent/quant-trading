import time
import requests
import yfinance as yf
import os
import csv

# ==========================================
# 1. Hyperliquid (Crypto Data Source)
# ==========================================

def get_hyperliquid_candles(symbol, timeframe, limit=200):
    """
    Fetches historical candlestick data from Hyperliquid Info API.
    """
    url = "https://api.hyperliquid.xyz/info"
    
    # Map timeframes to seconds
    tf_seconds = {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400
    }
    
    sec = tf_seconds.get(timeframe, 60)
    end_time_ms = int(time.time() * 1000)
    start_time_ms = end_time_ms - (limit * sec * 1000)
    
    payload = {
        "type": "candleSnapshot",
        "req": {
            "coin": symbol,
            "interval": timeframe,
            "startTime": start_time_ms,
            "endTime": end_time_ms
        }
    }
    
    headers = {"Content-Type": "application/json"}
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        if response.status_code == 200:
            candles = response.json()
            formatted = []
            for c in candles:
                formatted.append({
                    "time": int(c["t"] / 1000),  # Convert to seconds
                    "open": float(c["o"]),
                    "high": float(c["h"]),
                    "low": float(c["l"]),
                    "close": float(c["c"]),
                    "volume": float(c["v"])
                })
            # Ensure chronological order (ascending)
            formatted.sort(key=lambda x: x["time"])
            return formatted
    except Exception as e:
        print(f"Error fetching Hyperliquid candles for {symbol}: {e}")
    return []

def get_hyperliquid_quote(symbol):
    """
    Fetches the latest snapshot quote for Hyperliquid (useful as fallback).
    """
    candles = get_hyperliquid_candles(symbol, "1m", limit=2)
    if candles:
        last = candles[-1]
        return {
            "price": last["close"],
            "time": last["time"],
            "open": last["open"],
            "high": last["high"],
            "low": last["low"],
            "close": last["close"],
            "volume": last["volume"]
        }
    return None

def hyperliquid_source():
    """
    Returns the Hyperliquid broker configuration.
    """
    return {
        "name": "hyperliquid",
        "label": "하이퍼리퀴드 (실시간 가상자산)",
        "timeframes": ["1m", "5m", "15m", "1h", "4h", "1d"],
        "symbols": ["BTC", "ETH", "SOL", "ARB", "OP", "AVAX", "SUI", "APT", "XRP", "LTC", "LINK", "DOGE"],
        "history_fn": get_hyperliquid_candles,
        "quote_fn": get_hyperliquid_quote,
        "realtime": True  # Instructs frontend to use WebSocket
    }


# ==========================================
# 2. Yahoo Finance (Indian Stock Market)
# ==========================================

def get_yfinance_candles(symbol, timeframe, limit=200):
    """
    Fetches historical candlestick data from Yahoo Finance.
    """
    # Translate Korean symbol to ticker code if exists, otherwise fallback to code
    if symbol in _krx_name_to_ticker:
        symbol = _krx_name_to_ticker[symbol]
    else:
        symbol = symbol.split(" ")[0]
        
    # Map UI timeframes to yfinance interval and period bounds
    tf_map = {
        "1m": ("1m", "5d"),
        "5m": ("5m", "1mo"),
        "15m": ("15m", "1mo"),
        "1h": ("1h", "3mo"),
        "1d": ("1d", "1y")
    }
    
    interval, period = tf_map.get(timeframe, ("1d", "1y"))
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period=period, interval=interval)
        if df.empty:
            return []
        
        df = df.reset_index()
        time_col = df.columns[0]  # Usually Date or Datetime
        
        # Convert date/datetime column to epoch timestamp in seconds
        df["time"] = df[time_col].apply(lambda x: int(x.timestamp()))
        
        formatted = []
        for _, row in df.iterrows():
            formatted.append({
                "time": int(row["time"]),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": float(row["Volume"])
            })
        
        # Ensure chronological order
        formatted.sort(key=lambda x: x["time"])
        if len(formatted) > limit:
            formatted = formatted[-limit:]
        return formatted
    except Exception as e:
        print(f"Error fetching yfinance candles for {symbol}: {e}")
    return []

def get_yfinance_quote(symbol):
    """
    Fetches the active candle for yfinance by fetching the last 1m data points.
    If the market is closed (e.g. weekend), falls back to 5d history to retrieve
    the last available trading day's latest candle.
    """
    # Translate Korean symbol to ticker code if exists, otherwise fallback to code
    if symbol in _krx_name_to_ticker:
        symbol = _krx_name_to_ticker[symbol]
    else:
        symbol = symbol.split(" ")[0]
    
    try:
        ticker = yf.Ticker(symbol)
        df = ticker.history(period="1d", interval="1m")
        if df.empty:
            df = ticker.history(period="5d", interval="1m")
            
        if not df.empty:
            last_row = df.iloc[-1]
            timestamp = int(last_row.name.timestamp())
            return {
                "price": float(last_row["Close"]),
                "time": timestamp,
                "open": float(last_row["Open"]),
                "high": float(last_row["High"]),
                "low": float(last_row["Low"]),
                "close": float(last_row["Close"]),
                "volume": float(last_row["Volume"])
            }
    except Exception as e:
        print(f"Error fetching yfinance quote for {symbol}: {e}")
    return None

def yfinance_source():
    """
    Returns the Yahoo Finance broker configuration.
    """
    return {
        "name": "yfinance",
        "label": "야후 파이낸스 (인도 주식)",
        "timeframes": ["1m", "5m", "15m", "1h", "1d"],
        "symbols": [
            "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS", "ICICIBANK.NS", 
            "SBIN.NS", "BHARTIARTL.NS", "ITC.NS", "LT.NS", "M&M.NS", 
            "^NSEI", "^BSESN"
        ],
        "history_fn": get_yfinance_candles,
        "quote_fn": get_yfinance_quote,
        "realtime": False  # Instructs frontend to use Polling
    }

# ==========================================
# 3. Yahoo Finance (Korean Stock Market - KRX)
# ==========================================

_krx_name_to_ticker = {}

def load_krx_symbols_from_csv():
    """
    Reads KRX stock symbols and names from c:\AIDev\QuantAI\터틀트레이드\ticker.csv
    and formats them as just "NAME" options while storing code mapping.
    """
    global _krx_name_to_ticker
    csv_path = r"c:\AIDev\QuantAI\터틀트레이드\ticker.csv"
    if not os.path.exists(csv_path):
        defaults = {
            "삼성전자": "005930.KS",
            "SK하이닉스": "000660.KS",
            "현대차": "005380.KS",
            "KODEX 코스닥150": "220200.KS"
        }
        _krx_name_to_ticker.update(defaults)
        return list(defaults.keys())
    
    names = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.reader(f)
            for row in reader:
                if len(row) >= 2:
                    ticker = row[0].strip().strip('"').strip("'")
                    name = row[1].strip().strip('"').strip("'")
                    _krx_name_to_ticker[name] = ticker
                    names.append(name)
    except Exception as e:
        print(f"Error parsing KRX ticker.csv: {e}")
        
    return names if names else ["삼성전자", "SK하이닉스"]

# Initialize mapping at import time
load_krx_symbols_from_csv()

def krx_source():
    """
    Returns the KRX broker configuration.
    """
    return {
        "name": "krx",
        "label": "야후 파이낸스 (한국 주식)",
        "timeframes": ["1m", "5m", "15m", "1h", "1d"],
        "symbols": load_krx_symbols_from_csv(),
        "history_fn": get_yfinance_candles,
        "quote_fn": get_yfinance_quote,
        "realtime": False
    }


# ==========================================
# Registry Management
# ==========================================

def _register_all_sources():
    """
    Registers pluggable data sources.
    To add a new broker (e.g. Alpaca, Binance), define a function returning
    its metadata dict and register it here.
    """
    sources = [
        krx_source(),
        yfinance_source(),
        hyperliquid_source()
    ]
    return {src["name"]: src for src in sources}

def get_available_sources():
    """
    Returns sanitized metadata (excluding raw functions) for the frontend.
    """
    registry = _register_all_sources()
    sanitized = {}
    for name, src in registry.items():
        sanitized[name] = {
            "name": src["name"],
            "label": src["label"],
            "timeframes": src["timeframes"],
            "symbols": src["symbols"],
            "realtime": src["realtime"]
        }
    return sanitized

def get_source_data(source_name, symbol, timeframe, limit=200):
    """
    Retrieves history for a source.
    """
    registry = _register_all_sources()
    if source_name in registry:
        return registry[source_name]["history_fn"](symbol, timeframe, limit)
    return []

def get_source_quote(source_name, symbol):
    """
    Retrieves a live quote for a source.
    """
    registry = _register_all_sources()
    if source_name in registry:
        return registry[source_name]["quote_fn"](symbol)
    return None
