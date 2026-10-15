const { clients } = require('../index.js');

/**
 * UDP Client Request Demo for UDP-to-WS Proxy
 */
async function runUdpClientDemo() {
  // Connect to the UDP-to-WS proxy server running on port 41210
  const client = clients.udp({
    host: '127.0.0.1',
    port: 41210
  });

  try {
    console.log('[UDP Client] Sending request payload to UDP-to-WS proxy...');
    
    const requestDetails = {
      url: '/api/v1/ws-echo',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': 'demo-udp-to-ws-client'
      },
      body: JSON.stringify({
        message: 'Hello through UDP-to-WebSocket reverse proxy!',
        timestamp: Date.now()
      })
    };

    // Send the request payload with a 5-second timeout
    const response = await client.sendProtocolRequestPayload(requestDetails, 5000);
    
    console.log('[UDP Client] Response received:');
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
  runUdpClientDemo();
}

module.exports = { runUdpClientDemo };