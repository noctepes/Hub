#!/bin/bash
# Double-click file này để scan + bật server + mở browser
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "❌ Cần cài Node.js"; exit 1; }
DIR="$1"
if [ -z "$DIR" ]; then
  read -p "Kéo thả folder banner vào đây rồi Enter: " DIR
fi
# Bỏ quote/escape do Terminal thêm khi kéo thả
DIR="${DIR%\'}"; DIR="${DIR#\'}"
DIR="${DIR//\\ / }"
DIR="${DIR% }"
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "❌ Folder không hợp lệ: $DIR"
  exit 1
fi
echo "🔍 Scanning banners..."
node scan.js --serve "--dir=$DIR"
