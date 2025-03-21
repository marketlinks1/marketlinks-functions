// Netlify Function: earnings.js
// Place this in your netlify/functions folder

const axios = require('axios');

// Fixed batch size to prevent EMFILE errors (too many open files)
const BATCH_SIZE = 5; // Reduced from 25 to prevent hitting system limits
const MAX_CONCURRENT_REQUESTS = 3; // Limit concurrent requests

exports.handler = async function(event, context) {
  // Set CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*', // In production, replace with specific domains
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
    // Get API key from environment variables
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

    // Fetch earnings calendar data
    console.log('Fetching earnings calendar data...');
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/earning_calendar`, 
      { params }
    );

    // Process the data without additional API calls if there are too many symbols
    const earningsData = response.data;
    
    // If we have a lot of earnings reports, skip additional API calls to avoid EMFILE errors
    if (earningsData.length > 100) {
      console.log(`Found ${earningsData.length} earnings reports. Skipping additional data enrichment to prevent EMFILE errors.`);
      
      // Just return the basic earnings data
      const processedData = earningsData.map(item => ({
        ...item,
        companyName: item.company || "",
        sector: "N/A", // We don't have this data without additional API calls
        volume: 0,     // We don't have this data without additional API calls
        avgVolume: 0,  // We don't have this data without additional API calls
        marketCap: 0,  // We don't have this data without additional API calls
        time: item.time || "N/A",
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
      }));
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          earningsCalendar: processedData
        })
      };
    }
    
    // For smaller datasets, try to enhance with additional data
    console.log(`Found ${earningsData.length} earnings reports. Enriching with additional data.`);
    const enhancedData = await enhanceEarningsData(earningsData, apiKey);

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
        message: error.message,
        // Don't return full error details in production, but useful for debugging
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      })
    };
  }
};

// Helper function to process batches with limited concurrency
async function processBatchesWithLimits(batches, processBatch) {
  const results = [];
  
  // Process batches with limited concurrency
  for (let i = 0; i < batches.length; i += MAX_CONCURRENT_REQUESTS) {
    const currentBatch = batches.slice(i, i + MAX_CONCURRENT_REQUESTS);
    const batchResults = await Promise.all(currentBatch.map(processBatch));
    results.push(...batchResults);
    
    // Add a small delay between batch groups to prevent overwhelming the API
    if (i + MAX_CONCURRENT_REQUESTS < batches.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }
  
  return results;
}

async function enhanceEarningsData(earningsData, apiKey) {
  try {
    // Get unique symbols from earnings data
    const symbols = [...new Set(earningsData.map(item => item.symbol))];
    
    // Batch the symbols into smaller groups to avoid EMFILE errors
    const batches = [];
    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      batches.push(symbols.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Processing ${symbols.length} unique symbols in ${batches.length} batches of ${BATCH_SIZE}`);
    
    // Get additional data for all companies in batches
    const profileData = {};
    const quoteData = {};
    
    // Process profile data
    await processBatchesWithLimits(batches, async (batch) => {
      const batchSymbols = batch.join(',');
      
      try {
        // Get company profiles (for sector, market cap, etc.)
        console.log(`Fetching profile data for batch: ${batchSymbols}`);
        const profileResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/profile/${batchSymbols}`,
          { params: { apikey: apiKey } }
        );
        
        // Map the data by symbol
        profileResponse.data.forEach(item => {
          profileData[item.symbol] = item;
        });
      } catch (error) {
        console.error(`Error fetching profile data for batch ${batchSymbols}:`, error.message);
        // Continue despite errors for individual batches
      }
    });
    
    // Process quote data
    await processBatchesWithLimits(batches, async (batch) => {
      const batchSymbols = batch.join(',');
      
      try {
        // Get quote data (for volume information)
        console.log(`Fetching quote data for batch: ${batchSymbols}`);
        const quoteResponse = await axios.get(
          `https://financialmodelingprep.com/api/v3/quote/${batchSymbols}`,
          { params: { apikey: apiKey } }
        );
        
        // Map the data by symbol
        quoteResponse.data.forEach(item => {
          quoteData[item.symbol] = item;
        });
      } catch (error) {
        console.error(`Error fetching quote data for batch ${batchSymbols}:`, error.message);
        // Continue despite errors for individual batches
      }
    });
    
    console.log(`Successfully fetched additional data for ${Object.keys(profileData).length} profiles and ${Object.keys(quoteData).length} quotes`);
    
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
  } catch (error) {
    console.error('Error in enhanceEarningsData:', error);
    // Return the original data if enhancement fails
    return earningsData.map(item => ({
      ...item,
      companyName: item.company || "",
      volume: 0,
      avgVolume: 0,
      marketCap: 0,
      sector: "N/A",
      time: item.time || "N/A",
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
    }));
  }
}
