# StrategyFactory AI Trading Bot Web App

A high-fidelity stock trading bot simulator and strategy backtester built in the Neo-Brutalist design language of [StrategyFactory.ai](https://strategyfactory.ai/).

## Features

1. **Dashboard**: Interactive KPIs, live trading bot fleet stats, scrolling recent entries/exits, and performance equity curve.
2. **Strategy Builder**: Backtest trading strategies (SMA Cross, RSI Overbought/Oversold, MACD, Bollinger Bands) on simulated stock price feeds. Review metrics like Return %, Max Drawdown %, Profit Factor, and Sharpe Ratio.
3. **Execution Bot Fleet**: Create and execute simulated bots. View a live-ticking chart displaying price, indicators, and buy/sell signals on screen.
4. **TradingView Webhooks**: Copy-paste JSON alert templates and connect simulated broker execution accounts.
5. **Pricing Matrix**: Compare features across different license tiers in high-fidelity Neo-Brutalist cards.

## Setup & Running

1. Open a terminal in this directory:
   ```bash
   cd c:/AIDev/QuantAI/stategyfactory
   ```
2. Install the lightweight development server:
   ```bash
   npm install
   ```
3. Launch the development server:
   ```bash
   npm run dev
   ```
4. Open the displayed URL (e.g., `http://localhost:5173`) in your browser.
