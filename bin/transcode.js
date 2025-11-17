#!/usr/bin/env node

const { Command } = require('commander');
const path = require('path');
const { transcodeVideo } = require('../lib/transcoder');
const fs = require('fs-extra');

const program = new Command();

program
  .name('transcode')
  .description('Intelligent CLI tool for transcoding videos to optimized HLS format')
  .version('1.1.0')
  .option('-i, --input <url>', 'Input video file path or URL')
  .option('-o, --output <folder>', 'Output folder for HLS files')
  .option('-b, --bandwidth-ratio <ratio>', 'Bandwidth ratio for quality generation (0.1-2.0)', '1.0')
  .option('--segment-duration <seconds>', 'HLS segment duration', '6')
  .option('--preset <preset>', 'FFmpeg preset (ultrafast,superfast,veryfast,faster,fast,medium,slow,slower,veryslow)', 'medium')
  .option('--crf-offset <value>', 'CRF offset adjustment (-5 to +5)', '0')
  .option('--min-quality <quality>', 'Minimum quality to generate (144,240,360,480)', '360')
  .option('--skip-analysis', 'Skip source file analysis (faster but less accurate)', false)
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

      console.log(`🎬 Smart HLS Transcoding Started`);
      console.log(`📥 Input: ${options.input}`);
      console.log(`📤 Output: ${path.resolve(options.output)}`);

      await transcodeVideo({
        input: options.input,
        output: path.resolve(options.output),
        bandwidthRatio: parseFloat(options.bandwidthRatio),
        segmentDuration: parseInt(options.segmentDuration),
        preset: options.preset,
        crfOffset: parseInt(options.crfOffset),
        minQuality: parseInt(options.minQuality),
        skipAnalysis: options.skipAnalysis
      });

      console.log('\n✅ Transcoding completed successfully!');
      console.log(`📁 HLS files are available in: ${path.resolve(options.output)}`);

    } catch (error) {
      console.error('❌ Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
