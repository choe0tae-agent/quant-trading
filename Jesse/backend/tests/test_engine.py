import pandas as pd
import pytest
from engine.backtest import StockBacktester
from engine.validation import StatisticalValidator

def test_strategy_engine():
    # 1. Create artificial trending data
    dates = pd.date_range(start="2025-01-01", periods=100, freq='D')
    # Generate a trend up and trend down pattern to trigger both entry and exit
    prices = []
    for i in range(100):
        if i < 50:
            prices.append(100.0 + 10.0 * i)
        else:
            prices.append(600.0 - 15.0 * (i - 50))
    highs = [p + 1.0 for p in prices]
    lows = [p - 1.0 for p in prices]
    
    data = pd.DataFrame({
        'Date': dates,
        'Open': prices,
        'High': highs,
        'Low': lows,
        'Close': prices,
        'Volume': [1000] * 100
    })
    
    # 2. Run Backtest
    backtester = StockBacktester(data, initial_capital=100000.0)
    results = backtester.run(donchian_period=5, ema_period=10, atr_period=5, atr_multiplier=2.0)
    
    # 3. Assertions
    assert results['final_equity'] > 100000.0, "Uptrend data should yield positive returns"
    assert len(results['trades']) > 0, "Engine must execute trades during a clear breakout"
    
    # 4. Statistical Validation Tests
    rst_results = StatisticalValidator.rule_significance_test(backtester, results, num_permutations=50)
    assert 'p_value' in rst_results
    assert 0.0 <= rst_results['p_value'] <= 1.0
    
    mc_results = StatisticalValidator.monte_carlo_trades(results['trades'], num_simulations=50)
    assert 'median_final_equity' in mc_results
    assert 'worst_5pct_drawdown' in mc_results
    print("Verification tests passed successfully!")

if __name__ == '__main__':
    pytest.main([__file__])
