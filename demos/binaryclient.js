const fs = require('fs');
const path = require('path');
const { sendHttpRequest } = require('../index');

async function uploadBinaryFile() {
  const filePath = path.join(__dirname, 'sample.png');

  try {
    // Read file into a Buffer
    const fileBuffer = fs.readFileSync(filePath);

    const response = await sendHttpRequest({
      targetUrl: 'http://127.0.0.1:8080/api/upload/binary',
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': path.basename(filePath)
      },
      body: fileBuffer,
      timeout: 10000
    });

    console.log('Upload Status:', response.statusCode);
    console.log('Server Response:', response.body);
  } catch (err) {
    console.error('Binary upload failed:', err.message);
  }
}

uploadBinaryFile();