import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// dotenv 로드
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1시간 캐싱 객체
let newsCache = {
  data: null,
  timestamp: null
};

// 헬퍼: 파일 읽기
function readPromptFile(filename) {
  const filePath = path.join(__dirname, filename);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`프로젝트 파일 읽기 실패 (${filename}):`, error);
    throw new Error(`프롬프트 파일(${filename})을 읽을 수 없습니다. 파일이 서버에 있는지 확인해 주세요.`);
  }
}

// 헬퍼: 기사 스크래퍼
async function scrapeArticleBody(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.8,en-US;q=0.5,en;q=0.3'
      },
      timeout: 8000
    });

    const $ = cheerio.load(response.data);
    
    // 불필요한 태그 제거
    $('script, style, iframe, ads, header, footer, nav, noscript, .ads, .advertisement').remove();
    
    // 한국 언론사들의 대표적인 본문 영역 선택자들
    const selectors = [
      'article', 
      '#articleBody', 
      '#articleBodyContents', 
      '.article_body', 
      '.news_post',
      '#newsct_article',
      '.article_txt',
      '#artText',
      '.content_view',
      '#news_body_area'
    ];

    let bodyText = '';
    for (const selector of selectors) {
      const el = $(selector);
      if (el.length > 0) {
        bodyText = el.text().trim();
        if (bodyText.length > 200) break;
      }
    }

    if (!bodyText || bodyText.length < 200) {
      // 선택자로 찾지 못한 경우 p 태그들을 모아서 합침
      const paragraphs = [];
      $('p').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt.length > 20) paragraphs.push(txt);
      });
      bodyText = paragraphs.join('\n');
    }

    // 공백 문자 정리
    bodyText = bodyText.replace(/\s+/g, ' ').trim();
    
    // 최대 4,000자로 제한 (컨텍스트 절약 및 핵심 요약 유도)
    return bodyText.substring(0, 4000);
  } catch (error) {
    console.warn(`기사 스크래핑 실패 (${url}):`, error.message);
    throw new Error('기사 원문을 가져올 수 없습니다. 권한 제한 또는 차단되었을 수 있습니다.');
  }
}

// 헬퍼: 뉴스 구조화 파서
function parseNewsText(text) {
  const items = [];
  const blocks = text.split(/\[\d+\]\s*📌제목:/g);
  const header = blocks[0].trim();
  
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const title = lines[0].replace(/📌제목:\s*/, '').trim();
    
    let publishedAt = '';
    let summary = '';
    let sentiment = '중립';
    let sentimentReason = '';
    let risk = '없음';
    let riskReason = '';
    let url = '';

    for (const line of lines) {
      if (line.startsWith('⊙ 발행시간:')) {
        publishedAt = line.replace('⊙ 발행시간:', '').trim();
      } else if (line.startsWith('⊙ 요약:')) {
        summary = line.replace('⊙ 요약:', '').trim();
      } else if (line.startsWith('⊙ 감성 분석:')) {
        const content = line.replace('⊙ 감성 분석:', '').trim();
        const parts = content.split('-');
        const rawSent = parts[0]?.trim() || '';
        if (rawSent.includes('호재')) sentiment = '호재';
        else if (rawSent.includes('악재')) sentiment = '악재';
        else sentiment = '중립';
        sentimentReason = parts.slice(1).join('-').trim();
      } else if (line.startsWith('⊙ 리스크 분석:')) {
        const content = line.replace('⊙ 리스크 분석:', '').trim();
        const parts = content.split('-');
        risk = parts[0]?.trim() || '없음';
        riskReason = parts.slice(1).join('-').trim();
      } else if (line.startsWith('⊙ 링크:')) {
        url = line.replace('⊙ 링크:', '').trim();
      }
    }

    // 원본 텍스트 블록 복원
    const rawBlock = `[${i}] 📌제목: ${title}\n` + 
      `⊙ 발행시간: ${publishedAt}\n` +
      `⊙ 요약: ${summary}\n` +
      `⊙ 감성 분석: ${sentiment} - ${sentimentReason}\n` +
      `⊙ 리스크 분석: ${risk} - ${riskReason}\n` +
      `⊙ 링크: ${url}`;

    items.push({
      index: i,
      title,
      publishedAt,
      summary,
      sentiment,
      sentimentReason,
      risk,
      riskReason,
      url,
      rawBlock
    });
  }

  return { header, items };
}

// 0. API 상태 확인 API (서버에 키가 설정되어 있는지 여부 반환)
app.get('/api/status', (req, res) => {
  res.json({
    hasApiKey: !!process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== ''
  });
});

// 1. 오늘의 경제 뉴스 API
app.get('/api/news', async (req, res) => {
  const apiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({
      error: 'API_KEY_MISSING',
      message: '서버의 .env 파일에 GEMINI_API_KEY가 설정되지 않았습니다. API 키를 추가해 주세요.'
    });
  }

  const bypassCache = req.query.refresh === 'true';
  const now = Date.now();

  // 캐싱된 데이터 반환 (1시간 이내 유효)
  if (!bypassCache && newsCache.data && newsCache.timestamp && (now - newsCache.timestamp < 3600000)) {
    console.log('캐싱된 뉴스 데이터를 반환합니다.');
    return res.json(newsCache.data);
  }

  try {
    const systemInstruction = readPromptFile('경제뉴스.md');
    const ai = new GoogleGenAI({ apiKey });
    
    const currentTimeKST = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const userPrompt = `오늘 날짜 기준 시각: ${currentTimeKST} (KST)\n\n위의 시스템 프롬프트 규칙에 따라 지난 24시간 이내의 핵심 경제뉴스 5건을 선별 및 정리해줘.`;

    console.log('Gemini API 호출 중 (Google Search Grounding 활성화)...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        tools: [{ googleSearch: {} }],
        temperature: 0.1, // 정밀한 정보 수집을 위해 보수적 설정
      }
    });

    const rawText = response.text;
    if (!rawText) {
      throw new Error('Gemini API로부터 응답을 받지 못했습니다.');
    }

    console.log('Gemini 뉴스 응답 수신 완료. 파싱 시작...');
    const parsedData = parseNewsText(rawText);

    // 응답 구성
    const responseData = {
      rawText,
      header: parsedData.header,
      items: parsedData.items,
      generatedAt: currentTimeKST
    };

    // 캐싱
    newsCache.data = responseData;
    newsCache.timestamp = now;

    res.json(responseData);
  } catch (error) {
    console.error('뉴스 생성 중 오류 발생:', error);
    res.status(500).json({
      error: 'NEWS_GENERATION_FAILED',
      message: error.message || '뉴스를 생성하는 도중 오류가 발생했습니다.'
    });
  }
});

// 2. 뉴스 심층 분석 API
app.post('/api/analyze', async (req, res) => {
  const apiKey = req.headers['x-gemini-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return res.status(400).json({
      error: 'API_KEY_MISSING',
      message: '서버의 .env 파일에 GEMINI_API_KEY가 설정되지 않았습니다. API 키를 추가해 주세요.'
    });
  }

  const { url, block } = req.body;
  if (!url || !block) {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: '기사 url과 요약 block이 제공되지 않았습니다.'
    });
  }

  try {
    console.log(`심층 분석 대상 URL: ${url}`);
    
    // 기사 본문 스크래핑 시도
    let articleBody = '';
    let scrapingSuccess = true;
    try {
      articleBody = await scrapeArticleBody(url);
      console.log(`원문 스크래핑 성공 (${articleBody.length}자 수집 완료)`);
    } catch (scrapingError) {
      console.warn('스크래핑 실패로 본문 대체 또는 빈 값 전달:', scrapingError.message);
      scrapingSuccess = false;
      articleBody = ''; // 비워두고 LLM이 요약 정보로 예외 처리 하도록 유도
    }

    const systemInstruction = readPromptFile('심층분석.md');
    const ai = new GoogleGenAI({ apiKey });

    const userPrompt = `
[분석 대상 뉴스 요약 정보]
${block}

[기사 본문 전문]
${scrapingSuccess ? articleBody : '기사 본문 접근 실패: URL fetch에 실패함'}

[작업 지시]
위 정보와 기사 원문을 분석하여 '심층분석.md' 규칙(4문단 구조, 친근한 ~거든요 구어체, 1500자 이내)에 부합하는 심층 보고서를 생성해줘.
만약 본문 접근에 실패했다고 나오면, 심층분석.md 내 예외 처리 규칙에 따라 사용자에게 즉시 실패 안내 멘트를 반환해줘.
`;

    console.log('Gemini 심층 분석 호출 중...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: userPrompt,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3, // 분석의 창의성과 통찰을 고려해 약간 유연하게 조정
      }
    });

    const analysisMarkdown = response.text;
    res.json({
      success: true,
      scrapingSuccess,
      analysisMarkdown
    });
  } catch (error) {
    console.error('심층 분석 실패:', error);
    res.status(500).json({
      error: 'DEEP_ANALYSIS_FAILED',
      message: error.message || '심층 분석 보고서 생성에 실패했습니다.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`QuantAI 뉴스 분석 서버가 구동되었습니다.`);
  console.log(`접속 URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});
