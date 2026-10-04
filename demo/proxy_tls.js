const tls = require('tls');
const { createHttpServer } = require('../index');
const { generateSelfSignedCert } = require('../index');
const { frameMessage, parseFrames } = require('../index');

const PROXY_PORT = 8003;
const TARGET_PORT = 9003;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    const socket = tls.connect({
      host: host,
      port: port,
      rejectUnauthorized: false
    }, () => {
      if (typeof onConnect === 'function') onConnect(socket);
      const framedPayload = frameMessage(Buffer.from(JSON.stringify(httpRequestDetails)));
      socket.write(framedPayload);
    });

    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      if (typeof onData === 'function') onData(chunk, socket);
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
        try {
          const responseData = JSON.parse(messageBuffer.toString('utf-8'));
          if (typeof onMessage === 'function') onMessage(responseData, socket);
          socket.destroy();
          resolve(responseData);
        } catch (err) {
          if (typeof onError === 'function') onError(err, socket);
          socket.destroy();
          reject(err);
        }
      });
    });

    socket.on('end', () => {
      if (typeof onEnd === 'function') onEnd(socket);
    });

    socket.on('error', (err) => {
      if (typeof onError === 'function') onError(err, socket);
      reject(err);
    });
  });
}

const requestHandler = (req, res) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', async () => {
    const reqDetails = { method: req.method, url: req.url, headers: req.headers, body };
    try {
      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
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
  });
};

function startProxyServer() {
  try {
    const certs = generateSelfSignedCert();
    const { server: proxyServer } = createHttpServer({
      port: PROXY_PORT,
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
    port: PROXY_PORT
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