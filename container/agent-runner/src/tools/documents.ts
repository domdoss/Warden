import fs from 'fs';
import path from 'path';
import { registry } from '../tool-registry.js';
import { cleanFilePath } from '../ipc-helpers.js';

registry.register({
    name: 'generate_pdf',
    description: 'Generate a professional styled PDF document from markdown content. Use this instead of writing Python scripts for PDF creation. Supports headings, tables, lists, code blocks, bold, italic, checkboxes, blockquotes.',
    schema: {
        type: 'object',
        properties: {
            filename: { type: 'string', description: 'Output filename (e.g. "report.pdf")' },
            content: { type: 'string', description: 'Markdown content for the PDF' },
        },
        required: ['filename', 'content'],
    },
    handler: async (args, _context) => {
        const filename = args.filename || 'document.pdf';
        const content = args.content || '';
        const mdFile = filename.replace(/\.pdf$/i, '') + '.md';
        const mdPath = path.join(process.cwd(), mdFile);
        const pdfPath = path.join(process.cwd(), filename);
        fs.writeFileSync(mdPath, content);
        try {
            const { execSync } = await import('child_process');
            execSync(`md2pdf "${mdFile}" "${filename}" 2>&1`, { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
            try { fs.unlinkSync(mdPath); } catch {}
            if (fs.existsSync(pdfPath)) {
                const stats = fs.statSync(pdfPath);
                return `PDF created: ${filename} (${Math.round(stats.size / 1024)} KB)`;
            }
            return `Error: md2pdf ran but PDF was not created`;
        } catch (e: any) {
            try { fs.unlinkSync(mdPath); } catch {}
            return `Error generating PDF: ${e.message || e}`;
        }
    },
    toolset: 'documents',
    tier: 'public',
});

registry.register({
    name: 'convert_file',
    description: 'Convert files between formats using LibreOffice. Supports: docx/doc to pdf, xlsx/xls to pdf, pptx/ppt to pdf, csv to xlsx, md to docx, and more. Use this instead of writing conversion scripts.',
    schema: {
        type: 'object',
        properties: {
            input: { type: 'string', description: 'Path to input file' },
            format: { type: 'string', description: 'Target format: pdf, docx, xlsx, pptx, csv, html, txt, odt, ods, odp' },
        },
        required: ['input', 'format'],
    },
    handler: async (args, _context) => {
        const input = args.input;
        const format = args.format;
        if (!input || !format) return 'Error: input and format are required';
        const inputPath = path.resolve(process.cwd(), cleanFilePath(input));
        if (!fs.existsSync(inputPath)) return `Error: file not found: ${input}`;
        const ext = path.extname(input).toLowerCase();
        const basename = path.basename(input, ext);
        const outputFile = `${basename}.${format}`;
        const outputPath = path.join(process.cwd(), outputFile);
        try {
            const { execSync } = await import('child_process');
            if (ext === '.md' && format === 'pdf') {
                execSync(`md2pdf "${inputPath}" "${outputPath}" 2>&1`, { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
            } else if (ext === '.md' && (format === 'docx' || format === 'doc')) {
                execSync(`pandoc "${inputPath}" -o "${outputPath}" 2>&1`, { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
            } else if ((ext === '.docx' || ext === '.doc') && format === 'pdf') {
                execSync(`pandoc "${inputPath}" -o "${outputPath}" 2>&1`, { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
            } else {
                execSync(`libreoffice --headless --convert-to ${format} "${inputPath}" --outdir "${process.cwd()}" 2>&1`, { cwd: process.cwd(), timeout: 30000, encoding: 'utf-8' });
            }
            if (fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                return `Converted: ${outputFile} (${Math.round(stats.size / 1024)} KB)`;
            }
            return `Error: conversion ran but output file was not created`;
        } catch (e: any) {
            return `Error converting file: ${e.message || e}`;
        }
    },
    toolset: 'documents',
    tier: 'public',
});
