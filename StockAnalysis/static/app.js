/**
 * app.js
 * Frontend logic for Aurora Strategy Lab.
 * Manages WebSocket state, auto-reconnect, chart drawing, and UI events.
 */

let ws = null;
let reconnectTimer = null;
let returnChart = null;
const wsUrl = `ws://${window.location.host}/ws`;

// Cache DOM elements
const wsIndicator = document.getElementById('ws-indicator');
const wsStatusText = document.getElementById('ws-status-text');
const logConsole = document.getElementById('log-console');
const signalTbody = document.getElementById('signal-tbody');
const tickerBadgesContainer = document.getElementById('ticker-badges-container');
const btnToggleScan = document.getElementById('btn-toggle-scan');
const btnClearLogs = document.getElementById('btn-clear-logs');
const btnRunBacktest = document.getElementById('btn-run-backtest');
const btnTranslateNlp = document.getElementById('btn-translate-nlp');
const aiNlInput = document.getElementById('ai-nl-input');
const aiCodeOutput = document.getElementById('ai-code-output');

// Backtest results nodes
const backtestResultsDiv = document.getElementById('backtest-results');
const resReturn = document.getElementById('res-return');
const resWinrate = document.getElementById('res-winrate');
const resMdd = document.getElementById('res-mdd');
const resTrades = document.getElementById('res-trades');

let isScanning = false;

// Initialize WebSocket Connection with Auto-Reconnect
function connectWebSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  appendConsoleLog(new Date().toLocaleTimeString(), "웹소켓 서버 연결을 시도하는 중...", "info");
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    wsIndicator.className = "status-indicator green";
    wsStatusText.innerText = "Connected";
    appendConsoleLog(new Date().toLocaleTimeString(), "웹소켓 연결이 개설되었습니다.", "success");
    
    // Request initial data loading
    sendWsMessage("init_request", {});
  };

  ws.onclose = () => {
    wsIndicator.className = "status-indicator red";
    wsStatusText.innerText = "Disconnected";
    appendConsoleLog(new Date().toLocaleTimeString(), "웹소켓 연결이 종료되었습니다. 3초 후 재연결을 시도합니다.", "warning");
    
    // Reset scan state on disconnect
    isScanning = false;
    btnToggleScan.innerText = "스캐너 시작";
    btnToggleScan.className = "btn btn-primary";

    reconnectTimer = setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    console.error("WebSocket Error:", err);
  };

  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleWsMessage(payload.component, payload.event, payload.data);
    } catch (e) {
      console.error("Error parsing websocket message:", e);
    }
  };
}

// Router for websocket messages
function handleWsMessage(component, event, data) {
  if (component === "LogViewer" && event === "log") {
    appendConsoleLog(data.timestamp, data.message, data.level);
  } 
  else if (component === "ControlPanel" && event === "tickers_loaded") {
    renderTickerBadges(data.tickers);
  }
  else if (component === "SignalDisplay" && event === "signal") {
    renderSignal(data);
  }
  else if (component === "ControlPanel" && event === "backtest_completed") {
    renderBacktestResults(data.metrics, data.chart_data);
  }
}

// Helper to send JSON messages
function sendWsMessage(event, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event, data }));
  }
}

// Render dynamic badges for selected stock list
function renderTickerBadges(tickers) {
  tickerBadgesContainer.innerHTML = '';
  tickers.forEach(t => {
    const badge = document.createElement('span');
    badge.className = 'ticker-badge';
    badge.innerText = `${t.name} (${t.code})`;
    tickerBadgesContainer.appendChild(badge);
  });
}

// Write to bottom terminal console
function appendConsoleLog(timestamp, message, level) {
  const line = document.createElement('div');
  line.className = 'log-line';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.innerText = `[${timestamp}]`;
  
  const contentSpan = document.createElement('span');
  contentSpan.className = `log-content log-${level || 'info'}`;
  contentSpan.innerText = message;
  
  line.appendChild(timeSpan);
  line.appendChild(contentSpan);
  logConsole.appendChild(line);
  
  // Auto scroll
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Append live market scan signal row
function renderSignal(signal) {
  // Remove placeholder if present
  const placeholder = signalTbody.querySelector('.placeholder-row');
  if (placeholder) {
    signalTbody.removeChild(placeholder);
  }

  const row = document.createElement('tr');
  row.className = 'signal-row-new';

  // Format currency
  const formattedPrice = new Intl.NumberFormat('ko-KR').format(signal.price) + " 원";

  row.innerHTML = `
    <td>${signal.time}</td>
    <td><span style="color: #8b5cf6; font-weight: 600;">${signal.strategy}</span></td>
    <td>${signal.code}</td>
    <td><strong>${signal.name}</strong></td>
    <td>${formattedPrice}</td>
    <td><span style="background: rgba(0, 240, 255, 0.12); color: #00f0ff; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">${signal.type}</span></td>
  `;

  // Prepend to show newest first
  signalTbody.insertBefore(row, signalTbody.firstChild);

  // Limit table rows to 50
  if (signalTbody.children.length > 50) {
    signalTbody.removeChild(signalTbody.lastChild);
  }
}

// Render simulation summaries and Chart.js line graph
function renderBacktestResults(metrics, chartData) {
  btnRunBacktest.disabled = false;
  btnRunBacktest.innerText = "백테스트 실행";

  backtestResultsDiv.style.display = 'block';

  // Highlight returns color
  const colorTheme = metrics.total_return >= 0 ? '#10b981' : '#ef4444';
  const prefix = metrics.total_return >= 0 ? '+' : '';
  
  resReturn.innerText = `${prefix}${metrics.total_return}%`;
  resReturn.style.color = colorTheme;
  resWinrate.innerText = `${metrics.win_rate}%`;
  resMdd.innerText = `${metrics.mdd}%`;
  resTrades.innerText = `${metrics.total_trades}회`;

  // Draw chart
  const labels = chartData.map(c => c.date);
  const dataPoints = chartData.map(c => c.value);

  const ctx = document.getElementById('returnChart').getContext('2d');
  
  if (returnChart) {
    returnChart.destroy();
  }

  // Create subtle cyan gradient for premium charting
  const gradient = ctx.createLinearGradient(0, 0, 0, 160);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(0, 240, 255, 0.00)');

  returnChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '누적 수익률 (%)',
        data: dataPoints,
        borderColor: '#00f0ff',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        backgroundColor: gradient,
        tension: 0.15
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0a0d1b',
          borderColor: 'rgba(255, 255, 255, 0.08)',
          borderWidth: 1,
          titleColor: '#94a3b8',
          bodyColor: '#ffffff',
          callbacks: {
            label: function(context) {
              return `수익률: ${context.parsed.y}%`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: { color: '#64748b', maxTicksLimit: 6, font: { size: 9 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: { color: '#64748b', font: { size: 9 } }
        }
      }
    }
  });
}

// Start/Stop scanner toggles
btnToggleScan.addEventListener('click', () => {
  if (!isScanning) {
    sendWsMessage("start_scan", {});
    isScanning = true;
    btnToggleScan.innerText = "스캐너 정지";
    btnToggleScan.className = "btn btn-secondary";
  } else {
    sendWsMessage("stop_scan", {});
    isScanning = false;
    btnToggleScan.innerText = "스캐너 시작";
    btnToggleScan.className = "btn btn-primary";
  }
});

// Clear console log
btnClearLogs.addEventListener('click', () => {
  logConsole.innerHTML = '';
  appendConsoleLog(new Date().toLocaleTimeString(), "로그 콘솔이 비워졌습니다.", "info");
});

// Trigger backtest run with selected params
btnRunBacktest.addEventListener('click', () => {
  const presets = [];
  if (document.getElementById('strat-rocket').checked) presets.push("Rocket Wind Plus");
  if (document.getElementById('strat-domino').checked) presets.push("Domino Rocket Wind");
  if (document.getElementById('strat-swing').checked) presets.push("스윙 추세돌파");

  const days = document.getElementById('history-days').value;
  const minPrice = document.getElementById('min-price').value;
  const minVolume = document.getElementById('min-volume').value;
  const includeEtf = document.getElementById('include-etf').checked;
  const customExpression = aiCodeOutput.value;

  if (presets.length === 0 && !customExpression) {
    alert("적어도 하나의 프리셋 전략을 선택하거나 AI 수식을 변환하여 입력해 주세요.");
    return;
  }

  btnRunBacktest.disabled = true;
  btnRunBacktest.innerText = "연산 중...";

  sendWsMessage("run_backtest", {
    presets,
    days,
    min_price: minPrice,
    min_volume: minVolume,
    include_etf: includeEtf,
    custom_expression: customExpression
  });
});

// Fetch translation for natural language condition query
btnTranslateNlp.addEventListener('click', async () => {
  const text = aiNlInput.value.trim();
  if (!text) {
    alert("자연어 조건식을 입력해 주세요.");
    return;
  }

  btnTranslateNlp.disabled = true;
  btnTranslateNlp.innerText = "변환 중...";
  appendConsoleLog(new Date().toLocaleTimeString(), `자연어 변환 시작: "${text}"`, "info");

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: text })
    });
    
    const outcome = await response.json();
    
    if (outcome.success) {
      aiCodeOutput.value = outcome.translated;
      appendConsoleLog(new Date().toLocaleTimeString(), `자연어 변환 성공: -> ${outcome.translated}`, "success");
    } else {
      aiCodeOutput.value = outcome.translated;
      appendConsoleLog(new Date().toLocaleTimeString(), `자연어 변환 실패 또는 부분 매핑됨: -> ${outcome.translated}`, "warning");
    }
  } catch (err) {
    console.error("Translation request failed:", err);
    appendConsoleLog(new Date().toLocaleTimeString(), `변환 에러 발생: ${err.message}`, "error");
    aiCodeOutput.value = "# 변환 서버에 연결할 수 없습니다.";
  } finally {
    btnTranslateNlp.disabled = false;
    btnTranslateNlp.innerText = "수식 변환";
  }
});

// Tab button highlights
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    
    const tabName = e.target.getAttribute('data-tab');
    appendConsoleLog(new Date().toLocaleTimeString(), `[Tab] '${e.target.innerText}' 탭으로 이동했습니다.`, "info");
  });
});

// Run
window.addEventListener('DOMContentLoaded', () => {
  connectWebSocket();
});
