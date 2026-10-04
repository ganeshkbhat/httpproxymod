const { createUdpProxyServer, udpProxyToProtocol } = require('../index.js');

/**
 * UDP to HTTPS Proxy Server Demo using udpProxyToProtocol
 */
function createUdpToHttpsProxy(options = {}, customLifecycle = {}) {
  const targetHost = options.targetHost || options.protocolHost || '127.0.0.1';
  const targetPort = options.targetPort || options.protocolPort || 8443;

  const serverOptions = {
    udpHost: options.udpHost || options.host || '127.0.0.1',
    udpPort: options.udpPort || options.port || 41210,
    protocol: 'https',
    protocolHost: targetHost,
    protocolPort: targetPort,
    rejectUnauthorized: options.rejectUnauthorized !== false,
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
      console.log(`[UDP->HTTPS Proxy] Listening on ${serverOptions.udpHost}:${serverOptions.udpPort} proxying to HTTPS ${targetHost}:${targetPort}`);
      if (typeof customLifecycle.onConnect === 'function') customLifecycle.onConnect(server);
    },
    onClose: (server) => {
      console.log(`[UDP->HTTPS Proxy] Server closed`);
      if (typeof customLifecycle.onClose === 'function') customLifecycle.onClose(server);
    }
  };

  return createUdpProxyServer({ ...serverOptions, ...lifecycleOptions }, proxyHandler);
}

if (require.main === module) {
  const proxy = createUdpToHttpsProxy();
  console.log('UDP to HTTPS proxy running. Press Ctrl+C to stop.');
}

module.exports = { createUdpToHttpsProxy };