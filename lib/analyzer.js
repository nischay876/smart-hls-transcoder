const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');

function analyzeSource(inputFile) {
  return new Promise((resolve, reject) => {
    console.log('🔍 Analyzing source file...');
    
    ffmpeg.ffprobe(inputFile, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to analyze source: ${err.message}`));
        return;
      }

      try {
        const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
        
        if (!videoStream) {
          reject(new Error('No video stream found in source file'));
          return;
        }

        // Get video dimensions
        let width = videoStream.width;
        let height = videoStream.height;
        
        // Handle rotation if present
        if (videoStream.tags && videoStream.tags.rotate) {
          const rotation = parseInt(videoStream.tags.rotate);
          if (rotation === 90 || rotation === 270) {
            [width, height] = [height, width];
          }
        }

        // Calculate aspect ratio
        const aspectRatio = width / height;

        // Get duration
        const duration = parseFloat(metadata.format.duration) || 0;

        // Get video bitrate (if available)
        let videoBitrate = null;
        if (metadata.format.bit_rate) {
          videoBitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000); // kbps
        } else if (videoStream.bit_rate) {
          videoBitrate = Math.round(parseInt(videoStream.bit_rate) / 1000); // kbps
        }

        // Get frame rate
        let fps = 30;
        if (videoStream.avg_frame_rate) {
          const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
          if (den !== 0) {
            fps = Math.round(num / den);
          }
        }

        // Determine source quality level
        const sourceQuality = determineSourceQuality(height, videoBitrate);

        console.log(`📊 Source Analysis Results:`);
        console.log(`   Resolution: ${width}x${height} (${Math.round(height)}p)`);
        console.log(`   Aspect Ratio: ${aspectRatio.toFixed(2)}`);
        console.log(`   Duration: ${formatDuration(duration)}`);
        console.log(`   Frame Rate: ${fps} fps`);
        console.log(`   Bitrate: ${videoBitrate ? videoBitrate + ' kbps' : 'Unknown'}`);
        console.log(`   Detected Quality Level: ${sourceQuality.name}`);

        resolve({
          width,
          height,
          aspectRatio,
          duration,
          fps,
          videoBitrate,
          sourceQuality,
          videoStream,
          audioStream
        });
      } catch (analysisError) {
        reject(new Error(`Failed to parse metadata: ${analysisError.message}`));
      }
    });
  });
}

function determineSourceQuality(height, bitrate) {
  // Quality definitions with thresholds
  const qualities = [
    { name: '4K', minHeight: 2100, maxHeight: 4320, minBitrate: 15000, maxBitrate: 50000 },
    { name: '1440p', minHeight: 1400, maxHeight: 2100, minBitrate: 8000, maxBitrate: 20000 },
    { name: '1080p', minHeight: 1000, maxHeight: 1400, minBitrate: 4000, maxBitrate: 12000 },
    { name: '720p', minHeight: 650, maxHeight: 1000, minBitrate: 2000, maxBitrate: 6000 },
    { name: '480p', minHeight: 400, maxHeight: 650, minBitrate: 1000, maxBitrate: 3000 },
    { name: '360p', minHeight: 300, maxHeight: 400, minBitrate: 500, maxBitrate: 1500 },
    { name: '240p', minHeight: 200, maxHeight: 300, minBitrate: 300, maxBitrate: 800 },
    { name: '144p', minHeight: 0, maxHeight: 200, minBitrate: 100, maxBitrate: 400 }
  ];

  for (const quality of qualities) {
    if (height >= quality.minHeight && height <= quality.maxHeight) {
      return {
        ...quality,
        actualHeight: height,
        actualBitrate: bitrate
      };
    }
  }

  // Fallback for unknown sizes
  return {
    name: 'Custom',
    minHeight: 0,
    maxHeight: height,
    minBitrate: bitrate ? Math.max(100, bitrate * 0.3) : 500,
    maxBitrate: bitrate || 5000,
    actualHeight: height,
    actualBitrate: bitrate
  };
}

function formatDuration(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function getOptimalQualities(sourceHeight, minQuality = 360) {
  const allQualities = [
    { height: 2160, name: '4K', enabled: true },
    { height: 1440, name: '1440p', enabled: true },
    { height: 1080, name: '1080p', enabled: true },
    { height: 720, name: '720p', enabled: true },
    { height: 540, name: '540p', enabled: true },
    { height: 480, name: '480p', enabled: true },
    { height: 360, name: '360p', enabled: true },
    { height: 240, name: '240p', enabled: true },
    { height: 144, name: '144p', enabled: true }
  ];

  // Filter out qualities that would upscale the source
  const validQualities = allQualities.filter(q => q.height <= sourceHeight);
  
  // Filter by minimum quality requirement
  const minQualities = validQualities.filter(q => q.height >= minQuality);
  
  return minQualities.length > 0 ? minQualities : [allQualities.find(q => q.height === minQuality) || allQualities[0]];
}

module.exports = {
  analyzeSource,
  getOptimalQualities
};
