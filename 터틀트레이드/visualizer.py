import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import logging

logger = logging.getLogger(__name__)

class TurtleVisualizer:
    """
    백테스팅 결과를 차트로 시각화하는 클래스입니다. (한글 지원 및 맑은 고딕 적용)
    """
    def __init__(self, theme: str = 'seaborn-v0_8-whitegrid'):
        try:
            plt.style.use(theme)
        except Exception:
            plt.style.use('default')
        
        # Windows 환경의 한글 폰트 설정 (맑은 고딕) 및 마이너스 깨짐 방지
        plt.rcParams['font.family'] = 'Malgun Gothic'
        plt.rcParams['axes.unicode_minus'] = False

    def plot_results(self, result_df: pd.DataFrame, trade_signals: list, ticker: str, save_path: str = None):
        logger.info("차트 시각화 및 드로잉 시작...")
        
        fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 10), sharex=True, 
                                       gridspec_kw={'height_ratios': [2, 1]})
        
        # 종목명 가독성 개선 (삼성전자 대응)
        display_name = "삼성전자 (005930.KS)" if "005930" in ticker else ticker

        # --- Subplot 1: 가격, 이동평균선, 돈치안 채널 및 거래 시그널 ---
        ax1.plot(result_df.index, result_df['Close'], label='종가', color='#2c3e50', linewidth=1.5)
        ax1.plot(result_df.index, result_df['SMA_200'], label='200일 SMA (추세선)', color='#e67e22', linestyle='--', linewidth=1.2)
        ax1.plot(result_df.index, result_df['Entry_High'], label='20일 진입 채널 (고점)', color='#2ecc71', linestyle=':', alpha=0.7)
        ax1.plot(result_df.index, result_df['Exit_Low'], label='10일 청산 채널 (저점)', color='#e74c3c', linestyle=':', alpha=0.7)

        # 거래 시그널 플로팅
        buy_dates = [s['date'] for s in trade_signals if s['type'] == 'buy']
        buy_prices = [s['price'] for s in trade_signals if s['type'] == 'buy']
        
        exit_dates = [s['date'] for s in trade_signals if s['type'] == 'exit']
        exit_prices = [s['price'] for s in trade_signals if s['type'] == 'exit']
        
        stop_dates = [s['date'] for s in trade_signals if s['type'] == 'stop']
        stop_prices = [s['price'] for s in trade_signals if s['type'] == 'stop']

        # 진입(매수) - 녹색 위삼각형
        if buy_dates:
            ax1.scatter(buy_dates, buy_prices, marker='^', color='#2ecc71', s=100, label='매수 진입 (20일 돌파)', zorder=5)
            
        # 청산(10일 저점 이탈) - 적색 아래삼각형
        if exit_dates:
            ax1.scatter(exit_dates, exit_prices, marker='v', color='#e74c3c', s=100, label='포지션 청산 (10일 이탈)', zorder=5)
            
        # 손절(2 * ATR) - 황색 X
        if stop_dates:
            ax1.scatter(stop_dates, stop_prices, marker='x', color='#f1c40f', s=100, linewidths=3, label='손절매 (2*ATR)', zorder=5)

        ax1.set_title(f"터틀 트레이딩 시뮬레이션 - {display_name}", fontsize=16, fontweight='bold', pad=15)
        ax1.set_ylabel("가격 (KRW / USD)", fontsize=12)
        ax1.legend(loc='upper left', frameon=True, facecolor='white', edgecolor='none')
        ax1.grid(True, linestyle='--', alpha=0.5)

        # --- Subplot 2: 자산 곡선 및 낙폭(Drawdown) ---
        ax2.plot(result_df.index, result_df['Equity'], label='계좌 평가 자산', color='#3498db', linewidth=2.0)
        
        # 낙폭 음영 처리
        peak = result_df['Equity'].cummax()
        drawdown = (result_df['Equity'] - peak) / peak
        
        ax2.fill_between(result_df.index, drawdown * result_df['Equity'].iloc[0] + result_df['Equity'].iloc[0], 
                         result_df['Equity'].iloc[0], where=(drawdown < 0), 
                         color='#e74c3c', alpha=0.15, label='낙폭 영역 (Drawdown)')
        
        # 보조 y축을 활용한 낙폭 백분율 표시
        ax2_dd = ax2.twinx()
        ax2_dd.plot(result_df.index, drawdown * 100, color='#e74c3c', linestyle=':', alpha=0.4, linewidth=0.8)
        ax2_dd.set_ylabel("낙폭 비율 (%)", color='#e74c3c', fontsize=10)
        ax2_dd.tick_params(axis='y', labelcolor='#e74c3c')
        ax2_dd.grid(False)

        ax2.set_ylabel("자산 가치 (원화/달러)", fontsize=12)
        ax2.set_xlabel("날짜", fontsize=12)
        ax2.legend(loc='upper left', frameon=True, facecolor='white', edgecolor='none')
        ax2.grid(True, linestyle='--', alpha=0.5)

        # 날짜 표시 포맷 설정
        plt.gca().xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m-%d'))
        plt.gca().xaxis.set_major_locator(mdates.AutoDateLocator())
        fig.autofmt_xdate()
        
        plt.tight_layout()

        if save_path:
            plt.savefig(save_path, dpi=300)
            logger.info(f"결과 차트가 저장되었습니다: {save_path}")
        
        plt.show()
