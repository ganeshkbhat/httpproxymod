const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { sendHttpRequest } = require('http-requests-proxy');

const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';
const DEFAULT_SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\demo_socket'
  : '/tmp/demo_socket.sock';

// ============================================================================
// CERTIFICATE HELPER FUNCTIONS
// ============================================================================

function encodeLength(len) {
  if (len < 128) return Buffer.from([len]);
  const bytes = [];
  let temp = len;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function asn1(tag, value) {
  const len = encodeLength(value.length);
  return Buffer.concat([Buffer.from([tag]), len, value]);
}

function asn1Seq(...items) {
  return asn1(0x30, Buffer.concat(items));
}

function asn1Set(...items) {
  return asn1(0x31, Buffer.concat(items));
}

function asn1Integer(numBuf) {
  if (numBuf[0] & 0x80) {
    numBuf = Buffer.concat([Buffer.from([0x00]), numBuf]);
  }
  return asn1(0x02, numBuf);
}

function asn1Oid(oidStr) {
  const parts = oidStr.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    const valBytes = [];
    valBytes.push(val & 0x7f);
    val >>= 7;
    while (val > 0) {
      valBytes.unshift((val & 0x7f) | 0x80);
      val >>= 7;
    }
    bytes.push(...valBytes);
  }
  return asn1(0x06, Buffer.from(bytes));
}

function asn1UtcTime(date) {
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const str =
    pad(date.getUTCFullYear() % 100) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    'Z';
  return asn1(0x17, Buffer.from(str, 'ascii'));
}

function generateSelfSignedCert() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const oidSha256WithRSA = asn1Oid('1.2.840.113549.1.1.11');
  const oidCommonName = asn1Oid('2.5.4.3');

  const sigAlg = asn1Seq(oidSha256WithRSA, asn1(0x05, Buffer.alloc(0)));
  const version = asn1(0xa0, asn1Integer(Buffer.from([0x02])));
  const serialNumber = asn1Integer(Buffer.from([0x01]));

  const cnVal = asn1(0x0c, Buffer.from('localhost', 'utf8'));
  const name = asn1Seq(asn1Set(asn1Seq(oidCommonName, cnVal)));

  const now = new Date();
  const notBefore = asn1UtcTime(now);
  const notAfter = asn1UtcTime(new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000));
  const validity = asn1Seq(notBefore, notAfter);

  const tbsCertificate = asn1Seq(
    version,
    serialNumber,
    sigAlg,
    name,
    validity,
    name,
    publicKey
  );

  const signer = crypto.createSign('SHA256');
  signer.update(tbsCertificate);
  const signature = signer.sign(privateKey);

  const sigBitString = asn1(0x03, Buffer.concat([Buffer.from([0x00]), signature]));
  const certDer = asn1Seq(tbsCertificate, sigAlg, sigBitString);

  const certBase64 = certDer.toString('base64').match(/.{1,64}/g).join('\n');
  const certPem = `-----BEGIN CERTIFICATE-----\n${certBase64}\n-----END CERTIFICATE-----\n`;

  return {
    key: privateKey,
    cert: certPem
  };
}

function generateAndSaveCerts() {
  const { key, cert } = generateSelfSignedCert();

  const keyPath = path.join(__dirname, 'key.pem');
  const certPath = path.join(__dirname, 'cert.pem');

  fs.writeFileSync(keyPath, key, 'utf8');
  fs.writeFileSync(certPath, cert, 'utf8');

  console.log('Certificates generated and saved successfully:');
  console.log(` - Key:  ${keyPath}`);
  console.log(` - Cert: ${certPath}`);

  return { key, cert };
}

function getCerts() {
  const keyPath = path.join(__dirname, 'key.pem');
  const certPath = path.join(__dirname, 'cert.pem');

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    return generateAndSaveCerts();
  }

  const key = fs.readFileSync(keyPath, 'utf8');
  const cert = fs.readFileSync(certPath, 'utf8');

  return { key, cert };
}

// ============================================================================
// DEFAULT HANDLERS & STATE
// ============================================================================

let activeProtocolClient = null;

/**
 * Default Proxy Handler.
 * Executes a custom `options.requestHandler` function if provided,
 * otherwise responds with a hardcoded "hello world" response.
 *
 * @param {Object} req - Incoming HTTP request stream (`http.IncomingMessage`).
 * @param {Object} res - Outgoing HTTP response stream (`http.ServerResponse`).
 * @param {Object} httpRequestDetails - Parsed HTTP request object.
 * @param {string} httpRequestDetails.protocol - 'http' or 'https'.
 * @param {string} httpRequestDetails.url - Incoming request URL path and query string.
 * @param {string} httpRequestDetails.method - HTTP Method (GET, POST, etc.).
 * @param {Object} httpRequestDetails.headers - Incoming HTTP request headers.
 * @param {string} httpRequestDetails.body - Request payload stringified UTF-8 body.
 * @param {Object} [options={}] - Configuration options.
 * @param {Function} [options.requestHandler] - Custom request/response handling callback function.
 * @returns {Promise<any>}
 */
const defaultProxyHandler = async (req, res, httpRequestDetails, options = {}) => {
  if (typeof options.requestHandler === 'function') {
    return await options.requestHandler(req, res, httpRequestDetails, options);
  }

  res.send("hello world");
};

/**
 * HTTP/HTTPS Proxy Handler.
 * Executes a custom `options.requestHandler` function if provided,
 * otherwise proxies the request to the target HTTP/HTTPS host using `sendHttpRequest`.
 * Can be used directly as a request handler or invoked by `proxyToProtocol`.
 *
 * @param {Object} req - Incoming HTTP request stream (`http.IncomingMessage`).
 * @param {Object} res - Outgoing HTTP response stream (`http.ServerResponse`).
 * @param {Object} httpRequestDetails - Parsed HTTP request object.
 * @param {string} httpRequestDetails.protocol - 'http' or 'https'.
 * @param {string} httpRequestDetails.url - Incoming request URL path and query string.
 * @param {string} httpRequestDetails.method - HTTP Method (GET, POST, etc.).
 * @param {Object} httpRequestDetails.headers - Incoming HTTP request headers.
 * @param {string} httpRequestDetails.body - Request payload stringified UTF-8 body.
 * @param {Object} [options={}] - Configuration options.
 * @param {Function} [options.requestHandler] - Custom request/response handling callback function.
 * @param {string} [options.protocolHost='127.0.0.1'] - Target host IP or domain.
 * @param {number} [options.protocolPort] - Target port.
 * @param {number} [options.targetPort] - Fallback target port if `protocolPort` is omitted.
 * @param {boolean} [options.useHttps=false] - Whether target uses HTTPS scheme.
 * @param {string} [options.protocol='http'] - Target protocol ('http' or 'https').
 * @returns {Promise<Object>} Resolves with `{ status, headers, body }`
 */
const httpProxyHandler = async (req, res, httpRequestDetails, options = {}) => {
  if (typeof options.requestHandler === 'function') {
    const handlerResult = await options.requestHandler(req, res, httpRequestDetails, options);
    if (res && (res.writableEnded || res.finished)) {
      return handlerResult;
    }
  }

  const host = options.protocolHost || options.host || '127.0.0.1';
  const protocolType = (options.protocol || 'http').toLowerCase();
  const isHttps = Boolean(options.useHttps || protocolType === 'https');
  const defaultPort = isHttps ? 443 : 80;
  const port = options.protocolPort || options.targetPort || options.port || defaultPort;
  const scheme = isHttps ? 'https' : 'http';

  const details = httpRequestDetails || (req ? {
    url: req.url,
    method: req.method,
    headers: req.headers,
    body: ''
  } : {});

  const targetUrl = `${scheme}://${host}:${port}${details.url || '/'}`;

  try {
    const proxyRes = await sendHttpRequest({
      targetUrl: targetUrl,
      method: details.method || 'GET',
      headers: details.headers || {},
      body: details.body || ''
    });

    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      const responseBody = typeof proxyRes.body === 'object' && proxyRes.body !== null && !Buffer.isBuffer(proxyRes.body)
        ? JSON.stringify(proxyRes.body)
        : proxyRes.body;
      res.end(responseBody);
    }

    return {
      status: proxyRes.statusCode,
      headers: proxyRes.headers,
      body: proxyRes.body
    };
  } catch (err) {
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(504, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Gateway Timeout / Proxy Request Failed',
        details: err.message
      }));
    }
    throw err;
  }
};

// ============================================================================
// HELPER & UTILITY FUNCTIONS (Framing & Parsing)
// ============================================================================

function frameStreamMessage(buffer) {
  const lengthBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(buffer.length, 0);
  return Buffer.concat([lengthBuffer, buffer]);
}

function parseStreamFrames(bufferStore, onMessage) {
  while (bufferStore.length >= 4) {
    const messageLength = bufferStore.readUInt32BE(0);
    const totalFrameLength = 4 + messageLength;

    if (bufferStore.length < totalFrameLength) {
      break;
    }

    const messageBuffer = bufferStore.slice(4, totalFrameLength);
    bufferStore = bufferStore.slice(totalFrameLength);
    onMessage(messageBuffer);
  }
  return bufferStore;
}

const frameMessage = frameStreamMessage;
const parseFrames = parseStreamFrames;

function buildWsFrame(payloadBuffer, isFinal = true, opcode = 0x01, isMasked = false) {
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

// ============================================================================
// SERVER CREATORS FOR ALL PROTOCOLS
// ============================================================================

/**
 * UDP Server
 */
function createUdpServer(options = {}, genericServerHandler) {
  const host = options.host || '127.0.0.1';
  const port = options.port || 41234;
  const server = dgram.createSocket('udp4');

  server.on('message', async (msg, rinfo) => {
    let responsePayload = {};
    let correlationId = null;

    try {
      const parsedData = JSON.parse(msg.toString('utf-8'));
      correlationId = parsedData.correlationId;

      if (typeof genericServerHandler === 'function') {
        const result = await genericServerHandler({
          url: parsedData.url,
          method: parsedData.method,
          headers: parsedData.headers,
          body: parsedData.body
        });

        responsePayload = {
          correlationId,
          status: result.status || 200,
          headers: result.headers || { 'content-type': 'text/plain' },
          body: result.body || ''
        };
      }
    } catch (err) {
      responsePayload = {
        correlationId,
        status: 400,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'Malformed UDP payload', details: err.message })
      };
    }

    const responseBuffer = Buffer.from(JSON.stringify(responsePayload));
    server.send(responseBuffer, rinfo.port, rinfo.address);
  });

  server.bind(port, host);
  return { server, close: () => server.close() };
}

/**
 * TCP Server
 */
function createTcpServer(options = {}, genericServerHandler) {
  const port = options.port || 7000;
  const host = options.host || '127.0.0.1';

  const server = net.createServer((socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseStreamFrames(rxBuffer, async (messageBuffer) => {
        try {
          const packet = JSON.parse(messageBuffer.toString('utf-8'));
          const { requestId, payload } = packet;

          const responsePayload = await genericServerHandler(payload);

          const responsePacket = {
            requestId: requestId,
            status: responsePayload.status || 200,
            headers: responsePayload.headers || { 'content-type': 'application/json' },
            body: responsePayload.body || ''
          };

          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(responsePacket))));
        } catch (err) {
          const errorPacket = frameStreamMessage(Buffer.from(JSON.stringify({
            status: 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: err.message })
          })));
          socket.write(errorPacket);
        }
      });
    });
  });

  server.listen(port, host);
  return { server, close: () => server.close() };
}

/**
 * TLS Server
 */
function createTlsServer(options = {}, genericServerHandler) {
  const port = options.port || 7001;
  const host = options.host || '127.0.0.1';

  const tlsOptions = {
    key: options.key,
    cert: options.cert,
    ca: options.ca,
    rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false
  };

  const server = tls.createServer(tlsOptions, (socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseStreamFrames(rxBuffer, async (messageBuffer) => {
        try {
          const packet = JSON.parse(messageBuffer.toString('utf-8'));
          const { requestId, payload } = packet;

          const responsePayload = await genericServerHandler(payload);

          const responsePacket = {
            requestId: requestId,
            status: responsePayload.status || 200,
            headers: responsePayload.headers || { 'content-type': 'application/json' },
            body: responsePayload.body || ''
          };

          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(responsePacket))));
        } catch (err) {
          const errorPacket = frameStreamMessage(Buffer.from(JSON.stringify({
            status: 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: err.message })
          })));
          socket.write(errorPacket);
        }
      });
    });
  });

  server.listen(port, host);
  return { server, close: () => server.close() };
}

/**
 * WS / WSS Server
 */
function handleWsUpgrade(req, socket, head, options, genericServerHandler) {
  const secKey = req.headers['sec-websocket-key'];
  if (!secKey) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash('sha1')
    .update(secKey + WS_GUID)
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '\r\n'
  ];

  socket.write(headers.join('\r\n'));

  let rxBuffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    rxBuffer = parseWsFrames(rxBuffer, async (frame) => {
      if (frame.opcode === 0x08) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x01 || frame.opcode === 0x02) {
        try {
          const reqPayload = JSON.parse(frame.payload.toString('utf8'));
          const reqId = reqPayload.__reqId;

          const resObj = await genericServerHandler(reqPayload);

          if (typeof resObj === 'object' && resObj !== null) {
            resObj.__reqId = reqId;
          }

          const responseBuf = Buffer.from(JSON.stringify(resObj), 'utf8');
          socket.write(buildWsFrame(responseBuf, true, 0x01, false));
        } catch (err) {
          const errBuf = Buffer.from(JSON.stringify({ status: 500, error: err.message }), 'utf8');
          socket.write(buildWsFrame(errBuf, true, 0x01, false));
        }
      }
    });
  });
}

function createWsServer(options, genericServerHandler) {
  const server = http.createServer((req, res) => {
    res.writeHead(400);
    res.end('WebSocket endpoint requires WS upgrade.');
  });

  server.on('upgrade', (req, socket, head) => {
    handleWsUpgrade(req, socket, head, options, genericServerHandler);
  });

  server.listen(options.port || 8081);
  return { server, close: () => server.close() };
}

function createWssServer(options, genericServerHandler) {
  const server = https.createServer(options, (req, res) => {
    res.writeHead(400);
    res.end('WebSocket Secure endpoint requires WSS upgrade.');
  });

  server.on('upgrade', (req, socket, head) => {
    handleWsUpgrade(req, socket, head, options, genericServerHandler);
  });

  server.listen(options.port || 8443);
  return { server, close: () => server.close() };
}

/**
 * Unix Socket / Named Pipe Server
 */
function createSocketServer(options = {}, genericServerHandler) {
  const socketPath = typeof options === 'string'
    ? options
    : (options && (options.path || options.socketPath)) || DEFAULT_SOCKET_PATH;

  const handler = typeof options === 'function' ? options : genericServerHandler;

  const defaultOnData = (data) => ({
    protocol: 'UNIX_SOCKET',
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { message: 'Hello from Unix Socket Server', echo: data }
  });

  const dataHandler = handler || defaultOnData;

  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (_) {}
  }

  const server = net.createServer((socket) => {
    let rxBuffer = Buffer.alloc(0);

    socket.on('data', (chunk) => {
      rxBuffer = Buffer.concat([rxBuffer, chunk]);
      rxBuffer = parseStreamFrames(rxBuffer, async (messageBuffer) => {
        try {
          const rawMessage = messageBuffer.toString('utf-8');
          let packet;
          try {
            packet = JSON.parse(rawMessage);
          } catch (_) {
            packet = rawMessage;
          }

          if (packet && typeof packet === 'object' && packet.requestId !== undefined) {
            const { requestId, payload } = packet;
            const responsePayload = await dataHandler(payload || packet, socket);

            const responsePacket = {
              requestId: requestId,
              status: responsePayload ? (responsePayload.status || 200) : 200,
              headers: responsePayload ? (responsePayload.headers || { 'content-type': 'application/json' }) : { 'content-type': 'application/json' },
              body: responsePayload ? (responsePayload.body !== undefined ? responsePayload.body : responsePayload) : ''
            };

            socket.write(frameStreamMessage(Buffer.from(JSON.stringify(responsePacket))));
          } else {
            const response = await dataHandler(packet, socket);
            if (response !== undefined && response !== null) {
              const resBuffer = typeof response === 'string' || Buffer.isBuffer(response)
                ? Buffer.from(response)
                : Buffer.from(JSON.stringify(response));
              socket.write(frameStreamMessage(resBuffer));
            }
          }
        } catch (err) {
          console.error('[Socket Server] Error handling frame:', err);
          const errorResponse = {
            status: 500,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: err.message })
          };
          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(errorResponse))));
        }
      });
    });

    socket.on('error', (err) => {
      console.error('[Socket Server] Socket error:', err.message);
    });
  });

  server.listen(socketPath);
  return { server, close: () => server.close() };
}

// ============================================================================
// CLIENT CREATORS FOR ALL PROTOCOLS
// ============================================================================

/**
 * UDP Client
 */
function createUdpClient(options = {}, genericClientHandler) {
  const targetHost = options.host || '127.0.0.1';
  const targetPort = options.port || 41234;
  const socket = dgram.createSocket('udp4');
  const pendingRequests = new Map();

  socket.on('message', (msg) => {
    try {
      const responseData = JSON.parse(msg.toString('utf-8'));
      const { correlationId, status, headers, body } = responseData;

      if (correlationId && pendingRequests.has(correlationId)) {
        const { resolve, timer } = pendingRequests.get(correlationId);
        clearTimeout(timer);
        pendingRequests.delete(correlationId);
        
        const rawResult = { status, headers, body };
        const finalResult = typeof genericClientHandler === 'function' 
          ? genericClientHandler(rawResult) 
          : rawResult;
          
        resolve(finalResult);
      }
    } catch (err) {
      console.error('[UDP Client] Response decoding error:', err);
    }
  });

  return {
    sendHttpRequestPayload: function (httpRequestDetails, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const correlationId = crypto.randomUUID();
        const payload = {
          correlationId,
          url: httpRequestDetails.url,
          method: httpRequestDetails.method,
          headers: httpRequestDetails.headers,
          body: httpRequestDetails.body
        };

        const messageBuffer = Buffer.from(JSON.stringify(payload));
        const timer = setTimeout(() => {
          if (pendingRequests.has(correlationId)) {
            pendingRequests.delete(correlationId);
            reject(new Error('UDP Request Timeout'));
          }
        }, timeoutMs);

        pendingRequests.set(correlationId, { resolve, reject, timer });

        socket.send(messageBuffer, targetPort, targetHost, (err) => {
          if (err) {
            clearTimeout(timer);
            pendingRequests.delete(correlationId);
            reject(err);
          }
        });
      });
    },
    close: () => socket.close()
  };
}

/**
 * TCP, TLS & Socket Stream Client Base
 */
function createBaseStreamClient(connectFn, genericClientHandler) {
  let socket = null;
  const pendingRequests = new Map();
  let requestCounter = 0;
  let accumulatedBuffer = Buffer.alloc(0);

  function ensureConnection() {
    return new Promise((resolve, reject) => {
      if (socket && !socket.destroyed) {
        return resolve(socket);
      }

      try {
        socket = connectFn(() => resolve(socket));
      } catch (err) {
        return reject(err);
      }

      socket.on('data', (chunk) => {
        accumulatedBuffer = Buffer.concat([accumulatedBuffer, chunk]);
        accumulatedBuffer = parseStreamFrames(accumulatedBuffer, (messageBuffer) => {
          try {
            const responsePacket = JSON.parse(messageBuffer.toString('utf-8'));
            const { requestId } = responsePacket;

            if (requestId && pendingRequests.has(requestId)) {
              const { resolve: resolvePending } = pendingRequests.get(requestId);
              pendingRequests.delete(requestId);
              
              const finalResult = typeof genericClientHandler === 'function'
                ? genericClientHandler(responsePacket)
                : responsePacket;

              resolvePending(finalResult);
            }
          } catch (e) {
            console.error('[Stream Client] Parse error:', e.message);
          }
        });
      });

      socket.on('error', (err) => {
        for (const [, { reject: rejectPending }] of pendingRequests.entries()) {
          rejectPending(err);
        }
        pendingRequests.clear();
      });

      socket.on('close', () => { socket = null; });
    });
  }

  return {
    sendHttpRequestPayload: function (httpRequestDetails, timeout = 5000) {
      return ensureConnection().then(() => {
        requestCounter = (requestCounter + 1) % 1000000;
        const requestId = `req_${Date.now()}_${requestCounter}`;
        const packet = { requestId, payload: httpRequestDetails };

        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              pendingRequests.delete(requestId);
              reject(new Error(`Stream Request timed out after ${timeout}ms`));
            }
          }, timeout);

          pendingRequests.set(requestId, {
            resolve: (res) => { clearTimeout(timer); resolve(res); },
            reject: (err) => { clearTimeout(timer); reject(err); }
          });

          socket.write(frameStreamMessage(Buffer.from(JSON.stringify(packet))), (err) => {
            if (err) {
              clearTimeout(timer);
              pendingRequests.delete(requestId);
              reject(err);
            }
          });
        });
      });
    },
    close: () => {
      if (socket && !socket.destroyed) socket.destroy();
    }
  };
}

function createTcpClient(options = {}, genericClientHandler) {
  const host = options.host || '127.0.0.1';
  const port = options.port || 7000;
  return createBaseStreamClient((onConnect) => net.createConnection({ host, port }, onConnect), genericClientHandler);
}

function createTlsClient(options = {}, genericClientHandler) {
  const host = options.host || '127.0.0.1';
  const port = options.port || 7001;
  return createBaseStreamClient((onConnect) => tls.connect({
    host, port, key: options.key, cert: options.cert, ca: options.ca,
    rejectUnauthorized: options.rejectUnauthorized !== false
  }, onConnect), genericClientHandler);
}

/**
 * Unix Socket / Named Pipe Client
 */
function createSocketClient(options = {}, genericClientHandler) {
  const socketPath = typeof options === 'string'
    ? options
    : (options && (options.path || options.socketPath)) || DEFAULT_SOCKET_PATH;

  return createBaseStreamClient(
    (onConnect) => net.createConnection({ path: socketPath }, onConnect),
    genericClientHandler
  );
}

/**
 * HTTP / HTTPS Client using sendHttpRequest
 */
function createHttpClient(options = {}, genericClientHandler) {
  return {
    sendHttpRequestPayload: async function (httpRequestDetails) {
      const scheme = options.useHttps ? 'https' : 'http';
      const targetHost = options.host || '127.0.0.1';
      const targetPort = options.port || (options.useHttps ? 443 : 80);
      const urlPath = httpRequestDetails.url || '/';
      const targetUrl = httpRequestDetails.targetUrl || `${scheme}://${targetHost}:${targetPort}${urlPath}`;

      const payload = typeof httpRequestDetails.body === 'object' && httpRequestDetails.body !== null
        ? JSON.stringify(httpRequestDetails.body)
        : httpRequestDetails.body || '';

      const res = await sendHttpRequest({
        targetUrl: targetUrl,
        method: httpRequestDetails.method || 'GET',
        headers: httpRequestDetails.headers || {},
        body: payload
      });

      const rawResult = {
        status: res.statusCode,
        headers: res.headers,
        body: res.body
      };

      return typeof genericClientHandler === 'function'
        ? genericClientHandler(rawResult)
        : rawResult;
    },
    close: () => {}
  };
}

/**
 * WS / WSS Client
 */
function createGenericWsClient(isSecure, options = {}, genericClientHandler) {
  const pendingRequests = new Map();
  let requestIdCounter = 0;
  let socket = null;
  let rxBuffer = Buffer.alloc(0);
  let connectionPromise = null;

  function connect() {
    if (connectionPromise) return connectionPromise;

    connectionPromise = new Promise((resolve, reject) => {
      const port = options.port || (isSecure ? 8443 : 8081);
      const host = options.host || '127.0.0.1';
      const key = crypto.randomBytes(16).toString('base64');

      const reqOptions = {
        host,
        port,
        path: '/',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key
        },
        rejectUnauthorized: options.rejectUnauthorized !== false
      };

      const transport = isSecure ? https : http;
      const req = transport.request(reqOptions);

      req.on('upgrade', (res, connSocket) => {
        socket = connSocket;
        socket.on('data', (chunk) => {
          rxBuffer = Buffer.concat([rxBuffer, chunk]);
          rxBuffer = parseWsFrames(rxBuffer, (frame) => {
            if (frame.opcode === 0x01 || frame.opcode === 0x02) {
              const resPayload = JSON.parse(frame.payload.toString('utf8'));
              const reqId = resPayload.__reqId;
              if (pendingRequests.has(reqId)) {
                const { resolve: reqResolve } = pendingRequests.get(reqId);
                pendingRequests.delete(reqId);
                delete resPayload.__reqId;

                const finalResult = typeof genericClientHandler === 'function'
                  ? genericClientHandler(resPayload)
                  : resPayload;

                reqResolve(finalResult);
              }
            }
          });
        });

        socket.on('error', () => { connectionPromise = null; });
        resolve(socket);
      });

      req.on('error', (err) => {
        connectionPromise = null;
        reject(err);
      });

      req.end();
    });

    return connectionPromise;
  }

  return {
    sendHttpRequestPayload: async function (httpRequestDetails) {
      await connect();
      return new Promise((resolve, reject) => {
        const reqId = ++requestIdCounter;
        pendingRequests.set(reqId, { resolve, reject });

        const payload = {
          url: httpRequestDetails.url,
          method: httpRequestDetails.method,
          headers: httpRequestDetails.headers,
          body: httpRequestDetails.body,
          __reqId: reqId
        };

        const frame = buildWsFrame(Buffer.from(JSON.stringify(payload), 'utf8'), true, 0x01, true);
        socket.write(frame);
      });
    },
    close: () => { if (socket) socket.destroy(); }
  };
}

function createWsClient(options, genericClientHandler) {
  return createGenericWsClient(false, options, genericClientHandler);
}

function createWssClient(options, genericClientHandler) {
  return createGenericWsClient(true, options, genericClientHandler);
}

// ============================================================================
// REVERSE PROXY ROUTER & STANDALONE PROXY TO PROTOCOL
// ============================================================================

/**
 * Standalone Protocol Proxy Handler.
 * Encapsulates creating/using the protocol client based on `options.createClient` or `options.protocol`.
 *
 * @param {Object} httpRequestDetails - Parsed request details.
 * @param {Object} [options={}] - Options object.
 * @returns {Promise<Object>} Resolves with `{ protocolClient, response: { status, headers, body } }`
 */
async function proxyToProtocol(httpRequestDetails, options = {}) {
  let protocolClient;
  let createdInternally = false;

  if (options.protocolClient) {
    protocolClient = options.protocolClient;
  } else {
    createdInternally = true;
    const protocolType = (options.protocol || 'http').toLowerCase();
    const host = options.protocolHost || options.host || '127.0.0.1';
    const port = options.protocolPort || options.port;
    const genericClientHandler = options.genericClientHandler;

    if (typeof options.createClient === 'function') {
      protocolClient = options.createClient({ host, port, credentials: options.protocolCredentials }, genericClientHandler);
    } else {
      switch (protocolType) {
        case 'udp':
          protocolClient = createUdpClient({ host, port }, genericClientHandler);
          break;
        case 'tcp':
        case 'socket':
          protocolClient = createTcpClient({ host, port }, genericClientHandler);
          break;
        case 'tls':
          protocolClient = createTlsClient({ host, port, key: options.key, cert: options.cert, ca: options.ca }, genericClientHandler);
          break;
        case 'http':
          protocolClient = createHttpClient({ host, port, useHttps: false }, genericClientHandler);
          break;
        case 'https':
          protocolClient = createHttpClient({ host, port, useHttps: true }, genericClientHandler);
          break;
        case 'websocket':
        case 'ws':
          protocolClient = createWsClient({ host, port }, genericClientHandler);
          break;
        case 'wss':
          protocolClient = createWssClient({ host, port }, genericClientHandler);
          break;
        case 'unix':
        case 'pipe':
          protocolClient = createSocketClient({ path: options.socketPath || options.path }, genericClientHandler);
          break;
        default:
          throw new Error(`Unsupported protocol: ${options.protocol}`);
      }
    }
  }

  const shouldAutoClose = createdInternally && options.autoClose !== false && options.keepAlive !== true;

  try {
    const proxyResponse = await protocolClient.sendHttpRequestPayload(httpRequestDetails);
    const result = {
      protocolClient: protocolClient,
      response: {
        status: proxyResponse.status || 200,
        headers: proxyResponse.headers || { 'content-type': 'application/json' },
        body: proxyResponse.body || ''
      }
    };
    if (shouldAutoClose && typeof protocolClient.close === 'function') {
      protocolClient.close();
    }
    return result;
  } catch (err) {
    if (shouldAutoClose && typeof protocolClient.close === 'function') {
      protocolClient.close();
    }
    return {
      protocolClient: protocolClient,
      response: {
        status: 504,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          error: 'Gateway Timeout / Protocol Forwarding Failed',
          details: err.message
        })
      }
    };
  }
}

// ============================================================================
// HTTP / HTTPS SERVER ENGINE
// ============================================================================

/**
 * Creates the HTTP/HTTPS request handler function.
 *
 * @param {Object} [options={}] - Options object.
 * @param {Function} [setProtocolClient] - Callback to register active protocol client.
 * @param {Function} [proxyHandler] - Custom proxy execution function.
 * @returns {Function} Standard Node.js `(req, res)` HTTP request listener.
 */
function createRequestHandler(options = {}, setProtocolClient = (client) => {
    activeProtocolClient = client;
  }, proxyHandler) {
  const authenticate = options.authenticate !== undefined
    ? options.authenticate
    : ((httpRequestDetails) => true);

  const protocol = options.useHttps || (options.key && options.cert) ? 'https' : 'http';
  
  const handler = proxyHandler || (options.protocol ? proxyToProtocol : defaultProxyHandler);

  return (req, res) => {
    if (typeof res.send !== 'function') {
      res.send = (data) => {
        if (!res.headersSent) {
          if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            data = JSON.stringify(data);
          } else {
            res.writeHead(200, { 'content-type': 'text/plain' });
          }
        }
        res.end(data);
      };
    }

    const bodyChunks = [];

    req.on('data', (chunk) => {
      bodyChunks.push(chunk);
    });

    req.on('end', async () => {
      const requestBody = Buffer.concat(bodyChunks).toString('utf-8');

      const httpRequestDetails = {
        protocol: protocol,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: requestBody
      };

      if (typeof authenticate !== 'function') {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Unauthorized: Authentication handler is not a function'
        }));
      }

      const isAllowed = await authenticate(httpRequestDetails);
      if (!isAllowed) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Unauthorized: HTTP Server custom authentication failed'
        }));
      }

      let proxyResult;
      if (handler === proxyToProtocol) {
        proxyResult = await handler(httpRequestDetails, options);
      } else {
        proxyResult = await handler(req, res, httpRequestDetails, options);
      }

      if (res.writableEnded || res.finished) {
        return;
      }

      if (proxyResult && proxyResult.protocolClient) {
        setProtocolClient(proxyResult.protocolResult || proxyResult.protocolClient);
      }

      const response = proxyResult && proxyResult.response
        ? proxyResult.response
        : { status: 500, headers: {}, body: 'Internal Server Error' };

      let responseBody = response.body;
      if (typeof responseBody === 'object' && responseBody !== null && !Buffer.isBuffer(responseBody)) {
        responseBody = JSON.stringify(responseBody);
      }

      res.writeHead(response.status, response.headers);
      res.end(responseBody);
    });
  };
}

/**
 * Creates and starts an HTTP or HTTPS Server (Original version from ide.js).
 *
 * @param {Object} [options={}] - Options configuration object.
 * @param {number} [options.port=8080] - Server port to listen on.
 * @param {number} [options.httpPort] - Alternate server port option taking precedence over `options.port`.
 * @param {boolean} [options.useHttps=false] - Whether to instantiate an HTTPS server.
 * @param {string|Buffer} [options.key] - Private key for HTTPS.
 * @param {string|Buffer} [options.cert] - Cert chain for HTTPS.
 * @param {string|Buffer|Array} [options.ca] - CA cert authority overrides.
 * @param {string|Buffer} [options.pfx] - PFX file content.
 * @param {string} [options.passphrase] - Passphrase for private key or PFX.
 * @param {Function} [proxyHandler] - Custom handler responsible for request execution.
 * @returns {Object} `{ server: http.Server|https.Server, getProtocolClient: Function }`
 */
function createHttpServer(options = {}, proxyHandler) {
  const port = options.httpPort || options.port || 8080;
  const isHttps = Boolean(options.useHttps || (options.key && options.cert));

  let localActiveProtocolClient = options.protocolClient || null;

  const requestHandler = createRequestHandler(options, (client) => {
    localActiveProtocolClient = client;
    activeProtocolClient = client;
  }, proxyHandler);

  let server;
  if (isHttps) {
    const tlsOptions = {
      key: options.key,
      cert: options.cert,
      ca: options.ca,
      pfx: options.pfx,
      passphrase: options.passphrase
    };
    server = https.createServer(tlsOptions, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  server.listen(port, () => {
    const protocolScheme = isHttps ? 'HTTPS' : 'HTTP';
    console.log(`[${protocolScheme} Server HU] Listening on port ${port}`);
  });

  return {
    server: server,
    getProtocolClient: () => localActiveProtocolClient
  };
}

// ============================================================================
// MAIN EXPORTS & FACTORIES
// ============================================================================

module.exports = {
  // Constants
  DEFAULT_SOCKET_PATH,

  // Direct Server / Request Handlers / Handlers / Clients
  createHttpServer,
  createRequestHandler,
  proxyToProtocol,
  defaultProxyHandler,
  httpProxyHandler,
  sendHttpRequest,

  // Certificate Helpers
  generateSelfSignedCert,
  generateAndSaveCerts,
  getCerts,
  certs: {
    generateSelfSignedCert,
    generateAndSaveCerts,
    getCerts
  },

  // Framing Helpers
  frameMessage,
  parseFrames,
  frameStreamMessage,
  parseStreamFrames,
  framing: {
    frameMessage,
    parseFrames,
    frameStreamMessage,
    parseStreamFrames
  },

  // Server Creators
  servers: {
    udp: createUdpServer,
    tcp: createTcpServer,
    tls: createTlsServer,
    ws: createWsServer,
    wss: createWssServer,
    socket: createSocketServer,
    unix: createSocketServer
  },

  // Client Creators
  clients: {
    udp: createUdpClient,
    tcp: createTcpClient,
    tls: createTlsClient,
    http: (opts, handler) => createHttpClient({ ...opts, useHttps: false }, handler),
    https: (opts, handler) => createHttpClient({ ...opts, useHttps: true }, handler),
    ws: createWsClient,
    wss: createWssClient,
    socket: createSocketClient,
    unix: createSocketClient
  }
};