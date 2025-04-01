// functions/fmp-api.js
const axios = require('axios');

exports.handler = async function(event, context) {
  // Handle CORS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: ""
    };
  }

  try {
    // Get the FMP API key from environment variables
    const apiKey = process.env.FMP_API_KEY;
    
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "API key is not configured" })
      };
    }
    
    // Parse the request body
    let params = {};
    try {
      params = JSON.parse(event.body);
    } catch (e) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Invalid request body" })
      };
    }
    
    // Extract required parameters
    const { endpoint } = params;
    
    if (!endpoint) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Endpoint parameter is required" })
      };
    }
    
    // Remove apikey from params if it's present (we'll add our own)
    const { apikey, ...queryParams } = params;
    
    // Construct the URL
    let url = `https://financialmodelingprep.com/stable/${endpoint}`;
    
    // Add query parameters
    const queryString = Object.entries(queryParams)
      .filter(([key]) => key !== 'endpoint')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    
    // Add the query string and API key
    if (queryString) {
      url = `${url}?${queryString}&apikey=${apiKey}`;
    } else {
      url = `${url}?apikey=${apiKey}`;
    }
    
    // Log the URL being requested (useful for debugging)
    console.log(`Making request to: ${url}`);
    
    // Make the request to FMP
    const response = await axios.get(url);
    
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(response.data)
    };
  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: error.response?.status || 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Failed to fetch data from FMP API",
        details: error.message,
        response: error.response?.data
      })
    };
  }
}
