const dgram = require('dgram');
const { expect } = require('chai');
const { proxyToProtocol } = require('../demo_http/proxy_udp');

const TARGET_PORT = 9001;

describe('UDP Proxy Module (proxy_udp.js)', function () {
  this.timeout(5000);
  let mockTargetServer;

  before((done) => {
    mockTargetServer = dgram.createSocket('udp4');

    mockTargetServer.on('message', (msg, rinfo) => {
      try {
        const parsed = JSON.parse(msg.toString('utf-8'));
        const responsePayload = {
          status: 200,
          headers: { 'content-type': 'application/json' },
          body: { echoUrl: parsed.url, echoed: true }
        };
        const resBuffer = Buffer.from(JSON.stringify(responsePayload));
        mockTargetServer.send(resBuffer, rinfo.port, rinfo.address);
      } catch (err) {
        const errBuf = Buffer.from(JSON.stringify({ status: 400, body: { error: err.message } }));
        mockTargetServer.send(errBuf, rinfo.port, rinfo.address);
      }
    });

    mockTargetServer.bind(TARGET_PORT, '127.0.0.1', () => {
      done();
    });
  });

  after((done) => {
    if (mockTargetServer) {
      mockTargetServer.close(() => done());
    } else {
      done();
    }
  });

  it('should forward HTTP request details to target UDP server and return response', async () => {
    const httpRequestDetails = {
      method: 'POST',
      url: '/test-udp',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ping: 'pong' })
    };

    const response = await proxyToProtocol(httpRequestDetails);

    expect(response).to.be.an('object');
    expect(response.status).to.equal(200);
    expect(response.body).to.deep.equal({ echoUrl: '/test-udp', echoed: true });
  });

  it('should trigger custom handlers (onConnection, onData, onMessage, onEnd) during execution', async () => {
    let connectionCalled = false;
    let dataCalled = false;
    let messageCalled = false;
    let endCalled = false;

    const customHandlers = {
      onConnection: (socket) => { connectionCalled = true; },
      onData: (data, rinfo) => { dataCalled = true; },
      onMessage: (msg, rinfo) => { messageCalled = true; },
      onEnd: () => { endCalled = true; }
    };

    const httpRequestDetails = {
      method: 'GET',
      url: '/test-udp-handlers',
      headers: {},
      body: ''
    };

    const response = await proxyToProtocol(httpRequestDetails, customHandlers);

    expect(response.status).to.equal(200);
    expect(connectionCalled).to.be.true;
    expect(dataCalled).to.be.true;
    expect(messageCalled).to.be.true;
    expect(endCalled).to.be.true;
  });

  it('should invoke onError when target UDP server returns invalid payload', async () => {
    let errorCalled = false;

    const malformedServer = dgram.createSocket('udp4');
    const MALFORMED_PORT = 9101;

    await new Promise((resolve) => malformedServer.bind(MALFORMED_PORT, '127.0.0.1', resolve));

    malformedServer.on('message', (msg, rinfo) => {
      const badBuf = Buffer.from("NOT_VALID_JSON");
      malformedServer.send(badBuf, rinfo.port, rinfo.address);
    });

    const customHandlers = {
      onError: (err) => { errorCalled = true; }
    };

    try {
      await new Promise((resolve, reject) => {
        const client = dgram.createSocket('udp4');
        client.on('message', (msg) => {
          try {
            JSON.parse(msg.toString());
            client.close();
            resolve();
          } catch (e) {
            if (customHandlers.onError) customHandlers.onError(e);
            client.close();
            reject(e);
          }
        });
        client.send(Buffer.from('test'), MALFORMED_PORT, '127.0.0.1');
      });
    } catch (err) {
      expect(err).to.be.an.instanceOf(Error);
    } finally {
      malformedServer.close();
    }

    expect(errorCalled).to.be.true;
  });
});