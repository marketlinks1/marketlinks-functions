// ai-earnings.js - Debug version with detailed logging
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
  // Enable for detailed request logging
  console.log('Request details:', {
    path: event.path,
    queryParams: event.queryStringParameters,
    headers: event.headers,
    method: event.httpMethod
  });
  
  // Extract API key from environment variables
  const apiKey = process.env.FMP_API_KEY;
  
  if (!apiKey) {
    console.error('FMP_API_KEY environment variable is not set');
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key is not configured" })
    };
  }
  
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
    try {
      const urlParams = new URL(event.headers.referer).searchParams;
      symbolToUse = urlParams.get('symbol') || urlParams.get('ticker');
    } catch (error) {
      console.error('Error parsing referer URL:', error);
    }
  }
  
  // If we still don't have a symbol, return an error
  if (!symbolToUse) {
    console.log('No symbol provided in request');
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: "Symbol parameter is required. Please specify in URL parameters or path." 
      })
    };
  }
  
  console.log(`Processing earnings request for symbol: ${symbolToUse}, period: ${period}`);
  
  try {
    let url;
    
    // For quarterly earnings data (includes estimates and actuals)
    if (period === 'quarterly') {
      url = `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`;
    } else {
      // For annual data
      url = `https://financialmodelingprep.com/api/v3/income-statement/${symbolToUse}?period=annual&limit=5&apikey=${apiKey}`;
    }
    
    console.log(`Calling FMP API: ${url.replace(apiKey, 'REDACTED')}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error(`API request failed with status ${response.status}: ${response.statusText}`);
      return {
        statusCode: response.status,
        body: JSON.stringify({ 
          error: `Financial API returned an error: ${response.status} ${response.statusText}` 
        })
      };
    }
    
    let data = await response.json();
    
    console.log(`FMP API response received. Data type: ${typeof data}, isArray: ${Array.isArray(data)}, length: ${Array.isArray(data) ? data.length : 'N/A'}`);
    
    if (Array.isArray(data) && data.length === 0) {
      console.log(`No data returned from FMP API for symbol ${symbolToUse}`);
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: `No earnings data found for symbol: ${symbolToUse}`,
          symbol: symbolToUse 
        })
      };
    }
    
    // Transform annual data to match the format of quarterly data
    if (period === 'annual' && Array.isArray(data)) {
      console.log('Transforming annual data format');
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
    
    // Add the symbol to the response in case it was detected from path/referer
    const responseData = {
      symbol: symbolToUse,
      period: period,
      earnings: Array.isArray(data) ? data : []
    };
    
    console.log(`Returning success response with ${responseData.earnings.length} earnings records`);
    
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      },
      body: JSON.stringify(responseData)
    };
  } catch (error) {
    console.error('Error processing earnings request:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: `Internal server error: ${error.message}`,
        symbol: symbolToUse
      })
    };
  }
};
