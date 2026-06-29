// TradingView Plus - Frontend Application

// State variables
let availableSources = {};
let gridState = {
    gridSize: 4,
    panes: {}
};

// Actively running instances
const paneCharts = {};  // { paneId: { chart, series, observer, lastBarTime, lastPrice } }
const panePolls = {};   // { paneId: setIntervalRef }
const activeSubscriptions = {}; // { "BTC_1m": { refCount, panes: [] } }

// Hyperliquid WebSocket state
let hlSocket = null;

// Active pane and Chatbot state
let activePaneId = 1;
let chatSettings = {
    provider: "gemini",
    model: "gemini-2.0-flash",
    apiKey: "",
    ollamaUrl: "http://localhost:11434",
    systemPrompt: "당신은 전문 금융 트레이더이자 기술적 분석가입니다. 제공된 차트 이미지(스크린샷)와 최근 OHLCV 캔들 데이터를 결합하여 지지/저항선, 주요 이평선(SMA 20, EMA 50) 및 추세를 기술적으로 엄밀하게 분석하고 손익비가 높은 구체적인 진입/탈출 전략을 제안해 주세요. 답변은 한국어로 격식 있고 신뢰성 있게 기술적으로 상세히 답해주시기 바랍니다."
};
let chatHistory = [];

const PROVIDER_MODELS = {
    gemini: [
        { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (속도 추천)" },
        { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (고성능 분석)" },
        { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
        { value: "gemini-2.0-pro", label: "Gemini 2.0 Pro" },
        { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
        { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }
    ],
    openai: [
        { value: "gpt-4o-mini", label: "GPT-4o Mini (추천)" },
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" }
    ],
    claude: [
        { value: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (추천)" },
        { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" }
    ],
    ollama: [
        { value: "llava", label: "llava (로컬 비전)" },
        { value: "llama3", label: "llama3 (로컬 텍스트)" },
        { value: "mistral", label: "mistral (로컬 텍스트)" },
        { value: "gemma2", label: "gemma2 (로컬 텍스트)" }
    ],
    openrouter: [
        { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash (추천)" },
        { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
        { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
        { value: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
        { value: "openai/gpt-4o", label: "GPT-4o" },
        { value: "openai/gpt-4o-mini", label: "GPT-4o Mini" }
    ]
};

// ==========================================
// Initialization
// ==========================================

document.addEventListener("DOMContentLoaded", async () => {
    try {
        // 1. Fetch available data sources from backend
        const res = await fetch("/api/sources");
        if (!res.ok) throw new Error("Failed to fetch available sources");
        availableSources = await res.json();
        
        // 2. Load grid layout and configuration state
        loadState();
        
        // 3. Initialize Hyperliquid WebSocket client
        // 제거: 소켓이 실제 필요한 시점에만 동적으로 호출됩니다.
        
        // 4. Initialize layout selector control
        const sizeSelect = document.getElementById("grid-size-select");
        sizeSelect.value = gridState.gridSize;
        sizeSelect.addEventListener("change", (e) => {
            setGridSize(parseInt(e.target.value));
        });
        
        // 5. Build grid and initialize charts
        rebuildGrid();
        
        // 6. Initialize Chatbot Component
        initChatbot();
        
        // 7. Initialize Sidebar Resizer
        initSidebarResizer();
        
    } catch (err) {
        console.error("Initialization error:", err);
        alert("앱 초기화 오류: " + err.message);
    }
});

// ==========================================
// State Management & LocalStorage
// ==========================================

function loadState() {
    const saved = localStorage.getItem("mcd:v1:state");
    if (saved) {
        try {
            gridState = JSON.parse(saved);
            // Migrate old states without indicator flags
            for (const id in gridState.panes) {
                if (gridState.panes[id].showSma === undefined) gridState.panes[id].showSma = false;
                if (gridState.panes[id].showEma === undefined) gridState.panes[id].showEma = false;
            }
            return;
        } catch (e) {
            console.warn("Corrupt state found, resetting...");
        }
    }
    
    // Default fallback state
    gridState = {
        gridSize: 4,
        panes: {
            "1": { source: "krx", symbol: "삼성전자", timeframe: "1d", showSma: false, showEma: false },
            "2": { source: "krx", symbol: "SK하이닉스", timeframe: "1d", showSma: false, showEma: false },
            "3": { source: "hyperliquid", symbol: "BTC", timeframe: "1m", showSma: false, showEma: false },
            "4": { source: "yfinance", symbol: "RELIANCE.NS", timeframe: "1d", showSma: false, showEma: false }
        }
    };
    saveState();
}

function saveState() {
    localStorage.setItem("mcd:v1:state", JSON.stringify(gridState));
}

// ==========================================
// Layout & Grid Management
// ==========================================

function setGridSize(size) {
    gridState.gridSize = size;
    saveState();
    rebuildGrid();
}

function rebuildGrid() {
    const gridContainer = document.getElementById("charts-grid");
    
    // Remove existing grids and classes
    gridContainer.className = `charts-grid grid-${gridState.gridSize}`;
    
    const targetSize = gridState.gridSize;
    
    // 1. Destroy and remove panes that are out of bounds
    for (const paneId in paneCharts) {
        const idInt = parseInt(paneId);
        if (idInt > targetSize) {
            destroyPane(idInt);
        }
    }
    
    // 2. Render and initialize active panes
    const template = document.getElementById("pane-template").innerHTML;
    
    for (let i = 1; i <= targetSize; i++) {
        // If not already existing, mount it
        if (!paneCharts[i]) {
            // Check state cache or assign defaults
            if (!gridState.panes[i]) {
                // Alternating defaults
                if (i % 2 === 1) {
                    gridState.panes[i] = { source: "krx", symbol: "삼성전자", timeframe: "1d", showSma: false, showEma: false };
                } else {
                    gridState.panes[i] = { source: "yfinance", symbol: "RELIANCE.NS", timeframe: "1d", showSma: false, showEma: false };
                }
                saveState();
            }
            
            const html = template.replaceAll("{{id}}", i);
            gridContainer.insertAdjacentHTML("beforeend", html);
            
            const paneEl = document.getElementById(`pane-${i}`);
            if (paneEl) {
                initPane(i);
            } else {
                console.error(`rebuildGrid: Failed to find pane-${i} element after insertion! HTML length: ${html.length}`);
            }
        }
    }
    
    // Set active pane
    setActivePane(activePaneId > targetSize ? 1 : activePaneId);
}

function destroyPane(id) {
    stopPolling(id);
    
    const state = gridState.panes[id];
    if (state && state.source === "hyperliquid") {
        unsubscribeHlWS(id, state.symbol, state.timeframe);
    }
    
    const paneObj = paneCharts[id];
    if (paneObj) {
        paneObj.observer.disconnect();
        paneObj.chart.removeSeries(paneObj.series);
        paneObj.chart.remove();
        delete paneCharts[id];
    }
    
    const paneEl = document.getElementById(`pane-${id}`);
    if (paneEl) paneEl.remove();
}

// ==========================================
// Pane Controls & Dropdowns setup
// ==========================================

function initPane(id) {
    const paneEl = document.getElementById(`pane-${id}`);
    if (!paneEl) {
        console.warn(`initPane: pane-${id} element not found in DOM.`);
        return;
    }
    
    // Set active pane on click
    paneEl.addEventListener("click", () => {
        setActivePane(id);
    });
    
    const sourceSelect = paneEl.querySelector(".source-select");
    const symbolSelect = paneEl.querySelector(".symbol-select");
    const timeframeSelect = paneEl.querySelector(".timeframe-select");
    if (!sourceSelect || !symbolSelect || !timeframeSelect) {
        console.warn(`initPane: selects not found in pane-${id}.`);
        return;
    }
    
    const state = gridState.panes[id];
    
    // 1. Populate sources dropdown
    sourceSelect.innerHTML = "";
    for (const srcName in availableSources) {
        const opt = document.createElement("option");
        opt.value = srcName;
        opt.textContent = availableSources[srcName].label;
        sourceSelect.appendChild(opt);
    }
    sourceSelect.value = state.source;
    
    // 2. Event listener for source switch
    sourceSelect.addEventListener("change", (e) => {
        const newSource = e.target.value;
        const defaultSymbol = availableSources[newSource].symbols[0];
        const defaultTimeframe = availableSources[newSource].timeframes[0];
        
        updatePaneConfig(id, newSource, defaultSymbol, defaultTimeframe);
    });
    
    // 3. Setup dependent dropdowns (symbols & timeframes)
    populateDependentDropdowns(id, state.source, state.symbol, state.timeframe);
    
    // 4. Setup select listeners
    symbolSelect.addEventListener("change", (e) => {
        const paneState = gridState.panes[id];
        updatePaneConfig(id, paneState.source, e.target.value, paneState.timeframe);
    });
    
    timeframeSelect.addEventListener("change", (e) => {
        const paneState = gridState.panes[id];
        updatePaneConfig(id, paneState.source, paneState.symbol, e.target.value);
    });
    
    // 5. Setup indicator buttons
    const smaBtn = paneEl.querySelector('.indicator-toggle-btn[data-indicator="sma"]');
    const emaBtn = paneEl.querySelector('.indicator-toggle-btn[data-indicator="ema"]');
    if (smaBtn && emaBtn) {
        if (state.showSma) smaBtn.classList.add("active");
        if (state.showEma) emaBtn.classList.add("active");
        
        smaBtn.addEventListener("click", () => {
            const curState = gridState.panes[id];
            curState.showSma = !curState.showSma;
            saveState();
            smaBtn.classList.toggle("active", curState.showSma);
            
            const paneObj = paneCharts[id];
            if (paneObj) {
                paneObj.smaSeries.applyOptions({ visible: curState.showSma });
                if (curState.showSma) {
                    recalculateIndicators(id);
                }
            }
        });
        
        emaBtn.addEventListener("click", () => {
            const curState = gridState.panes[id];
            curState.showEma = !curState.showEma;
            saveState();
            emaBtn.classList.toggle("active", curState.showEma);
            
            const paneObj = paneCharts[id];
            if (paneObj) {
                paneObj.emaSeries.applyOptions({ visible: curState.showEma });
                if (curState.showEma) {
                    recalculateIndicators(id);
                }
            }
        });
    }
    
    // 6. Mount Lightweight Chart
    createPaneChart(id);
    
    // 6. Fetch history and kick off stream
    loadPaneData(id);
}

function populateDependentDropdowns(id, sourceName, selectedSymbol, selectedTimeframe) {
    const paneEl = document.getElementById(`pane-${id}`);
    if (!paneEl) {
        console.warn(`populateDependentDropdowns: pane-${id} element not found in DOM.`);
        return;
    }
    const symbolSelect = paneEl.querySelector(".symbol-select");
    const timeframeSelect = paneEl.querySelector(".timeframe-select");
    
    const config = availableSources[sourceName];
    if (!config) return;
    
    // Populate symbols
    symbolSelect.innerHTML = "";
    config.symbols.forEach(sym => {
        const opt = document.createElement("option");
        opt.value = sym;
        opt.textContent = sym;
        symbolSelect.appendChild(opt);
    });
    // Fallback if not found
    if (config.symbols.includes(selectedSymbol)) {
        symbolSelect.value = selectedSymbol;
    } else {
        symbolSelect.value = config.symbols[0];
        gridState.panes[id].symbol = config.symbols[0];
    }
    
    // Populate timeframes
    timeframeSelect.innerHTML = "";
    config.timeframes.forEach(tf => {
        const opt = document.createElement("option");
        opt.value = tf;
        opt.textContent = tf;
        timeframeSelect.appendChild(opt);
    });
    if (config.timeframes.includes(selectedTimeframe)) {
        timeframeSelect.value = selectedTimeframe;
    } else {
        timeframeSelect.value = config.timeframes[0];
        gridState.panes[id].timeframe = config.timeframes[0];
    }
    
    saveState();
}

function updatePaneConfig(id, source, symbol, timeframe) {
    const oldState = { ...gridState.panes[id] };
    
    // Unsubscribe from old source if appropriate
    if (oldState.source === "hyperliquid") {
        unsubscribeHlWS(id, oldState.symbol, oldState.timeframe);
    } else {
        stopPolling(id);
    }
    
    // Update config, retaining indicators state
    gridState.panes[id] = {
        source,
        symbol,
        timeframe,
        showSma: oldState.showSma !== undefined ? oldState.showSma : false,
        showEma: oldState.showEma !== undefined ? oldState.showEma : false
    };
    saveState();
    
    // Repopulate selects if source changed
    if (oldState.source !== source) {
        populateDependentDropdowns(id, source, symbol, timeframe);
    }
    
    // Load and reconnect streams
    loadPaneData(id);
    
    // Sync active pane header if this is the active pane
    if (id === activePaneId) {
        setActivePane(id);
    }
}

// ==========================================
// Chart Management
// ==========================================

function createPaneChart(id) {
    const container = document.getElementById(`chart-container-${id}`);
    
    // Base Chart Config
    const chart = LightweightCharts.createChart(container, {
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
            secondsVisible: false
        }
    });
    
    const state = gridState.panes[id];

    // Series Config
    const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
        upColor: "#0ecb81",
        downColor: "#f6465d",
        borderUpColor: "#0ecb81",
        borderDownColor: "#f6465d",
        wickUpColor: "#0ecb81",
        wickDownColor: "#f6465d"
    });
    
    // SMA Series Config (Gold)
    const smaSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: "#e0a500",
        lineWidth: 1.5,
        title: "SMA 20",
        visible: state ? !!state.showSma : false
    });
    
    // EMA Series Config (Magenta)
    const emaSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: "#b000b0",
        lineWidth: 1.5,
        title: "EMA 50",
        visible: state ? !!state.showEma : false
    });
    
    // Auto-Resize observer
    const observer = new ResizeObserver(entries => {
        if (entries.length === 0 || !entries[0].contentRect) return;
        const { width, height } = entries[0].contentRect;
        chart.resize(width, height);
    });
    observer.observe(container);
    
    paneCharts[id] = {
        chart,
        series,
        smaSeries,
        emaSeries,
        observer,
        lastBarTime: null,
        lastPrice: null,
        historicalCandles: []
    };
}

async function loadPaneData(id) {
    const state = gridState.panes[id];
    const paneObj = paneCharts[id];
    if (!paneObj) return;
    
    // Reset indicators
    document.getElementById(`ticker-symbol-${id}`).textContent = state.symbol;
    document.getElementById(`ticker-price-${id}`).textContent = "로딩 중...";
    const tickerBar = document.getElementById(`ticker-bar-${id}`);
    tickerBar.className = "pane-ticker-bar";
    
    try {
        const url = `/api/history?source=${state.source}&symbol=${encodeURIComponent(state.symbol)}&timeframe=${state.timeframe}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("History fetch failed");
        
        const data = await res.json();
        if (data && data.length > 0) {
            paneObj.series.setData(data);
            paneObj.historicalCandles = data;
            recalculateIndicators(id);
            
            // Set last bar indicators
            const lastBar = data[data.length - 1];
            paneObj.lastBarTime = lastBar.time;
            paneObj.lastPrice = lastBar.close;
            
            document.getElementById(`ticker-price-${id}`).textContent = lastBar.close.toLocaleString(undefined, { minimumFractionDigits: 2 });
            
            // Fit content
            paneObj.chart.timeScale().fitContent();
        } else {
            paneObj.series.setData([]);
            paneObj.historicalCandles = [];
            paneObj.smaSeries.setData([]);
            paneObj.emaSeries.setData([]);
            paneObj.lastBarTime = null;
            paneObj.lastPrice = null;
            document.getElementById(`ticker-price-${id}`).textContent = "데이터 없음";
        }
        
        // Start streaming or polling depending on config
        if (availableSources[state.source].realtime) {
            subscribeHlWS(id, state.symbol, state.timeframe);
        } else {
            startPolling(id, state.symbol);
        }
        
    } catch (e) {
        console.error(`Error loading data for pane ${id}:`, e);
        document.getElementById(`ticker-price-${id}`).textContent = "에러";
    }
}

// ==========================================
// Ticker Flashing & Updates
// ==========================================

function updatePanePrice(id, bar) {
    const paneObj = paneCharts[id];
    if (!paneObj) return;
    
    const priceText = document.getElementById(`ticker-price-${id}`);
    const tickerBar = document.getElementById(`ticker-bar-${id}`);
    
    const prevPrice = paneObj.lastPrice;
    const newPrice = bar.close;
    
    // Update historical candles array for indicators
    if (paneObj.historicalCandles.length > 0) {
        const lastIndex = paneObj.historicalCandles.length - 1;
        if (bar.time === paneObj.historicalCandles[lastIndex].time) {
            paneObj.historicalCandles[lastIndex] = bar;
        } else if (bar.time > paneObj.historicalCandles[lastIndex].time) {
            paneObj.historicalCandles.push(bar);
            if (paneObj.historicalCandles.length > 250) {
                paneObj.historicalCandles.shift();
            }
        }
    } else {
        paneObj.historicalCandles.push(bar);
    }
    
    // Update chart
    paneObj.series.update(bar);
    paneObj.lastPrice = newPrice;
    
    // Track last completed bar timestamp
    if (!paneObj.lastBarTime || bar.time >= paneObj.lastBarTime) {
        paneObj.lastBarTime = bar.time;
    }
    
    // Recalculate indicators dynamically
    recalculateIndicators(id);
    
    // Ticker visual updates
    priceText.textContent = newPrice.toLocaleString(undefined, { minimumFractionDigits: 2 });
    
    if (prevPrice !== null && newPrice !== prevPrice) {
        const isUp = newPrice > prevPrice;
        
        // Remove existing flashing and state classes
        tickerBar.classList.remove("up", "down", "flash-up", "flash-down");
        
        // Trigger reflow to restart CSS animations
        void tickerBar.offsetWidth;
        
        // Apply fresh flash and baseline classes
        if (isUp) {
            tickerBar.classList.add("up", "flash-up");
        } else {
            tickerBar.classList.add("down", "flash-down");
        }
    }
}

// ==========================================
// Polling Coordinator (yfinance)
// ==========================================

function startPolling(paneId, symbol) {
    stopPolling(paneId);
    
    const pollFunc = async () => {
        const state = gridState.panes[paneId];
        if (!state || state.symbol !== symbol) return; // Guard against rapid configuration switches
        
        try {
            const res = await fetch(`/api/quote?source=${state.source}&symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) return;
            
            const quote = await res.json();
            if (quote && quote.time) {
                // Construct bar structure matching the series timeframe
                // The quote contains the latest 1m interval bar values
                // For polling, we feed it directly as live tick updates.
                updatePanePrice(paneId, {
                    time: quote.time,
                    open: quote.open,
                    high: quote.high,
                    low: quote.low,
                    close: quote.close,
                    volume: quote.volume
                });
            }
        } catch (e) {
            console.error(`Error polling quote for pane ${paneId}:`, e);
        }
    };
    
    // Determine dynamic interval based on timeframe to optimize traffic/CPU
    const state = gridState.panes[paneId];
    let intervalMs = 10000; // default 10 seconds
    if (state) {
        switch (state.timeframe) {
            case "1d":
                intervalMs = 300000; // 5 minutes for daily bars
                break;
            case "1h":
                intervalMs = 60000;  // 1 minute for hourly bars
                break;
            case "15m":
                intervalMs = 30000;  // 30 seconds for 15m bars
                break;
            case "5m":
                intervalMs = 15000;  // 15 seconds for 5m bars
                break;
            case "1m":
            default:
                intervalMs = 5000;   // 5 seconds for 1m bars
                break;
        }
    }
    
    // Poll instantly, then repeat at dynamic interval
    pollFunc();
    panePolls[paneId] = setInterval(pollFunc, intervalMs);
}

function stopPolling(paneId) {
    if (panePolls[paneId]) {
        clearInterval(panePolls[paneId]);
        delete panePolls[paneId];
    }
}

// ==========================================
// Shared WS Coordinator (Hyperliquid)
// ==========================================

function connectHyperliquidWS() {
    if (hlSocket && (hlSocket.readyState === WebSocket.CONNECTING || hlSocket.readyState === WebSocket.OPEN)) {
        return;
    }
    
    hlSocket = new WebSocket("wss://api.hyperliquid.xyz/ws");
    
    hlSocket.onopen = () => {
        console.log("Hyperliquid WS connected.");
        // Resubscribe to all active topics
        for (const topic in activeSubscriptions) {
            const [coin, interval] = topic.split("_");
            sendWSMessage("subscribe", coin, interval);
        }
    };
    
    hlSocket.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.channel === "candle" && msg.data) {
                const c = msg.data;
                const topic = `${c.s}_${c.i}`;
                
                if (activeSubscriptions[topic]) {
                    const bar = {
                        time: Math.floor(c.t / 1000), // ms to seconds
                        open: parseFloat(c.o),
                        high: parseFloat(c.h),
                        low: parseFloat(c.l),
                        close: parseFloat(c.c),
                        volume: parseFloat(c.v)
                    };
                    
                    activeSubscriptions[topic].panes.forEach(paneId => {
                        updatePanePrice(paneId, bar);
                    });
                }
            }
        } catch (err) {
            console.error("WS message parse failed:", err);
        }
    };
    
    hlSocket.onclose = () => {
        console.log("Hyperliquid WS closed. Retrying in 3 seconds...");
        setTimeout(connectHyperliquidWS, 3000);
    };
    
    hlSocket.onerror = (e) => {
        console.error("Hyperliquid WS error:", e);
    };
}

function sendWSMessage(method, coin, interval) {
    if (hlSocket && hlSocket.readyState === WebSocket.OPEN) {
        hlSocket.send(JSON.stringify({
            method: method,
            subscription: {
                type: "candle",
                coin: coin,
                interval: interval
            }
        }));
    }
}

function subscribeHlWS(paneId, coin, interval) {
    // Hyperliquid WS 연결이 열려있지 않은 경우 동적 개시
    if (!hlSocket || hlSocket.readyState !== WebSocket.OPEN) {
        connectHyperliquidWS();
    }
    const topic = `${coin}_${interval}`;
    
    if (!activeSubscriptions[topic]) {
        activeSubscriptions[topic] = { refCount: 0, panes: [] };
    }
    
    const sub = activeSubscriptions[topic];
    if (!sub.panes.includes(paneId)) {
        sub.panes.push(paneId);
        sub.refCount++;
        
        // If it's a fresh topic, send WS subscribe message
        if (sub.refCount === 1) {
            sendWSMessage("subscribe", coin, interval);
        }
    }
}

function unsubscribeHlWS(paneId, coin, interval) {
    const topic = `${coin}_${interval}`;
    const sub = activeSubscriptions[topic];
    
    if (sub && sub.panes.includes(paneId)) {
        sub.panes = sub.panes.filter(id => id !== paneId);
        sub.refCount--;
        
        // If no more panes are watching, unsubscribe and clean registry
        if (sub.refCount === 0) {
            sendWSMessage("unsubscribe", coin, interval);
            delete activeSubscriptions[topic];
        }
    }
}

// ==========================================
// Technical Indicator Calculation Logic
// ==========================================

function calculateSMA(data, period) {
    const sma = [];
    if (!data || data.length < period) return sma;
    
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) continue;
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j].close;
        }
        sma.push({
            time: data[i].time,
            value: sum / period
        });
    }
    return sma;
}

function calculateEMA(data, period) {
    const ema = [];
    if (!data || data.length < period) return ema;
    
    // Calculate initial SMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i].close;
    }
    let prevEma = sum / period;
    ema.push({ time: data[period - 1].time, value: prevEma });
    
    const multiplier = 2 / (period + 1);
    for (let i = period; i < data.length; i++) {
        const close = data[i].close;
        const currentEma = (close - prevEma) * multiplier + prevEma;
        ema.push({ time: data[i].time, value: currentEma });
        prevEma = currentEma;
    }
    return ema;
}

function recalculateIndicators(id) {
    const paneObj = paneCharts[id];
    const state = gridState.panes[id];
    if (!paneObj || !state) return;
    
    const data = paneObj.historicalCandles;
    if (!data || data.length === 0) return;
    
    if (state.showSma) {
        const smaData = calculateSMA(data, 20);
        paneObj.smaSeries.setData(smaData);
    }
    
    if (state.showEma) {
        const emaData = calculateEMA(data, 50);
        paneObj.emaSeries.setData(emaData);
    }
}

// ==========================================
// AI Chatbot Integration Functions
// ==========================================

function setActivePane(id) {
    activePaneId = id;
    
    // Remove active-pane class from all panes
    document.querySelectorAll(".chart-pane").forEach(el => {
        el.classList.remove("active-pane");
    });
    
    // Add to current pane
    const activeEl = document.getElementById(`pane-${id}`);
    if (activeEl) {
        activeEl.classList.add("active-pane");
    }
    
    // Update chatbot header label
    const state = gridState.panes[id];
    const labelEl = document.getElementById("active-chart-label");
    if (labelEl && state) {
        labelEl.textContent = `선택된 차트: ${state.source.toUpperCase()} - ${state.symbol} (${state.timeframe})`;
    }
}

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
            triggerChartResize();
        }, 350);
    });
    
    closeBtn.addEventListener("click", () => {
        sidebar.style.width = "";
        sidebar.style.minWidth = "";
        sidebar.classList.add("collapsed");
        setTimeout(() => {
            triggerChartResize();
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
        const state = gridState.panes[activePaneId];
        const symbol = state ? state.symbol : "-";
        const timeframe = state ? state.timeframe : "-";
        const text = `현재 ${symbol} (${timeframe}) 차트 상황을 기술적으로 즉시 정밀 분석해 주세요. 이동평균선(SMA 20, EMA 50), 거래량 패턴, 캔들 지지/저항 구조를 기반으로 향후 추세 방향성 및 손익비가 우수한 진입 전략을 제안해 줘.`;
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
    setActivePane(activePaneId);
}

function loadChatSettings() {
    const saved = localStorage.getItem("tvp:chat:settings");
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
    localStorage.setItem("tvp:chat:settings", JSON.stringify(chatSettings));
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

function takeChartScreenshot(paneId) {
    const paneObj = paneCharts[paneId];
    if (!paneObj || !paneObj.chart) return null;
    
    try {
        const canvas = paneObj.chart.takeScreenshot(true, false);
        if (!canvas) return null;
        return canvas.toDataURL("image/png");
    } catch (e) {
        console.error("Failed to capture chart screenshot:", e);
        return null;
    }
}

function getRecentCandlesText(paneId) {
    const paneObj = paneCharts[paneId];
    if (!paneObj || !paneObj.historicalCandles || paneObj.historicalCandles.length === 0) {
        return "최근 캔들 데이터 없음";
    }
    
    const recent = paneObj.historicalCandles.slice(-20);
    let txt = "[최근 20개 캔들 데이터 (오래된 순 -> 최신 순)]\n";
    txt += "시간 | 시가(Open) | 고가(High) | 저가(Low) | 종가(Close) | 거래량(Volume)\n";
    txt += "-------------------------------------------------------------\n";
    
    recent.forEach(c => {
        const dateStr = c.time ? new Date(c.time * 1000).toLocaleString('ko-KR') : "N/A";
        const openStr = c.open !== undefined && c.open !== null ? c.open.toLocaleString() : "N/A";
        const highStr = c.high !== undefined && c.high !== null ? c.high.toLocaleString() : "N/A";
        const lowStr = c.low !== undefined && c.low !== null ? c.low.toLocaleString() : "N/A";
        const closeStr = c.close !== undefined && c.close !== null ? c.close.toLocaleString() : "N/A";
        const volumeStr = c.volume !== undefined && c.volume !== null ? c.volume.toLocaleString() : "N/A";
        txt += `${dateStr} | ${openStr} | ${highStr} | ${lowStr} | ${closeStr} | ${volumeStr}\n`;
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
    
    const state = gridState.panes[activePaneId];
    const paneObj = paneCharts[activePaneId];
    if (!state) {
        alert("분석할 활성 차트가 지정되지 않았습니다.");
        return;
    }
    
    let promptWithContext = `현재 활성 차트: ${state.source.toUpperCase()} - ${state.symbol} (${state.timeframe})\n`;
    if (paneObj && paneObj.lastPrice) {
        promptWithContext += `현재가: ${paneObj.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}\n\n`;
    }
    
    const candlesText = getRecentCandlesText(activePaneId);
    promptWithContext += candlesText + "\n\n";
    promptWithContext += `질문: ${text}`;
    
    appendMessage("user", text);
    chatHistory.push({ role: "user", content: promptWithContext });
    
    const loadingBubble = appendLoadingBubble();
    
    let chartImage = null;
    const attachScreenshotCb = document.getElementById("attach-screenshot-cb");
    if (attachScreenshotCb && attachScreenshotCb.checked) {
        chartImage = takeChartScreenshot(activePaneId);
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
            headers: {
                "Content-Type": "application/json"
            },
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
                    if (err.message && (err.message.includes("API error") || err.message.includes("HTTP error") || err.message.includes("Gemini") || err.message.includes("quota") || err.message.includes("limit") || err.message.includes("error") || err.message.includes("EXHAUSTED"))) {
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
                if (parsed.error) {
                    throw new Error(parsed.error);
                }
                const content = parsed.choices?.[0]?.delta?.content || "";
                if (content) {
                    fullReply += content;
                    updateMessageBubble(assistantBubble, fullReply);
                }
            } catch (err) {
                if (err.message && (err.message.includes("API error") || err.message.includes("HTTP error") || err.message.includes("Gemini") || err.message.includes("quota") || err.message.includes("limit") || err.message.includes("error") || err.message.includes("EXHAUSTED"))) {
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
        let errorMsg = `⚠️ 에러 발생: ${e.message}\n설정 아이콘(톱니바퀴)을 눌러 API Key 또는 선택한 모델명이 올바른지 확인해 주세요.`;
        if (e.message.includes("429") || e.message.includes("Quota") || e.message.includes("limit") || e.message.includes("EXHAUSTED")) {
            errorMsg = `⚠️ API 사용량 제한(Quota Exceeded) 초과 에러가 발생했습니다.\n\n` +
                       `**원인**: 선택하신 모델(예: Gemini 2.0)의 Free 티어 호출 한도가 소진되었거나 계정에 제한이 적용되었을 수 있습니다.\n` +
                       `**해결 방법**: 설정(톱니바퀴) 화면에서 모델을 **Gemini 1.5 Flash**로 변경하여 다시 시도해 보세요.`;
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
            
            triggerChartResize();
        }
    });
}

function triggerChartResize() {
    for (const id in paneCharts) {
        const paneObj = paneCharts[id];
        if (paneObj && paneObj.chart) {
            const container = document.getElementById(`chart-container-${id}`);
            if (container) {
                paneObj.chart.resize(container.clientWidth, container.clientHeight);
            }
        }
    }
}
