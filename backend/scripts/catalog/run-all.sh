#!/usr/bin/env bash
# Keeps building catalog videos until all 220 exist (content files can be added while it runs).
#   scripts/catalog/run-all.sh <env-file> <out-dir>
set -u
ENV_FILE=$1
OUT=$2
NODE=${NODE:-node}
for i in $(seq 1 200); do
  nice -n 10 "$NODE" --env-file="$ENV_FILE" scripts/catalog/build.ts --out "$OUT" --parallel 2
  n=$(ls "$OUT"/*.mp4 2>/dev/null | wc -l)
  echo "[run-all] round $i: $n videos"
  [ "$n" -ge 220 ] && break
  sleep 60
done
