const {
  getCerts,
  servers: { tls: createTlsServer }
} = require('../index.js');

function startTlsServer(port = 8004, hostOrCerts = '127.0.0.1', customHandler) {
  const certs = getCerts();
  let portNum = typeof port === 'number' ? port : (port?.port || 8004);
  let host = '127.0.0.1';
  let handler = customHandler;

  if (typeof hostOrCerts === 'string') {
    host = hostOrCerts;
  } else if (typeof hostOrCerts === 'object' && hostOrCerts !== null) {
    if (!hostOrCerts.key) {
      handler = hostOrCerts;
    }
  }

  const server_tls = createTlsServer(
    {
      port: portNum,
      host: host,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    },
    handler || (async (requestData, socket, server, packet) => {
      console.log('[TLS Server] Received incoming request payload:', requestData);

      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {
          success: true,
          server: 'TLS Target Server',
          message: 'Hello from TLS Server via createTlsServer!',
          timestamp: new Date().toISOString(),
          received: requestData
        }
      };
    })
  );

  console.log(`[TLS Server] Running securely on tls://${host}:${portNum}`);
  return server_tls;
}

if (require.main === module) {
  startTlsServer();
}

module.exports = {
  startTlsServer
};