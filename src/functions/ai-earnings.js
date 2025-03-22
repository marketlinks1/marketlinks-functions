// ai-earnings.js - Place this in your Netlify functions directory
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Extract API key from environment variables
  const apiKey = process.env.FMP_API_KEY;
  
  // Get query parameters
  const { symbol, period = 'quarterly' } = event.queryStringParameters || {};
  
  // If no symbol provided, check if we have a symbol in the URL path
  let symbolToUse = symbol;
  
  if (!symbolToUse) {
    // Extract symbol from the URL path if present (e.g., /ai-earnings/AAPL)
    const pathParts = event.path.split('/');
    const pathSymbol = pathParts[pathParts.length - 1];
    
    if (pathSymbol && pathSymbol.length > 0 && pathSymbol !== 'ai-earnings') {
      symbolToUse = pathSymbol.toUpperCase();
    }
  }
  
  // If still no symbol, use URL referer to extract symbol if present
  if (!symbolToUse && event.headers.referer) {
    const urlParams = new URL(event.headers.referer).searchParams;
    symbolToUse = urlParams.get('symbol') || urlParams.get('ticker');
  }
  
  // If we still don't have a symbol, return an error
  if (!symbolToUse) {
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: "Symbol parameter is required. Please specify in URL parameters or path." 
      })
    };
  }
  
  try {
    let url;
    
    // For quarterly earnings data (includes estimates and actuals)
    if (period === 'quarterly') {
      url = `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`;
    } else {
      // For annual data
      url = `https://financialmodelingprep.com/api/v3/income-statement/${symbolToUse}?period=annual&limit=5&apikey=${apiKey}`;
    }
    
    console.log(`Fetching earnings data for ${symbolToUse} (${period})`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    let data = await response.json();
    
    // Transform annual data to match the format of quarterly data
    if (period === 'annual' && Array.isArray(data)) {
      data = data.map(item => {
        // Calculate a synthetic "surprise" based on YoY growth
        const prevYearIndex = data.findIndex(d => 
          new Date(d.date).getFullYear() === new Date(item.date).getFullYear() - 1
        );
        
        const prevYearEps = prevYearIndex >= 0 ? data[prevYearIndex].eps : null;
        const surprisePercentage = prevYearEps 
          ? ((item.eps - prevYearEps) / Math.abs(prevYearEps)) * 100 
          : null;
        
        return {
          date: item.date,
          fiscalPeriod: 'FY ' + new Date(item.date).getFullYear(),
          estimatedEps: null, // No estimates in annual reports
          actualEps: item.eps,
          surprisePercentage: surprisePercentage,
          estimatedRevenue: null,
          actualRevenue: item.revenue
        };
      });
    }
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      },
      body: JSON.stringify(data)
    };
  } catch (error) {
    console.error('Error fetching earnings data:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
