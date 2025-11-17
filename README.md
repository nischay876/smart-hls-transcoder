# Smart HLS Transcoder

[![npm version](https://badge.fury.io/js/smart-hls-transcoder.svg)](https://badge.fury.io/js/smart-hls-transcoder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An intelligent CLI tool that automatically optimizes HLS transcoding based on source file characteristics with optional GPU acceleration support.

## Features

- 🎯 **Automatic Quality Detection**: Only generates qualities suitable for your source
- ⚡ **Smart Bitrate Optimization**: Dynamically calculates optimal bitrates
- 📏 **No Upscaling**: Never upscales beyond source resolution
- 🎨 **Adaptive CRF**: Automatically adjusts compression based on source quality
- 🌐 **URL Support**: Directly transcode from remote URLs
- 📊 **Source Analysis**: Intelligently analyzes source characteristics
- 🎮 **GPU Acceleration**: Optional NVIDIA/Intel/AMD/Apple GPU support
- 🔄 **Flexible Processing**: Sequential or parallel processing modes

## Prerequisites

First, install FFmpeg on your system:

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [FFmpeg official website](https://ffmpeg.org/download.html)

## Installation

```bash
npm install -g smart-hls-transcoder
```

## Quick Start

```bash
# Basic usage - automatically detects optimal settings
transcode -i https://example.com/video.mp4 -o ./hls-output

# For 1080p source, generates: 1080p, 720p, 480p, 360p (no upscaling!)
```

## Advanced Usage

### GPU Acceleration
```bash
# Enable GPU acceleration (auto-detect)
transcode -i input.mp4 -o output --gpu

# Specify GPU type
transcode -i input.mp4 -o output --gpu --gpu-type nvidia
```

### System Resource Management
```bash
# Process one quality at a time (low system load)
transcode -i input.mp4 -o output --sequential

# Limit concurrent encodes
transcode -i input.mp4 -o output --max-concurrent 2
```

### Quality Optimization
```bash
# Preserve high quality
transcode -i input.mp4 -o output --bandwidth-ratio 1.5 --crf-offset -2

# Optimize for mobile/low bandwidth
transcode -i input.mp4 -o output --bandwidth-ratio 0.7 --crf-offset 2

# Include lower qualities
transcode -i input.mp4 -o output --min-quality 144
```

## How It Works

### Intelligent Quality Selection
- **4K source** → Generates: 4K, 1440p, 1080p, 720p, 480p, 360p
- **1080p source** → Generates: 1080p, 720p, 540p, 480p, 360p
- **720p source** → Generates: 720p, 480p, 360p
- **480p source** → Generates: 480p, 360p

### Dynamic Bitrate Optimization
- Analyzes source bitrate and resolution
- Calculates optimal bitrates for each quality level
- Prevents over-compression or under-compression

### Adaptive Compression
- Automatically adjusts CRF based on source quality
- Higher quality sources get lower CRF values
- Maintains consistent visual quality across all renditions

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `-i, --input <url>` | Input video file path or URL | Required |
| `-o, --output <folder>` | Output folder for HLS files | Required |
| `-b, --bandwidth-ratio <ratio>` | Bandwidth adjustment (0.1-2.0) | 1.0 |
| `--segment-duration <seconds>` | HLS segment duration | 6 |
| `--preset <preset>` | FFmpeg preset | medium |
| `--crf-offset <value>` | CRF adjustment (-5 to +5) | 0 |
| `--min-quality <quality>` | Minimum quality to generate | 360 |
| `--skip-analysis` | Skip source analysis (faster) | false |
| `--sequential` | Process qualities one at a time | false |
| `--max-concurrent <number>` | Max simultaneous encodes | Unlimited |
| `--gpu` | Enable GPU acceleration | false |
| `--gpu-type <type>` | GPU type: nvidia, intel, amd, apple | auto |

## Output Structure

```
hls-output/
├── master.m3u8              # Master playlist
├── playlist_1080.m3u8       # 1080p playlist (if source supports it)
├── playlist_720.m3u8        # 720p playlist
├── playlist_480.m3u8        # 480p playlist
├── playlist_360.m3u8        # 360p playlist
├── segment_1080_001.ts      # 1080p segments
├── segment_720_001.ts       # 720p segments
├── segment_480_001.ts       # 480p segments
└── segment_360_001.ts       # 360p segments
```

## GPU Acceleration Support

### Supported GPU Types:
- **NVIDIA** (`nvidia`): NVENC/NVDEC (CUDA)
- **Intel** (`intel`): Quick Sync Video (QSV)
- **AMD** (`amd`): AMF (Advanced Media Framework)
- **Apple** (`apple`): VideoToolbox (macOS)

### Benefits:
- ⚡ **5-10x faster** processing speeds
- 🔋 **Lower CPU usage**
- 🚀 **Higher throughput** for batch processing
- 💰 **Reduced electricity costs**

## Examples

### 4K Source File
```bash
transcode -i 4k-video.mp4 -o hls-4k
# Output: 4K, 1440p, 1080p, 720p, 480p, 360p
```

### 720p Source File with GPU
```bash
transcode -i 720p-video.mp4 -o hls-720p --gpu
# Output: 720p, 480p, 360p (no upscaling!) with GPU acceleration
```

### High Quality Preservation
```bash
transcode -i high-quality.mp4 -o output --bandwidth-ratio 1.3 --crf-offset -2
# Increases quality for premium content
```

### Low System Resources
```bash
transcode -i video.mp4 -o output --sequential --bandwidth-ratio 0.8
# Processes one quality at a time with reduced bitrates
```

## Programmatic Usage

```javascript
const { transcodeVideo } = require('smart-hls-transcoder');

await transcodeVideo({
  input: './input.mp4',
  output: './hls-output',
  bandwidthRatio: 1.0,
  segmentDuration: 6,
  preset: 'medium',
  crfOffset: 0,
  minQuality: 360,
  skipAnalysis: false,
  sequential: false,
  maxConcurrent: null,
  useGpu: false,
  gpuType: 'auto'
});
```

## Quality Levels

| Height | Name | When Generated |
|--------|------|----------------|
| 2160 | 4K | Source ≥ 2160p |
| 1440 | 1440p | Source ≥ 1440p |
| 1080 | 1080p | Source ≥ 1080p |
| 720 | 720p | Source ≥ 720p |
| 540 | 540p | Source ≥ 540p |
| 480 | 480p | Source ≥ 480p |
| 360 | 360p | Always |
| 240 | 240p | Source ≤ 480p |
| 144 | 144p | Source ≤ 360p |

## Troubleshooting

### "ffmpeg not found"
Make sure FFmpeg is installed and accessible in your PATH.

### Slow processing
- Use `--gpu` for hardware acceleration
- Use `--preset faster` for quicker encoding
- Use `--sequential` for low system resources
- Use `--skip-analysis` for faster processing (less accurate)

### Large file sizes
- Reduce `--bandwidth-ratio` (e.g., 0.7)
- Increase `--crf-offset` (e.g., +2) to compress more aggressively

### GPU not working
- Ensure proper GPU drivers are installed
- Verify FFmpeg was compiled with GPU support
- Try specifying `--gpu-type` explicitly

## Requirements

- Node.js ≥ 14.0.0
- FFmpeg with required codecs
- For GPU acceleration: Compatible GPU with proper drivers

## License

MIT

## Author

Created with ❤️ for video processing enthusiasts