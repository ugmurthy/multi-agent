"""
Quick Test Script for RF-DETR + Gemma 4 Prototype

This script demonstrates the basic functionality with a sample image URL.
Use this to verify your installation before running the main script.

Usage:
    python quick_test.py --api_key <your_gemini_api_key>
"""

import argparse
import requests
from PIL import Image
import supervision as sv
from inference import get_model
from google import genai


def quick_test(api_key: str):
    """Run a quick test with a sample image from Roboflow."""
    
    # Sample image URL from Roboflow
    image_url = "https://media.roboflow.com/dog.jpg"
    
    print("=" * 60)
    print("RF-DETR + Gemma 4 Quick Test")
    print("=" * 60)
    
    # Step 1: Download and display sample image info
    print(f"\nDownloading sample image from: {image_url}")
    response = requests.get(image_url, stream=True)
    image = Image.open(response.raw)
    print(f"Image loaded: {image.size[0]}x{image.size[1]} pixels")
    
    # Step 2: Run RF-DETR detection
    print("\n[1/3] Running RF-DETR object detection...")
    model = get_model("rfdetr-medium")
    predictions = model.infer(image, confidence=0.5)[0]
    detections = sv.Detections.from_inference(predictions)
    
    class_names = detections.data.get('class_name', [])
    print(f"Detected {len(class_names)} objects: {class_names}")
    
    # Create annotated image
    box_annotator = sv.BoxAnnotator(color=sv.ColorPalette.ROBOFLOW, thickness=4)
    label_annotator = sv.LabelAnnotator(color=sv.ColorPalette.from_matplotlib('viridis', 5))
    
    labels = [f"{cn} {conf:.2f}" for cn, conf in zip(class_names, detections.confidence)]
    annotated_image = image.copy()
    annotated_image = box_annotator.annotate(annotated_image, detections)
    annotated_image = label_annotator.annotate(annotated_image, detections, labels)
    
    # Save annotated image
    annotated_image.save("test_annotated.jpg")
    print("Saved annotated image to: test_annotated.jpg")
    
    # Step 3: Generate summary with Gemma 4
    print("\n[2/3] Generating scene summary with Gemma 4...")
    client = genai.Client(api_key=api_key)
    
    # Upload image
    file_response = client.files.upload(file="test_annotated.jpg")
    
    # Create prompt
    object_list = ", ".join(class_names) if class_names else "no specific objects"
    prompt = f"""Based on the image and detected objects: [{object_list}], 
provide a one-sentence description of the scene. Keep it under 30 words."""
    
    # Generate summary
    response = client.models.generate_content(
        model="gemma-4-31b-it",
        contents=[
            {"file_data": {"mime_type": "image/jpeg", "file_uri": file_response.uri}},
            prompt
        ]
    )
    
    summary = response.text
    print(f"\n[3/3] Scene Summary:\n{summary}")
    
    print("\n" + "=" * 60)
    print("Quick test completed successfully!")
    print("You can now run: python scene_analyzer.py --image <your_image> --api_key <your_key>")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="Quick test for RF-DETR + Gemma 4 prototype")
    parser.add_argument("--api_key", type=str, required=True, help="Google Gemini API key")
    args = parser.parse_args()
    
    quick_test(args.api_key)


if __name__ == "__main__":
    main()
