#!/bin/bash
# Double-click file này để scan + bật server + mở browser
cd "$(dirname "$0")"
echo "🔍 Scanning banners..."
node scan.js --serve
