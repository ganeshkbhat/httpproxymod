const { clients: { tls: createTlsClient }, createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 41211;
const TARGET_PORT = 9002;

function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnection = customHandlers.onConnection || customHandlers.onConnect;
    const onConnect = customHandlers.onConnect || customHandlers.onConnection;
    const onData = customHandlers.onData || customHandlers.onMessage;
    const onMessage = customHandlers.onMessage || customHandlers.onData;
    const onResponse = customHandlers.onResponse || customHandlers.onResponseReceived;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;
    const onClose = customHandlers.onClose;
    const onDestroy = customHandlers.onDestroy;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    const tlsClient = createTlsClient({
      host: host,
      port: port,
      key: customHandlers.key,
      cert: customHandlers.cert,
      ca: customHandlers.ca,
      rejectUnauthorized: customHandlers.rejectUnauthorized !== undefined ? customHandlers.rejectUnauthorized : false
    }, (responsePacket, socket) => {
      let res = responsePacket;
      if (typeof onMessage === 'function') {
        const temp = onMessage(res, socket);
        if (temp !== undefined) res = temp;
      }
      if (typeof onData === 'function') {
        const temp = onData(res, socket);
        if (temp !== undefined) res = temp;
      }
      return res;
    });

    if (typeof onConnection === 'function') {
      onConnection(tlsClient.socket || tlsClient);
    } else if (typeof onConnect === 'function') {
      onConnect(tlsClient.socket || tlsClient);
    }

    if (tlsClient.socket) {
      tlsClient.socket.on('end', () => {
        if (typeof onEnd === 'function') onEnd(tlsClient.socket);
      });
      tlsClient.socket.on('error', (err) => {
        if (typeof onError === 'function') onError(err, tlsClient.socket);
      });
      tlsClient.socket.on('close', (hadError) => {
        if (typeof onClose === 'function') onClose(hadError, tlsClient.socket);
        if (typeof onDestroy === 'function') onDestroy(hadError, tlsClient.socket);
      });
    }

    tlsClient.sendProtocolRequestPayload(httpRequestDetails)
      .then((response) => {
        let finalRes = response;
        if (typeof onResponse === 'function') {
          const temp = onResponse(finalRes, httpRequestDetails);
          if (temp !== undefined) finalRes = temp;
        }
        tlsClient.close();
        resolve(finalRes);
      })
      .catch((err) => {
        if (typeof onError === 'function') {
          onError(err, tlsClient.socket || tlsClient);
        }
        tlsClient.close();
        reject(err);
      });
  });
}

const requestHandler = (req, res, httpRequestDetails) => {
  const reqDetails = httpRequestDetails || { method: req.method, url: req.url, headers: req.headers, body: '' };
  
  (async () => {
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
    console.error(`[TLS Proxy] HTTPS server error: ${err.message}`);
  });

  return {
    server: proxyServer,
    close: (callback) => {
      proxyServer.close(callback);
    }
  };
}

module.exports = { proxyToProtocol, startProxyServer };