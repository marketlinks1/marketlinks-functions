// ai-earnings.js - Fetch historical and next quarter's earnings
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
    // 1. First, get historical earnings data
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
    
    let historicalData = await calendarResponse.json();
    
    if (!Array.isArray(historicalData) || historicalData.length === 0) {
      console.log(`No data returned from historical earnings calendar API for symbol ${symbolToUse}`);
      
      // Try fallback to earnings-surprises endpoint
      console.log('Trying fallback to earnings-surprises endpoint');
      const fallbackUrl = `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`;
      const fallbackResponse = await fetch(fallbackUrl);
      
      if (fallbackResponse.ok) {
        const fallbackData = await fallbackResponse.json();
        if (Array.isArray(fallbackData) && fallbackData.length > 0) {
          historicalData = fallbackData.map(item => ({
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
      if (!historicalData || historicalData.length === 0) {
        console.log('Trying fallback to income statement endpoint');
        const incomeUrl = `https://financialmodelingprep.com/api/v3/income-statement/${symbolToUse}?period=${period === 'annual' ? 'annual' : 'quarter'}&limit=4&apikey=${apiKey}`;
        const incomeResponse = await fetch(incomeUrl);
        
        if (incomeResponse.ok) {
          const incomeData = await incomeResponse.json();
          if (Array.isArray(incomeData) && incomeData.length > 0) {
            historicalData = incomeData.map(item => ({
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
    
    // If we still have no historical data after all fallbacks
    if (!historicalData || historicalData.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ 
          error: `No earnings data found for symbol: ${symbolToUse}`,
          symbol: symbolToUse,
          noData: true
        })
      };
    }
    
    // Sort historical data by date, newest first
    historicalData.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 2. Now get analysts' estimate data for upcoming quarters
    let nextQuarterData = null;
    try {
      const estimatesUrl = `https://financialmodelingprep.com/api/v3/analyst-estimates/${symbolToUse}?apikey=${apiKey}`;
      const estimatesResponse = await fetch(estimatesUrl);
      
      if (estimatesResponse.ok) {
        const estimatesData = await estimatesResponse.json();
        
        if (Array.isArray(estimatesData) && estimatesData.length > 0) {
          // Get the most recent reported quarter/year from historical data
          const lastReportDate = new Date(historicalData[0].date);
          const lastReportYear = lastReportDate.getFullYear();
          const lastReportQuarter = Math.floor((lastReportDate.getMonth() + 3) / 3);
          
          // Determine next quarter and year
          let nextQuarter = lastReportQuarter + 1;
          let nextYear = lastReportYear;
          if (nextQuarter > 4) {
            nextQuarter = 1;
            nextYear++;
          }
          
          // Create a data structure for the next quarter's estimate
          nextQuarterData = {
            date: new Date(nextYear, (nextQuarter - 1) * 3, 15).toISOString().split('T')[0], // Approximation
            symbol: symbolToUse,
            fiscalPeriod: `Q${nextQuarter} '${nextYear.toString().slice(2)}`,
            estimatedEps: null,
            actualEps: null,
            surprisePercentage: null,
            estimatedRevenue: null,
            actualRevenue: null,
            isUpcoming: true
          };
          
          // Look for matching quarter estimate in the estimates data
          const estimate = estimatesData.find(est => {
            const estDate = new Date(est.date);
            const estYear = estDate.getFullYear();
            const estQuarter = est.period ? parseInt(est.period.replace('Q', '')) : Math.floor((estDate.getMonth() + 3) / 3);
            return estYear === nextYear && estQuarter === nextQuarter;
          });
          
          if (estimate) {
            nextQuarterData.estimatedEps = estimate.estimatedEpsAvg || estimate.epsAvg || estimate.epsEstimated;
            nextQuarterData.estimatedRevenue = estimate.estimatedRevenueAvg || estimate.revenueAvg || estimate.estimatedRevenue;
          } else {
            // If we can't find a specific quarter estimate, check the analyst estimates endpoint
            const analystUrl = `https://financialmodelingprep.com/api/v3/analyst-estimates/${symbolToUse}?apikey=${apiKey}`;
            const analystResponse = await fetch(analystUrl);
            
            if (analystResponse.ok) {
              const analystData = await analystResponse.json();
              if (Array.isArray(analystData) && analystData.length > 0) {
                // Take the first/most recent estimate
                const latestEstimate = analystData[0];
                nextQuarterData.estimatedEps = latestEstimate.epsAvg;
                nextQuarterData.estimatedRevenue = latestEstimate.revenueAvg;
              }
            }
          }
        }
      }
    } catch (error) {
      console.log('Error fetching next quarter estimates, continuing without them:', error);
      // Continue without next quarter data
    }
    
    // Filter historical data by period if requested
    let filteredData = historicalData;
    if (period === 'annual') {
      // For annual, group by year and take the last report of each year
      const yearGroups = {};
      historicalData.forEach(item => {
        const year = new Date(item.date).getFullYear();
        if (!yearGroups[year] || new Date(item.date) > new Date(yearGroups[year].date)) {
          yearGroups[year] = item;
        }
      });
      filteredData = Object.values(yearGroups);
      // Sort by date, newest first
      filteredData.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    
    // Take only the most recent 3 reports
    const recentData = filteredData.slice(0, 3);
    
    // Map to a consistent format
    const formattedHistorical = recentData.map(item => {
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
    
    // Add next quarter data if available
    const finalData = nextQuarterData 
      ? [nextQuarterData, ...formattedHistorical]  // Put next quarter first
      : formattedHistorical;
    
    // Add the symbol to the response in case it was detected from path/referer
    const responseData = {
      symbol: symbolToUse,
      period: period,
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
