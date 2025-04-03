const { Anthropic } = require('@anthropic-ai/sdk');

// Supported model configurations
const SUPPORTED_MODELS = [
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307'
];

exports.handler = async function(event, context) {
  // CORS Preflight Handling
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  // Validate HTTP Method
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Method Not Allowed", 
        supportedMethods: ["POST"] 
      })
    };
  }

  // API Key Validation
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Server Configuration Error", 
        details: "Anthropic API key is not configured" 
      })
    };
  }

  // Parse Request Body
  let requestBody;
  try {
    requestBody = JSON.parse(event.body);
  } catch (parseError) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Invalid Request", 
        details: "Unable to parse request body",
        message: parseError.message 
      })
    };
  }

  // Validate Required Fields
  const { 
    prompt, 
    model = 'claude-3-sonnet-20240229',  // Default model
    max_tokens = 4096,
    temperature = 0.7
  } = requestBody;

  // Validate Prompt
  if (!prompt) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Validation Error", 
        details: "Prompt is required" 
      })
    };
  }

  // Validate Model
  if (!SUPPORTED_MODELS.includes(model)) {
    return {
      statusCode: 400,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ 
        error: "Invalid Model", 
        supportedModels: SUPPORTED_MODELS,
        details: `Model '${model}' is not supported` 
      })
    };
  }

  // Initialize Anthropic Client
  const anthropic = new Anthropic({
    apiKey: apiKey
  });

  try {
    // Make API Call
    const response = await anthropic.messages.create({
      model: model,
      max_tokens: max_tokens,
      temperature: temperature,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    });

    // Extract and return content
    const aiResponse = response.content[0].text;

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: aiResponse,
        model: model,
        tokens_used: response.usage?.input_tokens || 0
      })
    };

  } catch (error) {
    // Comprehensive Error Logging
    console.error('Anthropic API Error:', {
      message: error.message,
      type: error.type,
      status: error.status,
      rawError: error
    });

    // Detailed Error Response
    return {
      statusCode: error.status || 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "API Request Failed",
        details: error.message,
        type: error.type || 'unknown_error',
        supportedModels: SUPPORTED_MODELS
      })
    };
  }
};
