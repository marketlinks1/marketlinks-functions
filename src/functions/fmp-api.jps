// functions/fmp-proxy.js
const axios = require('axios');

exports.handler = async function(event, context) {
  try {
    // Get the FMP API key from environment variables
    const apiKey = process.env.FMP_API_KEY;
    
    // Get the endpoint path from the request
    const { endpoint } = JSON.parse(event.body);
    
    // Make the request to FMP using the stable endpoint
    const response = await axios.get(`https://financialmodelingprep.com/stable/${endpoint}&apikey=${apiKey}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify(response.data)
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}
