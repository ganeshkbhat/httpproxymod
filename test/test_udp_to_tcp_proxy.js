const { expect } = require('chai');
const { createTargetTcpServer } = require('../demo_udp/server_tcp.js');
const { createUdpToTcpProxy } = require('../demo_udp/proxy_udp_to_tcp.js');
const { clients } = require('../index.js');

describe('UDP to TCP Proxy Integration Test Suite with Custom Handlers', function () {
  let tcpServerInstance;
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
    if (tcpServerInstance) {
      try { tcpServerInstance.close(); } catch (_) {}
      tcpServerInstance = null;
    }
  });

  it('should proxy UDP to TCP successfully with custom lifecycle and data handlers', async function () {
    let connectCalled = false;
    let messageReceivedCalled = false;
    let requestModifiedCalled = false;
    let dataCalled = false;

    tcpServerInstance = createTargetTcpServer(8013);

    proxyServerInstance = createUdpToTcpProxy({
      udpPort: 41230,
      protocolPort: 8013
    }, {
      onConnect: (server) => {
        connectCalled = true;
      },
      onMessageReceived: (msg, rinfo, server) => {
        messageReceivedCalled = true;
      },
      onRequestModified: (msg, rinfo) => {
        requestModifiedCalled = true;
        return msg;
      },
      onData: (response, messageDetails) => {
        dataCalled = true;
        return response;
      }
    });

    clientInstance = clients.udp({ host: '127.0.0.1', port: 41230 });

    const res = await clientInstance.sendProtocolRequestPayload({
      url: '/api/tcp-test',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hello tcp via udp' })
    }, 5000);

    expect(res).to.be.an('object');
    expect(res.status).to.equal(200);
    
    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('TCP Target Server');
    
    // body.received is the object returned by TCP Target Server, where its body is stringified JSON
    const received = body.received;
    const receivedBody = typeof received.body === 'string' ? JSON.parse(received.body) : received.body;
    expect(receivedBody).to.deep.equal({ message: 'hello tcp via udp' });

    expect(connectCalled).to.be.true;
    expect(messageReceivedCalled).to.be.true;
    expect(requestModifiedCalled).to.be.true;
    expect(dataCalled).to.be.true;
  });

  it('should handle custom request and response transformations correctly', async function () {
    tcpServerInstance = createTargetTcpServer(8014);

    proxyServerInstance = createUdpToTcpProxy({
      udpPort: 41231,
      protocolPort: 8014
    }, {
      onRequestModified: (msg) => {
        return {
          ...msg,
          body: JSON.stringify({ original: JSON.parse(msg.body), modified: true })
        };
      },
      onData: (response) => {
        const parsedBody = typeof response.body === 'string' 
          ? JSON.parse(response.body) 
          : { ...response.body };

        parsedBody.customExtra = 'added by tcp proxy handler';
        return {
          ...response,
          body: JSON.stringify(parsedBody)
        };
      }
    });

    clientInstance = clients.udp({ host: '127.0.0.1', port: 41231 });

    const res = await clientInstance.sendProtocolRequestPayload({
      url: '/transform',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'initial tcp payload' })
    }, 5000);

    expect(res.status).to.equal(200);

    const body = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
    expect(body.server).to.equal('TCP Target Server');
    expect(body.customExtra).to.equal('added by tcp proxy handler');

    const receivedBody = typeof body.received.body === 'string' 
      ? JSON.parse(body.received.body) 
      : body.received.body;

    expect(receivedBody.modified).to.be.true;
  });
});