const net = require('net');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo_http/proxy_tcp');
const { frameMessage, parseFrames } = require('../index');

const TARGET_PORT = 8003;

describe('TCP Proxy Module (proxy_tcp.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    mockTargetServer = net.createServer((socket) => {
      let rxBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
          const packet = JSON.parse(messageBuffer.toString('utf-8'));
          const requestId = packet.requestId;
          const payload = packet.payload || packet;

          const responsePayload = {
            requestId,
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { receivedUrl: payload.url, success: true }
          };
          const responseFrame = frameMessage(Buffer.from(JSON.stringify(responsePayload)));
          socket.write(responseFrame, () => {
            socket.end();
          });
        });
      });
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

  it('should establish connection and exchange framed TCP messages', async () => {
    const httpRequestDetails = {
      method: 'GET',
      url: '/tcp-endpoint',
      headers: { host: 'localhost' },
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ receivedUrl: '/tcp-endpoint', success: true });
  });

  it('should trigger custom event handlers (onConnection, onData, onMessage)', async () => {
    let connectionTriggered = false;
    let dataTriggered = false;
    let messageTriggered = false;

    const customHandlers = {
      onConnection: (socket) => { connectionTriggered = true; },
      onData: (chunk, socket) => { dataTriggered = true; },
      onMessage: (msg, socket) => { messageTriggered = true; }
    };

    const httpRequestDetails = {
      method: 'POST',
      url: '/tcp-custom-handlers',
      headers: {},
      body: JSON.stringify({ item: 'widget' })
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectionTriggered).to.be.true;
    expect(dataTriggered).to.be.true;
    expect(messageTriggered).to.be.true;
  });

  it('should handle connection errors cleanly when target server is down', async () => {
    let errorTriggered = false;

    const customHandlers = {
      onError: (err) => { errorTriggered = true; }
    };

    // Temporarily close mockTargetServer so port 8003 is down
    await new Promise((resolve) => mockTargetServer.close(resolve));

    try {
      await proxyToProtocol({
        method: 'GET',
        url: '/fail',
        headers: {},
        body: ''
      }, customHandlers);
    } catch (err) {
      expect(err).to.be.an.instanceOf(Error);
    } finally {
      // Restart mockTargetServer for clean teardown
      await new Promise((resolve) => mockTargetServer.listen(TARGET_PORT, '127.0.0.1', resolve));
    }

    expect(errorTriggered).to.be.true;
  });
});