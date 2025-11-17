const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { analyzeSource, getOptimalQualities } = require('./analyzer');
const { getResolutionPreset, calculateOptimizedBitrate, getOptimalCRF } = require('./presets');
const { downloadFile, isUrl, getGOPSize } = require('./utils');

// Auto-detect GPU type and name
function detectGpuInfo() {
  console.log('🔍 Detecting GPU...');
  
  const platform = process.platform;
  let gpuInfo = { type: 'unknown', name: 'Unknown GPU' };
  
  try {
    if (platform === 'win32') {
      // Windows - use wmic or nvidia-smi
      try {
        // Try nvidia-smi first
        const nvidiaResult = execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits', { encoding: 'utf8' });
        if (nvidiaResult.trim()) {
          gpuInfo = { 
            type: 'nvidia', 
            name: nvidiaResult.trim().split('\n')[0].trim()
          };
          console.log(`   Found NVIDIA GPU: ${gpuInfo.name}`);
          return gpuInfo;
        }
      } catch (e) {
        // If nvidia-smi fails, try wmic
        try {
          const wmicResult = execSync('wmic path win32_VideoController get name', { encoding: 'utf8' });
          const lines = wmicResult.trim().split('\n').filter(line => line.trim() && !line.includes('Name'));
          if (lines.length > 0) {
            const gpuName = lines[0].trim();
            // Determine GPU type based on name
            if (gpuName.toLowerCase().includes('nvidia')) {
              gpuInfo = { type: 'nvidia', name: gpuName };
            } else if (gpuName.toLowerCase().includes('intel')) {
              gpuInfo = { type: 'intel', name: gpuName };
            } else if (gpuName.toLowerCase().includes('amd') || gpuName.toLowerCase().includes('radeon')) {
              gpuInfo = { type: 'amd', name: gpuName };
            } else {
              gpuInfo = { type: 'unknown', name: gpuName };
            }
            console.log(`   Found GPU: ${gpuInfo.name}`);
            return gpuInfo;
          }
        } catch (e2) {
          // Fallback
        }
      }
    } else if (platform === 'darwin') {
      // macOS - use system_profiler
      try {
        const result = execSync('system_profiler SPDisplaysDataType | grep "Chip\\|Processor"', { encoding: 'utf8' });
        if (result.includes('Apple M')) {
          gpuInfo = { type: 'apple', name: 'Apple Silicon GPU' };
        } else {
          gpuInfo = { type: 'apple', name: 'macOS GPU' };
        }
        console.log(`   Found GPU: ${gpuInfo.name}`);
        return gpuInfo;
      } catch (e) {
        // Fallback
      }
    } else {
      // Linux - use lspci or nvidia-smi
      try {
        // Try nvidia-smi first
        const nvidiaResult = execSync('nvidia-smi --query-gpu=name --format=csv,noheader,nounits', { encoding: 'utf8' });
        if (nvidiaResult.trim()) {
          gpuInfo = { 
            type: 'nvidia', 
            name: nvidiaResult.trim().split('\n')[0].trim()
          };
          console.log(`   Found NVIDIA GPU: ${gpuInfo.name}`);
          return gpuInfo;
        }
      } catch (e) {
        // Try lspci
        try {
          const lspciResult = execSync('lspci | grep -i vga', { encoding: 'utf8' });
          const lines = lspciResult.trim().split('\n');
          if (lines.length > 0) {
            const line = lines[0];
            if (line.toLowerCase().includes('nvidia')) {
              gpuInfo = { type: 'nvidia', name: line.split(': ')[1] };
            } else if (line.toLowerCase().includes('intel')) {
              gpuInfo = { type: 'intel', name: line.split(': ')[1] };
            } else if (line.toLowerCase().includes('amd') || line.toLowerCase().includes('ati')) {
              gpuInfo = { type: 'amd', name: line.split(': ')[1] };
            } else {
              gpuInfo = { type: 'unknown', name: line.split(': ')[1] };
            }
            console.log(`   Found GPU: ${gpuInfo.name}`);
            return gpuInfo;
          }
        } catch (e2) {
          // Fallback
        }
      }
    }
  } catch (error) {
    // Silent fail - fallback to defaults
  }
  
  // Fallback detection
  if (platform === 'win32') {
    console.log('   Windows detected - assuming NVIDIA (use --gpu-type to override)');
    gpuInfo = { type: 'nvidia', name: 'NVIDIA GPU (auto-detected)' };
  } else if (platform === 'darwin') {
    console.log('   macOS detected - assuming Apple Silicon (VideoToolbox)');
    gpuInfo = { type: 'apple', name: 'Apple Silicon GPU' };
  } else {
    console.log('   Linux detected - assuming NVIDIA (use --gpu-type to override)');
    gpuInfo = { type: 'nvidia', name: 'NVIDIA GPU (auto-detected)' };
  }
  
  return gpuInfo;
}

// Get GPU-specific FFmpeg options
function getGpuOptions(gpuType) {
  const gpuOptions = {
    nvidia: {
      decoder: '-c:v h264_cuvid',
      encoder: 'h264_nvenc',
      preset: 'p4', // Default NVENC preset
      options: ['-b_ref_mode', 'disabled']
    },
    intel: {
      decoder: '-c:v h264_qsv',
      encoder: 'h264_qsv',
      preset: 'medium',
      options: []
    },
    amd: {
      decoder: '-c:v h264_cuvid', // Often uses CUDA for decoding
      encoder: 'h264_amf',
      preset: 'balanced',
      options: []
    },
    apple: {
      decoder: '', // Usually not needed
      encoder: 'h264_videotoolbox',
      preset: 'medium',
      options: []
    }
  };
  
  return gpuOptions[gpuType] || gpuOptions.nvidia;
}

// Monitor GPU usage
class GpuMonitor {
  constructor(gpuType, interval = 500) {
    this.gpuType = gpuType;
    this.interval = interval;
    this.monitoring = false;
    this.usageData = [];
    this.displayLine = '';
  }

  start() {
    if (this.monitoring) return;
    
    this.monitoring = true;
    console.log('📊 Starting GPU usage monitoring...');
    
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
        console.log(`📈 Average GPU Usage: ${avgUsage}%`);
      }
    }
  }

  async getGpuUsage() {
    try {
      if (this.gpuType === 'nvidia') {
        // More accurate GPU usage with process-specific monitoring
        const result = execSync('nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
        const values = result.trim().split(',').map(v => parseInt(v.trim()));
        if (values.length >= 1 && !isNaN(values[0])) {
          return values[0]; // Return GPU utilization percentage
        }
      } else if (this.gpuType === 'amd') {
        // AMD monitoring (basic) - try rocm-smi if available
        try {
          const result = execSync('rocm-smi --showuse', { encoding: 'utf8' });
          // Parse ROCm SMI output (simplified)
          const match = result.match(/(\d+)%/);
          if (match) {
            return parseInt(match[1]);
          }
        } catch (e) {
          // Fallback to basic detection
        }
        return null;
      } else if (this.gpuType === 'intel') {
        // Intel monitoring (basic)
        return null;
      } else if (this.gpuType === 'apple') {
        // Apple Silicon monitoring (basic)
        return null;
      }
    } catch (error) {
      return null;
    }
    return null;
  }
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
    showGpuUsage = false
  } = options;
  
  try {
    // Ensure output directory exists
    await fs.ensureDir(output);
    
    let inputFile = input;
    let needsCleanup = false;
    
    // Download file if it's a URL
    if (isUrl(input)) {
      const tempPath = path.join(output, 'temp_source.mp4');
      await downloadFile(input, tempPath);
      inputFile = tempPath;
      needsCleanup = true;
    }

    let sourceInfo = null;
    
    // Analyze source file unless skipped
    if (!skipAnalysis) {
      sourceInfo = await analyzeSource(inputFile);
    } else {
      console.log('⏭️ Skipping source analysis (using defaults)');
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
      gpuConfig = getGpuOptions(gpuInfo.type);
      gpuName = gpuInfo.name;
      console.log(`   Using ${gpuInfo.type.toUpperCase()} acceleration (${gpuName})`);
    }

    // Initialize GPU monitor if requested
    let gpuMonitor = null;
    if (showGpuUsage && useGpu && gpuConfig) {
      const monitorType = gpuConfig.encoder.includes('nvenc') ? 'nvidia' : 
                        gpuConfig.encoder.includes('amf') ? 'amd' : 
                        gpuConfig.encoder.includes('qsv') ? 'intel' : 
                        gpuConfig.encoder.includes('videotoolbox') ? 'apple' : 'unknown';
      gpuMonitor = new GpuMonitor(monitorType);
    }

    // Determine optimal qualities based on source
    const optimalQualities = getOptimalQualities(sourceInfo.height, minQuality);
    
    console.log(`🎯 Generating ${optimalQualities.length} quality levels:`);
    optimalQualities.forEach(q => console.log(`   • ${q.height}p (${q.name})`));

    // Generate master playlist header
    let masterPlaylist = '#EXTM3U\n';
    masterPlaylist += '#EXT-X-VERSION:3\n';
    masterPlaylist += '#EXT-X-INDEPENDENT-SEGMENTS\n\n';

    let playlistResults = [];
    
    // Start GPU monitoring if enabled
    if (gpuMonitor) {
      gpuMonitor.start();
    }
    
    if (sequential) {
      // Process qualities one by one with clean formatting
      console.log('\n🔄 Sequential processing enabled - one quality at a time');
      for (const quality of optimalQualities) {
        console.log(`\n--- Processing ${quality.height}p ---`);
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
          showProgressInNewLine: true // New parameter for clean formatting
        });
        playlistResults.push(result);
      }
    } else if (maxConcurrent) {
      // Process with concurrency limit
      console.log(`\n⚡ Parallel processing with max ${maxConcurrent} concurrent encodes`);
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
      console.log('\n⚡ Parallel processing all qualities simultaneously');
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
          showProgressInNewLine: false // Keep inline for parallel processing
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
    console.log(`\n📝 Master playlist written to: ${masterPlaylistPath}`);

    // Cleanup temporary file if needed
    if (needsCleanup) {
      await fs.remove(inputFile);
      console.log('🧹 Temporary files cleaned up');
    }

  } catch (error) {
    throw new Error(`Transcoding failed: ${error.message}`);
  }
}

async function processWithConcurrencyLimit(qualities, sourceInfo, inputFile, output, segmentDuration, segmentSize, preset, bandwidthRatio, crfOffset, maxConcurrent, gpuConfig, gpuName) {
  const results = [];
  
  for (let i = 0; i < qualities.length; i += maxConcurrent) {
    const batch = qualities.slice(i, i + maxConcurrent);
    console.log(`\n🔄 Processing batch ${Math.floor(i/maxConcurrent) + 1}/${Math.ceil(qualities.length/maxConcurrent)}`);
    
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
        showProgressInNewLine: false // Keep inline for batch processing
      })
    );
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  return results;
}

async function processQualityLevel(options) {
  const { quality, sourceInfo, inputFile, output, segmentDuration, segmentSize, preset, bandwidthRatio, crfOffset, gpuConfig, gpuName, showProgressInNewLine } = options;
  
  return new Promise((resolve, reject) => {
    const targetHeight = quality.height;
    const playlistName = `playlist_${targetHeight}.m3u8`;
    const segmentPrefix = `segment_${targetHeight}`;
    
    // Calculate optimized parameters
    const resolution = getResolutionPreset(targetHeight, sourceInfo.aspectRatio);
    const bitrate = calculateOptimizedBitrate(targetHeight, sourceInfo.videoBitrate, sourceInfo.height, bandwidthRatio);
    const crf = getOptimalCRF(targetHeight, sourceInfo.sourceQuality, crfOffset);
    const gopSize = getGOPSize(sourceInfo.fps);

    console.log(`\n📦 Processing ${targetHeight}p (${resolution.width}x${resolution.height}) - Target bitrate: ${bitrate}k`);
    if (gpuConfig) {
      console.log(`   🔧 CRF: ${crf}, GOP: ${gopSize}, GPU Preset: ${preset}${gpuName ? ` (${gpuName})` : ''}`);
    } else {
      console.log(`   🔧 CRF: ${crf}, GOP: ${gopSize}, CPU Preset: ${preset}`);
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
    } else {
      // CPU processing
      ffmpegCommand.videoCodec('libx264');
    }

    // Common options for both GPU and CPU
    ffmpegCommand
      .audioCodec('aac')
      .size(`${resolution.width}x${resolution.height}`)
      .videoBitrate(`${bitrate}k`)
      .audioBitrate('128k')
      .addOption('-crf', crf.toString())
      .addOption('-preset', preset)
      .addOption('-g', gopSize.toString())
      .addOption('-sc_threshold', '0')
      .addOption('-keyint_min', gopSize.toString())
      .addOption('-b_strategy', '0')
      .addOption('-bf', '3')
      .addOption('-refs', '3');
    
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
        .addOption('-hls_flags', '+discont_start')
        .addOption('-hls_flags', '+delete_segments'); // Delete segments after processing (if needed)
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
        console.log(`🎬 Started ${targetHeight}p transcoding`);
        if (process.env.DEBUG) {
          console.log(`🔧 Command: ${commandLine}`);
        }
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          if (showProgressInNewLine) {
            // For sequential processing, show progress on new lines
            console.log(`📊 ${targetHeight}p Progress: ${Math.round(progress.percent)}%`);
          } else {
            // For parallel processing, update on same line
            process.stdout.write(`\r📊 ${targetHeight}p Progress: ${Math.round(progress.percent)}%`);
          }
        }
      })
      .on('end', () => {
        if (!showProgressInNewLine) {
          // Clear the progress line for parallel processing
          process.stdout.write('\r' + ' '.repeat(50) + '\r');
        }
        console.log(`✅ Completed ${targetHeight}p transcoding`);
        resolve({ masterEntry, quality: targetHeight });
      })
      .on('error', (err) => {
        if (!showProgressInNewLine) {
          // Clear the progress line for parallel processing
          process.stdout.write('\r' + ' '.repeat(50) + '\r');
        }
        console.error(`❌ Error transcoding ${targetHeight}p:`, err.message);
        reject(err);
      })
      .save(path.join(output, playlistName));
  });
}

module.exports = { transcodeVideo };
