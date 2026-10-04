const http = require('http');
const { createHttpServer } = require('../index');
const { getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 8007;
const TARGET_PORT = 9007;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const headers = { ...httpRequestDetails.headers };
    if (httpRequestDetails.body) {
      headers['content-length'] = Buffer.byteLength(httpRequestDetails.body);
    }

    const req = http.request({
      host: '127.0.0.1',
      port: TARGET_PORT,
      path: httpRequestDetails.url,
      method: httpRequestDetails.method,
      headers: headers
    }, (res) => {
      if (typeof onConnect === 'function') onConnect(res);
      let body = '';

      res.on('data', (chunk) => {
        if (typeof onData === 'function') onData(chunk, res);
        body += chunk;
      });

      res.on('end', () => {
        if (typeof onEnd === 'function') onEnd(res);
        try {
          const parsedBody = JSON.parse(body);
          const responseData = {
            status: res.statusCode,
            headers: res.headers,
            body: parsedBody
          };
          if (typeof onMessage === 'function') onMessage(responseData, res);
          resolve(responseData);
        } catch (err) {
          if (typeof onError === 'function') onError(err, res);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      if (typeof onError === 'function') onError(err);
      reject(err);
    });

    if (httpRequestDetails.body) {
      req.write(httpRequestDetails.body);
    }
    req.end();
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
    const certs = getOrGenerateSelfSignedCert();
    const { server: proxyServer } = createHttpServer({
      port: PROXY_PORT,
      useHttps: true,
      key: certs.key,
      cert: certs.cert
    }, requestHandler);

    proxyServer.on('error', (err) => {
      console.warn(`[HTTP Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[HTTP Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
  } catch (err) {
    console.warn(`[HTTP Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT,
    useHttps: false
  }, requestHandler);

  proxyServer.on('error', (err) => {
    console.error(`[HTTP Proxy] HTTP Fallback server error: ${err.message}`);
  });

  console.log(`[HTTP Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
}

startProxyServer();
module.exports = { proxyToProtocol };