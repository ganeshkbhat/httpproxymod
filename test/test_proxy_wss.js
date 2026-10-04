const https = require('https');
const crypto = require('crypto');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo/proxy_wss');
const { generateSelfSignedCert } = require('../index');

const TARGET_PORT = 9005;
const WS_GUID = '23582111-PRTE-4B0E-9A0B-8C5E8C925682';

describe('WSS Proxy Module (proxy_wss.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    const certs = generateSelfSignedCert();

    mockTargetServer = https.createServer({
      key: certs.key,
      cert: certs.cert
    }, (req, res) => {
      res.writeHead(400, { 'connection': 'close' });
      res.end();
    });

    mockTargetServer.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
    });

    mockTargetServer.on('upgrade', (req, socket, head) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));

      const secKey = req.headers['sec-websocket-key'];
      const acceptKey = crypto.createHash('sha1').update(secKey + WS_GUID).digest('base64');

      const headers = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n'
      ];

      socket.write(headers.join('\r\n'));

      socket.on('data', (chunk) => {
        const isMasked = (chunk[1] & 0x80) !== 0;
        let payloadLen = chunk[1] & 0x7f;
        let offset = 2;

        let maskKey;
        if (isMasked) {
          maskKey = chunk.slice(offset, offset + 4);
          offset += 4;
        }

        const rawPayload = chunk.slice(offset, offset + payloadLen);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = rawPayload[i] ^ maskKey[i % 4];
        }

        const parsedReq = JSON.parse(unmasked.toString('utf-8'));
        const resObj = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { wssEcho: parsedReq.url, secure: true }
        };

        const resBuf = Buffer.from(JSON.stringify(resObj));
        const frame = Buffer.alloc(2 + resBuf.length);
        frame[0] = 0x81;
        frame[1] = resBuf.length;
        resBuf.copy(frame, 2);

        socket.write(frame);
      });
    });

    mockTargetServer.listen(TARGET_PORT, '127.0.0.1', () => done());
  });

  afterEach(() => {
    for (const socket of activeSockets) {
      socket.destroy();
    }
    activeSockets.clear();
  });

  after((done) => {
    if (mockTargetServer) {
      for (const socket of activeSockets) {
        socket.destroy();
      }
      activeSockets.clear();
      mockTargetServer.close(() => done());
    } else {
      done();
    }
  });

  it('should upgrade HTTPS connection to Secure WebSocket and parse incoming frames', async () => {
    const httpRequestDetails = {
      method: 'GET',
      url: '/wss-secure-route',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ wssEcho: '/wss-secure-route', secure: true });
  });

  it('should trigger custom handlers for secure websocket lifecycle', async () => {
    let connectTriggered = false;
    let dataTriggered = false;
    let messageTriggered = false;

    const customHandlers = {
      onConnection: (socket, res) => { connectTriggered = true; },
      onData: (chunk, socket) => { dataTriggered = true; },
      onMessage: (msg, socket) => { messageTriggered = true; }
    };

    const httpRequestDetails = {
      method: 'GET',
      url: '/wss-handlers',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectTriggered).to.be.true;
    expect(dataTriggered).to.be.true;
    expect(messageTriggered).to.be.true;
  });
});