const fs = require('fs');
const path = require('path');
const { createHttpServer } = require('../index');

/**
 * HTTP Server dedicated to verifying and triggering stream lifecycle callbacks 
 * for sendHttpRequest (onConnection, onData, onEnd, onClose, onDestroy, onError).
 */
const serverInfo = createHttpServer({
  port: 8080,
  requestHandler: async (req, res, httpRequestDetails) => {
    const url = httpRequestDetails.url;
    const method = httpRequestDetails.method;

    // ========================================================================
    // 1. Chunked Response Stream Route (triggers onConnection, onData, onEnd, onClose, onDestroy)
    // ========================================================================
    if (url === '/api/stream-test' && method === 'POST') {
      console.log('[Lifecycle Server] Received chunked streaming request');

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
        'X-Server-Lifecycle': 'active'
      });

      // Write discrete chunks with delays to verify onData and stream execution
      res.write(JSON.stringify({ step: 1, message: 'Processing stream...' }) + '\n');

      setTimeout(() => {
        res.write(JSON.stringify({ step: 2, message: 'Streaming payload chunk...' }) + '\n');
      }, 100);

      setTimeout(() => {
        res.end(JSON.stringify({ status: 'completed', message: 'Stream finished' }));
        console.log('[Lifecycle Server] Responded and closed stream cleanly');
      }, 200);

      return;
    }

    // ========================================================================
    // 2. Timeout / Abort Route (triggers onError, onClose, onDestroy)
    // ========================================================================
    if (url === '/api/timeout-test') {
      console.log('[Lifecycle Server] Timeout request received. Holding socket open...');
      // Intentional hang: Never call res.end() or res.write() to trigger client timeout
      return;
    }

    // ========================================================================
    // 3. Socket Abrupt Destruction Route (triggers onError / onClose)
    // ========================================================================
    if (url === '/api/destroy-test') {
      console.log('[Lifecycle Server] Destroy request received. Forcefully destroying socket...');
      req.socket.destroy();
      return;
    }

    // ========================================================================
    // Fallback Standard Route
    // ========================================================================
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', route: url }));
  }
});