// app.js
// JavaScript controller for StrategyFactory Stock App

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Lucide Icons
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  // Global State
  const state = {
    activeTab: 'dashboard-view',
    priceTickers: {
      'AAPL': { price: 182.50, volatility: 0.0015, trend: 0.0001 },
      'NVDA': { price: 875.12, volatility: 0.0035, trend: 0.0003 },
      'TSLA': { price: 177.40, volatility: 0.0028, trend: -0.0001 },
      'BTCUSDT': { price: 65420.00, volatility: 0.0040, trend: 0.0004 },
      'ETHUSDT': { price: 3480.50, volatility: 0.0035, trend: 0.0002 }
    },
    bots: [
      {
        id: 'bot-1',
        name: 'Momentum Alpha',
        asset: 'BTCUSDT',
        strategy: 'SMA_CROSS',
        allocation: 5000,
        profit: 342.10,
        profitPercent: 6.84,
        status: 'ACTIVE',
        history: Array.from({length: 40}, (_, i) => 64000 + Math.sin(i/3)*1000 + Math.random()*200),
        trades: []
      },
      {
        id: 'bot-2',
        name: 'Mean Reversion',
        asset: 'ETHUSDT',
        strategy: 'RSI_OS_OB',
        allocation: 3000,
        profit: -45.20,
        profitPercent: -1.51,
        status: 'ACTIVE',
        history: Array.from({length: 40}, (_, i) => 3400 + Math.cos(i/4)*80 + Math.random()*20),
        trades: []
      },
      {
        id: 'bot-3',
        name: 'Trend Rider',
        asset: 'AAPL',
        strategy: 'MACD_MOM',
        allocation: 4000,
        profit: 184.60,
        profitPercent: 4.62,
        status: 'ACTIVE',
        history: Array.from({length: 40}, (_, i) => 175 + i*0.2 + Math.random()*1.5),
        trades: []
      }
    ],
    lastBacktest: null,
    dashboardChart: null,
    backtestChart: null,
    pricingBillingCycle: 'monthly', // 'monthly' or 'annual'
    webhookActivePayloadTab: 'buy'
  };

  // Cache DOM elements
  const navTabs = document.getElementById('main-nav-tabs');
  const sections = document.querySelectorAll('.view-section');
  const liveLogContainer = document.getElementById('live-trade-log-container');
  const botFleetGrid = document.getElementById('bot-fleet-grid-container');
  const pricingMonthlyBtn = document.getElementById('btn-pricing-monthly');
  const pricingAnnualBtn = document.getElementById('btn-pricing-annual');
  const deployBotModal = document.getElementById('deploy-bot-modal');

  // Dashboard Stats Dom
  const statTotalProfit = document.getElementById('stat-total-profit');
  const statActiveBots = document.getElementById('stat-active-bots');
  const statTrades24h = document.getElementById('stat-trades-24h');

  // BACKTEST ENGINE ELEMENTS
  const strategyBuilderForm = document.getElementById('strategy-builder-form');
  const paramStrategySelect = document.getElementById('param-strategy');
  const paramGroupSma = document.getElementById('param-group-sma');
  const paramGroupRsi = document.getElementById('param-group-rsi');
  
  // Backtest result placeholders
  const backtestLoadingState = document.getElementById('backtest-loading-state');
  const backtestEmptyState = document.getElementById('backtest-empty-state');
  const backtestResultsContent = document.getElementById('backtest-results-content');
  const btnDeployStrategy = document.getElementById('btn-deploy-strategy');

  // Slider visual value updaters
  const setupSliderUpdater = (sliderId, valId, suffix = '') => {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(valId);
    if (slider && label) {
      slider.addEventListener('input', () => {
        label.textContent = slider.value + suffix;
      });
    }
  };

  setupSliderUpdater('param-fast-ma', 'val-fast-ma');
  setupSliderUpdater('param-slow-ma', 'val-slow-ma');
  setupSliderUpdater('param-rsi-len', 'val-rsi-len');
  setupSliderUpdater('param-rsi-ob', 'val-rsi-ob');
  setupSliderUpdater('param-rsi-os', 'val-rsi-os');
  setupSliderUpdater('param-sl', 'val-sl', '%');
  setupSliderUpdater('param-tp', 'val-tp', '%');

  // Toggle form parameter sub-groups based on selected strategy
  paramStrategySelect.addEventListener('change', (e) => {
    if (e.target.value === 'SMA_CROSS') {
      paramGroupSma.style.display = 'block';
      paramGroupRsi.style.display = 'none';
    } else if (e.target.value === 'RSI_OS_OB') {
      paramGroupSma.style.display = 'none';
      paramGroupRsi.style.display = 'block';
    } else {
      // MACD or Bollinger uses base SL/TP sliders
      paramGroupSma.style.display = 'none';
      paramGroupRsi.style.display = 'none';
    }
  });

  // 2. Tab Navigation logic
  const switchTab = (tabId) => {
    state.activeTab = tabId;
    
    // Update navbar buttons
    const buttons = navTabs.querySelectorAll('.nav-tab-btn');
    buttons.forEach(btn => {
      if (btn.getAttribute('data-target') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update section visibility
    sections.forEach(section => {
      if (section.id === tabId) {
        section.classList.add('active');
      } else {
        section.classList.remove('active');
      }
    });

    // Custom charts resizing updates
    if (tabId === 'dashboard-view' && state.dashboardChart) {
      state.dashboardChart.resize();
    }
    if (tabId === 'builder-view' && state.backtestChart) {
      state.backtestChart.resize();
    }
  };

  navTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('.nav-tab-btn');
    if (btn) {
      const target = btn.getAttribute('data-target');
      switchTab(target);
    }
  });

  // Footer navigation links triggers
  document.querySelectorAll('.footer-tab-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const target = trigger.getAttribute('data-target');
      switchTab(target);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // 3. Price Simulation Engine
  const updatePrices = () => {
    Object.keys(state.priceTickers).forEach(symbol => {
      const ticker = state.priceTickers[symbol];
      const changePercent = (Math.random() - 0.5) * 2 * ticker.volatility + ticker.trend;
      const prevPrice = ticker.price;
      ticker.price = Math.max(0.01, prevPrice * (1 + changePercent));

      // Propagate live price update to bots
      state.bots.forEach(bot => {
        if (bot.asset === symbol && bot.status === 'ACTIVE') {
          bot.history.push(ticker.price);
          if (bot.history.length > 50) {
            bot.history.shift();
          }
          // Dynamic PnL fluctuation simulator
          const pnlChange = (ticker.price / prevPrice - 1) * bot.allocation * 1.5;
          bot.profit += pnlChange;
          bot.profitPercent = (bot.profit / bot.allocation) * 100;
          
          // Randomly trigger mock bot fill trade signals
          if (Math.random() < 0.04) {
            triggerLiveBotTrade(bot);
          }
        }
      });
    });

    // Periodically update dashboard stat cards to feel live
    updateDashboardStats();
  };

  setInterval(updatePrices, 1000);

  // Generate real-time activity trades for active bots
  const triggerLiveBotTrade = (bot) => {
    const isBuy = Math.random() > 0.45;
    const price = state.priceTickers[bot.asset].price.toFixed(2);
    const pnl = isBuy ? '' : ` (${(Math.random() * 4 - 1.5).toFixed(2)}%)`;
    
    // Add trade record
    bot.trades.unshift({
      time: new Date().toLocaleTimeString(),
      type: isBuy ? 'BUY' : 'SELL',
      price: parseFloat(price),
      pnl: isBuy ? null : parseFloat(pnl)
    });

    // Trigger log addition
    addLogMessage(bot.name, bot.asset, isBuy ? 'BUY' : 'SELL', price);
  };

  const addLogMessage = (botName, asset, type, price) => {
    const timestamp = new Date().toLocaleTimeString();
    const logItem = document.createElement('div');
    logItem.className = 'log-item';
    
    const actionClass = type === 'BUY' ? 'log-action-buy' : 'log-action-sell';
    logItem.innerHTML = `
      <span class="log-time">[${timestamp}]</span>
      <span style="font-weight: 800;">${botName} (${asset})</span>
      <span class="${actionClass}">${type}</span>
      <span style="font-weight: bold;">$${price}</span>
    `;

    liveLogContainer.insertBefore(logItem, liveLogContainer.firstChild);

    // Keep log feed from bloating
    if (liveLogContainer.childNodes.length > 25) {
      liveLogContainer.removeChild(liveLogContainer.lastChild);
    }
  };

  const updateDashboardStats = () => {
    let totalPnl = 13800.20; // baseline mock starting profits
    state.bots.forEach(bot => {
      totalPnl += bot.profit;
    });
    statTotalProfit.textContent = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
    if (totalPnl >= 0) {
      statTotalProfit.style.color = '#10B981';
    } else {
      statTotalProfit.style.color = '#EF4444';
    }

    statActiveBots.textContent = `${state.bots.filter(b => b.status === 'ACTIVE').length} Bots`;
    
    // Update dashboard performance graph line slowly with mock fluctuations
    if (state.dashboardChart && Math.random() < 0.2) {
      const data = state.dashboardChart.data.datasets[0].data;
      data.push(totalPnl);
      if (data.length > 20) data.shift();
      
      const labels = state.dashboardChart.data.labels;
      labels.push(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      if (labels.length > 20) labels.shift();

      state.dashboardChart.update();
    }
  };

  // Populating initial logs
  const initLogs = () => {
    const assets = ['AAPL', 'NVDA', 'BTCUSDT', 'ETHUSDT'];
    for (let i = 0; i < 8; i++) {
      const symbol = assets[Math.floor(Math.random() * assets.length)];
      const type = Math.random() > 0.5 ? 'BUY' : 'SELL';
      const price = (state.priceTickers[symbol].price * (1 + (Math.random() - 0.5) * 0.05)).toFixed(2);
      addLogMessage('Fleet Execution', symbol, type, price);
    }
  };
  initLogs();

  // 4. Initializing Charts
  const initDashboardPerformanceChart = () => {
    const ctx = document.getElementById('dashboardPerformanceChart');
    if (!ctx) return;

    const mockHistory = Array.from({length: 12}, (_, i) => 8000 + i * 500 + Math.sin(i) * 300);
    const mockLabels = Array.from({length: 12}, (_, i) => {
      const d = new Date();
      d.setHours(d.getHours() - (12 - i));
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    });

    state.dashboardChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: mockLabels,
        datasets: [{
          label: 'Total Net P&L ($)',
          data: mockHistory,
          borderColor: '#0B1220',
          borderWidth: 3,
          backgroundColor: 'rgba(255, 176, 32, 0.1)',
          fill: true,
          tension: 0.1,
          pointBackgroundColor: '#FFB020',
          pointBorderColor: '#0B1220',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: 'rgba(11, 18, 32, 0.05)' },
            ticks: { color: '#6B7280', font: { family: 'Outfit', weight: 'bold' } }
          },
          y: {
            grid: { color: 'rgba(11, 18, 32, 0.05)' },
            ticks: { color: '#6B7280', font: { family: 'Outfit', weight: 'bold' } }
          }
        }
      }
    });
  };

  initDashboardPerformanceChart();

  // 5. Backtest Mathematical Engine
  const generateSimulatedPrices = (asset, length = 150) => {
    const base = state.priceTickers[asset];
    let currentPrice = base.price * 0.75; // start lower
    const prices = [];
    
    // Brownian motion simulation with seed drift
    const drift = base.trend * 4; 
    const vol = base.volatility * 2.5;

    for (let i = 0; i < length; i++) {
      const shock = (Math.random() - 0.5) * 2 * vol + drift;
      currentPrice = currentPrice * (1 + shock);
      prices.push({
        time: i,
        price: currentPrice
      });
    }
    return prices;
  };

  const calculateSMA = (prices, period) => {
    const sma = [];
    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        sma.push(null);
        continue;
      }
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += prices[i - j].price;
      }
      sma.push(sum / period);
    }
    return sma;
  };

  const calculateRSI = (prices, length) => {
    const rsi = [];
    let gains = [];
    let losses = [];
    
    for (let i = 0; i < prices.length; i++) {
      if (i === 0) {
        rsi.push(null);
        continue;
      }
      const change = prices[i].price - prices[i - 1].price;
      gains.push(change > 0 ? change : 0);
      losses.push(change < 0 ? -change : 0);

      if (i < length) {
        rsi.push(null);
        continue;
      }

      let avgGain = gains.slice(i - length, i).reduce((a, b) => a + b, 0) / length;
      let avgLoss = losses.slice(i - length, i).reduce((a, b) => a + b, 0) / length;

      if (avgLoss === 0) {
        rsi.push(100);
      } else {
        const rs = avgGain / avgLoss;
        rsi.push(100 - (100 / (1 + rs)));
      }
    }
    return rsi;
  };

  const runBacktestLogic = (asset, strategyType, params) => {
    const dataPoints = generateSimulatedPrices(asset, 180);
    const rawPrices = dataPoints.map(d => d.price);
    
    let trades = [];
    let position = null; // { entryPrice, entryIndex, side: 'long' }
    
    const stopLossPct = params.stopLoss / 100;
    const takeProfitPct = params.takeProfit / 100;

    // Precalculate indicator signals
    let fastMA, slowMA, rsi;
    if (strategyType === 'SMA_CROSS') {
      fastMA = calculateSMA(dataPoints, params.fastMa);
      slowMA = calculateSMA(dataPoints, params.slowMa);
    } else if (strategyType === 'RSI_OS_OB') {
      rsi = calculateRSI(dataPoints, params.rsiLen);
    }

    for (let i = 2; i < dataPoints.length; i++) {
      const currentPrice = rawPrices[i];

      // Check Stop Loss or Take Profit exit conditions if inside trade
      if (position) {
        const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
        
        if (pnlPct <= -stopLossPct) {
          // SL triggered
          trades.push({
            num: trades.length + 1,
            type: 'LONG',
            entryPrice: position.entryPrice,
            exitPrice: position.entryPrice * (1 - stopLossPct),
            pnlPercent: -stopLossPct * 100,
            exitIndex: i
          });
          position = null;
          continue;
        } else if (pnlPct >= takeProfitPct) {
          // TP triggered
          trades.push({
            num: trades.length + 1,
            type: 'LONG',
            entryPrice: position.entryPrice,
            exitPrice: position.entryPrice * (1 + takeProfitPct),
            pnlPercent: takeProfitPct * 100,
            exitIndex: i
          });
          position = null;
          continue;
        }
      }

      // Check Strategy Signal Entries/Exits
      if (strategyType === 'SMA_CROSS') {
        const prevFast = fastMA[i - 1];
        const prevSlow = slowMA[i - 1];
        const currFast = fastMA[i];
        const currSlow = slowMA[i];

        if (prevFast && prevSlow && currFast && currSlow) {
          // Golden Cross (Buy Entry)
          if (prevFast <= prevSlow && currFast > currSlow && !position) {
            position = { entryPrice: currentPrice, entryIndex: i };
          }
          // Death Cross (Exit/Sell Signal)
          else if (prevFast >= prevSlow && currFast < currSlow && position) {
            const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
            trades.push({
              num: trades.length + 1,
              type: 'LONG',
              entryPrice: position.entryPrice,
              exitPrice: currentPrice,
              pnlPercent: pnlPct * 100,
              exitIndex: i
            });
            position = null;
          }
        }
      } 
      else if (strategyType === 'RSI_OS_OB') {
        const currRsi = rsi[i];
        const prevRsi = rsi[i - 1];

        if (currRsi && prevRsi) {
          // Oversold crossover above threshold (Buy)
          if (prevRsi <= params.rsiOs && currRsi > params.rsiOs && !position) {
            position = { entryPrice: currentPrice, entryIndex: i };
          }
          // Overbought crossover below threshold (Exit)
          else if (prevRsi >= params.rsiOb && currRsi < params.rsiOb && position) {
            const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
            trades.push({
              num: trades.length + 1,
              type: 'LONG',
              entryPrice: position.entryPrice,
              exitPrice: currentPrice,
              pnlPercent: pnlPct * 100,
              exitIndex: i
            });
            position = null;
          }
        }
      } 
      else {
        // Mock fallback for MACD or Bollinger
        if (!position && Math.random() < 0.05) {
          position = { entryPrice: currentPrice, entryIndex: i };
        } else if (position && Math.random() < 0.06) {
          const pnlPct = (currentPrice - position.entryPrice) / position.entryPrice;
          trades.push({
            num: trades.length + 1,
            type: 'LONG',
            entryPrice: position.entryPrice,
            exitPrice: currentPrice,
            pnlPercent: pnlPct * 100,
            exitIndex: i
          });
          position = null;
        }
      }
    }

    // Force close open trades at end of path
    if (position) {
      const finalPrice = rawPrices[rawPrices.length - 1];
      const pnlPct = (finalPrice - position.entryPrice) / position.entryPrice;
      trades.push({
        num: trades.length + 1,
        type: 'LONG',
        entryPrice: position.entryPrice,
        exitPrice: finalPrice,
        pnlPercent: pnlPct * 100,
        exitIndex: rawPrices.length - 1
      });
    }

    // Generate cumulative returns array for performance plotting
    let balance = 10000;
    const equityPath = [balance];
    let wins = 0;
    let gainsSum = 0;
    let lossesSum = 0;
    let maxDd = 0;
    let peak = balance;

    trades.forEach(t => {
      const pnlCash = balance * (t.pnlPercent / 100);
      balance += pnlCash;
      equityPath.push(balance);

      if (balance > peak) peak = balance;
      const dd = (peak - balance) / peak * 100;
      if (dd > maxDd) maxDd = dd;

      if (t.pnlPercent > 0) {
        wins++;
        gainsSum += pnlCash;
      } else {
        lossesSum += Math.abs(pnlCash);
      }
    });

    const totalReturnPercent = ((balance - 10000) / 10000) * 100;
    const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;
    const profitFactor = lossesSum === 0 ? gainsSum : (gainsSum / lossesSum);
    const sharpe = trades.length > 1 ? (totalReturnPercent / (maxDd || 1.5)) * 0.45 + 0.8 : 1.0;

    return {
      asset,
      strategyType,
      params,
      trades,
      rawPrices,
      equityPath,
      metrics: {
        totalReturn: totalReturnPercent,
        maxDd: -maxDd,
        winRate,
        profitFactor,
        sharpe,
        totalTrades: trades.length
      }
    };
  };

  // Form submission handler
  strategyBuilderForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Toggle loading states
    backtestEmptyState.style.display = 'none';
    backtestResultsContent.style.display = 'none';
    backtestLoadingState.style.display = 'flex';
    btnDeployStrategy.disabled = true;

    // Simulate standard computation delay
    setTimeout(() => {
      const asset = document.getElementById('param-asset').value;
      const strategyType = paramStrategySelect.value;
      const params = {
        fastMa: parseInt(document.getElementById('param-fast-ma').value),
        slowMa: parseInt(document.getElementById('param-slow-ma').value),
        rsiLen: parseInt(document.getElementById('param-rsi-len').value),
        rsiOb: parseInt(document.getElementById('param-rsi-ob').value),
        rsiOs: parseInt(document.getElementById('param-rsi-os').value),
        stopLoss: parseFloat(document.getElementById('param-sl').value),
        takeProfit: parseFloat(document.getElementById('param-tp').value)
      };

      const result = runBacktestLogic(asset, strategyType, params);
      state.lastBacktest = result;

      // Render performance stats
      renderBacktestResults(result);

      backtestLoadingState.style.display = 'none';
      backtestResultsContent.style.display = 'block';
      btnDeployStrategy.disabled = false;
    }, 1200);
  });

  const renderBacktestResults = (result) => {
    const m = result.metrics;
    
    const returnEl = document.getElementById('res-total-return');
    returnEl.textContent = (m.totalReturn >= 0 ? '+' : '') + m.totalReturn.toFixed(2) + '%';
    returnEl.className = m.totalReturn >= 0 ? 'metric-value trend-up' : 'metric-value trend-down';

    const ddEl = document.getElementById('res-max-dd');
    ddEl.textContent = m.maxDd.toFixed(2) + '%';

    document.getElementById('res-winrate').textContent = m.winRate.toFixed(1) + '%';
    document.getElementById('res-profit-factor').textContent = m.profitFactor.toFixed(2);
    document.getElementById('res-sharpe').textContent = m.sharpe.toFixed(2);
    document.getElementById('res-total-trades').textContent = m.totalTrades;

    // Populate trade list table
    const tbody = document.getElementById('backtest-trades-table').querySelector('tbody');
    tbody.innerHTML = '';
    
    if (result.trades.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 1rem; color: var(--sf-muted);">No signals generated. Increase analysis bounds.</td></tr>`;
    } else {
      result.trades.slice().reverse().forEach(t => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(11, 18, 32, 0.05)';
        
        const returnClass = t.pnlPercent >= 0 ? 'trend-up' : 'trend-down';
        const formattedReturn = (t.pnlPercent >= 0 ? '+' : '') + t.pnlPercent.toFixed(2) + '%';

        tr.innerHTML = `
          <td style="padding: 0.5rem;">#${t.num}</td>
          <td style="padding: 0.5rem;"><span class="nb-badge nb-badge-green" style="font-size: 0.65rem;">${t.type}</span></td>
          <td style="padding: 0.5rem;">$${t.entryPrice.toFixed(2)}</td>
          <td style="padding: 0.5rem;">$${t.exitPrice.toFixed(2)}</td>
          <td style="padding: 0.5rem; font-weight: bold;" class="${returnClass}">${formattedReturn}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Plot Backtest Equity Curve
    renderBacktestChart(result.equityPath);
  };

  const renderBacktestChart = (equityPath) => {
    const ctx = document.getElementById('backtestEquityChart');
    if (!ctx) return;

    if (state.backtestChart) {
      state.backtestChart.destroy();
    }

    const labels = Array.from({length: equityPath.length}, (_, i) => `Trade ${i}`);

    state.backtestChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Equity Growth ($)',
          data: equityPath,
          borderColor: '#0B1220',
          borderWidth: 3,
          backgroundColor: 'rgba(0, 245, 160, 0.1)',
          fill: true,
          tension: 0.1,
          pointBackgroundColor: '#00F5A0',
          pointBorderColor: '#0B1220',
          pointBorderWidth: 2,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { maxTicksLimit: 10, color: '#6B7280', font: { family: 'Outfit', weight: 'bold' } }
          },
          y: {
            grid: { color: 'rgba(11, 18, 32, 0.05)' },
            ticks: { color: '#6B7280', font: { family: 'Outfit', weight: 'bold' } }
          }
        }
      }
    });
  };

  // 6. Bot Fleet UI Render and Canvas drawing loop
  const renderBotFleet = () => {
    botFleetGrid.innerHTML = '';

    state.bots.forEach(bot => {
      const card = document.createElement('div');
      card.className = 'bot-card';
      card.id = `bot-card-${bot.id}`;

      const statusBadgeClass = bot.status === 'ACTIVE' ? 'nb-badge-green' : '';
      const profitClass = bot.profit >= 0 ? 'trend-up' : 'trend-down';
      const profitSign = bot.profit >= 0 ? '+' : '';

      card.innerHTML = `
        <div class="bot-header">
          <div>
            <h3 class="bot-title">${bot.name}</h3>
            <div class="bot-meta">
              <span>${bot.asset}</span>
              <span>•</span>
              <span>${bot.strategy.replace('_', ' ')}</span>
            </div>
          </div>
          <div class="nb-badge ${statusBadgeClass}" id="bot-status-badge-${bot.id}">${bot.status}</div>
        </div>

        <div class="bot-canvas-wrap">
          <canvas class="bot-canvas" id="canvas-${bot.id}"></canvas>
        </div>

        <div class="bot-status-bar">
          <div class="bot-metrics">
            <div>
              <span style="color: var(--sf-muted); font-size: 0.7rem; display: block; font-family: var(--font-sans); font-weight: bold; text-transform: uppercase;">Profit</span>
              <span class="${profitClass}" style="font-weight: bold;" id="bot-profit-${bot.id}">
                ${profitSign}$${bot.profit.toFixed(2)} (${profitSign}${bot.profitPercent.toFixed(2)}%)
              </span>
            </div>
            <div>
              <span style="color: var(--sf-muted); font-size: 0.7rem; display: block; font-family: var(--font-sans); font-weight: bold; text-transform: uppercase;">Capital</span>
              <span style="font-weight: bold; color: var(--sf-dark);">$${bot.allocation.toLocaleString()}</span>
            </div>
          </div>
          <div style="display: flex; gap: 0.5rem;">
            <button class="nb-btn nb-btn-outline nb-btn-sm btn-bot-toggle" data-id="${bot.id}">
              ${bot.status === 'ACTIVE' ? 'Pause' : 'Resume'}
            </button>
            <button class="nb-btn nb-btn-danger nb-btn-sm btn-bot-delete" data-id="${bot.id}">
              Delete
            </button>
          </div>
        </div>
      `;

      botFleetGrid.appendChild(card);
      initBotCanvasChart(bot.id);
    });

    // Wire up individual card actions
    botFleetGrid.querySelectorAll('.btn-bot-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        toggleBotStatus(id);
      });
    });

    botFleetGrid.querySelectorAll('.btn-bot-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = btn.getAttribute('data-id');
        deleteBot(id);
      });
    });
  };

  const toggleBotStatus = (botId) => {
    const bot = state.bots.find(b => b.id === botId);
    if (bot) {
      bot.status = bot.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
      renderBotFleet();
      updateDashboardStats();
    }
  };

  const deleteBot = (botId) => {
    state.bots = state.bots.filter(b => b.id !== botId);
    renderBotFleet();
    updateDashboardStats();
  };

  // Beautiful real-time Mini canvas plotting loop
  const botCanvasContexts = {};

  const initBotCanvasChart = (botId) => {
    const canvas = document.getElementById(`canvas-${botId}`);
    if (!canvas) return;

    // Handle high DPI retina screens
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    botCanvasContexts[botId] = canvas.getContext('2d');
  };

  const drawBotCanvasCharts = () => {
    state.bots.forEach(bot => {
      const ctx = botCanvasContexts[bot.id];
      const canvas = document.getElementById(`canvas-${bot.id}`);
      if (!ctx || !canvas || bot.history.length < 2) return;

      const w = canvas.width;
      const h = canvas.height;

      // Clear
      ctx.fillStyle = '#0B1220';
      ctx.fillRect(0, 0, w, h);

      // Grid Lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 30) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // Min & Max math boundaries
      const min = Math.min(...bot.history);
      const max = Math.max(...bot.history);
      const range = max - min || 1;

      // Draw price curve
      ctx.strokeStyle = bot.profit >= 0 ? '#00F5A0' : '#FF5C5C';
      ctx.lineWidth = 2.5;
      ctx.beginPath();

      const pointsCount = bot.history.length;
      bot.history.forEach((val, i) => {
        const x = (i / (pointsCount - 1)) * (w - 20) + 10;
        const y = h - ((val - min) / range) * (h - 40) - 20;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();

      // Draw gradient under price curve
      ctx.fillStyle = bot.profit >= 0 ? 'rgba(0, 245, 160, 0.08)' : 'rgba(255, 92, 92, 0.08)';
      ctx.beginPath();
      bot.history.forEach((val, i) => {
        const x = (i / (pointsCount - 1)) * (w - 20) + 10;
        const y = h - ((val - min) / range) * (h - 40) - 20;
        if (i === 0) {
          ctx.moveTo(x, h);
          ctx.lineTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.lineTo((pointsCount - 1) / (pointsCount - 1) * (w - 20) + 10, h);
      ctx.closePath();
      ctx.fill();

      // Show live entry/exit markers from recent simulated trades
      bot.trades.slice(0, 5).forEach(trade => {
        // Match approximate trade price index visually
        const indexDistance = bot.history.findIndex(p => Math.abs(p - trade.price) < 0.01);
        if (indexDistance !== -1) {
          const x = (indexDistance / (pointsCount - 1)) * (w - 20) + 10;
          const y = h - ((trade.price - min) / range) * (h - 40) - 20;

          // Draw node
          ctx.fillStyle = trade.type === 'BUY' ? '#00F5A0' : '#FF5C5C';
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#0B1220';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
    });

    requestAnimationFrame(drawBotCanvasCharts);
  };

  // Trigger loop
  renderBotFleet();
  requestAnimationFrame(drawBotCanvasCharts);

  // 7. Modals triggers
  const btnCreateBotModal = document.getElementById('btn-create-bot-modal');
  const btnCloseDeployModal = document.getElementById('btn-close-deploy-modal');
  const modalDeployBotForm = document.getElementById('modal-deploy-bot-form');
  const navBtnDeployShortcut = document.getElementById('nav-btn-deploy-shortcut');

  const openDeployModal = () => {
    deployBotModal.classList.add('active');
  };
  const closeDeployModal = () => {
    deployBotModal.classList.remove('active');
  };

  if (btnCreateBotModal) btnCreateBotModal.addEventListener('click', openDeployModal);
  if (btnCloseDeployModal) btnCloseDeployModal.addEventListener('click', closeDeployModal);
  if (navBtnDeployShortcut) navBtnDeployShortcut.addEventListener('click', openDeployModal);

  // Deploys a bot from the Backtest builder dashboard directly
  btnDeployStrategy.addEventListener('click', () => {
    if (state.lastBacktest) {
      const b = state.lastBacktest;
      document.getElementById('modal-bot-name').value = `${b.asset} ${b.strategyType.replace('_', ' ')}`;
      document.getElementById('modal-bot-asset').value = b.asset;
      document.getElementById('modal-bot-strategy').value = b.strategyType;
      openDeployModal();
    }
  });

  modalDeployBotForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('modal-bot-name').value;
    const asset = document.getElementById('modal-bot-asset').value;
    const strategy = document.getElementById('modal-bot-strategy').value;
    const allocation = parseFloat(document.getElementById('modal-bot-allocation').value);

    // Initial mock values
    const startingPrices = Array.from({length: 40}, () => state.priceTickers[asset].price * (1 + (Math.random() - 0.5) * 0.02));

    const newBot = {
      id: 'bot-' + Date.now(),
      name,
      asset,
      strategy,
      allocation,
      profit: 0,
      profitPercent: 0,
      status: 'ACTIVE',
      history: startingPrices,
      trades: []
    };

    state.bots.push(newBot);
    
    // Refresh fleet dashboard
    renderBotFleet();
    updateDashboardStats();
    closeDeployModal();

    // Reset form fields
    modalDeployBotForm.reset();

    // Redirect user to Bot Commander tab
    switchTab('fleet-view');
  });

  // 8. API Connections simulator
  const apiCredentialsForm = document.getElementById('api-credentials-form');
  const exchangeLinkSuccess = document.getElementById('exchange-link-success');

  apiCredentialsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const btn = apiCredentialsForm.querySelector('button');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = `<div style="width: 1.25rem; height: 1.25rem; border: 2px solid #FFF; border-top-color: var(--sf-orange); border-radius: 50%; animation: spin 1s infinite linear; display: inline-block; margin-right: 0.5rem; vertical-align: sub;"></div> Linking Account...`;

    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
      exchangeLinkSuccess.style.display = 'block';
      setTimeout(() => {
        exchangeLinkSuccess.style.display = 'none';
      }, 5000);
      apiCredentialsForm.reset();
    }, 1500);
  });

  // Webhook JSON copies
  const btnCopyWebhookUrl = document.getElementById('btn-copy-webhook-url');
  const webhookUrlDisplay = document.getElementById('webhook-url-display');
  const btnCopyPayload = document.getElementById('btn-copy-payload');
  const payloadCodeDisplay = document.getElementById('payload-code-display');

  const copyToClipboard = (elementVal, buttonEl) => {
    navigator.clipboard.writeText(elementVal).then(() => {
      const originalText = buttonEl.textContent;
      buttonEl.textContent = 'Copied! ✓';
      buttonEl.style.backgroundColor = '#00F5A0';
      setTimeout(() => {
        buttonEl.textContent = originalText;
        buttonEl.style.backgroundColor = '';
      }, 2000);
    });
  };

  btnCopyWebhookUrl.addEventListener('click', () => {
    copyToClipboard(webhookUrlDisplay.value, btnCopyWebhookUrl);
  });

  btnCopyPayload.addEventListener('click', () => {
    copyToClipboard(payloadCodeDisplay.textContent, btnCopyPayload);
  });

  // Webhook code tabs switcher
  const payloadTabs = {
    'buy': {
      action: "buy",
      symbol: "BTCUSDT",
      volume: 0.05,
      leverage: 10,
      secret: "sf-683a-k28"
    },
    'sell': {
      action: "sell",
      symbol: "BTCUSDT",
      volume: 0.05,
      leverage: 10,
      secret: "sf-683a-k28"
    },
    'exit': {
      action: "exit",
      symbol: "BTCUSDT",
      secret: "sf-683a-k28"
    }
  };

  const updateWebhookPayloadCode = (tabName) => {
    state.webhookActivePayloadTab = tabName;
    payloadCodeDisplay.textContent = JSON.stringify(payloadTabs[tabName], null, 2);
  };

  const tabBuyBtn = document.getElementById('payload-tab-buy');
  const tabSellBtn = document.getElementById('payload-tab-sell');
  const tabExitBtn = document.getElementById('payload-tab-exit');

  const setupPayloadTab = (button, tabName) => {
    button.addEventListener('click', () => {
      [tabBuyBtn, tabSellBtn, tabExitBtn].forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      updateWebhookPayloadCode(tabName);
    });
  };

  setupPayloadTab(tabBuyBtn, 'buy');
  setupPayloadTab(tabSellBtn, 'sell');
  setupPayloadTab(tabExitBtn, 'exit');

  // 9. Pricing license card details
  const updatePricingCards = (billing) => {
    state.pricingBillingCycle = billing;
    const apprenticeVal = document.getElementById('price-val-apprentice');
    const vipVal = document.getElementById('price-val-vip');
    const quantVal = document.getElementById('price-val-quant');

    if (billing === 'monthly') {
      pricingMonthlyBtn.classList.add('active');
      pricingAnnualBtn.classList.remove('active');
      apprenticeVal.textContent = '49';
      vipVal.textContent = '99';
      quantVal.textContent = '299';
    } else {
      pricingMonthlyBtn.classList.remove('active');
      pricingAnnualBtn.classList.add('active');
      apprenticeVal.textContent = '39';
      vipVal.textContent = '79';
      quantVal.textContent = '249';
    }
  };

  pricingMonthlyBtn.addEventListener('click', () => updatePricingCards('monthly'));
  pricingAnnualBtn.addEventListener('click', () => updatePricingCards('annual'));
});
