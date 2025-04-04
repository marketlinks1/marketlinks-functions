// functions/benzinga-earnings.js
const axios = require('axios');

exports.handler = async function(event, context) {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'CORS preflight response' })
    };
  }

  // Get query parameters
  const params = event.queryStringParameters || {};
  const { symbol, period = 'quarterly' } = params;
  
  if (!symbol) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ 
        error: 'Missing required parameter: symbol',
        noData: true
      })
    };
  }

  try {
    // Get API key from environment variable
    const apiKey = process.env.BENZINGA_API_KEY;
    
    if (!apiKey) {
      console.error('BENZINGA_API_KEY environment variable is not set');
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          error: 'API configuration error',
          noData: true
        })
      };
    }

    // Determine the endpoint based on the period (quarterly vs annual)
    const isAnnual = period === 'annual';
    
    // Set up the Benzinga API request
    const apiUrl = 'https://api.benzinga.com/api/v2.1/calendar/earnings';
    const response = await axios.get(apiUrl, {
      params: {
        token: apiKey,
        parameters: JSON.stringify({
          symbols: symbol.toUpperCase(),
          // Add any additional parameters based on period
          ...(isAnnual ? { annualOnly: true } : {})
        })
      }
    });

    let earningsData = [];
    
    if (response.data && response.data.earnings) {
      // Benzinga returns an array of earnings reports
      earningsData = response.data.earnings
        // Filter by symbol to ensure we only get data for the requested ticker
        .filter(item => item.symbol === symbol.toUpperCase())
        // Sort by date, newest first
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        // Transform to match our expected format
        .map(item => ({
          fiscalPeriod: `${item.fiscalQuarter ? 'Q' + item.fiscalQuarter : ''} ${item.fiscalYear || ''}`.trim(),
          date: item.date,
          timeOfDay: item.timeOfDay || null,
          estimatedEps: item.eps?.estimate || null,
          actualEps: item.eps?.actual || null,
          epsEstimated: item.eps?.estimate || null,
          eps: item.eps?.actual || null,
          surprisePercentage: item.eps?.surprise_percent || null,
          estimatedRevenue: item.revenue?.estimate || null,
          actualRevenue: item.revenue?.actual || null, 
          revenueEstimated: item.revenue?.estimate || null,
          revenue: item.revenue?.actual || null,
          isUpcoming: item.date ? new Date(item.date) > new Date() : false
        }));
      
      // For upcoming earnings not yet in the release schedule, we may need to add another API call
      // to get the earnings calendar data, but this varies by data provider
    }

    // Handle no data case
    if (earningsData.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ 
          error: `No earnings data available for ${symbol}`,
          noData: true
        })
      };
    }

    // Return the formatted earnings data
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ earnings: earningsData })
    };
  } catch (error) {
    console.error('Error fetching earnings data:', error);
    
    // Handle different types of errors
    let errorMessage = 'Failed to fetch earnings data';
    let statusCode = 500;
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorMessage = `API Error: ${error.response.status} - ${error.response.statusText}`;
      statusCode = error.response.status;
      
      if (error.response.data && error.response.data.message) {
        errorMessage += ` - ${error.response.data.message}`;
      }
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage = 'No response received from API';
      statusCode = 503;
    } else {
      // Something happened in setting up the request that triggered an Error
      errorMessage = error.message;
    }
    
    return {
      statusCode,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        noData: statusCode === 404
      })
    };
  }
};
