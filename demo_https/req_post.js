const { helpers: { sendHttpRequest } } = require('../index');

async function sendPostRequest() {
  const targetUrl = 'https://127.0.0.1:41211/post-resource';
  console.log(`[POST Request] Sending POST request to ${targetUrl}...`);

  const payload = {
    action: 'create',
    data: { name: 'test item', value: 42 }
  };

  try {
    const response = await sendHttpRequest({
      targetUrl: targetUrl,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'post-client'
      },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    console.log('[POST Request] Status:', response.statusCode);
    console.log('[POST Request] Headers:', response.headers);
    console.log('[POST Request] Body:', response.body);
  } catch (err) {
    console.error('[POST Request] Failed:', err.message);
  }
}

if (require.main === module) {
  sendPostRequest();
}

module.exports = { sendPostRequest };