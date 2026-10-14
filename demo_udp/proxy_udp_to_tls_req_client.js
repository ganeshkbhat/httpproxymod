const {
  clients: { udp: createUdpClient }
} = require('../index.js');

function runUdpClientDemo(proxyPort = 41234, proxyHost = '127.0.0.1', genericClientHandler) {
  let port = 41234;
  let host = '127.0.0.1';
  let handler = genericClientHandler;

  if (typeof proxyPort === 'object' && proxyPort !== null) {
    port = proxyPort.port || proxyPort.udpPort || 41234;
    host = proxyPort.host || proxyPort.proxyHost || '127.0.0.1';
    if (typeof proxyHost === 'object') {
      handler = proxyHost;
    }
  } else {
    if (proxyPort !== undefined) port = proxyPort;
    if (proxyHost !== undefined) {
      if (typeof proxyHost === 'string') host = proxyHost;
      else if (typeof proxyHost === 'object') handler = proxyHost;
    }
  }

  const udpClient = createUdpClient({
    host: host,
    port: port
  }, handler || ((result) => result));

  if (require.main === module) {
    const requestPayload = {
      url: '/api/v1/secure-action',
      method: 'POST',
      headers: {
        'x-client-origin': 'udp-client-script',
        'content-type': 'application/json'
      },
      body: {
        action: 'ping',
        data: 'Encrypted transmission test through UDP-to-TLS bridge'
      }
    };

    console.log('[UDP Client] Dispatching request payload to proxy...');

    udpClient.sendHttpRequestPayload(requestPayload, 5000)
      .then((response) => {
        console.log('[UDP Client] Response received successfully:');
        console.log(JSON.stringify(response, null, 2));
      })
      .catch((err) => {
        console.error('[UDP Client] Request failed or timed out:', err.message);
      })
      .finally(() => {
        udpClient.close();
      });
  }

  return udpClient;
}

if (require.main === module) {
  const UDP_PORT = process.env.UDP_PORT ? parseInt(process.env.UDP_PORT, 10) : 41234;
  const PROXY_HOST = process.env.PROXY_HOST || '127.0.0.1';

  runUdpClientDemo(UDP_PORT, PROXY_HOST);
}

module.exports = {
  runUdpClientDemo
};