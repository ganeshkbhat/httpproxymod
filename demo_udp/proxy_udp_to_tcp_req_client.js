const { clients } = require('../index.js');

/**
 * UDP Client that sends requests to the UDP-to-TCP Proxy Server.
 */
async function runUdpProxyClient() {
  const proxyHost = '127.0.0.1';
  const proxyPort = 41210;

  console.log(`[UDP Proxy Client] Connecting to UDP proxy at ${proxyHost}:${proxyPort}...`);

  const client = clients.udp({ host: proxyHost, port: proxyPort }, (response) => {
    return response;
  });

  const requestPayload = {
    protocol: 'tcp',
    url: '/test',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'ping', text: 'Hello via UDP-to-TCP reverse proxy!' })
  };

  try {
    console.log('[UDP Proxy Client] Sending request payload...');
    const result = await client.sendProtocolRequestPayload(requestPayload, 5000);
    console.log('[UDP Proxy Client] Received response:', result);
  } catch (err) {
    console.error('[UDP Proxy Client] Request failed:', err.message);
  } finally {
    client.close();
    console.log('[UDP Proxy Client] Client closed.');
  }
}

if (require.main === module) {
  runUdpProxyClient();
}

module.exports = { runUdpProxyClient };