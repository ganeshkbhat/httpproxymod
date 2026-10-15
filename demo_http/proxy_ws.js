const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { servers: { http: createHttpServer }, certs: { getOrGenerateSelfSignedCert }, framing: { buildWsFrame, parseWsFrames } } = require('../index');

const PROXY_PORT = 41210;
const TARGET_PORT = 8006;
const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';

/**
 * Forwards HTTP request payload over WebSocket using index.js ws client helper and custom handlers.
 */
async function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;
    const isSecure = customHandlers.useHttps || false;

    const secKey = crypto.randomBytes(16).toString('base64');
    const reqOptions = {
      host,
      port,
      path: httpRequestDetails.url || '/',
      method: httpRequestDetails.method || 'GET',
      headers: {
        ...httpRequestDetails.headers,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': secKey
      }
    };

    const transport = isSecure ? https : http;
    const req = transport.request(reqOptions);

    req.on('upgrade', (res, socket, head) => {
      if (typeof customHandlers.onConnection === 'function') {
        customHandlers.onConnection(socket, res);
      }

      if (typeof customHandlers.onData === 'function') {
        customHandlers.onData(httpRequestDetails.body, socket);
      }

      const payload = JSON.stringify({
        url: httpRequestDetails.url,
        method: httpRequestDetails.method,
        headers: httpRequestDetails.headers,
        body: httpRequestDetails.body
      });

      const frame = buildWsFrame(Buffer.from(payload, 'utf8'), true, 0x01, true);
      socket.write(frame);

      let rxBuffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        rxBuffer = parseWsFrames(rxBuffer, (frameObj) => {
          if (frameObj.payload) {
            try {
              const parsed = JSON.parse(frameObj.payload.toString('utf8'));
              if (typeof customHandlers.onMessage === 'function') {
                customHandlers.onMessage(parsed, socket);
              }
              socket.end();
              resolve({
                status: parsed.status || 200,
                headers: parsed.headers || { 'content-type': 'application/json' },
                body: parsed.body
              });
            } catch (err) {
              socket.end();
              resolve({
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: { wsEcho: httpRequestDetails.url }
              });
            }
          }
        });
      });
    });

    req.on('error', (err) => {
      if (typeof customHandlers.onError === 'function') {
        customHandlers.onError(err);
      }
      reject(err);
    });

    req.end();
  });
}

const requestHandler = async (req, res, httpRequestDetails) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', async () => {
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
  });
};

function startProxyServer() {
  const certs = getOrGenerateSelfSignedCert();
  const { server } = createHttpServer({
    port: PROXY_PORT,
    key: certs.key,
    cert: certs.cert
  }, requestHandler);

  console.log(`[WS Proxy] HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  return server;
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol, startProxyServer };