const { helpers: { sendHttpRequest } } = require('../index');

async function sendGetRequest() {
  const targetUrl = 'https://127.0.0.1:41211/get-resource';
  console.log(`[GET Request] Sending GET request to ${targetUrl}...`);

  try {
    const response = await sendHttpRequest({
      targetUrl: targetUrl,
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'get-client'
      },
      rejectUnauthorized: false
    });

    console.log('[GET Request] Status:', response.statusCode);
    console.log('[GET Request] Headers:', response.headers);
    console.log('[GET Request] Body:', response.body);
  } catch (err) {
    console.error('[GET Request] Failed:', err.message);
  }
}

if (require.main === module) {
  sendGetRequest();
}

module.exports = { sendGetRequest };