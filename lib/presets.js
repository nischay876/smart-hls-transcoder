const { logger, createLogger } = require('./logger');

// Dynamic bitrate calculation based on resolution and source characteristics
const BITRATE_PRESETS = {
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
    60: 120,
    120: 240
  }
};

// Resolution presets maintaining aspect ratio with support for all resolutions
function getResolutionPreset(targetHeight, sourceAspectRatio = 16/9) {
  // Handle extreme aspect ratios gracefully
  const clampedAspectRatio = Math.max(0.5, Math.min(3.0, sourceAspectRatio));
  
  // Calculate width ensuring it's divisible by 2 for H.264 compatibility
  let targetWidth = Math.round(targetHeight * clampedAspectRatio);
  
  // Ensure dimensions are even numbers (required by most codecs)
  targetWidth = targetWidth % 2 === 0 ? targetWidth : targetWidth + 1;
  const finalHeight = targetHeight % 2 === 0 ? targetHeight : targetHeight + 1;
  
  // Ensure minimum dimensions
  targetWidth = Math.max(16, targetWidth);
  const finalFinalHeight = Math.max(16, finalHeight);
  
  return {
    width: targetWidth,
    height: finalFinalHeight
  };
}

// Calculate optimized bitrate based on source characteristics with dynamic scaling
function calculateOptimizedBitrate(targetHeight, sourceBitrate, sourceHeight, bandwidthRatio = 1.0) {
  const presetLogger = createLogger('bitrate-calculator');
  
  // If we don't have source information, use reasonable defaults
  if (!sourceBitrate || !sourceHeight) {
    // Calculate base bitrate using empirical formula: ~50 kbps per 720p equivalent
    const baseBitrate = Math.round((targetHeight * targetHeight * 0.000096) * 50);
    const adjustedBitrate = baseBitrate * bandwidthRatio;
    
    // Ensure reasonable minimums and maximums
    const minBitrate = Math.max(50, targetHeight * 0.2);
    const maxBitrate = targetHeight > 4320 ? 100000 : // 5K+
                      targetHeight > 2160 ? 50000 :   // 3K-4K
                      targetHeight > 1080 ? 20000 :   // 1.5K-2K
                      targetHeight > 720 ? 10000 :    // 800p-1080p
                      targetHeight > 480 ? 4000 :     // 540p-720p
                      targetHeight > 360 ? 2000 :     // 400p-540p
                      targetHeight > 240 ? 1000 :     // 280p-400p
                      500;                            // Below 280p
    
    const finalBitrate = Math.max(minBitrate, Math.min(maxBitrate, adjustedBitrate));
    presetLogger.debug(`Estimated bitrate for ${targetHeight}p (no source info): ${finalBitrate}k`);
    
    return Math.round(finalBitrate);
  }

  // Calculate bitrate based on source characteristics using quadratic scaling
  // This accounts for the fact that bitrate scales with area (width × height)
  const sourceArea = sourceHeight * sourceHeight; // Simplified to height² for aspect ratio consistency
  const targetArea = targetHeight * targetHeight;
  
  // Base calculation: scale bitrate proportionally to area ratio
  let scaledBitrate = sourceBitrate * (targetArea / sourceArea);
  
  // Apply non-linear compression factors based on downscaling
  const heightRatio = targetHeight / sourceHeight;
  
  if (heightRatio > 0.9) {
    // Near-source quality: minimal compression
    scaledBitrate *= 1.0;
  } else if (heightRatio > 0.7) {
    // High quality downscale: moderate compression
    scaledBitrate *= 0.85;
  } else if (heightRatio > 0.5) {
    // Medium quality downscale: good compression
    scaledBitrate *= 0.7;
  } else if (heightRatio > 0.3) {
    // Lower quality downscale: aggressive compression
    scaledBitrate *= 0.55;
  } else {
    // Low quality downscale: very aggressive compression
    scaledBitrate *= 0.4;
  }
  
  // Apply bandwidth ratio adjustment
  const adjustedBitrate = scaledBitrate * bandwidthRatio;
  
  // Ensure reasonable minimums based on resolution
  const minBitrate = Math.max(
    50, 
    targetHeight * (targetHeight > 1080 ? 0.8 : 
                   targetHeight > 720 ? 0.6 : 
                   targetHeight > 480 ? 0.4 : 
                   0.2)
  );
  
  // Cap maximum bitrate for sanity based on target resolution
  const maxBitrate = targetHeight > 4320 ? sourceBitrate * 3 : // 5K+ (allow up to 3x source)
                    targetHeight > 2160 ? sourceBitrate * 2.5 : // 3K-4K
                    targetHeight > 1080 ? sourceBitrate * 2 :   // 1.5K-2K
                    targetHeight > 720 ? sourceBitrate * 1.8 :  // 800p-1080p
                    targetHeight > 480 ? sourceBitrate * 1.5 :  // 540p-720p
                    targetHeight > 360 ? sourceBitrate * 1.3 :  // 400p-540p
                    sourceBitrate * 1.2;                        // Below 400p
  
  const clampedBitrate = Math.max(minBitrate, Math.min(maxBitrate, adjustedBitrate));
  const finalBitrate = Math.round(clampedBitrate);
  
  presetLogger.debug(`Bitrate calculation for ${targetHeight}p: source=${sourceBitrate}k, scaled=${scaledBitrate.toFixed(1)}k, final=${finalBitrate}k`);
  
  return finalBitrate;
}

// Get appropriate CRF value based on target quality with advanced adjustments
function getOptimalCRF(targetHeight, sourceQuality, crfOffset = 0) {
  const presetLogger = createLogger('crf-calculator');
  
  let baseCRF;
  
  // Base CRF based on resolution
  if (targetHeight >= 2160) {
    baseCRF = BITRATE_PRESETS.crfValues.high; // 4K and above
  } else if (targetHeight >= 1440) {
    baseCRF = BITRATE_PRESETS.crfValues.high; // 1440p-4K
  } else if (targetHeight >= 1080) {
    baseCRF = BITRATE_PRESETS.crfValues.medium; // 1080p
  } else if (targetHeight >= 720) {
    baseCRF = BITRATE_PRESETS.crfValues.medium; // 720p
  } else if (targetHeight >= 480) {
    baseCRF = BITRATE_PRESETS.crfValues.medium; // 480p-720p
  } else {
    baseCRF = BITRATE_PRESETS.crfValues.low; // Below 480p
  }
  
  // Adjust based on source quality
  if (sourceQuality && sourceQuality.actualBitrate) {
    const actualBitrate = sourceQuality.actualBitrate;
    const expectedBitrate = sourceQuality.adjustedMaxBitrate || sourceQuality.maxBitrate || 5000;
    
    if (actualBitrate > expectedBitrate * 2) {
      baseCRF -= 3; // Very high quality source
      presetLogger.debug(`Source bitrate much higher than expected, reducing CRF by 3`);
    } else if (actualBitrate > expectedBitrate * 1.5) {
      baseCRF -= 2; // High quality source
      presetLogger.debug(`Source bitrate higher than expected, reducing CRF by 2`);
    } else if (actualBitrate > expectedBitrate * 1.2) {
      baseCRF -= 1; // Good quality source
      presetLogger.debug(`Source bitrate slightly higher than expected, reducing CRF by 1`);
    } else if (actualBitrate < expectedBitrate * 0.5) {
      baseCRF += 2; // Low quality source
      presetLogger.debug(`Source bitrate much lower than expected, increasing CRF by 2`);
    } else if (actualBitrate < expectedBitrate * 0.8) {
      baseCRF += 1; // Below average quality source
      presetLogger.debug(`Source bitrate lower than expected, increasing CRF by 1`);
    }
  }
  
  // Adjust based on source pixel format (bit depth)
  if (sourceQuality && sourceQuality.pixFmt) {
    const pixFmt = sourceQuality.pixFmt;
    if (pixFmt.includes('10le') || pixFmt.includes('10be')) {
      baseCRF -= 1; // 10-bit content can handle lower CRF
      presetLogger.debug(`10-bit source detected, reducing CRF by 1`);
    } else if (pixFmt.includes('12le') || pixFmt.includes('12be')) {
      baseCRF -= 2; // 12-bit content
      presetLogger.debug(`12-bit source detected, reducing CRF by 2`);
    } else if (pixFmt.includes('16le') || pixFmt.includes('16be')) {
      baseCRF -= 3; // 16-bit content
      presetLogger.debug(`16-bit source detected, reducing CRF by 3`);
    }
  }
  
  // Apply user offset
  baseCRF += crfOffset;
  
  // Clamp to valid range (10-40 is safe range for most encoders)
  const finalCRF = Math.max(10, Math.min(40, Math.round(baseCRF)));
  
  presetLogger.debug(`CRF calculation for ${targetHeight}p: base=${BITRATE_PRESETS.crfValues.high}-${BITRATE_PRESETS.crfValues.low}, adjusted=${finalCRF}`);
  
  return finalCRF;
}

module.exports = {
  BITRATE_PRESETS,
  getResolutionPreset,
  calculateOptimizedBitrate,
  getOptimalCRF
};
