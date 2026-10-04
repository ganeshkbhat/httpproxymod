const { expect } = require('chai');
const sinon = require('sinon');
const { createHttpServer, sendHttpRequest } = require('../index');

describe('httpm Module - createHttpServer & sendHttpRequest', function () {
  let targetServerInfo;
  let proxyServerInfo;

  const TARGET_PORT = 9001;
  const PROXY_PORT = 8081;

  afterEach(function (done) {
    sinon.restore();

    let pendingCloses = 0;

    const checkDone = () => {
      pendingCloses--;
      if (pendingCloses <= 0) {
        done();
      }
    };

    if (targetServerInfo && targetServerInfo.server && targetServerInfo.server.listening) {
      pendingCloses++;
      targetServerInfo.server.close(checkDone);
      targetServerInfo = null;
    }

    if (proxyServerInfo && proxyServerInfo.server && proxyServerInfo.server.listening) {
      pendingCloses++;
      proxyServerInfo.server.close(checkDone);
      proxyServerInfo = null;
    }

    if (pendingCloses === 0) {
      done();
    }
  });

  describe('sendHttpRequest', function () {
    it('should successfully make an HTTP GET request and return parsed response', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        requestHandler: async (req, res, httpRequestDetails) => {
          res.send({ status: 'ok', method: httpRequestDetails.method });
        }
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${TARGET_PORT}/test-get`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.deep.equal({ status: 'ok', method: 'GET' });
    });

    it('should successfully send a POST request payload and custom headers', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        requestHandler: async (req, res, httpRequestDetails) => {
          const body = JSON.parse(httpRequestDetails.body);
          res.send({
            receivedHeader: httpRequestDetails.headers['x-custom-header'],
            receivedData: body
          });
        }
      });

      const payload = { key: 'value', number: 123 };
      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${TARGET_PORT}/test-post`,
        method: 'POST',
        headers: {
          'x-custom-header': 'MochaTest'
        },
        body: payload
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body.receivedHeader).to.equal('MochaTest');
      expect(response.body.receivedData).to.deep.equal(payload);
    });

    it('should reject with error when targetUrl is missing', async function () {
      try {
        await sendHttpRequest({});
        expect.fail('Should have thrown an error for missing targetUrl');
      } catch (err) {
        expect(err.message).to.equal('Target URL is required for sendHttpRequest');
      }
    });

    it('should handle request timeout and reject with error', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        requestHandler: () => new Promise(() => {}) // Never resolves to force client timeout
      });

      try {
        await sendHttpRequest({
          targetUrl: `http://127.0.0.1:${TARGET_PORT}/timeout`,
          timeout: 100
        });
        expect.fail('Should have timed out');
      } catch (err) {
        expect(err.message).to.include('timed out after 100ms');
      }
    });
  });

  describe('createHttpServer', function () {
    it('should respond with default "hello world" when protocol is not specified', async function () {
      proxyServerInfo = createHttpServer({
        port: PROXY_PORT
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.equal('hello world');
    });

    it('should execute custom requestHandler when protocol is not specified', async function () {
      proxyServerInfo = createHttpServer({
        port: PROXY_PORT,
        requestHandler: async (req, res, httpRequestDetails) => {
          res.send({ customResponse: true });
        }
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/custom`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.deep.equal({ customResponse: true });
    });

    it('should proxy request to target HTTP server when protocol is set to "http"', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        requestHandler: async (req, res, httpRequestDetails) => {
          res.send({
            message: 'Hello from target HTTP server!',
            path: httpRequestDetails.url,
            receivedData: httpRequestDetails.body ? JSON.parse(httpRequestDetails.body) : null
          });
        }
      });

      proxyServerInfo = createHttpServer({
        port: PROXY_PORT,
        protocol: 'http',
        protocolHost: '127.0.0.1',
        protocolPort: TARGET_PORT
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/api/proxy-test`,
        method: 'POST',
        body: { action: 'proxy_ping' }
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.deep.equal({
        message: 'Hello from target HTTP server!',
        path: '/api/proxy-test',
        receivedData: { action: 'proxy_ping' }
      });
    });

    it('should execute custom proxyHandler passed as the second parameter', async function () {
      const customProxyHandler = sinon.spy(async (req, res, httpRequestDetails) => {
        res.send({ handledByCustomProxyHandler: true });
      });

      proxyServerInfo = createHttpServer(
        { port: PROXY_PORT },
        customProxyHandler
      );

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/test`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body).to.deep.equal({ handledByCustomProxyHandler: true });
      expect(customProxyHandler.calledOnce).to.be.true;
    });

    it('should enforce authentication hook and return 401 when rejected', async function () {
      const authSpy = sinon.spy(async (details) => {
        return details.headers['authorization'] === 'Bearer secret-token';
      });

      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        authenticate: authSpy,
        requestHandler: async (req, res) => {
          res.send({ status: 'authenticated' });
        }
      });

      // Request without header (Should Fail)
      const unauthResponse = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${TARGET_PORT}/protected`,
        method: 'GET'
      });

      expect(unauthResponse.statusCode).to.equal(401);
      expect(unauthResponse.body.error).to.include('HTTP Server custom authentication failed');

      // Request with correct header (Should Succeed)
      const authResponse = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${TARGET_PORT}/protected`,
        method: 'GET',
        headers: {
          authorization: 'Bearer secret-token'
        }
      });

      expect(authResponse.statusCode).to.equal(200);
      expect(authResponse.body).to.deep.equal({ status: 'authenticated' });
      expect(authSpy.calledTwice).to.be.true;
    });

    it('should return 401 if authenticate option is not a function', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        authenticate: 'invalid_auth_option'
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${TARGET_PORT}/test`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(401);
      expect(response.body.error).to.include('Authentication handler is not a function');
    });

    it('should return 504 Gateway Timeout if proxy destination is unreachable', async function () {
      const UNREACHABLE_PORT = 9999;

      proxyServerInfo = createHttpServer({
        port: PROXY_PORT,
        protocol: 'http',
        protocolHost: '127.0.0.1',
        protocolPort: UNREACHABLE_PORT
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/unreachable`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(504);
      expect(response.body.error).to.include('Gateway Timeout / Protocol Forwarding Failed');
    });
  });
});