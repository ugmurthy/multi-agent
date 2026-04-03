#!/bin/bash
for file in *; do
  if [ -f "$file" ]; then
    size=$(du -k "$file" | cut -f1)
    echo "$size KB $file"
  fi
done
