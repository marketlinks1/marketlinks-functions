// Netlify function to provide AI-generated price targets for stocks using Anthropic Claude
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// Cache mechanism to reduce API calls
const CACHE_DURATION = 3600000; // 1 hour in milliseconds
const cache = new Map();

exports.handler = async function(event, context) {
  // Set CORS headers to allow requests from any origin
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight request successful' })
    };
  }

  // Get the stock symbol from query parameters
  const symbol = event.queryStringParameters?.symbol || 'BA'; // Default to BA if no symbol provided
  
  try {
    // Check if we have a valid cached response
    const now = Date.now();
    const cachedData = cache.get(symbol);
    
    if (cachedData && (now - cachedData.timestamp < CACHE_DURATION)) {
      console.log(`Using cached data for ${symbol}`);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(cachedData.data)
      };
    }
    
    // Get the API keys from environment variables
    const fmpApiKey = process.env.FMP_API_KEY;
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    
    if (!fmpApiKey) {
      throw new Error('FMP API key not configured');
    }
    
    if (!anthropicApiKey) {
      throw new Error('Anthropic API key not configured');
    }
    
    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: anthropicApiKey,
    });
    
    // Fetch real-time stock price from Financial Modeling Prep API
    const quoteResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${fmpApiKey}`
    );
    
    if (!quoteResponse.data || quoteResponse.data.length === 0) {
      throw new Error('Stock data not found');
    }
    
    const stockData = quoteResponse.data[0];
    const currentPrice = stockData.price;
    
    // Get company financials
    const financialsResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/income-statement/${symbol}?limit=4&apikey=${fmpApiKey}`
    );
    
    // Get balance sheet data
    const balanceSheetResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/balance-sheet-statement/${symbol}?limit=1&apikey=${fmpApiKey}`
    );
    
    // Get historical price data (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const fromDate = thirtyDaysAgo.toISOString().split('T')[0];
    const toDate = today.toISOString().split('T')[0];
    
    const historicalPriceResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/historical-price-full/${symbol}?from=${fromDate}&to=${toDate}&apikey=${fmpApiKey}`
    );
    
    // Get analysts recommendations
    const recommendationsResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/analyst-stock-recommendations/${symbol}?apikey=${fmpApiKey}`
    );
    
    // Get company profile
    const companyProfileResponse = await axios.get(
      `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${fmpApiKey}`
    );
    
    // Extract the data we need
    const financials = financialsResponse.data || [];
    const balanceSheet = balanceSheetResponse.data && balanceSheetResponse.data.length > 0 
        ? balanceSheetResponse.data[0] 
        : null;
    const priceHistory = historicalPriceResponse.data && historicalPriceResponse.data.historical 
        ? historicalPriceResponse.data.historical.slice(0, 10).map(item => ({
            date: item.date,
            close: item.close,
            volume: item.volume
          }))
        : [];
    const recommendations = recommendationsResponse.data?.recommendations || [];
    const companyProfile = companyProfileResponse.data && companyProfileResponse.data.length > 0
        ? companyProfileResponse.data[0]
        : null;
    
    // Calculate some basic metrics for the prompting
    let financialMetrics = {};
    let technicalIndicators = {};
    
    if (financials.length > 0) {
      const latestFinancial = financials[0];
      const previousFinancial = financials[1];
      
      financialMetrics = {
        revenueGrowth: previousFinancial 
          ? ((latestFinancial.revenue - previousFinancial.revenue) / previousFinancial.revenue * 100).toFixed(2) + '%'
          : 'N/A',
        profitMargin: latestFinancial.revenue > 0
          ? ((latestFinancial.netIncome / latestFinancial.revenue) * 100).toFixed(2) + '%'
          : 'N/A',
        eps: latestFinancial.eps,
        pe: stockData.pe || 'N/A',
      };
    }
    
    if (priceHistory.length > 1) {
      // Simple moving averages
      const prices = priceHistory.map(day => day.close).reverse(); // Get prices in chronological order
      const sma20 = prices.slice(0, Math.min(20, prices.length)).reduce((sum, price) => sum + price, 0) / Math.min(20, prices.length);
      const sma50 = prices.slice(0, Math.min(50, prices.length)).reduce((sum, price) => sum + price, 0) / Math.min(50, prices.length);
      
      technicalIndicators = {
        sma20: sma20.toFixed(2),
        sma50: sma50.toFixed(2),
        priceVsSMA20: ((currentPrice / sma20 - 1) * 100).toFixed(2) + '%',
        priceVsSMA50: ((currentPrice / sma50 - 1) * 100).toFixed(2) + '%',
      };
    }
    
    // Create a prompt for Claude with the data
    const prompt = `
      You are a financial expert providing stock analysis. Please analyze the following data for ${symbol} (${companyProfile?.companyName || 'Unknown Company'}) and provide an investment recommendation.
      
      Current Price: $${currentPrice}
      
      Company Profile:
      ${companyProfile ? `
      - Industry: ${companyProfile.industry}
      - Sector: ${companyProfile.sector}
      - Market Cap: $${companyProfile.mktCap}
      - Beta: ${companyProfile.beta}
      - Description: ${companyProfile.description.substring(0, 300)}...
      ` : 'No profile data available'}
      
      Financial Metrics:
      ${Object.keys(financialMetrics).length > 0 ? `
      - Revenue Growth: ${financialMetrics.revenueGrowth}
      - Profit Margin: ${financialMetrics.profitMargin}
      - EPS: ${financialMetrics.eps}
      - P/E Ratio: ${financialMetrics.pe}
      ` : 'No financial metrics available'}
      
      Balance Sheet Highlights:
      ${balanceSheet ? `
      - Cash: $${balanceSheet.cashAndCashEquivalents}
      - Total Assets: $${balanceSheet.totalAssets}
      - Total Liabilities: $${balanceSheet.totalLiabilities}
      - Total Debt: $${balanceSheet.totalDebt}
      - Debt-to-Assets: ${balanceSheet.totalAssets > 0 ? (balanceSheet.totalDebt / balanceSheet.totalAssets).toFixed(3) : 'N/A'}
      ` : 'No balance sheet data available'}
      
      Technical Indicators:
      ${Object.keys(technicalIndicators).length > 0 ? `
      - 20-Day SMA: $${technicalIndicators.sma20}
      - 50-Day SMA: $${technicalIndicators.sma50}
      - Price vs 20-Day SMA: ${technicalIndicators.priceVsSMA20}
      - Price vs 50-Day SMA: ${technicalIndicators.priceVsSMA50}
      ` : 'No technical indicators available'}
      
      Analyst Recommendations:
      ${recommendations.length > 0 ? `
      - Strong Buy: ${recommendations[0].strongBuy}
      - Buy: ${recommendations[0].buy}
      - Hold: ${recommendations[0].hold}
      - Sell: ${recommendations[0].sell}
      - Strong Sell: ${recommendations[0].strongSell}
      - Consensus: ${recommendations[0].consensus}
      ` : 'No analyst recommendations available'}
      
      Based on this data, please provide:
      1. A clear rating for the stock (either "BUY", "SELL", or "HOLD" - must be one of these three in ALL CAPS)
      2. A target price for the next 6 months (as a specific dollar amount)
      3. A confidence level (as a percentage from 1-100%)
      4. A brief explanation of your recommendation (1-3 sentences)
      
      Format your response as a JSON object with the following structure:
      {
        "rating": "RATING",
        "targetPrice": PRICE_AS_NUMBER,
        "confidence": CONFIDENCE_AS_NUMBER,
        "reason": "EXPLANATION"
      }
      
      Include nothing else in your response except this JSON object.
    `;
    
    let rating, targetPrice, confidence, reason, note = "";
    
    try {
      // Query Claude with the prompt
      const aiResponse = await anthropic.messages.create({
        model: "claude-3-opus-20240229",
        max_tokens: 1000,
        temperature: 0.2,
        system: "You are a financial analyst expert. Be concise and clear in your analysis.",
        messages: [
          { role: "user", content: prompt }
        ],
      });
      
      // Parse the response to extract the JSON
      const responseText = aiResponse.content[0].text;
      console.log("Claude response:", responseText);
      
      // Clean response - sometimes models add markdown code blocks
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : responseText;
      
      const recommendation = JSON.parse(jsonStr);
      rating = recommendation.rating;
      targetPrice = recommendation.targetPrice;
      confidence = recommendation.confidence;
      reason = recommendation.reason;
      
    } catch (aiError) {
      console.error("Error from AI service:", aiError);
      
      // Fallback if AI analysis fails
      rating = 'HOLD';
      targetPrice = Math.round(currentPrice * 1.02 * 100) / 100;
      confidence = 50;
      reason = "Technical indicators show neutral signals.";
      note = "This is a fallback recommendation due to AI service error.";
    }
    
    // Format response data in the specified structure
    const responseData = {
      symbol,
      rating,
      target_price: targetPrice,
      current_price: currentPrice,
      confidence,
      reason,
      recommendation: {
        recommendation: rating,
        reason: reason,
        targetPrice: targetPrice,
        upside: ((targetPrice - currentPrice) / currentPrice * 100).toFixed(1),
        confidence: confidence,
        analysisTime: new Date().toISOString(),
        note: note
      },
      fetchedData: {
        fundamentals: financials.length > 0 ? {
          date: financials[0].date,
          revenue: financials[0].revenue,
          netIncome: financials[0].netIncome,
          eps: financials[0].eps,
          ebitda: financials[0].ebitda,
          grossProfitRatio: financials[0].grossProfitRatio,
          operatingIncomeRatio: financials[0].operatingIncomeRatio,
          netIncomeRatio: financials[0].netIncomeRatio
        } : null,
        balanceSheet: balanceSheet ? {
          date: balanceSheet.date,
          cashAndCashEquivalents: balanceSheet.cashAndCashEquivalents || 0,
          totalAssets: balanceSheet.totalAssets || 0,
          totalLiabilities: balanceSheet.totalLiabilities || 0,
          totalDebt: balanceSheet.totalDebt || 0,
          debtToAssets: balanceSheet.totalAssets > 0 ? 
            (balanceSheet.totalDebt / balanceSheet.totalAssets) : 0,
          currentRatio: balanceSheet.totalCurrentLiabilities > 0 ?
            (balanceSheet.totalCurrentAssets / balanceSheet.totalCurrentLiabilities) : 0
        } : null,
        priceHistory: priceHistory
      }
    };
    
    // Cache the response
    cache.set(symbol, {
      timestamp: now,
      data: responseData
    });
    
    // Return the response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(responseData)
    };
    
  } catch (error) {
    console.error(`Error processing request for ${symbol}:`, error);
    
    // Return error response
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to retrieve AI rating data',
        message: error.message
      })
    };
  }
};
