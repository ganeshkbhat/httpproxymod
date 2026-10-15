const { proxyToProtocol: genericProxyToProtocol, clients: { tls: tlsProtocolClientHandler }, createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 41211;
const TARGET_PORT = 9002;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return genericProxyToProtocol(httpRequestDetails, { ...customHandlers, port: customHandlers.port || TARGET_PORT }, tlsProtocolClientHandler);
}

const requestHandler = (req, res, httpRequestDetails) => {
  console.log(`[HTTP SERVER EVENT] Incoming HTTP request received: ${req.method} ${req.url}`);
  const reqDetails = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
  
  (async () => {
    try {
      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
      const status = targetResponse.status || 200;
      const headers = targetResponse.headers || { 'content-type': 'application/json' };
      const responseBody = typeof targetResponse.body === 'object' && targetResponse.body !== null
        ? JSON.stringify(targetResponse.body)
        : (targetResponse.body || '');

      res.writeHead(status, headers);
      res.end(responseBody);
      console.log(`[HTTP SERVER EVENT] Response successfully sent to client with status ${status}`);
    } catch (err) {
      console.error('[HTTP SERVER ERROR] Request handler exception:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  })();
};

function startProxyServer() {
  const certs = getOrGenerateSelfSignedCert();
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT,
    useHttps: true,
    key: certs.key,
    cert: certs.cert
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[PROXY SERVER ERROR] HTTPS server error: ${err.message}`);
  });

  console.log(`[PROXY SERVER] HTTPS Proxy Server successfully listening on port ${PROXY_PORT}`);

  return {
    server: proxyServer,
    close: (callback) => {
      console.log('[PROXY SERVER] Closing HTTPS proxy server...');
      proxyServer.close(callback);
    }
  };
}

if (require.main === module) {
  try {
    startProxyServer();
  } catch (err) {
    console.error('[TLS Proxy Startup Error]:', err);
  }
}

module.exports = { proxyToProtocol, startProxyServer };