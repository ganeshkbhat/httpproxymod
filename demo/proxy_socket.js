const net = require('net');
const { createHttpServer } = require('../index');
const { generateSelfSignedCert } = require('../index');
const { frameMessage, parseFrames } = require('../index');

const PROXY_PORT = 8006;
const SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\demo_socket'
  : '/tmp/demo_socket.sock';

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const socket = net.createConnection({ path: SOCKET_PATH }, () => {
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

const requestHandler = (req, res, httpRequestDetails) => {
  const reqDetails = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
  (async () => {
    try {
      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
      res.writeHead(targetResponse.status || 200, targetResponse.headers || {});
      res.end(JSON.stringify(targetResponse.body));
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  })();
};

function startProxyServer() {
  try {
    const certs = generateSelfSignedCert();
    const { server: proxyServer } = createHttpServer({
      port: PROXY_PORT,
      useHttps: true,
      key: certs.key,
      cert: certs.cert
    }, requestHandler);

    proxyServer.on('error', (err) => {
      console.warn(`[Unix Socket Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[Unix Socket Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  } catch (err) {
    console.warn(`[Unix Socket Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT,
    useHttps: false
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[Unix Socket Proxy] HTTP Fallback server error: ${err.message}`);
  });

  console.log(`[Unix Socket Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
}

startProxyServer();
module.exports = { proxyToProtocol };