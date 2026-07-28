import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const MAX_DIMENSION = 1024;
const IMAGE_REF_PATTERN = /\[Image: (attachments\/[^\]]+)\]/g;

export interface ProcessedImage {
  content: string;
  relativePath: string;
}

export interface ImageAttachment {
  relativePath: string;
  mediaType: string;
}

export function isImageMessage(msg: any): boolean {
  return !!msg.message?.imageMessage;
}

export async function processImage(
  buffer: Buffer,
  groupDir: string,
  caption: string,
): Promise<ProcessedImage | null> {
  if (!buffer || buffer.length === 0) return null;

  const resized = await sharp(buffer)
    .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const filename = `img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`;
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, resized);

  const relativePath = `attachments/${filename}`;
  const content = caption
    ? `[Image: ${relativePath}] ${caption}`
    : `[Image: ${relativePath}]`;

  return { content, relativePath };
}

/** Extensions that Claude's vision API can process */
const VISION_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function isVisionCompatible(filePath: string): boolean {
  return VISION_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function mediaTypeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg'; // .jpg / .jpeg / default
}

export function parseImageReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const refs: ImageAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    IMAGE_REF_PATTERN.lastIndex = 0;
    while ((match = IMAGE_REF_PATTERN.exec(msg.content)) !== null) {
      // Only send raster images as vision inputs — SVGs and other formats
      // stay as text references so the agent can read/embed them as files
      if (isVisionCompatible(match[1])) {
        refs.push({ relativePath: match[1], mediaType: mediaTypeFromPath(match[1]) });
      }
    }
  }
  return refs;
}

// --- Voice / Audio ---

const VOICE_REF_PATTERN = /\[Voice: (attachments\/[^\]]+)\]/g;

export interface ProcessedVoice {
  content: string;
  relativePath: string;
  mediaType: string;
}

export async function processVoice(
  buffer: Buffer,
  groupDir: string,
  mediaType: string = 'audio/ogg',
): Promise<ProcessedVoice | null> {
  if (!buffer || buffer.length === 0) return null;

  const attachDir = path.join(groupDir, 'attachments');
  fs.mkdirSync(attachDir, { recursive: true });

  const ext = mediaType.includes('mpeg') || mediaType.includes('mp3') ? 'mp3'
    : mediaType.includes('mp4') || mediaType.includes('m4a') ? 'm4a'
    : 'ogg';
  const filename = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const filePath = path.join(attachDir, filename);
  fs.writeFileSync(filePath, buffer);

  const relativePath = `attachments/${filename}`;
  const content = `[Voice: ${relativePath}]`;

  return { content, relativePath, mediaType };
}

export function parseVoiceReferences(
  messages: Array<{ content: string }>,
): ImageAttachment[] {
  const refs: ImageAttachment[] = [];
  for (const msg of messages) {
    let match: RegExpExecArray | null;
    VOICE_REF_PATTERN.lastIndex = 0;
    while ((match = VOICE_REF_PATTERN.exec(msg.content)) !== null) {
      const ext = match[1].split('.').pop() || 'ogg';
      const mediaType = ext === 'mp3' ? 'audio/mpeg'
        : ext === 'm4a' ? 'audio/mp4'
        : 'audio/ogg';
      refs.push({ relativePath: match[1], mediaType });
    }
  }
  return refs;
}
