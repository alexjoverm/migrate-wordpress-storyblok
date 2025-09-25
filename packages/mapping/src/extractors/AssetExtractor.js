import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import crypto from 'crypto';

/**
 * Simple asset extractor for external assets found in richtext content
 * Only downloads assets that are NOT in WordPress media library
 */
export class AssetExtractor {
    constructor(config = {}) {
        this.config = {
            outputDir: './mapped-data/assets',
            folderStructure: 'by-type', // 'by-type', 'flat'
            namingStrategy: 'hash',     // 'hash', 'original'
            downloadTimeout: 30000,
            maxFileSize: 10 * 1024 * 1024, // 10MB
            ...config
        };

        this.assets = new Map();
        this.counter = 1;
    }

    /**
     * Extract (download) an external asset and return Storyblok format info
     */
    async extractAsset(url, metadata = {}) {
        try {
            // Check if already processed
            const existingAsset = this.findExistingAsset(url);
            if (existingAsset) {
                return existingAsset;
            }

            // Download asset
            const downloadResult = await this.downloadAsset(url);
            if (!downloadResult) {
                return null;
            }

            // Create Storyblok-compatible asset info
            const assetInfo = this.createStoryblokAssetInfo(url, downloadResult, metadata);

            // Store in registry
            this.assets.set(assetInfo.id, assetInfo);

            return assetInfo;

        } catch (error) {
            console.warn(`Failed to extract external asset ${url}:`, error.message);
            return null;
        }
    }

    /**
     * Download asset to local storage
     */
    async downloadAsset(url) {
        try {
            // Ensure output directory exists
            await fs.mkdir(this.config.outputDir, { recursive: true });

            // Extract original filename and extension
            const urlPath = new URL(url).pathname;
            const originalFilename = path.basename(urlPath);
            const extension = path.extname(originalFilename) || '.jpg'; // default extension
            const baseName = path.basename(originalFilename, extension);

            // Generate filename based on strategy
            const filename = this.generateFilename(baseName, extension, url);

            // Determine folder structure
            const subfolder = this.getSubfolder(extension);
            const fullDir = path.join(this.config.outputDir, subfolder);
            await fs.mkdir(fullDir, { recursive: true });

            const localPath = path.join(fullDir, filename);

            // Download file
            const response = await fetch(url, {
                timeout: this.config.downloadTimeout
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Stream to file
            const fileStream = createWriteStream(localPath);
            await pipeline(response.body, fileStream);

            // Verify file was written
            const stats = await fs.stat(localPath);
            if (stats.size === 0) {
                throw new Error('Downloaded file is empty');
            }

            return {
                originalFilename,
                filename,
                localPath,
                relativePath: path.join(subfolder, filename),
                size: stats.size,
                subfolder
            };

        } catch (error) {
            console.warn(`Download failed for ${url}:`, error.message);
            return null;
        }
    }

    /**
     * Generate filename based on naming strategy
     */
    generateFilename(baseName, extension, url) {
        switch (this.config.namingStrategy) {
            case 'original':
                return this.sanitizeFilename(baseName + extension);

            case 'hash':
            default:
                const hash = crypto.createHash('md5').update(url).digest('hex').slice(0, 8);
                return `${hash}_${this.sanitizeFilename(baseName)}${extension}`;
        }
    }

    /**
     * Get subfolder based on folder structure strategy
     */
    getSubfolder(extension) {
        if (this.config.folderStructure === 'flat') {
            return '';
        }

        // by-type
        const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
        const videoExts = ['.mp4', '.webm', '.ogg', '.avi', '.mov'];

        if (imageExts.includes(extension.toLowerCase())) return 'images';
        if (videoExts.includes(extension.toLowerCase())) return 'videos';

        return 'other';
    }

    /**
     * Create Storyblok-compatible asset information
     */
    createStoryblokAssetInfo(originalUrl, downloadResult, metadata) {
        const assetId = this.generateAssetId();

        return {
            // Storyblok asset format
            id: assetId,
            alt: metadata.alt || '',
            name: downloadResult.originalFilename,
            focus: metadata.focus || null,
            title: metadata.title || '',
            filename: `https://a.storyblok.com/f/{this.getSpaceId()}/${downloadResult.relativePath.replace(/\\/g, '/')}`,
            copyright: metadata.copyright || '',
            fieldtype: 'asset',

            // Additional metadata for import
            meta_data: {
                originalUrl,
                localPath: downloadResult.localPath,
                relativePath: downloadResult.relativePath,
                size: downloadResult.size,
                subfolder: downloadResult.subfolder,
                extractedAt: new Date().toISOString()
            }
        };
    }

    /**
     * Find existing asset by URL
     */
    findExistingAsset(url) {
        for (const asset of this.assets.values()) {
            if (asset.meta_data.originalUrl === url) {
                return asset;
            }
        }
        return null;
    }

    /**
     * Generate unique asset ID
     */
    generateAssetId() {
        return Math.floor(Math.random() * 1000000);
    }

    /**
     * Get space ID from config (placeholder for now)
     */
    getSpaceId() {
        return this.config.spaceId || 'SPACE_ID';
    }

    /**
     * Sanitize filename for safe storage
     */
    sanitizeFilename(filename) {
        return filename
            .replace(/[^a-zA-Z0-9.-]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    }

    /**
     * Save asset manifest to JSON file
     */
    async saveManifest() {
        try {
            const manifestPath = path.join(this.config.outputDir, 'external-assets-manifest.json');

            const manifest = {
                generatedAt: new Date().toISOString(),
                totalAssets: this.assets.size,
                description: 'External assets extracted from richtext content (not from WordPress media library)',
                assets: Object.fromEntries(this.assets)
            };

            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
            console.log(`External assets manifest saved to ${manifestPath}`);

            return manifestPath;
        } catch (error) {
            console.error('Failed to save external assets manifest:', error.message);
            throw error;
        }
    }

    /**
     * Get summary of extracted assets
     */
    getSummary() {
        const assetsByType = {};
        const assetsByFolder = {};
        let totalSize = 0;

        for (const asset of this.assets.values()) {
            const folder = asset.meta_data.subfolder || 'root';
            const ext = path.extname(asset.name).toLowerCase();

            assetsByFolder[folder] = (assetsByFolder[folder] || 0) + 1;
            assetsByType[ext] = (assetsByType[ext] || 0) + 1;
            totalSize += asset.meta_data.size || 0;
        }

        return {
            totalAssets: this.assets.size,
            totalSize,
            assetsByType,
            assetsByFolder,
            outputDir: this.config.outputDir
        };
    }

    /**
     * Load existing manifest if available
     */
    async loadExistingManifest() {
        try {
            const manifestPath = path.join(this.config.outputDir, 'external-assets-manifest.json');
            const manifestData = await fs.readFile(manifestPath, 'utf8');
            const manifest = JSON.parse(manifestData);

            // Restore assets map
            if (manifest.assets) {
                this.assets = new Map(Object.entries(manifest.assets));
                this.counter = this.assets.size + 1;
            }

            console.log(`Loaded existing external assets manifest with ${this.assets.size} assets`);
            return manifest;
        } catch (error) {
            // No existing manifest, start fresh
            return null;
        }
    }

    /**
     * Clean up: remove downloaded files (optional)
     */
    async cleanup() {
        try {
            await fs.rm(this.config.outputDir, { recursive: true, force: true });
            console.log(`Cleaned up asset directory: ${this.config.outputDir}`);
        } catch (error) {
            console.warn(`Failed to cleanup assets:`, error.message);
        }
    }
}
