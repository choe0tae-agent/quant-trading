# -*- coding: utf-8 -*-
"""
주식 스윙 매매 분석 애플리케이션
- 추세추종전략: 이평선 정배열(5/20/120), 전고점 돌파, 거래량 급증 탐지
- UI: Tkinter (Dark Theme Style), Matplotlib Integration
"""

import os
import csv
import threading
import tkinter as tk
from tkinter import ttk, messagebox
import pandas as pd
import yfinance as yf

import matplotlib
matplotlib.use("TkAgg")
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg, NavigationToolbar2Tk

# 한국어 폰트 설정 (Windows 기본 맑은 고딕 사용)
try:
    plt.rc('font', family='Malgun Gothic')
    plt.rc('axes', unicode_minus=False)
except Exception:
    pass

class StockSwingApp:
    def __init__(self, root):
        self.root = root
        self.root.title("QuantAI - 스윙 매매 분석기 (추세추종전략)")
        self.root.geometry("1250x850")
        self.root.configure(bg="#121212")
        
        # 애플리케이션 상태 관리
        self.tickers = []
        self.current_df = None
        self.current_code = None
        self.current_name = None
        
        # UI 스타일 설정
        self.setup_styles()
        
        # 화면 레이아웃 구성
        self.create_widgets()
        
        # 티커 데이터 로드
        self.load_tickers_from_csv()
        
        # 첫 번째 종목 자동 선택 및 로드
        if self.tickers:
            self.ticker_combo.current(0)
            self.on_ticker_changed()
            
    def setup_styles(self):
        """Ttk 위젯에 대한 다크 테마 스타일 정의"""
        self.style = ttk.Style()
        self.style.theme_use('clam')
        
        # 기본 배경 및 전경색
        self.style.configure('.', background='#121212', foreground='#e0e0e0', font=('Segoe UI', 10))
        
        # 프레임 스타일
        self.style.configure('TFrame', background='#121212')
        self.style.configure('Sidebar.TFrame', background='#1e1e1e')
        self.style.configure('Card.TFrame', background='#1e1e1e', borderwidth=1, relief='solid')
        
        # 라벨 스타일
        self.style.configure('TLabel', background='#121212', foreground='#e0e0e0')
        self.style.configure('Sidebar.TLabel', background='#1e1e1e', foreground='#e0e0e0')
        self.style.configure('Header.TLabel', background='#1e1e1e', foreground='#29b6f6', font=('Segoe UI', 14, 'bold'))
        self.style.configure('Subheader.TLabel', background='#1e1e1e', foreground='#ffffff', font=('Segoe UI', 11, 'bold'))
        self.style.configure('Indicator.TLabel', background='#1e1e1e', font=('Segoe UI', 10, 'bold'))
        
        # 콤보박스 스타일
        self.style.configure('TCombobox', fieldbackground='#2d2d2d', background='#2d2d2d', foreground='#ffffff', arrowcolor='#ffffff')
        self.style.map('TCombobox', fieldbackground=[('readonly', '#2d2d2d')], foreground=[('readonly', '#ffffff')])
        
        # 버튼 스타일
        self.style.configure('TButton', background='#29b6f6', foreground='#121212', borderwidth=0, font=('Segoe UI', 10, 'bold'))
        self.style.map('TButton', 
                       background=[('active', '#0288d1'), ('disabled', '#424242')], 
                       foreground=[('disabled', '#888888')])

    def create_widgets(self):
        """좌측 사이드바 및 우측 차트 영역 UI 레이아웃 구현"""
        # 메인 컨테이너 분할
        self.sidebar = ttk.Frame(self.root, style='Sidebar.TFrame', width=300)
        self.sidebar.pack(side=tk.LEFT, fill=tk.Y, padx=0, pady=0)
        self.sidebar.pack_propagate(False)
        
        self.chart_container = ttk.Frame(self.root)
        self.chart_container.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # =========================================================================
        # 1. 사이드바 (Sidebar) 컨트롤 영역
        # =========================================================================
        # 앱 로고/타이틀
        title_label = ttk.Label(self.sidebar, text="SWING TREND TRADER", style='Header.TLabel')
        title_label.pack(anchor=tk.W, padx=20, pady=20)
        
        # 구분선
        separator = ttk.Separator(self.sidebar, orient='horizontal')
        separator.pack(fill=tk.X, padx=15, pady=5)
        
        # 종목 선택 그룹
        ttk.Label(self.sidebar, text="분석 종목 선택", style='Subheader.TLabel').pack(anchor=tk.W, padx=20, pady=15)
        self.ticker_combo = ttk.Combobox(self.sidebar, postcommand=self.load_tickers_from_csv, state='readonly', font=('Segoe UI', 10))
        self.ticker_combo.pack(fill=tk.X, padx=20, pady=5)
        self.ticker_combo.bind('<<ComboboxSelected>>', lambda e: self.on_ticker_changed())
        
        # 조회 기간 선택 그룹
        ttk.Label(self.sidebar, text="차트 조회 기간", style='Subheader.TLabel').pack(anchor=tk.W, padx=20, pady=15)
        self.period_combo = ttk.Combobox(self.sidebar, values=["3개월", "6개월", "1년", "2년"], state='readonly', font=('Segoe UI', 10))
        self.period_combo.pack(fill=tk.X, padx=20, pady=5)
        self.period_combo.current(2)  # 기본값: 1년
        self.period_combo.bind('<<ComboboxSelected>>', lambda e: self.on_period_changed())
        
        # 새로고침 버튼
        self.btn_refresh = ttk.Button(self.sidebar, text="데이터 새로고침", command=self.on_ticker_changed)
        self.btn_refresh.pack(fill=tk.X, padx=20, pady=20)
        
        # 상태 표시 라벨 (비동기 처리 상태 알림용)
        self.status_label = ttk.Label(self.sidebar, text="준비 완료", style='Sidebar.TLabel', foreground='#888888', font=('Segoe UI', 9, 'italic'))
        self.status_label.pack(side=tk.BOTTOM, anchor=tk.W, padx=20, pady=10)
        
        # 구분선 2
        separator2 = ttk.Separator(self.sidebar, orient='horizontal')
        separator2.pack(fill=tk.X, padx=15, pady=10)
        
        # 기술적 분석 지표 상태 카드 (실시간 분석결과 요약)
        self.create_status_card()

    def create_status_card(self):
        """종목 분석 결과 및 신호 상태 카드 UI 생성"""
        self.status_card = ttk.Frame(self.sidebar, style='Card.TFrame')
        self.status_card.pack(fill=tk.BOTH, expand=True, padx=15, pady=15)
        
        # 내부 패딩 프레임
        pad_frame = tk.Frame(self.status_card, bg='#1e1e1e')
        pad_frame.pack(fill=tk.BOTH, expand=True, padx=15, pady=15)
        
        # 분석 요약 타이틀
        tk.Label(pad_frame, text="최신 시장 분석 결과", font=('Segoe UI', 11, 'bold'), bg='#1e1e1e', fg='#ffffff').pack(anchor=tk.W, pady=(0, 15))
        
        # 1. 현재 주가 및 대비
        self.lbl_price_info = tk.Label(pad_frame, text="종가: -", font=('Segoe UI', 12, 'bold'), bg='#1e1e1e', fg='#ffffff')
        self.lbl_price_info.pack(anchor=tk.W, pady=5)
        
        # 2. 이동평균선 상태
        self.lbl_ma_status = tk.Label(pad_frame, text="이평선: 대기 중", font=('Segoe UI', 9), bg='#1e1e1e', fg='#888888', anchor='w')
        self.lbl_ma_status.pack(fill=tk.X, pady=5)
        
        # 3. 전고점 돌파 여부
        self.lbl_breakout_status = tk.Label(pad_frame, text="전고점: 대기 중", font=('Segoe UI', 9), bg='#1e1e1e', fg='#888888', anchor='w')
        self.lbl_breakout_status.pack(fill=tk.X, pady=5)
        
        # 4. 거래량 급증 여부
        self.lbl_volume_status = tk.Label(pad_frame, text="거래량: 대기 중", font=('Segoe UI', 9), bg='#1e1e1e', fg='#888888', anchor='w')
        self.lbl_volume_status.pack(fill=tk.X, pady=5)
        
        # 구분선
        sep = tk.Frame(pad_frame, height=1, bg='#333333')
        sep.pack(fill=tk.X, pady=15)
        
        # 종합 매매 시그널
        self.lbl_signal_title = tk.Label(pad_frame, text="종합 매매 시그널", font=('Segoe UI', 9, 'bold'), bg='#1e1e1e', fg='#888888', anchor='w')
        self.lbl_signal_title.pack(fill=tk.X, pady=2)
        
        self.lbl_signal_val = tk.Label(
            pad_frame, 
            text="관망 및 셋업 대기", 
            font=('Segoe UI', 14, 'bold'), 
            bg='#252525', 
            fg='#888888', 
            relief='solid', 
            borderwidth=1, 
            pady=10
        )
        self.lbl_signal_val.pack(fill=tk.X, pady=5)

    def load_tickers_from_csv(self):
        """로컬 ticker.csv 파일을 파싱하여 콤보박스에 적재"""
        tickers = []
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ticker.csv')
        
        if not os.path.exists(csv_path):
            messagebox.showerror("오류", f"ticker.csv 파일을 찾을 수 없습니다.\n위치: {csv_path}")
            self.status_label.config(text="ticker.csv 파일 찾기 실패", foreground="#ef4444")
            return
            
        try:
            with open(csv_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) >= 2:
                        code = row[0].strip().replace('"', '').replace("'", "")
                        name = row[1].strip().replace('"', '').replace("'", "")
                        tickers.append((code, name))
            
            self.tickers = tickers
            # 콤보박스 값 셋팅
            combo_values = [f"{code} - {name}" for code, name in tickers]
            self.ticker_combo['values'] = combo_values
            self.status_label.config(text="티커 로드 완료", foreground="#888888")
        except Exception as e:
            messagebox.showerror("CSV 로드 오류", f"ticker.csv를 읽는 도중 오류가 발생했습니다.\n{str(e)}")
            self.status_label.config(text="티커 파싱 실패", foreground="#ef4444")

    def format_ticker_symbol(self, code):
        """yfinance 조회를 위해 한국 종목 코드 뒤에 .KS(코스피) 접미사를 강제 부여"""
        clean_code = code.strip()
        # 6자리 alphanumeric 형태인 경우 코스피 상장 종목으로 처리
        if len(clean_code) == 6 and clean_code.isalnum():
            return f"{clean_code}.KS"
        return clean_code

    def on_ticker_changed(self):
        """선택 종목 변경 시 비동기 스레드로 데이터 다운로드 개시"""
        selected = self.ticker_combo.get()
        if not selected:
            return
            
        try:
            code, name = selected.split(" - ", 1)
            self.current_code = code
            self.current_name = name
            
            # 버튼 잠금
            self.btn_refresh.state(['disabled'])
            self.status_label.config(text=f"{name} 데이터 다운로드 중...", foreground="#29b6f6")
            
            # 비동기 데이터 로드 실행
            threading.Thread(target=self.fetch_and_calculate, args=(code, name), daemon=True).start()
        except Exception as e:
            self.handle_error(f"종목 파싱 오류: {str(e)}")

    def on_period_changed(self):
        """조회 기간 변경 시 로컬 캐시 데이터를 활용해 차트만 즉시 재렌더링"""
        if self.current_df is not None:
            self.update_chart()

    def fetch_and_calculate(self, code, name):
        """Sub-thread에서 yfinance 데이터 다운로드 및 pandas 지표 계산 수행"""
        try:
            ticker_symbol = self.format_ticker_symbol(code)
            # 120일 이평선 연산을 완벽히 구하기 위해 항상 최근 2년 데이터를 조회
            ticker_obj = yf.Ticker(ticker_symbol)
            df = ticker_obj.history(period="2y")
            
            if df.empty:
                raise ValueError("가져온 주식 데이터가 비어 있습니다. 올바른 종목 코드인지 확인해 주세요.")
            
            # 지표 계산
            df = self.calculate_indicators(df)
            
            # GUI 컴포넌트 업데이트는 메인 스레드로 위임
            self.root.after(0, lambda: self.on_fetch_success(df))
        except Exception as e:
            self.root.after(0, lambda: self.handle_error(str(e)))

    def calculate_indicators(self, df):
        """데이터 프레임 내 기술적 분석 지표 계산"""
        # 이동평균선 (종가 기준)
        df['MA5'] = df['Close'].rolling(window=5).mean()
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA120'] = df['Close'].rolling(window=120).mean()
        
        # 정배열 구간: 5일 > 20일 > 120일
        df['MA_Aligned'] = (df['MA5'] > df['MA20']) & (df['MA20'] > df['MA120'])
        
        # 거래량 분석
        df['Vol_MA20'] = df['Volume'].rolling(window=20).mean()
        # 거래량 급증: 당일 거래량이 20일 평균 거래량의 2배를 상회
        df['Vol_Surge'] = df['Volume'] > (df['Vol_MA20'] * 2.0)
        
        # 전고점 분석 (롤링 최고점): lookahead bias 방지를 위해 전일자까지의 최고가 활용
        # 스윙 매매 기준으로 60영업일(약 3개월) 간의 전고점을 타겟으로 설정
        df['Prev_High'] = df['High'].shift(1).rolling(window=60, min_periods=1).max()
        # 전고점 돌파: 금일 종가가 60일 최고가를 넘어섬
        df['Breakout'] = df['Close'] > df['Prev_High']
        
        # 종합 매매 시그널: 세 조건이 동시에 만족하는 시점
        df['Buy_Signal'] = df['MA_Aligned'] & df['Breakout'] & df['Vol_Surge']
        
        return df

    def on_fetch_success(self, df):
        """데이터 로드 성공 시 캐시 갱신 및 차트/패널 업데이트"""
        self.current_df = df
        self.btn_refresh.state(['!disabled'])
        self.status_label.config(text="데이터 업데이트 성공", foreground="#10b981")
        
        # 우측 차트 그리기
        self.update_chart()
        
        # 좌측 패널 정보 갱신
        self.update_status_panel()

    def handle_error(self, err_msg):
        """데이터 로드 실패 또는 에러 발생 시 처리"""
        self.btn_refresh.state(['!disabled'])
        self.status_label.config(text="오류 발생", foreground="#ef4444")
        messagebox.showerror("오류", f"데이터를 로드하는 과정에서 에러가 발생했습니다:\n{err_msg}")

    def update_status_panel(self):
        """최신 데이터를 바탕으로 좌측 실시간 시장분석 카드를 갱신"""
        if self.current_df is None or self.current_df.empty:
            return
            
        # 가장 최신 거래일 데이터 추출
        latest = self.current_df.iloc[-1]
        
        # 이전 거래일 대비 등락폭 연산
        prev_close = self.current_df.iloc[-2]['Close'] if len(self.current_df) > 1 else latest['Close']
        change_pct = ((latest['Close'] - prev_close) / prev_close) * 100
        
        color_theme = '#10b981' if change_pct >= 0 else '#ef4444'
        sign = '+' if change_pct >= 0 else ''
        
        # 1. 현재가 표시
        self.lbl_price_info.config(
            text=f"현재가: {latest['Close']:,.0f} 원 ({sign}{change_pct:.2f}%)", 
            foreground=color_theme
        )
        
        # 2. 이평선 상태 분석
        if latest['MA_Aligned']:
            self.lbl_ma_status.config(text="● 이평선: 정배열 (상승 트렌드)", fg='#10b981')
        else:
            self.lbl_ma_status.config(text="○ 이평선: 역배열 / 혼조 상태", fg='#888888')
            
        # 3. 전고점 돌파 분석
        if latest['Breakout']:
            self.lbl_breakout_status.config(text="● 전고점: 60일 저항 돌파!", fg='#f59e0b')
        else:
            self.lbl_breakout_status.config(text="○ 전고점: 돌파 대기 상태", fg='#888888')
            
        # 4. 거래량 분석
        if latest['Vol_Surge']:
            self.lbl_volume_status.config(text="● 거래량: 20일 평균 2배 돌파!", fg='#ffd700')
        else:
            self.lbl_volume_status.config(text="○ 거래량: 일반 거래 범위", fg='#888888')
            
        # 5. 종합 매매 포인트 신호 분석
        # 최신일 기준 정배열 구간에서 돌파 + 거래량 급증 시그널이 뜬 경우
        if latest['Buy_Signal']:
            self.lbl_signal_val.config(text="★ 매수 급소 신호 발생 ★", bg='#1e3a8a', fg='#29b6f6', borderwidth=2)
        elif latest['MA_Aligned'] and (latest['Breakout'] or latest['Vol_Surge']):
            self.lbl_signal_val.config(text="상승 셋업 (관찰 필요)", bg='#332200', fg='#f59e0b', borderwidth=1)
        else:
            self.lbl_signal_val.config(text="관망 및 셋업 대기", bg='#252525', fg='#888888', borderwidth=1)

    def get_sliced_display_df(self):
        """사용자가 선택한 기간에 맞춰 차트용 데이터 필터링"""
        if self.current_df is None:
            return None
            
        period_str = self.period_combo.get()
        if period_str == "3개월":
            days = 90
        elif period_str == "6개월":
            days = 180
        elif period_str == "2년":
            days = 730
        else:
            days = 365 # 기본 1년
            
        # 최근 날짜 기준으로 해당 일수 역산하여 슬라이싱
        end_date = self.current_df.index[-1]
        start_date = end_date - pd.Timedelta(days=days)
        
        return self.current_df.loc[start_date:]

    def update_chart(self):
        """Matplotlib 캔버스를 활용해 차트 재설계 및 렌더링"""
        df_sliced = self.get_sliced_display_df()
        if df_sliced is None or df_sliced.empty:
            return
            
        # 기존 차트 위젯이 있으면 삭제
        for widget in self.chart_container.winfo_children():
            widget.destroy()
            
        # Matplotlib 스타일 테마 설정 (다크 테마 통일)
        fig, (ax_price, ax_vol) = plt.subplots(
            2, 1, 
            sharex=True, 
            gridspec_kw={'height_ratios': [3, 1]}, 
            figsize=(10, 6),
            facecolor='#121212'
        )
        
        # 여백 조절
        fig.subplots_adjust(hspace=0.08, left=0.08, right=0.95, top=0.92, bottom=0.08)
        
        # ---------------------------------------------------------------------
        # [1] 상단: 주가 및 이동평균선, 정배열 영역 강조, 돌파 타점 표시
        # ---------------------------------------------------------------------
        ax_price.set_facecolor('#1e1e1e')
        
        # 가격 및 이평선 드로잉
        ax_price.plot(df_sliced.index, df_sliced['Close'], label='종가', color='#ffffff', linewidth=1.5)
        ax_price.plot(df_sliced.index, df_sliced['MA5'], label='5일 이평선', color='#f43f5e', linewidth=1.0)
        ax_price.plot(df_sliced.index, df_sliced['MA20'], label='20일 이평선', color='#eab308', linewidth=1.2)
        ax_price.plot(df_sliced.index, df_sliced['MA120'], label='120일 이평선', color='#a855f7', linewidth=1.5)
        
        # 전고점 (저항선) 점선 드로잉
        ax_price.plot(df_sliced.index, df_sliced['Prev_High'], label='60일 전고점', color='#f97316', linestyle='--', linewidth=1.0)
        
        # 정배열 구간 채우기 (5 > 20 > 120) - 옅은 녹색 투명도 처리
        ax_price.fill_between(
            df_sliced.index, 
            0, 1, 
            where=df_sliced['MA_Aligned'], 
            transform=ax_price.get_xaxis_transform(), 
            color='#10b981', 
            alpha=0.08, 
            label='정배열 구간'
        )
        
        # 전고점 돌파 성공 지점 마킹 (골드 별표)
        breakout_points = df_sliced[df_sliced['Breakout']]
        if not breakout_points.empty:
            ax_price.scatter(
                breakout_points.index, 
                breakout_points['Close'], 
                color='#f59e0b', 
                marker='*', 
                s=110, 
                zorder=5, 
                label='전고점 돌파'
            )
            
        # 종합 매수 신호 발생 지점 (이평정배열 + 전고점돌파 + 거래량급증) 마킹 (하늘색 위쪽 삼각표)
        buy_points = df_sliced[df_sliced['Buy_Signal']]
        if not buy_points.empty:
            ax_price.scatter(
                buy_points.index, 
                buy_points['Close'], 
                color='#06b6d4', 
                marker='^', 
                s=160, 
                zorder=6, 
                label='매수 급소'
            )
            
        ax_price.set_title(f"{self.current_name} ({self.current_code}) 추세 및 매매 시그널 분석", color='#ffffff', fontsize=12, pad=10)
        ax_price.set_ylabel("가격 (원)", color='#e0e0e0')
        ax_price.tick_params(colors='#888888', labelsize=9)
        ax_price.grid(True, color='#2d2d2d', linestyle=':', linewidth=0.5)
        ax_price.legend(facecolor='#1e1e1e', edgecolor='#2d2d2d', labelcolor='#e0e0e0', loc='upper left', fontsize=9)
        
        # ---------------------------------------------------------------------
        # [2] 하단: 거래량 막대 및 20일 거래량 이평선
        # ---------------------------------------------------------------------
        ax_vol.set_facecolor('#1e1e1e')
        
        # 거래량 양봉/음봉 및 급증 컬러 리스트 생성
        bar_colors = []
        for idx, row in df_sliced.iterrows():
            if row.get('Vol_Surge', False):
                bar_colors.append('#f59e0b')  # 거래량 급증 시점은 골드색으로 강조
            elif 'Open' in row and row['Close'] >= row['Open']:
                bar_colors.append('#ef4444')  # 양봉 (yfinance 기준 종가>=시가)
            else:
                bar_colors.append('#3b82f6')  # 음봉 (yfinance 기준 종가<시가)
                
        # 거래량 막대 그래프
        ax_vol.bar(df_sliced.index, df_sliced['Volume'], color=bar_colors, width=0.6, label='거래량')
        
        # 20일 거래량 이동평균선 그리기
        ax_vol.plot(df_sliced.index, df_sliced['Vol_MA20'], label='거래량 20일 평균', color='#60a5fa', linewidth=1.0)
        
        ax_vol.set_ylabel("거래량", color='#e0e0e0')
        ax_vol.tick_params(colors='#888888', labelsize=9)
        ax_vol.grid(True, color='#2d2d2d', linestyle=':', linewidth=0.5)
        ax_vol.legend(facecolor='#1e1e1e', edgecolor='#2d2d2d', labelcolor='#e0e0e0', loc='upper left', fontsize=9)
        
        # ---------------------------------------------------------------------
        # [3] Tkinter 캔버스 마운팅 및 툴바 설정
        # ---------------------------------------------------------------------
        canvas = FigureCanvasTkAgg(fig, master=self.chart_container)
        canvas.draw()
        canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)
        
        # 툴바 추가 (사용성 강화)
        toolbar_frame = ttk.Frame(self.chart_container)
        toolbar_frame.pack(fill=tk.X, side=tk.BOTTOM)
        toolbar = NavigationToolbar2Tk(canvas, toolbar_frame)
        toolbar.update()
        
        # matplotlib 툴바 내부 배경색 커스텀
        toolbar.config(background='#121212')
        for child in toolbar.winfo_children():
            child.config(background='#121212')

def main():
    root = tk.Tk()
    app = StockSwingApp(root)
    root.mainloop()

if __name__ == '__main__':
    main()
