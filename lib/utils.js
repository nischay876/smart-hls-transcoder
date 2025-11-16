const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');

async function downloadFile(url, outputPath) {
  try {
    console.log(`📥 Downloading ${url}...`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    await fs.ensureDir(path.dirname(outputPath));
    const writer = fs.createWriteStream(outputPath);
    
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('✅ Download completed');
        resolve();
      });
      writer.on('error', reject);
    });
  } catch (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

function isUrl(string) {
  return string.startsWith('http://') || string.startsWith('https://');
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function getGOPSize(fps) {
  // Standard GOP sizes for common frame rates
  const gopMap = {
    24: 48,
    25: 50,
    30: 60,
    50: 100,
    60: 120
  };
  
  // Find closest standard FPS
  const standardFPS = Object.keys(gopMap).map(Number).reduce((prev, curr) => 
    Math.abs(curr - fps) < Math.abs(prev - fps) ? curr : prev
  );
  
  return gopMap[standardFPS] || Math.round(fps * 2);
}

module.exports = {
  downloadFile,
  isUrl,
  formatFileSize,
  sanitizeFilename,
  getGOPSize
};
