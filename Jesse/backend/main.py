import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Dict, Any, List

from engine.backtest import StockBacktester
from engine.validation import StatisticalValidator

app = FastAPI(title="Stock Algo-Trading Validation Server")

# Enable CORS for the React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For production, specify the client origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class BacktestRequest(BaseModel):
    ticker: str = Field(..., example="SPY")
    start_date: str = Field(..., example="2024-01-01")
    end_date: str = Field(..., example="2024-12-31")
    donchian_period: int = Field(20, ge=2, le=200)
    ema_period: int = Field(100, ge=10, le=500)
    atr_period: int = Field(14, ge=2, le=100)
    atr_multiplier: float = Field(2.0, ge=0.5, le=10.0)
    risk_percent: float = Field(0.02, ge=0.005, le=0.2)

@app.get("/api/status")
def get_status():
    return {"status": "online", "message": "Server is up and running"}

@app.post("/api/backtest")
def run_backtest(req: BacktestRequest):
    # 1. Fetch data from yfinance
    try:
        df = yf.download(req.ticker, start=req.start_date, end=req.end_date, auto_adjust=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch data from Yahoo Finance: {str(e)}")
        
    if df.empty:
        raise HTTPException(status_code=400, detail=f"No stock data found for ticker '{req.ticker}' in the selected date range.")
        
    # Flatten MultiIndex columns if present
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
        
    # Reset index to convert 'Date' index to column
    df = df.reset_index()
    df = df.rename(columns={'Date': 'Date'})
    
    # 2. Run Backtest
    backtester = StockBacktester(df)
    results = backtester.run(
        donchian_period=req.donchian_period,
        ema_period=req.ema_period,
        atr_period=req.atr_period,
        atr_multiplier=req.atr_multiplier,
        risk_percent=req.risk_percent
    )
    
    trades = results['trades']
    equity_curve = results['equity_curve']
    
    # 3. Calculate Performance Metrics
    initial_cap = backtester.initial_capital
    final_cap = results['final_equity']
    net_profit = final_cap - initial_cap
    net_profit_pct = (net_profit / initial_cap) * 100
    
    # Drawdown calculations
    equity_arr = np.array(equity_curve)
    running_max = np.maximum.accumulate(equity_arr)
    drawdowns = (equity_arr - running_max) / running_max
    max_dd_pct = float(np.min(drawdowns) * 100) if len(drawdowns) > 0 else 0.0
    
    # Annualized Sharpe ratio calculation (daily returns * sqrt(252))
    equity_series = pd.Series(equity_curve)
    daily_returns = equity_series.pct_change().dropna()
    if len(daily_returns) > 1 and daily_returns.std() > 0:
        sharpe = float((daily_returns.mean() / daily_returns.std()) * np.sqrt(252))
    else:
        sharpe = 0.0
        
    # Win rate
    wins = [t for t in trades if t['pnl'] > 0]
    win_rate = float(len(wins) / len(trades) * 100) if len(trades) > 0 else 0.0
    
    # Profit factor
    gains = sum([t['pnl'] for t in trades if t['pnl'] > 0])
    losses = sum([abs(t['pnl']) for t in trades if t['pnl'] < 0])
    profit_factor = float(gains / losses) if losses > 0 else (float('inf') if gains > 0 else 1.0)
    if np.isinf(profit_factor):
        profit_factor = 999.0  # Safe value for JSON serialization
        
    metrics = {
        "initial_equity": initial_cap,
        "final_equity": final_cap,
        "net_profit": net_profit,
        "net_profit_pct": net_profit_pct,
        "max_drawdown_pct": max_dd_pct,
        "sharpe_ratio": sharpe,
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "total_trades": len(trades)
    }
    
    # 4. Statistical Validation (RST and Monte Carlo)
    # Run 500 permutations for faster server response
    rst_results = StatisticalValidator.rule_significance_test(backtester, results, num_permutations=500)
    mc_results = StatisticalValidator.monte_carlo_trades(trades, num_simulations=500)
    
    # Format stock prices and indicators to send to frontend for charting
    # Send every index or sample to make charting smooth
    chart_df = backtester.calculate_indicators(
        donchian_period=req.donchian_period,
        ema_period=req.ema_period,
        atr_period=req.atr_period
    )
    
    # Fill NaN values to make JSON serialize safely
    chart_df = chart_df.fillna(method='bfill').fillna(0)
    
    history_data = []
    for idx, row in chart_df.iterrows():
        history_data.append({
            "date": str(row['Date'])[:10], # YYYY-MM-DD
            "price": float(row['Close']),
            "donchian_high": float(row['donchian_high']),
            "donchian_low": float(row['donchian_low']),
            "ema_trend": float(row['ema_trend']),
            "equity": float(equity_curve[idx]) if idx < len(equity_curve) else float(final_cap)
        })
        
    return {
        "metrics": metrics,
        "trades": trades,
        "rst": rst_results,
        "monte_carlo": {
            "median_final_equity": mc_results["median_final_equity"],
            "worst_5pct_drawdown_pct": mc_results["worst_5pct_drawdown"] * 100,
            "median_drawdown_pct": mc_results["median_drawdown"] * 100,
            "best_5pct_drawdown_pct": mc_results["best_5pct_drawdown"] * 100,
            "curves": mc_results["curves"]
        },
        "history": history_data
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
