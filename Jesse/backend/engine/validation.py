import numpy as np
import pandas as pd
from typing import Dict, Any, List
from .backtest import StockBacktester

class StatisticalValidator:
    @staticmethod
    def rule_significance_test(backtester: StockBacktester, original_metrics: Dict[str, Any], 
                               num_permutations: int = 1000) -> Dict[str, Any]:
        """
        Runs the Rule Significance Test (RST) by comparing strategy performance 
        against randomized entries to obtain a P-value.
        """
        original_profit = original_metrics['final_equity'] - backtester.initial_capital
        num_trades = len(original_metrics['trades'])
        
        if num_trades == 0:
            return {
                'p_value': 1.0, 
                'passed': False, 
                'percentile': 0.0,
                'distribution_mean': 0.0,
                'distribution_std': 0.0
            }
            
        random_profits = []
        n_bars = len(backtester.df)
        
        # Calculate average holding period of original trades
        holding_periods = []
        for t in original_metrics['trades']:
            # Find the number of index steps between entry and exit
            entry_idx = backtester.df[backtester.df['Date'] == t['entry_date']].index
            exit_idx = backtester.df[backtester.df['Date'] == t['exit_date']].index
            if len(entry_idx) > 0 and len(exit_idx) > 0:
                holding_periods.append(int(exit_idx[0] - entry_idx[0]))
                
        avg_holding = int(np.mean(holding_periods)) if holding_periods else 10
        avg_holding = max(1, avg_holding)
        
        # Run permutation tests
        for _ in range(num_permutations):
            # Select random entry indices
            random_entries = np.random.choice(n_bars - avg_holding - 1, size=num_trades, replace=True)
            
            capital = backtester.initial_capital
            pnl_sum = 0.0
            
            for idx in random_entries:
                exit_idx = idx + avg_holding
                entry_p = backtester.df.loc[idx, 'Close']
                exit_p = backtester.df.loc[exit_idx, 'Close']
                
                # Sizing mock: 2% risk, assume 5% initial stop loss for safety
                risk_amount = capital * 0.02
                stop_loss = entry_p * 0.95
                risk_per_share = entry_p - stop_loss
                
                if risk_per_share > 0:
                    shares = risk_amount / risk_per_share
                    # Cap by capital
                    if shares * entry_p > capital:
                        shares = capital / entry_p
                    pnl = (exit_p - entry_p) * shares
                    pnl_sum += pnl
                    
            random_profits.append(pnl_sum)
            
        random_profits = np.array(random_profits)
        better_runs = np.sum(random_profits >= original_profit)
        p_value = better_runs / num_permutations
        
        return {
            'p_value': float(p_value),
            'passed': bool(p_value < 0.05),
            'percentile': float(np.sum(original_profit > random_profits) / num_permutations * 100),
            'distribution_mean': float(np.mean(random_profits)),
            'distribution_std': float(np.std(random_profits))
        }

    @staticmethod
    def monte_carlo_trades(trades: List[Dict[str, Any]], num_simulations: int = 500) -> Dict[str, Any]:
        """
        Shuffles the sequence of actual trade outcomes to simulate paths and calculate drawdowns.
        """
        returns = np.array([t['return_pct'] for t in trades])
        if len(returns) == 0:
            return {'curves': [], 'worst_5pct_drawdown': 0.0, 'median_drawdown': 0.0, 'median_final_equity': 100.0}
            
        final_equities = []
        max_drawdowns = []
        simulation_curves = []
        
        # Track simulated equity curves (sampling up to 100 curves for visual display)
        for sim_idx in range(num_simulations):
            shuffled_returns = np.random.choice(returns, size=len(returns), replace=True)
            equity = 100.0  # Normalized base
            curve = [equity]
            
            for ret in shuffled_returns:
                equity = equity * (1.0 + ret)
                curve.append(equity)
                
            curve = np.array(curve)
            running_max = np.maximum.accumulate(curve)
            drawdowns = (curve - running_max) / running_max
            
            final_equities.append(equity)
            max_drawdowns.append(np.min(drawdowns))
            
            # Save only 100 sample curves for rendering efficiency
            if sim_idx < 100:
                simulation_curves.append([float(v) for v in curve])
                
        return {
            'curves': simulation_curves,
            'median_final_equity': float(np.median(final_equities)),
            'worst_5pct_drawdown': float(np.percentile(max_drawdowns, 5)),
            'median_drawdown': float(np.median(max_drawdowns)),
            'best_5pct_drawdown': float(np.percentile(max_drawdowns, 95))
        }
