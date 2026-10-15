const tls = require('tls');
const { servers: { https: createHttpServer }, certs: { getOrGenerateSelfSignedCert }, framing: { frameMessage, parseFrames } } = require('../index');

const PROXY_PORT = 41210;
const TARGET_PORT = 8004;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage || customHandlers.onData;
    const onError = customHandlers.onError;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    const socket = tls.connect({
      host: host,
      port: port,
      rejectUnauthorized: false
    }, () => {
      if (typeof onConnect === 'function') {
        onConnect(socket);
      }
      const packet = {
        method: httpRequestDetails.method,
        url: httpRequestDetails.url,
        headers: httpRequestDetails.headers,
        body: httpRequestDetails.body
      };
      socket.write(frameMessage(Buffer.from(JSON.stringify(packet))));
    });

    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      if (typeof onData === 'function') {
        onData(chunk, socket);
      }
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
        try {
          const parsed = JSON.parse(messageBuffer.toString('utf-8'));
          if (typeof onMessage === 'function') {
            onMessage(parsed, socket);
          }
          socket.end();
          resolve(parsed);
        } catch (err) {
          if (typeof onError === 'function') {
            onError(err, socket);
          }
          reject(err);
        }
      });
    });

    socket.on('error', (err) => {
      if (typeof onError === 'function') {
        onError(err, socket);
      }
      socket.destroy();
      reject(err);
    });
  });
}

const requestHandler = (req, res, httpRequestDetails) => {
  const reqDetails = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
  reqDetails.customHandlers = req.customHandlers || {};
  
  (async () => {
    try {
      const targetResponse = await proxyToProtocol(reqDetails, reqDetails.customHandlers);
      const status = targetResponse.status || 200;
      const headers = targetResponse.headers || {};
      const responseBody = typeof targetResponse.body === 'object' && targetResponse.body !== null
        ? JSON.stringify(targetResponse.body)
        : (targetResponse.body || '');

      res.writeHead(status, headers);
      res.end(responseBody);
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
      console.warn(`[TLS Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[TLS Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  } catch (err) {
    console.warn(`[TLS Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT,
    useHttps: false
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[TLS Proxy] HTTP Fallback Gateway error: ${err.message}`);
  });

  console.log(`[TLS Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol };