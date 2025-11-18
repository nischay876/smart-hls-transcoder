const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { analyzeSource, getOptimalQualities } = require('./analyzer');
const { downloadFile, isUrl, getGOPSize } = require('./utils');
const { logger, createLogger, log } = require('./logger');

// Auto-detect GPU type and name with enhanced detection
function detectGpuInfo() {
  log.info('🔍 Detecting GPU...');
  
  const platform = process.platform;
  let gpuInfo = { type: 'cpu', name: 'CPU Processing', fullName: 'CPU Processing', memory: 0 };
  
  try {
    if (platform === 'win32' || platform === 'linux') {
      // Try nvidia-smi first for NVIDIA GPUs
      try {
        const nvidiaResult = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
        if (nvidiaResult.trim()) {
          const lines = nvidiaResult.trim().split('\n');
          const gpuData = lines[0].trim().split(', ');
          const gpuName = gpuData[0];
          const memory = gpuData[1] ? parseInt(gpuData[1]) : 0;
          
          // Detect specific NVIDIA GPU models
          let gpuModel = 'nvidia';
          if (gpuName.includes('A100')) gpuModel = 'nvidia-a100';
          else if (gpuName.includes('L4')) gpuModel = 'nvidia-l4';
          else if (gpuName.includes('RTX') && gpuName.includes('3090')) gpuModel = 'nvidia-rtx3090';
          else if (gpuName.includes('RTX') && gpuName.includes('4090')) gpuModel = 'nvidia-rtx4090';
          else if (gpuName.includes('RTX') && gpuName.includes('5090')) gpuModel = 'nvidia-rtx5090';
          else if (gpuName.includes('Tesla')) gpuModel = 'nvidia-tesla';
          else if (gpuName.includes('Quadro')) gpuModel = 'nvidia-quadro';
          else if (gpuName.includes('GeForce')) gpuModel = 'nvidia-consumer';
          
          gpuInfo = { 
            type: gpuModel, 
            name: gpuName,
            fullName: gpuName,
            memory: memory
          };
          log.info(`   Found NVIDIA GPU: ${gpuName} (${memory}MB VRAM)`);
          return gpuInfo;
        }
      } catch (e) {
        log.debug(`NVIDIA GPU detection failed: ${e.message}`);
      }
      
      // Try AMD detection
      try {
        const amdResult = execSync('rocm-smi --showproductname --csv', { encoding: 'utf8' });
        if (amdResult.trim()) {
          const lines = amdResult.trim().split('\n');
          if (lines.length > 1) {
            const gpuName = lines[1].replace(/"/g, '');
            gpuInfo = { 
              type: 'amd', 
              name: gpuName,
              fullName: gpuName,
              memory: 0
            };
            log.info(`   Found AMD GPU: ${gpuName}`);
            return gpuInfo;
          }
        }
      } catch (e) {
        log.debug(`AMD GPU detection failed: ${e.message}`);
      }
      
      // Try Intel Quick Sync detection
      try {
        // Check for Intel Quick Sync capability
        const intelResult = execSync('vainfo 2>/dev/null | grep -i "intel" || echo "not found"', { encoding: 'utf8' });
        if (!intelResult.includes('not found')) {
          gpuInfo = { 
            type: 'intel-qsv', 
            name: 'Intel Quick Sync Video',
            fullName: 'Intel Quick Sync Video',
            memory: 0
          };
          log.info(`   Found Intel Quick Sync Video`);
          return gpuInfo;
        }
      } catch (e) {
        log.debug(`Intel QSV detection failed: ${e.message}`);
      }
    } else if (platform === 'darwin') {
      // macOS - use system_profiler
      try {
        const result = execSync('system_profiler SPDisplaysDataType | grep "Chip\\|Processor"', { encoding: 'utf8' });
        if (result.includes('Apple M')) {
          gpuInfo = { type: 'apple', name: 'Apple Silicon GPU', fullName: 'Apple Silicon GPU', memory: 0 };
        } else {
          gpuInfo = { type: 'apple', name: 'macOS GPU', fullName: 'macOS GPU', memory: 0 };
        }
        log.info(`   Found GPU: ${gpuInfo.name}`);
        return gpuInfo;
      } catch (e) {
        log.debug(`Apple GPU detection failed: ${e.message}`);
      }
    }
  } catch (error) {
    log.warn(`GPU detection error: ${error.message}`);
  }
  
  log.info('   No compatible GPU found, falling back to CPU processing');
  return gpuInfo;
}

// Enhanced GPU-specific FFmpeg options
function getGpuOptions(gpuType, sourceInfo) {
  const baseOptions = {
    'nvidia': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p4',
      tune: 'hq',
      profile: 'high',
      rc: 'constqp',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32']
    },
    'nvidia-a100': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p7',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32', '-cq', '23']
    },
    'nvidia-l4': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p5',
      tune: 'll',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '16']
    },
    'nvidia-rtx3090': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p6',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32']
    },
    'nvidia-rtx4090': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p7',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32']
    },
    'nvidia-rtx5090': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p7',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32']
    },
    'nvidia-tesla': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p6',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '32']
    },
    'nvidia-consumer': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p5',
      tune: 'hq',
      profile: 'high',
      rc: 'vbr_hq',
      options: ['-b_ref_mode', 'disabled', '-rc-lookahead', '24']
    },
    'intel-qsv': {
      decoder: '-c:v h264_qsv',
      encoder: 'h264_qsv',
      preset: 'medium',
      options: ['-look_ahead', '1', '-extbrc', '1']
    },
    'amd': {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_amf',
      preset: 'quality',
      options: ['-quality', 'quality']
    },
    'apple': {
      decoder: '',
      encoder: 'h264_videotoolbox',
      preset: 'medium',
      options: []
    }
  };
  
  const options = baseOptions[gpuType] || { encoder: 'libx264', preset: 'medium', options: [] };
  
  // Optimize for source characteristics
  if (sourceInfo && sourceInfo.fps > 60) {
    if (options.tune) {
      options.tune = 'zerolatency';
    }
  }
  
  return options;
}

// Monitor GPU usage
class GpuMonitor {
  constructor(gpuType, interval = 1000) {
    this.gpuType = gpuType;
    this.interval = interval;
    this.monitoring = false;
    this.usageData = [];
    this.displayLine = '';
  }

  start() {
    if (this.monitoring) return;
    
    this.monitoring = true;
    log.info('📊 Starting GPU usage monitoring...');
    
    this.monitorInterval = setInterval(() => {
      this.getGpuUsage().then(usage => {
        if (usage !== null) {
          this.usageData.push(usage);
          this.updateDisplay(usage);
        }
      }).catch(() => {
        // Silently ignore errors
      });
    }, this.interval);
  }

  updateDisplay(usage) {
    const newLine = `📊 System GPU Usage: ${usage}%`;
    
    // Clear previous line if it exists
    if (this.displayLine) {
      process.stdout.write('\r' + ' '.repeat(this.displayLine.length) + '\r');
    }
    
    // Write new line
    process.stdout.write(newLine);
    this.displayLine = newLine;
  }

  stop() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitoring = false;
      
      // Clear the GPU usage line
      if (this.displayLine) {
        process.stdout.write('\r' + ' '.repeat(this.displayLine.length) + '\r');
        this.displayLine = '';
      }
      
      if (this.usageData.length > 0) {
        const avgUsage = (this.usageData.reduce((a, b) => a + b, 0) / this.usageData.length).toFixed(1);
        log.info(`📈 Average GPU Usage: ${avgUsage}%`);
      }
    }
  }

  async getGpuUsage() {
    try {
      if (this.gpuType.includes('nvidia')) {
        const result = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
        const values = result.trim().split(',').map(v => parseInt(v.trim()));
        if (values.length >= 1 && !isNaN(values[0])) {
          return values[0];
        }
      } else if (this.gpuType === 'amd') {
        try {
          const result = execSync('rocm-smi --showuse', { encoding: 'utf8' });
          const match = result.match(/(\d+)%/);
          if (match) {
            return parseInt(match[1]);
          }
        } catch (e) {
          return null;
        }
      } else if (this.gpuType === 'intel-qsv') {
        return null;
      } else if (this.gpuType === 'apple') {
        return null;
      }
    } catch (error) {
      return null;
    }
    return null;
  }
}

// Local resolution preset function
function getResolutionPresetLocal(targetHeight, sourceAspectRatio = 16/9) {
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

// Local bitrate calculation function
function calculateOptimizedBitrateLocal(targetHeight, sourceBitrate, sourceHeight, bandwidthRatio = 1.0) {
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
    return Math.round(finalBitrate);
  }

  // Calculate bitrate based on source characteristics using quadratic scaling
  const sourceArea = sourceHeight * sourceHeight;
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
  
  return finalBitrate;
}

// Local CRF calculation function
function getOptimalCRFLocal(targetHeight, sourceQuality, crfOffset = 0) {
  const BITRATE_PRESETS = {
    crfValues: {
      veryHigh: 16,
      high: 19,
      medium: 23,
      low: 26,
      veryLow: 29
    }
  };
  
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
    } else if (actualBitrate > expectedBitrate * 1.5) {
      baseCRF -= 2; // High quality source
    } else if (actualBitrate > expectedBitrate * 1.2) {
      baseCRF -= 1; // Good quality source
    } else if (actualBitrate < expectedBitrate * 0.5) {
      baseCRF += 2; // Low quality source
    } else if (actualBitrate < expectedBitrate * 0.8) {
      baseCRF += 1; // Below average quality source
    }
  }
  
  // Adjust based on source pixel format (bit depth)
  if (sourceQuality && sourceQuality.pixFmt) {
    const pixFmt = sourceQuality.pixFmt;
    if (pixFmt.includes('10le') || pixFmt.includes('10be')) {
      baseCRF -= 1; // 10-bit content can handle lower CRF
    } else if (pixFmt.includes('12le') || pixFmt.includes('12be')) {
      baseCRF -= 2; // 12-bit content
    } else if (pixFmt.includes('16le') || pixFmt.includes('16be')) {
      baseCRF -= 3; // 16-bit content
    }
  }
  
  // Apply user offset
  baseCRF += crfOffset;
  
  // Clamp to valid range (10-40 is safe range for most encoders)
  const finalCRF = Math.max(10, Math.min(40, Math.round(baseCRF)));
  
  return finalCRF;
}

async function transcodeVideo(options) {
  const { 
    input, 
    output, 
    bandwidthRatio = 1.0, 
    segmentDuration = 6, 
    segmentSize = null,
    preset = 'medium', 
    crfOffset = 0, 
    minQuality = 360, 
    skipAnalysis = false,
    sequential = false,
    maxConcurrent = null,
    useGpu = false,
    gpuType = 'auto',
    showGpuUsage = false,
    dryRun = false
  } = options;
  
  const transcodeLogger = createLogger('transcoder');
  const startTime = Date.now();
  
  try {
    transcodeLogger.info(`🎬 Smart HLS Transcoding Started`);
    transcodeLogger.info(`📥 Input: ${input}`);
    transcodeLogger.info(`📤 Output: ${path.resolve(output)}`);
    
    if (dryRun) {
      transcodeLogger.info('📋 DRY RUN MODE - No actual transcoding will occur');
    }
    
    if (segmentSize) {
      transcodeLogger.info(`📏 Segment Size: ${segmentSize} MB`);
    } else {
      transcodeLogger.info(`⏱️ Segment Duration: ${segmentDuration} seconds`);
    }
    
    if (useGpu) {
      transcodeLogger.info(`🎮 GPU Acceleration: ENABLED`);
    } else {
      transcodeLogger.info(`💻 Processing: CPU`);
    }
    
    if (showGpuUsage) {
      transcodeLogger.info(`📊 GPU Usage Monitoring: ENABLED`);
    }
    
    if (sequential) {
      transcodeLogger.info(`🔄 Processing mode: Sequential (one quality at a time)`);
    } else if (maxConcurrent) {
      transcodeLogger.info(`⚡ Processing mode: Parallel (max ${maxConcurrent} concurrent)`);
    } else {
      transcodeLogger.info(`⚡ Processing mode: Parallel (unlimited)`);
    }

    // Ensure output directory exists
    await fs.ensureDir(output);
    transcodeLogger.info(`📂 Output directory ensured: ${path.resolve(output)}`);
    
    // Verify directory is writable
    try {
      const testFile = path.join(output, 'test_write.tmp');
      await fs.writeFile(testFile, 'test');
      await fs.remove(testFile);
      transcodeLogger.info('✅ Output directory is writable');
    } catch (writeError) {
      transcodeLogger.error(`❌ Cannot write to output directory: ${writeError.message}`);
      throw new Error(`Output directory is not writable: ${output}`);
    }

    let inputFile = input;
    let needsCleanup = false;
    
    // Download file if it's a URL
    if (isUrl(input)) {
      if (!dryRun) {
        const tempPath = path.join(output, 'temp_source.mp4');
        await downloadFile(input, tempPath);
        inputFile = tempPath;
        needsCleanup = true;
      } else {
        transcodeLogger.info('📥 Would download source file to temporary location');
        inputFile = 'DRY_RUN_TEMP_FILE';
      }
    }

    let sourceInfo = null;
    
    // Analyze source file unless explicitly skipped
    // Even in dry-run mode, we should analyze to get proper information
    if (!skipAnalysis) {
      try {
        sourceInfo = await analyzeSource(inputFile);
      } catch (analyzeError) {
        transcodeLogger.warn(`⚠️ Source analysis failed: ${analyzeError.message}`);
        transcodeLogger.info('⏭️ Falling back to default analysis');
        sourceInfo = {
          width: 1920,
          height: 1080,
          aspectRatio: 16/9,
          fps: 30,
          videoBitrate: null,
          sourceQuality: { name: '1080p', actualHeight: 1080 }
        };
      }
    } else {
      transcodeLogger.info('⏭️ Skipping source analysis (using defaults)');
      sourceInfo = {
        width: 1920,
        height: 1080,
        aspectRatio: 16/9,
        fps: 30,
        videoBitrate: null,
        sourceQuality: { name: '1080p', actualHeight: 1080 }
      };
    }

    // Setup GPU acceleration
    let gpuConfig = null;
    let gpuName = null;
    if (useGpu) {
      const gpuInfo = gpuType === 'auto' ? detectGpuInfo() : { type: gpuType, name: `${gpuType.toUpperCase()} GPU` };
      gpuConfig = getGpuOptions(gpuInfo.type, sourceInfo);
      gpuName = gpuInfo.name;
      transcodeLogger.info(`   Using ${gpuInfo.type.toUpperCase()} acceleration (${gpuName})`);
    }

    // Initialize GPU monitor if requested
    let gpuMonitor = null;
    if (showGpuUsage && useGpu && gpuConfig && !dryRun) {
      const monitorType = gpuConfig.encoder.includes('nvenc') ? 'nvidia' : 
                        gpuConfig.encoder.includes('amf') ? 'amd' : 
                        gpuConfig.encoder.includes('qsv') ? 'intel' : 
                        gpuConfig.encoder.includes('videotoolbox') ? 'apple' : 'unknown';
      gpuMonitor = new GpuMonitor(monitorType);
    }

    // Determine optimal qualities based on source
    const optimalQualities = getOptimalQualities(sourceInfo.height, minQuality);
    
    transcodeLogger.info(`🎯 Generating ${optimalQualities.length} quality levels:`);
    optimalQualities.forEach(q => transcodeLogger.info(`   • ${q.height}p (${q.name})`));

    // Generate master playlist header
    let masterPlaylist = '#EXTM3U\n';
    masterPlaylist += '#EXT-X-VERSION:3\n';
    masterPlaylist += '#EXT-X-INDEPENDENT-SEGMENTS\n\n';

    let playlistResults = [];
    
    if (dryRun) {
      // Dry run simulation - still use actual source analysis data
      transcodeLogger.info('📋 DRY RUN SIMULATION:');
      for (const quality of optimalQualities) {
        const targetHeight = quality.height;
        // Use local functions
        const resolution = getResolutionPresetLocal(targetHeight, sourceInfo.aspectRatio);
        const bitrate = calculateOptimizedBitrateLocal(targetHeight, sourceInfo.videoBitrate, sourceInfo.height, bandwidthRatio);
        const crf = getOptimalCRFLocal(targetHeight, sourceInfo.sourceQuality, crfOffset);
        const gopSize = getGOPSize(sourceInfo.fps);
        
        transcodeLogger.info(`   📦 Would process ${targetHeight}p (${resolution.width}x${resolution.height}) - Target bitrate: ${bitrate}k`);
        transcodeLogger.info(`      🔧 CRF: ${crf}, GOP: ${gopSize}`);
        
        const bandwidth = bitrate * 1000;
        const playlistName = `playlist_${targetHeight}.m3u8`;
        const masterEntry = `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height},NAME="${quality.name}"\n${playlistName}\n\n`;
        playlistResults.push({ masterEntry, quality: targetHeight });
      }
    } else {
      // Actual transcoding
      // Start GPU monitoring if enabled
      if (gpuMonitor) {
        gpuMonitor.start();
      }
      
      if (sequential) {
        // Process qualities one by one with clean formatting
        transcodeLogger.info('\n🔄 Sequential processing enabled - one quality at a time');
        for (const quality of optimalQualities) {
          transcodeLogger.info(`\n--- Processing ${quality.height}p ---`);
          const result = await processQualityLevel({
            quality,
            sourceInfo,
            inputFile,
            output,
            segmentDuration,
            segmentSize,
            preset,
            bandwidthRatio,
            crfOffset,
            gpuConfig,
            gpuName,
            showProgressInNewLine: true
          });
          playlistResults.push(result);
        }
      } else if (maxConcurrent) {
        // Process with concurrency limit
        transcodeLogger.info(`\n⚡ Parallel processing with max ${maxConcurrent} concurrent encodes`);
        playlistResults = await processWithConcurrencyLimit(
          optimalQualities,
          sourceInfo,
          inputFile,
          output,
          segmentDuration,
          segmentSize,
          preset,
          bandwidthRatio,
          crfOffset,
          maxConcurrent,
          gpuConfig,
          gpuName
        );
      } else {
        // Process all qualities in parallel (default behavior)
        transcodeLogger.info('\n⚡ Parallel processing all qualities simultaneously');
        const promises = optimalQualities.map(quality => 
          processQualityLevel({
            quality,
            sourceInfo,
            inputFile,
            output,
            segmentDuration,
            segmentSize,
            preset,
            bandwidthRatio,
            crfOffset,
            gpuConfig,
            gpuName,
            showProgressInNewLine: false
          })
        );
        playlistResults = await Promise.all(promises);
      }

      // Stop GPU monitoring
      if (gpuMonitor) {
        gpuMonitor.stop();
      }

      // Build master playlist with all variants
      playlistResults.forEach(result => {
        masterPlaylist += result.masterEntry;
      });

      // Write master playlist
      const masterPlaylistPath = path.join(output, 'master.m3u8');
      await fs.writeFile(masterPlaylistPath, masterPlaylist);
      transcodeLogger.info(`\n📝 Master playlist written to: ${masterPlaylistPath}`);

      // Cleanup temporary file if needed
      if (needsCleanup) {
        await fs.remove(inputFile);
        transcodeLogger.info('🧹 Temporary files cleaned up');
      }
    }

    // Calculate total time
    const totalTime = Date.now() - startTime;
    const totalTimeFormatted = formatTime(totalTime);
    transcodeLogger.info(`⏱️ Total transcoding time: ${totalTimeFormatted}`);

  } catch (error) {
    transcodeLogger.error(`Transcoding failed: ${error.message}`, { stack: error.stack });
    throw new Error(`Transcoding failed: ${error.message}`);
  }
}

async function processWithConcurrencyLimit(qualities, sourceInfo, inputFile, output, segmentDuration, segmentSize, preset, bandwidthRatio, crfOffset, maxConcurrent, gpuConfig, gpuName) {
  const results = [];
  const transcodeLogger = createLogger('concurrency');
  
  for (let i = 0; i < qualities.length; i += maxConcurrent) {
    const batch = qualities.slice(i, i + maxConcurrent);
    transcodeLogger.info(`\n🔄 Processing batch ${Math.floor(i/maxConcurrent) + 1}/${Math.ceil(qualities.length/maxConcurrent)}`);
    
    const promises = batch.map(quality => 
      processQualityLevel({
        quality,
        sourceInfo,
        inputFile,
        output,
        segmentDuration,
        segmentSize,
        preset,
        bandwidthRatio,
        crfOffset,
        gpuConfig,
        gpuName,
        showProgressInNewLine: false
      })
    );
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  return results;
}

async function processQualityLevel(options) {
  const { quality, sourceInfo, inputFile, output, segmentDuration, segmentSize, preset, bandwidthRatio, crfOffset, gpuConfig, gpuName, showProgressInNewLine } = options;
  
  return new Promise(async (resolve, reject) => {
    try {
      // Ensure output directory exists for this quality level
      await fs.ensureDir(output);
      
      const targetHeight = quality.height;
      const playlistName = `playlist_${targetHeight}.m3u8`;
      const segmentPrefix = `segment_${targetHeight}`;
      const startTime = Date.now();
      
      // Calculate optimized parameters using local functions
      const resolution = getResolutionPresetLocal(targetHeight, sourceInfo.aspectRatio);
      const bitrate = calculateOptimizedBitrateLocal(targetHeight, sourceInfo.videoBitrate, sourceInfo.height, bandwidthRatio);
      const crf = getOptimalCRFLocal(targetHeight, sourceInfo.sourceQuality, crfOffset);
      const gopSize = getGOPSize(sourceInfo.fps);

      const qualityLogger = createLogger(`quality-${targetHeight}`);
      qualityLogger.info(`📦 Processing ${targetHeight}p (${resolution.width}x${resolution.height}) - Target bitrate: ${bitrate}k`);
      if (gpuConfig) {
        qualityLogger.info(`   🔧 CRF: ${crf}, GOP: ${gopSize}, GPU Preset: ${preset}${gpuName ? ` (${gpuName})` : ''}`);
      } else {
        qualityLogger.info(`   🔧 CRF: ${crf}, GOP: ${gopSize}, CPU Preset: ${preset}`);
      }

      // Calculate bandwidth for master playlist (in bits per second)
      const bandwidth = bitrate * 1000;

      // Create master playlist entry
      const masterEntry = `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height},NAME="${quality.name}"\n${playlistName}\n\n`;

      // Setup FFmpeg command
      const ffmpegCommand = ffmpeg(inputFile);
      
      // Apply GPU acceleration if configured
      if (gpuConfig) {
        // Set GPU decoder if available
        if (gpuConfig.decoder) {
          ffmpegCommand.inputOptions([gpuConfig.decoder]);
        }
        
        // Set GPU encoder
        ffmpegCommand.videoCodec(gpuConfig.encoder);
        
        // Add GPU-specific options
        if (gpuConfig.options && gpuConfig.options.length > 0) {
          gpuConfig.options.forEach(opt => ffmpegCommand.addOption(opt));
        }
        
        // Add preset and tune if available
        if (gpuConfig.preset) {
          ffmpegCommand.addOption('-preset', gpuConfig.preset);
        }
        if (gpuConfig.tune) {
          ffmpegCommand.addOption('-tune', gpuConfig.tune);
        }
        if (gpuConfig.profile) {
          ffmpegCommand.addOption('-profile:v', gpuConfig.profile);
        }
        if (gpuConfig.rc) {
          ffmpegCommand.addOption('-rc', gpuConfig.rc);
        }
        
        // Optimize for memory usage - reduce buffer sizes
        ffmpegCommand
          .addOption('-bufsize', '2M')
          .addOption('-maxrate', `${Math.round(bitrate * 1.2)}k`);
      } else {
        // CPU processing
        ffmpegCommand.videoCodec('libx264');
        ffmpegCommand.addOption('-preset', preset);
        
        // Optimize for memory usage
        ffmpegCommand
          .addOption('-threads', Math.min(4, os.cpus().length).toString())
          .addOption('-bufsize', '1M')
          .addOption('-maxrate', `${Math.round(bitrate * 1.1)}k`);
      }

      // Common options for both GPU and CPU with memory optimization
      ffmpegCommand
        .audioCodec('aac')
        .size(`${resolution.width}x${resolution.height}`)
        .videoBitrate(`${bitrate}k`)
        .audioBitrate('128k')
        .addOption('-crf', crf.toString())
        .addOption('-g', gopSize.toString())
        .addOption('-sc_threshold', '0')
        .addOption('-keyint_min', gopSize.toString())
        .addOption('-b_strategy', '0')
        .addOption('-bf', '3')
        .addOption('-refs', '3')
        .addOption('-coder', '1')
        .addOption('-flags', '+loop')
        .addOption('-me_range', '16')
        .addOption('-subq', '1')
        .addOption('-trellis', '0');
      
      // Configure segmenting options
      if (segmentSize) {
        // Use segment size (in bytes) with additional optimizations for better accuracy
        const segmentSizeBytes = Math.round(segmentSize * 1024 * 1024); // Convert MB to bytes
        
        // Additional options to improve segment size accuracy
        ffmpegCommand
          .addOption('-f', 'hls')
          .addOption('-hls_time', '1') // Very small time to prioritize size-based splitting
          .addOption('-hls_list_size', '0')
          .addOption('-hls_segment_size', segmentSizeBytes.toString())
          .addOption('-hls_segment_filename', path.join(output, `${segmentPrefix}_%03d.ts`))
          .addOption('-hls_playlist_type', 'event')
          // Additional options for better segment size control
          .addOption('-hls_flags', 'split_by_time')
          .addOption('-hls_flags', '+discont_start');
      } else {
        // Use segment duration
        ffmpegCommand
          .addOption('-hls_time', segmentDuration.toString())
          .addOption('-hls_list_size', '0')
          .addOption('-hls_segment_filename', path.join(output, `${segmentPrefix}_%03d.ts`))
          .addOption('-f', 'hls')
          .addOption('-hls_playlist_type', 'event');
      }

      ffmpegCommand
        .on('start', (commandLine) => {
          qualityLogger.info(`🎬 Started ${targetHeight}p transcoding`);
          if (process.env.DEBUG) {
            qualityLogger.debug(`🔧 Command: ${commandLine}`);
          }
        })
        .on('progress', (progress) => {
          // Suppress progress updates to avoid spam
        })
        .on('end', () => {
          const endTime = Date.now();
          const duration = endTime - startTime;
          const durationFormatted = formatTime(duration);
          qualityLogger.info(`✅ Completed ${targetHeight}p transcoding in ${durationFormatted}`);
          resolve({ masterEntry, quality: targetHeight });
        })
        .on('error', (err) => {
          qualityLogger.error(`❌ Error transcoding ${targetHeight}p: ${err.message}`);
          reject(err);
        })
        .save(path.join(output, playlistName));
    } catch (error) {
      reject(error);
    }
  });
}

function formatTime(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${remainingSeconds}s`;
  }
}

module.exports = { transcodeVideo };
