// Dynamic bitrate calculation based on resolution and source characteristics
const BITRATE_PRESETS = {
  // Base bitrates for different resolutions at 30fps
  baseBitrates: {
    2160: 15000, // 4K
    1440: 10000, // 1440p
    1080: 5000,  // 1080p
    720: 2500,   // 720p
    540: 1500,   // 540p
    480: 1000,   // 480p
    360: 600,    // 360p
    240: 300,    // 240p
    144: 150     // 144p
  },

  // CRF values for different quality settings
  crfValues: {
    veryHigh: 16,
    high: 19,
    medium: 23,
    low: 26,
    veryLow: 29
  },

  // GOP sizes for different frame rates
  gopSizes: {
    24: 48,
    25: 50,
    30: 60,
    50: 100,
    60: 120
  }
};

// Resolution presets maintaining aspect ratio
function getResolutionPreset(targetHeight, sourceAspectRatio = 16/9) {
  const targetWidth = Math.round(targetHeight * sourceAspectRatio / 2) * 2; // Ensure even numbers
  return {
    width: targetWidth,
    height: targetHeight
  };
}

// Calculate optimized bitrate based on source characteristics
function calculateOptimizedBitrate(targetHeight, sourceBitrate, sourceHeight, bandwidthRatio = 1.0) {
  const baseBitrate = BITRATE_PRESETS.baseBitrates[targetHeight] || 1000;
  
  // Adjust bitrate based on source characteristics
  let adjustedBitrate = baseBitrate;
  
  if (sourceBitrate && sourceHeight) {
    // Scale bitrate relative to source
    const sourceRatio = targetHeight / sourceHeight;
    const scaledBitrate = sourceBitrate * Math.pow(sourceRatio, 1.5); // Non-linear scaling
    
    // Use the more conservative value between base and scaled
    adjustedBitrate = Math.min(baseBitrate, scaledBitrate);
  }
  
  // Apply bandwidth ratio adjustment
  adjustedBitrate = adjustedBitrate * bandwidthRatio;
  
  // Ensure reasonable minimums
  const minBitrate = Math.max(100, targetHeight * 0.5);
  adjustedBitrate = Math.max(minBitrate, adjustedBitrate);
  
  return Math.round(adjustedBitrate);
}

// Get appropriate CRF value based on target quality
function getOptimalCRF(targetHeight, sourceQuality, crfOffset = 0) {
  let baseCRF;
  
  if (targetHeight >= 1080) {
    baseCRF = BITRATE_PRESETS.crfValues.high;
  } else if (targetHeight >= 720) {
    baseCRF = BITRATE_PRESETS.crfValues.medium;
  } else if (targetHeight >= 480) {
    baseCRF = BITRATE_PRESETS.crfValues.medium;
  } else {
    baseCRF = BITRATE_PRESETS.crfValues.low;
  }
  
  // Adjust based on source quality
  if (sourceQuality.actualBitrate) {
    if (sourceQuality.actualBitrate > 10000) {
      baseCRF -= 2; // Very high quality source
    } else if (sourceQuality.actualBitrate > 5000) {
      baseCRF -= 1; // High quality source
    } else if (sourceQuality.actualBitrate < 1000) {
      baseCRF += 1; // Low quality source
    }
  }
  
  // Apply user offset
  baseCRF += crfOffset;
  
  // Clamp to valid range
  return Math.max(10, Math.min(35, Math.round(baseCRF)));
}

module.exports = {
  BITRATE_PRESETS,
  getResolutionPreset,
  calculateOptimizedBitrate,
  getOptimalCRF
};
