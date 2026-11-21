#!/bin/sh
# Lädt die KI-Modelle für „Motiv auswählen“ / „Hintergrund entfernen“ (Quelle: rembg-Projekt, Modelle Apache-2.0)
set -e
cd "$(dirname "$0")/../public/models"
for m in silueta isnet-anime; do
  [ -f "$m.onnx" ] || curl -L -o "$m.onnx" "https://github.com/danielgatis/rembg/releases/download/v0.0.0/$m.onnx"
done
[ -f lama.onnx ] || curl -L -o lama.onnx "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/inpainting_lama/inpainting_lama_2025jan.onnx"
