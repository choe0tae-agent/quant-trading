import pandas as pd
import yfinance as yf
import logging

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class DataDownloader:
    """
    yfinance 라이브러리를 사용하여 주식 또는 가상자산의 과거 데이터를 다운로드하는 클래스입니다.
    """
    def __init__(self):
        pass

    def download_data(self, ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
        """
        지정된 티커와 기간의 데이터를 다운로드합니다.

        Parameters:
        -----------
        ticker : str
            다운로드할 자산의 티커 심볼 (예: 'BTC-USD', 'AAPL')
        start_date : str
            시작일 (YYYY-MM-DD 형식)
        end_date : str
            종료일 (YYYY-MM-DD 형식)

        Returns:
        --------
        pd.DataFrame
            다운로드된 주가 데이터 프레임
        """
        logger.info(f"데이터 다운로드 시작: {ticker} ({start_date} ~ {end_date})")
        
        try:
            # yfinance를 사용하여 데이터 다운로드
            df = yf.download(ticker, start=start_date, end=end_date)
            
            # 데이터가 비어있는지 확인
            if df.empty:
                raise ValueError(f"다운로드된 데이터가 없습니다. 티커({ticker}) 또는 날짜 범위를 확인해 주세요.")
            
            # 데이터 정합성 검증 (필수 열 존재 여부 확인)
            required_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
            # MultiIndex 컬럼 대응 (yfinance 최신 버전 등에서 MultiIndex로 반환될 수 있음)
            if isinstance(df.columns, pd.MultiIndex):
                # 단일 티커의 경우 컬럼 레벨을 단순화
                df.columns = df.columns.get_level_values(0)

            missing_columns = [col for col in required_columns if col not in df.columns]
            if missing_columns:
                raise ValueError(f"필수 컬럼이 데이터에 존재하지 않습니다: {missing_columns}")

            # 인덱스를 DatetimeIndex로 변환 및 정렬
            df.index = pd.to_datetime(df.index)
            df = df.sort_index()
            
            # 결측값 처리 (전방 채우기 후 후방 채우기)
            df = df.ffill().bfill()
            
            logger.info(f"데이터 다운로드 완료. 총 {len(df)}개의 행이 로드되었습니다.")
            return df
            
        except Exception as e:
            logger.error(f"데이터 다운로드 중 오류 발생: {str(e)}")
            raise e

# 모듈 단독 실행 테스트용 코드
if __name__ == "__main__":
    downloader = DataDownloader()
    try:
        test_df = downloader.download_data("BTC-USD", "2023-01-01", "2023-12-31")
        print(test_df.head())
    except Exception as ex:
        print(f"테스트 실패: {ex}")
