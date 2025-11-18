#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { transcodeVideo } = require('../lib/transcoder');
const fs = require('fs-extra');

const program = new Command();

program
  .name('transcode')
  .description('Intelligent CLI tool for transcoding videos to optimized HLS format')
  .version('1.1.3')
  .option('-i, --input <url>', 'Input video file path or URL')
  .option('-o, --output <folder>', 'Output folder for HLS files')
  .option('-b, --bandwidth-ratio <ratio>', 'Bandwidth ratio for quality generation (0.1-2.0)', '1.0')
  .option('--segment-duration <seconds>', 'HLS segment duration', '6')
  .option('--segment-size <megabytes>', 'HLS segment size in MB (alternative to segment duration)', '')
  .option('--preset <preset>', 'FFmpeg preset (ultrafast,superfast,veryfast,faster,fast,medium,slow,slower,veryslow)', 'medium')
  .option('--crf-offset <value>', 'CRF offset adjustment (-5 to +5)', '0')
  .option('--min-quality <quality>', 'Minimum quality to generate (144,240,360,480)', '360')
  .option('--skip-analysis', 'Skip source file analysis (faster but less accurate)', false)
  .option('--sequential', 'Process qualities sequentially (one at a time) instead of parallel', false)
  .option('--max-concurrent <number>', 'Maximum number of concurrent encodes (default: unlimited/CPU cores)', '')
  .option('--gpu', 'Use GPU acceleration if available', false)
  .option('--gpu-type <type>', 'GPU type: nvidia, intel, amd, apple (auto-detected if not specified)', 'auto')
  .option('--show-gpu-usage', 'Show GPU usage during transcoding', false)
  .option('--dry-run', 'Show what would be done without actually doing it', false)
  .action(async (options) => {
    try {
      if (!options.input) {
        console.error('❌ Error: Input file is required (-i)');
        process.exit(1);
      }
      
      if (!options.output) {
        console.error('❌ Error: Output folder is required (-o)');
        process.exit(1);
      }

      // Validate segment options
      if (options.segmentSize && options.segmentDuration && options.segmentDuration !== '6') {
        console.error('❌ Error: Cannot specify both --segment-duration and --segment-size');
        process.exit(1);
      }

      // Validate numeric inputs
      const bandwidthRatio = parseFloat(options.bandwidthRatio);
      if (isNaN(bandwidthRatio) || bandwidthRatio < 0.1 || bandwidthRatio > 2.0) {
        console.error('❌ Error: Bandwidth ratio must be between 0.1 and 2.0');
        process.exit(1);
      }

      const crfOffset = parseInt(options.crfOffset);
      if (isNaN(crfOffset) || crfOffset < -5 || crfOffset > 5) {
        console.error('❌ Error: CRF offset must be between -5 and +5');
        process.exit(1);
      }

      const minQuality = parseInt(options.minQuality);
      if (isNaN(minQuality) || ![144, 240, 360, 480, 540, 720, 1080, 1440, 2160, 2880, 3600, 4320, 5040, 5760, 6480, 7200, 7920, 8640].includes(minQuality)) {
        console.error('❌ Error: Min quality must be a supported resolution');
        process.exit(1);
      }

      const segmentDuration = options.segmentSize ? null : parseInt(options.segmentDuration);
      if (segmentDuration && (isNaN(segmentDuration) || segmentDuration <= 0)) {
        console.error('❌ Error: Segment duration must be a positive number');
        process.exit(1);
      }

      const segmentSize = options.segmentSize ? parseFloat(options.segmentSize) : null;
      if (segmentSize && (isNaN(segmentSize) || segmentSize <= 0)) {
        console.error('❌ Error: Segment size must be a positive number');
        process.exit(1);
      }

      const maxConcurrent = options.maxConcurrent ? parseInt(options.maxConcurrent) : null;
      if (maxConcurrent && (isNaN(maxConcurrent) || maxConcurrent <= 0)) {
        console.error('❌ Error: Max concurrent must be a positive number');
        process.exit(1);
      }

      await transcodeVideo({
        input: options.input,
        output: path.resolve(options.output),
        bandwidthRatio,
        segmentDuration,
        segmentSize,
        preset: options.preset,
        crfOffset,
        minQuality,
        skipAnalysis: options.skipAnalysis,
        sequential: options.sequential,
        maxConcurrent,
        useGpu: options.gpu,
        gpuType: options.gpuType,
        showGpuUsage: options.showGpuUsage,
        dryRun: options.dryRun
      });

      if (!options.dryRun) {
        console.log('\n✅ Transcoding completed successfully!');
        console.log(`📁 HLS files are available in: ${path.resolve(options.output)}`);
      } else {
        console.log('\n📋 Dry run completed successfully!');
      }

    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
