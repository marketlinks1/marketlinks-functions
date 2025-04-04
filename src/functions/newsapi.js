// netlify/functions/benzinga-news.js

const axios = require('axios');

exports.handler = async function(event, context) {
  // CORS headers to allow your Webflow site to access this function
  const headers = {
    'Access-Control-Allow-Origin': '*', // For development, restrict to your domain in production
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle OPTIONS request (preflight request)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Get query parameters from the request
  const params = event.queryStringParameters || {};
  const ticker = params.ticker || '';
  
  // Your Benzinga API key (consider using environment variables for security)
  const API_KEY = '5530b66d78d244cb9d9517a9442c199d';
  
  try {
    // Construct the API URL
    let apiUrl = `https://api.benzinga.com/api/v2/news`;
    
    // Build query parameters
    const queryParams = new URLSearchParams({
      token: API_KEY,
      pageSize: params.pageSize || '10',
      displayOutput: 'full',
      sortBy: 'date',
      sortDirection: 'desc'
    });
    
    // Add ticker filter if provided
    if (ticker) {
      queryParams.append('tickers', ticker);
    }
    
    // Make the API request
    const response = await axios.get(`${apiUrl}?${queryParams.toString()}`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Return the API response
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(response.data)
    };
  } catch (error) {
    console.error('Benzinga API Error:', error);
    
    // Return error details
    return {
      statusCode: error.response?.status || 500,
      headers,
      body: JSON.stringify({
        error: error.message,
        details: error.response?.data || 'No additional details available'
      })
    };
  }
};
