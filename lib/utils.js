const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');
const { logger, createLogger } = require('./logger');

async function downloadFile(url, outputPath) {
  const utilsLogger = createLogger('downloader');
  
  try {
    utilsLogger.info(`📥 Downloading ${url}...`);
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream',
      timeout: 30000 // 30 second timeout
    });

    await fs.ensureDir(path.dirname(outputPath));
    const writer = fs.createWriteStream(outputPath);
    
    // Pipe the response data to the file
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        utilsLogger.info('✅ Download completed');
        resolve();
      });
      writer.on('error', (err) => {
        utilsLogger.error(`❌ Download failed: ${err.message}`);
        reject(err);
      });
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
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
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
    60: 120,
    120: 240
  };
  
  // Find closest standard FPS
  const standardFPS = Object.keys(gopMap).map(Number).reduce((prev, curr) => 
    Math.abs(curr - fps) < Math.abs(prev - fps) ? curr : prev
  );
  
  // Return GOP size or calculate dynamically for non-standard frame rates
  const gopSize = gopMap[standardFPS] || Math.round(fps * 2);
  
  // Ensure GOP size is reasonable (between 24 and 480)
  return Math.max(24, Math.min(480, gopSize));
}

// Additional utility functions for advanced transcoding

function calculateSegmentCount(duration, segmentDuration) {
  if (!duration || !segmentDuration) return 0;
  return Math.ceil(duration / segmentDuration);
}

function estimateTranscodingTime(sourceInfo, targetHeight, useGpu = false) {
  if (!sourceInfo || !sourceInfo.duration) return 0;
  
  // Base time estimation (seconds per minute of video)
  const baseTimePerMinute = useGpu ? 15 : 45; // GPU is ~3x faster
  
  // Resolution factor (higher resolution takes more time)
  const resolutionFactor = targetHeight / 720;
  
  // Frame rate factor (higher FPS takes more time)
  const fpsFactor = (sourceInfo.fps || 30) / 30;
  
  // Estimate total time in seconds
  const estimatedMinutes = sourceInfo.duration / 60;
  return Math.round(estimatedMinutes * baseTimePerMinute * resolutionFactor * fpsFactor);
}

function getMemoryRequirements(targetHeight, useGpu = false) {
  // Estimate memory requirements in MB
  const baseMemory = targetHeight < 480 ? 512 :
                    targetHeight < 720 ? 1024 :
                    targetHeight < 1080 ? 2048 :
                    targetHeight < 2160 ? 4096 :
                    targetHeight < 4320 ? 8192 : 16384;
  
  // GPU typically requires less memory due to hardware acceleration
  return useGpu ? Math.round(baseMemory * 0.7) : baseMemory;
}

function isValidResolution(width, height) {
  // Check if dimensions are valid (positive integers)
  if (!Number.isInteger(width) || !Number.isInteger(height)) return false;
  if (width <= 0 || height <= 0) return false;
  if (width > 100000 || height > 100000) return false; // Reasonable upper limit
  return true;
}

function normalizeResolution(width, height) {
  // Ensure dimensions are even (required by most codecs)
  const normalizedWidth = width % 2 === 0 ? width : width + 1;
  const normalizedHeight = height % 2 === 0 ? height : height + 1;
  
  // Ensure minimum dimensions
  return {
    width: Math.max(16, normalizedWidth),
    height: Math.max(16, normalizedHeight)
  };
}

module.exports = {
  downloadFile,
  isUrl,
  formatFileSize,
  sanitizeFilename,
  getGOPSize,
  calculateSegmentCount,
  estimateTranscodingTime,
  getMemoryRequirements,
  isValidResolution,
  normalizeResolution
};
