const { clients } = require('../index.js');

/**
 * Simple UDP Client Test Script
 * Sends the message "hello server this is client" to a target UDP server/proxy.
 */
async function runSimpleUdpClient() {
  const targetHost = '127.0.0.1';
  const targetPort = 41210;

  console.log(`[Simple UDP Client] Initializing UDP client targeting ${targetHost}:${targetPort}...`);

  // Initialize the UDP client using clients.udp from the framework
  const client = clients.udp({
    host: targetHost,
    port: targetPort
  }, (response) => {
    return response;
  });

  // Construct the request payload containing the required message line
  const requestPayload = {
    url: '/',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-client-purpose': 'testing'
    },
    body: '{"message": "hello server this is client"}'
  };

  try {
    console.log('[Simple UDP Client] Sending payload: "hello server this is client"...');
    const result = await client.sendProtocolRequestPayload(requestPayload, 5000);
    
    console.log('[Simple UDP Client] Response received successfully:');
    console.log(JSON.stringify(result, null, 2));

    if (result && result.body) {
      const parsedBody = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
      console.log('[Simple UDP Client] Parsed Body:', parsedBody);
    }
  } catch (err) {
    console.error('[Simple UDP Client] Request failed:', err.message);
  } finally {
    client.close();
    console.log('[Simple UDP Client] Client socket closed.');
  }
}

if (require.main === module) {
  runSimpleUdpClient();
}

module.exports = { runSimpleUdpClient };