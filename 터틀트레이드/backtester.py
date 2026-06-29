import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)

class TurtleBacktester:
    """
    터틀 트레이딩 전략의 백테스팅을 실행하고 성과를 분석하는 클래스입니다.
    """
    def __init__(self, initial_capital: float = 100000.0, risk_pct: float = 0.02, commission: float = 0.001, is_crypto: bool = True):
        """
        Parameters:
        -----------
        initial_capital : float
            초기 자금 (기본값 100,000 USD)
        risk_pct : float
            1회 거래당 총 자산 대비 감수할 리스크 비율 (기본값 2% = 0.02)
        commission : float
            거래 수수료 및 슬리피지 편도 요율 (기본값 0.1% = 0.001)
        is_crypto : bool
            가상자산 여부 (1년 영업일 계산 시 365일 vs 252일 구분용)
        """
        self.initial_capital = initial_capital
        self.risk_pct = risk_pct
        self.commission = commission
        self.is_crypto = is_crypto
        
        # 백테스트 결과 상태 초기화
        self.reset()

    def reset(self):
        """
        백테스터의 상태를 초기화합니다.
        """
        self.capital = self.initial_capital
        self.position = 0.0
        self.entry_price = 0.0
        self.entry_date = None
        self.stop_loss = 0.0
        
        self.trades = []
        self.equity_curve = []
        self.trade_signals = []  # 시각화용 신호 기록 (날짜, 타입: 'buy'/'exit'/'stop', 가격)

    def run(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        일별 루프를 돌며 백테스팅을 실행합니다.

        Parameters:
        -----------
        df : pd.DataFrame
            주가 데이터와 터틀 지표(SMA_200, Entry_High, Exit_Low, ATR)가 포함된 데이터프레임

        Returns:
        --------
        pd.DataFrame
            일별 자산 가치(Equity)와 자산 곡선 정보가 추가된 데이터프레임
        """
        logger.info("백테스팅 시뮬레이션 시작...")
        self.reset()
        
        result_df = df.copy()
        equities = []
        dates = []

        for idx, row in result_df.iterrows():
            date = idx
            close = row['Close']
            high = row['High']
            low = row['Low']
            open_price = row['Open']

            # 기술적 지표가 생성되기 전의 초기 기간은 건너뜀
            if pd.isna(row['Entry_High']) or pd.isna(row['ATR']) or pd.isna(row['SMA_200']):
                current_equity = self.capital
                equities.append(current_equity)
                dates.append(date)
                continue

            # --- 1. 포지션 보유 상태일 때: 청산 및 손절 여부 점검 ---
            if self.position > 0:
                is_stop_hit = low <= self.stop_loss
                is_exit_hit = low <= row['Exit_Low']

                if is_stop_hit or is_exit_hit:
                    # 두 신호가 동시에 발생할 경우, 더 높은(먼저 닿는) 가격을 출구 가격으로 지정
                    if is_stop_hit and is_exit_hit:
                        if self.stop_loss > row['Exit_Low']:
                            exit_price = min(self.stop_loss, open_price)
                            reason = 'Stop Loss'
                        else:
                            exit_price = min(row['Exit_Low'], open_price)
                            reason = '10D Low Break'
                    elif is_stop_hit:
                        exit_price = min(self.stop_loss, open_price)
                        reason = 'Stop Loss'
                    else:
                        exit_price = min(row['Exit_Low'], open_price)
                        reason = '10D Low Break'

                    # 청산 실행
                    revenue = self.position * exit_price * (1.0 - self.commission)
                    self.capital += revenue
                    
                    # 수수료를 반영한 거래 PnL 계산
                    entry_cost = self.position * self.entry_price * (1.0 + self.commission)
                    exit_revenue = self.position * exit_price * (1.0 - self.commission)
                    pnl = exit_revenue - entry_cost
                    return_pct = (pnl / entry_cost) * 100

                    self.trades.append({
                        'entry_date': self.entry_date,
                        'entry_price': self.entry_price,
                        'size': self.position,
                        'exit_date': date,
                        'exit_price': exit_price,
                        'exit_reason': reason,
                        'pnl': pnl,
                        'return_pct': return_pct
                    })

                    self.trade_signals.append({
                        'date': date,
                        'type': 'stop' if reason == 'Stop Loss' else 'exit',
                        'price': exit_price
                    })

                    logger.info(f"[{date.strftime('%Y-%m-%d')}] 청산 실행 | 이유: {reason} | 청산가: {exit_price:,.2f} | PnL: {pnl:,.2f} ({return_pct:.2f}%)")
                    
                    self.position = 0.0
                    self.entry_price = 0.0
                    self.stop_loss = 0.0
                    self.entry_date = None

            # --- 2. 포지션 미보유 상태일 때: 진입 여부 점검 ---
            elif self.position == 0:
                # 20일 고점 돌파 및 200일선 위에 종가가 있을 때 매수 진입
                if high >= row['Entry_High'] and close > row['SMA_200']:
                    # 진입가: 돌파 기준가 또는 당일 시가 중 더 높은 가격 (갭상승 대응)
                    entry_price = max(row['Entry_High'], open_price)
                    
                    # 총자산 계산 (현재 예수금)
                    current_equity = self.capital
                    
                    # 리스크 관리 포지션 사이징: 자산의 2% 리스크 기준
                    # Unit = (Equity * 0.02) / (2 * ATR)
                    risk_value = current_equity * self.risk_pct
                    atr_value = row['ATR']
                    
                    if atr_value > 0:
                        size = risk_value / (2 * atr_value)
                    else:
                        size = 0.0
                    
                    # 예수금 한도 체크 및 수수료 고려한 실제 진입 가능 수량 조정
                    max_affordable_size = self.capital / (entry_price * (1.0 + self.commission))
                    if size > max_affordable_size:
                        size = max_affordable_size
                    
                    if size > 0:
                        self.position = size
                        self.entry_price = entry_price
                        self.entry_date = date
                        self.stop_loss = entry_price - 2 * atr_value
                        
                        cost = self.position * entry_price * (1.0 + self.commission)
                        self.capital -= cost
                        
                        self.trade_signals.append({
                            'date': date,
                            'type': 'buy',
                            'price': entry_price
                        })
                        
                        logger.info(f"[{date.strftime('%Y-%m-%d')}] 진입 실행 | 진입가: {entry_price:,.2f} | 수량: {size:.4f} | 손절가: {self.stop_loss:,.2f}")

            # 현재 계좌 가치 기록 (예수금 + 보유 자산 평가액)
            current_equity = self.capital + (self.position * close)
            equities.append(current_equity)
            dates.append(date)

        # 결과 데이터프레임에 자산 가치 추가
        result_df['Equity'] = equities
        
        logger.info("백테스팅 시뮬레이션 완료.")
        return result_df

    def calculate_performance(self, result_df: pd.DataFrame) -> dict:
        """
        백테스트 결과를 바탕으로 투자 성과 지표를 계산합니다.
        """
        if len(result_df) == 0:
            return {}

        equity_series = result_df['Equity']
        initial_val = self.initial_capital
        final_val = equity_series.iloc[-1]

        # 누적 수익률
        total_return = (final_val / initial_val - 1) * 100

        # 바이앤홀드(단순 보유) 수익률
        close_series = result_df['Close']
        bh_return = (close_series.iloc[-1] / close_series.iloc[0] - 1) * 100

        # 최대 낙폭 (MDD: Maximum Drawdown)
        peak = equity_series.cummax()
        drawdown = (equity_series - peak) / peak
        mdd = drawdown.min() * 100

        # 거래 횟수 및 승률
        total_trades = len(self.trades)
        winning_trades = sum(1 for t in self.trades if t['pnl'] > 0)
        win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0.0

        # 일일 수익률 기반 샤프 지수 계산
        daily_returns = equity_series.pct_change().dropna()
        trading_days = 365 if self.is_crypto else 252
        
        if daily_returns.std() != 0:
            sharpe = (daily_returns.mean() / daily_returns.std()) * np.sqrt(trading_days)
        else:
            sharpe = 0.0

        metrics = {
            'Initial Capital': initial_val,
            'Final Capital': final_val,
            'Total Return (%)': total_return,
            'Buy & Hold Return (%)': bh_return,
            'Max Drawdown (%)': mdd,
            'Total Trades': total_trades,
            'Win Rate (%)': win_rate,
            'Sharpe Ratio': sharpe
        }
        return metrics

    def get_trades_df(self) -> pd.DataFrame:
        """
        기록된 거래 이력을 DataFrame으로 반환합니다.
        """
        return pd.DataFrame(self.trades)
