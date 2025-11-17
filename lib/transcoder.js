const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { analyzeSource, getOptimalQualities } = require('./analyzer');
const { getResolutionPreset, calculateOptimizedBitrate, getOptimalCRF } = require('./presets');
const { downloadFile, isUrl, getGOPSize } = require('./utils');

// Auto-detect GPU type (simplified)
function detectGpuType() {
  console.log('🔍 Auto-detecting GPU...');
  
  // In a real implementation, you'd check system capabilities
  // For now, we'll just return a default or let user specify
  
  const platform = process.platform;
  
  if (platform === 'win32') {
    console.log('   Windows detected - assuming NVIDIA (use --gpu-type to override)');
    return 'nvidia';
  } else if (platform === 'darwin') {
    console.log('   macOS detected - assuming Apple Silicon (VideoToolbox)');
    return 'apple';
  } else {
    console.log('   Linux detected - assuming NVIDIA (use --gpu-type to override)');
    return 'nvidia';
  }
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

async function transcodeVideo(options) {
  const { 
    input, 
    output, 
    bandwidthRatio = 1.0, 
    segmentDuration = 6, 
    preset = 'medium', 
    crfOffset = 0, 
    minQuality = 360, 
    skipAnalysis = false,
    sequential = false,
    maxConcurrent = null,
    useGpu = false,
    gpuType = 'auto'
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
    if (useGpu) {
      const detectedGpuType = gpuType === 'auto' ? detectGpuType() : gpuType;
      gpuConfig = getGpuOptions(detectedGpuType);
      console.log(`   Using ${detectedGpuType.toUpperCase()} acceleration`);
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
    
    if (sequential) {
      // Process qualities one by one
      console.log('\n🔄 Sequential processing enabled - one quality at a time');
      for (const quality of optimalQualities) {
        console.log(`\n--- Processing ${quality.height}p ---`);
        const result = await processQualityLevel({
          quality,
          sourceInfo,
          inputFile,
          output,
          segmentDuration,
          preset,
          bandwidthRatio,
          crfOffset,
          gpuConfig
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
        preset,
        bandwidthRatio,
        crfOffset,
        maxConcurrent,
        gpuConfig
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
          preset,
          bandwidthRatio,
          crfOffset,
          gpuConfig
        })
      );
      playlistResults = await Promise.all(promises);
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

async function processWithConcurrencyLimit(qualities, sourceInfo, inputFile, output, segmentDuration, preset, bandwidthRatio, crfOffset, maxConcurrent, gpuConfig) {
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
        preset,
        bandwidthRatio,
        crfOffset,
        gpuConfig
      })
    );
    
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }
  
  return results;
}

async function processQualityLevel(options) {
  const { quality, sourceInfo, inputFile, output, segmentDuration, preset, bandwidthRatio, crfOffset, gpuConfig } = options;
  
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
      console.log(`   🔧 CRF: ${crf}, GOP: ${gopSize}, GPU Preset: ${preset}`);
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
      .addOption('-refs', '3')
      .addOption('-hls_time', segmentDuration.toString())
      .addOption('-hls_list_size', '0')
      .addOption('-hls_segment_filename', path.join(output, `${segmentPrefix}_%03d.ts`))
      .addOption('-f', 'hls')
      .addOption('-hls_playlist_type', 'event')
      .on('start', (commandLine) => {
        console.log(`🎬 Started ${targetHeight}p transcoding`);
        if (process.env.DEBUG) {
          console.log(`🔧 Command: ${commandLine}`);
        }
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          process.stdout.write(`\r📊 ${targetHeight}p Progress: ${Math.round(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log(`\n✅ Completed ${targetHeight}p transcoding`);
        resolve({ masterEntry, quality: targetHeight });
      })
      .on('error', (err) => {
        console.error(`\n❌ Error transcoding ${targetHeight}p:`, err.message);
        reject(err);
      })
      .save(path.join(output, playlistName));
  });
}

module.exports = { transcodeVideo };
