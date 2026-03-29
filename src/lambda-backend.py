import json
import boto3
import base64
import os
import uuid
from datetime import datetime
from decimal import Decimal
from botocore.exceptions import ClientError

# Initialize AWS clients
bedrock_runtime = boto3.client('bedrock-runtime', region_name=os.environ.get('REGION', 'us-east-1'))
s3_client = boto3.client('s3', region_name=os.environ.get('REGION', 'us-east-1'))
rekognition_client = boto3.client('rekognition', region_name=os.environ.get('REGION', 'us-east-1'))
dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('REGION', 'us-east-1'))

# Environment variables (strip whitespace to prevent issues)
REGION = os.environ.get('REGION', 'us-east-1').strip()
S3_BUCKET = os.environ.get('S3_BUCKET', '').strip()
DDB_TABLE = os.environ.get('DDB_TABLE', '').strip()
IMAGE_MODEL_ID = os.environ.get('IMAGE_MODEL_ID', 'stability.stable-image-ultra-v1:0').strip()
TEXT_MODEL_ID = os.environ.get('TEXT_MODEL_ID', 'amazon.titan-text-premier-v1:0').strip()
USE_REKOGNITION = os.environ.get('USE_REKOGNITION', 'true').lower().strip() == 'true'
USE_DDB = os.environ.get('USE_DDB', 'true').lower().strip() == 'true'
PRESIGNED_URL_EXPIRATION = int(os.environ.get('PRESIGNED_URL_EXPIRATION', '3600'))
NUM_CAPTIONS = int(os.environ.get('NUM_CAPTIONS', '5'))


def generate_image(prompt):
    """Generate an image using Amazon Bedrock Image Generator (supports multiple models)."""
    try:
        # Detect which model family is being used
        model_lower = IMAGE_MODEL_ID.lower()
        
        if 'stability' in model_lower or 'stable' in model_lower:
            # Stable Diffusion models (Ultra, SD3 Large, Core)
            request_body = {
                "prompt": prompt,
                "aspect_ratio": "1:1",
                "output_format": "png"
            }
            
            # Add negative prompts for photorealistic quality
            if 'ultra' in model_lower or 'sd3' in model_lower:
                request_body["negative_prompt"] = "ugly, blurry, low quality, distorted, deformed, bad anatomy, cartoon, anime, illustration"
                
        elif 'nova' in model_lower:
            # Amazon Nova Canvas
            request_body = {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {
                    "text": prompt,
                    "negativeText": "ugly, blurry, low quality, distorted, deformed"
                },
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "quality": "premium",
                    "height": 1024,
                    "width": 1024
                }
            }
        else:
            # Amazon Titan Image Generator (fallback)
            request_body = {
                "taskType": "TEXT_IMAGE",
                "textToImageParams": {
                    "text": prompt
                },
                "imageGenerationConfig": {
                    "numberOfImages": 1,
                    "quality": "standard",
                    "cfgScale": 8.0,
                    "height": 1024,
                    "width": 1024,
                    "seed": 0
                }
            }
        
        print(f"Using image model: {IMAGE_MODEL_ID}")
        
        response = bedrock_runtime.invoke_model(
            modelId=IMAGE_MODEL_ID,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(request_body)
        )
        
        # Read the response body (handle both stream and direct response)
        body_stream = response.get("body")
        if hasattr(body_stream, "read"):
            response_data = body_stream.read()
        else:
            response_data = body_stream
        
        # Parse JSON response
        response_body = json.loads(response_data)
        
        # Extract base64 image from response (different models have different formats)
        image_base64 = None
        
        if 'images' in response_body and len(response_body['images']) > 0:
            # Amazon Titan / Nova format
            image_base64 = response_body['images'][0]
        elif 'artifacts' in response_body and len(response_body['artifacts']) > 0:
            # Stable Diffusion format
            image_base64 = response_body['artifacts'][0].get('base64')
        
        if not image_base64:
            raise Exception("No image data found in Bedrock response")
        
        # Decode base64 to bytes
        try:
            image_bytes = base64.b64decode(image_base64)
            print(f"Image generated successfully ({len(image_bytes)} bytes)")
            return image_bytes
        except Exception as decode_error:
            print(f"Base64 decode failed: {decode_error}")
            # If already bytes or different format, handle accordingly
            if isinstance(image_base64, bytes):
                return image_base64
            else:
                raise Exception(f"Failed to decode image data: {decode_error}")
            
    except ClientError as e:
        raise Exception(f"Error generating image with Bedrock: {str(e)}")
    except Exception as e:
        raise Exception(f"Error in image generation: {str(e)}")


def generate_captions(prompt, num_captions=5):
    """Generate multiple story-style captions using Amazon Bedrock Titan Text."""
    import random
    
    captions = []
    used_captions = set()  # Track used captions to avoid duplicates
    
    # Expanded creative approaches that stay connected to the prompt
    caption_styles = [
        {
            "angle": "emotional storytelling",
            "instruction": "Tell a brief emotional story inspired by this scene. What feelings does it evoke? Use sensory details that connect directly to what's in the image.",
            "temp": 0.88
        },
        {
            "angle": "poetic imagery",
            "instruction": "Write poetically about the specific elements in this scene. Use metaphors that relate directly to what you see - the colors, textures, atmosphere.",
            "temp": 0.92
        },
        {
            "angle": "moment captured",
            "instruction": "Describe the specific moment frozen in time. What's happening right now in this scene? What makes this exact moment special?",
            "temp": 0.85
        },
        {
            "angle": "hidden narrative",
            "instruction": "Imagine the story behind this specific scene. What led to this moment? Keep it grounded in the actual elements present.",
            "temp": 0.90
        },
        {
            "angle": "sensory experience",
            "instruction": "Make readers feel like they're experiencing this exact scene. What would they hear, smell, feel if they stepped into this specific place?",
            "temp": 0.87
        },
        {
            "angle": "visual focus",
            "instruction": "Focus on the most striking visual element in the scene. Describe it in an unexpected, fresh way that makes people see it differently.",
            "temp": 0.89
        },
        {
            "angle": "atmosphere and mood",
            "instruction": "Capture the unique atmosphere and mood of this specific scene. What emotional tone does it set? How does it make you feel?",
            "temp": 0.91
        },
        {
            "angle": "intimate observation",
            "instruction": "Write as if you're sharing a personal observation about this scene with a friend. Notice small, specific details that others might miss.",
            "temp": 0.86
        }
    ]
    
    # Shuffle styles to get different combinations each time
    random.shuffle(caption_styles)
    
    for i in range(num_captions):
        try:
            style_config = caption_styles[i % len(caption_styles)]
            
            # Add randomness but keep it connected to prompt
            variety_seed = random.randint(100, 999)
            
            caption_prompt = (
                f"You are a creative social media caption writer. Write a caption for this image:\n\n"
                f"IMAGE CONTENT: {prompt}\n\n"
                f"STYLE: {style_config['angle']}\n"
                f"APPROACH: {style_config['instruction']}\n\n"
                f"CRITICAL RULES:\n"
                f"- Your caption MUST relate directly to the image content described above\n"
                f"- Reference specific elements, themes, or atmosphere from the description\n"
                f"- Be creative and unique (variation {variety_seed}) but stay relevant\n"
                f"- Write 1-3 sentences that someone would actually post on Instagram\n"
                f"- Avoid generic phrases like 'stunning', 'breathtaking', 'beautiful', 'amazing'\n"
                f"- Don't just repeat the description - add insight, emotion, or story\n"
                f"- Make it feel authentic and engaging\n\n"
                f"Write only the caption:"
            )
            
            request_body = {
                "inputText": caption_prompt,
                "textGenerationConfig": {
                    "maxTokenCount": 250,
                    "temperature": style_config['temp'] + random.uniform(-0.02, 0.02),
                    "topP": 0.92,
                    "stopSequences": ["\n\n", "Caption:", "Here's"]
                }
            }
            
            response = bedrock_runtime.invoke_model(
                modelId=TEXT_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body)
            )
            
            response_body = json.loads(response['body'].read())
            
            # Extract caption text from response
            if 'results' in response_body and len(response_body['results']) > 0:
                caption = response_body['results'][0]['outputText'].strip()
                
                # Clean up the caption
                caption = caption.strip('"').strip("'").strip()
                caption = caption.strip('*').strip()
                
                # Remove common prefixes
                prefixes_to_remove = [
                    "Caption:", "Here's a caption:", "Here is a caption:",
                    "Social media caption:", "Instagram caption:",
                    "A caption:", "The caption:", "Here's one:", "Sure!",
                    "Here you go:", "Perfect caption:"
                ]
                for prefix in prefixes_to_remove:
                    if caption.lower().startswith(prefix.lower()):
                        caption = caption[len(prefix):].strip()
                        caption = caption.lstrip(':').lstrip('-').strip()
                
                # Check if caption is unique and substantial
                caption_lower = caption.lower()
                is_unique = caption_lower not in used_captions
                is_substantial = len(caption) > 30
                
                # Check if it has some connection to the prompt (at least one key word)
                prompt_words = set(word.lower() for word in prompt.split() if len(word) > 3)
                caption_words = set(word.lower() for word in caption.split() if len(word) > 3)
                has_some_connection = len(prompt_words & caption_words) > 0 or len(caption) > 40
                
                if caption and is_unique and is_substantial and has_some_connection:
                    captions.append(caption)
                    used_captions.add(caption_lower)
                    print(f"Caption {i+1} accepted: {caption[:50]}...")
                else:
                    print(f"Caption {i+1} rejected: unique={is_unique}, substantial={is_substantial}, connected={has_some_connection}")
                    
        except Exception as e:
            print(f"Error generating caption {i+1}: {str(e)}")
    
    # If we didn't get enough unique captions, try one more round with higher temperature
    attempts = 0
    while len(captions) < num_captions and attempts < 3:
        try:
            attempts += 1
            style_config = random.choice(caption_styles)
            
            caption_prompt = (
                f"Write a creative, unique Instagram caption about: {prompt}\n\n"
                f"Make it {style_config['angle']}. Write 1-2 sentences that are engaging and authentic.\n"
                f"Avoid clichés. Be specific to this scene.\n\n"
                f"Caption:"
            )
            
            request_body = {
                "inputText": caption_prompt,
                "textGenerationConfig": {
                    "maxTokenCount": 200,
                    "temperature": 0.95,
                    "topP": 0.95
                }
            }
            
            response = bedrock_runtime.invoke_model(
                modelId=TEXT_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=json.dumps(request_body)
            )
            
            response_body = json.loads(response['body'].read())
            
            if 'results' in response_body and len(response_body['results']) > 0:
                caption = response_body['results'][0]['outputText'].strip().strip('"').strip("'")
                caption_lower = caption.lower()
                
                if len(caption) > 25 and caption_lower not in used_captions:
                    captions.append(caption)
                    used_captions.add(caption_lower)
                    print(f"Backup caption accepted: {caption[:50]}...")
                    
        except Exception as e:
            print(f"Error in backup caption generation: {str(e)}")
    
    return captions[:num_captions]


def upload_to_s3(image_bytes, image_id):
    """Upload image to S3 and return the S3 key."""
    try:
        s3_key = f"generated-images/{image_id}.png"
        
        s3_client.put_object(
            Bucket=S3_BUCKET,
            Key=s3_key,
            Body=image_bytes,
            ContentType='image/png'
        )
        
        print(f"Successfully uploaded image to s3://{S3_BUCKET}/{s3_key}")
        return s3_key
        
    except ClientError as e:
        raise Exception(f"Error uploading to S3: {str(e)}")


def generate_presigned_url(s3_key):
    """Generate a presigned URL for the S3 object."""
    try:
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': s3_key
            },
            ExpiresIn=PRESIGNED_URL_EXPIRATION
        )
        
        print(f"Generated presigned URL (expires in {PRESIGNED_URL_EXPIRATION}s)")
        return presigned_url
        
    except ClientError as e:
        raise Exception(f"Error generating presigned URL: {str(e)}")


def detect_labels(s3_key):
    """Use AWS Rekognition to detect labels from the image."""
    try:
        response = rekognition_client.detect_labels(
            Image={
                'S3Object': {
                    'Bucket': S3_BUCKET,
                    'Name': s3_key
                }
            },
            MaxLabels=10,
            MinConfidence=70.0
        )
        
        labels = []
        hashtags = []
        
        for label in response['Labels']:
            label_name = label['Name']
            confidence = label['Confidence']
            
            # Store label with Decimal confidence for DynamoDB
            labels.append({
                'name': label_name,
                'confidence': Decimal(str(round(confidence, 2)))
            })
            
            # Convert to hashtag format (remove spaces and special chars)
            hashtag = '#' + label_name.replace(' ', '').replace('-', '')
            hashtags.append(hashtag)
        
        print(f"Detected {len(labels)} labels from Rekognition")
        return labels, hashtags
        
    except ClientError as e:
        print(f"Error detecting labels with Rekognition: {str(e)}")
        return [], []


def convert_to_dynamodb_format(data):
    """Convert Python types to DynamoDB-compatible types."""
    if isinstance(data, dict):
        return {k: convert_to_dynamodb_format(v) for k, v in data.items()}
    elif isinstance(data, list):
        return [convert_to_dynamodb_format(item) for item in data]
    elif isinstance(data, float):
        return Decimal(str(data))
    else:
        return data


def store_in_dynamodb(metadata):
    """Store metadata in DynamoDB."""
    try:
        table = dynamodb.Table(DDB_TABLE)
        
        # Convert all floats to Decimal for DynamoDB
        safe_metadata = convert_to_dynamodb_format(metadata)
        
        table.put_item(Item=safe_metadata)
        
        print(f"Successfully stored metadata in DynamoDB table: {DDB_TABLE}")
        return True
        
    except ClientError as e:
        print(f"Error storing in DynamoDB: {str(e)}")
        return False
    except Exception as e:
        print(f"Unexpected error storing in DynamoDB: {str(e)}")
        return False


def lambda_handler(event, context):
    """Main Lambda handler function."""
    try:
        print(f"Received event: {json.dumps(event)}")
        
        # Parse input (handle both API Gateway and direct invocation)
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', event)
        
        prompt = body.get('prompt')
        user_id = body.get('userId', 'anonymous')
        
        # Validate input
        if not prompt:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Content-Type',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS'
                },
                'body': json.dumps({
                    'error': 'Missing required field: prompt'
                })
            }
        
        # Validate required environment variables
        if not S3_BUCKET:
            return {
                'statusCode': 500,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({
                    'error': 'S3_BUCKET environment variable not set'
                })
            }
        
        # Generate unique image ID and timestamp
        image_id = str(uuid.uuid4())
        timestamp = datetime.utcnow().isoformat()
        
        print(f"Processing request - ImageID: {image_id}, Prompt: {prompt}")
        
        # Step 1: Generate image
        print("Step 1: Generating photorealistic image with Bedrock...")
        image_bytes = generate_image(prompt)
        print(f"Image generated successfully ({len(image_bytes)} bytes)")
        
        # Step 2: Generate multiple captions
        print(f"Step 2: Generating {NUM_CAPTIONS} creative captions...")
        captions = generate_captions(prompt, NUM_CAPTIONS)
        print(f"Generated {len(captions)} captions")
        
        # Step 3: Upload to S3
        print("Step 3: Uploading image to S3...")
        s3_key = upload_to_s3(image_bytes, image_id)
        
        # Step 4: Generate presigned URL
        print("Step 4: Generating presigned URL...")
        presigned_url = generate_presigned_url(s3_key)
        
        # Step 5: Detect labels with Rekognition
        labels = []
        hashtags = []
        if USE_REKOGNITION:
            print("Step 5: Detecting labels with Rekognition...")
            labels, hashtags = detect_labels(s3_key)
        
        # Step 6: Store metadata in DynamoDB
        metadata = {
            'imageId': image_id,
            'prompt': prompt,
            'captions': captions,
            's3Key': s3_key,
            's3Bucket': S3_BUCKET,
            'timestamp': timestamp,
            'labels': labels,
            'hashtags': hashtags,
            'userId': user_id,
            'modelUsed': IMAGE_MODEL_ID
        }
        
        if USE_DDB and DDB_TABLE:
            print("Step 6: Storing metadata in DynamoDB...")
            store_in_dynamodb(metadata)
        
        # Step 7: Return response (convert Decimal back to float for JSON)
        response_body = {
            'imageId': image_id,
            'image': presigned_url,
            'presignedUrl': presigned_url,
            'captions': captions,
            'labels': [{'name': l['name'], 'confidence': float(l['confidence'])} for l in labels],
            'hashtags': hashtags
        }
        
        print(f"Request completed successfully - ImageID: {image_id}")
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            'body': json.dumps(response_body)
        }
        
    except Exception as e:
        error_message = str(e)
        print(f"Error in lambda_handler: {error_message}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            'body': json.dumps({
                'error': error_message
            })
        }
