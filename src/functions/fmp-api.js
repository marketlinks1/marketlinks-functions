// functions/fmp-api.js
const axios = require('axios');

exports.handler = async function(event, context) {
  // For OPTIONS requests (CORS preflight)
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
    
    // Get the endpoint path and parameters from the request
    let endpoint, symbol;
    try {
      const body = JSON.parse(event.body);
      endpoint = body.endpoint;
      symbol = body.symbol;
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
    
    // Check if endpoint is provided
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
    
    // Construct URL based on the correct format for the endpoint
    let url;
    
    if (endpoint === 'profile' && symbol) {
      // Special case for profile endpoint which uses query parameter
      url = `https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${apiKey}`;
    } else {
      // Default case for other endpoints
      url = `https://financialmodelingprep.com/stable/${endpoint}?apikey=${apiKey}`;
      
      // If symbol is provided, add it to the URL
      if (symbol) {
        url = url.replace('?', `?symbol=${symbol}&`);
      }
    }
    
    console.log(`Making request to: ${url}`); // For debugging
    
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
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Failed to fetch data from FMP API",
        details: error.message
      })
    };
  }
}
