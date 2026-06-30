// Rolling Z-Score Trend Analyzer - Frontend Application

// State variables
let availableSources = {};
let activeSource = "krx";
let activeSymbol = "삼성전자";
let activeTimeframe = "1d";
let historicalCandles = [];
let indicators = {
    zScore: [],
    zScoreEma: [],
    zScoreHist: [],
    emaFilter: []
};
let tradesList = [];

// Lightweight Charts references
let priceChart = null;
let priceSeries = null;
let emaFilterSeries = null;

let oscChart = null;
let zScoreSeries = null;
let zScoreEmaSeries = null;
let zScoreHistSeries = null;

// Synchronization flag
let isSyncing = false;

// Chatbot state
let chatSettings = {
    provider: "openrouter",
    model: "google/gemini-2.5-flash",
    apiKey: "",
    ollamaUrl: "http://localhost:11434",
    systemPrompt: "당신은 전문 금융 트레이더이자 계량 기술 분석가(Quant Technical Analyst)입니다. 현재 사용자가 보고 있는 Rolling Z-Score Trend 지표(Z-Score 오실레이터, Z-Score EMA 시그널 라인, 속도 히스토그램)와 EMA 50 추세 필터의 상태, 그리고 백테스트 결과 통계(수익률, 승률, MDD 등) 데이터를 기반으로 차트 이미지를 종합적으로 정밀 분석해 주세요. 향후 이 종목의 추세 변화 가능성, 시그널 신뢰도 및 리스크 관리 팁을 한국어로 격식 있고 명확하게 제시해 주기 바랍니다."
};
let chatHistory = [];

const PROVIDER_MODELS = {
    openrouter: [
        { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (추천)" },
        { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
        { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
        { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" }
    ],
    gemini: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }
    ],
    openai: [
        { value: "gpt-4o-mini", label: "GPT-4o Mini" },
        { value: "gpt-4o", label: "GPT-4o" }
    ],
    claude: [
        { value: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet" }
    ],
    ollama: [
        { value: "llava", label: "llava (로컬 비전)" },
        { value: "llama3", label: "llama3 (로컬 텍스트)" }
    ]
};

// ==========================================
// Initialization
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    try {
        // 1. Fetch data sources
        const res = await fetch("/api/sources");
        if (!res.ok) throw new Error("Failed to fetch data sources");
        availableSources = await res.json();
        
        // Populate sources
        const sourceSelect = document.getElementById("zscore-source-select");
        sourceSelect.innerHTML = "";
        for (const src in availableSources) {
            const opt = document.createElement("option");
            opt.value = src;
            opt.textContent = availableSources[src].label;
            sourceSelect.appendChild(opt);
        }
        
        // Initialize dropdown choices
        activeSource = "krx";
        sourceSelect.value = activeSource;
        
        populateSymbolsDropdown(activeSource);
        
        // 2. Setup event listeners
        setupEventListeners();
        
        // 3. Initialize charts
        initCharts();
        
        // 4. Fetch and run backtest
        await loadChartData();
        
        // 5. Initialize Chatbot components
        initChatbot();
        
    } catch (err) {
        console.error("Initialization error:", err);
        alert("앱 초기화 중 오류가 발생했습니다: " + err.message);
    }
});

function populateSymbolsDropdown(source) {
    const symbolSelect = document.getElementById("zscore-symbol-select");
    symbolSelect.innerHTML = "";
    
    const symbols = availableSources[source]?.symbols || [];
    symbols.forEach(sym => {
        const opt = document.createElement("option");
        opt.value = sym;
        opt.textContent = sym;
        symbolSelect.appendChild(opt);
    });
    
    activeSymbol = symbols[0] || "";
    symbolSelect.value = activeSymbol;
}

function setupEventListeners() {
    // Source dropdown change
    document.getElementById("zscore-source-select").addEventListener("change", (e) => {
        activeSource = e.target.value;
        populateSymbolsDropdown(activeSource);
        loadChartData();
    });
    
    // Symbol dropdown change
    document.getElementById("zscore-symbol-select").addEventListener("change", (e) => {
        activeSymbol = e.target.value;
        loadChartData();
    });
    
    // Timeframe change
    document.getElementById("zscore-timeframe-select").addEventListener("change", (e) => {
        activeTimeframe = e.target.value;
        loadChartData();
    });
    
    // Inputs change to trigger recalculation and backtest
    const inputs = [
        "zscore-length", "zscore-smoothing", "zscore-threshold", 
        "zscore-trigger-type", "zscore-trend-filter", "zscore-exit-rule", 
        "zscore-sl-pct", "zscore-tp-pct"
    ];
    
    inputs.forEach(id => {
        document.getElementById(id).addEventListener("change", () => {
            runBacktestAndRender();
        });
        
        // Also listen to keyup for numbers
        if (id !== "zscore-trigger-type" && id !== "zscore-trend-filter" && id !== "zscore-exit-rule") {
            document.getElementById(id).addEventListener("keyup", () => {
                runBacktestAndRender();
            });
        }
    });
    
    // Handle exit rule toggle inputs hiding
    document.getElementById("zscore-exit-rule").addEventListener("change", (e) => {
        const ratioInputs = document.getElementById("zscore-ratio-inputs");
        if (e.target.value === "ratio") {
            ratioInputs.classList.remove("hidden");
        } else {
            ratioInputs.classList.add("hidden");
        }
    });
    
    // Window resize handler
    window.addEventListener("resize", () => {
        resizeCharts();
    });
}

// ==========================================
// Chart Setup
// ==========================================

function initCharts() {
    const mainContainer = document.getElementById("zscore-price-chart");
    const subContainer = document.getElementById("zscore-osc-chart");
    
    // 1. Price Chart Setup
    priceChart = LightweightCharts.createChart(mainContainer, {
        layout: {
            background: { color: "#131722" },
            textColor: "#d1d4dc",
            fontFamily: "'Outfit', sans-serif"
        },
        grid: {
            vertLines: { color: "#242835" },
            horzLines: { color: "#242835" }
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal
        },
        rightPriceScale: {
            borderColor: "#2a2e39"
        },
        timeScale: {
            borderColor: "#2a2e39",
            timeVisible: true,
            visible: false // hide time scale on main chart since sub-chart shares it
        }
    });
    
    priceSeries = priceChart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: "#0ecb81",
        downColor: "#f6465d",
        borderUpColor: "#0ecb81",
        borderDownColor: "#f6465d",
        wickUpColor: "#0ecb81",
        wickDownColor: "#f6465d"
    });
    
    emaFilterSeries = priceChart.addSeries(LightweightCharts.LineSeries, {
        color: "#b000b0",
        lineWidth: 1.5,
        title: "EMA 50 Filter",
        visible: true
    });
    
    // 2. Z-Score Oscillator Chart Setup
    oscChart = LightweightCharts.createChart(subContainer, {
        layout: {
            background: { color: "#131722" },
            textColor: "#d1d4dc",
            fontFamily: "'Outfit', sans-serif"
        },
        grid: {
            vertLines: { color: "#242835" },
            horzLines: { color: "#242835" }
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal
        },
        rightPriceScale: {
            borderColor: "#2a2e39"
        },
        timeScale: {
            borderColor: "#2a2e39",
            timeVisible: true
        }
    });
    
    zScoreSeries = oscChart.addSeries(LightweightCharts.LineSeries, {
        color: "#2962ff",
        lineWidth: 1.5,
        title: "Z-Score"
    });
    
    zScoreEmaSeries = oscChart.addSeries(LightweightCharts.LineSeries, {
        color: "#ffc107",
        lineWidth: 1.5,
        title: "Signal EMA"
    });
    
    zScoreHistSeries = oscChart.addSeries(LightweightCharts.HistogramSeries, {
        color: "rgba(14, 203, 129, 0.4)",
        priceFormat: {
            type: "volume"
        }
    });
    
    // Synchronize zoom / scroll
    priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing || !range) return;
        isSyncing = true;
        oscChart.timeScale().setVisibleLogicalRange(range);
        isSyncing = false;
    });
    
    oscChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (isSyncing || !range) return;
        isSyncing = true;
        priceChart.timeScale().setVisibleLogicalRange(range);
        isSyncing = false;
    });
    
    resizeCharts();
}

function resizeCharts() {
    const mainContainer = document.getElementById("zscore-price-chart");
    const subContainer = document.getElementById("zscore-osc-chart");
    
    if (priceChart && mainContainer) {
        priceChart.resize(mainContainer.clientWidth, mainContainer.clientHeight);
    }
    if (oscChart && subContainer) {
        oscChart.resize(subContainer.clientWidth, subContainer.clientHeight);
    }
}

// ==========================================
// Data Fetch & indicator calculations
// ==========================================

async function loadChartData() {
    document.getElementById("zscore-price-title").textContent = `${activeSymbol} (${activeTimeframe}) - 데이터 로딩 중...`;
    
    try {
        const url = `/api/history?source=${activeSource}&symbol=${encodeURIComponent(activeSymbol)}&timeframe=${activeTimeframe}&limit=500`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("History fetch error");
        
        const data = await res.json();
        if (data && data.length > 0) {
            historicalCandles = data;
            runBacktestAndRender();
        } else {
            alert("조회된 캔들 데이터가 없습니다.");
            historicalCandles = [];
        }
    } catch (e) {
        console.error("Failed to load chart data:", e);
        document.getElementById("zscore-price-title").textContent = "데이터 로딩 실패";
    }
}

function calculateSMA(data, index, length) {
    if (index < length - 1) return null;
    let sum = 0;
    for (let i = 0; i < length; i++) {
        sum += data[index - i].close;
    }
    return sum / length;
}

function calculateStdDev(data, index, length, mean) {
    if (index < length - 1 || mean === null) return null;
    let sumSqrDiff = 0;
    for (let i = 0; i < length; i++) {
        const diff = data[index - i].close - mean;
        sumSqrDiff += diff * diff;
    }
    return Math.sqrt(sumSqrDiff / length);
}

function calculateIndicators() {
    const length = parseInt(document.getElementById("zscore-length").value) || 20;
    const smoothing = parseInt(document.getElementById("zscore-smoothing").value) || 3;
    
    const count = historicalCandles.length;
    
    // 1. Z-Score calculation
    const rawZScores = new Array(count).fill(null);
    for (let i = 0; i < count; i++) {
        if (i < length - 1) continue;
        const mean = calculateSMA(historicalCandles, i, length);
        const stddev = calculateStdDev(historicalCandles, i, length, mean);
        if (stddev !== null && stddev > 0) {
            rawZScores[i] = (historicalCandles[i].close - mean) / stddev;
        } else {
            rawZScores[i] = 0;
        }
    }
    
    // 2. Smoothed Z-Score EMA calculation
    const smoothedZScores = new Array(count).fill(null);
    let firstValIdx = -1;
    for (let i = 0; i < count; i++) {
        if (rawZScores[i] !== null) {
            firstValIdx = i;
            break;
        }
    }
    
    if (firstValIdx !== -1) {
        smoothedZScores[firstValIdx] = rawZScores[firstValIdx];
        const multiplier = 2 / (smoothing + 1);
        for (let i = firstValIdx + 1; i < count; i++) {
            if (rawZScores[i] !== null) {
                smoothedZScores[i] = (rawZScores[i] - smoothedZScores[i - 1]) * multiplier + smoothedZScores[i - 1];
            }
        }
    }
    
    // 3. Momentum Histogram calculation: Z_smooth - Z_smooth[1]
    const zScoreHist = new Array(count).fill(null);
    for (let i = 1; i < count; i++) {
        if (smoothedZScores[i] !== null && smoothedZScores[i - 1] !== null) {
            zScoreHist[i] = smoothedZScores[i] - smoothedZScores[i - 1];
        }
    }
    
    // 4. EMA 50 trend filter calculation
    const ema50 = new Array(count).fill(null);
    if (count >= 50) {
        let sum = 0;
        for (let i = 0; i < 50; i++) {
            sum += historicalCandles[i].close;
        }
        ema50[49] = sum / 50;
        
        const mult = 2 / (50 + 1);
        for (let i = 50; i < count; i++) {
            ema50[i] = (historicalCandles[i].close - ema50[i - 1]) * mult + ema50[i - 1];
        }
    }
    
    indicators = {
        zScore: rawZScores,
        zScoreEma: smoothedZScores,
        zScoreHist: zScoreHist,
        emaFilter: ema50
    };
}

// ==========================================
// Backtest Strategy Simulation Engine
// ==========================================

function runBacktestAndRender() {
    if (historicalCandles.length === 0) return;
    
    // Step 1. Recalculate indicators
    calculateIndicators();
    
    const count = historicalCandles.length;
    const threshold = parseFloat(document.getElementById("zscore-threshold").value) || 1.5;
    const triggerType = document.getElementById("zscore-trigger-type").value;
    const useTrendFilter = document.getElementById("zscore-trend-filter").checked;
    const exitRule = document.getElementById("zscore-exit-rule").value;
    const slPct = parseFloat(document.getElementById("zscore-sl-pct").value) || 1.5;
    const tpPct = parseFloat(document.getElementById("zscore-tp-pct").value) || 3.0;
    
    const zEma = indicators.zScoreEma;
    const emaFilter = indicators.emaFilter;
    
    let position = null; // { type: "long"|"short", entryPrice, entryIndex, entryTime, sl, tp }
    tradesList = [];
    
    const chartMarkers = [];
    
    // Begin simulation loop
    // Start index is 50 to ensure EMA 50 is calculated
    for (let i = 50; i < count; i++) {
        const close = historicalCandles[i].close;
        const time = historicalCandles[i].time;
        
        if (position === null) {
            // Check for entry signal
            let isLongSignal = false;
            let isShortSignal = false;
            
            if (zEma[i] !== null && zEma[i - 1] !== null) {
                if (triggerType === "reversion") {
                    // Extreme cross: Long when crosses above -threshold, Short when crosses below +threshold
                    if (zEma[i - 1] <= -threshold && zEma[i] > -threshold) isLongSignal = true;
                    if (zEma[i - 1] >= threshold && zEma[i] < threshold) isShortSignal = true;
                } else {
                    // Zero cross: Long when crosses above 0, Short when crosses below 0
                    if (zEma[i - 1] <= 0 && zEma[i] > 0) isLongSignal = true;
                    if (zEma[i - 1] >= 0 && zEma[i] < 0) isShortSignal = true;
                }
            }
            
            // Apply Trend filter
            if (useTrendFilter && emaFilter[i] !== null) {
                if (isLongSignal && close <= emaFilter[i]) isLongSignal = false;
                if (isShortSignal && close >= emaFilter[i]) isShortSignal = false;
            }
            
            if (isLongSignal) {
                position = {
                    type: "long",
                    entryPrice: close,
                    entryIndex: i,
                    entryTime: time,
                    sl: close * (1 - slPct / 100),
                    tp: close * (1 + tpPct / 100)
                };
                chartMarkers.push({
                    time: time,
                    position: "belowBar",
                    color: "#0ecb81",
                    shape: "arrowUp",
                    text: "L-Buy"
                });
            } else if (isShortSignal) {
                position = {
                    type: "short",
                    entryPrice: close,
                    entryIndex: i,
                    entryTime: time,
                    sl: close * (1 + slPct / 100),
                    tp: close * (1 - tpPct / 100)
                };
                chartMarkers.push({
                    time: time,
                    position: "aboveBar",
                    color: "#f6465d",
                    shape: "arrowDown",
                    text: "S-Sell"
                });
            }
        } else {
            // We are inside a trade
            let shouldExit = false;
            let exitReason = "";
            
            if (exitRule === "ratio") {
                // Check SL / TP levels
                if (position.type === "long") {
                    if (close <= position.sl) {
                        shouldExit = true;
                        exitReason = "SL";
                    } else if (close >= position.tp) {
                        shouldExit = true;
                        exitReason = "TP";
                    }
                } else {
                    if (close >= position.sl) {
                        shouldExit = true;
                        exitReason = "SL";
                    } else if (close <= position.tp) {
                        shouldExit = true;
                        exitReason = "TP";
                    }
                }
            } else {
                // Signal based exit: exits when Z-score EMA crosses zero in opposite direction
                if (position.type === "long" && zEma[i] !== null && zEma[i - 1] !== null) {
                    if (zEma[i - 1] >= 0 && zEma[i] < 0) {
                        shouldExit = true;
                        exitReason = "Z-Cross";
                    }
                } else if (position.type === "short" && zEma[i] !== null && zEma[i - 1] !== null) {
                    if (zEma[i - 1] <= 0 && zEma[i] > 0) {
                        shouldExit = true;
                        exitReason = "Z-Cross";
                    }
                }
            }
            
            // Force exit at end of historical records
            if (i === count - 1) {
                shouldExit = true;
                exitReason = "End";
            }
            
            if (shouldExit) {
                const profitPct = position.type === "long" 
                    ? ((close - position.entryPrice) / position.entryPrice) * 100
                    : ((position.entryPrice - close) / position.entryPrice) * 100;
                    
                tradesList.push({
                    id: tradesList.length + 1,
                    type: position.type,
                    entryTime: position.entryTime,
                    entryPrice: position.entryPrice,
                    exitTime: time,
                    exitPrice: close,
                    profitPct: profitPct,
                    exitReason: exitReason
                });
                
                chartMarkers.push({
                    time: time,
                    position: position.type === "long" ? "aboveBar" : "belowBar",
                    color: profitPct >= 0 ? "#0ecb81" : "#f6465d",
                    shape: position.type === "long" ? "arrowDown" : "arrowUp",
                    text: `Exit (${exitReason})`
                });
                
                position = null;
            }
        }
    }
    
    // Step 3. Compile Backtest KPIs
    calculateBacktestKPIs();
    
    // Step 4. Render charts and log table
    renderBacktestCharts(chartMarkers);
    renderTradeLogTable();
}

function calculateBacktestKPIs() {
    let cumReturn = 1.0;
    let wins = 0;
    let totalTrades = tradesList.length;
    let maxDrawdown = 0;
    let peak = 1.0;
    let sumProfit = 0;
    let sumLoss = 0;
    
    const equityCurve = [1.0];
    
    tradesList.forEach(t => {
        const ret = t.profitPct / 100;
        cumReturn = cumReturn * (1 + ret);
        equityCurve.push(cumReturn);
        
        if (t.profitPct >= 0) {
            wins++;
            sumProfit += ret;
        } else {
            sumLoss += Math.abs(ret);
        }
        
        // Track MDD
        if (cumReturn > peak) {
            peak = cumReturn;
        }
        const dd = (peak - cumReturn) / peak;
        if (dd > maxDrawdown) {
            maxDrawdown = dd;
        }
    });
    
    const netProfitPct = (cumReturn - 1.0) * 100;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const profitFactor = sumLoss > 0 ? sumProfit / sumLoss : sumProfit > 0 ? 99.9 : 0;
    
    // Update labels in sidebar
    const npLabel = document.getElementById("zscore-net-profit");
    npLabel.textContent = `${netProfitPct >= 0 ? '+' : ''}${netProfitPct.toFixed(2)}%`;
    npLabel.className = `perf-value ${netProfitPct >= 0 ? 'text-green' : 'text-red'}`;
    
    document.getElementById("zscore-win-rate").textContent = `${winRate.toFixed(1)}%`;
    document.getElementById("zscore-total-trades").textContent = totalTrades;
    document.getElementById("zscore-profit-factor").textContent = profitFactor.toFixed(2);
    document.getElementById("zscore-mdd").textContent = `${(maxDrawdown * 100).toFixed(2)}%`;
    
    document.getElementById("zscore-price-title").textContent = `${activeSymbol} (${activeTimeframe}) - 백테스트 완료 (${totalTrades}회 거래)`;
}

function renderBacktestCharts(markers) {
    // 1. Price series data
    priceSeries.setData(historicalCandles);
    LightweightCharts.createSeriesMarkers(priceSeries, markers);
    
    // 2. Trend filter series data
    const useTrendFilter = document.getElementById("zscore-trend-filter").checked;
    if (useTrendFilter) {
        const filterData = [];
        for (let i = 0; i < historicalCandles.length; i++) {
            if (indicators.emaFilter[i] !== null) {
                filterData.push({
                    time: historicalCandles[i].time,
                    value: indicators.emaFilter[i]
                });
            }
        }
        emaFilterSeries.setData(filterData);
        emaFilterSeries.applyOptions({ visible: true });
    } else {
        emaFilterSeries.applyOptions({ visible: false });
    }
    
    // 3. Sub chart Z-Score line
    const zData = [];
    const zEmaData = [];
    const zHistData = [];
    
    for (let i = 0; i < historicalCandles.length; i++) {
        const time = historicalCandles[i].time;
        if (indicators.zScore[i] !== null) {
            zData.push({ time, value: indicators.zScore[i] });
        }
        if (indicators.zScoreEma[i] !== null) {
            zEmaData.push({ time, value: indicators.zScoreEma[i] });
        }
        if (indicators.zScoreHist[i] !== null) {
            // Color momentum hist: green if > 0, red if < 0
            const val = indicators.zScoreHist[i];
            const isEmaPos = indicators.zScoreEma[i] > 0;
            
            let color = "rgba(246, 70, 93, 0.4)"; // Bright Red default
            if (isEmaPos) {
                color = val > 0 ? "rgba(14, 203, 129, 0.7)" : "rgba(14, 203, 129, 0.35)";
            } else {
                color = val < 0 ? "rgba(246, 70, 93, 0.7)" : "rgba(246, 70, 93, 0.35)";
            }
            
            zHistData.push({ time, value: indicators.zScoreEma[i], color });
        }
    }
    
    zScoreSeries.setData(zData);
    zScoreEmaSeries.setData(zEmaData);
    zScoreHistSeries.setData(zHistData);
    
    // Fit timeframe content
    priceChart.timeScale().fitContent();
}

function renderTradeLogTable() {
    const tbody = document.getElementById("zscore-log-body");
    tbody.innerHTML = "";
    
    if (tradesList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">거래 데이터가 없습니다.</td></tr>`;
        return;
    }
    
    let runningReturn = 1.0;
    
    tradesList.forEach(t => {
        runningReturn = runningReturn * (1 + t.profitPct / 100);
        const tr = document.createElement("tr");
        
        const entryDate = new Date(t.entryTime * 1000).toLocaleString('ko-KR', { hour12: false });
        const exitDate = new Date(t.exitTime * 1000).toLocaleString('ko-KR', { hour12: false });
        
        tr.innerHTML = `
            <td>${t.id}</td>
            <td><span class="badge ${t.type}">${t.type === "long" ? "BUY (LONG)" : "SELL (SHORT)"}</span></td>
            <td>${entryDate}</td>
            <td>${t.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td>${exitDate}</td>
            <td>${t.exitPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td class="${t.profitPct >= 0 ? 'text-green' : 'text-red'}">${t.profitPct >= 0 ? '+' : ''}${t.profitPct.toFixed(2)}%</td>
            <td class="${runningReturn - 1 >= 0 ? 'text-green' : 'text-red'}">${((runningReturn - 1) * 100).toFixed(2)}%</td>
            <td><span class="badge ${t.profitPct >= 0 ? 'win' : 'loss'}">${t.profitPct >= 0 ? '수익' : '손실'} (${t.exitReason})</span></td>
        `;
        
        // Click to center chart timeline on this trade
        tr.addEventListener("click", () => {
            const entryIdx = historicalCandles.findIndex(c => c.time === t.entryTime);
            if (entryIdx !== -1 && priceChart) {
                priceChart.timeScale().setVisibleLogicalRange({
                    from: entryIdx - 40,
                    to: entryIdx + 40
                });
            }
        });
        
        tbody.appendChild(tr);
    });
}

// ==========================================
// AI Chatbot Integration Functions
// ==========================================

function initChatbot() {
    const toggleBtn = document.getElementById("toggle-chat-btn");
    const closeBtn = document.getElementById("close-chat-btn");
    const sidebar = document.getElementById("chatbot-sidebar");
    
    const settingsBtn = document.getElementById("chat-settings-btn");
    const settingsCloseBtn = document.getElementById("settings-close-btn");
    const chatView = document.getElementById("chat-view");
    const settingsView = document.getElementById("settings-view");
    
    const keyVisibilityBtn = document.getElementById("toggle-key-visibility-btn");
    const apiKeyInput = document.getElementById("api-key-input");
    
    const sendBtn = document.getElementById("send-chat-btn");
    const chatInput = document.getElementById("chat-input");
    const quickDiagnoseBtn = document.getElementById("quick-diagnose-btn");
    
    const saveSettingsBtn = document.getElementById("save-settings-btn");
    
    // Toggle sidebar
    toggleBtn.addEventListener("click", () => {
        const isCollapsed = sidebar.classList.contains("collapsed");
        if (!isCollapsed) {
            sidebar.style.width = "";
            sidebar.style.minWidth = "";
        }
        sidebar.classList.toggle("collapsed");
        setTimeout(() => {
            resizeCharts();
        }, 350);
    });
    
    closeBtn.addEventListener("click", () => {
        sidebar.style.width = "";
        sidebar.style.minWidth = "";
        sidebar.classList.add("collapsed");
        setTimeout(() => {
            resizeCharts();
        }, 350);
    });
    
    // Toggle settings pane
    settingsBtn.addEventListener("click", () => {
        chatView.classList.add("hidden");
        settingsView.classList.remove("hidden");
    });
    
    settingsCloseBtn.addEventListener("click", () => {
        settingsView.classList.add("hidden");
        chatView.classList.remove("hidden");
    });
    
    // Toggle API Key visibility
    keyVisibilityBtn.addEventListener("click", () => {
        if (apiKeyInput.type === "password") {
            apiKeyInput.type = "text";
            keyVisibilityBtn.textContent = "숨기기";
        } else {
            apiKeyInput.type = "password";
            keyVisibilityBtn.textContent = "보기";
        }
    });
    
    // Send message triggers
    sendBtn.addEventListener("click", () => sendChatMessage());
    
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
    
    chatInput.addEventListener("input", function() {
        this.style.height = "auto";
        this.style.height = (this.scrollHeight) + "px";
    });
    
    // Quick diagnose trigger
    quickDiagnoseBtn.addEventListener("click", () => {
        const np = document.getElementById("zscore-net-profit").textContent;
        const wr = document.getElementById("zscore-win-rate").textContent;
        const pf = document.getElementById("zscore-profit-factor").textContent;
        const dd = document.getElementById("zscore-mdd").textContent;
        const trades = document.getElementById("zscore-total-trades").textContent;
        const length = document.getElementById("zscore-length").value;
        const threshold = document.getElementById("zscore-threshold").value;
        const useTrend = document.getElementById("zscore-trend-filter").checked ? "적용" : "미적용";
        
        let recentZ = "N/A";
        let recentZSignal = "N/A";
        if (indicators.zScore.length > 0) {
            const lastIdx = indicators.zScore.length - 1;
            recentZ = indicators.zScore[lastIdx]?.toFixed(3) || "N/A";
            recentZSignal = indicators.zScoreEma[lastIdx]?.toFixed(3) || "N/A";
        }
        
        const text = `현재 종목: ${activeSymbol} (${activeTimeframe})\n` +
                     `- Z-Score 파라미터: Lookback=${length}, 임계치=${threshold}, 50 EMA 추세필터=${useTrend}\n` +
                     `- 백테스트 지표: 누적 수익률=${np}, 승률=${wr}, 거래 횟수=${trades}, 수익 팩터=${pf}, MDD=${dd}\n` +
                     `- 최신 캔들 기준 지표값: Raw Z-Score=${recentZ}, Z-Score EMA Signal=${recentZSignal}\n\n` +
                     `위 통계와 백테스트 데이터를 바탕으로 이 종목에 적용된 Rolling Z-Score Trend 매매 기법을 분석하고, 앞으로의 포지션 진입/탈출 및 전략 개선 방안에 대해 기술적으로 엄밀하게 브리핑해 줘.`;
        sendChatMessage(text);
    });
    
    // Provider select dropdown change
    document.getElementById("provider-select").addEventListener("change", (e) => {
        const provider = e.target.value;
        const apiKeyGroup = document.getElementById("api-key-group");
        const ollamaUrlGroup = document.getElementById("ollama-url-group");
        
        if (provider === "ollama") {
            apiKeyGroup.classList.add("hidden");
            ollamaUrlGroup.classList.remove("hidden");
        } else {
            apiKeyGroup.classList.remove("hidden");
            ollamaUrlGroup.classList.add("hidden");
        }
        
        populateModelSelect(provider, "");
    });
    
    // Model select change (handle custom typing)
    document.getElementById("model-select").addEventListener("change", (e) => {
        const customModelInput = document.getElementById("custom-model-input");
        if (e.target.value === "custom") {
            customModelInput.classList.remove("hidden");
            customModelInput.value = "";
        } else {
            customModelInput.classList.add("hidden");
        }
    });
    
    // Settings save trigger
    saveSettingsBtn.addEventListener("click", () => {
        if (saveChatSettings()) {
            settingsView.classList.add("hidden");
            chatView.classList.remove("hidden");
        }
    });
    
    // Load initial settings
    loadChatSettings();
    
    // Synchronize active pane UI
    document.getElementById("active-chart-label").textContent = `Z-Score 분석기 - ${activeSymbol}`;
    
    // Sidebar Resizer setup
    initSidebarResizer();
}

function loadChatSettings() {
    const saved = localStorage.getItem("zscore:chat:settings");
    if (saved) {
        try {
            chatSettings = JSON.parse(saved);
        } catch (e) {
            console.warn("Failed to parse chat settings, using defaults");
        }
    }
    
    document.getElementById("provider-select").value = chatSettings.provider;
    document.getElementById("api-key-input").value = chatSettings.apiKey || "";
    document.getElementById("ollama-url-input").value = chatSettings.ollamaUrl || "http://localhost:11434";
    document.getElementById("system-prompt-input").value = chatSettings.systemPrompt;
    
    const provider = chatSettings.provider;
    const apiKeyGroup = document.getElementById("api-key-group");
    const ollamaUrlGroup = document.getElementById("ollama-url-group");
    if (provider === "ollama") {
        apiKeyGroup.classList.add("hidden");
        ollamaUrlGroup.classList.remove("hidden");
    } else {
        apiKeyGroup.classList.remove("hidden");
        ollamaUrlGroup.classList.add("hidden");
    }
    
    populateModelSelect(provider, chatSettings.model);
}

function saveChatSettings() {
    const provider = document.getElementById("provider-select").value;
    const apiKey = document.getElementById("api-key-input").value;
    const ollamaUrl = document.getElementById("ollama-url-input").value;
    const systemPrompt = document.getElementById("system-prompt-input").value;
    
    let model = document.getElementById("model-select").value;
    if (model === "custom") {
        model = document.getElementById("custom-model-input").value.trim();
        if (!model) {
            alert("모델명을 직접 입력해 주세요.");
            return false;
        }
    }
    
    chatSettings = { provider, model, apiKey, ollamaUrl, systemPrompt };
    localStorage.setItem("zscore:chat:settings", JSON.stringify(chatSettings));
    return true;
}

function populateModelSelect(provider, selectedModelValue) {
    const modelSelect = document.getElementById("model-select");
    const customModelInput = document.getElementById("custom-model-input");
    if (!modelSelect) return;
    
    modelSelect.innerHTML = "";
    const models = PROVIDER_MODELS[provider] || [];
    
    models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
    });
    
    const customOpt = document.createElement("option");
    customOpt.value = "custom";
    customOpt.textContent = "직접 입력...";
    modelSelect.appendChild(customOpt);
    
    const hasModel = models.some(m => m.value === selectedModelValue);
    if (hasModel) {
        modelSelect.value = selectedModelValue;
        customModelInput.classList.add("hidden");
    } else if (selectedModelValue) {
        modelSelect.value = "custom";
        customModelInput.value = selectedModelValue;
        customModelInput.classList.remove("hidden");
    } else {
        modelSelect.value = models[0]?.value || "custom";
        customModelInput.classList.add("hidden");
    }
}

function takeChartScreenshot() {
    if (!priceChart) return null;
    try {
        const canvas = priceChart.takeScreenshot(true, false);
        if (!canvas) return null;
        return canvas.toDataURL("image/png");
    } catch (e) {
        console.error("Failed to capture chart screenshot:", e);
        return null;
    }
}

function getRecentCandlesText() {
    if (historicalCandles.length === 0) return "최근 캔들 데이터 없음";
    
    const recent = historicalCandles.slice(-15);
    let txt = "[최근 15개 캔들 데이터 (오래된 순 -> 최신 순)]\n";
    txt += "시간 | 시가 | 고가 | 저가 | 종가 | 거래량 | Z-Score | Z-Score EMA\n";
    txt += "-------------------------------------------------------------------------\n";
    
    recent.forEach((c, idx) => {
        const dataIdx = historicalCandles.length - 15 + idx;
        const dateStr = c.time ? new Date(c.time * 1000).toLocaleString('ko-KR') : "N/A";
        const oStr = c.open?.toLocaleString() || "N/A";
        const hStr = c.high?.toLocaleString() || "N/A";
        const lStr = c.low?.toLocaleString() || "N/A";
        const cStr = c.close?.toLocaleString() || "N/A";
        const vStr = c.volume?.toLocaleString() || "N/A";
        
        const rawZ = indicators.zScore[dataIdx]?.toFixed(3) || "N/A";
        const emaZ = indicators.zScoreEma[dataIdx]?.toFixed(3) || "N/A";
        
        txt += `${dateStr} | ${oStr} | ${hStr} | ${lStr} | ${cStr} | ${vStr} | ${rawZ} | ${emaZ}\n`;
    });
    
    return txt;
}

async function sendChatMessage(customPromptText = null) {
    const inputEl = document.getElementById("chat-input");
    const text = customPromptText || inputEl.value.trim();
    if (!text && !customPromptText) return;
    
    if (!customPromptText) {
        inputEl.value = "";
        inputEl.style.height = "48px";
    }
    
    let promptWithContext = `현재 활성 차트: ${activeSymbol} (${activeTimeframe})\n`;
    const candlesText = getRecentCandlesText();
    promptWithContext += candlesText + "\n\n";
    promptWithContext += `질문: ${text}`;
    
    appendMessage("user", text);
    chatHistory.push({ role: "user", content: promptWithContext });
    
    const loadingBubble = appendLoadingBubble();
    
    let chartImage = null;
    const attachScreenshotCb = document.getElementById("attach-screenshot-cb");
    if (attachScreenshotCb && attachScreenshotCb.checked) {
        chartImage = takeChartScreenshot();
    }
    
    disableChatInputs(true);
    
    try {
        const payload = {
            provider: chatSettings.provider,
            model: chatSettings.model,
            api_key: chatSettings.apiKey,
            ollama_url: chatSettings.ollamaUrl,
            system_prompt: chatSettings.systemPrompt,
            messages: chatHistory,
            chart_image: chartImage
        };
        
        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        
        if (loadingBubble && loadingBubble.parentNode) {
            loadingBubble.remove();
        }
        
        if (!response.ok) {
            let errMsg = `HTTP error ${response.status}`;
            try {
                const errData = await response.json();
                errMsg = errData.error || errMsg;
            } catch (e) {}
            throw new Error(errMsg);
        }
        
        const assistantBubble = appendEmptyMessage("assistant");
        let fullReply = "";
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();
            
            for (const line of lines) {
                if (!line.trim()) continue;
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.error) {
                        throw new Error(parsed.error);
                    }
                    const content = parsed.choices?.[0]?.delta?.content || "";
                    if (content) {
                        fullReply += content;
                        updateMessageBubble(assistantBubble, fullReply);
                    }
                } catch (err) {
                    if (err.message && (err.message.includes("API error") || err.message.includes("HTTP error") || err.message.includes("limit") || err.message.includes("quota") || err.message.includes("error") || err.message.includes("EXHAUSTED"))) {
                        if (assistantBubble && assistantBubble.parentNode) {
                            assistantBubble.parentNode.remove();
                        }
                        throw err;
                    }
                }
            }
        }
        
        if (buffer.trim()) {
            try {
                const parsed = JSON.parse(buffer);
                if (parsed.error) throw new Error(parsed.error);
                const content = parsed.choices?.[0]?.delta?.content || "";
                if (content) {
                    fullReply += content;
                    updateMessageBubble(assistantBubble, fullReply);
                }
            } catch (err) {
                if (err.message && (err.message.includes("API error") || err.message.includes("HTTP error") || err.message.includes("limit") || err.message.includes("quota") || err.message.includes("error") || err.message.includes("EXHAUSTED"))) {
                    if (assistantBubble && assistantBubble.parentNode) {
                        assistantBubble.parentNode.remove();
                    }
                    throw err;
                }
            }
        }
        
        chatHistory.push({ role: "assistant", content: fullReply });
    } catch (e) {
        console.error("Chat error:", e);
        if (loadingBubble && loadingBubble.parentNode) {
            loadingBubble.remove();
        }
        let errorMsg = `⚠️ 에러 발생: ${e.message}\n우측 상단의 설정(톱니바퀴) 아이콘을 눌러 API Key 또는 모델명이 올바른지 확인해 주세요.`;
        if (e.message.includes("429") || e.message.includes("Quota") || e.message.includes("limit") || e.message.includes("EXHAUSTED")) {
            errorMsg = `⚠️ API 사용량 제한(Quota Exceeded) 에러가 발생했습니다.\n\n` +
                       `**원인**: 선택하신 모델의 무료 호출 횟수를 초과했을 수 있습니다.\n` +
                       `**해결 방법**: 설정(톱니바퀴) 화면에서 모델을 **google/gemini-2.5-flash** 또는 다른 경량화 모델로 변경하여 다시 시도해 보세요.`;
        }
        appendMessage("assistant", errorMsg);
    } finally {
        disableChatInputs(false);
    }
}

function renderMarkdown(text) {
    if (!text) return "";
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
        
    html = html.replace(/```([\s\S]+?)```/g, (match, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });
    
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/^### (.*?)$/gm, "<h4>$1</h4>");
    html = html.replace(/^## (.*?)$/gm, "<h3>$1</h3>");
    html = html.replace(/^# (.*?)$/gm, "<h2>$1</h2>");
    html = html.replace(/^\s*[\*\-]\s+(.*?)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*?<\/li>)+/g, "<ul>$&</ul>");
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/<br>\s*<ul>/g, "<ul>").replace(/<\/ul>\s*<br>/g, "</ul>");
    
    return html;
}

function appendMessage(role, text) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return;
    
    const msgDiv = document.createElement("div");
    msgDiv.className = `${role}-msg message`;
    
    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "msg-bubble";
    
    if (role === "user") {
        bubbleDiv.textContent = text;
    } else {
        bubbleDiv.innerHTML = renderMarkdown(text);
    }
    
    msgDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function appendLoadingBubble() {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return null;
    
    const msgDiv = document.createElement("div");
    msgDiv.className = "ai-msg loading message";
    
    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "msg-bubble";
    bubbleDiv.textContent = "AI 분석가 분석 중";
    
    msgDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return msgDiv;
}

function disableChatInputs(disable) {
    document.getElementById("chat-input").disabled = disable;
    document.getElementById("send-chat-btn").disabled = disable;
    document.getElementById("quick-diagnose-btn").disabled = disable;
    document.getElementById("chat-settings-btn").disabled = disable;
    document.getElementById("toggle-chat-btn").disabled = disable;
}

function appendEmptyMessage(role) {
    const chatMessages = document.getElementById("chat-messages");
    if (!chatMessages) return null;
    
    const msgDiv = document.createElement("div");
    msgDiv.className = `${role}-msg message`;
    
    const bubbleDiv = document.createElement("div");
    bubbleDiv.className = "msg-bubble";
    
    msgDiv.appendChild(bubbleDiv);
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    return bubbleDiv;
}

function updateMessageBubble(bubbleDiv, text) {
    if (!bubbleDiv) return;
    bubbleDiv.innerHTML = renderMarkdown(text);
    
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function initSidebarResizer() {
    const sidebar = document.getElementById("chatbot-sidebar");
    const resizer = document.getElementById("sidebar-resizer");
    if (!sidebar || !resizer) return;
    
    let isResizing = false;
    
    resizer.addEventListener("mousedown", (e) => {
        isResizing = true;
        sidebar.classList.add("resizing");
        resizer.classList.add("resizing");
        document.body.style.cursor = "ew-resize";
        document.body.style.userSelect = "none";
    });
    
    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;
        
        const newWidth = window.innerWidth - e.clientX;
        if (newWidth >= 280 && newWidth <= window.innerWidth * 0.8) {
            sidebar.style.width = `${newWidth}px`;
            sidebar.style.minWidth = `${newWidth}px`;
        }
    });
    
    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            sidebar.classList.remove("resizing");
            resizer.classList.remove("resizing");
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            
            resizeCharts();
        }
    });
}
