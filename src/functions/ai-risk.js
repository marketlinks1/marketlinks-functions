// ai-risk.js - Netlify Serverless Function for Stock Risk Assessment
const axios = require('axios');

// Get API keys from environment variables
const FMP_API_KEY = process.env.FMP_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle OPTIONS request (preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight successful' })
    };
  }
  
  // Check if API keys are set in environment variables
  if (!FMP_API_KEY) {
    console.error('FMP_API_KEY environment variable is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error: Missing FMP API key' })
    };
  }
  
  if (!OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY environment variable is not set');
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server configuration error: Missing OpenAI API key' })
    };
  }

  try {
    // Get the stock symbol from query parameters
    const symbol = event.queryStringParameters.symbol;
    
    if (!symbol) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Stock symbol is required' })
      };
    }
    
    // Fetch all required data from FMP
    const stockData = await fetchStockData(symbol);
    
    if (!stockData || !stockData.profile) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: `Company with symbol ${symbol} not found` })
      };
    }
    
    // Calculate risk assessment
    const riskData = assessRisk(stockData);
    
    // Get AI analysis
    const aiAnalysis = await getAIAnalysis(stockData);
    
    // Return complete response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        stockData: {
          symbol: symbol,
          companyName: stockData.profile.companyName,
          sector: stockData.profile.sector,
          industry: stockData.profile.industry,
          logo: stockData.profile.image,
          price: stockData.quote?.price,
          priceChange: stockData.quote?.change,
          priceChangePercent: stockData.quote?.changesPercentage
        },
        riskData: riskData,
        aiAnalysis: aiAnalysis
      })
    };
  } catch (error) {
    console.error('Error processing request:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to process request', details: error.message })
    };
  }
};

// Fetch stock data from FMP API
async function fetchStockData(symbol) {
  try {
    const stockData = {
      symbol: symbol
    };
    
    // Fetch company profile
    const profileResponse = await axios.get(`https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${FMP_API_KEY}`);
    if (profileResponse.data && profileResponse.data.length > 0) {
      stockData.profile = profileResponse.data[0];
      
      // Fetch quote data
      const quoteResponse = await axios.get(`https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${FMP_API_KEY}`);
      if (quoteResponse.data && quoteResponse.data.length > 0) {
        stockData.quote = quoteResponse.data[0];
        
        // Fetch financial ratios
        const ratiosResponse = await axios.get(`https://financialmodelingprep.com/api/v3/ratios-ttm/${symbol}?apikey=${FMP_API_KEY}`);
        if (ratiosResponse.data && ratiosResponse.data.length > 0) {
          stockData.ratios = ratiosResponse.data[0];
        }
        
        // Fetch income statement
        const incomeResponse = await axios.get(`https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=4&apikey=${FMP_API_KEY}`);
        if (incomeResponse.data && incomeResponse.data.length > 0) {
          stockData.income = incomeResponse.data;
        }
        
        // Fetch balance sheet
        const balanceResponse = await axios.get(`https://financialmodelingprep.com/api/v3/balance-sheet-statement/${symbol}?limit=4&apikey=${FMP_API_KEY}`);
        if (balanceResponse.data && balanceResponse.data.length > 0) {
          stockData.balance = balanceResponse.data;
        }
        
        // Fetch key metrics
        const metricsResponse = await axios.get(`https://financialmodelingprep.com/api/v3/key-metrics-ttm/${symbol}?apikey=${FMP_API_KEY}`);
        if (metricsResponse.data && metricsResponse.data.length > 0) {
          stockData.metrics = metricsResponse.data[0];
        }
      }
    }
    
    return stockData;
  } catch (error) {
    console.error('Error fetching stock data:', error);
    throw error;
  }
}

// Get AI analysis from OpenAI
async function getAIAnalysis(stockData) {
  try {
    if (!stockData.profile) return 'Unable to generate AI analysis due to missing data.';
    
    // Prepare data for AI analysis
    const companyOverview = {
      symbol: stockData.symbol,
      name: stockData.profile.companyName,
      sector: stockData.profile.sector,
      industry: stockData.profile.industry,
      beta: stockData.profile.beta,
      price: stockData.quote?.price,
      marketCap: stockData.profile.mktCap,
      lastDividend: stockData.profile.lastDiv,
      profitMargin: stockData.ratios?.netProfitMarginTTM,
      debtToEquity: stockData.ratios?.debtEquityRatioTTM,
      currentRatio: stockData.ratios?.currentRatioTTM,
      returnOnEquity: stockData.ratios?.returnOnEquityTTM,
      priceToEarnings: stockData.ratios?.priceEarningsRatioTTM,
      revenue: stockData.income?.[0]?.revenue,
      revenueGrowth: stockData.income?.[0]?.revenue && stockData.income?.[1]?.revenue 
        ? ((stockData.income[0].revenue - stockData.income[1].revenue) / stockData.income[1].revenue * 100) 
        : null
    };
    
    // Format large numbers helper function
    const formatLargeNumber = (num) => {
      if (!num) return 'N/A';
      
      if (num >= 1e12) {
        return (num / 1e12).toFixed(2) + ' T';
      } else if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + ' B';
      } else if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + ' M';
      } else {
        return num.toLocaleString();
      }
    };
    
    // Create a prompt for the AI
    const prompt = `
      Provide a concise risk assessment for ${companyOverview.name} (${companyOverview.symbol}) based on the following data:
      
      - Sector: ${companyOverview.sector || 'N/A'}
      - Industry: ${companyOverview.industry || 'N/A'}
      - Beta: ${companyOverview.beta || 'N/A'}
      - Market Cap: $${formatLargeNumber(companyOverview.marketCap)}
      - P/E Ratio: ${companyOverview.priceToEarnings?.toFixed(2) || 'N/A'}
      - Profit Margin: ${companyOverview.profitMargin ? (companyOverview.profitMargin * 100).toFixed(2) + '%' : 'N/A'}
      - Debt-to-Equity: ${companyOverview.debtToEquity?.toFixed(2) || 'N/A'}
      - Current Ratio: ${companyOverview.currentRatio?.toFixed(2) || 'N/A'}
      - Return on Equity: ${companyOverview.returnOnEquity ? (companyOverview.returnOnEquity * 100).toFixed(2) + '%' : 'N/A'}
      - Revenue Growth: ${companyOverview.revenueGrowth?.toFixed(2) + '%' || 'N/A'}
      
      Focus on key risk factors, competitive positioning, and financial health. Limit your response to 3-4 sentences.
    `;
    
    // Call OpenAI API
    const openaiResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a financial analyst specializing in stock risk assessment. Provide concise, professional analyses based on the data given.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      max_tokens: 150
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      }
    });
    
    // Extract AI response
    if (openaiResponse.data.choices && openaiResponse.data.choices.length > 0) {
      return openaiResponse.data.choices[0].message.content;
    } else {
      return 'AI analysis currently unavailable.';
    }
  } catch (error) {
    console.error('Error getting AI analysis:', error);
    return 'Failed to generate AI analysis. Please try again later.';
  }
}

// Assess risk based on financial data
function assessRisk(stockData) {
  // Default values if we can't calculate
  let riskData = {
    market: {
      level: 'Low',
      score: 30,
      description: 'Low exposure to market volatility with beta of 0.8'
    },
    company: {
      level: 'Medium',
      score: 55,
      description: 'Moderate risk due to product cycle dependencies'
    },
    sector: {
      level: 'Low',
      score: 35,
      description: 'Tech sector showing resilience despite macro headwinds'
    },
    overall: {
      level: 'Low',
      score: 32,
      description: 'Strong balance sheet, diversified revenue streams, and dominant market position contribute to low overall risk.'
    }
  };
  
  try {
    if (stockData.profile && stockData.quote) {
      // Get market risk (beta-based)
      const beta = stockData.profile.beta || 1;
      if (beta < 0.8) {
        riskData.market.level = 'Low';
        riskData.market.score = Math.min(30, beta * 30);
        riskData.market.description = `Low exposure to market volatility with beta of ${beta.toFixed(1)}`;
      } else if (beta < 1.2) {
        riskData.market.level = 'Medium';
        riskData.market.score = 30 + ((beta - 0.8) * 50);
        riskData.market.description = `Average market volatility with beta of ${beta.toFixed(1)}`;
      } else {
        riskData.market.level = 'High';
        riskData.market.score = Math.min(85, 70 + ((beta - 1.2) * 25));
        riskData.market.description = `High sensitivity to market movements with beta of ${beta.toFixed(1)}`;
      }
      
      // Enhanced company risk calculation using comprehensive metrics
      const debtToEquity = stockData.ratios?.debtEquityRatioTTM || stockData.profile.debtToEquity || 0;
      const profitMargin = stockData.ratios?.netProfitMarginTTM || stockData.profile.profitMargin || 0;
      const currentRatio = stockData.ratios?.currentRatioTTM || 0;
      const returnOnEquity = stockData.ratios?.returnOnEquityTTM || 0;
      const quickRatio = stockData.ratios?.quickRatioTTM || 0;
      
      let companyScore = 50; // Default medium
      
      // Adjust for debt
      if (debtToEquity > 1.5) {
        companyScore += 25;
      } else if (debtToEquity > 1) {
        companyScore += 15;
      } else if (debtToEquity < 0.3) {
        companyScore -= 15;
      }
      
      // Adjust for profitability
      if (profitMargin > 0.2) {
        companyScore -= 15;
      } else if (profitMargin > 0.1) {
        companyScore -= 10;
      } else if (profitMargin < 0) {
        companyScore += 25;
      }
      
      // Adjust for liquidity
      if (currentRatio > 2) {
        companyScore -= 10;
      } else if (currentRatio < 1) {
        companyScore += 15;
      }
      
      // Adjust for return on equity
      if (returnOnEquity > 0.2) {
        companyScore -= 10;
      } else if (returnOnEquity < 0.05) {
        companyScore += 10;
      }
      
      // Adjust for solvency
      if (quickRatio < 0.7) {
        companyScore += 15;
      } else if (quickRatio > 1.5) {
        companyScore -= 10;
      }
      
      // Cap score within 0-100 range
      companyScore = Math.max(0, Math.min(100, companyScore));
      
      // Set company risk level
      if (companyScore < 40) {
        riskData.company.level = 'Low';
        riskData.company.description = 'Strong financials with healthy balance sheet and good profitability';
      } else if (companyScore < 65) {
        riskData.company.level = 'Medium';
        riskData.company.description = `Moderate risk with debt-to-equity ratio of ${debtToEquity.toFixed(1)}`;
      } else {
        riskData.company.level = 'High';
        riskData.company.description = 'Higher risk due to elevated debt levels or profitability concerns';
      }
      
      riskData.company.score = companyScore;
      
      // Enhanced sector risk assessment
      const sector = stockData.profile.sector || "";
      
      // More nuanced sector risk categorization
      const highRiskSectors = ['Energy', 'Basic Materials', 'Financial Services', 'Real Estate', 'Cryptocurrency'];
      const mediumRiskSectors = ['Technology', 'Communication Services', 'Consumer Cyclical', 'Industrials', 'Transportation'];
      const lowRiskSectors = ['Healthcare', 'Consumer Defensive', 'Utilities', 'Infrastructure'];
      
      // Adjust sector risk based on current market conditions
      let sectorScore = 50;
      
      if (highRiskSectors.includes(sector)) {
        sectorScore += 25;
      } else if (mediumRiskSectors.includes(sector)) {
        sectorScore += 0;
      } else if (lowRiskSectors.includes(sector)) {
        sectorScore -= 25;
      }
      
      // Cap score within 0-100 range
      sectorScore = Math.max(0, Math.min(100, sectorScore));
      
      if (sectorScore < 40) {
        riskData.sector.level = 'Low';
        riskData.sector.score = sectorScore;
        riskData.sector.description = `${sector} sector typically demonstrates stability through economic cycles`;
      } else if (sectorScore < 65) {
        riskData.sector.level = 'Medium';
        riskData.sector.score = sectorScore;
        riskData.sector.description = `${sector} sector shows moderate sensitivity to economic cycles`;
      } else {
        riskData.sector.level = 'High';
        riskData.sector.score = sectorScore;
        riskData.sector.description = `${sector} sector experiences higher volatility and cyclicality`;
      }
      
      // Calculate overall risk score (weighted average)
      const overallScore = (
        (riskData.market.score * 0.3) + 
        (riskData.company.score * 0.5) + 
        (riskData.sector.score * 0.2)
      );
      
      if (overallScore < 40) {
        riskData.overall.level = 'Low';
        riskData.overall.description = `${stockData.profile.companyName} demonstrates strong fundamentals and stability relative to peers.`;
      } else if (overallScore < 65) {
        riskData.overall.level = 'Medium';
        riskData.overall.description = `${stockData.profile.companyName} shows balanced risk profile with some areas of moderate concern.`;
      } else {
        riskData.overall.level = 'High';
        riskData.overall.description = `${stockData.profile.companyName} faces elevated risk factors that may impact performance.`;
      }
      
      riskData.overall.score = overallScore;
    }
  } catch (error) {
    console.error('Error calculating risk factors:', error);
  }
  
  return riskData;
}
