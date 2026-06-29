document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabButtons = document.querySelectorAll('.nav-tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const newsListContainer = document.getElementById('news-list');
  const newsDateTitle = document.getElementById('news-date-title');
  const newsUpdateTime = document.getElementById('news-update-time');
  const refreshButton = document.getElementById('btn-refresh-news');
  const warningBar = document.getElementById('api-warning-bar');
  
  // Settings Modal
  const btnSettings = document.getElementById('btn-settings');
  const modalSettings = document.getElementById('settings-modal');
  const btnCloseSettings = document.getElementById('btn-close-settings');
  const btnSaveKey = document.getElementById('btn-save-key');
  const inputApiKey = document.getElementById('input-api-key');
  
  // Analysis Tab Elements
  const selectedNewsCard = document.getElementById('selected-news-card');
  const analysisLoading = document.getElementById('analysis-loading');
  const analysisPlaceholder = document.getElementById('analysis-placeholder');
  const analysisReport = document.getElementById('analysis-report');
  const tabBtnAnalysis = document.getElementById('tab-btn-analysis');

  // Application State
  let activeTab = 'tab-news';
  let cachedNewsData = null;

  // 1. API Key 관리
  function getStoredKey() {
    return localStorage.getItem('quantai_gemini_key') || '';
  }

  function storeKey(key) {
    if (key) {
      localStorage.setItem('quantai_gemini_key', key.trim());
    } else {
      localStorage.removeItem('quantai_gemini_key');
    }
  }

  // API 키 유무에 따른 경고 바 토글
  async function checkApiStatus() {
    const key = getStoredKey();
    if (key) {
      warningBar.classList.add('hidden');
      inputApiKey.value = key;
      return;
    }

    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      if (data && data.hasApiKey) {
        warningBar.classList.add('hidden');
      } else {
        warningBar.classList.remove('hidden');
      }
    } catch (error) {
      console.warn('서버 API 키 상태 조회 실패:', error);
      warningBar.classList.remove('hidden');
    }
  }

  // 2. 탭 전환 처리
  function switchTab(tabId) {
    activeTab = tabId;
    tabButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabContents.forEach(content => {
      if (content.id === tabId) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.getAttribute('data-tab'));
    });
  });

  // Modal Event Listeners
  btnSettings.addEventListener('click', () => {
    inputApiKey.value = getStoredKey();
    modalSettings.classList.remove('hidden');
  });

  btnCloseSettings.addEventListener('click', () => {
    modalSettings.classList.add('hidden');
  });

  modalSettings.addEventListener('click', (e) => {
    if (e.target === modalSettings) {
      modalSettings.classList.add('hidden');
    }
  });

  btnSaveKey.addEventListener('click', () => {
    const key = inputApiKey.value.trim();
    storeKey(key);
    modalSettings.classList.add('hidden');
    checkApiStatus();
    // 새 키 설정 후 뉴스 자동 새로고침
    fetchNewsList(true);
  });

  // 3. 뉴스 리스트 가져오기
  async function fetchNewsList(refresh = false) {
    // 로딩 상태 표시
    newsListContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Google Search Grounding을 통해<br>지난 24시간 이내의 핵심 경제 뉴스를 엄선하여 요약 중입니다...</p>
        <span class="loading-sub">실시간 검색 및 필터링을 거치므로 최대 20초 정도 소요될 수 있습니다.</span>
      </div>
    `;
    
    try {
      const headers = {};
      const storedKey = getStoredKey();
      if (storedKey) {
        headers['x-gemini-key'] = storedKey;
      }

      const response = await fetch(`/api/news${refresh ? '?refresh=true' : ''}`, { headers });
      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'API_KEY_MISSING') {
          warningBar.classList.remove('hidden');
          showErrorMessage('API Key 설정이 필요합니다. 우측 상단 ⚙️ 설정에서 Gemini API 키를 저장해 주세요.');
          return;
        }
        throw new Error(data.message || '뉴스 데이터를 가져오는 데 실패했습니다.');
      }

      cachedNewsData = data;
      renderNewsList(data);
      checkApiStatus();
    } catch (error) {
      console.error(error);
      showErrorMessage(error.message || '서버 통신 오류가 발생했습니다.');
    }
  }

  // 뉴스 렌더링
  function renderNewsList(data) {
    if (!data.items || data.items.length === 0) {
      newsListContainer.innerHTML = `
        <div class="empty-state">
          <p>오늘 선별된 뉴스가 없습니다. 잠시 후 새로고침해 주세요.</p>
        </div>
      `;
      newsUpdateTime.innerText = `업데이트 실패`;
      return;
    }

    // 날짜 및 시간 헤더 업데이트
    newsDateTitle.innerText = data.header || '🌅 오늘의 핵심 뉴스';
    newsUpdateTime.innerText = `마지막 동기화: ${data.generatedAt || '방금 전'}`;

    let html = '';
    data.items.forEach(item => {
      html += `
        <div class="news-card glass">
          <div class="news-card-header">
            <div class="news-title-row">
              <span class="news-num">[${item.index}]</span>
              <h3 class="news-title">${item.title}</h3>
            </div>
            <span class="badge badge-sent-${item.sentiment}">${item.sentiment}</span>
          </div>
          <p class="news-time">📅 발행시각: ${item.publishedAt}</p>
          <div class="news-summary">${item.summary}</div>
          
          <div class="news-analyses">
            <div class="analysis-box">
              <span class="analysis-label">감성 요약</span>
              <p class="analysis-content">${item.sentimentReason}</p>
            </div>
            <div class="analysis-box">
              <span class="analysis-label">리스크 요인</span>
              <p class="analysis-content">${item.riskReason ? `${item.risk}: ${item.riskReason}` : item.risk}</p>
            </div>
          </div>

          <div class="news-card-footer">
            <a href="${item.url}" target="_blank" class="news-link">📰 원문 기사 보기 &rarr;</a>
            <button class="btn btn-primary btn-sm btn-analyze" data-index="${item.index}">
              ⚡ 심층 분석하기
            </button>
          </div>
        </div>
      `;
    });

    newsListContainer.innerHTML = html;

    // "심층 분석하기" 버튼 바인딩
    document.querySelectorAll('.btn-analyze').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.getAttribute('data-index'), 10);
        const item = data.items.find(x => x.index === index);
        if (item) {
          triggerDeepAnalysis(item);
        }
      });
    });
  }

  // 오류 렌더링
  function showErrorMessage(message) {
    newsListContainer.innerHTML = `
      <div class="warning-bar" style="margin: 0; background: rgba(255, 23, 68, 0.1); border-color: rgba(255, 23, 68, 0.2)">
        <span>❌ ${message}</span>
      </div>
    `;
    newsUpdateTime.innerText = '오류 발생';
  }

  // 4. 심층 분석 요청
  async function triggerDeepAnalysis(item) {
    // 1. 심층 분석 탭으로 즉시 전환
    switchTab('tab-analysis');
    tabBtnAnalysis.scrollIntoView({ behavior: 'smooth' });

    // 2. 왼쪽 사이드바에 선택한 뉴스 축소 렌더링
    selectedNewsCard.innerHTML = `
      <div class="news-card-header" style="margin-bottom: 8px;">
        <h4 style="font-size: 0.95rem; font-weight: 700; line-height: 1.3;">${item.title}</h4>
      </div>
      <p style="font-size: 0.75rem; color: var(--text-subtle); margin-bottom: 8px;">${item.publishedAt}</p>
      <span class="badge badge-sent-${item.sentiment}" style="margin-bottom: 12px; display: inline-block;">${item.sentiment}</span>
      <div style="font-size: 0.8rem; color: var(--text-muted); background: rgba(0,0,0,0.2); padding: 8px; border-radius: 6px; line-height: 1.4;">
        ${item.summary}
      </div>
      <a href="${item.url}" target="_blank" class="news-link" style="display: block; margin-top: 10px; font-size: 0.8rem;">원문 링크 열기 &rarr;</a>
    `;

    // 3. 우측 분석 리포트 화면 로딩 상태 전환
    analysisPlaceholder.classList.add('hidden');
    analysisReport.classList.add('hidden');
    analysisLoading.classList.remove('hidden');

    try {
      const headers = { 'Content-Type': 'application/json' };
      const storedKey = getStoredKey();
      if (storedKey) {
        headers['x-gemini-key'] = storedKey;
      }

      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: item.url,
          block: item.rawBlock
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || '심층 분석을 가져오는 도중 오류가 발생했습니다.');
      }

      // 4. 분석 결과 마크다운 렌더링
      analysisLoading.classList.add('hidden');
      analysisReport.classList.remove('hidden');
      
      // marked.js를 활용하여 안전하게 마크다운 파싱 및 표출
      analysisReport.innerHTML = marked.parse(data.analysisMarkdown);
    } catch (error) {
      console.error(error);
      analysisLoading.classList.add('hidden');
      analysisReport.classList.remove('hidden');
      analysisReport.innerHTML = `
        <div class="warning-bar" style="margin: 0; background: rgba(255, 23, 68, 0.1); border-color: rgba(255, 23, 68, 0.2)">
          <span>❌ 심층 분석 보고서 로드 실패: ${error.message}</span>
        </div>
      `;
    }
  }

  // 새로고침 버튼 바인딩
  refreshButton.addEventListener('click', () => {
    fetchNewsList(true);
  });

  // 초기 로딩 실행
  checkApiStatus();
  fetchNewsList();
});
