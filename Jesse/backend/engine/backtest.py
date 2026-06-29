import numpy as np
import pandas as pd
from typing import Dict, List, Any

class StockBacktester:
    def __init__(self, df: pd.DataFrame, initial_capital: float = 100000.0):
        """
        df columns: ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
        Expects prices to be split/dividend adjusted.
        """
        self.df = df.copy().reset_index(drop=True)
        # Ensure Date column is string format for JSON serialization
        if 'Date' in self.df.columns:
            self.df['Date'] = self.df['Date'].astype(str)
        self.initial_capital = initial_capital
        
    def calculate_indicators(self, donchian_period: int = 20, ema_period: int = 100, atr_period: int = 14) -> pd.DataFrame:
        df = self.df
        
        # Donchian Channels (shifted by 1 to prevent lookahead bias)
        df['donchian_high'] = df['High'].shift(1).rolling(window=donchian_period).max()
        df['donchian_low'] = df['Low'].shift(1).rolling(window=donchian_period).min()
        
        # Exponential Moving Average (EMA)
        df['ema_trend'] = df['Close'].ewm(span=ema_period, adjust=False).mean()
        
        # Average True Range (ATR)
        high_low = df['High'] - df['Low']
        high_close = np.abs(df['High'] - df['Close'].shift(1))
        low_close = np.abs(df['Low'] - df['Close'].shift(1))
        ranges = pd.concat([high_low, high_close, low_close], axis=1)
        true_range = ranges.max(axis=1)
        df['atr'] = true_range.rolling(window=atr_period).mean()
        
        return df

    def run(self, donchian_period: int = 20, ema_period: int = 100, 
            atr_period: int = 14, atr_multiplier: float = 2.0, 
            risk_percent: float = 0.02) -> Dict[str, Any]:
        
        df = self.calculate_indicators(donchian_period, ema_period, atr_period)
        
        capital = self.initial_capital
        position = 0.0  # units of shares
        entry_price = 0.0
        stop_loss = 0.0
        trades: List[Dict[str, Any]] = []
        equity_curve: List[float] = []
        
        for i in range(len(df)):
            current_close = df.loc[i, 'Close']
            current_date = df.loc[i, 'Date']
            
            # Skip rows before indicators are calculated
            if pd.isna(df.loc[i, 'donchian_high']) or pd.isna(df.loc[i, 'atr']) or pd.isna(df.loc[i, 'ema_trend']):
                equity_curve.append(capital)
                continue
                
            if position == 0.0:  # Flat: look for breakout entries
                if (current_close > df.loc[i, 'donchian_high']) and (current_close > df.loc[i, 'ema_trend']):
                    # Long Entry
                    entry_price = current_close
                    atr_val = df.loc[i, 'atr']
                    stop_loss = entry_price - (atr_val * atr_multiplier)
                    
                    # Risk-based position sizing
                    risk_amount = capital * risk_percent
                    risk_per_share = entry_price - stop_loss
                    
                    if risk_per_share > 0:
                        position = risk_amount / risk_per_share
                        # Cap by available capital
                        if position * entry_price > capital:
                            position = capital / entry_price
                        
                        capital -= position * entry_price
                        trades.append({
                            'entry_date': current_date,
                            'entry_price': float(entry_price),
                            'stop_loss': float(stop_loss),
                            'shares': float(position),
                            'status': 'OPEN'
                        })
            else:  # In position: check stop loss and exit
                # Check Stop Loss first (Gap Risk/Intraday)
                if df.loc[i, 'Low'] <= stop_loss:
                    # SL trigger - exit at SL or Open if gap-down
                    exit_price = min(stop_loss, df.loc[i, 'Open'])
                    capital += position * exit_price
                    
                    trades[-1].update({
                        'exit_date': current_date,
                        'exit_price': float(exit_price),
                        'status': 'CLOSED',
                        'pnl': float((exit_price - entry_price) * position),
                        'return_pct': float((exit_price - entry_price) / entry_price)
                    })
                    position = 0.0
                    
                # Check Donchian Lower Band Exit
                elif current_close < df.loc[i, 'donchian_low']:
                    exit_price = current_close
                    capital += position * exit_price
                    
                    trades[-1].update({
                        'exit_date': current_date,
                        'exit_price': float(exit_price),
                        'status': 'CLOSED',
                        'pnl': float((exit_price - entry_price) * position),
                        'return_pct': float((exit_price - entry_price) / entry_price)
                    })
                    position = 0.0
            
            # Daily Equity valuation
            current_equity = capital + (position * current_close)
            equity_curve.append(float(current_equity))
            
        return {
            'equity_curve': equity_curve,
            'trades': [t for t in trades if t['status'] == 'CLOSED'],
            'final_equity': equity_curve[-1] if equity_curve else self.initial_capital
        }
