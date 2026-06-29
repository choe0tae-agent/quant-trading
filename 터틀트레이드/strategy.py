import pandas as pd
import numpy as np
import logging

logger = logging.getLogger(__name__)

class TurtleSignalGenerator:
    """
    터틀 트레이딩 전략에 필요한 지표(Donchian Channel, ATR, 200일 SMA)를 계산하는 클래스입니다.
    """
    def __init__(self, entry_window: int = 20, exit_window: int = 10, atr_window: int = 20, trend_window: int = 200):
        """
        Parameters:
        -----------
        entry_window : int
            진입 돌파 채널 기간 (기본값 20일)
        exit_window : int
            청산 돌파 채널 기간 (기본값 10일)
        atr_window : int
            ATR(Average True Range) 계산 기간 (기본값 20일)
        trend_window : int
            추세 필터 이동평균선 기간 (기본값 200일)
        """
        self.entry_window = entry_window
        self.exit_window = exit_window
        self.atr_window = atr_window
        self.trend_window = trend_window

    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        데이터프레임에 터틀 전략에 필요한 지표들을 추가합니다.
        
        지표 목록:
        - 200일 SMA (추세 필터)
        - 20일 고점 (진입 채널 상단)
        - 10일 저점 (청산 채널 하단)
        - 20일 ATR (포지션 사이징 및 손절선 설정용)

        Parameters:
        -----------
        df : pd.DataFrame
            주가 데이터 프레임 (Open, High, Low, Close 필요)

        Returns:
        --------
        pd.DataFrame
            지표가 추가된 데이터 프레임
        """
        logger.info("기술적 지표 계산 시작...")
        
        # 원본 데이터 보호를 위해 복사본 사용
        data = df.copy()

        # 1. 200일 이동평균선 (추세 필터)
        data['SMA_200'] = data['Close'].rolling(window=self.trend_window).mean()

        # 2. 돈치안 채널 계산 (Look-ahead bias 방지를 위해 .shift(1) 필수 사용)
        # 당일 돌파 여부를 판단하기 위해 '어제까지의 20일 고점' 및 '어제까지의 10일 저점'을 구함
        data['Entry_High'] = data['High'].shift(1).rolling(window=self.entry_window).max()
        data['Exit_Low'] = data['Low'].shift(1).rolling(window=self.exit_window).min()

        # 3. True Range (TR) 및 ATR (Average True Range) 계산
        # TR = max(High - Low, |High - Close_prev|, |Low - Close_prev|)
        h_l = data['High'] - data['Low']
        h_pc = (data['High'] - data['Close'].shift(1)).abs()
        l_pc = (data['Low'] - data['Close'].shift(1)).abs()
        
        data['TR'] = pd.concat([h_l, h_pc, l_pc], axis=1).max(axis=1)
        
        # Wilder's Moving Average 방식을 사용한 ATR 계산 (ewm의 alpha = 1 / window)
        data['ATR'] = data['TR'].ewm(alpha=1/self.atr_window, adjust=False).mean()

        # 불필요한 임시 컬럼 삭제
        data.drop(columns=['TR'], inplace=True, errors='ignore')
        
        logger.info("기술적 지표 계산 완료.")
        return data

# 모듈 단독 실행 테스트용 코드
if __name__ == "__main__":
    from data_downloader import DataDownloader
    downloader = DataDownloader()
    try:
        df = downloader.download_data("BTC-USD", "2023-01-01", "2023-12-31")
        generator = TurtleSignalGenerator()
        df_indicators = generator.calculate_indicators(df)
        print(df_indicators[['Close', 'SMA_200', 'Entry_High', 'Exit_Low', 'ATR']].tail())
    except Exception as ex:
        print(f"테스트 실패: {ex}")
