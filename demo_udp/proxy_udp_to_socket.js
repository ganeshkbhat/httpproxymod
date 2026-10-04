const { createUdpProxyServer, udpProxyToProtocol, DEFAULT_SOCKET_PATH } = require('../index.js');

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
    ...options
  };

  const proxyHandler = async (udpMessageDetails, rinfo, server) => {
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

    return {
      status: response.status,
      headers: response.headers,
      body: response.body
    };
  };

  const lifecycleOptions = {
    onConnect: (server) => {
      console.log(`[UDP->Socket Proxy] Listening on ${serverOptions.udpHost}:${serverOptions.udpPort} proxying to Socket ${socketPath}`);
      if (typeof customLifecycle.onConnect === 'function') customLifecycle.onConnect(server);
    },
    onClose: (server) => {
      console.log(`[UDP->Socket Proxy] Server closed`);
      if (typeof customLifecycle.onClose === 'function') customLifecycle.onClose(server);
    }
  };

  return createUdpProxyServer({ ...serverOptions, ...lifecycleOptions }, proxyHandler);
}

if (require.main === module) {
  const proxy = createUdpToSocketProxy();
  console.log('UDP to Socket proxy running. Press Ctrl+C to stop.');
}

module.exports = { createUdpToSocketProxy };