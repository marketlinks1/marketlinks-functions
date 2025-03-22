// ai-earnings.js - Fixed function for next quarter earnings
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
    // 1. Get historical earnings data first
    const earningsUrl = `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbolToUse}?apikey=${apiKey}`;
    
    const earningsResponse = await fetch(earningsUrl);
    
    if (!earningsResponse.ok) {
      console.error(`Historical earnings calendar API request failed with status ${earningsResponse.status}`);
      return {
        statusCode: earningsResponse.status,
        body: JSON.stringify({ 
          error: `Financial API returned an error: ${earningsResponse.status}`,
          symbol: symbolToUse 
        })
      };
    }
    
    let historicalData = await earningsResponse.json();
    
    // If we have no data, try fallbacks
    if (!Array.isArray(historicalData) || historicalData.length === 0) {
      // Try earnings-surprises endpoint
      const surprisesUrl = `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`;
      const surprisesResponse = await fetch(surprisesUrl);
      
      if (surprisesResponse.ok) {
        const surprisesData = await surprisesResponse.json();
        if (Array.isArray(surprisesData) && surprisesData.length > 0) {
          historicalData = surprisesData.map(item => ({
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
      
      // If still no data, try income statement
      if (!historicalData || historicalData.length === 0) {
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
    
    // Filter data by period if needed and sort by date (newest first)
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
    }
    
    filteredData.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 2. Now try to get next quarter's estimate
    let nextQuarterData = null;
    
    // Get the most recent quarter data
    if (filteredData.length > 0 && period === 'quarterly') {
      const lastQuarterData = filteredData[0];
      const lastDate = new Date(lastQuarterData.date);
      
      // Calculate the fiscal quarter from the date
      const lastMonth = lastDate.getMonth();
      const lastQuarter = Math.floor(lastMonth / 3) + 1; // 1-4
      const lastYear = lastDate.getFullYear();
      
      // Calculate next quarter and year
      let nextQuarter = lastQuarter + 1;
      let nextYear = lastYear;
      if (nextQuarter > 4) {
        nextQuarter = 1;
        nextYear++;
      }
      
      // Format the next quarter's fiscal period
      const nextFiscalPeriod = `Q${nextQuarter} '${nextYear.toString().slice(2)}`;
      
      // Try to get analyst estimates for next quarter
      try {
        // First try earnings calendar for upcoming earnings
        const upcomingUrl = `https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${symbolToUse}&apikey=${apiKey}`;
        const upcomingResponse = await fetch(upcomingUrl);
        
        if (upcomingResponse.ok) {
          const upcomingData = await upcomingResponse.json();
          if (Array.isArray(upcomingData) && upcomingData.length > 0) {
            // Find the next quarter's data
            const now = new Date();
            const futureEarnings = upcomingData.filter(item => new Date(item.date) > now);
            
            if (futureEarnings.length > 0) {
              // Sort by date and take the closest upcoming one
              futureEarnings.sort((a, b) => new Date(a.date) - new Date(b.date));
              const nextEarnings = futureEarnings[0];
              
              // Get the quarter from the date
              const earningsDate = new Date(nextEarnings.date);
              const earningsQuarter = Math.floor(earningsDate.getMonth() / 3) + 1;
              const earningsYear = earningsDate.getFullYear();
              
              nextQuarterData = {
                date: nextEarnings.date,
                symbol: symbolToUse,
                fiscalPeriod: `Q${earningsQuarter} '${earningsYear.toString().slice(2)}`,
                estimatedEps: nextEarnings.epsEstimated,
                actualEps: null, // Not reported yet
                surprisePercentage: null,
                estimatedRevenue: null, // Often not provided
                actualRevenue: null, // Not reported yet
                isUpcoming: true
              };
            }
          }
        }
        
        // If we didn't find upcoming earnings, try analyst estimates
        if (!nextQuarterData) {
          const estimatesUrl = `https://financialmodelingprep.com/api/v3/analyst-estimates/${symbolToUse}?apikey=${apiKey}`;
          const estimatesResponse = await fetch(estimatesUrl);
          
          if (estimatesResponse.ok) {
            const estimatesData = await estimatesResponse.json();
            if (Array.isArray(estimatesData) && estimatesData.length > 0) {
              // Create a stub for the next quarter
              const expectedReportDate = new Date(lastDate);
              expectedReportDate.setMonth(expectedReportDate.getMonth() + 3);
              
              nextQuarterData = {
                date: expectedReportDate.toISOString().split('T')[0],
                symbol: symbolToUse,
                fiscalPeriod: nextFiscalPeriod,
                estimatedEps: null,
                actualEps: null,
                surprisePercentage: null,
                estimatedRevenue: null,
                actualRevenue: null,
                isUpcoming: true
              };
              
              // Try to find matching estimates from the response
              for (const estimate of estimatesData) {
                if (estimate.period === `Q${nextQuarter}` && estimate.year === nextYear) {
                  nextQuarterData.estimatedEps = estimate.epsAvg || estimate.epsEstimated;
                  nextQuarterData.estimatedRevenue = estimate.revenueAvg || estimate.estimatedRevenue;
                  break;
                }
              }
              
              // If we didn't find a specific match, use the first estimate as fallback
              if (nextQuarterData.estimatedEps === null && estimatesData[0]) {
                nextQuarterData.estimatedEps = estimatesData[0].epsAvg;
                nextQuarterData.estimatedRevenue = estimatesData[0].revenueAvg;
              }
            }
          }
        }
        
        // If we still don't have estimates, create a stub with the next fiscal period
        if (!nextQuarterData) {
          const expectedReportDate = new Date(lastDate);
          expectedReportDate.setMonth(expectedReportDate.getMonth() + 3);
          
          nextQuarterData = {
            date: expectedReportDate.toISOString().split('T')[0],
            symbol: symbolToUse,
            fiscalPeriod: nextFiscalPeriod,
            estimatedEps: null,
            actualEps: null,
            surprisePercentage: null,
            estimatedRevenue: null,
            actualRevenue: null,
            isUpcoming: true
          };
        }
      } catch (error) {
        console.error('Error fetching next quarter estimates:', error);
        // Continue without next quarter data
      }
    }
    
    // Take only the most recent 3 reports for historical data
    const recentData = filteredData.slice(0, 3);
    
    // Format the data consistently
    const formattedHistorical = recentData.map(item => {
      const date = new Date(item.date);
      const quarter = Math.floor((date.getMonth()) / 3) + 1;
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
    
    // Combine the data, with next quarter first if we have it
    const finalData = nextQuarterData 
      ? [nextQuarterData, ...formattedHistorical]
      : formattedHistorical;
    
    // Return the results
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
