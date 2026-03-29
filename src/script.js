// Configuration - Replace with your actual API Gateway URL
const API_URL = 'https://wq3sish8bk.execute-api.ap-south-1.amazonaws.com/dev/generate';

// DOM Elements
const promptForm = document.getElementById('promptForm');
const promptTextarea = document.getElementById('prompt');
const generateBtn = document.getElementById('generateBtn');
const charCount = document.getElementById('charCount');
const loadingMessage = document.getElementById('loadingMessage');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const results = document.getElementById('results');
const generatedImage = document.getElementById('generatedImage');
const generatedCaption = document.getElementById('generatedCaption');
const generatedHashtags = document.getElementById('generatedHashtags');
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Global variables
let currentResults = {};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    checkAPIUrl();
});

function initializeEventListeners() {
    // Form submission
    promptForm.addEventListener('submit', handleFormSubmit);
    
    // Character counter
    promptTextarea.addEventListener('input', updateCharCount);
    
    // Auto-resize textarea
    promptTextarea.addEventListener('input', autoResizeTextarea);
    
    // Modal close on outside click
    imageModal.addEventListener('click', function(e) {
        if (e.target === imageModal) {
            closeModal();
        }
    });

    // Escape key to close modal
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && imageModal.style.display === 'block') {
            closeModal();
        }
    });

    // Initialize character counter
    updateCharCount();
}

function checkAPIUrl() {
    if (API_URL.includes('your-api-gateway-url')) {
        showError('Please update the API_URL in script.js with your actual API Gateway URL');
    }
}

function updateCharCount() {
    const currentLength = promptTextarea.value.length;
    charCount.textContent = currentLength;
    
    // Color coding for character count
    if (currentLength > 450) {
        charCount.style.color = '#e53e3e';
    } else if (currentLength > 400) {
        charCount.style.color = '#dd6b20';
    } else {
        charCount.style.color = '#718096';
    }
}

function autoResizeTextarea() {
    promptTextarea.style.height = 'auto';
    promptTextarea.style.height = Math.max(120, promptTextarea.scrollHeight) + 'px';
}

async function handleFormSubmit(e) {
    e.preventDefault();
    
    const prompt = promptTextarea.value.trim();
    
    if (!prompt) {
        showError('Please enter a prompt before generating content.');
        return;
    }

    if (prompt.length < 10) {
        showError('Please enter a more detailed prompt (at least 10 characters).');
        return;
    }

    await generateContent(prompt);
}

async function generateContent(prompt) {
    try {
        // Update UI for loading state
        setLoadingState(true);
        hideError();
        hideResults();
        
        showToast('Sending request to AI...', 2000);
        
        // Make API call
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        
        // Handle the response based on your API structure
        if (data.error) {
            throw new Error(data.error);
        }

        // Process and display results
        await displayResults(data, prompt);
        
        showToast('Content generated successfully! 🎉', 3000);
        
    } catch (error) {
        console.error('Generation error:', error);
        
        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            showError('Network error: Please check your internet connection and API URL.');
        } else if (error.message.includes('504')) {
            showError('Request timeout: The AI is taking longer than expected. Please try with a simpler prompt.');
        } else if (error.message.includes('429')) {
            showError('Rate limit exceeded: Please wait a moment before trying again.');
        } else {
            showError(error.message || 'An unexpected error occurred. Please try again.');
        }
    } finally {
        setLoadingState(false);
    }
}

async function displayResults(data, originalPrompt) {
    try {
        console.log('API Response:', data); // Debug log
        
        // Handle different possible response structures
        let imageUrl = null;
        let caption = '';
        let hashtags = '';
        
        // Try different possible image URL fields
        if (data.s3_url) {
            imageUrl = data.s3_url;
        } else if (data.image_url) {
            imageUrl = data.image_url;
        } else if (data.imageUrl) {
            imageUrl = data.imageUrl;
        } else if (data.image) {
            imageUrl = data.image;
        }
        
        // Handle captions (your Lambda returns an array)
        if (data.captions && Array.isArray(data.captions)) {
            // Use the first caption or combine multiple
            caption = data.captions[0] || '';
            if (data.captions.length > 1) {
                // Optionally show the best/longest caption
                caption = data.captions.reduce((best, current) => 
                    current.length > best.length ? current : best
                );
            }
        } else if (data.caption) {
            caption = data.caption;
        } else if (data.generated_caption) {
            caption = data.generated_caption;
        } else if (data.description) {
            caption = data.description;
        } else {
            caption = generateFallbackCaption(originalPrompt);
        }
        
        // Handle hashtags (your Lambda returns an array)
        if (data.hashtags && Array.isArray(data.hashtags)) {
            // Join hashtags with spaces
            hashtags = data.hashtags.join(' ');
        } else if (data.hashtags && typeof data.hashtags === 'string') {
            hashtags = data.hashtags;
        } else if (data.generated_hashtags) {
            if (Array.isArray(data.generated_hashtags)) {
                hashtags = data.generated_hashtags.join(' ');
            } else {
                hashtags = data.generated_hashtags;
            }
        } else if (data.tags) {
            if (Array.isArray(data.tags)) {
                hashtags = data.tags.map(tag => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
            } else {
                hashtags = data.tags;
            }
        } else {
            hashtags = generateFallbackHashtags(originalPrompt);
        }
        
        // Store current results
        currentResults = {
            image: imageUrl,
            caption: caption,
            hashtags: hashtags,
            prompt: originalPrompt,
            labels: data.labels || [], // Store labels for debugging
            allCaptions: data.captions || [], // Store all captions
            imageId: data.image_id || data.imageId || null
        };

        console.log('Processed Results:', currentResults); // Debug log

        // Display image with comprehensive debugging
        if (currentResults.image) {
            console.log('Attempting to load image:', currentResults.image);
            
            // Show loading state for image
            generatedImage.style.opacity = '0.5';
            generatedImage.src = '';
            
            // Add debug info to the image container
            const imageContainer = generatedImage.parentElement;
            let debugInfo = imageContainer.querySelector('.debug-info');
            if (!debugInfo) {
                debugInfo = document.createElement('div');
                debugInfo.className = 'debug-info';
                debugInfo.style.cssText = `
                    position: absolute;
                    top: 10px;
                    left: 10px;
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 5px;
                    font-size: 12px;
                    border-radius: 4px;
                    max-width: 200px;
                    word-break: break-all;
                `;
                imageContainer.appendChild(debugInfo);
            }
            debugInfo.textContent = `Loading: ${currentResults.image}`;
            
            // Test if it's a valid image URL
            fetch(currentResults.image, { method: 'HEAD' })
                .then(response => {
                    console.log('Image URL response:', response.status, response.headers);
                    debugInfo.textContent = `Status: ${response.status}`;
                    
                    if (response.ok) {
                        // URL is accessible, try loading image
                        const testImage = new Image();
                        testImage.crossOrigin = 'anonymous';
                        
                        testImage.onload = function() {
                            console.log('Image loaded successfully');
                            generatedImage.src = currentResults.image;
                            generatedImage.style.opacity = '1';
                            debugInfo.style.display = 'none';
                            showToast('Image loaded successfully!', 2000);
                        };
                        
                        testImage.onerror = function() {
                            console.error('Image load failed despite 200 response');
                            debugInfo.textContent = 'Load failed - CORS issue?';
                            // Try loading without crossOrigin
                            tryLoadingWithoutCors();
                        };
                        
                        testImage.src = currentResults.image;
                    } else {
                        debugInfo.textContent = `HTTP ${response.status} - URL not accessible`;
                        showToast(`Image URL returned ${response.status} - check S3 permissions`, 4000);
                        useBackupImage();
                    }
                })
                .catch(error => {
                    console.error('Fetch error:', error);
                    debugInfo.textContent = 'Fetch failed - trying direct load';
                    // Try direct image load
                    tryLoadingWithoutCors();
                });
                
            function tryLoadingWithoutCors() {
                console.log('Trying to load image without CORS...');
                const directImage = new Image();
                
                directImage.onload = function() {
                    console.log('Image loaded without CORS');
                    generatedImage.src = currentResults.image;
                    generatedImage.style.opacity = '1';
                    debugInfo.style.display = 'none';
                    showToast('Image loaded (CORS bypassed)!', 2000);
                };
                
                directImage.onerror = function() {
                    console.error('Direct image load also failed');
                    debugInfo.textContent = 'All load methods failed';
                    useBackupImage();
                };
                
                directImage.src = currentResults.image;
            }
            
            function useBackupImage() {
                console.log('Using backup/placeholder image');
                generatedImage.src = createPlaceholderImage(originalPrompt);
                generatedImage.style.opacity = '1';
                debugInfo.textContent = 'Using placeholder - original failed';
                showToast('Using placeholder - check S3 URL and permissions', 4000);
            }
            
        } else {
            console.log('No image URL provided in response');
            // No image URL provided
            generatedImage.src = createPlaceholderImage(originalPrompt);
            generatedImage.style.opacity = '1';
            showToast('Content generated but no image URL provided', 3000);
        }

        // Display caption and hashtags with better formatting
        if (currentResults.caption) {
            generatedCaption.textContent = currentResults.caption;
            generatedCaption.title = currentResults.caption; // Add tooltip for long text
        } else {
            generatedCaption.textContent = 'Caption generation in progress...';
        }
        
        if (currentResults.hashtags) {
            // Ensure hashtags are properly formatted
            const formattedHashtags = formatHashtags(currentResults.hashtags);
            generatedHashtags.textContent = formattedHashtags;
            generatedHashtags.title = formattedHashtags; // Add tooltip
        } else {
            generatedHashtags.textContent = 'Hashtags generation in progress...';
        }

        // Show additional info if available
        if (data.labels && data.labels.length > 0) {
            console.log('Image labels detected:', data.labels);
        }

        // Show results with animation
        showResults();
        
        // Add caption cycle button if multiple captions available
        setTimeout(() => {
            addCaptionCycleButton();
        }, 100);
        
        // Scroll to results
        setTimeout(() => {
            results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
        
    } catch (error) {
        console.error('Error displaying results:', error);
        showError('Generated content successfully, but there was an error displaying it. Check console for details.');
    }
}

function createPlaceholderImage(prompt) {
    // Create a more informative placeholder
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    
    // Background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 400, 300);
    
    // Text
    ctx.fillStyle = '#999999';
    ctx.font = '18px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Image Generated', 200, 140);
    ctx.font = '14px Arial';
    ctx.fillText('Check S3 bucket permissions', 200, 160);
    ctx.fillText('or API response format', 200, 180);
    
    return canvas.toDataURL();
}

function formatHashtags(hashtags) {
    if (!hashtags) return '';
    
    // If it's already formatted, return as is
    if (hashtags.includes('#')) return hashtags;
    
    // If it's a comma-separated list, format it
    if (hashtags.includes(',')) {
        return hashtags.split(',')
            .map(tag => tag.trim())
            .filter(tag => tag.length > 0)
            .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
            .join(' ');
    }
    
    // If it's a space-separated list, format it
    return hashtags.split(' ')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0)
        .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
        .join(' ');
}

function generateFallbackCaption(prompt) {
    const templates = [
        `Amazing AI-generated content based on: "${prompt}"`,
        `Creative visualization of: ${prompt}`,
        `Stunning AI artwork featuring: ${prompt}`,
        `Digital creation inspired by: ${prompt}`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

function generateFallbackHashtags(prompt) {
    const baseHashtags = ['#AI', '#GeneratedContent', '#Digital', '#Creative', '#ArtificialIntelligence'];
    const promptWords = prompt.toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(' ')
        .filter(word => word.length > 3)
        .slice(0, 3)
        .map(word => `#${word.charAt(0).toUpperCase() + word.slice(1)}`);
    
    return [...baseHashtags, ...promptWords].join(' ');
}

function setLoadingState(isLoading) {
    const btnText = generateBtn.querySelector('.btn-text');
    const spinner = generateBtn.querySelector('.spinner');
    
    if (isLoading) {
        generateBtn.disabled = true;
        generateBtn.classList.add('loading');
        loadingMessage.style.display = 'block';
        promptTextarea.disabled = true;
    } else {
        generateBtn.disabled = false;
        generateBtn.classList.remove('loading');
        loadingMessage.style.display = 'none';
        promptTextarea.disabled = false;
    }
}

function showError(message) {
    errorText.textContent = message;
    errorMessage.style.display = 'block';
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideError() {
    errorMessage.style.display = 'none';
}

function clearError() {
    hideError();
    promptTextarea.focus();
}

function showResults() {
    results.style.display = 'block';
    results.classList.add('animate-in');
}

function hideResults() {
    results.style.display = 'none';
}

function showToast(message, duration = 3000) {
    toastMessage.textContent = message;
    toast.classList.add('show');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// Image modal functions
function enlargeImage() {
    if (generatedImage.src) {
        modalImage.src = generatedImage.src;
        imageModal.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

function closeModal() {
    imageModal.style.display = 'none';
    document.body.style.overflow = 'auto';
}

// Copy functionality
function copyText(type) {
    let textToCopy = '';
    let button = document.querySelector(`[data-type="${type}"]`);
    
    if (type === 'caption') {
        textToCopy = currentResults.caption;
    } else if (type === 'hashtags') {
        textToCopy = currentResults.hashtags;
    }
    
    if (textToCopy) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            // Visual feedback
            const originalIcon = button.innerHTML;
            button.innerHTML = '<i class="fas fa-check"></i>';
            button.classList.add('copied');
            
            setTimeout(() => {
                button.innerHTML = originalIcon;
                button.classList.remove('copied');
            }, 2000);
            
            showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} copied to clipboard!`);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
            // Fallback for older browsers
            fallbackCopyText(textToCopy);
        });
    }
}

function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        document.execCommand('copy');
        showToast('Copied to clipboard!');
    } catch (err) {
        showToast('Please manually copy the text');
    }
    
    document.body.removeChild(textArea);
}

// Action button functions
function generateNew() {
    // Clear previous results
    hideResults();
    hideError();
    
    // Reset form
    promptTextarea.value = '';
    updateCharCount();
    autoResizeTextarea();
    
    // Focus on textarea
    promptTextarea.focus();
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function shareContent() {
    if (!currentResults.caption && !currentResults.hashtags) {
        showToast('No content to share');
        return;
    }
    
    const shareText = `${currentResults.caption}\n\n${currentResults.hashtags}\n\nGenerated with AI Content Generator`;
    
    if (navigator.share) {
        // Use native sharing if available
        navigator.share({
            title: 'AI Generated Content',
            text: shareText,
            url: window.location.href
        }).catch(err => {
            console.log('Error sharing:', err);
            fallbackShare(shareText);
        });
    } else {
        fallbackShare(shareText);
    }
}

// New function to cycle through multiple captions
function showNextCaption() {
    if (!currentResults.allCaptions || currentResults.allCaptions.length <= 1) {
        showToast('Only one caption available');
        return;
    }
    
    // Find current caption index
    const currentCaption = generatedCaption.textContent;
    let currentIndex = currentResults.allCaptions.findIndex(cap => cap === currentCaption);
    
    // Move to next caption (cycle back to 0 if at end)
    currentIndex = (currentIndex + 1) % currentResults.allCaptions.length;
    
    // Update display
    generatedCaption.textContent = currentResults.allCaptions[currentIndex];
    generatedCaption.title = currentResults.allCaptions[currentIndex];
    
    // Update current results
    currentResults.caption = currentResults.allCaptions[currentIndex];
    
    showToast(`Caption ${currentIndex + 1} of ${currentResults.allCaptions.length}`, 2000);
}

// Add caption cycling button if multiple captions are available
function addCaptionCycleButton() {
    if (!currentResults.allCaptions || currentResults.allCaptions.length <= 1) {
        return;
    }
    
    const captionBox = document.querySelector('.caption-box .box-header');
    const existingCycleBtn = captionBox.querySelector('.cycle-btn');
    
    if (!existingCycleBtn) {
        const cycleBtn = document.createElement('button');
        cycleBtn.className = 'cycle-btn';
        cycleBtn.innerHTML = '<i class="fas fa-sync"></i>';
        cycleBtn.title = `Cycle through ${currentResults.allCaptions.length} captions`;
        cycleBtn.onclick = showNextCaption;
        
        // Add some basic styles
        cycleBtn.style.cssText = `
            background: #124929;
            color: white;
            border: none;
            border-radius: 6px;
            padding: 6px 10px;
            cursor: pointer;
            transition: all 0.3s ease;
            font-size: 0.9rem;
            margin-left: 5px;
        `;
        
        captionBox.appendChild(cycleBtn);
    }
}

function fallbackShare(text) {
    // Copy to clipboard as fallback
    navigator.clipboard.writeText(text).then(() => {
        showToast('Content copied to clipboard for sharing!');
    }).catch(() => {
        showToast('Use the copy buttons to share individual elements');
    });
}

function downloadResults() {
    if (!currentResults.caption && !currentResults.hashtags) {
        showToast('No content to download');
        return;
    }
    
    const content = `AI Generated Content
====================

Prompt: ${currentResults.prompt}

Caption:
${currentResults.caption}

Hashtags:
${currentResults.hashtags}

Generated on: ${new Date().toLocaleString()}
Generated with: AI Content Generator`;
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-content-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showToast('Content downloaded successfully!');
}

// Utility functions
function sanitizeInput(input) {
    return input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
               .replace(/[<>]/g, '');
}

function validatePrompt(prompt) {
    if (!prompt || prompt.trim().length === 0) {
        return { valid: false, message: 'Please enter a prompt' };
    }
    
    if (prompt.trim().length < 10) {
        return { valid: false, message: 'Prompt too short. Please provide more details.' };
    }
    
    if (prompt.length > 500) {
        return { valid: false, message: 'Prompt too long. Please keep it under 500 characters.' };
    }
    
    return { valid: true };
}

// Handle network errors and retries
async function retryRequest(url, options, maxRetries = 3) {
    let lastError;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            return response;
        } catch (error) {
            lastError = error;
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
            }
        }
    }
    
    throw lastError;
}

// Handle page visibility changes (pause/resume functionality)
document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
        // Page is hidden
        console.log('Page hidden');
    } else {
        // Page is visible
        console.log('Page visible');
    }
});

// Handle online/offline status
window.addEventListener('online', function() {
    showToast('Connection restored!');
});

window.addEventListener('offline', function() {
    showToast('Connection lost. Please check your internet.', 5000);
});

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Ctrl/Cmd + Enter to submit form
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !generateBtn.disabled) {
        e.preventDefault();
        promptForm.dispatchEvent(new Event('submit'));
    }
    
    // Escape to clear error
    if (e.key === 'Escape' && errorMessage.style.display === 'block') {
        clearError();
    }
});

// Auto-save draft (optional feature)
function saveDraft() {
    if (promptTextarea.value.trim()) {
        localStorage.setItem('promptDraft', promptTextarea.value);
    }
}

function loadDraft() {
    const draft = localStorage.getItem('promptDraft');
    if (draft && !promptTextarea.value) {
        promptTextarea.value = draft;
        updateCharCount();
        autoResizeTextarea();
    }
}

// Initialize draft functionality
setTimeout(loadDraft, 100); // Load draft after page loads
promptTextarea.addEventListener('input', debounce(saveDraft, 1000));

// Debounce utility function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Performance monitoring
function measurePerformance(label, fn) {
    return async function(...args) {
        const start = performance.now();
        try {
            const result = await fn.apply(this, args);
            const end = performance.now();
            console.log(`${label} took ${end - start} milliseconds`);
            return result;
        } catch (error) {
            const end = performance.now();
            console.log(`${label} failed after ${end - start} milliseconds`);
            throw error;
        }
    };
}

// Error reporting (optional - integrate with your error tracking service)
function reportError(error, context = {}) {
    console.error('Application Error:', error, context);
    
    // You can integrate with services like Sentry, LogRocket, etc.
    // Example:
    // Sentry.captureException(error, { extra: context });
}

// Initialize error boundary
window.addEventListener('error', function(e) {
    reportError(e.error, {
        message: e.message,
        filename: e.filename,
        line: e.lineno,
        column: e.colno
    });
});

window.addEventListener('unhandledrejection', function(e) {
    reportError(e.reason, {
        type: 'unhandledrejection'
    });
});

console.log('🎨 AI Content Generator initialized successfully!');
