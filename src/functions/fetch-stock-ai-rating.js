const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// Create a simple file-based caching system instead of Firebase
const CACHE_DIR = path.join('/tmp', 'stock-cache');

// Ensure the cache directory exists
try {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
} catch (error) {
  console.error('Error creating cache directory:', error);
}

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

// In-memory cache for ultra-fast responses
const memoryCache = {
  data: {},
  get: function(key) {
    const item = this.data[key];
    if (!item) return null;
    
    // Check if cache is still valid
    if (Date.now() > item.expiry) {
      delete this.data[key];
      return null;
    }
    
    return item.value;
  },
  set: function(key, value, ttlSeconds = 3600) {
    this.data[key] = {
      value,
      expiry: Date.now() + (ttlSeconds * 1000)
    };
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
    
    // Check file cache next
    const cachedData = await readFromFileCache(upperSymbol);
    if (cachedData && isDataFresh(cachedData.lastFetched, 24)) { // 24 hour validity
      // Store in memory cache to speed up future requests
      memoryCache.set(cacheKey, cachedData.data);
      return createResponse(200, corsHeader, cachedData.data, true);
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

    // Save prediction to file cache
    const resultToStore = {
      lastFetched: Date.now(),
      data: { 
        recommendation: aiPrediction, 
        fetchedData 
      }
    };
    
    await writeToFileCache(upperSymbol, resultToStore);
    
    // Cache the result in memory
    const resultToReturn = { recommendation: aiPrediction, fetchedData };
    memoryCache.set(cacheKey, resultToReturn);

    return createResponse(200, corsHeader, resultToReturn);
  } catch (error) {
    console.error('Error:', error.message);
    return createResponse(500, corsHeader, { error: error.message });
  }
};

// File cache functions
async function readFromFileCache(symbol) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  
  try {
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading from cache:', error);
  }
  
  return null;
}

async function writeToFileCache(symbol, data) {
  const cacheFile = path.join(CACHE_DIR, `${symbol}.json`);
  
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(data), 'utf8');
  } catch (error) {
    console.error('Error writing to cache:', error);
  }
}

function isDataFresh(timestamp, hoursValid) {
  const now = Date.now();
  const hoursElapsed = (now - timestamp) / (1000 * 60 * 60);
  return hoursElapsed < hoursValid;
}

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
  // Only use cached data if it's very fresh (5 minutes)
  if (cachedData && Date.now() - cachedData._fetchTime < 5 * 60 * 1000) return cachedData;

  try {
    // Make separate requests including a dedicated request for the latest real-time price
    const endpoints = [
      `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=1&apikey=${apiKey}`,
      `https://financialmodelingprep.com/api/v3/balance-sheet-statement/${symbol}?limit=1&apikey=${apiKey}`,
      `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?from=${getDateXMonthsAgo(12)}&apikey=${apiKey}`,
      `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${apiKey}` // Get latest real-time quote
    ];
    
    const [incomeRes, balanceRes, priceHistoryRes, quoteRes] = await Promise.all(
      endpoints.map(url => fetch(url).then(res => res.json()))
    );
    
    // Extract current price from quote data
    const currentQuote = Array.isArray(quoteRes) && quoteRes.length > 0 ? quoteRes[0] : null;
    
    // Create a modified price history that includes the latest real-time price
    const priceHistory = extractPriceHistory(priceHistoryRes, currentQuote);
    
    // Extract and process relevant data only
    const result = {
      fundamentals: extractEssentialFinancials(incomeRes[0]),
      balanceSheet: extractEssentialBalanceSheet(balanceRes[0]),
      priceHistory: priceHistory,
      currentQuote: extractEssentialQuoteData(currentQuote),
      _fetchTime: Date.now() // Add timestamp to track when data was fetched
    };
    
    // Cache the result for a shorter time to ensure price freshness
    memoryCache.set(cacheKey, result, 300); // 5 minute cache for price data
    
    return result;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    return null;
  }
}

// Extract essential data from the quote endpoint
function extractEssentialQuoteData(quote) {
  if (!quote) return null;
  
  return {
    price: quote.price,
    change: quote.change,
    changesPercentage: quote.changesPercentage,
    dayLow: quote.dayLow,
    dayHigh: quote.dayHigh,
    yearHigh: quote.yearHigh,
    yearLow: quote.yearLow,
    marketCap: quote.marketCap,
    volume: quote.volume,
    avgVolume: quote.avgVolume
  };
}

// Get date X months ago in YYYY-MM-DD format
function getDateXMonthsAgo(months) {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date.toISOString().split('T')[0];
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

// Extract price history and ensure the most recent price is used
function extractPriceHistory(priceData, currentQuote = null) {
  if (!priceData || !priceData.historical) return [];
  
  // Create a copy of the historical data
  const historicalData = [...priceData.historical];
  
  // Sort historical data by date (newest first) to ensure correct ordering
  historicalData.sort((a, b) => new Date(b.date) - new Date(a.date));
  
  // Create the result array with mapped data
  const result = historicalData.map(day => ({
    date: day.date,
    close: day.close,
    volume: day.volume
  }));
  
  // If we have current quote data, check if we need to update the most recent price
  if (currentQuote && currentQuote.price) {
    const today = new Date().toISOString().split('T')[0];
    const mostRecentDate = result.length > 0 ? result[0].date : null;
    
    // If most recent historical data is not from today, add the current quote as a new entry
    if (mostRecentDate !== today) {
      result.unshift({
        date: today,
        close: currentQuote.price,
        volume: currentQuote.volume || (result.length > 0 ? result[0].volume : 0)
      });
    } 
    // If it is from today but the price is different, update it
    else if (Math.abs(result[0].close - currentQuote.price) > 0.01) {
      result[0].close = currentQuote.price;
      if (currentQuote.volume) result[0].volume = currentQuote.volume;
    }
  }
  
  // Add 52-week high and low data
  const closePrices = result.map(day => day.close);
  
  // Use quote data for 52-week high/low if available, otherwise calculate from historical data
  const high52Week = currentQuote?.yearHigh || Math.max(...closePrices);
  const low52Week = currentQuote?.yearLow || Math.min(...closePrices);
  
  // Add 52-week high and low as properties
  result.high52Week = high52Week;
  result.low52Week = low52Week;
  
  return result;
}

// Calculate technical indicators locally instead of fetching them
function calculateTechnicals(priceHistory) {
  if (!priceHistory || priceHistory.length < 14) return null;
  
  // Ensure we're working with the most recent price data (at index 0 after sorting)
  const closePrices = priceHistory.map(day => day.close);
  const currentPrice = closePrices[0]; // first element is most recent after sorting
  const high52Week = priceHistory.high52Week || Math.max(...closePrices);
  const low52Week = priceHistory.low52Week || Math.min(...closePrices);
  
  // Calculate distance from 52-week high and low as percentage
  const distanceFromHigh = ((high52Week - currentPrice) / high52Week) * 100;
  const distanceFromLow = ((currentPrice - low52Week) / low52Week) * 100;
  
  // Get the timestamp for the current price
  const lastUpdated = new Date().toISOString();
  
  return {
    rsi: technicalIndicators.calculateRSI(closePrices.slice().reverse()), // Reverse back to chronological for RSI
    sma20: technicalIndicators.calculateMA(closePrices, 20),
    sma50: technicalIndicators.calculateMA(closePrices, 50),
    sma200: technicalIndicators.calculateMA(closePrices, Math.min(200, closePrices.length)),
    priceChange1d: calculatePercentChange(closePrices, 1),
    priceChange1m: calculatePercentChange(closePrices, Math.min(20, closePrices.length - 1)),
    priceChange3m: calculatePercentChange(closePrices, Math.min(60, closePrices.length - 1)),
    volumeChange: calculateVolumeChange(priceHistory),
    high52Week,
    low52Week,
    distanceFromHigh,
    distanceFromLow,
    currentPrice,
    lastUpdated
  };
}

// Calculate percentage price change - adjusted for reversed array (newest first)
function calculatePercentChange(prices, days) {
  if (prices.length < days + 1) return null;
  const recent = prices[0]; // newest is at index 0
  const past = prices[days]; // go back "days" elements
  return ((recent - past) / past) * 100;
}

// Calculate percentage price change
function calculatePercentChange(prices, days) {
  if (prices.length < days) return null;
  const recent = prices[prices.length - 1];
  const past = prices[prices.length - 1 - days];
  return ((recent - past) / past) * 100;
}

// Calculate volume change (adjusted for array order - newest first)
function calculateVolumeChange(priceHistory) {
  if (priceHistory.length < 20) return null;
  
  // After our sorting, most recent data is at the beginning of the array
  const recentVolume = priceHistory.slice(0, 10).reduce((sum, day) => sum + day.volume, 0) / 10;
  const pastVolume = priceHistory.slice(10, 20).reduce((sum, day) => sum + day.volume, 0) / 10;
  
  return ((recentVolume - pastVolume) / pastVolume) * 100;
}

// Use a streamlined approach for AI prediction with essential data only
async function getAIPrediction(data, symbol) {
  // Get the current price from technical analysis data
  const currentPrice = data.technicalAnalysis?.currentPrice || 0;
  
  // Prepare a compact prompt with only essential data
  const compactPrompt = createCompactPrompt(data, symbol);
  
  try {
    // Creating a more unique fingerprint based on current price and time
    // This ensures we get fresh predictions when prices change significantly
    const dataFingerprint = getDataFingerprint(data);
    const priceFingerprint = `${currentPrice.toFixed(2)}`;
    const cacheKey = `ai_${symbol}_${dataFingerprint}_${priceFingerprint}`;
    
    // Check if we can reuse a cached model response
    const cachedPrediction = memoryCache.get(cacheKey);
    if (cachedPrediction) return cachedPrediction;
    
    console.log(`Requesting fresh AI prediction for ${symbol} at ${currentPrice.toFixed(2)}`);
    
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
    let prediction;
    
    try {
      prediction = JSON.parse(result.choices[0].message.content);
    } catch (err) {
      console.error('Error parsing AI response:', err);
      throw new Error('Failed to parse AI response');
    }
    
    // Ensure all fields are present and formatted correctly
    const formattedPrediction = {
      recommendation: prediction.recommendation,
      reason: prediction.reason,
      targetPrice: parseFloat(prediction.targetPrice) || currentPrice,
      upside: parseFloat(prediction.upside) || ((prediction.targetPrice / currentPrice - 1) * 100).toFixed(1),
      confidence: parseInt(prediction.confidence) || 50,
      analysisTime: new Date().toISOString()
    };
    
    // Cache the AI prediction - reduced cache time to ensure freshness
    memoryCache.set(cacheKey, formattedPrediction, 3600); // 1 hour cache
    
    return formattedPrediction;
  } catch (err) {
    console.error('Error getting AI prediction:', err);
    
    // Fallback to a basic recommendation based on technical indicators
    return generateFallbackRecommendation(data);
  }
}

// Create a compact prompt for the AI with only essential data
function createCompactPrompt(data, symbol) {
  const { fundamentals, balanceSheet, technicalAnalysis, currentQuote } = data;
  
  // Use technicalAnalysis.currentPrice which is most up-to-date
  const currentPrice = technicalAnalysis?.currentPrice || 0;
  
  // Format key ratios and metrics
  const pe = currentQuote?.price && fundamentals?.eps 
    ? (currentQuote.price / fundamentals.eps).toFixed(2) 
    : 'N/A';
  
  return `
You are an AI financial analyst. Based on the following real-time data for ${symbol}, provide a recommendation: BUY, SELL, or HOLD.

Key Fundamentals:
- Revenue: ${formatNumber(fundamentals?.revenue)}
- Net Income: ${formatNumber(fundamentals?.netIncome)}
- EPS: ${fundamentals?.eps}
- Net Income Ratio: ${formatPercentage(fundamentals?.netIncomeRatio)}
- P/E Ratio: ${pe}

Balance Sheet:
- Total Assets: ${formatNumber(balanceSheet?.totalAssets)}
- Total Liabilities: ${formatNumber(balanceSheet?.totalLiabilities)}
- Debt to Assets: ${formatPercentage(balanceSheet?.debtToAssets * 100)}
- Current Ratio: ${balanceSheet?.currentRatio?.toFixed(2) || 'N/A'}

Technical Indicators:
- RSI (14-day): ${formatNumber(technicalAnalysis?.rsi, 2)}
- SMA20: ${formatNumber(technicalAnalysis?.sma20, 2)}
- SMA50: ${formatNumber(technicalAnalysis?.sma50, 2)}
- SMA200: ${formatNumber(technicalAnalysis?.sma200, 2)}
- 1-Day Price Change: ${formatPercentage(technicalAnalysis?.priceChange1d)}
- 1-Month Price Change: ${formatPercentage(technicalAnalysis?.priceChange1m)}
- 3-Month Price Change: ${formatPercentage(technicalAnalysis?.priceChange3m)}
- Volume Change: ${formatPercentage(technicalAnalysis?.volumeChange)}
- 52-Week High: ${formatNumber(technicalAnalysis?.high52Week, 2)}
- 52-Week Low: ${formatNumber(technicalAnalysis?.low52Week, 2)}
- % From 52-Week High: ${formatPercentage(technicalAnalysis?.distanceFromHigh)}
- % From 52-Week Low: ${formatPercentage(technicalAnalysis?.distanceFromLow)}

Current Price: ${formatNumber(currentPrice, 2)}
Last Updated: ${new Date().toISOString()}

Respond with only a JSON object containing:
{
  "recommendation": "BUY/SELL/HOLD",
  "reason": "Brief explanation of your recommendation (1-2 sentences)",
  "targetPrice": numerical value representing your 12-month price target,
  "upside": percentage representing potential upside or downside from current price,
  "confidence": 0-100
}
  `;
}

// Helper functions to format numbers and percentages nicely
function formatNumber(num, decimals = 0) {
  if (num === undefined || num === null) return 'N/A';
  return Number(num).toLocaleString('en-US', { 
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentage(percent) {
  if (percent === undefined || percent === null) return 'N/A';
  return percent.toFixed(2) + '%';
}
}

// Generate a fingerprint of the data for caching purposes
function getDataFingerprint(data) {
  const { fundamentals, technicalAnalysis } = data;
  return `${fundamentals?.date}_${technicalAnalysis?.rsi?.toFixed(1)}_${technicalAnalysis?.priceChange1m?.toFixed(1)}`;
}

// Generate fallback recommendation if AI fails
function generateFallbackRecommendation(data) {
  const { technicalAnalysis } = data;
  const currentPrice = data.priceHistory?.[data.priceHistory.length - 1]?.close || 0;
  
  if (!technicalAnalysis) {
    return {
      recommendation: "HOLD",
      reason: "Insufficient data to make a confident recommendation.",
      targetPrice: currentPrice,
      upside: 0,
      confidence: 30
    };
  }
  
  const { rsi, priceChange1m, priceChange3m, sma50 } = technicalAnalysis;
  let targetPrice = currentPrice;
  
  // Basic algorithm for fallback recommendation with target price
  if (rsi < 30 && priceChange1m < -5 && priceChange3m < 0) {
    // For oversold stocks, estimate a 15% recovery
    targetPrice = currentPrice * 1.15;
    return {
      recommendation: "BUY",
      reason: "Stock appears oversold with low RSI and recent price decline.",
      targetPrice: parseFloat(targetPrice.toFixed(2)),
      upside: 15,
      confidence: 60
    };
  } else if (rsi > 70 && priceChange1m > 10) {
    // For overbought stocks, estimate a 10% correction
    targetPrice = currentPrice * 0.9;
    return {
      recommendation: "SELL",
      reason: "Stock appears overbought with high RSI and recent sharp price increase.",
      targetPrice: parseFloat(targetPrice.toFixed(2)),
      upside: -10,
      confidence: 60
    };
  } else {
    // For neutral stocks, use SMA50 as reference or estimate modest 5% growth
    targetPrice = sma50 || currentPrice * 1.05;
    const upside = ((targetPrice / currentPrice) - 1) * 100;
    return {
      recommendation: "HOLD",
      reason: "Technical indicators show neutral signals.",
      targetPrice: parseFloat(targetPrice.toFixed(2)),
      upside: parseFloat(upside.toFixed(1)),
      confidence: 50
    };
  }
}
