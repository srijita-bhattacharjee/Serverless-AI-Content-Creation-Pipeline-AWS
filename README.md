# Serverless AI Content Creation Pipeline

Built a scalable serverless AI system for generating images, captions, and metadata for social media content using AWS.

## 🚀 Features
- AI-based image generation from text prompts (Amazon Bedrock)
- Multi-style caption generation (5 variations per input)
- Automated label detection and hashtag generation (AWS Rekognition)
- Secure image storage with presigned access URLs (AWS S3)
- Metadata storage for tracking and retrieval (DynamoDB)
- Low-latency execution (<2s response time)

## 🛠️ Tech Stack
- **Backend:** AWS Lambda (Python, boto3)
- **AI Models:** Amazon Bedrock (Titan / Stable Diffusion)
- **Storage:** AWS S3
- **Database:** AWS DynamoDB
- **Computer Vision:** AWS Rekognition
- **API Handling:** API Gateway

## ⚙️ Architecture
User Input → API Gateway → Lambda →  
→ Bedrock (image + captions)  
→ S3 (image storage)  
→ Rekognition (labels + hashtags)  
→ DynamoDB (metadata storage)  

## 📊 Key Highlights
- End-to-end serverless pipeline with no dedicated backend servers  
- Dynamic content generation with multiple creative caption styles  
- Automated tagging improves content discoverability  
- Designed for scalability and real-time usage  

## 📷 Demo
(Add UI screenshots or output images here)

## 📁 Project Structure
