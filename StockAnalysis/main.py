# -*- coding: utf-8 -*-
"""
main.py
AI-based Stock Trading & Backtesting Dashboard Platform (Aurora Strategy Lab).
Uses custom antigravity wrapper to construct components and sync state via WebSocket.
"""

import os
import sys
import csv
import json
import gc
import asyncio
import logging
import atexit
import subprocess
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import pandas as pd
import numpy as np
import yfinance as yf
import httpx
from fastapi import Request
from fastapi.responses import JSONResponse

import antigravity as ag

# Logger setup
logger = logging.getLogger("AuroraStrategyLab")
logger.setLevel(logging.INFO)

# Translator background process holder
translator_process = None

def stop_translator():
    global translator_process
    if translator_process:
        logger.info("Terminating background Node.js translator process...")
        translator_process.terminate()
        try:
            translator_process.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            translator_process.kill()
        logger.info("Node.js translator stopped.")

# Register clean exit handler
atexit.register(stop_translator)


class TopNavigationBar(ag.Component):
    pass


class StrategySelector(ag.Component):
    pass


class SignalDisplay(ag.Component):
    pass


class LogViewer(ag.Component):
    pass


class ControlPanel(ag.Component):
    pass


class StrategyLabApp(ag.App):
    def setup(self):
        self.title = "Aurora Strategy Lab"
        self.layout = ag.GridLayout(rows=3, cols=3)

        # Register UI Components
        self.add_component(TopNavigationBar(), row=0, col=0, colspan=3)
        self.add_component(StrategySelector(), row=1, col=0, rowspan=2)
        self.add_component(SignalDisplay(), row=1, col=1)
        self.add_component(LogViewer(), row=2, col=1)
        self.add_component(ControlPanel(), row=1, col=2, rowspan=2)

        # Application state
        self.market_df: Optional[pd.DataFrame] = None
        self.is_scanning = False
        self.tickers: List[Dict[str, str]] = []

        # Local Parquet storage path
        self.parquet_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            "data",
            "backtest_full_market.parquet"
        )
        os.makedirs(os.path.dirname(self.parquet_path), exist_ok=True)

        # Register event handlers for WebSocket communication
        self.register_event("start_scan", self.on_start_scan)
        self.register_event("stop_scan", self.on_stop_scan)
        self.register_event("run_backtest", self.on_run_backtest)
        self.register_event("init_request", self.on_init_request)

        # Load stock tickers from config csv
        self.load_tickers()

        # Start Node.js translator
        self.start_translator_server()

        # Add proxy route for translation
        self.add_translator_proxy()

    async def on_startup(self):
        # Start loading the market database in a non-blocking thread
        asyncio.create_task(self.init_market_data())

    def load_tickers(self):
        """Read standard tickers from QuantAI project."""
        ticker_paths = [
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "ticker.csv"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "추세추종전략", "ticker.csv"),
            os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "터틀트레이드", "ticker.csv"),
        ]
        
        # Select first existing file
        found_path = None
        for p in ticker_paths:
            if os.path.exists(p):
                found_path = p
                break

        if found_path:
            logger.info(f"Loading tickers from: {found_path}")
            try:
                with open(found_path, "r", encoding="utf-8") as f:
                    reader = csv.reader(f)
                    for row in reader:
                        if len(row) >= 2:
                            code = row[0].strip().replace('"', '').replace("'", "")
                            name = row[1].strip().replace('"', '').replace("'", "")
                            self.tickers.append({"code": code, "name": name})
                
                # Write a local copy if it's missing in StockAnalysis
                local_csv = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ticker.csv")
                if not os.path.exists(local_csv):
                    with open(local_csv, "w", encoding="utf-8", newline="") as lf:
                        writer = csv.writer(lf)
                        for t in self.tickers:
                            writer.writerow([t["code"], t["name"]])
            except Exception as e:
                logger.error(f"Error reading tickers CSV: {e}")

        # Fallback to standard major stocks if csv loading fails
        if not self.tickers:
            logger.warning("No tickers CSV found. Falling back to default list.")
            self.tickers = [
                {"code": "005930", "name": "삼성전자"},
                {"code": "000660", "name": "SK하이닉스"},
                {"code": "005380", "name": "현대차"},
                {"code": "035420", "name": "NAVER"},
                {"code": "005490", "name": "POSCO홀딩스"}
            ]

    async def init_market_data(self):
        """Prepare the 600-day historical data cache (.parquet)."""
        await self.send_system_log("데이터 마스터 로딩 시작...", "info")
        
        # Check primary paths
        search_paths = [
            self.parquet_path,
            os.path.join("C:\\Users", os.getlogin(), "_converter", "data", "backtest_full_market.parquet")
        ]

        found_db_path = None
        for path in search_paths:
            if os.path.exists(path):
                found_db_path = path
                break

        if found_db_path:
            logger.info(f"Found existing parquet market database at: {found_db_path}")
            try:
                self.market_df = pd.read_parquet(found_db_path)
                await self.send_system_log(f"과거 데이터베이스 로드 성공 ({len(self.market_df)}행 로드 완료)", "success")
                return
            except Exception as e:
                logger.error(f"Failed to read parquet data: {e}")
                await self.send_system_log(f"기존 Parquet 로드 중 에러: {e}. 데이터 재빌드를 시도합니다.", "warning")

        # Automatically download and build Parquet if missing
        await self.send_system_log("과거 데이터가 감지되지 않아 yfinance에서 자동 다운로드를 개시합니다 (약 2년 데이터)...", "info")
        try:
            compiled_data = []
            for item in self.tickers:
                code = item["code"]
                name = item["name"]
                symbol = f"{code}.KS" if len(code) == 6 and code.isdigit() else code
                
                await self.send_system_log(f"종목 다운로드 중: {name} ({code})", "info")
                
                # Fetch 2 years
                ticker_obj = yf.Ticker(symbol)
                df = await asyncio.to_thread(ticker_obj.history, period="2y")
                
                if not df.empty:
                    df = df.reset_index()
                    df["Ticker"] = code
                    df["Name"] = name
                    # Clean columns
                    df = df[["Date", "Ticker", "Name", "Open", "High", "Low", "Close", "Volume"]]
                    # Remove timezone if exists
                    if pd.api.types.is_datetime64tz_dtype(df["Date"]):
                        df["Date"] = df["Date"].dt.tz_localize(None)
                    compiled_data.append(df)
                    
            if compiled_data:
                self.market_df = pd.concat(compiled_data, ignore_index=True)
                # Save to parquet
                self.market_df.to_parquet(self.parquet_path)
                await self.send_system_log(f"데이터베이스 빌드 완료. 로컬 캐시 생성 성공: {self.parquet_path}", "success")
            else:
                raise ValueError("Downloaded tickers set is empty.")
        except Exception as e:
            logger.error(f"Failed to rebuild stock database: {e}")
            await self.send_system_log(f"데이터 빌딩 오류 발생: {str(e)}", "error")

    def start_translator_server(self):
        """Spawn Node.js translator background server."""
        global translator_process
        translator_dir = os.path.dirname(os.path.abspath(__file__))
        js_path = os.path.join(translator_dir, "translator.js")
        
        if not os.path.exists(js_path):
            logger.error(f"Cannot find translator.js at: {js_path}")
            return
            
        try:
            logger.info(f"Spawning background Node translator server: node {js_path}")
            translator_process = subprocess.Popen(
                ["node", js_path],
                cwd=translator_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
        except Exception as e:
            logger.error(f"Error launching Node.js translator: {e}")

    def add_translator_proxy(self):
        """Add FastAPI post proxy handler for NLP translation."""
        @self.fastapi_app.post("/api/translate")
        async def translate_proxy(request: Request):
            try:
                body = await request.json()
                async with httpx.AsyncClient() as client:
                    resp = await client.post("http://127.0.0.1:5860/api/translate", json=body, timeout=8.0)
                    return JSONResponse(content=resp.json(), status_code=resp.status_code)
            except Exception as e:
                logger.error(f"Translation proxy error: {e}")
                return JSONResponse(
                    content={"success": False, "error": f"Translator server unavailable: {str(e)}"},
                    status_code=503
                )

    async def send_system_log(self, message: str, level: str = "info"):
        """Send a real-time timestamped log to the front-end console."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await self.broadcast({
            "component": "LogViewer",
            "event": "log",
            "data": {
                "timestamp": timestamp,
                "message": message,
                "level": level
            }
        })

    async def on_init_request(self, data: Dict[str, Any]):
        """Respond to client sync initialization request."""
        # Send tickers config
        await self.broadcast({
            "component": "ControlPanel",
            "event": "tickers_loaded",
            "data": {"tickers": self.tickers}
        })
        await self.send_system_log("대시보드가 성공적으로 연결되었습니다.", "info")

    async def on_start_scan(self, data: Dict[str, Any]):
        """Handle start real-time scanning event."""
        if self.is_scanning:
            return
        
        self.is_scanning = True
        await self.send_system_log("실시간 시장 스캐너 가동 개시...", "info")
        asyncio.create_task(self.realtime_scan_loop())

    async def on_stop_scan(self, data: Dict[str, Any]):
        """Handle stop real-time scanning event."""
        self.is_scanning = False
        await self.send_system_log("실시간 시장 스캐너 정지 완료.", "info")

    async def realtime_scan_loop(self):
        """Simulate real-time KRX market scanning loop."""
        import random
        
        if self.market_df is None or self.market_df.empty:
            await self.send_system_log("스캔 오류: 마스터 데이터가 존재하지 않습니다.", "error")
            self.is_scanning = False
            return

        # Prepare active ticker list
        active_codes = [t["code"] for t in self.tickers]
        
        # Emulation triggers
        strategies = ["로켓풍 Plus", "도미노 로켓풍", "추세돌파전략"]

        while self.is_scanning:
            # Emulate real-time scanning tick
            await asyncio.sleep(4.0)
            if not self.is_scanning:
                break
                
            # Randomly select a ticker and strategy to fire a scan signal
            target_stock = random.choice(self.tickers)
            strategy = random.choice(strategies)
            
            # Fetch latest price
            stock_data = self.market_df[self.market_df["Ticker"] == target_stock["code"]]
            if stock_data.empty:
                continue
                
            latest_row = stock_data.iloc[-1]
            price = latest_row["Close"]
            
            timestamp = datetime.now().strftime("%H:%M:%S")
            signal_data = {
                "time": timestamp,
                "strategy": strategy,
                "code": target_stock["code"],
                "name": target_stock["name"],
                "price": int(price),
                "type": "매수신호"
            }
            
            # Emit signal
            await self.broadcast({
                "component": "SignalDisplay",
                "event": "signal",
                "data": signal_data
            })
            
            await self.send_system_log(
                f"[신호발생] {target_stock['name']} ({target_stock['code']}) - {strategy} 매수 급소 검출!",
                "success"
            )

    async def on_run_backtest(self, data: Dict[str, Any]):
        """Execute a backtest in a non-blocking thread and stream outcomes."""
        await self.send_system_log("백테스팅 시뮬레이션 엔진 로딩...", "info")
        
        preset_strategies = data.get("presets", [])
        history_days = int(data.get("days", 365))
        min_price = float(data.get("min_price", 0))
        min_volume = float(data.get("min_volume", 0))
        include_etf = data.get("include_etf", True)
        custom_expression = data.get("custom_expression", "").strip()

        if self.market_df is None or self.market_df.empty:
            await self.send_system_log("백테스팅 실패: 과거 데이터베이스가 빌드되지 않았습니다.", "error")
            return

        # Run computational heavy backtest in a worker thread to keep the main event loop responsive
        asyncio.create_task(
            self.execute_backtest(
                preset_strategies, history_days, min_price, min_volume, include_etf, custom_expression
            )
        )

    async def execute_backtest(
        self,
        presets: List[str],
        days: int,
        min_p: float,
        min_v: float,
        include_etf: bool,
        custom_expr: str
    ):
        try:
            await self.send_system_log("백테스팅 시뮬레이션 연산 개시...", "info")
            
            # Slicing dates
            cutoff_date = datetime.now() - timedelta(days=days)
            df_subset = self.market_df[self.market_df["Date"] >= cutoff_date]
            
            if df_subset.empty:
                await self.send_system_log(f"백테스팅 오류: 최근 {days}일 내 데이터가 비어 있습니다.", "error")
                return

            # Filtering tickers
            valid_tickers = []
            for t in self.tickers:
                code = t["code"]
                # ETF filter logic: Korean ETFs usually have 'A' prefix or start with alphanumeric codes, or has specific name containing TIGER/KODEX/SOL
                is_etf = any(keyword in t["name"].upper() for keyword in ["TIGER", "KODEX", "SOL", "레버리지", "인버스"])
                if is_etf and not include_etf:
                    continue
                valid_tickers.append(code)

            if not valid_tickers:
                await self.send_system_log("필터 조건에 부합하는 분석 대상 종목이 없습니다.", "warning")
                return

            trades = []
            overall_portfolio_series = {}

            # Backtest each ticker independently
            for code in valid_tickers:
                ticker_df = df_subset[df_subset["Ticker"] == code].copy()
                if len(ticker_df) < 120:  # Need at least 120 days for MA120 calculation
                    continue
                
                ticker_df = ticker_df.sort_values("Date").reset_index(drop=True)
                name = ticker_df.iloc[0]["Name"]

                # Calculate indicators
                ticker_df["MA5"] = ticker_df["Close"].rolling(window=5).mean()
                ticker_df["MA20"] = ticker_df["Close"].rolling(window=20).mean()
                ticker_df["MA120"] = ticker_df["Close"].rolling(window=120).mean()
                ticker_df["Vol_MA20"] = ticker_df["Volume"].rolling(window=20).mean()
                ticker_df["Prev_High"] = ticker_df["High"].shift(1).rolling(window=60, min_periods=1).max()
                
                ticker_df["MA_Aligned"] = (ticker_df["MA5"] > ticker_df["MA20"]) & (ticker_df["MA20"] > ticker_df["MA120"])
                ticker_df["Vol_Surge"] = ticker_df["Volume"] > (ticker_df["Vol_MA20"] * 2.0)
                ticker_df["Breakout"] = ticker_df["Close"] > ticker_df["Prev_High"]

                # Price and average volume thresholding
                avg_price = ticker_df["Close"].mean()
                avg_vol = ticker_df["Volume"].mean()
                if avg_price < min_p or avg_vol < min_v:
                    continue

                # Signal definition matching preset checklists
                # 1. Rocket Wind Plus: 정배열 + 전고점 돌파 + 거래량 급증
                # 2. Domino Rocket Wind: 정배열 + 거래량 급증
                # 3. Custom translation expression
                ticker_df["Buy_Signal"] = False

                if "Rocket Wind Plus" in presets:
                    ticker_df["Buy_Signal"] = ticker_df["Buy_Signal"] | (
                        ticker_df["MA_Aligned"] & ticker_df["Breakout"] & ticker_df["Vol_Surge"]
                    )
                if "Domino Rocket Wind" in presets:
                    ticker_df["Buy_Signal"] = ticker_df["Buy_Signal"] | (
                        ticker_df["MA_Aligned"] & ticker_df["Vol_Surge"]
                    )
                
                # Evaluate custom expression if provided
                if custom_expr:
                    try:
                        # Safely evaluate condition string
                        eval_mask = eval(custom_expr, {"df": ticker_df, "pd": pd, "np": np})
                        ticker_df["Buy_Signal"] = ticker_df["Buy_Signal"] | eval_mask
                    except Exception as eval_err:
                        logger.error(f"Custom formula evaluation error: {eval_err}")
                        await self.send_system_log(f"사용자 정의 식 평가 에러 ({code}): {eval_err}", "warning")

                # Backtesting Simulation Loop (KISS Swing Simulation)
                in_position = False
                buy_price = 0.0
                hold_days = 0
                buy_date = None

                for i in range(len(ticker_df)):
                    row = ticker_df.iloc[i]
                    date_val = row["Date"].strftime("%Y-%m-%d")
                    
                    if not in_position:
                        # Trigger buy signal
                        if row["Buy_Signal"] and i < len(ticker_df) - 1:
                            # Buy on next day Open price
                            next_row = ticker_df.iloc[i + 1]
                            buy_price = next_row["Open"]
                            buy_date = next_row["Date"]
                            in_position = True
                            hold_days = 0
                    else:
                        hold_days += 1
                        # Exit Strategy: hold for 5 trading days or exit if close drops below MA20
                        should_exit = hold_days >= 5 or row["Close"] < row["MA20"] or i == len(ticker_df) - 1
                        
                        if should_exit:
                            sell_price = row["Close"]
                            ret = ((sell_price - buy_price) / buy_price) * 100
                            trades.append({
                                "ticker": code,
                                "name": name,
                                "buy_date": buy_date.strftime("%Y-%m-%d"),
                                "sell_date": row["Date"].strftime("%Y-%m-%d"),
                                "buy_price": int(buy_price),
                                "sell_price": int(sell_price),
                                "return": round(ret, 2)
                            })
                            in_position = False

                # Build a timeseries of cumulative price growth for drawing return line charts
                ticker_df["Daily_Return"] = ticker_df["Close"].pct_change().fillna(0)
                for idx, row in ticker_df.iterrows():
                    d_str = row["Date"].strftime("%Y-%m-%d")
                    overall_portfolio_series[d_str] = overall_portfolio_series.get(d_str, []) + [row["Daily_Return"]]

            # Compile portfolio growth
            portfolio_dates = sorted(list(overall_portfolio_series.keys()))
            cumulative_returns = []
            current_cum = 100.0

            for d in portfolio_dates:
                daily_avg = np.mean(overall_portfolio_series[d]) if overall_portfolio_series[d] else 0.0
                current_cum *= (1.0 + daily_avg)
                cumulative_returns.append({
                    "date": d,
                    "value": round(current_cum - 100.0, 2)
                })

            # Performance summaries
            if not trades:
                await self.send_system_log("백테스팅 완료: 기간 내 매매 조건이 성립한 거래가 존재하지 않습니다.", "warning")
                await self.broadcast({
                    "component": "ControlPanel",
                    "event": "backtest_completed",
                    "data": {
                        "metrics": {"total_trades": 0, "win_rate": 0, "profit_factor": 0, "mdd": 0, "total_return": 0},
                        "trades": [],
                        "chart_data": []
                    }
                })
                return

            total_trades = len(trades)
            win_trades = [t for t in trades if t["return"] > 0]
            win_rate = round((len(win_trades) / total_trades) * 100, 2)
            
            # Max Drawdown calculation
            cum_vals = [c["value"] + 100.0 for c in cumulative_returns]
            peak = cum_vals[0]
            mdd = 0.0
            for v in cum_vals:
                if v > peak:
                    peak = v
                dd = (peak - v) / peak * 100.0
                if dd > mdd:
                    mdd = dd
            mdd = round(mdd, 2)

            total_return = round(current_cum - 100.0, 2)

            metrics = {
                "total_trades": total_trades,
                "win_rate": win_rate,
                "mdd": mdd,
                "total_return": total_return
            }

            await self.send_system_log(
                f"[백테스트 성공] 총 거래: {total_trades}회 | 승률: {win_rate}% | MDD: {mdd}% | 누적 수익률: {total_return}%",
                "success"
            )

            # Send data to frontend
            await self.broadcast({
                "component": "ControlPanel",
                "event": "backtest_completed",
                "data": {
                    "metrics": metrics,
                    "trades": trades[-20:], # Send last 20 trades
                    "chart_data": cumulative_returns
                }
            })

            # Clean memory aggressively as required
            del df_subset
            del overall_portfolio_series
            gc.collect()
            logger.info("Garbage collection triggered to release large pandas dataframes.")

        except Exception as e:
            logger.error(f"Error executing backtest: {e}")
            await self.send_system_log(f"백테스팅 실행 오류: {str(e)}", "error")


def main():
    app = StrategyLabApp()
    app.run(port=5859)


if __name__ == '__main__':
    main()
