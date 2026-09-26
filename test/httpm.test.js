const { expect } = require('chai');
const sinon = require('sinon');
const http = require('http');
const https = require('https');
const { createHttpServer, sendHttpRequest } = require('../httpm');

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
        requestHandler: async (req, res) => {
          // Intentionally do not respond to force a timeout
        }
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

    it('should proxy requests through proxyServer to targetServer using defaultProxyHandler', async function () {
      targetServerInfo = createHttpServer({
        port: TARGET_PORT,
        requestHandler: async (req, res, httpRequestDetails) => {
          res.send({
            proxied: true,
            path: httpRequestDetails.url,
            data: httpRequestDetails.body ? JSON.parse(httpRequestDetails.body) : null
          });
        }
      });

      proxyServerInfo = createHttpServer({
        port: PROXY_PORT,
        protocolHost: '127.0.0.1',
        protocolPort: TARGET_PORT
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/api/v1/resource`,
        method: 'POST',
        body: { hello: 'world' }
      });

      expect(response.statusCode).to.equal(200);
      expect(response.body.proxied).to.be.true;
      expect(response.body.path).to.equal('/api/v1/resource');
      expect(response.body.data).to.deep.equal({ hello: 'world' });
    });

    it('should return 504 Gateway Timeout if proxy destination is unreachable', async function () {
      const UNREACHABLE_PORT = 9999;

      proxyServerInfo = createHttpServer({
        port: PROXY_PORT,
        protocolHost: '127.0.0.1',
        protocolPort: UNREACHABLE_PORT
      });

      const response = await sendHttpRequest({
        targetUrl: `http://127.0.0.1:${PROXY_PORT}/unreachable`,
        method: 'GET'
      });

      expect(response.statusCode).to.equal(504);
      expect(response.body.error).to.include('Gateway Timeout / Proxy Request Failed');
    });
  });
});