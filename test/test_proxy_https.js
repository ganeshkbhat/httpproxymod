const https = require('https');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo/proxy_https');
const { generateSelfSignedCert } = require('../index');

const TARGET_PORT = 9008;

describe('HTTPS Proxy Module (proxy_https.js)', function () {
  this.timeout(5000);
  let mockTargetServer;
  const activeSockets = new Set();

  before((done) => {
    const certs = generateSelfSignedCert();

    mockTargetServer = https.createServer({
      key: certs.key,
      cert: certs.cert
    }, (req, res) => {
      let body = '';
      req.on('data', (chunk) => body += chunk);
      req.on('end', () => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'connection': 'close'
        });
        res.end(JSON.stringify({
          httpsServer: true,
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

  it('should forward HTTPS request with unauthorized cert bypass', async () => {
    const httpRequestDetails = {
      method: 'PUT',
      url: '/secure/resource',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ update: true })
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({
      httpsServer: true,
      method: 'PUT',
      url: '/secure/resource',
      receivedBody: JSON.stringify({ update: true })
    });
  });

  it('should trigger custom event handlers for HTTPS request lifecycle', async () => {
    let connectTriggered = false;
    let dataTriggered = false;
    let messageTriggered = false;
    let endTriggered = false;

    const customHandlers = {
      onConnection: (res) => { connectTriggered = true; },
      onData: (chunk, res) => { dataTriggered = true; },
      onMessage: (msg, res) => { messageTriggered = true; },
      onEnd: (res) => { endTriggered = true; }
    };

    const httpRequestDetails = {
      method: 'GET',
      url: '/secure/test-handlers',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectTriggered).to.be.true;
    expect(dataTriggered).to.be.true;
    expect(messageTriggered).to.be.true;
    expect(endTriggered).to.be.true;
  });
});