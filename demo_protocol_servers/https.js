const { createHttpServer, getOrGenerateSelfSignedCert } = require('../index');

/**
 * Creates an HTTPS server using index.js's createHttpServer, sets up custom handlers
 * for all HTTPS lifecycle events, and responds with the received data.
 */
function startServer() {
    // 1. Get or generate self-signed SSL certificates for HTTPS
    const { key, cert } = getOrGenerateSelfSignedCert();

    // 2. Define custom request handler to echo received data as JSON
    const dataEchoHandler = async (req, res, httpRequestDetails) => {
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

    // 3. Configure options with HTTPS configuration and all lifecycle callbacks
    const options = {
        httpPort: process.env.PORT || 8443,
        useHttps: true,
        key: key,
        cert: cert,
        
        // Lifecycle event: onConnect (Emitted when a secure HTTPS/TLS request connection arrives)
        onConnect: (req, res) => {
            const socket = req.socket;
            console.log('[HTTPS Event] onConnect: Secure connection established from %s:%s for %s', 
                socket.remoteAddress, socket.remotePort, req.url);
            
            if (socket.encrypted) {
                console.log('[TLS Info] Cipher: %s, Protocol: %s', 
                    socket.getCipher().name, socket.getProtocol());
            }

            // Socket-level connection event listeners
            socket.on('secureConnection', () => {
                console.log('[Socket Event] secureConnection: TLS handshake completed successfully.');
            });
            socket.on('close', () => {
                console.log('[Socket Event] close: Client secure connection closed.');
            });
            socket.on('error', (err) => {
                console.error('[Socket Event] error:', err.message);
            });
        },

        // Lifecycle event: onEnd (Emitted when request body has been fully received)
        onEnd: (req, res) => {
            console.log('[HTTPS Event] onEnd: Secure request body fully received for %s %s', req.method, req.url);
        },

        // Lifecycle event: onClose (Emitted when response is finished/sent)
        onClose: (req, res) => {
            console.log('[HTTPS Event] onClose: Secure response sent / connection lifecycle completed for %s', req.url);
        },

        // Authentication handler (allow all)
        authenticate: async (httpRequestDetails) => {
            return true;
        }
    };

    // 4. Create the HTTPS server using index.js's createHttpServer
    const { server } = createHttpServer(options, dataEchoHandler);

    // 5. Attach additional native HTTPS/TLS server lifecycle event handlers
    server.on('secureConnection', (tlsSocket) => {
        console.log('[Server Event] secureConnection: New TLS socket connected from %s', tlsSocket.remoteAddress);
    });

    server.on('tlsClientError', (err, tlsSocket) => {
        console.error('[Server Event] tlsClientError during handshake:', err.message);
    });

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
        console.log('[Server Event] connect: HTTPS CONNECT method requested for %s', req.url);
        socket.write('HTTP/1.1 501 Method Not Implemented\r\n\r\n');
        socket.end();
    });

    server.on('upgrade', (req, socket, head) => {
        console.log('[Server Event] upgrade: HTTPS upgrade requested for %s', req.url);
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
        console.log('[Server Event] close: HTTPS server closed.');
    });

    console.log(`HTTPS server initialized and listening securely on port ${options.httpPort}`);
    return server;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}