import { BaseMapper } from './BaseMapper.js';
import slugify from 'slugify';

/**
 * Maps WordPress media and other assets to Storyblok assets
 */
export class AssetMapper extends BaseMapper {
    constructor(config = {}) {
        super(config);
    }

    /**
     * Map WordPress media to Storyblok assets
     */
    async mapAssets(wordpressData, language = 'en') {
        const assets = [];

        // Run pre-mapping hooks
        await this.runHooks('beforeAssetMapping', wordpressData, { language });

        if (wordpressData.media) {
            for (const media of wordpressData.media) {
                const asset = await this.mapMediaItem(media, wordpressData, language);
                if (asset) {
                    assets.push(asset);
                }
            }
        }

        // Map additional asset sources if configured
        const additionalSources = this.getConfig('assets.sources', []);
        for (const source of additionalSources) {
            if (wordpressData[source]) {
                for (const item of wordpressData[source]) {
                    const asset = await this.mapAssetFromSource(item, source, wordpressData, language);
                    if (asset) {
                        assets.push(asset);
                    }
                }
            }
        }

        // Run post-mapping hooks
        const finalAssets = await this.runHooks('afterAssetMapping', assets, { language });

        return finalAssets;
    }

    /**
     * Map a WordPress media item to a Storyblok asset
     */
    async mapMediaItem(media, wordpressData, language) {
        // Skip if media doesn't have a source URL
        if (!media.source_url) {
            return null;
        }

        // Build base asset structure
        let asset = {
            filename: media.source_url,
            alt: media.alt_text || media.title?.rendered || '',
            title: media.title?.rendered || '',
            copyright: media.caption?.rendered || '',
            focus: null,
            name: media.title?.rendered || media.slug || '',
        };

        // Add meta data if available
        if (media.media_details) {
            const details = media.media_details;
            asset.meta_data = {
                width: details.width,
                height: details.height,
                file_size: details.filesize,
                mime_type: media.mime_type,
                original_filename: details.file,
                upload_date: media.date,
                wordpress_id: media.id,
            };

            // Add image sizes if available
            if (details.sizes) {
                asset.meta_data.sizes = details.sizes;
            }
        }

        // Apply transformers
        asset = await this.applyTransformer('asset', asset, {
            wordpressData,
            language,
            originalMedia: media
        });

        // Run media mapping hooks
        asset = await this.runHooks('afterMediaMapping', asset, {
            wordpressData,
            language,
            originalMedia: media
        });

        return asset;
    }

    /**
     * Map asset from additional sources
     */
    async mapAssetFromSource(item, source, wordpressData, language) {
        const sourceConfig = this.getConfig(`assets.sourceConfigs.${source}`, {});

        // Extract URL from the configured field
        const urlField = sourceConfig.urlField || 'url';
        const url = this.safeGet(item, urlField);

        if (!url) {
            return null;
        }

        let asset = {
            filename: url,
            alt: this.safeGet(item, sourceConfig.altField || 'alt') || '',
            title: this.safeGet(item, sourceConfig.titleField || 'title') || '',
            copyright: this.safeGet(item, sourceConfig.copyrightField || 'copyright') || '',
            focus: null,
            name: this.safeGet(item, sourceConfig.nameField || 'name') || '',
        };

        // Add source-specific meta data
        if (sourceConfig.metaFields) {
            asset.meta_data = {};
            for (const [metaKey, sourceKey] of Object.entries(sourceConfig.metaFields)) {
                const value = this.safeGet(item, sourceKey);
                if (value !== null && value !== undefined) {
                    asset.meta_data[metaKey] = value;
                }
            }
        }

        // Apply source-specific transformers
        asset = await this.applyTransformer(`asset.${source}`, asset, {
            wordpressData,
            language,
            originalItem: item,
            source
        });

        return asset;
    }

    /**
     * Process assets from content (extract images from HTML, etc.)
     */
    async extractAssetsFromContent(content, contentType, wordpressData, language) {
        const assets = [];

        if (!content) return assets;

        // Extract image URLs from HTML content
        const imageRegex = /<img[^>]+src="([^"]+)"[^>]*>/gi;
        let match;

        while ((match = imageRegex.exec(content)) !== null) {
            const imageUrl = match[1];

            // Skip if it's already in the media library
            const existingMedia = wordpressData.media?.find(m => m.source_url === imageUrl);
            if (existingMedia) {
                continue;
            }

            // Create asset from extracted image
            const asset = {
                filename: imageUrl,
                alt: this.extractAltFromImageTag(match[0]),
                title: this.extractTitleFromImageTag(match[0]),
                copyright: '',
                focus: null,
                name: this.getFilenameFromUrl(imageUrl),
                meta_data: {
                    extracted_from: contentType,
                    source: 'content_extraction'
                }
            };

            assets.push(asset);
        }

        // Apply content extraction transformers
        const processedAssets = await this.applyTransformer('assets.extracted', assets, {
            wordpressData,
            language,
            contentType,
            originalContent: content
        });

        return processedAssets;
    }

    /**
     * Extract alt text from image tag
     */
    extractAltFromImageTag(imgTag) {
        const altMatch = imgTag.match(/alt="([^"]*)"/i);
        return altMatch ? altMatch[1] : '';
    }

    /**
     * Extract title from image tag
     */
    extractTitleFromImageTag(imgTag) {
        const titleMatch = imgTag.match(/title="([^"]*)"/i);
        return titleMatch ? titleMatch[1] : '';
    }

    /**
     * Get filename from URL
     */
    getFilenameFromUrl(url) {
        try {
            const urlObj = new URL(url);
            const pathname = urlObj.pathname;
            return pathname.substring(pathname.lastIndexOf('/') + 1);
        } catch {
            return url.substring(url.lastIndexOf('/') + 1);
        }
    }

    /**
     * Create Storyblok asset object from URL
     */
    createAssetObject(filename, alt = '', focus = null) {
        return {
            filename,
            alt,
            focus,
            fieldtype: 'asset'
        };
    }

    /**
     * Convert WordPress media ID to Storyblok asset object
     */
    async convertMediaIdToAsset(mediaId, wordpressData, defaultAsset = null) {
        if (!mediaId) return defaultAsset;

        const media = wordpressData.media?.find(m => m.id === mediaId);
        if (!media) return defaultAsset;

        return this.createAssetObject(
            media.source_url,
            media.alt_text || media.title?.rendered || '',
            null
        );
    }

    /**
     * Process multiple media IDs to asset objects
     */
    async convertMediaIdsToAssets(mediaIds, wordpressData) {
        if (!Array.isArray(mediaIds)) return [];

        const assets = [];
        for (const mediaId of mediaIds) {
            const asset = await this.convertMediaIdToAsset(mediaId, wordpressData);
            if (asset) {
                assets.push(asset);
            }
        }

        return assets;
    }
}
