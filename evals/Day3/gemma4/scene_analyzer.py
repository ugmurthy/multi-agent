"""
RF-DETR + Gemma 4 Scene Summarization Prototype

This script performs object detection using Roboflow's RF-DETR model and then
uses Google's Gemma 4 (via Gemini API) to generate a natural language summary
of the detected scene.

Usage:
    python scene_analyzer.py --image <path_to_image> --api_key <your_gemini_api_key>

Requirements:
    pip install -r requirements.txt
"""

import argparse
import base64
import io
import json
from pathlib import Path

from PIL import Image
import supervision as sv
from inference import get_model
from google import genai


def detect_objects(image_path: str, model_id: str = "rfdetr-medium", confidence: float = 0.5) -> tuple:
    """
    Run object detection using RF-DETR model.
    
    Args:
        image_path: Path to the input image
        model_id: RF-DETR model variant (e.g., rfdetr-nano, rfdetr-small, rfdetr-medium, etc.)
        confidence: Confidence threshold for detections
        
    Returns:
        Tuple of (annotated_image, detections, class_names_list)
    """
    # Load the RF-DETR model
    model = get_model(model_id)
    
    # Load and preprocess image
    image = Image.open(image_path)
    
    # Run inference
    predictions = model.infer(image, confidence=confidence)[0]
    
    # Convert to Supervision Detections
    detections = sv.Detections.from_inference(predictions)
    
    # Extract class names
    class_names = detections.data.get('class_name', [])
    
    # Create annotators
    box_annotator = sv.BoxAnnotator(
        color=sv.ColorPalette.ROBOFLOW,
        thickness=4
    )
    label_annotator = sv.LabelAnnotator(
        color=sv.ColorPalette.from_matplotlib('viridis', 5),
        text_scale=1.0
    )
    
    # Prepare labels
    labels = [
        f"{class_name} {conf:.2f}"
        for class_name, conf in zip(
            class_names,
            detections.confidence
        )
    ]
    
    # Annotate image
    annotated_image = image.copy()
    annotated_image = box_annotator.annotate(annotated_image, detections)
    annotated_image = label_annotator.annotate(annotated_image, detections, labels)
    
    return annotated_image, detections, class_names


def summarize_scene_with_gemma4(
    image_path: str,
    detected_objects: list,
    api_key: str,
    model_name: str = "gemma-4-31b-it"
) -> str:
    """
    Use Gemma 4 to generate a scene summary based on detected objects.
    
    Args:
        image_path: Path to the input image
        detected_objects: List of detected object class names
        api_key: Google Gemini API key
        model_name: Gemma 4 model variant
        
    Returns:
        Generated scene summary text
    """
    # Initialize the Gemini client
    client = genai.Client(api_key=api_key)
    
    # Upload the image to Google's file service
    print(f"Uploading image to Google Cloud for Gemma 4 processing...")
    file_response = client.files.upload(file=image_path)
    file_uri = file_response.uri
    
    # Create a prompt based on detected objects
    object_list = ", ".join(detected_objects) if detected_objects else "no specific objects"
    
    prompt = f"""You are an expert computer vision analyst. Based on the image provided and the following detected objects: [{object_list}], 
please provide a concise, one-sentence description of the scene. 
Focus on the main subjects, their actions, and the overall context of the image.
Keep the summary under 50 words."""
    
    # Generate content using Gemma 4
    print("Generating scene summary with Gemma 4...")
    response = client.models.generate_content(
        model=model_name,
        contents=[
            {"file_data": {"mime_type": "image/jpeg", "file_uri": file_uri}},
            prompt
        ]
    )
    
    return response.text


def save_results(
    annotated_image,
    summary: str,
    detected_objects: list,
    output_dir: Path
):
    """
    Save the annotated image and summary to the output directory.
    
    Args:
        annotated_image: PIL Image with detection annotations
        summary: Generated scene summary
        detected_objects: List of detected objects
        output_dir: Directory to save results
    """
    # Ensure output directory exists
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Save annotated image
    annotated_image_path = output_dir / "annotated_output.jpg"
    annotated_image.save(annotated_image_path, format="JPEG")
    print(f"Annotated image saved to: {annotated_image_path}")
    
    # Save summary to text file
    summary_path = output_dir / "scene_summary.txt"
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write(f"Scene Summary:\n{summary}\n\n")
        f.write(f"Detected Objects:\n{', '.join(detected_objects)}\n")
    print(f"Summary saved to: {summary_path}")
    
    # Save detailed results as JSON
    results_path = output_dir / "detection_results.json"
    results = {
        "summary": summary,
        "detected_objects": detected_objects,
        "num_detections": len(detected_objects)
    }
    with open(results_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"Results saved to: {results_path}")


def main():
    parser = argparse.ArgumentParser(
        description="RF-DETR + Gemma 4 Scene Summarization Prototype"
    )
    parser.add_argument(
        "--image",
        type=str,
        required=True,
        help="Path to the input image"
    )
    parser.add_argument(
        "--api_key",
        type=str,
        required=True,
        help="Google Gemini API key for Gemma 4"
    )
    parser.add_argument(
        "--model",
        type=str,
        default="rfdetr-medium",
        choices=["rfdetr-nano", "rfdetr-small", "rfdetr-medium", "rfdetr-large"],
        help="RF-DETR model variant to use"
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.5,
        help="Confidence threshold for object detection"
    )
    parser.add_argument(
        "--output_dir",
        type=str,
        default="gemma4/output",
        help="Directory to save results"
    )
    
    args = parser.parse_args()
    
    # Validate input image
    image_path = Path(args.image)
    if not image_path.exists():
        print(f"Error: Image not found at {image_path}")
        return
    
    print("=" * 60)
    print("RF-DETR + Gemma 4 Scene Summarization Prototype")
    print("=" * 60)
    print(f"Input Image: {image_path}")
    print(f"RF-DETR Model: {args.model}")
    print(f"Confidence Threshold: {args.confidence}")
    print(f"Output Directory: {args.output_dir}")
    print("=" * 60)
    
    # Step 1: Run object detection with RF-DETR
    print("\n[Step 1] Running object detection with RF-DETR...")
    annotated_image, detections, class_names = detect_objects(
        str(image_path),
        model_id=args.model,
        confidence=args.confidence
    )
    
    print(f"Detected {len(class_names)} objects: {class_names}")
    
    # Step 2: Generate scene summary with Gemma 4
    print("\n[Step 2] Generating scene summary with Gemma 4...")
    summary = summarize_scene_with_gemma4(
        str(image_path),
        class_names,
        args.api_key
    )
    
    print(f"\nScene Summary:\n{summary}")
    
    # Step 3: Save results
    print("\n[Step 3] Saving results...")
    save_results(
        annotated_image,
        summary,
        class_names,
        Path(args.output_dir)
    )
    
    print("\n" + "=" * 60)
    print("Processing complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
