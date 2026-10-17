import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';

// Local text-to-image: Qwen-Image-2.1-Turbo (8-step distilled) through
// stable-diffusion.cpp. The wrapper script (/opt/Warden/imagegen/generate.sh)
// owns the model paths and the pinned Turbo schedule; this tool owns the
// prompt → filename contract and lands the PNG in <WORKSPACE_ROOT>/images,
// where the captain's files live.
registry.register({
    name: 'generate_image',
    description: 'Generate an image from a text description with a local image model. Writes a PNG into the images folder and returns its path. Describe the picture itself — subject, style, setting, lighting.',
    schema: {
        type: 'object',
        properties: {
            prompt: { type: 'string', description: 'The picture to generate: subject, style, setting, lighting. Example: "a neon sign reading OPEN LATE on a rainy night, reflections on wet asphalt, cinematic".' },
            filename: { type: 'string', description: 'Output filename, e.g. "poster.png". Default: image-<timestamp>.png' },
            width: { type: 'number', description: 'Image width in pixels. Default 1024. Multiples of 32, 512 to 2048.' },
            height: { type: 'number', description: 'Image height in pixels. Default 1024. Multiples of 32, 512 to 2048.' },
        },
        required: ['prompt'],
    },
    handler: async (args, _context) => {
        const prompt = (args.prompt || '').trim();
        if (!prompt) return 'Error: prompt is required';
        const w = Number.isInteger(args.width) && args.width >= 512 && args.width <= 2048 ? args.width : 1024;
        const h = Number.isInteger(args.height) && args.height >= 512 && args.height <= 2048 ? args.height : 1024;
        if (w % 32 !== 0 || h % 32 !== 0) return 'Error: width and height must be multiples of 32';
        let filename = (args.filename || '').trim() || `image-${Date.now()}.png`;
        if (!/\.png$/i.test(filename)) filename += '.png';
        const outDir = path.join(process.cwd(), 'images');
        fs.mkdirSync(outDir, { recursive: true });
        const outPath = path.join(outDir, filename);
        try {
            const { execFileSync } = await import('child_process');
            execFileSync('bash', ['/opt/Warden/imagegen/generate.sh', prompt, outPath, String(w), String(h)], {
                timeout: 600000, encoding: 'utf-8',
            });
        } catch (e: any) {
            const reason = e?.stderr || e?.stdout || e?.message || e;
            return `Error generating image: ${reason}`.trim();
        }
        if (!fs.existsSync(outPath)) return 'Error: generation ran but the image file was not created';
        const stats = fs.statSync(outPath);
        return `Image generated: images/${filename} (${w}x${h}, ${Math.round(stats.size / 1024)} KB), on disk at ${outPath}. query_image can verify its contents if the captain asks.`;
    },
    toolset: 'documents',
    tier: 'public',
});