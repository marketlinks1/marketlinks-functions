// functions/fetch-api-key.js
exports.handler = async (event, context) => {
  // Get the API key from environment variables
  const apiKey = process.env.FMP_API_KEY;
  
  // Check if the API key exists
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "API key not found in environment variables" }),
      headers: {
        "Content-Type": "application/json"
      }
    };
  }
  
  // For security, we'll only return a masked version in production
  // This helps verify the key exists without exposing it
  const maskedKey = apiKey.substring(0, 4) + "..." + apiKey.substring(apiKey.length - 4);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ 
      message: "API key retrieved successfully", 
      maskedKey: maskedKey,
      keyLength: apiKey.length
    }),
    headers: {
      "Content-Type": "application/json"
    }
  };
};
