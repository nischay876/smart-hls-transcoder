const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { logger, createLogger } = require('./logger');

function analyzeSource(inputFile) {
  const analyzeLogger = createLogger('analyzer');
  return new Promise((resolve, reject) => {
    analyzeLogger.info('🔍 Analyzing source file...');
    
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

        // Get video dimensions with advanced handling
        let width = videoStream.width;
        let height = videoStream.height;
        
        // Handle rotation if present
        if (videoStream.tags && videoStream.tags.rotate) {
          const rotation = parseInt(videoStream.tags.rotate);
          if (rotation === 90 || rotation === 270) {
            [width, height] = [height, width];
          }
        }

        // Handle display aspect ratio if different from storage aspect ratio
        if (videoStream.display_aspect_ratio) {
          const [darNum, darDen] = videoStream.display_aspect_ratio.split(':').map(Number);
          if (darNum && darDen && darDen !== 0) {
            const displayAspectRatio = darNum / darDen;
            const storageAspectRatio = width / height;
            
            // If DAR differs significantly from SAR, adjust dimensions
            if (Math.abs(displayAspectRatio - storageAspectRatio) > 0.01) {
              analyzeLogger.info(`   Adjusting for display aspect ratio: ${displayAspectRatio}`);
              // We'll maintain the storage dimensions but note the DAR for encoding
            }
          }
        }

        // Calculate aspect ratio
        const aspectRatio = width / height;

        // Get duration
        const duration = parseFloat(metadata.format.duration) || 0;

        // Get video bitrate with multiple fallback methods
        let videoBitrate = null;
        if (metadata.format.bit_rate) {
          videoBitrate = Math.round(parseInt(metadata.format.bit_rate) / 1000); // kbps
        } else if (videoStream.bit_rate) {
          videoBitrate = Math.round(parseInt(videoStream.bit_rate) / 1000); // kbps
        } else if (videoStream.avg_bitrate) {
          videoBitrate = Math.round(parseInt(videoStream.avg_bitrate) / 1000); // kbps
        }

        // Get frame rate with advanced parsing
        let fps = 30;
        let fpsSource = 'default';
        if (videoStream.avg_frame_rate && videoStream.avg_frame_rate !== '0/0') {
          const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
          if (den !== 0) {
            fps = Math.round((num / den) * 1000) / 1000; // Round to 3 decimal places
            fpsSource = 'avg_frame_rate';
          }
        } else if (videoStream.r_frame_rate && videoStream.r_frame_rate !== '0/0') {
          const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
          if (den !== 0) {
            fps = Math.round((num / den) * 1000) / 1000;
            fpsSource = 'r_frame_rate';
          }
        }

        // Get pixel format and color space information
        const pixFmt = videoStream.pix_fmt || 'unknown';
        const colorSpace = videoStream.color_space || 'unknown';
        const colorTransfer = videoStream.color_transfer || 'unknown';
        const colorPrimaries = videoStream.color_primaries || 'unknown';

        // Get codec information
        const codecName = videoStream.codec_name || 'unknown';
        const codecProfile = videoStream.profile || 'unknown';

        // Advanced quality analysis
        const sourceQuality = determineAdvancedSourceQuality(height, videoBitrate, fps, codecName, pixFmt);

        // Get audio information if available
        let audioInfo = null;
        if (audioStream) {
          audioInfo = {
            codec: audioStream.codec_name || 'unknown',
            channels: audioStream.channels || 2,
            sampleRate: audioStream.sample_rate ? parseInt(audioStream.sample_rate) : 44100,
            bitrate: audioStream.bit_rate ? Math.round(parseInt(audioStream.bit_rate) / 1000) : null
          };
        }

        // Get file size
        const fileSize = metadata.format.size ? parseInt(metadata.format.size) : 0;

        analyzeLogger.info(`📊 Source Analysis Results:`);
        analyzeLogger.info(`   Resolution: ${width}x${height} (${Math.round(height)}p)`);
        analyzeLogger.info(`   Aspect Ratio: ${aspectRatio.toFixed(2)}`);
        analyzeLogger.info(`   Duration: ${formatDuration(duration)}`);
        analyzeLogger.info(`   Frame Rate: ${fps} fps (from ${fpsSource})`);
        analyzeLogger.info(`   Bitrate: ${videoBitrate ? videoBitrate + ' kbps' : 'Unknown'}`);
        analyzeLogger.info(`   Codec: ${codecName} (${codecProfile})`);
        analyzeLogger.info(`   Pixel Format: ${pixFmt}`);
        analyzeLogger.info(`   Color Space: ${colorSpace}`);
        analyzeLogger.info(`   Detected Quality Level: ${sourceQuality.name}`);
        if (audioInfo) {
          analyzeLogger.info(`   Audio: ${audioInfo.codec}, ${audioInfo.channels} channels, ${audioInfo.sampleRate}Hz`);
        }

        resolve({
          width,
          height,
          aspectRatio,
          duration,
          fps,
          videoBitrate,
          sourceQuality,
          videoStream,
          audioStream,
          audioInfo,
          fileSize,
          codecName,
          codecProfile,
          pixFmt,
          colorSpace,
          colorTransfer,
          colorPrimaries
        });
      } catch (analysisError) {
        reject(new Error(`Failed to parse metadata: ${analysisError.message}`));
      }
    });
  });
}

function determineAdvancedSourceQuality(height, bitrate, fps, codecName, pixFmt) {
  // Extended quality definitions with more granular thresholds
  const qualities = [
    { name: '8K+', minHeight: 6000, maxHeight: 99999, minBitrate: 50000, maxBitrate: 200000, description: 'Beyond 8K Ultra HD' },
    { name: '8K', minHeight: 5760, maxHeight: 6000, minBitrate: 40000, maxBitrate: 150000, description: '8K Ultra HD (5760p)' },
    { name: '7K', minHeight: 5040, maxHeight: 5760, minBitrate: 30000, maxBitrate: 100000, description: '7K Ultra HD (5040p)' },
    { name: '6K', minHeight: 4320, maxHeight: 5040, minBitrate: 20000, maxBitrate: 80000, description: '6K Ultra HD (4320p)' },
    { name: '5K', minHeight: 3600, maxHeight: 4320, minBitrate: 15000, maxBitrate: 60000, description: '5K Ultra HD (3600p)' },
    { name: '4K', minHeight: 2880, maxHeight: 3600, minBitrate: 10000, maxBitrate: 40000, description: '4K Ultra HD (2880p-3600p)' },
    { name: 'QHD+', minHeight: 2160, maxHeight: 2880, minBitrate: 8000, maxBitrate: 30000, description: 'Quad HD Plus (2160p-2880p)' },
    { name: '4K', minHeight: 1920, maxHeight: 2160, minBitrate: 6000, maxBitrate: 25000, description: 'Ultra HD 4K (1920p-2160p)' },
    { name: 'QHD', minHeight: 1440, maxHeight: 1920, minBitrate: 4000, maxBitrate: 15000, description: 'Quad HD (1440p)' },
    { name: '1080p', minHeight: 1000, maxHeight: 1440, minBitrate: 2500, maxBitrate: 10000, description: 'Full HD (1000p-1440p)' },
    { name: '720p', minHeight: 650, maxHeight: 1000, minBitrate: 1500, maxBitrate: 6000, description: 'HD (650p-1000p)' },
    { name: '480p', minHeight: 400, maxHeight: 650, minBitrate: 800, maxBitrate: 3000, description: 'Standard Definition (400p-650p)' },
    { name: '360p', minHeight: 300, maxHeight: 400, minBitrate: 500, maxBitrate: 1500, description: 'Low Definition (300p-400p)' },
    { name: '240p', minHeight: 200, maxHeight: 300, minBitrate: 300, maxBitrate: 800, description: 'Very Low Definition (200p-300p)' },
    { name: '144p', minHeight: 0, maxHeight: 200, minBitrate: 100, maxBitrate: 400, description: 'Minimal Quality (0p-200p)' }
  ];

  // Find matching quality based on height
  for (const quality of qualities) {
    if (height >= quality.minHeight && height <= quality.maxHeight) {
      // Adjust for bitrate and other factors
      let adjustedMinBitrate = quality.minBitrate;
      let adjustedMaxBitrate = quality.maxBitrate;
      
      // Adjust for frame rate (higher fps = higher quality requirement)
      const fpsMultiplier = fps > 60 ? 1.5 : fps > 30 ? 1.2 : 1.0;
      adjustedMinBitrate = Math.round(adjustedMinBitrate * fpsMultiplier);
      adjustedMaxBitrate = Math.round(adjustedMaxBitrate * fpsMultiplier);
      
      // Adjust for pixel format (higher bit depth = higher quality)
      let pixFmtMultiplier = 1.0;
      if (pixFmt.includes('10le') || pixFmt.includes('10be')) {
        pixFmtMultiplier = 1.3; // 10-bit content
      } else if (pixFmt.includes('12le') || pixFmt.includes('12be')) {
        pixFmtMultiplier = 1.5; // 12-bit content
      } else if (pixFmt.includes('16le') || pixFmt.includes('16be')) {
        pixFmtMultiplier = 1.8; // 16-bit content
      }
      adjustedMinBitrate = Math.round(adjustedMinBitrate * pixFmtMultiplier);
      adjustedMaxBitrate = Math.round(adjustedMaxBitrate * pixFmtMultiplier);
      
      // Adjust for codec efficiency
      let codecMultiplier = 1.0;
      if (codecName === 'hevc' || codecName === 'h265') {
        codecMultiplier = 0.7; // HEVC is more efficient
      } else if (codecName === 'vp9') {
        codecMultiplier = 0.8; // VP9 is more efficient
      } else if (codecName === 'av1') {
        codecMultiplier = 0.6; // AV1 is most efficient
      }
      adjustedMinBitrate = Math.round(adjustedMinBitrate * codecMultiplier);
      adjustedMaxBitrate = Math.round(adjustedMaxBitrate * codecMultiplier);
      
      return {
        ...quality,
        actualHeight: height,
        actualBitrate: bitrate,
        fps: fps,
        codec: codecName,
        pixFmt: pixFmt,
        adjustedMinBitrate: adjustedMinBitrate,
        adjustedMaxBitrate: adjustedMaxBitrate
      };
    }
  }

  // Fallback for unknown sizes
  const fallbackQuality = {
    name: 'Custom',
    minHeight: 0,
    maxHeight: height,
    minBitrate: bitrate ? Math.max(100, bitrate * 0.3) : 500,
    maxBitrate: bitrate || 5000,
    actualHeight: height,
    actualBitrate: bitrate,
    fps: fps,
    codec: codecName,
    pixFmt: pixFmt
  };
  
  return fallbackQuality;
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
  // Extended quality ladder supporting up to 8K and beyond
  const allQualities = [
    { height: 8640, name: '8K+', enabled: true },      // Beyond 8K
    { height: 7920, name: '8K', enabled: true },       // 8K (7920p)
    { height: 7200, name: '7K', enabled: true },       // 7K (7200p)
    { height: 6480, name: '6K', enabled: true },       // 6K (6480p)
    { height: 5760, name: '5K', enabled: true },       // 5K (5760p)
    { height: 5040, name: '5K-', enabled: true },      // 5K- (5040p)
    { height: 4320, name: '4K+', enabled: true },      // 4K+ (4320p)
    { height: 3600, name: '4K', enabled: true },       // 4K (3600p)
    { height: 2880, name: 'QHD+', enabled: true },     // QHD+ (2880p)
    { height: 2160, name: '4K', enabled: true },       // UHD (2160p)
    { height: 1440, name: 'QHD', enabled: true },      // QHD (1440p)
    { height: 1080, name: '1080p', enabled: true },    // FHD (1080p)
    { height: 720, name: '720p', enabled: true },      // HD (720p)
    { height: 540, name: '540p', enabled: true },      // 540p
    { height: 480, name: '480p', enabled: true },      // 480p
    { height: 360, name: '360p', enabled: true },      // 360p
    { height: 240, name: '240p', enabled: true },      // 240p
    { height: 144, name: '144p', enabled: true }       // 144p
  ];

  // Filter out qualities that would upscale the source
  const validQualities = allQualities.filter(q => q.height <= sourceHeight);
  
  // Filter by minimum quality requirement
  const minQualities = validQualities.filter(q => q.height >= minQuality);
  
  // If no qualities meet the minimum, include at least the minimum
  if (minQualities.length === 0) {
    const minQualityObj = allQualities.find(q => q.height === minQuality);
    if (minQualityObj) {
      return [minQualityObj];
    }
    // Fallback to lowest available quality
    return validQualities.length > 0 ? [validQualities[validQualities.length - 1]] : [allQualities[allQualities.length - 1]];
  }
  
  // Instead of smart selection, return ALL valid qualities above minimum
  // Sort by height descending (highest quality first)
  minQualities.sort((a, b) => b.height - a.height);
  
  return minQualities;
}

module.exports = {
  analyzeSource,
  getOptimalQualities
};
