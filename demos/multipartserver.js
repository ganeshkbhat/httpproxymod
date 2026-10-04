const fs = require('fs');
const path = require('path');
const { createHttpServer } = require('../index');

const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure destination uploads directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: Object });
}

/**
 * Basic helper parser for multipart/form-data payloads.
 * Parses textual form fields and extracts file contents + metadata.
 *
 * @param {string|Buffer} body - Request payload buffer or string.
 * @param {string} boundary - Multipart boundary string.
 * @returns {Object} `{ fields: Object, files: Array<Object> }`
 */
function parseMultipartBody(body, boundary) {
  const fields = {};
  const files = [];

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1');
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const doubleCRLF = Buffer.from('\r\n\r\n');

  let start = 0;

  while (start < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundaryIndex === -1) break;

    const partBuffer = buffer.slice(boundaryIndex + boundaryBuffer.length + 2, nextBoundaryIndex - 2);
    const headerEndIndex = partBuffer.indexOf(doubleCRLF);

    if (headerEndIndex !== -1) {
      const headerText = partBuffer.slice(0, headerEndIndex).toString('utf8');
      const contentBuffer = partBuffer.slice(headerEndIndex + 4);

      const dispositionMatch = headerText.match(/Content-Disposition:\0* form-data;\0* name="([^"]+)"(?:;\0* filename="([^"]+)")?/i);

      if (dispositionMatch) {
        const fieldName = dispositionMatch[1];
        const fileName = dispositionMatch[2];

        if (fileName) {
          const contentTypeMatch = headerText.match(/Content-Type:\0* ([^\r\n]+)/i);
          const contentType = contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream';

          files.push({
            fieldName: fieldName,
            fileName: fileName,
            contentType: contentType,
            data: contentBuffer
          });
        } else {
          fields[fieldName] = contentBuffer.toString('utf8');
        }
      }
    }

    start = nextBoundaryIndex;
  }

  return { fields, files };
}

// Instantiate target server with custom request handler routing
const serverInfo = createHttpServer({
  port: 8080,
  requestHandler: async (req, res, httpRequestDetails) => {
    const url = httpRequestDetails.url;
    const method = httpRequestDetails.method;
    const headers = httpRequestDetails.headers;
    const contentType = headers['content-type'] || headers['Content-Type'] || '';

    // ========================================================================
    // 1. Binary File Upload Handler (`application/octet-stream`)
    // ========================================================================
    if (url === '/api/upload/binary' && method === 'POST') {
      const fileName = headers['x-file-name'] || `binary_${Date.now()}.bin`;
      const savePath = path.join(UPLOAD_DIR, fileName);

      const rawBuffer = Buffer.isBuffer(httpRequestDetails.body)
        ? httpRequestDetails.body
        : Buffer.from(httpRequestDetails.body, 'latin1');

      fs.writeFileSync(savePath, rawBuffer);

      return res.send({
        status: 'success',
        message: 'Binary file uploaded successfully',
        file: {
          originalName: fileName,
          savedPath: savePath,
          sizeBytes: rawBuffer.length,
          contentType: contentType
        }
      });
    }

    // ========================================================================
    // 2. Multipart Form Data Handler (`multipart/form-data`)
    // ========================================================================
    if (url === '/api/upload/multipart' && method === 'POST') {
      const boundaryMatch = contentType.match(/boundary=(?:([^;]+)|"([^"]+)")/i);

      if (!boundaryMatch) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'Missing or invalid boundary in Content-Type header' }));
      }

      const boundary = boundaryMatch[1] || boundaryMatch[2];
      const { fields, files } = parseMultipartBody(httpRequestDetails.body, boundary);

      const savedFiles = files.map((file) => {
        const savedFileName = `${Date.now()}_${file.fileName}`;
        const savePath = path.join(UPLOAD_DIR, savedFileName);
        fs.writeFileSync(savePath, file.data);

        return {
          fieldName: file.fieldName,
          originalName: file.fileName,
          savedPath: savePath,
          sizeBytes: file.data.length,
          contentType: file.contentType
        };
      });

      return res.send({
        status: 'success',
        message: 'Multipart payload processed successfully',
        receivedFields: fields,
        uploadedFiles: savedFiles
      });
    }

    // ========================================================================
    // 3. Fallback 404 Route
    // ========================================================================
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Route not found' }));
  }
});