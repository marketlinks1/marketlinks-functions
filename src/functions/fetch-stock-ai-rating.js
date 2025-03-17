const fetch = require('node-fetch');
const admin = require('firebase-admin');
const NodeCache = require('node-memory-cache');

// Initialize in-memory cache with TTL
const memoryCache = new NodeCache({ stdTTL: 3600 }); // 1 hour cache

// Initialize Firebase only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL,
    }),
  });
}

const db = admin.firestore();

// Define allowed origins
const allowedOrigins = [
  'https://www.themarketlinks.com'
];

// Pre-computed technical indicators
const technicalIndicators = {
  calculateRSI: (prices, period = 14) => {
    if (prices.length < period + 1) return null;
    
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i <= period; i++) {
      const change = prices[i] - prices[i-1];
      if (change >= 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }
    
    let avgGain = gains / period;
    let avgLoss = losses / period;
    
    // First RSI
    let rs = avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));
    let result = [rsi];
    
    // Calculate rest of RSI values
    for (let i = period + 1; i < prices.length; i++) {
      const change = prices[i] - prices[i-1];
      let currentGain = 0;
      let currentLoss = 0;
      
      if (change >= 0) {
        currentGain = change;
      } else {
        currentLoss = -change;
      }
      
      avgGain = ((avgGain * (period - 1)) + currentGain) / period;
      avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;
      
      rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
      result.push(rsi);
    }
    
    return result[result.length - 1];
  },
  
  calculateMA: (prices, period = 20) => {
    if (prices.length < period) return null;
    return prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
  }
};

exports.handler = async (event) => {
  const origin = event.headers.origin;
  const corsHeader = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  // Handle preflight CORS requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': corsHeader,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Cache-Control': 'public, max-age=300' // 5 minute cache for OPTIONS
      },
      body: '',
    };
  }

  const { symbol } = event.queryStringParameters || {};
  if (!symbol) {
    return createResponse(400, corsHeader, { error: 'Symbol is required.' });
  }

  const upperSymbol = symbol.toUpperCase();
  const cacheKey = `prediction_${upperSymbol}`;
  
  try {
    // Check memory cache first (fastest)
    const cachedResult = memoryCache.get(cacheKey);
    if (cachedResult) {
      return createResponse(200, corsHeader, cachedResult, true);
    }
    
    // Check Firestore next (medium speed)
    const docRef = db.collection('aiPredictions').doc(upperSymbol);
    const docSnap = await docRef.get();
    const now = admin.firestore.Timestamp.now();

    if (docSnap.exists) {
      const { lastFetched, recommendation, fetchedData } = docSnap.data();
      const hoursElapsed = (now.toDate() - lastFetched.toDate()) / (1000 * 60 * 60);
      
      if (hoursElapsed < 24) {
        // Store in memory cache to speed up future requests
        const result = { recommendation, fetchedData };
        memoryCache.set(cacheKey, result);
        return createResponse(200, corsHeader, result, true);
      }
    }

    // Fetch only essential data with limited fields
    const fetchedData = await fetchOptimizedData(upperSymbol);
    if (!fetchedData) {
      throw new Error('Failed to fetch stock data.');
    }

    // Add locally calculated technical indicators
    fetchedData.technicalAnalysis = calculateTechnicals(fetchedData.priceHistory);
    
    // Generate AI prompt with only the necessary data
    const aiPrediction = await getAIPrediction(fetchedData, upperSymbol);

    // Save prediction to Firestore
    const resultToStore = {
      symbol: upperSymbol,
      recommendation: aiPrediction,
      fetchedData,
      lastFetched: now,
    };
    
    await docRef.set(resultToStore);
    
    // Cache the result in memory
    const resultToReturn = { recommendation: aiPrediction, fetchedData };
    memoryCache.set(cacheKey, resultToReturn);

    return createResponse(200, corsHeader, resultToReturn);
  } catch (error) {
    console.error('Error:', error.message);
    return createResponse(500, corsHeader, { error: error.message });
  }
};

// Create JSON response with CORS headers and cache control
function createResponse(statusCode, corsHeader, body, fromCache = false) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': corsHeader,
      'Content-Type': 'application/json',
      'Cache-Control': fromCache ? 'public, max-age=3600' : 'no-cache'
    },
    body: JSON.stringify(body),
  };
}

// Fetch only the essential data needed for analysis
async function fetchOptimizedData(symbol) {
  const apiKey = process.env.FMP_API_KEY;
  const cacheKey = `data_${symbol}`;
  
  // Check memory cache first
  const cachedData = memoryCache.get(cacheKey);
  if (cachedData) return cachedData;

  try {
    // Batch requests to reduce network overhead
    const batchEndpoint = `https://financialmodelingprep.com/api/v4/batch?apikey=${apiKey}`;
    
    const requestBody = {
      symbols: [symbol],
      endpoints: [
        "income-statement-limited", 
        "balance-sheet-statement-limited",
        "historical-price-full/1year"
      ]
    };
    
    const response = await fetch(batchEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      throw new Error(`FMP API Error: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Extract and process relevant data only
    const result = {
      fundamentals: extractEssentialFinancials(data[`${symbol}_income-statement-limited`]?.[0]),
      balanceSheet: extractEssentialBalanceSheet(data[`${symbol}_balance-sheet-statement-limited`]?.[0]),
      priceHistory: extractPriceHistory(data[`${symbol}_historical-price-full/1year`])
    };
    
    // Cache the result
    memoryCache.set(cacheKey, result, 1800); // 30 minute cache
    
    return result;
  } catch (error) {
    console.error('Error fetching batch data:', error.message);
    return null;
  }
}

// Extract only essential financial metrics
function extractEssentialFinancials(incomeStatement) {
  if (!incomeStatement) return null;
  
  return {
    date: incomeStatement.date,
    revenue: incomeStatement.revenue,
    netIncome: incomeStatement.netIncome,
    eps: incomeStatement.eps,
    ebitda: incomeStatement.ebitda,
    grossProfitRatio: incomeStatement.grossProfitRatio,
    operatingIncomeRatio: incomeStatement.operatingIncomeRatio,
    netIncomeRatio: incomeStatement.netIncomeRatio
  };
}

// Extract only essential balance sheet metrics
function extractEssentialBalanceSheet(balanceSheet) {
  if (!balanceSheet) return null;
  
  return {
    date: balanceSheet.date,
    cashAndCashEquivalents: balanceSheet.cashAndCashEquivalents,
    totalAssets: balanceSheet.totalAssets,
    totalLiabilities: balanceSheet.totalLiabilities,
    totalDebt: balanceSheet.totalDebt,
    debtToAssets: balanceSheet.totalDebt / balanceSheet.totalAssets,
    currentRatio: balanceSheet.totalCurrentAssets / balanceSheet.totalCurrentLiabilities
  };
}

// Extract price history
function extractPriceHistory(priceData) {
  if (!priceData || !priceData.historical) return [];
  
  return priceData.historical.map(day => ({
    date: day.date,
    close: day.close,
    volume: day.volume
  }));
}

// Calculate technical indicators locally instead of fetching them
function calculateTechnicals(priceHistory) {
  if (!priceHistory || priceHistory.length < 14) return null;
  
  const closePrices = priceHistory.map(day => day.close);
  
  return {
    rsi: technicalIndicators.calculateRSI(closePrices),
    sma20: technicalIndicators.calculateMA(closePrices, 20),
    sma50: technicalIndicators.calculateMA(closePrices, 50),
    priceChange1m: calculatePercentChange(closePrices, 20),
    priceChange3m: calculatePercentChange(closePrices, 60),
    volumeChange: calculateVolumeChange(priceHistory)
  };
}

// Calculate percentage price change
function calculatePercentChange(prices, days) {
  if (prices.length < days) return null;
  const recent = prices[prices.length - 1];
  const past = prices[prices.length - 1 - days];
  return ((recent - past) / past) * 100;
}

// Calculate volume change
function calculateVolumeChange(priceHistory) {
  if (priceHistory.length < 20) return null;
  
  const recentVolume = priceHistory.slice(-10).reduce((sum, day) => sum + day.volume, 0) / 10;
  const pastVolume = priceHistory.slice(-20, -10).reduce((sum, day) => sum + day.volume, 0) / 10;
  
  return ((recentVolume - pastVolume) / pastVolume) * 100;
}

// Use a streamlined approach for AI prediction with essential data only
async function getAIPrediction(data, symbol) {
  // Prepare a compact prompt with only essential data
  const compactPrompt = createCompactPrompt(data, symbol);
  
  try {
    // Check if we can reuse a cached model response
    const cacheKey = `ai_${symbol}_${getDataFingerprint(data)}`;
    const cachedPrediction = memoryCache.get(cacheKey);
    if (cachedPrediction) return cachedPrediction;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: compactPrompt }],
        max_tokens: 500,
        temperature: 0.4,
        response_format: { type: "json_object" } // Request direct JSON response
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API Error: ${response.statusText}`);
    }

    const result = await response.json();
    const prediction = JSON.parse(result.choices[0].message.content);
    
    // Cache the AI prediction
    memoryCache.set(cacheKey, prediction, 43200); // 12 hour cache
    
    return prediction;
  } catch (err) {
    console.error('Error getting AI prediction:', err);
    
    // Fallback to a basic recommendation based on technical indicators
    return generateFallbackRecommendation(data);
  }
}

// Create a compact prompt for the AI with only essential data
function createCompactPrompt(data, symbol) {
  const { fundamentals, balanceSheet, technicalAnalysis } = data;
  
  return `
You are an AI financial analyst. Based on the following data for ${symbol}, provide a recommendation: BUY, SELL, or HOLD.

Key Fundamentals:
- Revenue: ${fundamentals?.revenue}
- Net Income: ${fundamentals?.netIncome}
- EPS: ${fundamentals?.eps}
- Net Income Ratio: ${fundamentals?.netIncomeRatio}

Balance Sheet:
- Total Assets: ${balanceSheet?.totalAssets}
- Total Liabilities: ${balanceSheet?.totalLiabilities}
- Debt to Assets: ${balanceSheet?.debtToAssets}
- Current Ratio: ${balanceSheet?.currentRatio}

Technical Indicators:
- RSI (14-day): ${technicalAnalysis?.rsi}
- SMA20: ${technicalAnalysis?.sma20}
- SMA50: ${technicalAnalysis?.sma50}
- 1-Month Price Change: ${technicalAnalysis?.priceChange1m}%
- 3-Month Price Change: ${technicalAnalysis?.priceChange3m}%
- Volume Change: ${technicalAnalysis?.volumeChange}%

Respond with only a JSON object containing:
{
  "recommendation": "BUY/SELL/HOLD",
  "reason": "Brief explanation of your recommendation (1-2 sentences)",
  "confidence": 0-100
}
  `;
}

// Generate a fingerprint of the data for caching purposes
function getDataFingerprint(data) {
  const { fundamentals, technicalAnalysis } = data;
  return `${fundamentals?.date}_${technicalAnalysis?.rsi?.toFixed(1)}_${technicalAnalysis?.priceChange1m?.toFixed(1)}`;
}

// Generate fallback recommendation if AI fails
function generateFallbackRecommendation(data) {
  const { technicalAnalysis } = data;
  
  if (!technicalAnalysis) {
    return {
      recommendation: "HOLD",
      reason: "Insufficient data to make a confident recommendation.",
      confidence: 30
    };
  }
  
  const { rsi, priceChange1m, priceChange3m } = technicalAnalysis;
  
  // Basic algorithm for fallback recommendation
  if (rsi < 30 && priceChange1m < -5 && priceChange3m < 0) {
    return {
      recommendation: "BUY",
      reason: "Stock appears oversold with low RSI and recent price decline.",
      confidence: 60
    };
  } else if (rsi > 70 && priceChange1m > 10) {
    return {
      recommendation: "SELL",
      reason: "Stock appears overbought with high RSI and recent sharp price increase.",
      confidence: 60
    };
  } else {
    return {
      recommendation: "HOLD",
      reason: "Technical indicators show neutral signals.",
      confidence: 50
    };
  }
}
