// ai-earnings.js - Corrected to show historical data + next quarter
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
    // 1. Get historical earnings data first - trying multiple endpoints
    let historicalData = [];
    
    // Try multiple endpoints to get the most complete historical data
    const endpoints = [
      // Historical earnings calendar - best source
      {
        url: `https://financialmodelingprep.com/api/v3/historical/earning_calendar/${symbolToUse}?apikey=${apiKey}`,
        mapper: (item) => ({
          date: item.date,
          symbol: symbolToUse,
          eps: item.eps,
          epsEstimated: item.epsEstimated,
          revenue: item.revenue,
          revenueEstimated: item.revenueEstimated,
          surprisePercentage: item.surprisePercentage
        })
      },
      // Earnings surprises - good fallback
      {
        url: `https://financialmodelingprep.com/api/v3/earnings-surprises/${symbolToUse}?apikey=${apiKey}`,
        mapper: (item) => ({
          date: item.date,
          symbol: symbolToUse,
          eps: item.actualEps,
          epsEstimated: item.estimatedEps,
          revenue: item.actualRevenue,
          revenueEstimated: item.estimatedRevenue,
          surprisePercentage: item.surprisePercentage
        })
      },
      // Income statement - last resort
      {
        url: `https://financialmodelingprep.com/api/v3/income-statement/${symbolToUse}?period=${period === 'annual' ? 'annual' : 'quarter'}&limit=10&apikey=${apiKey}`,
        mapper: (item) => ({
          date: item.date,
          symbol: symbolToUse,
          eps: item.eps,
          epsEstimated: null,
          revenue: item.revenue,
          revenueEstimated: null,
          surprisePercentage: null
        })
      }
    ];
    
    // Try each endpoint until we get data
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint.url);
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data) && data.length > 0) {
            historicalData = data.map(endpoint.mapper);
            break;
          }
        }
      } catch (error) {
        console.error(`Error fetching from ${endpoint.url}:`, error);
        // Continue to next endpoint
      }
    }
    
    // If we still have no historical data after all attempts
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
    
    // Sort by date (newest first) and filter out future dates
    const now = new Date();
    historicalData = historicalData
      .filter(item => {
        const itemDate = new Date(item.date);
        return !isNaN(itemDate.getTime()) && itemDate <= now;
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // Create a processed data array with proper fiscal periods
    const processedHistorical = historicalData.map(item => {
      const date = new Date(item.date);
      const quarter = Math.floor((date.getMonth()) / 3) + 1;
      const year = date.getFullYear().toString().slice(2);
      
      return {
        date: item.date,
        symbol: symbolToUse,
        fiscalPeriod: period === 'annual' 
          ? `FY '${year}` 
          : `Q${quarter} '${year}`,
        estimatedEps: item.epsEstimated,
        actualEps: item.eps,
        surprisePercentage: item.surprisePercentage,
        estimatedRevenue: item.revenueEstimated,
        actualRevenue: item.revenue,
        isUpcoming: false
      };
    });
    
    // Get only the last 3 historical quarters
    const recentHistorical = processedHistorical.slice(0, 3);
    
    // 2. Now get the next upcoming quarter
    let nextQuarterData = null;
    
    if (period === 'quarterly' && recentHistorical.length > 0) {
      // Get the most recent quarter and year
      const lastQuarterData = recentHistorical[0];
      const lastDate = new Date(lastQuarterData.date);
      const lastQuarterMatch = lastQuarterData.fiscalPeriod.match(/Q(\d+)\s+'(\d+)/);
      
      if (lastQuarterMatch) {
        const lastQuarter = parseInt(lastQuarterMatch[1]);
        const lastYear = parseInt('20' + lastQuarterMatch[2]);
        
        // Calculate next quarter
        let nextQuarter = lastQuarter + 1;
        let nextYear = lastYear;
        if (nextQuarter > 4) {
          nextQuarter = 1;
          nextYear++;
        }
        
        // Create the next quarter's fiscal period
        const nextFiscalPeriod = `Q${nextQuarter} '${nextYear.toString().slice(2)}`;
        
        // Try to get analyst estimates for the next quarter
        try {
          // First check earnings calendar for upcoming earnings
          const calendarUrl = `https://financialmodelingprep.com/api/v3/earning_calendar?symbol=${symbolToUse}&apikey=${apiKey}`;
          const calendarResponse = await fetch(calendarUrl);
          
          if (calendarResponse.ok) {
            const calendarData = await calendarResponse.json();
            if (Array.isArray(calendarData) && calendarData.length > 0) {
              // Find future earnings dates
              const futureEarnings = calendarData.filter(item => new Date(item.date) > now);
              
              if (futureEarnings.length > 0) {
                // Sort by date and take the closest upcoming one
                futureEarnings.sort((a, b) => new Date(a.date) - new Date(b.date));
                const nextEarnings = futureEarnings[0];
                
                nextQuarterData = {
                  date: nextEarnings.date,
                  symbol: symbolToUse,
                  fiscalPeriod: nextFiscalPeriod,
                  estimatedEps: nextEarnings.epsEstimated,
                  actualEps: null,
                  surprisePercentage: null,
                  estimatedRevenue: null,
                  actualRevenue: null,
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
                // Create a placeholder for the next quarter
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
                estimatesData.forEach(estimate => {
                  // Check if this estimate matches our next quarter
                  if (estimate.period === `Q${nextQuarter}` || 
                      (estimate.period && estimate.period.includes(`${nextQuarter}`))) {
                    
                    nextQuarterData.estimatedEps = estimate.epsAvg || estimate.estimatedEps;
                    nextQuarterData.estimatedRevenue = estimate.revenueAvg || estimate.estimatedRevenue;
                  }
                });
                
                // If we couldn't find a specific estimate, use the nearest one
                if (nextQuarterData.estimatedEps === null && estimatesData.length > 0) {
                  nextQuarterData.estimatedEps = estimatesData[0].epsAvg;
                  nextQuarterData.estimatedRevenue = estimatesData[0].revenueAvg;
                }
              }
            }
          }
          
          // If we still don't have next quarter data, create a basic placeholder
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
          // Continue without next quarter data if it fails
        }
      }
    }
    
    // Combine the next quarter with historical data
    const finalData = nextQuarterData 
      ? [nextQuarterData, ...recentHistorical]
      : recentHistorical;
    
    // Return the combined data
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
