const tls = require('tls');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo/proxy_tls');
const { generateSelfSignedCert } = require('../index');
const { frameMessage, parseFrames } = require('../index');

const TARGET_PORT = 9003;

describe('TLS Proxy Module (proxy_tls.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    const certs = generateSelfSignedCert();

    mockTargetServer = tls.createServer({
      key: certs.key,
      cert: certs.cert
    }, (socket) => {
      let rxBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
          const parsed = JSON.parse(messageBuffer.toString('utf-8'));
          const responsePayload = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { tlsSecure: true, path: parsed.url }
          };
          socket.write(frameMessage(Buffer.from(JSON.stringify(responsePayload))), () => {
            socket.end();
          });
        });
      });
    });

    mockTargetServer.on('secureConnection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
    });

    mockTargetServer.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
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

  it('should connect to TLS server with unauthorized cert bypass and exchange frames', async () => {
    const httpRequestDetails = {
      method: 'GET',
      url: '/tls-secure-path',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ tlsSecure: true, path: '/tls-secure-path' });
  });

  it('should call custom event listeners on connection and receipt', async () => {
    let connectCalled = false;
    let dataCalled = false;
    let messageCalled = false;

    const customHandlers = {
      onConnection: (socket) => { connectCalled = true; },
      onData: (chunk, socket) => { dataCalled = true; },
      onMessage: (msg, socket) => { messageCalled = true; }
    };

    const httpRequestDetails = {
      method: 'PUT',
      url: '/tls-update',
      headers: {},
      body: 'payload'
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectCalled).to.be.true;
    expect(dataCalled).to.be.true;
    expect(messageCalled).to.be.true;
  });
});