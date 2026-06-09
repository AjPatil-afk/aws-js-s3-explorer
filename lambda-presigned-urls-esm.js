import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const BUCKET_NAME = process.env.BUCKET_NAME || 'download2.pcamericademo';
const URL_EXPIRATION = parseInt(process.env.URL_EXPIRATION || '3600'); // 1 hour default

// CORS headers for API Gateway
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // Restrict to your CloudFront domain in production
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

/**
 * Main Lambda handler
 */
export const handler = async (event) => {
  console.log('Event:', JSON.stringify(event, null, 2));

  // Handle OPTIONS request for CORS
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const action = event.queryStringParameters?.action || 'list';
    
    switch (action) {
      case 'list':
        return await handleListObjects(event);
      case 'get':
        return await handleGetObject(event);
      default:
        return errorResponse(400, 'Invalid action. Use "list" or "get".');
    }
  } catch (error) {
    console.error('Error:', error);
    return errorResponse(500, error.message);
  }
};

/**
 * List objects in S3 bucket (with pagination)
 */
async function handleListObjects(event) {
  const prefix = event.queryStringParameters?.prefix || '';
  const delimiter = event.queryStringParameters?.delimiter || '/';
  const marker = event.queryStringParameters?.marker || undefined;

  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix,
    Delimiter: delimiter,
    MaxKeys: 1000,
    ContinuationToken: marker
  });

  const response = await s3Client.send(command);

  // Format response similar to current S3 Explorer format
  const folders = (response.CommonPrefixes || []).map(p => ({
    Key: p.Prefix,
    Size: 0,
    LastModified: null,
    Type: 'folder'
  }));

  const files = (response.Contents || []).map(obj => ({
    Key: obj.Key,
    Size: obj.Size,
    LastModified: obj.LastModified,
    Type: 'file'
  }));

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      bucket: BUCKET_NAME,
      prefix: prefix,
      contents: [...folders, ...files],
      isTruncated: response.IsTruncated || false,
      nextMarker: response.NextContinuationToken || null
    })
  };
}

/**
 * Generate pre-signed URL for downloading a file
 */
async function handleGetObject(event) {
  const key = event.queryStringParameters?.key;
  
  if (!key) {
    return errorResponse(400, 'Missing required parameter: key');
  }

  // Generate pre-signed URL
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key
  });

  const signedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: URL_EXPIRATION
  });

  return {
    statusCode: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      url: signedUrl,
      key: key,
      expiresIn: URL_EXPIRATION
    })
  };
}

/**
 * Helper function for error responses
 */
function errorResponse(statusCode, message) {
  return {
    statusCode: statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: false,
      error: message
    })
  };
}
