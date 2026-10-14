const { clients: { tcp: createTcpClient }, createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 41211;
const TARGET_PORT = 9001;

/**
 * Proxies incoming HTTP requests to a target protocol (TCP) with comprehensive 
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

    console.log(`[PROXY EVENT] Initializing connection to target protocol server at ${host}:${port} for method: ${httpRequestDetails.method}, url: ${httpRequestDetails.url}`);

    const tcpClient = createTcpClient({ host, port }, (responsePacket, socket) => {
      console.log('[PROXY EVENT] onData / onMessage: Received data packet from target server:', responsePacket);
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
      onConnection(tcpClient.socket || tcpClient);
    } else if (typeof onConnect === 'function') {
      console.log('[PROXY EVENT] onConnect: Invoking custom connect handler');
      onConnect(tcpClient.socket || tcpClient);
    }

    if (tcpClient.socket) {
      tcpClient.socket.on('connect', () => {
        console.log('[PROXY SOCKET EVENT] connect: Socket connection successfully established.');
      });

      tcpClient.socket.on('end', () => {
        console.log('[PROXY SOCKET EVENT] onEnd: FIN received from target protocol server.');
        if (typeof onEnd === 'function') {
          console.log('[PROXY EVENT] Executing custom onEnd handler');
          onEnd(tcpClient.socket);
        }
      });

      tcpClient.socket.on('error', (err) => {
        console.error('[PROXY SOCKET EVENT] onError: Socket error encountered:', err.message);
        if (typeof onError === 'function') {
          console.log('[PROXY EVENT] Executing custom onError handler');
          onError(err, tcpClient.socket);
        }
      });

      tcpClient.socket.on('close', (hadError) => {
        console.log(`[PROXY SOCKET EVENT] onClose: Socket closed (hadError: ${hadError})`);
        if (typeof onClose === 'function') {
          console.log('[PROXY EVENT] Executing custom onClose handler');
          onClose(hadError, tcpClient.socket);
        }
        if (typeof onDestroy === 'function') {
          console.log('[PROXY EVENT] onDestroy: Cleaning up socket resources');
          onDestroy(hadError, tcpClient.socket);
        }
      });
    }

    console.log('[PROXY EVENT] onProcessing: Sending protocol request payload through TCP client');
    tcpClient.sendProtocolRequestPayload(httpRequestDetails)
      .then((response) => {
        console.log('[PROXY EVENT] onResponse: Successfully received response payload from protocol client');
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

        tcpClient.close();
        resolve(formattedResult);
      })
      .catch((err) => {
        console.error('[PROXY ERROR] Request payload dispatch failed:', err.message);
        if (typeof onError === 'function') {
          onError(err, tcpClient.socket || tcpClient);
        }
        tcpClient.close();
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
    console.error('[TCP Proxy Startup Error]:', err);
  }
}

module.exports = { proxyToProtocol, startProxyServer };