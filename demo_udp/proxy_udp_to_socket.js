const { createUdpProxyServer, udpProxyToProtocol, DEFAULT_SOCKET_PATH } = require('../index.js');
const fs = require('fs');

/**
 * UDP to Socket (Unix Domain Socket / Named Pipe) Proxy Server Demo using udpProxyToProtocol
 */
function createUdpToSocketProxy(options = {}, customLifecycle = {}) {
  const socketPath = options.socketPath || options.path || DEFAULT_SOCKET_PATH;

  const serverOptions = {
    udpHost: options.udpHost || options.host || '127.0.0.1',
    udpPort: options.udpPort || options.port || 41210,
    protocol: 'socket',
    socketPath: socketPath,
    path: socketPath,
    ...options
  };

  const proxyHandler = async (udpMessageDetails, rinfo, server) => {
    try {
      if (typeof customLifecycle.onMessageReceived === 'function') {
        await customLifecycle.onMessageReceived(udpMessageDetails, rinfo, server);
      }

      let messageDetails = udpMessageDetails;
      if (typeof customLifecycle.onRequestModified === 'function') {
        messageDetails = await customLifecycle.onRequestModified(messageDetails, rinfo);
      }

      const result = await udpProxyToProtocol(messageDetails, serverOptions);

      let response = result.response;
      if (typeof customLifecycle.onResponseReceived === 'function') {
        response = await customLifecycle.onResponseReceived(response, messageDetails);
      }

      let responseBody = response.body;
      if (typeof responseBody === 'string') {
        try {
          responseBody = JSON.parse(responseBody);
        } catch (e) {}
      }
      if (responseBody && typeof responseBody === 'object') {
        if (responseBody.received && responseBody.received.body) {
          try {
            responseBody = JSON.parse(responseBody.received.body);
          } catch (e) {
            responseBody = responseBody.received.body;
          }
        } else if (responseBody.echo && responseBody.echo.body) {
          try {
            responseBody = JSON.parse(responseBody.echo.body);
          } catch (e) {
            responseBody = responseBody.echo.body;
          }
        }
      }

      return {
        status: response.status || 200,
        headers: response.headers || { 'content-type': 'application/json' },
        body: responseBody !== undefined ? responseBody : ''
      };
    } catch (err) {
      console.error('[UDP->Socket Proxy Error] Failed to forward message to socket:', err.message);
      return {
        status: 502,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Bad Gateway / Socket Proxy Forwarding Failed',
          details: err.message
        })
      };
    }
  };

  const lifecycleOptions = {
    onConnect: (server) => {
      console.log(`[UDP->Socket Proxy] Listening on ${serverOptions.udpHost}:${serverOptions.udpPort} proxying to Socket ${socketPath}`);
      if (typeof customLifecycle.onConnect === 'function') {
        customLifecycle.onConnect(server);
      }
    },
    onClose: (server) => {
      console.log(`[UDP->Socket Proxy] Server closed`);
      if (typeof customLifecycle.onClose === 'function') {
        customLifecycle.onClose(server);
      }
    },
    onError: (err, msg, rinfo, server) => {
      console.error('[UDP->Socket Proxy] Runtime error:', err.message);
      if (typeof customLifecycle.onError === 'function') {
        customLifecycle.onError(err, msg, rinfo, server);
      }
    }
  };

  return createUdpProxyServer({ ...serverOptions, ...lifecycleOptions }, proxyHandler);
}

if (require.main === module) {
  const proxy = createUdpToSocketProxy();
  console.log('UDP to Socket proxy running. Press Ctrl+C to stop.');
}

module.exports = { createUdpToSocketProxy };