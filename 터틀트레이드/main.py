import os
import csv
import sys
import pandas as pd
import logging
import tkinter as tk
from tkinter import ttk, messagebox, scrolledtext

from data_downloader import DataDownloader
from strategy import TurtleSignalGenerator
from backtester import TurtleBacktester
from visualizer import TurtleVisualizer

# 로깅 설정
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class StdoutRedirector:
    """
    표준 출력(stdout) 및 에러(stderr)를 Tkinter scrolledtext 위젯으로 리다이렉트하는 클래스
    """
    def __init__(self, text_widget):
        self.text_widget = text_widget

    def write(self, string):
        self.text_widget.configure(state='normal')
        self.text_widget.insert(tk.END, string)
        self.text_widget.see(tk.END)
        self.text_widget.configure(state='disabled')

    def flush(self):
        pass

class TurtleTradingApp:
    """
    터틀 트레이딩 백테스트 및 시각화용 Tkinter GUI 애플리케이션 클래스
    """
    def __init__(self, root):
        self.root = root
        self.root.title("터틀 트레이딩 전략 시뮬레이터 (Turtle Trading Simulator)")
        self.root.geometry("820x750")
        self.root.minsize(700, 600)
        
        # UI 스타일 설정
        self.style = ttk.Style()
        self.style.theme_use("clam")
        
        # 컬러 팔레트 설정
        self.bg_color = "#f5f6fa"
        self.primary_color = "#3498db"
        self.accent_color = "#2c3e50"
        
        self.root.configure(bg=self.bg_color)
        
        # 폰트 설정
        self.title_font = ("Malgun Gothic", 16, "bold")
        self.label_font = ("Malgun Gothic", 10, "bold")
        self.entry_font = ("Malgun Gothic", 10)
        self.btn_font = ("Malgun Gothic", 11, "bold")
        self.log_font = ("Consolas", 10)
        
        # Ticker 데이터 로드
        self.tickers = self.load_tickers()
        
        self.create_widgets()
        
        # 표준 출력 리디렉션
        self.stdout_redirector = StdoutRedirector(self.log_text)
        sys.stdout = self.stdout_redirector
        sys.stderr = self.stdout_redirector
        
        logger.info("애플리케이션이 시작되었습니다. ticker.csv가 성공적으로 로드되었습니다.")

    def load_tickers(self) -> list:
        """
        ticker.csv를 파싱하여 value(첫 번째 열), text(두 번째 열)의 딕셔너리 리스트로 반환합니다.
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        csv_path = os.path.join(current_dir, "ticker.csv")
        tickers = []
        if not os.path.exists(csv_path):
            messagebox.showerror("오류", f"ticker.csv 파일을 찾을 수 없습니다.\n경로: {csv_path}")
            return tickers
        
        try:
            with open(csv_path, 'r', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) >= 2:
                        val = row[0].strip().strip('"').strip("'")
                        txt = row[1].strip().strip('"').strip("'")
                        tickers.append({'value': val, 'text': txt})
        except Exception as e:
            messagebox.showerror("오류", f"ticker.csv 파일을 읽는 중 오류가 발생했습니다:\n{e}")
        return tickers

    def create_widgets(self):
        # 1. 메인 프레임
        main_frame = tk.Frame(self.root, bg=self.bg_color, padx=15, pady=15)
        main_frame.pack(fill=tk.BOTH, expand=True)
        
        # 타이틀 레이블
        title_label = tk.Label(main_frame, text="터틀 트레이딩 전략 시뮬레이터", font=self.title_font, fg=self.accent_color, bg=self.bg_color)
        title_label.pack(anchor=tk.W, pady=(0, 15))
        
        # 2. 설정 프레임 (LabelFrame)
        config_frame = ttk.LabelFrame(main_frame, text=" 백테스팅 설정 ")
        config_frame.pack(fill=tk.X, pady=(0, 15))
        
        # 내부 그리드 설정
        grid_frame = tk.Frame(config_frame, bg=self.bg_color, padx=10, pady=10)
        grid_frame.pack(fill=tk.BOTH, expand=True)
        grid_frame.columnconfigure(1, weight=1)
        grid_frame.columnconfigure(3, weight=1)
        
        # 종목 선택 (Combobox)
        tk.Label(grid_frame, text="대상 종목", font=self.label_font, bg=self.bg_color).grid(row=0, column=0, sticky=tk.W, padx=5, pady=5)
        self.ticker_combo = ttk.Combobox(grid_frame, state="readonly", font=self.entry_font)
        combo_displays = [f"{t['text']} ({t['value']})" for t in self.tickers]
        self.ticker_combo['values'] = combo_displays
        if combo_displays:
            self.ticker_combo.current(0)
        self.ticker_combo.grid(row=0, column=1, sticky=tk.EW, padx=5, pady=5)
        
        # 초기 자산 (Initial Capital)
        tk.Label(grid_frame, text="초기 자산 (KRW)", font=self.label_font, bg=self.bg_color).grid(row=0, column=2, sticky=tk.W, padx=5, pady=5)
        self.capital_entry = ttk.Entry(grid_frame, font=self.entry_font)
        self.capital_entry.insert(0, "100000000.0")
        self.capital_entry.grid(row=0, column=3, sticky=tk.EW, padx=5, pady=5)
        
        # 시작일
        tk.Label(grid_frame, text="시작일 (YYYY-MM-DD)", font=self.label_font, bg=self.bg_color).grid(row=1, column=0, sticky=tk.W, padx=5, pady=5)
        self.start_date_entry = ttk.Entry(grid_frame, font=self.entry_font)
        self.start_date_entry.insert(0, "2020-01-01")
        self.start_date_entry.grid(row=1, column=1, sticky=tk.EW, padx=5, pady=5)
        
        # 종료일
        tk.Label(grid_frame, text="종료일 (YYYY-MM-DD)", font=self.label_font, bg=self.bg_color).grid(row=1, column=2, sticky=tk.W, padx=5, pady=5)
        self.end_date_entry = ttk.Entry(grid_frame, font=self.entry_font)
        self.end_date_entry.insert(0, "2026-06-01")
        self.end_date_entry.grid(row=1, column=3, sticky=tk.EW, padx=5, pady=5)
        
        # 리스크 한도 (Risk Pct)
        tk.Label(grid_frame, text="거래 위험도 (예: 0.02 = 2%)", font=self.label_font, bg=self.bg_color).grid(row=2, column=0, sticky=tk.W, padx=5, pady=5)
        self.risk_entry = ttk.Entry(grid_frame, font=self.entry_font)
        self.risk_entry.insert(0, "0.02")
        self.risk_entry.grid(row=2, column=1, sticky=tk.EW, padx=5, pady=5)
        
        # 거래 수수료 (Commission)
        tk.Label(grid_frame, text="거래 수수료 (예: 0.0015)", font=self.label_font, bg=self.bg_color).grid(row=2, column=2, sticky=tk.W, padx=5, pady=5)
        self.commission_entry = ttk.Entry(grid_frame, font=self.entry_font)
        self.commission_entry.insert(0, "0.0015")
        self.commission_entry.grid(row=2, column=3, sticky=tk.EW, padx=5, pady=5)
        
        # 실행 버튼
        self.run_btn = tk.Button(
            main_frame, text="시뮬레이션 실행", font=self.btn_font,
            bg=self.primary_color, fg="white", activebackground="#2980b9", activeforeground="white",
            relief=tk.FLAT, height=2, command=self.run_simulation
        )
        self.run_btn.pack(fill=tk.X, pady=(0, 15))
        
        # 3. 로그 및 결과 출력 프레임 (LabelFrame)
        log_frame = ttk.LabelFrame(main_frame, text=" 실행 로그 및 성과 분석 ")
        log_frame.pack(fill=tk.BOTH, expand=True)
        
        self.log_text = scrolledtext.ScrolledText(log_frame, font=self.log_font, bg="#2c3e50", fg="#ecf0f1", state="disabled")
        self.log_text.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)

    def run_simulation(self):
        """
        사용자가 설정한 값에 따라 시뮬레이션을 실행하고 결과를 출력합니다.
        """
        # UI 비활성화
        self.run_btn.configure(state="disabled", text="시뮬레이션 진행 중...")
        self.root.update()
        
        try:
            combo_idx = self.ticker_combo.current()
            if combo_idx < 0:
                messagebox.showwarning("경고", "분석할 종목을 선택해 주세요.")
                return
            
            selected_item = self.tickers[combo_idx]
            ticker_value = selected_item['value']
            ticker_text = selected_item['text']
            
            # 요구사항: value 에는 첫번째 열을, text에는 두번째 열을 출력
            print("\n" + "=" * 60)
            print(f"선택된 종목 - Value: {ticker_value}, Text: {ticker_text}")
            print("=" * 60)
            
            try:
                start_date = self.start_date_entry.get().strip()
                end_date = self.end_date_entry.get().strip()
                initial_capital = float(self.capital_entry.get().strip())
                risk_pct = float(self.risk_entry.get().strip())
                commission = float(self.commission_entry.get().strip())
            except ValueError as ve:
                messagebox.showerror("입력 오류", f"입력한 매개변수가 올바르지 않습니다:\n{ve}")
                return

            is_crypto = "-USD" in ticker_value.upper()
            
            output_dir = os.path.dirname(os.path.abspath(__file__))
            chart_save_path = os.path.join(output_dir, "turtle_backtest_result.png")
            csv_save_path = os.path.join(output_dir, "turtle_trade_log.csv")

            print(f"기간: {start_date} ~ {end_date}")
            print(f"초기자본: {initial_capital:,.0f} KRW | 거래 위험도: {risk_pct*100}% | 수수료: {commission*100}%")
            print("-" * 60)

            # --- 데이터 다운로드 ---
            downloader = DataDownloader()
            df = downloader.download_data(ticker_value, start_date, end_date)

            # --- 전략 지표 및 시그널 계산 ---
            generator = TurtleSignalGenerator(entry_window=20, exit_window=10, atr_window=20, trend_window=200)
            df_indicators = generator.calculate_indicators(df)

            # --- 백테스팅 실행 ---
            backtester = TurtleBacktester(
                initial_capital=initial_capital, 
                risk_pct=risk_pct, 
                commission=commission, 
                is_crypto=is_crypto
            )
            result_df = backtester.run(df_indicators)

            # --- 성과 지표 계산 및 출력 ---
            metrics = backtester.calculate_performance(result_df)
            trades = backtester.trades
            
            # 추가 지표 계산: Profit Factor
            profits = sum(t['pnl'] for t in trades if t['pnl'] > 0)
            losses = abs(sum(t['pnl'] for t in trades if t['pnl'] < 0))
            profit_factor = profits / losses if losses > 0 else (float('inf') if profits > 0 else 1.0)

            print("\n" + "=" * 20 + " 백테스트 성과 분석 요약 " + "=" * 20)
            print(f"1. 누적 수익률 (Total Return)   : {metrics['Total Return (%)']:.2f}%")
            print(f"2. 단순 보유 수익률 (Buy & Hold) : {metrics['Buy & Hold Return (%)']:.2f}%")
            print(f"3. 최종 자산 가치 (Final Capital): {metrics['Final Capital']:,.0f} KRW")
            print(f"4. 최대 낙폭 (Max Drawdown)     : {metrics['Max Drawdown (%)']:.2f}%")
            print(f"5. 샤프 지수 (Sharpe Ratio)     : {metrics['Sharpe Ratio']:.3f}")
            print(f"6. 총 거래 횟수 (Total Trades)   : {metrics['Total Trades']}회")
            print(f"7. 승률 (Win Rate)              : {metrics['Win Rate (%)']:.2f}%")
            print(f"8. 프로핏 팩터 (Profit Factor)   : {profit_factor:.3f}")
            print("=" * 63 + "\n")

            # --- 거래 내역 요약 출력 및 CSV 저장 ---
            trades_df = backtester.get_trades_df()
            if not trades_df.empty:
                trades_df.to_csv(csv_save_path, index=False, encoding='utf-8-sig')
                print(f"최근 10개 거래 기록 (상세 내역은 '{csv_save_path}'에 저장됨):")
                
                display_cols = ['entry_date', 'entry_price', 'size', 'exit_date', 'exit_price', 'exit_reason', 'pnl', 'return_pct']
                summary_trades = trades_df[display_cols].tail(10).copy()
                summary_trades['entry_date'] = summary_trades['entry_date'].dt.strftime('%Y-%m-%d')
                summary_trades['exit_date'] = summary_trades['exit_date'].dt.strftime('%Y-%m-%d')
                
                summary_trades['entry_price'] = summary_trades['entry_price'].map(lambda x: f"{x:,.0f} KRW")
                summary_trades['exit_price'] = summary_trades['exit_price'].map(lambda x: f"{x:,.0f} KRW")
                summary_trades['size'] = summary_trades['size'].map(lambda x: f"{x:.1f}주")
                summary_trades['pnl'] = summary_trades['pnl'].map(lambda x: f"{x:,.0f} KRW")
                summary_trades['return_pct'] = summary_trades['return_pct'].map(lambda x: f"{x:.2f}%")
                
                summary_trades.columns = ['진입일', '진입가', '수량', '청산일', '청산가', '청산사유', '실현손익', '수익률']
                
                print(summary_trades.to_string(index=False))
            else:
                print("백테스트 기간 동안 체결된 거래가 없습니다.")

            # --- 결과 시각화 ---
            visualizer = TurtleVisualizer()
            visualizer.plot_results(
                result_df=result_df, 
                trade_signals=backtester.trade_signals, 
                ticker=ticker_value, 
                save_path=chart_save_path
            )

        except Exception as e:
            logger.error(f"시뮬레이션 구동 중 예상치 못한 오류 발생: {str(e)}", exc_info=True)
            messagebox.showerror("시뮬레이션 오류", f"시뮬레이션 실행 중 오류가 발생했습니다:\n{e}")
        finally:
            self.run_btn.configure(state="normal", text="시뮬레이션 실행")

def main():
    root = tk.Tk()
    app = TurtleTradingApp(root)
    root.mainloop()

if __name__ == "__main__":
    main()
