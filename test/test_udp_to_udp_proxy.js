const { expect } = require('chai');
const { createTargetUdpServer } = require('../demo_udp/server_udp.js');
const { createUdpToUdpProxy } = require('../demo_udp/proxy_udp_to_udp.js');
const { clients } = require('../index.js');

describe('UDP to UDP Proxy Integration Test Suite with Custom Handlers', function () {
  let targetUdpServerInstance;
  let proxyServerInstance;
  let clientInstance;

  afterEach(function () {
    if (clientInstance) {
      try { clientInstance.close(); } catch (_) {}
      clientInstance = null;
    }
    if (proxyServerInstance) {
      try { proxyServerInstance.close(); } catch (_) {}
      proxyServerInstance = null;
    }
    if (targetUdpServerInstance) {
      try { targetUdpServerInstance.close(); } catch (_) {}
      targetUdpServerInstance = null;
    }
  });

  it('should proxy UDP to UDP successfully with custom handlers', async function () {
    let connectCalled = false;
    let messageReceivedCalled = false;
    let responseReceivedCalled = false;

    targetUdpServerInstance = createTargetUdpServer(8023);

    proxyServerInstance = createUdpToUdpProxy({
      udpPort: 41240,
      protocolPort: 8023
    }, {
      onConnect: (server) => {
        connectCalled = true;
      },
      onMessageReceived: (msg, rinfo, server) => {
        messageReceivedCalled = true;
      },
      onResponseReceived: (response, messageDetails) => {
        responseReceivedCalled = true;
        return response;
      }
    });

    clientInstance = clients.udp({ host: '127.0.0.1', port: 41240 });

    const sentPayload = {
      url: '/api/udp-test',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello udp via udp proxy' })
    };

    const res = await clientInstance.sendProtocolRequestPayload(sentPayload, 5000);

    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('UDP Target Server');
    
    // Properly parse the inner echo body string back to an object for full payload comparison
    const echoResult = {
      ...body.echo,
      body: typeof body.echo.body === 'string' ? JSON.parse(body.echo.body) : body.echo.body
    };

    // Assert that the complete payload sent by the client matches what came back through the echo
    expect(echoResult.url).to.equal(sentPayload.url);
    expect(echoResult.method).to.equal(sentPayload.method);
    expect(echoResult.headers).to.deep.equal(sentPayload.headers);
    expect(echoResult.body).to.deep.equal(JSON.parse(sentPayload.body));

    expect(connectCalled).to.be.true;
    expect(messageReceivedCalled).to.be.true;
    expect(responseReceivedCalled).to.be.true;
  });

  it('should handle custom request and response transformations for UDP to UDP', async function () {
    targetUdpServerInstance = createTargetUdpServer(8024);

    proxyServerInstance = createUdpToUdpProxy({
      udpPort: 41241,
      protocolPort: 8024
    }, {
      onRequestModified: (msg) => {
        return {
          ...msg,
          body: JSON.stringify({ original: JSON.parse(msg.body), udpTransformed: true })
        };
      },
      onResponseReceived: (response) => {
        const parsedBody = typeof response.body === 'string' 
          ? JSON.parse(response.body) 
          : { ...response.body };

        parsedBody.proxyNote = 'handled via custom udp response hook';
        return {
          ...response,
          body: JSON.stringify(parsedBody)
        };
      }
    });

    clientInstance = clients.udp({ host: '127.0.0.1', port: 41241 });

    const res = await clientInstance.sendProtocolRequestPayload({
      url: '/udp-transform',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'udp test payload' })
    }, 5000);

    expect(res.status).to.equal(200);

    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('UDP Target Server');
    expect(body.proxyNote).to.equal('handled via custom udp response hook');

    const echoBody = typeof body.echo.body === 'string' 
      ? JSON.parse(body.echo.body) 
      : body.echo.body;

    expect(echoBody.udpTransformed).to.be.true;
  });
});