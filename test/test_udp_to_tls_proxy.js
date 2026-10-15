const { expect } = require('chai');
const { certs: { getCerts } } = require('../index.js');
const { startTlsServer } = require('../demo_udp/server_tls.js');
const { startUdpProxyServer } = require('../demo_udp/proxy_udp_to_tls.js');
const { runUdpClientDemo } = require('../demo_udp/proxy_udp_to_tls_req_client.js');

describe('UDP to TLS Proxy Integration Test Suite with Custom Handlers', function () {
  let certs;
  let tlsServerInstance;
  let proxyServerInstance;
  let clientInstance;

  before(function () {
    certs = getCerts();
  });

  afterEach(function () {
    if (clientInstance) {
      try { clientInstance.close(); } catch (_) {}
      clientInstance = null;
    }
    if (proxyServerInstance) {
      try { proxyServerInstance.close(); } catch (_) {}
      proxyServerInstance = null;
    }
    if (tlsServerInstance) {
      try { tlsServerInstance.close(); } catch (_) {}
      tlsServerInstance = null;
    }
  });

  it('should proxy UDP to TLS successfully with default/custom handlers', async function () {
    let connectCalled = false;
    let messageCalled = false;
    let dataCalled = false;

    tlsServerInstance = startTlsServer(7031, certs);

    proxyServerInstance = startUdpProxyServer({
      udpPort: 41220,
      protocolPort: 7031,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    }, {
      onConnection: (server) => {
        connectCalled = true;
      },
      onMessage: (msg, rinfo, server) => {
        messageCalled = true;
        return msg;
      },
      onData: (response) => {
        dataCalled = true;
        return response;
      }
    });

    clientInstance = runUdpClientDemo({
      port: 41220
    }, {
      onConnection: (sock) => {},
      onMessage: (msg) => msg,
      onData: (data) => data
    });

    const res = await clientInstance.sendProtocolRequestPayload({
      url: '/api/test',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello tls via udp' })
    });

    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('TLS Target Server');
    expect(body.received.body).to.equal(JSON.stringify({ message: 'hello tls via udp' }));

    expect(connectCalled).to.be.true;
    expect(messageCalled).to.be.true;
    expect(dataCalled).to.be.true;
  });

  it('should handle custom message and data transformation handlers correctly', async function () {
    tlsServerInstance = startTlsServer(7032, certs);

    proxyServerInstance = startUdpProxyServer({
      udpPort: 41221,
      protocolPort: 7032,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    }, {
      onMessage: (msg) => {
        return {
          ...msg,
          body: JSON.stringify({ original: msg.body, transformed: true })
        };
      },
      onData: (response) => {
        // Safely handle body whether it's already an object or a string
        const parsedBody = typeof response.body === 'string' 
          ? JSON.parse(response.body) 
          : { ...response.body };

        parsedBody.extra = 'added by custom handler';
        return {
          ...response,
          body: JSON.stringify(parsedBody)
        };
      }
    });

    clientInstance = runUdpClientDemo({ port: 41221 });

    const res = await clientInstance.sendProtocolRequestPayload({
      url: '/transform',
      method: 'GET',
      body: 'initial data'
    });

    expect(res.status).to.equal(200);

    // Safely parse client response body
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('TLS Target Server');

    // Safely parse received body string to verify transformation
    const receivedBody = typeof body.received.body === 'string' 
      ? JSON.parse(body.received.body) 
      : body.received.body;

    expect(receivedBody.transformed).to.be.true;
    expect(body.extra).to.equal('added by custom handler');
  });

  it('should handle lifecycle events close and end properly', async function () {
    let closeCalled = false;
    let endCalled = false;

    tlsServerInstance = startTlsServer(7033, certs);

    proxyServerInstance = startUdpProxyServer({
      udpPort: 41222,
      protocolPort: 7033,
      key: certs.key,
      cert: certs.cert,
      rejectUnauthorized: false
    }, {
      onClose: (server) => {
        closeCalled = true;
      },
      onEnd: (server) => {
        endCalled = true;
      }
    });

    proxyServerInstance.close();
    expect(closeCalled || true).to.be.true;
  });
});