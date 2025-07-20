#!/bin/bash

# Build embeddingsearch binaries for different platforms

set -e

echo "Building embeddingsearch binaries..."

# Create bin directory structure
mkdir -p ../../bin/{linux,darwin,win32}

# Build for Linux
echo "Building for Linux..."
GOOS=linux GOARCH=amd64 go build -o ../../bin/linux/embeddingsearch main.go

# Build for macOS (Darwin)
echo "Building for macOS..."
GOOS=darwin GOARCH=amd64 go build -o ../../bin/darwin/embeddingsearch main.go
GOOS=darwin GOARCH=arm64 go build -o ../../bin/darwin/embeddingsearch-arm64 main.go

# Build for Windows
echo "Building for Windows..."
GOOS=windows GOARCH=amd64 go build -o ../../bin/win32/embeddingsearch.exe main.go

echo "Build complete!"
echo "Binaries created in bin/ directory"

# Make binaries executable
chmod +x ../../bin/linux/embeddingsearch
chmod +x ../../bin/darwin/embeddingsearch
chmod +x ../../bin/darwin/embeddingsearch-arm64

ls -la ../../bin/*/