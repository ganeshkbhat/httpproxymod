const { sendHttpRequest } = require('../index');

async function sendPatchRequest() {
  const targetUrl = 'https://127.0.0.1:41211/patch-resource';
  console.log(`[PATCH Request] Sending PATCH request to ${targetUrl}...`);

  const payload = {
    data: { value: 75 }
  };

  try {
    const response = await sendHttpRequest({
      targetUrl: targetUrl,
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-client-name': 'patch-client'
      },
      body: JSON.stringify(payload),
      rejectUnauthorized: false
    });

    console.log('[PATCH Request] Status:', response.statusCode);
    console.log('[PATCH Request] Headers:', response.headers);
    console.log('[PATCH Request] Body:', response.body);
  } catch (err) {
    console.error('[PATCH Request] Failed:', err.message);
  }
}

if (require.main === module) {
  sendPatchRequest();
}

module.exports = { sendPatchRequest };