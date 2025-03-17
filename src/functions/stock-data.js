// netlify/functions/stock-data.js

const axios = require('axios');

// FMP API endpoints
const FMP_API = {
  quote: 'https://financialmodelingprep.com/api/v3/quote',
  marketStatus: 'https://financialmodelingprep.com/api/v3/is-the-market-open',
  historical: {
    daily: 'https://financialmodelingprep.com/api/v3/historical-price-full',
    intraday: 'https://financialmodelingprep.com/api/v3/historical-chart'
  }
};

// Cache setup
const CACHE = {
  quotes: {},
  historical: {},
  market: { isOpen: null, lastChecked: null },
  expiry: {
    quotes: 60 * 1000, // 1 minute
    historical: {
      '1W': 60 * 60 * 1000, // 1 hour
      default: 24 * 60 * 60 * 1000 // 24 hours
    },
    market: 5 * 60 * 1000 // 5 minutes
  },
  isValid(type, symbol, timeframe) {
    if (!this[type][symbol]) return false;
    if (!this[type][symbol][timeframe]) return false;
    const entry = this[type][symbol][timeframe];
    const now = Date.now();
    const exp = type === 'historical' ? 
      this.expiry.historical[timeframe] || this.expiry.historical.default : 
      this.expiry[type];
    return entry.timestamp && (now - entry.timestamp < exp);
  },
  get(type, symbol, timeframe) {
    return this.isValid(type, symbol, timeframe) ? 
      this[type][symbol][timeframe].data : null;
  },
  set(type, symbol, timeframe, data) {
    if (!this[type][symbol]) this[type][symbol] = {};
    this[type][symbol][timeframe] = { data, timestamp: Date.now() };
  },
  getMarketStatus() {
    return (!this.market.lastChecked || 
      Date.now() - this.market.lastChecked > this.expiry.market) ? 
      null : this.market.isOpen;
  },
  setMarketStatus(isOpen) {
    this.market.isOpen = isOpen;
    this.market.lastChecked = Date.now();
  }
};

// Timeframe configurations
const TIMEFRAME = {
  "1W": {
    interval: 'daily',
    limit: 7,
    dateRange: { days: 7 },
    supplementWithIntraday: true
  },
  "1M": {
    interval: 'daily',
    limit: 30,
    dateRange: { months: 1 }
  },
  "3M": {
    interval: 'daily',
    limit: 90,
    dateRange: { months: 3 }
  },
  "6M": {
    interval: 'daily',
    limit: 180,
    dateRange: { months: 6 }
  },
  "1Y": {
    interval: 'daily',
    limit: 365,
    dateRange: { years: 1 }
  }
};

// Helper function to get date range for a timeframe
function getDateRange(timeframe) {
  const config = TIMEFRAME[timeframe];
  if (!config || !config.dateRange) return null;
  
  const endDate = new Date();
  let startDate = new Date();
  
  if (config.dateRange.days) startDate.setDate(endDate.getDate() - config.dateRange.days);
  if (config.dateRange.months) startDate.setMonth(endDate.getMonth() - config.dateRange.months);
  if (config.dateRange.years) startDate.setFullYear(endDate.getFullYear() - config.dateRange.years);
  
  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  };
}

// Format date to YYYY-MM-DD
function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Get market status
async function isMarketOpen(apiKey) {
  const cachedStatus = CACHE.getMarketStatus();
  if (cachedStatus !== null) return cachedStatus;
  
  // Quick check based on time
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) {
    CACHE.setMarketStatus(false);
    return false;
  }
  
  const h = now.getHours();
  const m = now.getMinutes();
  const isHours = (h > 9 || (h === 9 && m >= 30)) && h < 16;
  
  if (h >= 8 && h <= 17) {
    try {
      const res = await axios.get(`${FMP_API.marketStatus}?apikey=${apiKey}`);
      if (res.status === 200) {
        const data = res.data;
        const isOpen = data.isTheStockMarketOpen === true;
        CACHE.setMarketStatus(isOpen);
        return isOpen;
      }
    } catch (e) {
      console.error('Error checking market status:', e.message);
    }
  }
  
  CACHE.setMarketStatus(isHours);
  return isHours;
}

// Supplement historical data with intraday data if needed
async function supplementIntraday(symbol, histData, apiKey) {
  const today = new Date().toISOString().split('T')[0];
  const hasTodayData = histData.some(item => 
    item.date && new Date(item.date).toISOString().split('T')[0] === today
  );
  
  if (!hasTodayData) {
    try {
      const url = `${FMP_API.historical.intraday}/30min/${symbol}?apikey=${apiKey}`;
      const res = await axios.get(url);
      
      if (res.status === 200) {
        const data = res.data;
        
        if (data && data.length > 0) {
          const todayData = data.filter(item => {
            return new Date(item.date).toISOString().split('T')[0] === today;
          });
          
          if (todayData.length > 0) {
            const lastPrice = todayData[0].close;
            const openPrice = todayData[todayData.length - 1].open;
            const highPrice = Math.max(...todayData.map(i => i.high || i.close));
            const lowPrice = Math.min(...todayData.map(i => i.low || i.close));
            
            histData.unshift({
              date: today,
              open: openPrice,
              high: highPrice,
              low: lowPrice,
              close: lastPrice,
              volume: 0
            });
          }
        }
      }
    } catch (e) {
      console.error('Error fetching intraday data:', e.message);
    }
  }
  
  return histData;
}

// Generate AI rating with target price
function generateAIRating(symbol, currentPrice) {
  const basePrice = currentPrice || 100;
  const targetPrice = basePrice * (1 + (Math.random() * 0.3 - 0.15));
  const priceDiff = targetPrice - basePrice;
  let rating = 'Hold';
  
  if (priceDiff > basePrice * 0.1) {
    rating = 'Strong Buy';
  } else if (priceDiff > basePrice * 0.03) {
    rating = 'Buy';
  } else if (priceDiff < -basePrice * 0.1) {
    rating = 'Strong Sell';
  } else if (priceDiff < -basePrice * 0.03) {
    rating = 'Sell';
  }
  
  const confidence = Math.floor(60 + Math.random() * 30);
  
  return {
    symbol: symbol,
    rating: rating,
    target_price: targetPrice,
    confidence: confidence,
    generated: true
  };
}

exports.handler = async (event, context) => {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
  
  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers
    };
  }
  
  try {
    // Get the API key from environment variables
    const apiKey = process.env.FMP_API_KEY;
    
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'API key is not configured' })
      };
    }
    
    const params = event.queryStringParameters || {};
    const { type, symbol, timeframe } = params;
    
    if (!type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required parameter: type' })
      };
    }
    
    let responseData;
    
    switch (type) {
      case 'quote':
        if (!symbol) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing required parameter: symbol' })
          };
        }
        
        // Check cache first
        responseData = CACHE.get('quotes', symbol, 'any');
        
        if (!responseData) {
          const url = `${FMP_API.quote}/${symbol}?apikey=${apiKey}`;
          const response = await axios.get(url);
          
          if (response.status === 200 && response.data && response.data.length > 0) {
            responseData = response.data[0];
            CACHE.set('quotes', symbol, 'any', responseData);
          } else {
            return {
              statusCode: 404,
              headers,
              body: JSON.stringify({ error: 'Stock not found' })
            };
          }
        }
        break;
        
      case 'historical':
        if (!symbol || !timeframe) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing required parameters: symbol and timeframe' })
          };
        }
        
        // Check cache first
        responseData = CACHE.get('historical', symbol, timeframe);
        
        if (!responseData) {
          const config = TIMEFRAME[timeframe];
          if (!config) {
            return {
              statusCode: 400,
              headers,
              body: JSON.stringify({ error: 'Invalid timeframe' })
            };
          }
          
          const range = getDateRange(timeframe);
          let url = `${FMP_API.historical.daily}/${symbol}?apikey=${apiKey}`;
          
          if (range) {
            url += `&from=${range.startDate}&to=${range.endDate}`;
          }
          
          const response = await axios.get(url);
          
          if (response.status === 200 && response.data && response.data.historical) {
            responseData = response.data.historical;
            
            // For short timeframes, supplement with intraday data if market is open
            if (timeframe === '1W') {
              const marketOpen = await isMarketOpen(apiKey);
              if (marketOpen) {
                responseData = await supplementIntraday(symbol, responseData, apiKey);
              }
            }
            
            CACHE.set('historical', symbol, timeframe, responseData);
          } else {
            return {
              statusCode: 404,
              headers,
              body: JSON.stringify({ error: 'Historical data not found' })
            };
          }
        }
        break;
        
      case 'market-status':
        const isOpen = await isMarketOpen(apiKey);
        responseData = { isTheStockMarketOpen: isOpen };
        break;
        
      case 'ai-rating':
        if (!symbol) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Missing required parameter: symbol' })
          };
        }
        
        try {
          // Get current price first
          const quoteData = CACHE.get('quotes', symbol, 'any');
          let currentPrice;
          
          if (!quoteData) {
            const quoteUrl = `${FMP_API.quote}/${symbol}?apikey=${apiKey}`;
            const quoteResponse = await axios.get(quoteUrl);
            
            if (quoteResponse.status === 200 && quoteResponse.data && quoteResponse.data.length > 0) {
              currentPrice = quoteResponse.data[0].price;
              CACHE.set('quotes', symbol, 'any', quoteResponse.data[0]);
            }
          } else {
            currentPrice = quoteData.price;
          }
          
          responseData = generateAIRating(symbol, currentPrice);
        } catch (e) {
          console.error('Error generating AI rating:', e.message);
          responseData = generateAIRating(symbol, 100);
        }
        break;
        
      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid type' })
        };
    }
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData)
    };
    
  } catch (error) {
    console.error('Function error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Internal server error', details: error.message })
    };
  }
};
