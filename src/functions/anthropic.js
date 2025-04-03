// functions/anthropic.js
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
    // Get the Anthropic API key from environment variables
    const apiKey = process.env.ANTHROPIC_API_KEY;
    
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
    const { prompt, model } = params;
    
    if (!prompt) {
      return {
        statusCode: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ error: "Prompt parameter is required" })
      };
    }
    
    // Set default model if not provided
    const selectedModel = model || "claude-3-sonnet-20240229";
    
    // Prepare the request payload for Anthropic API
    const payload = {
      model: selectedModel,
      max_tokens: 4000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    };
    
    // Make the request to Anthropic API
    const response = await axios.post('https://api.anthropic.com/v1/messages', payload, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    
    // Extract the content from the first message in the response
    const content = response.data.content[0].text;
    
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ content })
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
        error: "Failed to fetch data from Anthropic API",
        details: error.message,
        response: error.response?.data
      })
    };
  }
}
