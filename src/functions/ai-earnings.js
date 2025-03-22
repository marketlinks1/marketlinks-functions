// ai-earnings.js - Using historical earnings calendar endpoint with styling improvements
const fetch = require('node-fetch');

exports.handler = async function(event, context) {
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
    return {
      statusCode: 400,
      body: JSON.stringify({ 
        error: "Symbol parameter is required. Please specify in URL parameters or path." 
      })
    };
  }
  
  console.log(`Processing earnings request for symbol: ${symbolToUse}, period: ${period}`);
  
  try {
    // First, check for upcoming earnings
    const upcomingUrl = `https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${symbolToUse}&apikey=${apiKey}`;
    let upcomingEarnings = null;
    
    try {
      const upcomingResponse = await fetch(upcomingUrl);
      if (upcomingResponse.ok) {
        const upcomingData = await upcomingResponse.json();
        // Filter for future dates
        const now = new Date();
        const futureEarnings = upcomingData.filter(item => new Date(item.date) > now);
        
        if (futureEarnings.length > 0) {
          // Sort by date and take the next upcoming one
          futureEarnings.sort((a, b) => new Date(a.date) - new Date(b.date));
          upcomingEarnings = futureEarnings[0];
          
          // Format the upcoming earnings data
          upcomingEarnings = {
            date: upcomingEarnings.date,
            symbol: symbolToUse,
            fiscalPeriod: `Q${upcomingEarnings.quarter} '${new Date(upcomingEarnings.date).getFullYear().toString().slice(2)}`,
            estimatedEps: upcomingEarnings.epsEstimated,
            actualEps: null, // Not reported yet
            surprisePercentage: null,
            estimatedRevenue: null, // Often not provided
            actualRevenue: null, // Not reported yet
            isUpcoming: true
          };
        }
      }
    } catch (error) {
      console.error('Error fetching upcoming earnings:', error);
      // Continue without upcoming data
    }
    
    // Use the historical earnings calendar endpoint
    const calendarUrl = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbolToUse}?apikey=${apiKey}`;
    
    const calendarResponse = await fetch(calendarUrl);
    
    if (!calendarResponse.ok) {
      console.error(`Historical earnings calendar API request failed with status ${calendarResponse.status}`);
      return {
        statusCode: calendarResponse.status,
        body: JSON.stringify({ 
          error: `Financial API returned an error: ${calendarResponse.status}`,
          symbol: symbolToUse 
        })
      };
    }
    
    let calendarData = await calendarResponse.json();
    
    if (!Array.isArray(calendarData) || calendarData.length === 0) {
      console.log(`No data returned from historical earnings calendar API for symbol ${symbolToUse}`);
      
      // Try fallback to earnings-surprises endpoint
      console.log('Trying fallback to earnings-surprises endpoint');
      const fallbackUrl = `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`;
      const fallbackResponse = await fetch(fallbackUrl);
      
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        if (Array.isArray(fallbackData) && fallbackData.length > 0) {
          calendarData = fallbackData.map(item => ({
            date: item.date,
            symbol: symbolToUse,
            eps: item.actualEps,
            epsEstimated: item.estimatedEps,
            revenue: item.actualRevenue || null,
            revenueEstimated: item.estimatedRevenue || null,
            surprisePercentage: item.surprisePercentage
          }));
        }
      }
      
      // If still no data, try income statement as a last resort
      if (!calendarData || calendarData.length === 0) {
        console.log('Trying fallback to income statement endpoint');
        const incomeUrl = `https://financialmodelingprep.com/api/v3/income-statement/${symbolToUse}?period=${period === 'annual' ? 'annual' : 'quarter'}&limit=4&apikey=${apiKey}`;
        const incomeResponse = await fetch(incomeUrl);
        
        if (incomeResponse.ok) {
          const incomeData = await incomeResponse.json();
          if (Array.isArray(incomeData) && incomeData.length > 0) {
            calendarData = incomeData.map(item => ({
              date: item.date,
              symbol: symbolToUse,
              eps: item.eps,
              epsEstimated: null,
              revenue: item.revenue,
              revenueEstimated: null,
              surprisePercentage: null
            }));
          }
        }
      }
    }
    
    // If we still have no data after all fallbacks
    if (!calendarData || calendarData.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: `No earnings data found for symbol: ${symbolToUse}`,
          symbol: symbolToUse,
          noData: true
        })
      };
    }
    
    // Filter by period if requested
    let filteredData = calendarData;
    if (period === 'annual') {
      // For annual, group by year and take the last report of each year
      const yearGroups = {};
      calendarData.forEach(item => {
        const year = new Date(item.date).getFullYear();
        if (!yearGroups[year] || new Date(item.date) > new Date(yearGroups[year].date)) {
          yearGroups[year] = item;
        }
      });
      filteredData = Object.values(yearGroups);
    }
    
    // Sort by date, newest first
    filteredData.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Take only the most recent 3 reports
    const recentData = filteredData.slice(0, 3);
    
    // Map to a consistent format
    const formattedData = recentData.map(item => {
      const date = new Date(item.date);
      const quarter = Math.floor((date.getMonth() + 3) / 3);
      const year = date.getFullYear().toString().slice(2);
      
      return {
        date: item.date,
        symbol: symbolToUse,
        fiscalPeriod: period === 'annual' 
          ? `FY ${date.getFullYear()}` 
          : `Q${quarter} '${year}`,
        estimatedEps: item.epsEstimated,
        actualEps: item.eps,
        surprisePercentage: item.surprisePercentage,
        estimatedRevenue: item.revenueEstimated,
        actualRevenue: item.revenue,
        isUpcoming: false
      };
    });
    
    // Add upcoming earnings if available
    const finalData = upcomingEarnings 
      ? [upcomingEarnings, ...formattedData]  // Put upcoming first
      : formattedData;
    
    // Add the symbol to the response in case it was detected from path/referer
    const responseData = {
      symbol: symbolToUse,
      period: period,
      source: 'historical_earning_calendar',
      earnings: finalData
    };
    
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
