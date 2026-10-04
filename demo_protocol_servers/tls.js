const { servers, getOrGenerateSelfSignedCert } = require('../index');
const { tls: createTlsServer } = servers;

/**
 * Starts a TLS server using createTlsServer from index_13.js with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * with the received data.
 */
function startServer() {
    // Generate or fetch self-signed certificates for secure TLS connection
    const { key, cert } = getOrGenerateSelfSignedCert();

    const options = {
        host: '127.0.0.1',
        port: process.env.PORT || 7001,
        key: key,
        cert: cert,
        rejectUnauthorized: false,

        // Lifecycle event: onConnect (Triggered when a client establishes a secure TLS connection)
        onConnect: (socket) => {
            const remoteAddress = socket.remoteAddress;
            const remotePort = socket.remotePort;
            const authorized = socket.authorized;
            console.log('[TLS Lifecycle] onConnect: Secure client connected from %s:%d (Authorized: %s)', remoteAddress, remotePort, authorized);

            // Additional native TLS/socket event listeners
            socket.on('error', (err) => {
                console.error('[TLS Socket Event] error:', err.message);
            });

            socket.on('timeout', () => {
                console.warn('[TLS Socket Event] timeout: Secure socket timed out.');
                socket.end();
            });
        },

        // Lifecycle event: onData (Triggered when a framed message is successfully parsed and received)
        onData: async (parsedData, socket) => {
            console.log('[TLS Lifecycle] onData: Received secure payload from client:', parsedData);

            const buffer = typeof parsedData === 'string'
                ? Buffer.from(parsedData, 'utf8')
                : Buffer.from(JSON.stringify(parsedData), 'utf8');

            const responsePayload = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: {
                    receivedMessage: parsedData,
                    receivedHex: buffer.toString('hex'),
                    serverTime: new Date().toISOString(),
                    secureProtocol: socket.getProtocol()
                }
            };

            return responsePayload;
        },

        // Lifecycle event: onEnd (Triggered when the other end of the secure socket sends a FIN packet)
        onEnd: (socket) => {
            console.log('[TLS Lifecycle] onEnd: Client initiated secure socket termination (FIN received).');
        },

        // Lifecycle event: onClose (Triggered when the TLS socket is fully closed)
        onClose: (hadError, socket) => {
            console.log('[TLS Lifecycle] onClose: TLS socket closed. Had error:', hadError);
        }
    };

    // Create and start the TLS server using createTlsServer
    const tlsServerInstance = createTlsServer(options);

    console.log(`TLS server initialized and listening on ${options.host}:${options.port}`);
    return tlsServerInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}