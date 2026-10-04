const dgram = require('dgram');
const crypto = require('crypto');

/**
 * Base UDP Proxy Server with comprehensive lifecycle event handlers.
 * Lifecycle events supported:
 * - onMessageReceived(msg, rinfo, server)
 * - onRequestModified(requestDetails, rinfo)
 * - onBeforeForward(requestDetails, targetInfo)
 * - onResponseReceived(responseDetails)
 * - onResponseModified(responseDetails)
 * - onError(err, rinfo)
 * - onClose()
 */
function createCustomUdpProxyServer(options = {}, lifecycleHooks = {}) {
  const host = options.udpHost || options.host || '127.0.0.1';
  const port = options.udpPort || options.port || 41234;
  
  const server = dgram.createSocket('udp4');

  server.on('message', async (msg, rinfo) => {
    let correlationId = null;
    let rawPayload = null;

    try {
      // 1. Lifecycle: Message Received
      if (typeof lifecycleHooks.onMessageReceived === 'function') {
        msg = await lifecycleHooks.onMessageReceived(msg, rinfo, server) || msg;
      }

      try {
        rawPayload = JSON.parse(msg.toString('utf-8'));
      } catch (e) {
        rawPayload = { body: msg.toString('utf-8') };
      }

      correlationId = rawPayload.correlationId || crypto.randomUUID();

      let requestDetails = {
        correlationId,
        protocol: options.targetProtocol || 'udp',
        url: rawPayload.url || '/',
        method: rawPayload.method || 'GET',
        headers: rawPayload.headers || {},
        body: rawPayload.body || '',
        remoteAddress: rinfo.address,
        remotePort: rinfo.port
      };

      // 2. Lifecycle: Request Modified
      if (typeof lifecycleHooks.onRequestModified === 'function') {
        requestDetails = await lifecycleHooks.onRequestModified(requestDetails, rinfo) || requestDetails;
      }

      // 3. Lifecycle: Before Forward
      let targetInfo = {
        host: options.targetHost || '127.0.0.1',
        port: options.targetPort || 80
      };
      if (typeof lifecycleHooks.onBeforeForward === 'function') {
        targetInfo = await lifecycleHooks.onBeforeForward(requestDetails, targetInfo) || targetInfo;
      }

      // Forwarding mechanism executed via options.forwarder
      let responseDetails;
      if (typeof options.forwarder === 'function') {
        responseDetails = await options.forwarder(requestDetails, targetInfo, options);
      } else {
        responseDetails = {
          correlationId,
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message: 'Default proxy response', received: requestDetails.body })
        };
      }

      // 4. Lifecycle: Response Received
      if (typeof lifecycleHooks.onResponseReceived === 'function') {
        responseDetails = await lifecycleHooks.onResponseReceived(responseDetails, requestDetails) || responseDetails;
      }

      // 5. Lifecycle: Response Modified
      if (typeof lifecycleHooks.onResponseModified === 'function') {
        responseDetails = await lifecycleHooks.onResponseModified(responseDetails, requestDetails) || responseDetails;
      }

      const responseBuffer = Buffer.from(JSON.stringify(responseDetails));
      server.send(responseBuffer, rinfo.port, rinfo.address, (err) => {
        if (err && typeof lifecycleHooks.onError === 'function') {
          lifecycleHooks.onError(err, rinfo);
        }
      });

    } catch (err) {
      if (typeof lifecycleHooks.onError === 'function') {
        lifecycleHooks.onError(err, rinfo);
      }
      const errResponse = {
        correlationId,
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'UDP Proxy Lifecycle Error', details: err.message })
      };
      server.send(Buffer.from(JSON.stringify(errResponse)), rinfo.port, rinfo.address);
    }
  });

  server.on('error', (err) => {
    if (typeof lifecycleHooks.onError === 'function') {
      lifecycleHooks.onError(err, null);
    } else {
      console.error('[UDP Proxy Server Error]', err);
    }
  });

  server.bind(port, host, () => {
    console.log(`[UDP Proxy Server] Listening on ${host}:${port} -> Protocol: ${options.targetProtocol || 'unknown'}`);
  });

  return {
    server,
    close: () => {
      server.close(() => {
        if (typeof lifecycleHooks.onClose === 'function') {
          lifecycleHooks.onClose();
        }
      });
    }
  };
}

module.exports = { createCustomUdpProxyServer };
