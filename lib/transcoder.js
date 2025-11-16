const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs-extra');
const path = require('path');
const { analyzeSource, getOptimalQualities } = require('./analyzer');
const { getResolutionPreset, calculateOptimizedBitrate, getOptimalCRF } = require('./presets');
const { downloadFile, isUrl, getGOPSize } = require('./utils');

async function transcodeVideo(options) {
  const { input, output, bandwidthRatio = 1.0, segmentDuration = 6, preset = 'medium', crfOffset = 0, minQuality = 360, skipAnalysis = false } = options;
  
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

    // Determine optimal qualities based on source
    const optimalQualities = getOptimalQualities(sourceInfo.height, minQuality);
    
    console.log(`🎯 Generating ${optimalQualities.length} quality levels:`);
    optimalQualities.forEach(q => console.log(`   • ${q.height}p (${q.name})`));

    // Generate master playlist header
    let masterPlaylist = '#EXTM3U\n';
    masterPlaylist += '#EXT-X-VERSION:3\n';
    masterPlaylist += '#EXT-X-INDEPENDENT-SEGMENTS\n\n';

    const promises = [];

    // Process each quality level
    for (const quality of optimalQualities) {
      const playlistPromise = processQualityLevel({
        quality,
        sourceInfo,
        inputFile,
        output,
        segmentDuration,
        preset,
        bandwidthRatio,
        crfOffset
      });

      promises.push(playlistPromise);
    }

    // Wait for all qualities to complete and collect playlist info
    const playlistResults = await Promise.all(promises);

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

async function processQualityLevel(options) {
  const { quality, sourceInfo, inputFile, output, segmentDuration, preset, bandwidthRatio, crfOffset } = options;
  
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
    console.log(`   🔧 CRF: ${crf}, GOP: ${gopSize}, Preset: ${preset}`);

    // Calculate bandwidth for master playlist (in bits per second)
    const bandwidth = bitrate * 1000;

    // Create master playlist entry
    const masterEntry = `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution.width}x${resolution.height},NAME="${quality.name}"\n${playlistName}\n\n`;

    // Start transcoding
    ffmpeg(inputFile)
      .videoCodec('libx264')
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
