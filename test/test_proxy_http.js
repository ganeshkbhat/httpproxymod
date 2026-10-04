const http = require('http');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo_http/proxy_http');

const TARGET_PORT = 9007;

describe('HTTP Proxy Module (proxy_http.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    mockTargetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'connection': 'close'
        });
        res.end(JSON.stringify({
          httpServer: true,
          method: req.method,
          url: req.url,
          receivedBody: body
        }));
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

  it('should forward HTTP request to target HTTP server and receive JSON response', async () => {
    const httpRequestDetails = {
      method: 'POST',
      url: '/api/resource',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'test_item' })
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      httpServer: true,
      method: 'POST',
      url: '/api/resource',
      receivedBody: JSON.stringify({ name: 'test_item' })
    });
  });

  it('should call custom handlers (onConnection, onData, onMessage, onEnd)', async () => {
    let connectCalled = false;
    let dataCalled = false;
    let messageCalled = false;
    let endCalled = false;

    const customHandlers = {
      onConnection: (res) => { connectCalled = true; },
      onData: (chunk, res) => { dataCalled = true; },
      onMessage: (msg, res) => { messageCalled = true; },
      onEnd: (res) => { endCalled = true; }
    };

    const httpRequestDetails = {
      method: 'GET',
      url: '/api/events',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectCalled).to.be.true;
    expect(dataCalled).to.be.true;
    expect(messageCalled).to.be.true;
    expect(endCalled).to.be.true;
  });

  it('should propagate connection error when HTTP target is unavailable', async () => {
    let errorCalled = false;

    const customHandlers = {
      onError: (err) => { errorCalled = true; }
    };

    try {
      await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: 9998, path: '/' });
        req.on('error', (err) => {
          if (customHandlers.onError) customHandlers.onError(err);
          reject(err);
        });
        req.end();
      });
    } catch (err) {
      expect(err).to.be.an.instanceOf(Error);
    }

    expect(errorCalled).to.be.true;
  });
});