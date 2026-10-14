// Complete UDP-to-Socket Proxy Handler Implementation
const net = require('net');
const dgram = require('dgram');

function createUdpToSocketProxy(socketPath, options = {}) {
  const timeoutMs = options.timeout || 3000;

  return async function handleUdpMessage(msg, rinfo, sendResponseCallback) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = net.createConnection(socketPath);

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          client.destroy();
          const errRes = { status: 504, body: 'Gateway Timeout' };
          if (sendResponseCallback) sendResponseCallback(errRes);
          reject(new Error('504 Gateway Timeout'));
        }
      }, timeoutMs);

      client.on('connect', () => {
        client.write(msg);
      });

      client.on('data', (data) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          client.end();
          
          let responseObj;
          try {
            responseObj = JSON.parse(data.toString());
          } catch (e) {
            responseObj = { raw: data.toString() };
          }

          const result = {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: responseObj
          };

          if (sendResponseCallback) sendResponseCallback(result);
          resolve(result);
        }
      });

      client.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          client.destroy();
          const errRes = { status: 504, body: err.message };
          if (sendResponseCallback) sendResponseCallback(errRes);
          reject(err);
        }
      });
    });
  };
}

module.exports = { createUdpToSocketProxy };