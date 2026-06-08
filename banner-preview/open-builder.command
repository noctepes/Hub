#!/bin/bash
# Double-click file này để bật server + mở banner-builder.html
cd "$(dirname "$0")"

PORT=8766
# Tìm port trống nếu 8766 đã dùng
while lsof -i :$PORT >/dev/null 2>&1; do
  PORT=$((PORT+1))
done

URL="http://localhost:$PORT/banner-builder.html"
echo "🌐 Builder: $URL"
echo "   Giữ terminal này mở. Ctrl+C để tắt."
echo ""

# Mở browser sau 0.5s để server kịp start
(sleep 2 && open "$URL") &

# Python3 có sẵn trên macOS
python3 -m http.server $PORT --bind 127.0.0.1
