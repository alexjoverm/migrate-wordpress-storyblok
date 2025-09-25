/**
 * Transform WordPress assets to Storyblok format with advanced processing
 */
export class AssetTransformer {
    constructor(config = {}) {
        this.config = config;
        this.processors = new Map();
        this.validators = new Map();
        this.urlResolvers = new Map();

        // Register default processors
        this.registerDefaultProcessors();
        this.registerDefaultValidators();
    }

    /**
     * Transform a WordPress media item to Storyblok asset format
     */
    async transformMediaItem(media, context = {}) {
        // Validate input
        if (!media || !media.source_url) {
            return null;
        }

        // Create base asset object
        let asset = {
            filename: media.source_url,
            alt: media.alt_text || '',
            title: media.title?.rendered || media.title || '',
            copyright: media.caption?.rendered || media.caption || '',
            focus: this.extractFocus(media),
            name: this.generateAssetName(media)
        };

        // Add meta data
        asset.meta_data = await this.extractMetaData(media, context);

        // Process asset through registered processors
        asset = await this.applyProcessors(asset, media, context);

        // Validate the asset
        const validation = this.validateAsset(asset);
        if (!validation.valid) {
            console.warn(`Asset validation failed for ${media.id}:`, validation.error);
            return null;
        }

        return asset;
    }

    /**
     * Transform multiple media items
     */
    async transformMediaItems(mediaArray, context = {}) {
        const assets = [];

        for (const media of mediaArray) {
            const asset = await this.transformMediaItem(media, context);
            if (asset) {
                assets.push(asset);
            }
        }

        return assets;
    }

    /**
     * Create Storyblok asset field object
     */
    createAssetField(filename, alt = '', focus = null) {
        return {
            filename,
            alt,
            focus,
            fieldtype: 'asset'
        };
    }

    /**
     * Create Storyblok multiasset field object
     */
    createMultiAssetField(assets = []) {
        return {
            fieldtype: 'multiasset',
            value: assets.map(asset => this.createAssetField(asset.filename, asset.alt, asset.focus))
        };
    }

    /**
     * Transform WordPress featured image to Storyblok asset
     */
    async transformFeaturedImage(mediaId, wordpressData, context = {}) {
        if (!mediaId || !wordpressData.media) {
            return null;
        }

        const media = wordpressData.media.find(m => m.id === mediaId);
        if (!media) {
            return null;
        }

        const asset = await this.transformMediaItem(media, context);
        return asset ? this.createAssetField(asset.filename, asset.alt, asset.focus) : null;
    }

    /**
     * Transform WordPress gallery to Storyblok multiasset
     */
    async transformGallery(attachmentIds, wordpressData, context = {}) {
        if (!Array.isArray(attachmentIds) || !wordpressData.media) {
            return this.createMultiAssetField([]);
        }

        const assets = [];

        for (const attachmentId of attachmentIds) {
            const media = wordpressData.media.find(m => m.id === attachmentId);
            if (media) {
                const asset = await this.transformMediaItem(media, context);
                if (asset) {
                    assets.push(asset);
                }
            }
        }

        return this.createMultiAssetField(assets);
    }

    /**
     * Extract assets from HTML content
     */
    async extractAssetsFromContent(html, context = {}) {
        if (!html?.trim()) {
            return [];
        }

        const assets = [];
        const imageRegex = /<img[^>]+src="([^"]+)"[^>]*(?:\s+alt="([^"]*)")?[^>]*>/gi;
        let match;

        while ((match = imageRegex.exec(html)) !== null) {
            const src = match[1];
            const alt = match[2] || '';

            // Skip if already processed
            if (context.processedUrls && context.processedUrls.has(src)) {
                continue;
            }

            // Check if it's a WordPress media item
            let media = null;
            if (context.wordpressData?.media) {
                media = context.wordpressData.media.find(m => m.source_url === src);
            }

            let asset;
            if (media) {
                asset = await this.transformMediaItem(media, context);
            } else {
                // Create asset from extracted information
                asset = {
                    filename: src,
                    alt: alt,
                    title: '',
                    copyright: '',
                    focus: null,
                    name: this.getFilenameFromUrl(src),
                    meta_data: {
                        source: 'content_extraction',
                        extracted_from: 'html_content'
                    }
                };
            }

            if (asset) {
                assets.push(asset);
                if (context.processedUrls) {
                    context.processedUrls.add(src);
                }
            }
        }

        return assets;
    }

    /**
     * Extract meta data from WordPress media item
     */
    async extractMetaData(media, context) {
        const metaData = {
            wordpress_id: media.id,
            upload_date: media.date,
            modified_date: media.modified,
            mime_type: media.mime_type,
            author_id: media.author
        };

        // Add media details if available
        if (media.media_details) {
            const details = media.media_details;

            metaData.width = details.width;
            metaData.height = details.height;
            metaData.file_size = details.filesize;
            metaData.original_filename = details.file;

            // Add image sizes
            if (details.sizes) {
                metaData.sizes = details.sizes;
            }

            // Add image meta (EXIF data, etc.)
            if (details.image_meta) {
                metaData.image_meta = details.image_meta;
            }
        }

        // Add WordPress-specific meta
        if (media.meta && Array.isArray(media.meta) && media.meta.length === 0) {
            // WordPress REST API returns empty array for no meta
        } else if (media.meta) {
            metaData.wordpress_meta = media.meta;
        }

        // Add custom meta if configured
        const customMetaFields = this.config.customMetaFields || [];
        for (const field of customMetaFields) {
            const value = this.safeGet(media, field);
            if (value !== undefined && value !== null) {
                metaData[field] = value;
            }
        }

        return metaData;
    }

    /**
     * Extract focus point from media (if available)
     */
    extractFocus(media) {
        // Check if focus point is stored in meta data
        if (media.meta?.focus_point) {
            return media.meta.focus_point;
        }

        // Check if it's stored in media details
        if (media.media_details?.focus_point) {
            return media.media_details.focus_point;
        }

        // Default: no focus point
        return null;
    }

    /**
     * Generate asset name from media item
     */
    generateAssetName(media) {
        if (media.title?.rendered) {
            return media.title.rendered;
        }

        if (media.title && typeof media.title === 'string') {
            return media.title;
        }

        if (media.slug) {
            return media.slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        }

        // Fallback to filename
        return this.getFilenameFromUrl(media.source_url);
    }

    /**
     * Apply registered processors to asset
     */
    async applyProcessors(asset, originalMedia, context) {
        let processedAsset = { ...asset };

        for (const [name, processor] of this.processors) {
            try {
                const result = await processor(processedAsset, originalMedia, context);
                if (result) {
                    processedAsset = result;
                }
            } catch (error) {
                console.warn(`Asset processor ${name} failed:`, error.message);
            }
        }

        return processedAsset;
    }

    /**
     * Register an asset processor
     */
    registerProcessor(name, processor) {
        this.processors.set(name, processor);
        return this;
    }

    /**
     * Register an asset validator
     */
    registerValidator(name, validator) {
        this.validators.set(name, validator);
        return this;
    }

    /**
     * Register default processors
     */
    registerDefaultProcessors() {
        // URL resolver processor
        this.registerProcessor('url_resolver', async (asset, originalMedia, context) => {
            // Resolve relative URLs to absolute
            if (!asset.filename.startsWith('http')) {
                const baseUrl = context.siteUrl || this.config.siteUrl;
                if (baseUrl) {
                    asset.filename = new URL(asset.filename, baseUrl).toString();
                }
            }

            // Apply URL transformations
            for (const [pattern, resolver] of this.urlResolvers) {
                if (asset.filename.match(pattern)) {
                    const resolvedUrl = await resolver(asset.filename, asset, originalMedia, context);
                    if (resolvedUrl) {
                        asset.filename = resolvedUrl;
                    }
                }
            }

            return asset;
        });

        // Image optimization processor
        this.registerProcessor('image_optimization', async (asset, originalMedia, context) => {
            if (this.isImage(asset.filename) && this.config.optimizeImages) {
                // Add optimization parameters to URL if supported
                const optimizationParams = this.config.imageOptimization || {};
                const url = new URL(asset.filename);

                if (optimizationParams.quality) {
                    url.searchParams.set('quality', optimizationParams.quality);
                }

                if (optimizationParams.format && optimizationParams.format !== 'original') {
                    url.searchParams.set('format', optimizationParams.format);
                }

                asset.filename = url.toString();
            }

            return asset;
        });

        // Alt text enhancement processor
        this.registerProcessor('alt_enhancement', async (asset, originalMedia, context) => {
            if (!asset.alt && asset.title) {
                asset.alt = asset.title;
            }

            if (!asset.alt && asset.name) {
                asset.alt = asset.name;
            }

            // Clean up alt text
            if (asset.alt) {
                asset.alt = asset.alt.replace(/\\.(jpg|jpeg|png|gif|webp)$/i, '');
            }

            return asset;
        });
    }

    /**
     * Register default validators
     */
    registerDefaultValidators() {
        this.registerValidator('required_fields', (asset) => {
            const required = ['filename'];
            for (const field of required) {
                if (!asset[field]) {
                    return { valid: false, error: `Missing required field: ${field}` };
                }
            }
            return { valid: true };
        });

        this.registerValidator('url_format', (asset) => {
            try {
                new URL(asset.filename);
                return { valid: true };
            } catch {
                // Check if it's a relative path that could be valid
                if (asset.filename.startsWith('/') || !asset.filename.includes('://')) {
                    return { valid: true };
                }
                return { valid: false, error: 'Invalid URL format' };
            }
        });
    }

    /**
     * Validate asset object
     */
    validateAsset(asset) {
        for (const [name, validator] of this.validators) {
            const result = validator(asset);
            if (!result.valid) {
                return { valid: false, error: `Validator ${name}: ${result.error}` };
            }
        }

        return { valid: true };
    }

    /**
     * Register URL resolver
     */
    registerUrlResolver(pattern, resolver) {
        this.urlResolvers.set(pattern, resolver);
        return this;
    }

    /**
     * Check if URL points to an image
     */
    isImage(url) {
        const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.tiff'];
        const lowerUrl = url.toLowerCase();
        return imageExtensions.some(ext => lowerUrl.includes(ext));
    }

    /**
     * Check if URL points to a video
     */
    isVideo(url) {
        const videoExtensions = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'];
        const lowerUrl = url.toLowerCase();
        return videoExtensions.some(ext => lowerUrl.includes(ext));
    }

    /**
     * Check if URL points to an audio file
     */
    isAudio(url) {
        const audioExtensions = ['.mp3', '.wav', '.ogg', '.aac', '.flac', '.wma'];
        const lowerUrl = url.toLowerCase();
        return audioExtensions.some(ext => lowerUrl.includes(ext));
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
     * Safe method to access nested object properties
     */
    safeGet(obj, path) {
        const keys = path.split('.');
        let value = obj;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return undefined;
            }
        }

        return value;
    }

    /**
     * Create asset mapping from WordPress attachment IDs
     */
    async createAssetMapping(attachmentIds, wordpressData, context = {}) {
        const mapping = new Map();

        if (!Array.isArray(attachmentIds) || !wordpressData.media) {
            return mapping;
        }

        for (const attachmentId of attachmentIds) {
            const media = wordpressData.media.find(m => m.id === attachmentId);
            if (media) {
                const asset = await this.transformMediaItem(media, context);
                if (asset) {
                    mapping.set(attachmentId, asset);
                }
            }
        }

        return mapping;
    }
}
