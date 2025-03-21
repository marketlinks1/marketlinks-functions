// Netlify Function: earnings.js
// Place this in your netlify/functions folder

const axios = require('axios');

// Fixed batch size to prevent EMFILE errors (too many open files)
const BATCH_SIZE = 5; // Reduced from 25 to prevent hitting system limits
const MAX_CONCURRENT_REQUESTS = 3; // Limit concurrent requests
const MAX_RESULTS = 100; // Limit number of results to prevent response size exceeding 6MB

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
    const page = parseInt(queryParams.page || '1');
    const limit = parseInt(queryParams.limit || '50');
    const sortBy = queryParams.sortBy || 'volume';
    const sortDirection = queryParams.sortDirection || 'desc';
    const symbol = queryParams.symbol || '';
    const sector = queryParams.sector || '';
    
    // If no date range provided, use current week
    let fromDate = from;
    let toDate = to;
    
    if (!fromDate || !toDate) {
      const today = new Date();
      // Get Monday of current week
      const day = today.getDay();
      const diff = today.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(today.setDate(diff));
      // Get Sunday of current week
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      
      fromDate = monday.toISOString().split('T')[0];
      toDate = sunday.toISOString().split('T')[0];
      
      console.log(`No date range provided, using current week: ${fromDate} to ${toDate}`);
    }
    
    // Build request parameters
    const params = { apikey: apiKey };
    if (fromDate) params.from = fromDate;
    if (toDate) params.to = toDate;

    // Fetch earnings calendar data
    console.log('Fetching earnings calendar data...');
    const response = await axios.get(
      `https://financialmodelingprep.com/api/v3/earning_calendar`, 
      { params }
    );

    // Process the data without additional API calls to reduce load
    let earningsData = response.data;
    
    console.log(`Found ${earningsData.length} earnings reports.`);
    
    // Apply filters if provided
    if (symbol) {
      earningsData = earningsData.filter(item => 
        item.symbol.toLowerCase().includes(symbol.toLowerCase())
      );
    }
    
    // Basic preprocessing of data
    const processedData = earningsData.map(item => ({
      ...item,
      companyName: item.company || "",
      sector: "N/A", // Will be populated for the limited displayed items
      volume: 0,     // Will be populated for the limited displayed items
      avgVolume: 0,  // Will be populated for the limited displayed items
      marketCap: 0,  // Will be populated for the limited displayed items
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
    
    // Sort data based on parameters
    let sortedData = [...processedData];
    if (sortBy === 'volume') {
      // We'll sort by date as a default since we don't have volume data yet
      sortedData.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    } else if (sortBy === 'eps') {
      sortedData.sort((a, b) => {
        const epsA = a.eps?.estimate || 0;
        const epsB = b.eps?.estimate || 0;
        return sortDirection === 'asc' ? epsA - epsB : epsB - epsA;
      });
    } else {
      // Default sort by date
      sortedData.sort((a, b) => {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA;
      });
    }
    
    // Calculate total pages and limits for pagination
    const totalItems = sortedData.length;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    
    // Get the paginated data
    const paginatedData = sortedData.slice(startIndex, endIndex);
    
    // For the paginated subset, get additional data
    const enhancedPaginatedData = await enhanceEarningsData(paginatedData, apiKey, sector);
    
    // Get unique dates and sectors from the entire dataset (for filters)
    const uniqueDates = [...new Set(processedData.map(item => item.date))].filter(Boolean).sort();
    
    // Build metadata for pagination and filters
    const metadata = {
      pagination: {
        currentPage: page,
        totalPages: totalPages,
        totalItems: totalItems,
        itemsPerPage: limit
      },
      filters: {
        dates: uniqueDates.slice(0, 30) // Limit to prevent response size issues
      }
    };
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        earningsCalendar: enhancedPaginatedData,
        metadata: metadata
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

async function enhanceEarningsData(earningsData, apiKey, sectorFilter) {
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
    
    // Apply sector filter if provided
    let filteredData = earningsData;
    if (sectorFilter) {
      filteredData = earningsData.filter(item => {
        const profile = profileData[item.symbol] || {};
        return profile.sector === sectorFilter;
      });
    }
    
    // Enhance earnings data with profile and quote information
    return filteredData.map(item => {
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
