const fs = require('fs');
const path = require('path');
const { sendHttpRequest } = require('../index');

/**
 * Constructs a multipart/form-data Buffer and boundary string.
 *
 * @param {Object} fields - Key-value map of form fields.
 * @param {Array<Object>} files - List of file objects to attach [{ fieldName, fileName, contentType, buffer }].
 * @returns {Object} `{ boundary: string, bodyBuffer: Buffer }`
 */
function buildMultipartPayload(fields = {}, files = []) {
  const boundary = '----NodeHttpClientBoundary' + Math.random().toString(16).substring(2);
  const chunks = [];

  // 1. Append regular text fields
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${key}"\r\n\r\n`));
    chunks.push(Buffer.from(`${value}\r\n`));
  }

  // 2. Append file attachments
  for (const file of files) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    chunks.push(Buffer.from(`Content-Disposition: form-data; name="${file.fieldName}"; filename="${file.fileName}"\r\n`));
    chunks.push(Buffer.from(`Content-Type: ${file.contentType || 'application/octet-stream'}\r\n\r\n`));
    chunks.push(file.buffer);
    chunks.push(Buffer.from('\r\n'));
  }

  // 3. Append closing boundary
  chunks.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    boundary: boundary,
    bodyBuffer: Buffer.concat(chunks)
  };
}

async function uploadMultipartFormData() {
  const filePath = path.join(__dirname, 'document.pdf');
  const pdfBuffer = fs.readFileSync(filePath);

  const { boundary, bodyBuffer } = buildMultipartPayload(
    {
      userId: '102938',
      description: 'Quarterly Financial Report'
    },
    [
      {
        fieldName: 'attachment',
        fileName: 'document.pdf',
        contentType: 'application/pdf',
        buffer: pdfBuffer
      }
    ]
  );

  try {
    const response = await sendHttpRequest({
      targetUrl: 'http://127.0.0.1:8080/api/upload/multipart',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer,
      timeout: 15000
    });

    console.log('Multipart Upload Status:', response.statusCode);
    console.log('Server Response:', response.body);
  } catch (err) {
    console.error('Multipart upload failed:', err.message);
  }
}

uploadMultipartFormData();