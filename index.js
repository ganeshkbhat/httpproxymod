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

function getOrGenerateSelfSignedCert() {
  const args = process.argv.slice(2);
  let keyPath = null;
  let certPath = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-key' || arg === '--key') {
      keyPath = args[i + 1];
    } else if (arg.startsWith('-key=') || arg.startsWith('--key=')) {
      keyPath = arg.split('=')[1];
    } else if (arg === '-cert' || arg === '--cert') {
      certPath = args[i + 1];
    } else if (arg.startsWith('-cert=') || arg.startsWith('--cert=')) {
      certPath = arg.split('=')[1];
    }
  }

  if (keyPath && certPath) {
    try {
      const key = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : keyPath;
      const cert = fs.existsSync(certPath) ? fs.readFileSync(certPath, 'utf8') : certPath;
      return { key, cert };
    } catch (err) {
      console.warn(`[Cert] Failed to read certificate files from command line arguments (${err.message}), falling back to self-signed generation.`);
    }
  }

  return generateSelfSignedCert();
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

const defaultProxyHandler = async (req, res, httpRequestDetails, options = {}) => {
  if (typeof options.requestHandler === 'function') {
    return await options.requestHandler(req, res, httpRequestDetails, options);
  }

  return { status: 200, headers: { 'content-type': 'text/plain' }, body: 'pong' };
};

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
// HANDLER RESOLUTION HELPER
// ============================================================================

function resolveHandlers(options = {}, handlerArg) {
  const handlers = typeof handlerArg === 'function' ? { onData: handlerArg } : (handlerArg || {});
  return {
    onConnect: options.onConnect || handlers.onConnect,
    onData: options.onData || handlers.onData,
    onClose: options.onClose || handlers.onClose,
    onEnd: options.onEnd || handlers.onEnd,
  };
}

// ============================================================================
// SERVER CREATORS FOR OTHER PROTOCOLS
// ============================================================================

/**
 * Creates a generic UDP server instance with fully customizable message and event handling.
 */
function createUdpServer(options = {}, handlerArg) {
  const host = options.host || '127.0.0.1';
  const port = options.port || 41234;
  
  const handlers = resolveHandlers(options, handlerArg);
  const onConnect = handlers.onConnect;
  const onData = handlers.onData;
  const onClose = handlers.onClose;
  const onEnd = handlers.onEnd;
  const onError = options.onError || handlers.onError;

  const socketType = options.socketType || 'udp4';
  const server = dgram.createSocket(socketType);

  server.on('listening', () => {
    if (typeof onConnect === 'function') {
      onConnect(server);
    }
  });

  server.on('message', async (msg, rinfo) => {
    try {
      if (typeof onData === 'function') {
        await onData(msg, rinfo, server);
      }
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err, msg, rinfo, server);
      } else {
        console.error('[UDP Server] Error handling message:', err);
      }
    }
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[UDP Server] Socket error:', err);
    }
  });

  server.on('close', () => {
    if (typeof onClose === 'function') {
      onClose(server);
    }
  });

  server.bind(port, host);

  return { 
    server, 
    close: () => {
      if (typeof onEnd === 'function') {
        onEnd(server);
      }
      server.close();
    } 
  };
}

/**
 * Shared helper for stream-based servers (TCP, TLS, Socket) to parse length-prefixed frames,
 * invoke the user data handler, and write back framed responses.
 */
function setupStreamServerConnection(socket, server, handlers, onError) {
  const onConnect = handlers.onConnect;
  const onData = handlers.onData;
  const onEnd = handlers.onEnd;
  const onClose = handlers.onClose;

  if (typeof onConnect === 'function') {
    onConnect(socket, server);
  }

  let rxBuffer = Buffer.alloc(0);

  socket.on('data', async (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    rxBuffer = parseStreamFrames(rxBuffer, async (messageBuffer) => {
      try {
        const packet = JSON.parse(messageBuffer.toString('utf-8'));
        const { requestId, payload } = packet;
        const requestData = payload !== undefined ? payload : packet;

        if (typeof onData === 'function') {
          const result = await onData(requestData, socket, server, packet);
          if (result && requestId) {
            const responsePacket = {
              requestId,
              status: result.status || 200,
              headers: result.headers || { 'content-type': 'application/json' },
              body: result.body !== undefined ? result.body : ''
            };
            socket.write(frameStreamMessage(Buffer.from(JSON.stringify(responsePacket))));
          }
        }
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err, messageBuffer, socket, server);
        } else {
          console.error('[Stream Server] Error handling message:', err);
        }
      }
    });
  });

  socket.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, socket, server);
    } else {
      console.error('[Stream Server] Socket error:', err);
    }
  });

  socket.on('end', () => {
    if (typeof onEnd === 'function') {
      onEnd(socket, server);
    }
  });

  socket.on('close', (hadError) => {
    if (typeof onClose === 'function') {
      onClose(hadError, socket, server);
    }
  });
}

function createTcpServer(options = {}, handlerArg) {
  const port = options.port || 7000;
  const host = options.host || '127.0.0.1';
  
  const handlers = resolveHandlers(options, handlerArg);
  const onError = options.onError || handlers.onError;

  const server = net.createServer((socket) => {
    setupStreamServerConnection(socket, server, handlers, onError);
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[TCP Server] Server error:', err);
    }
  });

  server.listen(port, host, () => {
    console.log(`[TCP Server] Listening on ${host}:${port}`);
  });

  return { 
    server, 
    close: (callback) => {
      server.close(callback);
    } 
  };
}

function createTlsServer(options = {}, handlerArg) {
  const port = options.port || 7001;
  const host = options.host || '127.0.0.1';
  
  const handlers = resolveHandlers(options, handlerArg);
  const onError = options.onError || handlers.onError;

  const tlsOptions = {
    key: options.key,
    cert: options.cert,
    ca: options.ca,
    rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false
  };

  const server = tls.createServer(tlsOptions, (socket) => {
    setupStreamServerConnection(socket, server, handlers, onError);
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[TLS Server] Server error:', err);
    }
  });

  server.listen(port, host, () => {
    console.log(`[TLS Server] Listening on ${host}:${port}`);
  });

  return { 
    server, 
    close: (callback) => {
      server.close(callback);
    } 
  };
}

function handleWsUpgrade(req, socket, head, options = {}, handlerArg, server) {
  const handlers = resolveHandlers(options, handlerArg);
  const onConnect = handlers.onConnect;
  const onData = handlers.onData;
  const onClose = handlers.onClose;
  const onEnd = handlers.onEnd;
  const onError = options.onError || handlers.onError;

  const secKey = req.headers['sec-websocket-key'];
  if (!secKey) {
    socket.destroy();
    if (typeof onClose === 'function') onClose(null, socket, server);
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

  if (typeof onConnect === 'function') {
    onConnect(socket, req, server);
  }

  let rxBuffer = Buffer.alloc(0);

  socket.on('data', async (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    rxBuffer = parseWsFrames(rxBuffer, async (frame) => {
      try {
        if (frame.opcode === 0x08) {
          if (typeof onEnd === 'function') {
            onEnd(socket, server);
          }
          socket.end();
          return;
        }

        if (typeof onData === 'function') {
          const reqData = JSON.parse(frame.payload.toString('utf8'));
          const reqId = reqData.__reqId;
          const payload = reqData;

          const result = await onData(payload, socket, server, frame);
          if (result && reqId !== undefined) {
            const responsePayload = {
              __reqId: reqId,
              status: result.status || 200,
              headers: result.headers || { 'content-type': 'application/json' },
              body: result.body !== undefined ? result.body : ''
            };
            const responseFrame = buildWsFrame(Buffer.from(JSON.stringify(responsePayload), 'utf8'), true, 0x01, false);
            socket.write(responseFrame);
          }
        }
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err, frame, socket, server);
        } else {
          console.error('[WebSocket Server] Error handling frame:', err);
        }
      }
    });
  });

  socket.on('end', () => {
    if (typeof onEnd === 'function') {
      onEnd(socket, server);
    }
  });

  socket.on('close', (hadError) => {
    if (typeof onClose === 'function') {
      onClose(hadError, socket, server);
    }
  });
}

function createWsServer(options = {}, handlerArg) {
  const port = options.port || 8081;
  const host = options.host || '127.0.0.1';
  const handlers = resolveHandlers(options, handlerArg);
  const onError = options.onError || handlers.onError;

  const server = http.createServer((req, res) => {
    if (typeof options.onHttpRequest === 'function') {
      options.onHttpRequest(req, res);
      return;
    }
    res.writeHead(400, { 'content-type': 'text/plain' });
    res.end('WebSocket endpoint requires WS upgrade.');
  });

  server.on('upgrade', (req, socket, head) => {
    handleWsUpgrade(req, socket, head, options, handlerArg, server);
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[WebSocket Server] Server error:', err);
    }
  });

  server.listen(port, host, () => {
    console.log(`[WebSocket Server] Listening on ${host}:${port}`);
  });

  return { 
    server, 
    close: (callback) => {
      server.close(callback);
    } 
  };
}

function createWssServer(options = {}, handlerArg) {
  const port = options.port || 8443;
  const host = options.host || '127.0.0.1';
  const handlers = resolveHandlers(options, handlerArg);
  const onError = options.onError || handlers.onError;

  let certs = {};
  if (!options.key || !options.cert) {
    certs = getCerts();
  }

  const tlsOptions = {
    key: options.key || certs.key,
    cert: options.cert || certs.cert,
    ca: options.ca,
    pfx: options.pfx,
    passphrase: options.passphrase,
    rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false
  };

  const server = https.createServer(tlsOptions, async (req, res) => {
    try {
      const requestHandler = options.onHttpRequest || options.onRequest || options.onNonUpgradeRequest;
      if (typeof requestHandler === 'function') {
        await requestHandler(req, res, options);
        return;
      }

      if (typeof handlers.onHttpRequest === 'function') {
        await handlers.onHttpRequest(req, res, options);
        return;
      }

      const defaultHttpHandler = options.defaultHttpHandler || ((request, response) => {
        if (!response.headersSent) {
          response.writeHead(400, { 'content-type': 'text/plain' });
          response.end('WebSocket Secure endpoint requires WSS upgrade.');
        }
      });
      await defaultHttpHandler(req, res, options);
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err, req, res, server);
      } else {
        console.error('[WSS Server] Error handling HTTP request:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal Server Error', details: err.message }));
        }
      }
    }
  });

  server.on('upgrade', (req, socket, head) => {
    try {
      if (typeof options.onUpgrade === 'function') {
        options.onUpgrade(req, socket, head, server);
        return;
      }
      handleWsUpgrade(req, socket, head, options, handlerArg, server);
    } catch (err) {
      if (typeof onError === 'function') {
        onError(err, { req, socket, head }, null, server);
      } else {
        console.error('[WSS Server] Error during upgrade handshake:', err);
        socket.destroy();
      }
    }
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[WSS Server] Server error:', err);
    }
  });

  server.listen(port, host, () => {
    if (typeof options.onListening === 'function') {
      options.onListening(server);
    } else {
      console.log(`[WSS Server] Listening on ${host}:${port}`);
    }
  });

  return { 
    server, 
    close: (callback) => {
      if (typeof options.onCloseServer === 'function') {
        options.onCloseServer(server);
      }
      server.close(callback);
    } 
  };
}

function createSocketServer(options = {}, handlerArg) {
  const socketPath = typeof options === 'string'
    ? options
    : (options && (options.path || options.socketPath)) || DEFAULT_SOCKET_PATH;

  const handlers = resolveHandlers(typeof options === 'object' ? options : {}, handlerArg);
  const onError = options.onError || handlers.onError;

  if (process.platform !== 'win32' && fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (_) {}
  }

  const server = net.createServer((socket) => {
    setupStreamServerConnection(socket, server, handlers, onError);
  });

  server.on('error', (err) => {
    if (typeof onError === 'function') {
      onError(err, null, null, server);
    } else {
      console.error('[Socket Server] Server error:', err);
    }
  });

  server.listen(socketPath, () => {
    console.log(`[Socket Server] Listening on path ${socketPath}`);
  });

  return { 
    server, 
    close: (callback) => {
      server.close(callback);
    } 
  };
}

// ============================================================================
// CLIENT CREATORS FOR ALL PROTOCOLS
// ============================================================================

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

function createSocketClient(options = {}, genericClientHandler) {
  const socketPath = typeof options === 'string'
    ? options
    : (options && (options.path || options.socketPath || (options.host && (options.host.includes('/') || options.host.includes('\\') || options.host.startsWith('.')) ? options.host : undefined))) || DEFAULT_SOCKET_PATH;

  return createBaseStreamClient(
    (onConnect) => net.createConnection({ path: socketPath }, onConnect),
    genericClientHandler
  );
}

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
        body: payload,
        rejectUnauthorized: options.rejectUnauthorized
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

async function httpProxyToProtocol(httpRequestDetails, options = {}) {
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
      protocolClient = options.createClient({ host, port, credentials: options.protocolCredentials, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
    } else {
      switch (protocolType) {
        case 'udp':
          protocolClient = createUdpClient({ host, port }, genericClientHandler);
          break;
        case 'tcp':
          protocolClient = createTcpClient({ host, port }, genericClientHandler);
          break;
        case 'tls':
          protocolClient = createTlsClient({ host, port, key: options.key, cert: options.cert, ca: options.ca, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'http':
          protocolClient = createHttpClient({ host, port, useHttps: false }, genericClientHandler);
          break;
        case 'https':
          protocolClient = createHttpClient({ host, port, useHttps: true, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'websocket':
        case 'ws':
          protocolClient = createWsClient({ host, port }, genericClientHandler);
          break;
        case 'wss':
          protocolClient = createWssClient({ host, port, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'socket':
        case 'unix':
        case 'pipe':
          protocolClient = createSocketClient({
            path: options.socketPath || options.path || (options.host && (options.host.includes('/') || options.host.includes('\\') || options.host.startsWith('.')) ? options.host : undefined)
          }, genericClientHandler);
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

async function udpProxyToProtocol(udpMessageDetails, options = {}) {
  let protocolClient;
  let createdInternally = false;

  if (options.protocolClient) {
    protocolClient = options.protocolClient;
  } else {
    createdInternally = true;
    const protocolType = (options.protocol || 'udp').toLowerCase();
    const host = options.protocolHost || options.host || '127.0.0.1';
    const port = options.protocolPort || options.port;
    const genericClientHandler = options.genericClientHandler;

    if (typeof options.createClient === 'function') {
      protocolClient = options.createClient({ host, port, credentials: options.protocolCredentials, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
    } else {
      switch (protocolType) {
        case 'udp':
          protocolClient = createUdpClient({ host, port }, genericClientHandler);
          break;
        case 'tcp':
          protocolClient = createTcpClient({ host, port }, genericClientHandler);
          break;
        case 'tls':
          protocolClient = createTlsClient({ host, port, key: options.key, cert: options.cert, ca: options.ca, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'http':
          protocolClient = createHttpClient({ host, port, useHttps: false }, genericClientHandler);
          break;
        case 'https':
          protocolClient = createHttpClient({ host, port, useHttps: true, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'websocket':
        case 'ws':
          protocolClient = createWsClient({ host, port }, genericClientHandler);
          break;
        case 'wss':
          protocolClient = createWssClient({ host, port, rejectUnauthorized: options.rejectUnauthorized }, genericClientHandler);
          break;
        case 'socket':
        case 'unix':
        case 'pipe':
          protocolClient = createSocketClient({
            path: options.socketPath || options.path || (options.host && (options.host.includes('/') || options.host.includes('\\') || options.host.startsWith('.')) ? options.host : undefined)
          }, genericClientHandler);
          break;
        default:
          throw new Error(`Unsupported protocol for UDP proxy: ${options.protocol}`);
      }
    }
  }

  const shouldAutoClose = createdInternally && options.autoClose !== false && options.keepAlive !== true;

  const httpRequestDetails = {
    protocol: udpMessageDetails.protocol || 'udp',
    url: udpMessageDetails.url || '/',
    method: udpMessageDetails.method || 'GET',
    headers: udpMessageDetails.headers || {},
    body: udpMessageDetails.body || ''
  };

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
          error: 'Gateway Timeout / UDP Protocol Forwarding Failed',
          details: err.message
        })
      }
    };
  }
}

// ============================================================================
// HTTP / HTTPS SERVER ENGINE
// ============================================================================

function createRequestHandler(options = {}, setProtocolClient = (client) => {
    activeProtocolClient = client;
  }, handlerArg) {
  const { onConnect, onData, onClose, onEnd } = resolveHandlers(options, handlerArg);
  
  const authenticate = options.authenticate !== undefined
    ? options.authenticate
    : null;

  const protocol = options.useHttps || (options.key && options.cert) ? 'https' : 'http';
  
  const requestProcessor = handlerArg && typeof handlerArg === 'function' && handlerArg.name !== 'resolveHandlers' 
    ? handlerArg 
    : (options.onData || options.requestHandler || options.proxyHandler || (options.protocol ? httpProxyToProtocol : null));

  return (req, res) => {
    if (typeof onConnect === 'function') {
      onConnect(req, res);
    }

    if (typeof res.send !== 'function') {
      res.send = (data, status = 200, headers = { 'content-type': 'text/plain' }) => {
        if (!res.headersSent) {
          if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
            headers = { 'content-type': 'application/json', ...headers };
            data = JSON.stringify(data);
          }
          res.writeHead(status, headers);
        }
        res.end(data);
      };
    }

    const bodyChunks = [];

    req.on('data', (chunk) => {
      bodyChunks.push(chunk);
    });

    req.on('end', async () => {
      if (typeof onEnd === 'function') {
        onEnd(req, res);
      }

      const requestBody = Buffer.concat(bodyChunks).toString('utf-8');

      const httpRequestDetails = {
        protocol: protocol,
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: requestBody
      };

      if (typeof authenticate === 'function') {
        try {
          const isAllowed = await authenticate(httpRequestDetails, req, res);
          if (!isAllowed) {
            if (!res.headersSent) {
              res.writeHead(401, { 'content-type': 'application/json' });
              res.end(JSON.stringify({
                error: 'Unauthorized: Custom authentication check failed'
              }));
            }
            if (typeof onClose === 'function') onClose(req, res);
            return;
          }
        } catch (authErr) {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({
              error: 'Authentication Exception',
              details: authErr.message
            }));
          }
          if (typeof onClose === 'function') onClose(req, res);
          return;
        }
      }

      try {
        let processorResult;
        if (typeof requestProcessor === 'function') {
          processorResult = await requestProcessor(req, res, httpRequestDetails, options);
        } else {
          const notFoundHandler = options.onNotFound || ((req, res) => {
            if (!res.headersSent) {
              res.writeHead(404, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ error: 'Not Found: No request processor or handler configured' }));
            }
          });
          processorResult = await notFoundHandler(req, res, httpRequestDetails, options);
        }

        if (res.writableEnded || res.finished) {
          if (typeof onClose === 'function') onClose(req, res);
          return;
        }

        if (processorResult && processorResult.protocolClient) {
          setProtocolClient(processorResult.protocolResult || processorResult.protocolClient);
        }

        if (processorResult && (processorResult.status !== undefined || processorResult.body !== undefined)) {
          const responseStatus = processorResult.status || 200;
          const responseHeaders = processorResult.headers || { 'content-type': 'text/plain' };
          let responseBody = processorResult.body;

          if (typeof responseBody === 'object' && responseBody !== null && !Buffer.isBuffer(responseBody)) {
            responseBody = JSON.stringify(responseBody);
          }

          if (!res.headersSent) {
            res.writeHead(responseStatus, responseHeaders);
            res.end(responseBody !== undefined ? responseBody : '');
          }
        }
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Internal Server Error',
            details: err.message
          }));
        }
      }

      if (typeof onClose === 'function') {
        onClose(req, res);
      }
    });
  };
}

function createHttpServer(options = {}, requestHandlerArg) {
  const port = options.httpPort || options.port || 8080;
  const isHttps = Boolean(options.useHttps || (options.key && options.cert));

  let localActiveProtocolClient = options.protocolClient || null;

  const requestHandler = createRequestHandler(options, (client) => {
    localActiveProtocolClient = client;
    activeProtocolClient = client;
  }, requestHandlerArg);

  let server;
  if (isHttps) {
    let certs = {};
    if (!options.key || !options.cert) {
      certs = getCerts();
    }
    const tlsOptions = {
      key: options.key || certs.key,
      cert: options.cert || certs.cert,
      ca: options.ca,
      pfx: options.pfx,
      passphrase: options.passphrase,
      rejectUnauthorized: options.rejectUnauthorized !== undefined ? options.rejectUnauthorized : false
    };
    server = https.createServer(tlsOptions, requestHandler);
  } else {
    server = http.createServer(requestHandler);
  }

  server.listen(port, () => {
    const protocolScheme = isHttps ? 'HTTPS' : 'HTTP';
    console.log(`[${protocolScheme} Server] Listening on port ${port}`);
  });

  return {
    server: server,
    getProtocolClient: () => localActiveProtocolClient
  };
}

// ============================================================================
// UDP PROXY SERVER ENGINE
// ============================================================================

function createUdpProxyServer(options = {}, proxyHandler) {
  const host = options.udpHost || options.host || '127.0.0.1';
  const port = options.udpPort || options.port || 41234;
  const { onConnect, onData, onClose, onEnd } = resolveHandlers(options, proxyHandler);
  const authenticate = options.authenticate !== undefined ? options.authenticate : null;
  const handler = onData || proxyHandler || (options.protocol ? udpProxyToProtocol : null);

  let localActiveProtocolClient = options.protocolClient || null;
  const setProtocolClient = (client) => {
    localActiveProtocolClient = client;
    activeProtocolClient = client;
  };

  const server = dgram.createSocket('udp4');

  if (typeof onConnect === 'function') {
    server.on('listening', () => {
      onConnect(server);
    });
  }

  server.on('message', async (msg, rinfo) => {
    let correlationId = null;
    let responsePayload = {};

    try {
      const parsedData = JSON.parse(msg.toString('utf-8'));
      correlationId = parsedData.correlationId;

      const udpMessageDetails = {
        protocol: parsedData.protocol || 'udp',
        url: parsedData.url || '/',
        method: parsedData.method || 'GET',
        headers: parsedData.headers || {},
        body: parsedData.body || ''
      };

      if (typeof authenticate === 'function') {
        const isAllowed = await authenticate(udpMessageDetails);
        if (!isAllowed) {
          const errRes = {
            correlationId,
            status: 401,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ error: 'Unauthorized: UDP Proxy authentication failed' })
          };
          server.send(Buffer.from(JSON.stringify(errRes)), rinfo.port, rinfo.address);
          return;
        }
      }

      let proxyResult;
      if (handler === udpProxyToProtocol) {
        proxyResult = await udpProxyToProtocol(udpMessageDetails, options);
      } else if (typeof handler === 'function') {
        proxyResult = await handler(udpMessageDetails, rinfo, server);
      } else {
        proxyResult = { status: 404, body: { error: 'Not Found: No UDP proxy handler configured' } };
      }

      if (proxyResult && proxyResult.protocolClient) {
        setProtocolClient(proxyResult.protocolResult || proxyResult.protocolClient);
      }

      const response = proxyResult && proxyResult.response
        ? proxyResult.response
        : (proxyResult || { status: 200, headers: {}, body: '' });

      let responseBody = response.body;
      if (typeof responseBody === 'object' && responseBody !== null && !Buffer.isBuffer(responseBody)) {
        responseBody = JSON.stringify(responseBody);
      }

      responsePayload = {
        correlationId,
        status: response.status || 200,
        headers: response.headers || { 'content-type': 'application/json' },
        body: responseBody !== undefined ? responseBody : ''
      };
    } catch (err) {
      responsePayload = {
        correlationId,
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ error: 'UDP Proxy Error', details: err.message })
      };
    }

    const responseBuffer = Buffer.from(JSON.stringify(responsePayload));
    server.send(responseBuffer, rinfo.port, rinfo.address);
  });

  server.on('close', () => {
    if (typeof onClose === 'function') {
      onClose(server);
    }
  });

  server.bind(port, host, () => {
    console.log(`[UDP Proxy Server] Listening on ${host}:${port} proxying to protocol: ${options.protocol || 'default'}`);
  });

  return {
    server: server,
    close: () => {
      if (typeof onEnd === 'function') onEnd(server);
      server.close();
    },
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
  createUdpProxyServer,
  createRequestHandler,
  httpProxyToProtocol,
  udpProxyToProtocol,
  defaultProxyHandler,
  httpProxyHandler,
  sendHttpRequest,

  // Certificate Helpers
  generateSelfSignedCert,
  getOrGenerateSelfSignedCert,
  generateAndSaveCerts,
  getCerts,
  certs: {
    generateSelfSignedCert,
    getOrGenerateSelfSignedCert,
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
    udpProxy: createUdpProxyServer,
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