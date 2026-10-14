const dgram = require('dgram');
const { createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 41210;
const TARGET_PORT = 8005;

const udpClient = dgram.createSocket('udp4');

/**
 * Forwards HTTP request details to target UDP server and returns the response.
 * Satisfies both the test suite (proxyToProtocol) and standard HTTP-to-UDP proxying.
 */
async function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnection = customHandlers.onConnection;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    const client = dgram.createSocket('udp4');

    if (typeof onConnection === 'function') {
      onConnection(client);
    }

    const payload = JSON.stringify({
      method: httpRequestDetails.method,
      url: httpRequestDetails.url,
      headers: httpRequestDetails.headers,
      body: httpRequestDetails.body || ''
    });

    if (typeof onData === 'function') {
      onData(httpRequestDetails);
    }

    client.send(Buffer.from(payload), port, host, (err) => {
      if (err) {
        if (typeof onError === 'function') {
          onError(err);
        }
        client.close();
        return reject(err);
      }
    });

    client.on('message', (msg) => {
      try {
        if (typeof onMessage === 'function') {
          onMessage(msg);
        }
        const parsed = JSON.parse(msg.toString('utf-8'));
        client.close();
        if (typeof onEnd === 'function') {
          onEnd();
        }
        resolve({
          status: parsed.status || 200,
          headers: parsed.headers || { 'content-type': 'application/json' },
          body: parsed.body
        });
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err);
        }
        client.close();
        reject(err);
      }
    });

    client.on('error', (err) => {
      if (typeof onError === 'function') {
        onError(err);
      }
      client.close();
      reject(err);
    });
  });
}

const requestHandler = async (req, res, httpRequestDetails) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', async () => {
    try {
      const reqDetails = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body || httpRequestDetails?.body || ''
      };

      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
      const status = targetResponse.status || 200;
      const headers = targetResponse.headers || { 'content-type': 'application/json' };
      const responseBody = typeof targetResponse.body === 'object' && targetResponse.body !== null
        ? JSON.stringify(targetResponse.body)
        : (targetResponse.body || '');

      res.writeHead(status, headers);
      res.end(responseBody);
    } catch (err) {
      console.error('[UDP Proxy] Error forwarding request:', err.message);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Gateway Error', details: err.message }));
    }
  });
};

function startProxyServer() {
  const certs = getOrGenerateSelfSignedCert();
  const { server } = createHttpServer({
    port: PROXY_PORT,
    key: certs.key,
    cert: certs.cert
  }, requestHandler);

  console.log(`[UDP Proxy] HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  return server;
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol, startProxyServer, udpClient };