const fs = require('fs');
const path = require('path');
const { createHttpServer } = require('../index');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure destination uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const serverInfo = createHttpServer({
  port: 8080,
  requestHandler: async (req, res, httpRequestDetails) => {
    const url = httpRequestDetails.url;
    const method = httpRequestDetails.method;
    const headers = httpRequestDetails.headers;
    const contentType = headers['content-type'] || headers['Content-Type'] || '';

    // Route for uploadBinaryFile demo endpoint
    if (url === '/api/upload/binary' && method === 'POST') {
      if (!contentType.includes('application/octet-stream')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Invalid Content-Type. Expected application/octet-stream'
        }));
      }

      // Extract original file name from custom header or fallback to timestamp
      const fileName = headers['x-file-name'] || `upload_${Date.now()}.bin`;
      const savePath = path.join(UPLOAD_DIR, fileName);

      // Convert incoming body into a raw Buffer
      const rawBuffer = Buffer.isBuffer(httpRequestDetails.body)
        ? httpRequestDetails.body
        : Buffer.from(httpRequestDetails.body, 'binary');

      try {
        fs.writeFileSync(savePath, rawBuffer);

        return res.send({
          status: 'success',
          message: 'Binary file uploaded and saved successfully',
          file: {
            fileName: fileName,
            savedPath: savePath,
            bytesReceived: rawBuffer.length,
            contentType: contentType
          }
        });
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Failed to write file to disk',
          details: err.message
        }));
      }
    }

    // Fallback 404
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));
  }
});