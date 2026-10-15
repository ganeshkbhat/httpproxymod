const { clients } = require('../index.js');

/**
 * UDP Client Demo for UDP-to-HTTP Reverse Proxy
 */
async function runUdpToHttpClientDemo() {
  // Connect to the UDP-to-HTTP proxy server running on port 41210
  const client = clients.udp({
    host: '127.0.0.1',
    port: 41210
  });

  try {
    console.log('[UDP Client] Sending HTTP request payload through UDP-to-HTTP proxy...');
    
    const requestDetails = {
      url: '/api/v1/test-http-proxy',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': 'udp-to-http-client'
      },
      body: JSON.stringify({
        message: 'Hello through UDP-to-HTTP reverse proxy!',
        timestamp: Date.now()
      })
    };

    // Send the request payload with a 5-second timeout
    const response = await client.sendProtocolRequestPayload(requestDetails, 5000);
    
    console.log('[UDP Client] Response received from HTTP target server:');
    console.log(JSON.stringify(response, null, 2));

    if (response && response.body) {
      const parsedBody = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      console.log('[UDP Client] Parsed Response Body:', parsedBody);
    }
  } catch (err) {
    console.error('[UDP Client] Request failed:', err.message);
  } finally {
    client.close();
    console.log('[UDP Client] Client socket closed.');
  }
}

if (require.main === module) {
  runUdpToHttpClientDemo();
}

module.exports = { runUdpToHttpClientDemo };