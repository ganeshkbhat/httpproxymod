const { clients: { tls: createTlsClient }, createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 41211;
const TARGET_PORT = 9002;

/**
 * Proxies incoming HTTP requests to a target protocol (TLS) with comprehensive 
 * inline console logging across all lifecycle events and custom handler integrations.
 */
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

    console.log(`[PROXY EVENT] Initializing TLS connection to target server at ${host}:${port} for method: ${httpRequestDetails.method}, url: ${httpRequestDetails.url}`);

    const tlsClient = createTlsClient({
      host: host,
      port: port,
      key: customHandlers.key,
      cert: customHandlers.cert,
      ca: customHandlers.ca,
      rejectUnauthorized: customHandlers.rejectUnauthorized !== undefined ? customHandlers.rejectUnauthorized : false
    }, (responsePacket, socket) => {
      console.log('[PROXY EVENT] onData / onMessage: Received data packet from TLS target server:', responsePacket);
      let res = responsePacket;
      if (typeof onMessage === 'function') {
        console.log('[PROXY EVENT] Executing custom onMessage handler callback');
        const temp = onMessage(res, socket);
        if (temp !== undefined) res = temp;
      }
      if (typeof onData === 'function') {
        console.log('[PROXY EVENT] Executing custom onData handler callback');
        const temp = onData(res, socket);
        if (temp !== undefined) res = temp;
      }
      return res;
    });

    if (typeof onConnection === 'function') {
      console.log('[PROXY EVENT] onConnection: Invoking custom connection handler');
      onConnection(tlsClient.socket || tlsClient);
    } else if (typeof onConnect === 'function') {
      console.log('[PROXY EVENT] onConnect: Invoking custom connect handler');
      onConnect(tlsClient.socket || tlsClient);
    }

    if (tlsClient.socket) {
      tlsClient.socket.on('secureConnect', () => {
        console.log('[PROXY SOCKET EVENT] secureConnect: TLS handshake successfully completed.');
      });

      tlsClient.socket.on('end', () => {
        console.log('[PROXY SOCKET EVENT] onEnd: FIN received from TLS target server.');
        if (typeof onEnd === 'function') {
          console.log('[PROXY EVENT] Executing custom onEnd handler');
          onEnd(tlsClient.socket);
        }
      });

      tlsClient.socket.on('error', (err) => {
        console.error('[PROXY SOCKET EVENT] onError: TLS socket error encountered:', err.message);
        if (typeof onError === 'function') {
          console.log('[PROXY EVENT] Executing custom onError handler');
          onError(err, tlsClient.socket);
        }
      });

      tlsClient.socket.on('close', (hadError) => {
        console.log(`[PROXY SOCKET EVENT] onClose: TLS socket closed (hadError: ${hadError})`);
        if (typeof onClose === 'function') {
          console.log('[PROXY EVENT] Executing custom onClose handler');
          onClose(hadError, tlsClient.socket);
        }
        if (typeof onDestroy === 'function') {
          console.log('[PROXY EVENT] onDestroy: Cleaning up TLS socket resources');
          onDestroy(hadError, tlsClient.socket);
        }
      });
    }

    console.log('[PROXY EVENT] onProcessing: Sending protocol request payload through TLS client');
    tlsClient.sendProtocolRequestPayload(httpRequestDetails)
      .then((response) => {
        console.log('[PROXY EVENT] onResponse: Successfully received response payload from TLS protocol client');
        let finalRes = response;
        if (typeof onResponse === 'function') {
          console.log('[PROXY EVENT] Executing custom onResponse handler');
          const temp = onResponse(finalRes, httpRequestDetails);
          if (temp !== undefined) finalRes = temp;
        }

        let rawBody = finalRes.body !== undefined ? finalRes.body : finalRes;
        if (Buffer.isBuffer(rawBody)) {
          rawBody = rawBody.toString('utf-8');
        }

        let parsedBody = rawBody;
        if (typeof rawBody === 'string' && rawBody.trim().length > 0) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch (_) {
            parsedBody = rawBody;
          }
        }

        const formattedResult = {
          status: finalRes.status || 200,
          headers: finalRes.headers || { 'content-type': 'application/json' },
          body: parsedBody
        };

        tlsClient.close();
        resolve(formattedResult);
      })
      .catch((err) => {
        console.error('[PROXY ERROR] TLS request payload dispatch failed:', err.message);
        if (typeof onError === 'function') {
          onError(err, tlsClient.socket || tlsClient);
        }
        tlsClient.close();
        reject(err);
      });
  });
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