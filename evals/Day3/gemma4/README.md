# RF-DETR + Gemma 4 Scene Summarization Prototype

A Python prototype that combines **Roboflow's RF-DETR** for real-time object detection with **Google's Gemma 4** (via Gemini API) for intelligent scene summarization. This tool detects objects in images and generates natural language descriptions of the scene.

## Features

- **Object Detection**: Uses RF-DETR (Roboflow's state-of-the-art transformer-based detection model) to identify objects in images
- **Scene Summarization**: Leverages Gemma 4's vision capabilities to generate concise, contextual scene descriptions
- **Visual Annotations**: Creates annotated images with bounding boxes and labels
- **Multiple Output Formats**: Saves results as images, text summaries, and JSON

## Requirements

- Python 3.10+
- Google Gemini API key (free tier available)
- Internet connection (for API calls)

## Installation

1. **Clone or download this repository**

2. **Create a virtual environment** (recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Get a Google Gemini API Key**:
   - Visit [Google AI Studio](https://aistudio.google.com/)
   - Sign in with your Google account
   - Create a new API key
   - Copy the key for use in the script

## Usage

### Basic Usage

```bash
python scene_analyzer.py --image <path_to_image> --api_key <your_gemini_api_key>
```

### Example

```bash
python scene_analyzer.py --image ./sample.jpg --api_key "AIzaSy..."
```

### Advanced Options

```bash
python scene_analyzer.py \
    --image ./sample.jpg \
    --api_key "AIzaSy..." \
    --model rfdetr-large \
    --confidence 0.7 \
    --output_dir ./results
```

### Command Line Arguments

| Argument | Description | Default | Options |
|----------|-------------|---------|---------|
| `--image` | Path to input image (required) | - | - |
| `--api_key` | Google Gemini API key (required) | - | - |
| `--model` | RF-DETR model variant | `rfdetr-medium` | `rfdetr-nano`, `rfdetr-small`, `rfdetr-medium`, `rfdetr-large` |
| `--confidence` | Detection confidence threshold | `0.5` | Float (0.0-1.0) |
| `--output_dir` | Output directory for results | `gemma4/output` | Any valid path |

## Output Files

After running the script, the following files will be created in the output directory:

1. **`annotated_output.jpg`**: Image with bounding boxes and labels around detected objects
2. **`scene_summary.txt`**: Text file containing the Gemma 4 generated summary and detected objects
3. **`detection_results.json`**: JSON file with structured detection results and summary

## RF-DETR Model Variants

| Model | Size | COCO AP50 | Latency (ms) | Best For |
|-------|------|-----------|--------------|----------|
| `rfdetr-nano` | 30.5M | 67.6 | 2.3 | Edge devices, fast inference |
| `rfdetr-small` | 32.1M | 72.1 | 3.5 | Balanced performance |
| `rfdetr-medium` | 33.7M | 73.6 | 4.4 | Default, good accuracy |
| `rfdetr-large` | 33.9M | 75.1 | 6.8 | High accuracy needs |

## Gemma 4 Model

This prototype uses **Gemma 4 31B** (`gemma-4-31b-it`) via the Gemini API. Gemma 4 is Google's latest open model with:

- **Multimodal capabilities**: Processes text, images, and audio
- **256K context window**: Handles long documents and complex inputs
- **Advanced reasoning**: Optimized for multi-step logical tasks
- **Vision understanding**: Excellent image captioning and scene analysis

## Example Output

**Input**: An image of a street scene with cars and pedestrians

**Detected Objects**: `['car', 'car', 'person', 'person', 'traffic light']`

**Gemma 4 Summary**: 
> "A busy urban street scene with multiple vehicles in motion and pedestrians crossing at an intersection, illuminated by traffic signals."

## Troubleshooting

### API Key Errors
- Ensure your API key is valid and not expired
- Check that you have access to the Gemini API
- Verify the key format (should start with `AIzaSy...`)

### Image Not Found
- Use absolute paths or ensure the relative path is correct
- Supported formats: JPG, JPEG, PNG, WEBP

### Detection Issues
- Try adjusting the `--confidence` threshold (lower = more detections)
- Use a larger model variant (`rfdetr-large`) for better accuracy
- Ensure images are well-lit and objects are clearly visible

### Installation Errors
- Ensure Python 3.10 or higher is installed
- Try updating pip: `pip install --upgrade pip`
- Check system dependencies for Pillow and OpenCV

## License

This prototype is provided for educational and research purposes. 

- **RF-DETR**: Apache License 2.0
- **Gemma 4**: Gemma 4 License (see [Google's terms](https://ai.google.dev/gemma/docs/license))
- **This code**: MIT License

## References

- [RF-DETR GitHub](https://github.com/roboflow/rf-detr)
- [Roboflow Inference Documentation](https://docs.roboflow.com/inference)
- [Gemma 4 Documentation](https://ai.google.dev/gemma/docs)
- [Gemini API Reference](https://ai.google.dev/api)

## Contributing

Feel free to submit issues and enhancement requests! This is a prototype and can be extended with:

- Video processing support
- Custom model fine-tuning
- Web interface
- Batch processing
- Real-time camera input

---

**Note**: This prototype requires a Google Gemini API key. The free tier includes generous quotas for testing and development purposes.
