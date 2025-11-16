# Smart HLS Transcoder

An intelligent CLI tool that automatically optimizes HLS transcoding based on source file characteristics. No more manual bitrate calculations or unnecessary upscaling!

## Features

- 🎯 **Automatic Quality Detection**: Only generates qualities suitable for your source
- ⚡ **Smart Bitrate Optimization**: Dynamically calculates optimal bitrates
- 📏 **No Upscaling**: Never upscales beyond source resolution
- 🎨 **Adaptive CRF**: Automatically adjusts compression based on source quality
- 🌐 **URL Support**: Directly transcode from remote URLs
- 📊 **Source Analysis**: Intelligently analyzes source characteristics

## Prerequisites

First, install FFmpeg on your system:

**macOS:**
```bash
brew install ffmpeg
