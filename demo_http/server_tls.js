const { servers: { tls: createTlsServer }, certs: { getOrGenerateSelfSignedCert } } = require('../index');

const PORT = 8004;

function startTlsServer() {
  const certs = getOrGenerateSelfSignedCert();
  
  const server = createTlsServer({
    port: PORT,
    key: certs.key,
    cert: certs.cert,
    rejectUnauthorized: false
  }, (data) => {
    console.log('[TLS Server] Received data:', data);
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { tlsSecure: true, path: data.url }
    };
  });

  console.log(`[TLS Target Server] Listening on 127.0.0.1:${PORT}`);
  return server;
}

if (require.main === module) {
  startTlsServer();
}

module.exports = { createTlsServer: startTlsServer };