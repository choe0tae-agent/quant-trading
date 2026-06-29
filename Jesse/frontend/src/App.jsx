import React, { useState, useEffect } from 'react'
import {
  TrendingUp,
  Settings,
  Activity,
  CheckCircle,
  XCircle,
  AlertTriangle,
  LineChart as ChartIcon,
  History,
  BarChart,
  RefreshCw
} from 'lucide-react'
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts'

export default function App() {
  // Strategy & Query Parameters
  const [ticker, setTicker] = useState('SPY')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState('2026-06-25')

  const [donchianPeriod, setDonchianPeriod] = useState(20)
  const [emaPeriod, setEmaPeriod] = useState(100)
  const [atrPeriod, setAtrPeriod] = useState(14)
  const [atrMultiplier, setAtrMultiplier] = useState(2.0)
  const [riskPercent, setRiskPercent] = useState(2) // in percentage

  // UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [activeTab, setActiveTab] = useState('charts')
  const [serverOnline, setServerOnline] = useState(false)
  const [showPriceChart, setShowPriceChart] = useState(true)

  // Verify server is online on load
  useEffect(() => {
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.status === 'online') setServerOnline(true)
      })
      .catch(() => setServerOnline(false))
  }, [])

  const handleRunAnalysis = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/backtest', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ticker,
          start_date: startDate,
          end_date: endDate,
          donchian_period: donchianPeriod,
          ema_period: emaPeriod,
          atr_period: atrPeriod,
          atr_multiplier: atrMultiplier,
          risk_percent: riskPercent / 100
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || '백테스트 분석을 수행하지 못했습니다.')
      }
      setResult(data)
      setServerOnline(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Calculate monthly returns for heatmap (if trades data exists)
  const getMonthlyReturnsData = () => {
    if (!result || !result.trades || result.trades.length === 0) return []

    const monthlyMap = {}
    result.trades.forEach(t => {
      const date = new Date(t.exit_date)
      const year = date.getFullYear()
      const month = date.getMonth() // 0-11
      const key = `${year}-${month}`

      if (!monthlyMap[key]) monthlyMap[key] = 0
      // Sum the percentage return of trades
      monthlyMap[key] += t.return_pct * 100
    })

    const months = ["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"]
    const years = [...new Set(result.trades.map(t => new Date(t.exit_date).getFullYear()))].sort()

    const data = []
    years.forEach(year => {
      months.forEach((mName, mIdx) => {
        const key = `${year}-${mIdx}`
        const profit = monthlyMap[key] !== undefined ? parseFloat(monthlyMap[key].toFixed(2)) : 0
        data.push({ year, monthName: mName, profit })
      })
    })

    return data
  }

  const monthlyReturns = getMonthlyReturnsData()

  // Format Monte Carlo paths for Recharts
  const getMonteCarloChartData = () => {
    if (!result || !result.monte_carlo || !result.monte_carlo.curves) return []
    const curves = result.monte_carlo.curves
    if (curves.length === 0) return []

    const maxLen = Math.max(...curves.map(c => c.length))
    const chartData = []

    for (let i = 0; i < maxLen; i++) {
      const dataPoint = { name: `${i}회차` }
      // Sample first 15 curves to make rendering fast
      curves.slice(0, 15).forEach((curve, cIdx) => {
        dataPoint[`sim_${cIdx}`] = curve[i] !== undefined ? parseFloat(curve[i].toFixed(2)) : null
      })
      chartData.push(dataPoint)
    }
    return chartData
  }

  const mcChartData = getMonteCarloChartData()

  const getHeatmapColor = (val) => {
    if (val === 0) return 'rgba(255, 255, 255, 0.05)'
    if (val > 0) {
      const opacity = Math.min(val / 15, 1.0)
      return `rgba(16, 185, 129, ${0.1 + opacity * 0.8})`
    } else {
      const opacity = Math.min(Math.abs(val) / 15, 1.0)
      return `rgba(239, 68, 68, ${0.1 + opacity * 0.8})`
    }
  }

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-section">
          <h1><TrendingUp size={28} className="icon" style={{ color: 'var(--accent-gold)' }} /> QUANT STOCK VAL</h1>
          <p>제시(Jesse) 스타일 돈치안 채널 돌파 전략 & 통계 검증 시스템</p>
        </div>
        <div className={`server-badge ${serverOnline ? 'online' : 'offline'}`}>
          <span className="dot">●</span> {serverOnline ? '백엔드 온라인' : '백엔드 오프라인'}
        </div>
      </header>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Sidebar Controls */}
        <aside className="glass-card">
          <h2 className="control-title"><Settings size={18} style={{ marginRight: '8px' }} /> 시스템 설정</h2>
          <form onSubmit={handleRunAnalysis}>
            <div className="form-group">
              <label>주식 티커 (예: AAPL, SPY)</label>
              <input
                type="text"
                className="form-control-input"
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                required
              />
            </div>

            <div className="form-group">
              <label>분석 시작일</label>
              <input
                type="date"
                className="form-control-input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>분석 종료일</label>
              <input
                type="date"
                className="form-control-input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>
                돈치안 채널 기간
                <span className="value">{donchianPeriod}일</span>
              </label>
              <input
                type="range"
                min="5"
                max="100"
                className="slider-input"
                value={donchianPeriod}
                onChange={(e) => setDonchianPeriod(parseInt(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>
                트렌드 EMA 필터 기간
                <span className="value">{emaPeriod}일</span>
              </label>
              <input
                type="range"
                min="20"
                max="300"
                className="slider-input"
                value={emaPeriod}
                onChange={(e) => setEmaPeriod(parseInt(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>
                변동성(ATR) 기간
                <span className="value">{atrPeriod}일</span>
              </label>
              <input
                type="range"
                min="5"
                max="50"
                className="slider-input"
                value={atrPeriod}
                onChange={(e) => setAtrPeriod(parseInt(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>
                ATR 손절 배수
                <span className="value">{atrMultiplier}배</span>
              </label>
              <input
                type="range"
                min="1"
                max="5"
                step="0.1"
                className="slider-input"
                value={atrMultiplier}
                onChange={(e) => setAtrMultiplier(parseFloat(e.target.value))}
              />
            </div>

            <div className="form-group">
              <label>
                거래당 최대 리스크
                <span className="value">{riskPercent}%</span>
              </label>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                className="slider-input"
                value={riskPercent}
                onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
              />
            </div>

            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? <RefreshCw className="spinner" style={{ animation: 'spin 1s linear infinite', width: '20px', height: '20px', margin: '0 auto' }} /> : '분석 시스템 작동'}
            </button>
          </form>
        </aside>

        {/* Content Area */}
        <main>
          {loading && (
            <div className="glass-card loading-overlay">
              <div className="spinner"></div>
              <p>주식 가격 데이터를 수집하고, 500회 무작위 유의성 검정(RST) 및 몬테카를로 스트레스 테스트를 계산 중입니다...</p>
            </div>
          )}

          {error && (
            <div className="glass-card failed" style={{ borderLeft: '4px solid var(--error)', background: 'rgba(239, 68, 68, 0.05)', padding: '20px' }}>
              <h3 style={{ color: 'var(--error)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <XCircle /> 분석 실행 실패
              </h3>
              <p style={{ color: 'var(--text-muted)' }}>{error}</p>
            </div>
          )}

          {!loading && !error && !result && (
            <div className="glass-card placeholder-container">
              <Activity className="placeholder-icon" size={64} style={{ color: 'var(--text-dim)' }} />
              <h2>시스템 분석 준비 완료</h2>
              <p style={{ maxWidth: '450px' }}>조절 패널에서 분석할 종목 티커를 지정하고 파라미터를 설정한 후 시스템 분석 작동 버튼을 클릭해 주세요.</p>
            </div>
          )}

          {!loading && !error && result && (
            <div>
              {/* Metrics Row */}
              <div className="metrics-row">
                <div className="glass-card metric-card">
                  <h3>누적 수익률</h3>
                  <span className={`value ${result.metrics.net_profit_pct >= 0 ? 'positive' : 'negative'}`}>
                    {result.metrics.net_profit_pct >= 0 ? '+' : ''}{result.metrics.net_profit_pct.toFixed(2)}%
                  </span>
                </div>
                <div className="glass-card metric-card">
                  <h3>최대 낙폭 (MDD)</h3>
                  <span className="value negative" style={{ color: 'var(--error)' }}>
                    {result.metrics.max_drawdown_pct.toFixed(2)}%
                  </span>
                </div>
                <div className="glass-card metric-card">
                  <h3>샤프 지수 (Sharpe)</h3>
                  <span className="value" style={{ color: result.metrics.sharpe_ratio >= 1.5 ? 'var(--success)' : 'inherit' }}>
                    {result.metrics.sharpe_ratio.toFixed(2)}
                  </span>
                </div>
                <div className="glass-card metric-card">
                  <h3>승률</h3>
                  <span className="value">
                    {result.metrics.win_rate.toFixed(1)}%
                  </span>
                </div>
                <div className="glass-card metric-card">
                  <h3>프로핏 팩터</h3>
                  <span className="value">
                    {result.metrics.profit_factor === 999 ? '무한대' : result.metrics.profit_factor.toFixed(2)}
                  </span>
                </div>
                <div className="glass-card metric-card">
                  <h3>총 거래 횟수</h3>
                  <span className="value" style={{ fontFamily: 'var(--font-mono)' }}>
                    {result.metrics.total_trades}회
                  </span>
                </div>
              </div>

              {/* Validation Cards */}
              <div className="validation-row">
                <div className={`glass-card validation-box ${result.rst.passed ? 'passed' : 'failed'}`}>
                  <div className="validation-icon">
                    {result.rst.passed ? <CheckCircle size={28} /> : <AlertTriangle size={28} />}
                  </div>
                  <div className="validation-info">
                    <h4>규칙 유의성 검정 (RST)</h4>
                    <p>전략의 진입 성과가 우연이 아닌 유의미한 예측 모델인지 500회 무작위 진입 경로와 비교합니다.</p>
                    <div className="validation-val">
                      P-Value: {result.rst.p_value.toFixed(4)} ({result.rst.passed ? '통과 - 통계적 우위 있음' : '실패 - 단순 노이즈일 가능성 있음'})
                    </div>
                  </div>
                </div>

                <div className={`glass-card validation-box ${Math.abs(result.metrics.max_drawdown_pct) < Math.abs(result.monte_carlo.worst_5pct_drawdown_pct) ? 'passed' : 'failed'}`}>
                  <div className="validation-icon">
                    {Math.abs(result.metrics.max_drawdown_pct) < Math.abs(result.monte_carlo.worst_5pct_drawdown_pct) ? <CheckCircle size={28} /> : <AlertTriangle size={28} />}
                  </div>
                  <div className="validation-info">
                    <h4>몬테카를로 스트레스 테스트</h4>
                    <p>실제 거래 순서를 무작위 셔플링하여 미래에 마주할 수 있는 가혹한 계좌 낙폭 리스크를 시뮬레이션합니다.</p>
                    <div className="validation-val">
                      하위 5% 예상 MDD: {result.monte_carlo.worst_5pct_drawdown_pct.toFixed(2)}% (백테스트 결과: {result.metrics.max_drawdown_pct.toFixed(2)}%)
                    </div>
                  </div>
                </div>
              </div>

              {/* Tabs Section */}
              <div className="glass-card">
                <div className="tabs-header">
                  <button className={`tab-btn ${activeTab === 'charts' ? 'active' : ''}`} onClick={() => setActiveTab('charts')}>
                    <ChartIcon size={16} style={{ marginRight: '6px', display: 'inline' }} /> 성과 곡선 & 지표
                  </button>
                  <button className={`tab-btn ${activeTab === 'monte_carlo' ? 'active' : ''}`} onClick={() => setActiveTab('monte_carlo')}>
                    <Activity size={16} style={{ marginRight: '6px', display: 'inline' }} /> 몬테카를로 시뮬레이션
                  </button>
                  <button className={`tab-btn ${activeTab === 'monthly' ? 'active' : ''}`} onClick={() => setActiveTab('monthly')}>
                    <BarChart size={16} style={{ marginRight: '6px', display: 'inline' }} /> 월별 수익률 맵
                  </button>
                  <button className={`tab-btn ${activeTab === 'trades' ? 'active' : ''}`} onClick={() => setActiveTab('trades')}>
                    <History size={16} style={{ marginRight: '6px', display: 'inline' }} /> 상세 거래 로그
                  </button>
                </div>

                {/* Tab 1: Performance Charts */}
                {activeTab === 'charts' && (
                  <div>
                    <div className="chart-header">
                      <h3>{showPriceChart ? '주식 종가 차트 및 돈치안 채널 / EMA 지표' : '백테스트 계좌 자산 성장 곡선'}</h3>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!showPriceChart}
                          onChange={() => setShowPriceChart(!showPriceChart)}
                        />
                        계좌 자산 곡선(Equity)으로 변경
                      </label>
                    </div>

                    <div className="chart-container-inner">
                      <ResponsiveContainer width="100%" height="100%">
                        {showPriceChart ? (
                          <ComposedChart data={result.history}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                            <YAxis domain={['auto', 'auto']} stroke="var(--text-dim)" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#111827', border: '1px solid var(--panel-border)', color: '#fff' }} />
                            <Legend />
                            <Line name="주식 종가" type="monotone" dataKey="price" stroke="#9ca3af" strokeWidth={1} dot={false} />
                            <Line name="돈치안 상단 (돌파선)" type="step" dataKey="donchian_high" stroke="#ef4444" strokeWidth={1.2} strokeDasharray="4 4" dot={false} />
                            <Line name="돈치안 하단 (청산선)" type="step" dataKey="donchian_low" stroke="#3b82f6" strokeWidth={1.2} strokeDasharray="4 4" dot={false} />
                            <Line name="트렌드 필터 (EMA)" type="monotone" dataKey="ema_trend" stroke="var(--accent-gold)" strokeWidth={1.5} dot={false} />
                          </ComposedChart>
                        ) : (
                          <AreaChart data={result.history}>
                            <defs>
                              <linearGradient id="colorEquity" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--accent-gold)" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="var(--accent-gold)" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                            <YAxis domain={['auto', 'auto']} stroke="var(--text-dim)" fontSize={11} />
                            <Tooltip contentStyle={{ background: '#111827', border: '1px solid var(--panel-border)', color: '#fff' }} />
                            <Legend />
                            <Area name="계좌 자산 규모 ($)" type="monotone" dataKey="equity" stroke="var(--accent-gold)" strokeWidth={2} fillOpacity={1} fill="url(#colorEquity)" />
                          </AreaChart>
                        )}
                      </ResponsiveContainer>
                    </div>

                    {/* Drawdown Panel */}
                    <div style={{ marginTop: '25px' }}>
                      <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '10px' }}>실시간 누적 드로우다운 (최대 낙폭 추이)</h3>
                      <div className="chart-container-inner" style={{ height: '150px' }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={result.history.map(h => ({
                            date: h.date,
                            drawdown: h.equity ? parseFloat(((h.equity - result.metrics.initial_equity) / result.metrics.initial_equity * 100).toFixed(2)) : 0
                          }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                            <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                            <YAxis stroke="var(--text-dim)" fontSize={11} unit="%" />
                            <Tooltip contentStyle={{ background: '#111827', border: '1px solid var(--panel-border)', color: '#fff' }} />
                            <Area name="실시간 손실률" type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef4444" fillOpacity={0.15} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tab 2: Monte Carlo Simulation paths */}
                {activeTab === 'monte_carlo' && (
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>거래 승/패 확률 재배치 시뮬레이션 경로 (15개 난수 추출)</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                      현재까지 백테스트에서 도출된 거래 결과들의 순서를 무작위로 섞었을 때, 자산 곡선이 거쳐 갈 수 있는 15가지 가상 경로를 모델링한 결과입니다.
                    </p>
                    <div className="chart-container-inner">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={mcChartData}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                          <XAxis dataKey="name" stroke="var(--text-dim)" fontSize={11} />
                          <YAxis stroke="var(--text-dim)" fontSize={11} />
                          <Tooltip contentStyle={{ background: '#111827', border: '1px solid var(--panel-border)', color: '#fff' }} />
                          {Array.from({ length: 15 }).map((_, idx) => (
                            <Line
                              key={idx}
                              type="monotone"
                              dataKey={`sim_${idx}`}
                              stroke={idx === 0 ? 'var(--accent-gold)' : 'var(--accent-blue)'}
                              strokeWidth={idx === 0 ? 1.5 : 0.8}
                              opacity={idx === 0 ? 1.0 : 0.25}
                              dot={false}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Tab 3: Monthly Matrix Heatmap */}
                {activeTab === 'monthly' && (
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>월별 누적 손익 매트릭스 Heatmap (%)</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                      연도 및 월별로 마감된 거래 손익률을 직관적인 그리드 맵으로 시각화한 지표입니다.
                    </p>
                    {monthlyReturns.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(12, 1fr)', gap: '6px', textAlign: 'center', fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-muted)' }}>
                          <div>연도</div>
                          {["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"].map(m => <div key={m}>{m}</div>)}
                        </div>

                        {/* Group data by year */}
                        {Object.entries(
                          monthlyReturns.reduce((acc, val) => {
                            if (!acc[val.year]) acc[val.year] = []
                            acc[val.year].push(val)
                            return acc
                          }, {})
                        ).map(([year, monthsData]) => (
                          <div key={year} style={{ display: 'grid', gridTemplateColumns: '80px repeat(12, 1fr)', gap: '6px', alignItems: 'center' }}>
                            <div style={{ fontSize: '0.9rem', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>{year}</div>
                            {monthsData.map((m, idx) => (
                              <div
                                key={idx}
                                className="heatmap-cell"
                                style={{ background: getHeatmapColor(m.profit) }}
                                title={`${m.year}년 ${m.monthName}: ${m.profit >= 0 ? '+' : ''}${m.profit}%`}
                              >
                                {m.profit !== 0 ? `${m.profit > 0 ? '+' : ''}${m.profit.toFixed(1)}%` : '-'}
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: 'var(--text-dim)' }}>표시 가능한 월별 수익 지표가 없습니다 (기간 동안 거래가 집계되지 않음).</p>
                    )}
                  </div>
                )}

                {/* Tab 4: Trades Log Table */}
                {activeTab === 'trades' && (
                  <div>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>체결 거래 상세 이력 로그 (Backtest Trades)</h3>
                    <div className="trades-table-container">
                      <table className="trades-table">
                        <thead>
                          <tr>
                            <th>진입일</th>
                            <th>진입 가격</th>
                            <th>손절 예약가</th>
                            <th>청산일</th>
                            <th>청산 가격</th>
                            <th>손익금 (USD)</th>
                            <th>수익률 (%)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.trades.map((t, idx) => (
                            <tr key={idx}>
                              <td>{t.entry_date}</td>
                              <td>${t.entry_price.toFixed(2)}</td>
                              <td>${t.stop_loss.toFixed(2)}</td>
                              <td>{t.exit_date}</td>
                              <td>${t.exit_price.toFixed(2)}</td>
                              <td className={t.pnl >= 0 ? 'positive' : 'negative'} style={{ color: t.pnl >= 0 ? 'var(--success)' : 'var(--error)' }}>
                                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
                              </td>
                              <td className={t.return_pct >= 0 ? 'positive' : 'negative'} style={{ color: t.return_pct >= 0 ? 'var(--success)' : 'var(--error)' }}>
                                {t.return_pct >= 0 ? '+' : ''}{(t.return_pct * 100).toFixed(2)}%
                              </td>
                            </tr>
                          ))}
                          {result.trades.length === 0 && (
                            <tr>
                              <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-dim)' }}>백테스트 기간 동안 매매 체결 기록이 없습니다.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
