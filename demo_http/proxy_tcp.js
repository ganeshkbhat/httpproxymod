const { clients: { tcp: createTcpClient }, servers: { http: createHttpServer }, certs: { getOrGenerateSelfSignedCert } } = require('../index');

const PROXY_PORT = 41210;
const TARGET_PORT = 8003;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage || customHandlers.onData;
    const onError = customHandlers.onError;

    const tcpClient = createTcpClient({ host: '127.0.0.1', port: TARGET_PORT }, (responsePacket, socket) => {
      if (typeof onMessage === 'function') {
        onMessage(responsePacket, socket);
      }
      if (typeof onData === 'function') {
        onData(responsePacket, socket);
      }
      return responsePacket;
    });

    if (typeof onConnect === 'function') {
      onConnect(tcpClient.socket || tcpClient);
    }

    tcpClient.sendProtocolRequestPayload(httpRequestDetails)
      .then((response) => {
        tcpClient.close();
        resolve(response);
      })
      .catch((err) => {
        if (typeof onError === 'function') {
          onError(err, tcpClient.socket || tcpClient);
        }
        tcpClient.close();
        reject(err);
      });
  });
}

const requestHandler = (req, res, httpRequestDetails) => {
  const reqDetails = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
  (async () => {
    try {
      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
      res.writeHead(targetResponse.status || 200, targetResponse.headers || {});
      res.end(typeof targetResponse.body === 'string' ? targetResponse.body : JSON.stringify(targetResponse.body));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  })();
};

function startProxyServer() {
  try {
    const certs = getOrGenerateSelfSignedCert();
    const { server: proxyServer } = createHttpServer({
      port: PROXY_PORT,
      useHttps: true,
      key: certs.key,
      cert: certs.cert
    }, requestHandler);

    proxyServer.on('error', (err) => {
      console.warn(`[TCP Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[TCP Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  } catch (err) {
    console.warn(`[TCP Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT,
    useHttps: false
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[TCP Proxy] HTTP Fallback server error: ${err.message}`);
  });

  console.log(`[TCP Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol };