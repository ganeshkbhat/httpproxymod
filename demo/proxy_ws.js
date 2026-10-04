const http = require('http');
const crypto = require('crypto');
const { createHttpServer } = require('../index');
const { getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 8004;
const TARGET_PORT = 9004;

/**
 * Builds a masked WebSocket frame supporting standard, 16-bit, and 64-bit payload sizes.
 *
 * @param {Buffer} payloadBuffer - The frame payload.
 * @returns {Buffer} Formatted masked WebSocket frame.
 */
function buildMaskedWsFrame(payloadBuffer) {
  const payloadLength = payloadBuffer.length;
  let headerLength = 6;
  let extendedLenBytes = 0;

  if (payloadLength > 125 && payloadLength <= 65535) {
    extendedLenBytes = 2;
  } else if (payloadLength > 65535) {
    extendedLenBytes = 8;
  }

  const frame = Buffer.alloc(headerLength + extendedLenBytes + payloadLength);
  frame[0] = 0x81;

  let maskOffset = 2;
  if (extendedLenBytes === 0) {
    frame[1] = 0x80 | payloadLength;
  } else if (extendedLenBytes === 2) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payloadLength, 2);
    maskOffset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(payloadLength), 2);
    maskOffset = 10;
  }

  const maskKey = crypto.randomBytes(4);
  maskKey.copy(frame, maskOffset);
  const payloadOffset = maskOffset + 4;

  for (let i = 0; i < payloadLength; i++) {
    frame[payloadOffset + i] = payloadBuffer[i] ^ maskKey[i % 4];
  }
  return frame;
}

/**
 * Parses incoming WebSocket response frames from buffer store.
 *
 * @param {Buffer} bufferStore - Accumulated socket data buffer.
 * @returns {Object|null} Unmasked payload and length if frame complete, else null.
 */
function parseWsResponseFrame(bufferStore) {
  if (bufferStore.length < 2) return null;

  const secondByte = bufferStore[1];
  const isMasked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let headerSize = 2;

  if (payloadLength === 126) {
    if (bufferStore.length < 4) return null;
    payloadLength = bufferStore.readUInt16BE(2);
    headerSize += 2;
  } else if (payloadLength === 127) {
    if (bufferStore.length < 10) return null;
    payloadLength = Number(bufferStore.readBigUInt64BE(2));
    headerSize += 8;
  }

  const maskKeyOffset = headerSize;
  if (isMasked) {
    headerSize += 4;
  }

  if (bufferStore.length < headerSize + payloadLength) return null;

  const payloadStart = headerSize;
  let payload = bufferStore.slice(payloadStart, payloadStart + payloadLength);

  if (isMasked) {
    const maskKey = bufferStore.slice(maskKeyOffset, maskKeyOffset + 4);
    const unmasked = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      unmasked[i] = payload[i] ^ maskKey[i % 4];
    }
    payload = unmasked;
  }

  return { payload, totalFrameLen: headerSize + payloadLength };
}

/**
 * Forwards HTTP request payload over WebSocket protocol connection to WS server.
 *
 * @param {Object} httpRequestDetails - Parsed HTTP request details.
 * @param {Object} [customHandlers={}] - Optional event handlers and target options.
 * @returns {Promise<Object>} Response object from target WS server.
 */
function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  return new Promise((resolve, reject) => {
    const onConnect = customHandlers.onConnection || customHandlers.onConnect;
    const onData = customHandlers.onData;
    const onMessage = customHandlers.onMessage;
    const onEnd = customHandlers.onEnd;
    const onError = customHandlers.onError;

    const host = customHandlers.host || customHandlers.protocolHost || '127.0.0.1';
    const port = customHandlers.port || customHandlers.protocolPort || TARGET_PORT;

    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: host,
      port: port,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key
      }
    });

    let rxBuffer = Buffer.alloc(0);

    req.on('upgrade', (res, socket) => {
      if (typeof onConnect === 'function') onConnect(socket, res);
      const payloadBuf = Buffer.from(JSON.stringify(httpRequestDetails));
      socket.write(buildMaskedWsFrame(payloadBuf));

      socket.on('data', (chunk) => {
        if (typeof onData === 'function') onData(chunk, socket);
        rxBuffer = Buffer.concat([rxBuffer, chunk]);

        const parsedFrame = parseWsResponseFrame(rxBuffer);
        if (parsedFrame) {
          try {
            const responseData = JSON.parse(parsedFrame.payload.toString('utf-8'));
            if (typeof onMessage === 'function') onMessage(responseData, socket);
            socket.destroy();
            resolve(responseData);
          } catch (err) {
            if (typeof onError === 'function') onError(err, socket);
            socket.destroy();
            reject(err);
          }
        }
      });

      socket.on('end', () => {
        if (typeof onEnd === 'function') onEnd(socket);
      });

      socket.on('error', (err) => {
        if (typeof onError === 'function') onError(err, socket);
        reject(err);
      });
    });

    req.on('error', (err) => {
      if (typeof onError === 'function') onError(err);
      reject(err);
    });

    req.end();
  });
}

const requestHandler = (req, res) => {
  let body = '';
  req.on('data', (chunk) => body += chunk);
  req.on('end', async () => {
    const reqDetails = { method: req.method, url: req.url, headers: req.headers, body };
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
  });
};

function startProxyServer() {
  try {
    const certs = getOrGenerateSelfSignedCert();
    const { server: proxyServer } = createHttpServer({
      port: PROXY_PORT,
      key: certs.key,
      cert: certs.cert
    }, requestHandler);

    proxyServer.on('error', (err) => {
      console.warn(`[WS Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

    console.log(`[WS Proxy] Default HTTPS Gateway running at https://127.0.0.1:${PROXY_PORT}`);
    return proxyServer;
  } catch (err) {
    console.warn(`[WS Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    return startHttpFallback();
  }
}

function startHttpFallback() {
  const { server: proxyServer } = createHttpServer({
    port: PROXY_PORT
  }, requestHandler);

  console.log(`[WS Proxy] HTTP Fallback Gateway running at http://127.0.0.1:${PROXY_PORT}`);
  return proxyServer;
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol, startProxyServer };