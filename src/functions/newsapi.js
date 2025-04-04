// netlify/functions/benzinga-bull-bear.js

const https = require('https');

exports.handler = async function(event, context) {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*', // In production, restrict to your domain
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Get query parameters
  const params = event.queryStringParameters || {};
  const ticker = params.ticker || '';
  
  // Your Benzinga API key (best stored as an environment variable)
  const API_KEY = process.env.BENZINGA_API_KEY || '5530b66d78d244cb9d9517a9442c199d';

  if (!ticker) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Ticker symbol is required' })
    };
  }

  try {
    // Construct the API URL for bull/bear cases
    const queryString = `token=${API_KEY}&symbols=${ticker}`;
    
    // Make the API request using native https module
    const data = await makeRequest('api.benzinga.com', `/api/v1/bulls_bears_say?${queryString}`);
    
    return {
      statusCode: 200,
      headers,
      body: data
    };
  } catch (error) {
    console.error('Error fetching bull/bear data:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Failed to fetch bull/bear data', 
        details: error.message 
      })
    };
  }
};

// Helper function to make HTTP requests without external dependencies
function makeRequest(host, path) {
  return new Promise((resolve, reject) => {
    const options = {
      host,
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`Request failed with status code ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}
