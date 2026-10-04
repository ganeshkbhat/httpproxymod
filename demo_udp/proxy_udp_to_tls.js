const { createUdpProxyServer, udpProxyToProtocol } = require('../index.js');

/**
 * UDP to TLS Proxy Server Demo using udpProxyToProtocol
 */
function createUdpToTlsProxy(options = {}, customLifecycle = {}) {
  const targetHost = options.targetHost || options.protocolHost || '127.0.0.1';
  const targetPort = options.targetPort || options.protocolPort || 7001;

  const serverOptions = {
    udpHost: options.udpHost || options.host || '127.0.0.1',
    udpPort: options.udpPort || options.port || 41210,
    protocol: 'tls',
    protocolHost: targetHost,
    protocolPort: targetPort,
    key: options.key,
    cert: options.cert,
    ca: options.ca,
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
      console.log(`[UDP->TLS Proxy] Listening on ${serverOptions.udpHost}:${serverOptions.udpPort} proxying to TLS ${targetHost}:${targetPort}`);
      if (typeof customLifecycle.onConnect === 'function') customLifecycle.onConnect(server);
    },
    onClose: (server) => {
      console.log(`[UDP->TLS Proxy] Server closed`);
      if (typeof customLifecycle.onClose === 'function') customLifecycle.onClose(server);
    }
  };

  return createUdpProxyServer({ ...serverOptions, ...lifecycleOptions }, proxyHandler);
}

if (require.main === module) {
  const proxy = createUdpToTlsProxy();
  console.log('UDP to TLS proxy running. Press Ctrl+C to stop.');
}

module.exports = { createUdpToTlsProxy };