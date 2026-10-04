const dgram = require('dgram');
const { createHttpServer } = require('../index');
const { generateSelfSignedCert } = require('../index');

const PROXY_PORT = 8001;
const TARGET_PORT = 9001;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const client = dgram.createSocket('udp4');
    const messageBuffer = Buffer.from(JSON.stringify(httpRequestDetails));

    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    if (typeof onConnect === 'function') {
      onConnect(client);
    }

    client.on('message', (msg, rinfo) => {
      if (typeof onData === 'function') onData(msg, rinfo);
      try {
        const responseData = JSON.parse(msg.toString('utf-8'));
        if (typeof onMessage === 'function') onMessage(responseData, rinfo);
        client.close();
        resolve(responseData);
      } catch (err) {
        if (typeof onError === 'function') onError(err);
        client.close();
        reject(err);
      }
    });

    client.on('close', () => {
      if (typeof onEnd === 'function') onEnd();
    });

    client.on('error', (err) => {
      if (typeof onError === 'function') onError(err);
      client.close();
      reject(err);
    });

    client.send(messageBuffer, port, host, (err) => {
      if (err) {
        if (typeof onError === 'function') onError(err);
        client.close();
        reject(err);
      }
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
      console.warn(`[UDP Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[UDP Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  } catch (err) {
    console.warn(`[UDP Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[UDP Proxy] HTTP Fallback Gateway error: ${err.message}`);
  });

  console.log(`[UDP Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol };