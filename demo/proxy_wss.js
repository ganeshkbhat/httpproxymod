const https = require('https');
const crypto = require('crypto');
const { createHttpServer, clients } = require('../index');
const { getOrGenerateSelfSignedCert } = require('../index');

const PROXY_PORT = 8005;
const TARGET_PORT = 9005;
const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';

/**
 * Builds a WebSocket frame.
 */
function buildWsFrame(payloadBuffer, isFinal = true, opcode = 0x01, isMasked = true) {
  const payloadLength = payloadBuffer.length;
  let headerLength = 2;

  if (payloadLength > 125 && payloadLength <= 65535) {
    headerLength += 2;
  } else if (payloadLength > 65535) {
    headerLength += 8;
  }

  if (isMasked) {
    headerLength += 4;
  }

  const frame = Buffer.alloc(headerLength + payloadLength);
  frame[0] = (isFinal ? 0x80 : 0x00) | (opcode & 0x0f);

  let payloadOffset = 2;
  if (payloadLength <= 125) {
    frame[1] = payloadLength;
  } else if (payloadLength <= 65535) {
    frame[1] = 126;
    frame.writeUInt16BE(payloadLength, 2);
    payloadOffset = 4;
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payloadLength), 2);
    payloadOffset = 10;
  }

  if (isMasked) {
    frame[1] |= 0x80;
    const maskKey = crypto.randomBytes(4);
    maskKey.copy(frame, payloadOffset);
    payloadOffset += 4;

    for (let i = 0; i < payloadLength; i++) {
      frame[payloadOffset + i] = payloadBuffer[i] ^ maskKey[i % 4];
    }
  } else {
    payloadBuffer.copy(frame, payloadOffset);
  }

  return frame;
}

/**
 * Parses incoming WebSocket frames.
 */
function parseWsFrames(buffer, onFrame) {
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];

    const isFinal = (firstByte & 0x80) !== 0;
    const opcode = firstByte & 0x0f;
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;

    let headerSize = 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 4) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerSize += 2;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) break;
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerSize += 8;
    }

    const maskKeyOffset = offset + headerSize;
    if (isMasked) {
      headerSize += 4;
    }

    if (buffer.length - offset < headerSize + payloadLength) break;

    const payloadStart = offset + headerSize;
    let payload = buffer.slice(payloadStart, payloadStart + payloadLength);

    if (isMasked) {
      const maskKey = buffer.slice(maskKeyOffset, maskKeyOffset + 4);
      const unmasked = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        unmasked[i] = payload[i] ^ maskKey[i % 4];
      }
      payload = unmasked;
    }

    onFrame({ isFinal, opcode, payload });
    offset += headerSize + payloadLength;
  }

  return buffer.slice(offset);
}

/**
 * Proxies HTTP request details to the WSS target server using WSS protocol handlers.
 */
async function proxyToProtocol(httpRequestDetails, customHandlers = {}) {
  const handlers = typeof customHandlers === 'function'
    ? { genericClientHandler: customHandlers }
    : (customHandlers || {});

  return new Promise((resolve, reject) => {
    const secKey = crypto.randomBytes(16).toString('base64');

    const reqOptions = {
      host: '127.0.0.1',
      port: TARGET_PORT,
      path: httpRequestDetails.url || '/',
      method: 'GET',
      headers: {
        'Connection': 'Upgrade',
        'Upgrade': 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': secKey,
        ...(httpRequestDetails.headers || {})
      },
      rejectUnauthorized: false
    };

    const req = https.request(reqOptions);

    req.on('upgrade', (res, socket, head) => {
      if (typeof handlers.onConnection === 'function') {
        handlers.onConnection(socket, res);
      }

      let rxBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        if (typeof handlers.onData === 'function') {
          handlers.onData(chunk, socket);
        }

        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        rxBuffer = parseWsFrames(rxBuffer, (frame) => {
          if (frame.opcode === 0x01 || frame.opcode === 0x02) {
            let parsedRes;
            try {
              parsedRes = JSON.parse(frame.payload.toString('utf-8'));
            } catch (_) {
              parsedRes = frame.payload.toString('utf-8');
            }

            if (typeof handlers.onMessage === 'function') {
              handlers.onMessage(parsedRes, socket);
            }

            let finalResult = parsedRes;
            if (typeof handlers.genericClientHandler === 'function') {
              finalResult = handlers.genericClientHandler(parsedRes);
            }

            socket.destroy();
            resolve(finalResult);
          }
        });
      });

      socket.on('error', (err) => {
        reject(err);
      });

      const payloadBuffer = Buffer.from(JSON.stringify(httpRequestDetails));
      const frame = buildWsFrame(payloadBuffer, true, 0x01, true);
      socket.write(frame);
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.end();
  });
}

/**
 * Request handler for incoming HTTP/HTTPS proxy requests.
 */
const requestHandler = (req, res) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    const reqDetails = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body
    };

    try {
      const targetResponse = await proxyToProtocol(reqDetails, req.customHandlers || {});
      const statusCode = targetResponse.status || 200;
      const headers = targetResponse.headers || { 'content-type': 'application/json' };

      res.writeHead(statusCode, headers);
      res.end(typeof targetResponse.body === 'object' ? JSON.stringify(targetResponse.body) : targetResponse.body);
    } catch (err) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
};

function startProxyServer() {
  try {
    const certs = getOrGenerateSelfSignedCert();

    const proxyServerWrapper = createHttpServer({
      port: PROXY_PORT,
      useHttps: true,
      key: certs.key,
      cert: certs.cert
    }, requestHandler);

    proxyServerWrapper.server.on('error', (err) => {
      console.warn(`[WSS Proxy] HTTPS server error (${err.message}), falling back to HTTP server...`);
      startHttpFallback();
    });

  } catch (err) {
    console.warn(`[WSS Proxy] HTTPS setup failed (${err.message}), falling back to HTTP server...`);
    startHttpFallback();
  }
}

function startHttpFallback() {
  const proxyServerWrapper = createHttpServer({
    port: PROXY_PORT,
    useHttps: false
  }, requestHandler);

  proxyServerWrapper.server.on('error', (err) => {
    console.error(`[WSS Proxy] HTTP Fallback server error: ${err.message}`);
  });
}

if (require.main === module) {
  startProxyServer();
}

module.exports = { proxyToProtocol, startProxyServer };