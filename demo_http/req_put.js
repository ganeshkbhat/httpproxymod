const { sendHttpRequest } = require('../index');

async function sendPutRequest() {
  const targetUrl = 'https://127.0.0.1:41210/put-resource';
  console.log(`[PUT Request] Sending PUT request to ${targetUrl}...`);

  const payload = {
    action: 'update',
    data: { id: 1, name: 'updated item', value: 100 }
  };

  try {
    const response = await sendHttpRequest({
      targetUrl: targetUrl,
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'put-client'
      },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    console.log('[PUT Request] Status:', response.statusCode);
    console.log('[PUT Request] Headers:', response.headers);
    console.log('[PUT Request] Body:', response.body);
  } catch (err) {
    console.error('[PUT Request] Failed:', err.message);
  }
}

if (require.main === module) {
  sendPutRequest();
}

module.exports = { sendPutRequest };