// Netlify Function: getEarningsCalendar.js
// Place this in your netlify/functions folder

const axios = require('axios');

exports.handler = async function(event, context) {
  // Set CORS headers for your production domain
  const headers = {
    'Access-Control-Allow-Origin': '*', // Replace with your domain in production
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Get the API key from environment variables
    const apiKey = process.env.FMP_API_KEY;
    
    if (!apiKey) {
      throw new Error('FMP_API_KEY environment variable is not set');
    }

    // Extract query parameters if any
    const queryParams = event.queryStringParameters || {};
    const from = queryParams.from || '';
    const to = queryParams.to || '';
    
    // Build request parameters
    const params = { apikey: apiKey };
    if (from) params.from = from;
    if (to) params.to = to;

    // Make request to Financial Modeling Prep API
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/earning_calendar`, 
      { params }
    );

    // Get additional data to enhance the earnings calendar
    const enhancedData = await enhanceEarningsData(response.data, apiKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        earningsCalendar: enhancedData
      })
    };
  } catch (error) {
    console.error('Error fetching earnings data:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch earnings data',
        message: error.message 
      })
    };
  }
};

async function enhanceEarningsData(earningsData, apiKey) {
  // Get unique symbols from earnings data
  const symbols = [...new Set(earningsData.map(item => item.symbol))];
  
  // Batch the symbols into groups of 25 to avoid API limits
  const batchSize = 25;
  const batches = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    batches.push(symbols.slice(i, i + batchSize));
  }
  
  // Get additional data for all companies in batches
  const profileData = {};
  const quoteData = {};
  
  await Promise.all(
    batches.map(async (batch) => {
      const batchSymbols = batch.join(',');
      
      try {
        // Get company profiles (for sector, market cap, etc.)
        const profileResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/profile/${batchSymbols}`,
          { params: { apikey: apiKey } }
        );
        
        // Get quote data (for volume information)
        const quoteResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/quote/${batchSymbols}`,
          { params: { apikey: apiKey } }
        );
        
        // Map the data by symbol
        profileResponse.data.forEach(item => {
          profileData[item.symbol] = item;
        });
        
        quoteResponse.data.forEach(item => {
          quoteData[item.symbol] = item;
        });
      } catch (error) {
        console.error(`Error fetching data for batch ${batchSymbols}:`, error);
      }
    })
  );
  
  // Enhance earnings data with profile and quote information
  return earningsData.map(item => {
    const profile = profileData[item.symbol] || {};
    const quote = quoteData[item.symbol] || {};
    
    // Format volume as needed
    const volume = quote.volume || 0;
    const avgVolume = quote.avgVolume || 0;
    
    // Get market cap
    const marketCap = profile.mktCap || 0;
    
    // Determine earnings time (before or after market)
    let time = "N/A";
    if (item.epsEstimated) {
      // Simple heuristic based on time - FMP doesn't directly provide this
      // You may need to adjust this logic based on actual data
      time = item.time ? item.time : "TBD";
      if (!item.time) {
        time = "TBD";
      } else if (parseInt(item.time.split(':')[0]) < 9) {
        time = "Before Market";
      } else if (parseInt(item.time.split(':')[0]) >= 16) {
        time = "After Market";
      } else {
        time = "During Market";
      }
    }
    
    return {
      ...item,
      companyName: profile.companyName || item.company || "",
      sector: profile.sector || "N/A",
      industry: profile.industry || "N/A",
      volume: volume,
      avgVolume: avgVolume,
      marketCap: marketCap,
      time: time,
      eps: {
        estimate: item.epsEstimated || null,
        actual: item.eps || null,
        surprise: item.epsSurprise || null
      },
      revenue: {
        estimate: item.revenueEstimated || null,
        actual: item.revenue || null,
        surprise: item.revenueSurprise || null
      }
    };
  });
}
