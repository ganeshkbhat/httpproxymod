const { createHttpServer } = require('../index');

/**
 * Creates an HTTP server using index.js's createHttpServer, sets up custom handlers
 * for all HTTP lifecycle events, and responds with the received data.
 */
function startServer() {
    // 1. Define custom request/proxy handler to echo received data as JSON
    const dataEchoHandler = async (req, res, httpRequestDetails) => {
        // Collect request details and echoed body data
        const bodyBuffer = Buffer.from(httpRequestDetails.body || '', 'utf8');
        
        const responsePayload = {
            method: httpRequestDetails.method,
            url: httpRequestDetails.url,
            headers: httpRequestDetails.headers,
            body: httpRequestDetails.body,
            bodyHex: bodyBuffer.toString('hex')
        };

        return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(responsePayload, null, 2)
        };
    };

    // 2. Configure options with event lifecycle callbacks
    const options = {
        httpPort: process.env.PORT || 3000,
        
        // Lifecycle event: onConnect (Emitted when a new request connection arrives)
        onConnect: (req, res) => {
            console.log('[HTTP Event] onConnect: New request from %s for %s', req.socket.remoteAddress, req.url);
            
            // Listen to socket-level connection events
            req.socket.on('close', () => {
                console.log('[Socket Event] close: Client connection closed.');
            });
            req.socket.on('error', (err) => {
                console.error('[Socket Event] error:', err.message);
            });
        },

        // Lifecycle event: onEnd (Emitted when request body has been fully received)
        onEnd: (req, res) => {
            console.log('[HTTP Event] onEnd: Request body fully received for %s %s', req.method, req.url);
        },

        // Lifecycle event: onClose (Emitted when response is finished/sent)
        onClose: (req, res) => {
            console.log('[HTTP Event] onClose: Response sent / connection lifecycle completed for %s', req.url);
        },

        // Authentication handler (allow all)
        authenticate: async (httpRequestDetails) => {
            return true;
        }
    };

    // 3. Create the server using index.js's createHttpServer
    const { server } = createHttpServer(options, dataEchoHandler);

    // 4. Attach additional native HTTP/net server lifecycle event handlers
    server.on('checkContinue', (req, res) => {
        console.log('[Server Event] checkContinue: Received 100-continue expectation.');
        res.writeContinue();
    });

    server.on('checkExpectation', (req, res) => {
        console.log('[Server Event] checkExpectation: Received non-100 expectation.');
        res.writeHead(417, { 'Content-Type': 'text/plain' });
        res.end('Expectation Failed');
    });

    server.on('connect', (req, socket, head) => {
        console.log('[Server Event] connect: HTTP CONNECT method requested for %s', req.url);
        socket.write('HTTP/1.1 501 Method Not Implemented\r\n\r\n');
        socket.end();
    });

    server.on('upgrade', (req, socket, head) => {
        console.log('[Server Event] upgrade: HTTP upgrade requested for %s', req.url);
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.end();
    });

    server.on('clientError', (err, socket) => {
        console.error('[Server Event] clientError:', err.message);
        if (!socket.writable) {
            socket.destroy();
            return;
        }
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });

    server.on('close', () => {
        console.log('[Server Event] close: HTTP server closed.');
    });

    console.log(`HTTP server initialized and listening on port ${options.httpPort}`);
    return server;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}