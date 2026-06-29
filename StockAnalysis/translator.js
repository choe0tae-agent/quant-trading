/**
 * translator.js
 * Natural Language Trading Condition to Pandas Query Translator.
 * Runs on Port 5860 and provides a translation endpoint.
 */

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 5860;

app.use(cors());
app.use(express.json());

app.post('/api/translate', (req, res) => {
  const { query } = req.body;
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query is empty' });
  }

  console.log(`[Translator] Translating query: "${query}"`);
  
  let translated = query.trim();

  // Mapping rules (priority ordering is important)
  const rules = [
    // Complex strategy markers
    { pattern: /정배열\s*구간|정배열/g, replacement: "(df['MA5'] > df['MA20']) & (df['MA20'] > df['MA120'])" },
    { pattern: /전고점\s*돌파/g, replacement: "df['Close'] > df['Prev_High']" },
    { pattern: /거래량\s*급증|거래량\s*2배/g, replacement: "df['Volume'] > df['Vol_MA20'] * 2.0" },
    
    // Direction / Actions
    { pattern: /골든\s*크로스|상향\s*돌파|돌파/g, replacement: ">" },
    { pattern: /데드\s*크로스|하향\s*돌파/g, replacement: "<" },

    // Moving Averages
    { pattern: /5일\s*(이동평균선|선|평균)/g, replacement: "df['MA5']" },
    { pattern: /20일\s*(이동평균선|선|평균)/g, replacement: "df['MA20']" },
    { pattern: /120일\s*(이동평균선|선|평균)/g, replacement: "df['MA120']" },
    
    // Core Columns
    { pattern: /종가|현재가/g, replacement: "df['Close']" },
    { pattern: /시가/g, replacement: "df['Open']" },
    { pattern: /고가/g, replacement: "df['High']" },
    { pattern: /저가/g, replacement: "df['Low']" },
    { pattern: /거래량/g, replacement: "df['Volume']" },
    
    // Logic Operators
    { pattern: /\s*이면서\s*|\s*그리고\s*|\s+and\s+/gi, replacement: " & " },
    { pattern: /\s*또는\s*|\s+or\s+/gi, replacement: " | " },
    
    // Clean up particles
    { pattern: /\b이\b|\b가\b|\b을\b|\b를\b|\b은\b|\b는\b/g, replacement: "" }
  ];

  // Apply substitutions
  rules.forEach(rule => {
    translated = translated.replace(rule.pattern, rule.replacement);
  });

  // Clean double spaces
  translated = translated.replace(/\s+/g, ' ').trim();

  // Simple check to flag translations that did not change
  let success = true;
  if (translated === query.trim()) {
    translated = "# 해석할 수 없는 조건식입니다. (예: 5일선이 20일선 골든크로스)";
    success = false;
  }

  console.log(`[Translator] Output: "${translated}"`);

  res.json({
    success,
    original: query,
    translated
  });
});

app.listen(PORT, () => {
  console.log(`[Translator] Local NLP translator server running on http://localhost:${PORT}`);
});
