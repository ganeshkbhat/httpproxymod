const { servers } = require('../index');
const { tcp: createTcpServer } = servers;

/**
 * Starts a TCP server using createTcpServer from index_12.js with custom handlers
 * for all lifecycle events (onConnect, onData, onClose, onEnd), and responds
 * with the received data.
 */
function startServer() {
    const options = {
        host: '127.0.0.1',
        port: process.env.PORT || 7000,

        // Lifecycle event: onConnect (Triggered when a client connects to the TCP server)
        onConnect: (socket) => {
            const remoteAddress = socket.remoteAddress;
            const remotePort = socket.remotePort;
            console.log('[TCP Lifecycle] onConnect: Client connected from %s:%d', remoteAddress, remotePort);

            // Additional native socket event listeners
            socket.on('error', (err) => {
                console.error('[TCP Socket Event] error:', err.message);
            });

            socket.on('timeout', () => {
                console.warn('[TCP Socket Event] timeout: Socket timed out.');
                socket.end();
            });
        },

        // Lifecycle event: onData (Triggered when a framed message is successfully parsed and received)
        onData: async (parsedData, socket) => {
            console.log('[TCP Lifecycle] onData: Received payload from client:', parsedData);

            const buffer = typeof parsedData === 'string'
                ? Buffer.from(parsedData, 'utf8')
                : Buffer.from(JSON.stringify(parsedData), 'utf8');

            const responsePayload = {
                status: 200,
                headers: { 'content-type': 'application/json' },
                body: {
                    receivedMessage: parsedData,
                    receivedHex: buffer.toString('hex'),
                    serverTime: new Date().toISOString()
                }
            };

            return responsePayload;
        },

        // Lifecycle event: onEnd (Triggered when the other end of the socket sends a FIN packet)
        onEnd: (socket) => {
            console.log('[TCP Lifecycle] onEnd: Client initiated socket termination (FIN received).');
        },

        // Lifecycle event: onClose (Triggered when the TCP socket is fully closed)
        onClose: (hadError, socket) => {
            console.log('[TCP Lifecycle] onClose: TCP socket closed. Had error:', hadError);
        }
    };

    // Create and start the TCP server using createTcpServer
    const tcpServerInstance = createTcpServer(options);

    console.log(`TCP server initialized and listening on ${options.host}:${options.port}`);
    return tcpServerInstance;
}

module.exports = {
    startServer
};

// Start server if run directly
if (require.main === module) {
    startServer();
}