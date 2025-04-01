// functions/fmp-api.js
const axios = require('axios');

exports.handler = async function(event, context) {
  // For OPTIONS requests (CORS preflight)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "https://www.themarketlinks.com", // Or specify "https://www.themarketlinks.com"
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      },
      body: ""
    };
  }

  try {
    // Get the FMP API key from environment variables
    const apiKey = process.env.FMP_API_KEY;
    
    // Get the endpoint path from the request
    let endpoint;
    try {
      const body = JSON.parse(event.body);
      endpoint = body.endpoint;
    } catch (e) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "https://www.themarketlinks.com", // Or specify "https://www.themarketlinks.com"
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
          "Access-Control-Allow-Origin": "*", // Or specify "https://www.themarketlinks.com"
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Endpoint parameter is required" })
      };
    }
    
    // Add API key to the URL correctly
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `https://financialmodelingprep.com/stable/${endpoint}${separator}apikey=${apiKey}`;
    
    // Make the request to FMP
    const response = await axios.get(url);
    
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*", // Or specify "https://www.themarketlinks.com"
        "Content-Type": "application/json"
      },
      body: JSON.stringify(response.data)
    };
  } catch (error) {
    console.error('Error:', error);
    
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "https://www.themarketlinks.com", // Or specify "https://www.themarketlinks.com"
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Failed to fetch data from FMP API",
        details: error.message
      })
    };
  }
}
