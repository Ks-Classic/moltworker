#!/bin/bash
set -e
echo "Starting high-speed parallel upload to R2..."
cd /home/ykoha/moltworker

echo "Uploading skills..."
find skills/ -type f | xargs -I {} -P 8 sh -c 'echo "Uploading {}" && npx wrangler r2 object put "openclaw-data/{}" --file "{}" >/dev/null 2>&1'

echo "Uploading modified agents config..."
find openclaw/agents/ -type f | xargs -I {} -P 8 sh -c 'echo "Uploading {}" && npx wrangler r2 object put "openclaw-data/{}" --file "{}" >/dev/null 2>&1'

echo "Upload to R2 complete! Restarting container by deploying..."
npm run deploy
