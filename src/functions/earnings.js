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
    const apiKey = process.env.FMP_API;
    
    if (!apiKey) {
      throw new Error('FMP_API environment variable is not set');
    }

    // Make request to Financial Modeling Prep API
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/earning_calendar`, 
      {
        params: {
          apikey: apiKey
        }
      }
    );

    // Process the data to enhance it with additional information
    const rawEarnings = response.data;
    const enhancedEarnings = await enhanceEarningsData(rawEarnings, apiKey);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        earningsCalendar: enhancedEarnings
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
  // Get the list of symbols from earnings data
  const symbols = earningsData.map(item => item.symbol);
  
  // Batch the symbols into groups of 20 to avoid API limits
  const batchedSymbols = [];
  for (let i = 0; i < symbols.length; i += 20) {
    batchedSymbols.push(symbols.slice(i, i + 20));
  }
  
  // Get profile and quote data for all companies in batches
  const profileData = {};
  const quoteData = {};
  
  await Promise.all(
    batchedSymbols.map(async (batch) => {
      const batchSymbols = batch.join(',');
      
      try {
        // Get company profiles
        const profileResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/profile/${batchSymbols}`,
          {
            params: {
              apikey: apiKey
            }
          }
        );
        
        // Get quote data
        const quoteResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/quote/${batchSymbols}`,
          {
            params: {
              apikey: apiKey
            }
          }
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
