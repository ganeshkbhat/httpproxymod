const net = require('net');
const fs = require('fs');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo/proxy_socket');
const { frameMessage, parseFrames } = require('../index');

const SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\demo_socket'
  : '/tmp/demo_socket.sock';

describe('Unix Socket / Pipe Proxy Module (proxy_socket.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    if (process.platform !== 'win32' && fs.existsSync(SOCKET_PATH)) {
      try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
    }

    mockTargetServer = net.createServer((socket) => {
      let rxBuffer = Buffer.alloc(0);

      socket.on('data', (chunk) => {
        rxBuffer = Buffer.concat([rxBuffer, chunk]);
        rxBuffer = parseFrames(rxBuffer, (messageBuffer) => {
          const parsed = JSON.parse(messageBuffer.toString('utf-8'));
          const responsePayload = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { socketPath: SOCKET_PATH, echoMethod: parsed.method }
          };
          socket.write(frameMessage(Buffer.from(JSON.stringify(responsePayload))), () => {
            socket.end();
          });
        });
      });
    });

    mockTargetServer.on('connection', (socket) => {
      activeSockets.add(socket);
      socket.on('close', () => activeSockets.delete(socket));
    });

    mockTargetServer.listen(SOCKET_PATH, () => done());
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
      mockTargetServer.close(() => {
        if (process.platform !== 'win32' && fs.existsSync(SOCKET_PATH)) {
          try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
        }
        done();
      });
    } else {
      done();
    }
  });

  it('should connect via domain socket/pipe and process request payload', async () => {
    const httpRequestDetails = {
      method: 'POST',
      url: '/ipc-endpoint',
      headers: {},
      body: JSON.stringify({ ipc: 'active' })
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ socketPath: SOCKET_PATH, echoMethod: 'POST' });
  });

  it('should invoke onConnection, onData, and onMessage custom event hooks', async () => {
    let connectInvoked = false;
    let dataInvoked = false;
    let messageInvoked = false;

    const customHandlers = {
      onConnection: (socket) => { connectInvoked = true; },
      onData: (chunk, socket) => { dataInvoked = true; },
      onMessage: (msg, socket) => { messageInvoked = true; }
    };

    const httpRequestDetails = {
      method: 'DELETE',
      url: '/ipc-delete',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectInvoked).to.be.true;
    expect(dataInvoked).to.be.true;
    expect(messageInvoked).to.be.true;
  });
});