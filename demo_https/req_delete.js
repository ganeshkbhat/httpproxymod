const { sendHttpRequest } = require('../index');

async function sendDeleteRequest() {
  const targetUrl = 'https://127.0.0.1:41210/delete-resource';
  console.log(`[DELETE Request] Sending DELETE request to ${targetUrl}...`);

  try {
    const response = await sendHttpRequest({
      targetUrl: targetUrl,
      method: 'DELETE',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'delete-client'
      },
      rejectUnauthorized: false
    });

    console.log('[DELETE Request] Status:', response.statusCode);
    console.log('[DELETE Request] Headers:', response.headers);
    console.log('[DELETE Request] Body:', response.body);
  } catch (err) {
    console.error('[DELETE Request] Failed:', err.message);
  }
}

if (require.main === module) {
  sendDeleteRequest();
}

module.exports = { sendDeleteRequest };