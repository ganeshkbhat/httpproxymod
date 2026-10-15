const { clients } = require('../index.js');

/**
 * Generic UDP Client Request Demo
 */
async function runUdpClientDemo() {
  // Connect to the UDP-to-UDP proxy server running on port 41210
  const client = clients.udp({
    host: '127.0.0.1',
    port: 41210
  });

  try {
    console.log('[UDP Client] Sending request payload to proxy...');
    
    const requestDetails = {
      url: '/api/v1/udp-echo',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-client-id': 'demo-udp-client'
      },
      body: JSON.stringify({
        message: 'Hello through UDP-to-UDP reverse proxy!',
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