import fs from 'fs/promises';
import path from 'path';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import fetch from 'node-fetch';
import crypto from 'crypto';

/**
 * Processes assets in richtext content through two phases:
 * 1. Download and prepare assets locally
 * 2. Upload to Storyblok and replace placeholders
 */
export class RichtextAssetProcessor {
    constructor(config = {}) {
        this.config = {
            downloadDir: './downloads/assets',
            maxConcurrentDownloads: 5,
            maxConcurrentUploads: 3,
            retryAttempts: 3,
            ...config
        };
    }

    /**
     * Phase 1: Download all registered assets from richtext content
     */
    async downloadAssets(assetRegistry, options = {}) {
        if (!assetRegistry || assetRegistry.size === 0) {
            return { success: [], failed: [] };
        }

        // Ensure download directory exists
        await fs.mkdir(this.config.downloadDir, { recursive: true });

        const assets = Array.from(assetRegistry.values());
        const results = { success: [], failed: [] };

        // Process downloads in batches to avoid overwhelming the server
        for (let i = 0; i < assets.length; i += this.config.maxConcurrentDownloads) {
            const batch = assets.slice(i, i + this.config.maxConcurrentDownloads);
            const batchPromises = batch.map(asset => this.downloadSingleAsset(asset, options));

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach((result, index) => {
                const asset = batch[index];
                if (result.status === 'fulfilled' && result.value) {
                    results.success.push(asset);
                    asset.downloaded = true;
                    asset.localPath = result.value;
                } else {
                    results.failed.push({
                        asset,
                        error: result.reason || result.value
                    });
                    console.warn(`Failed to download asset ${asset.originalUrl}:`, result.reason);
                }
            });
        }

        return results;
    }

    /**
     * Download a single asset
     */
    async downloadSingleAsset(asset, options = {}) {
        let lastError;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                // Generate safe filename
                const safeFilename = this.generateSafeFilename(asset.filename);
                const localPath = path.join(this.config.downloadDir, `${asset.id}_${safeFilename}`);

                // Download file
                const response = await fetch(asset.originalUrl, {
                    headers: options.headers || {},
                    timeout: options.timeout || 30000
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

                return localPath;
            } catch (error) {
                lastError = error;
                console.warn(`Download attempt ${attempt}/${this.config.retryAttempts} failed for ${asset.originalUrl}:`, error.message);

                if (attempt < this.config.retryAttempts) {
                    // Wait before retry (exponential backoff)
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }

        throw lastError;
    }

    /**
     * Phase 2: Upload assets to Storyblok and replace placeholders in richtext
     */
    async uploadAssetsAndUpdateRichtext(richtext, assetRegistry, storyblokClient, options = {}) {
        if (!assetRegistry || assetRegistry.size === 0) {
            return richtext;
        }

        // Upload all assets first
        const uploadResults = await this.uploadAssets(assetRegistry, storyblokClient, options);

        // Replace placeholders in richtext
        return this.replacePlaceholdersInRichtext(richtext, assetRegistry);
    }

    /**
     * Upload all downloaded assets to Storyblok
     */
    async uploadAssets(assetRegistry, storyblokClient, options = {}) {
        const downloadedAssets = Array.from(assetRegistry.values()).filter(asset => asset.downloaded);
        const results = { success: [], failed: [] };

        if (downloadedAssets.length === 0) {
            return results;
        }

        // Process uploads in batches
        for (let i = 0; i < downloadedAssets.length; i += this.config.maxConcurrentUploads) {
            const batch = downloadedAssets.slice(i, i + this.config.maxConcurrentUploads);
            const batchPromises = batch.map(asset => this.uploadSingleAsset(asset, storyblokClient, options));

            const batchResults = await Promise.allSettled(batchPromises);

            batchResults.forEach((result, index) => {
                const asset = batch[index];
                if (result.status === 'fulfilled' && result.value) {
                    results.success.push(asset);
                    asset.storyblokAsset = result.value;
                } else {
                    results.failed.push({
                        asset,
                        error: result.reason || result.value
                    });
                    console.warn(`Failed to upload asset ${asset.localPath}:`, result.reason);
                }
            });
        }

        return results;
    }

    /**
     * Upload a single asset to Storyblok
     */
    async uploadSingleAsset(asset, storyblokClient, options = {}) {
        let lastError;

        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                if (!asset.localPath || !await this.fileExists(asset.localPath)) {
                    throw new Error('Local file not found');
                }

                // Read file for upload
                const fileBuffer = await fs.readFile(asset.localPath);

                // Upload to Storyblok
                const uploadResult = await storyblokClient.uploadAsset({
                    file: fileBuffer,
                    filename: asset.filename,
                    ...options.uploadOptions
                });

                // Clean up local file if configured
                if (options.cleanupLocal !== false) {
                    try {
                        await fs.unlink(asset.localPath);
                    } catch (cleanupError) {
                        console.warn(`Failed to cleanup local file ${asset.localPath}:`, cleanupError.message);
                    }
                }

                return uploadResult;
            } catch (error) {
                lastError = error;
                console.warn(`Upload attempt ${attempt}/${this.config.retryAttempts} failed for ${asset.localPath}:`, error.message);

                if (attempt < this.config.retryAttempts) {
                    await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
                }
            }
        }

        throw lastError;
    }

    /**
     * Replace asset placeholders in richtext with actual Storyblok asset URLs
     */
    replacePlaceholdersInRichtext(richtext, assetRegistry) {
        if (!richtext || typeof richtext !== 'object') {
            return richtext;
        }

        const updatedRichtext = JSON.parse(JSON.stringify(richtext)); // Deep clone

        this.traverseRichtextNodes(updatedRichtext, (node) => {
            // Handle image nodes
            if (node.type === 'image' && node.attrs?.src) {
                const placeholderMatch = node.attrs.src.match(/__STORYBLOK_ASSET_(.+)__/);
                if (placeholderMatch) {
                    const assetId = placeholderMatch[1];
                    const asset = assetRegistry.get(assetId);

                    if (asset?.storyblokAsset) {
                        node.attrs.src = asset.storyblokAsset.filename || asset.storyblokAsset.url;
                        // Add Storyblok asset metadata
                        node.attrs['data-storyblok-asset'] = asset.storyblokAsset.id;
                    }
                }
            }

            // Handle text nodes with image references (for HTML content)
            if (node.type === 'text' && node.text) {
                let updatedText = node.text;
                const placeholderRegex = /__STORYBLOK_ASSET_(.+?)__/g;

                updatedText = updatedText.replace(placeholderRegex, (match, assetId) => {
                    const asset = assetRegistry.get(assetId);
                    if (asset?.storyblokAsset) {
                        return asset.storyblokAsset.filename || asset.storyblokAsset.url;
                    }
                    return match; // Keep placeholder if asset not found
                });

                node.text = updatedText;
            }
        });

        return updatedRichtext;
    }

    /**
     * Traverse richtext nodes recursively
     */
    traverseRichtextNodes(node, callback) {
        if (!node || typeof node !== 'object') {
            return;
        }

        callback(node);

        if (node.content && Array.isArray(node.content)) {
            node.content.forEach(child => this.traverseRichtextNodes(child, callback));
        }
    }

    /**
     * Generate a safe filename for local storage
     */
    generateSafeFilename(filename) {
        if (!filename) {
            return `unknown_${Date.now()}`;
        }

        // Extract extension
        const ext = path.extname(filename);
        const nameWithoutExt = path.basename(filename, ext);

        // Clean filename
        const safeName = nameWithoutExt
            .replace(/[^a-zA-Z0-9.-]/g, '_')
            .replace(/_+/g, '_')
            .trim('_');

        return safeName + ext;
    }

    /**
     * Check if file exists
     */
    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get summary of asset processing results
     */
    getAssetSummary(assetRegistry) {
        if (!assetRegistry) {
            return { total: 0, downloaded: 0, uploaded: 0, failed: 0 };
        }

        const assets = Array.from(assetRegistry.values());

        return {
            total: assets.length,
            downloaded: assets.filter(a => a.downloaded).length,
            uploaded: assets.filter(a => a.storyblokAsset).length,
            failed: assets.filter(a => !a.downloaded && !a.storyblokAsset).length,
            assets: assets
        };
    }

    /**
     * Cleanup: Remove downloaded assets and reset registry
     */
    async cleanup(assetRegistry, options = {}) {
        if (!assetRegistry || assetRegistry.size === 0) {
            return;
        }

        const assets = Array.from(assetRegistry.values());

        for (const asset of assets) {
            if (asset.localPath && await this.fileExists(asset.localPath)) {
                try {
                    await fs.unlink(asset.localPath);
                } catch (error) {
                    console.warn(`Failed to cleanup ${asset.localPath}:`, error.message);
                }
            }
        }

        if (options.clearRegistry !== false) {
            assetRegistry.clear();
        }
    }
}
