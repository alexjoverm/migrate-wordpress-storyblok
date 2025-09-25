import * as cheerio from 'cheerio';

/**
 * Transform HTML links to Storyblok link objects
 */
export class LinkTransformer {
    constructor(config = {}) {
        this.config = config;
        this.linkTypeDetectors = new Map();
        this.urlRewriters = new Map();

        // Register default link type detectors
        this.registerDefaultDetectors();
        this.registerDefaultRewriters();
    }

    /**
     * Transform HTML content, converting links to Storyblok link objects
     */
    async transformContent(html, context = {}) {
        if (!html?.trim()) {
            return html;
        }

        const $ = cheerio.load(html);

        // Process all links
        $('a').each(async (_, element) => {
            const $link = $(element);
            const href = $link.attr('href');

            if (href) {
                const linkObject = await this.createLinkObject(href, $link.text(), $link.attr('target'), context);

                // Replace the link with a data attribute for later processing
                $link.attr('data-storyblok-link', JSON.stringify(linkObject));
            }
        });

        return $.html();
    }

    /**
     * Create a Storyblok link object from URL and context
     */
    async createLinkObject(url, text = '', target = null, context = {}) {
        const linkType = this.detectLinkType(url, context);
        const rewrittenUrl = await this.rewriteUrl(url, linkType, context);

        const linkObject = {
            id: '',
            url: rewrittenUrl,
            linktype: linkType,
            fieldtype: 'multilink',
            cached_url: rewrittenUrl
        };

        // Add target if specified
        if (target) {
            linkObject.target = target;
        }

        // Add link-type specific properties
        await this.addLinkTypeProperties(linkObject, url, context);

        return linkObject;
    }

    /**
     * Detect the type of link (story, asset, url, email)
     */
    detectLinkType(url, context = {}) {
        // Run custom detectors first
        for (const [_, detector] of this.linkTypeDetectors) {
            const type = detector(url, context);
            if (type) return type;
        }

        // Default detection logic
        if (url.startsWith('mailto:')) {
            return 'email';
        }

        if (url.startsWith('tel:')) {
            return 'url'; // Storyblok treats tel: as URL type
        }

        if (url.startsWith('#')) {
            return 'url'; // Anchor links
        }

        if (this.isAssetUrl(url, context)) {
            return 'asset';
        }

        if (this.isInternalUrl(url, context)) {
            return 'story';
        }

        return 'url';
    }

    /**
     * Check if URL points to an asset
     */
    isAssetUrl(url, context) {
        const assetExtensions = this.config.assetExtensions || [
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            '.mp4', '.avi', '.mov', '.wmv', '.mp3', '.wav', '.ogg',
            '.zip', '.rar', '.tar', '.gz'
        ];

        const lowerUrl = url.toLowerCase();
        return assetExtensions.some(ext => lowerUrl.includes(ext));
    }

    /**
     * Check if URL is internal to the site
     */
    isInternalUrl(url, context) {
        const siteUrl = context.siteUrl || this.config.siteUrl;
        if (!siteUrl) return false;

        try {
            const urlObj = new URL(url, siteUrl);
            const siteObj = new URL(siteUrl);
            return urlObj.hostname === siteObj.hostname;
        } catch {
            // If URL parsing fails, check if it's a relative URL
            return !url.includes('://') && !url.startsWith('//');
        }
    }

    /**
     * Rewrite URL based on link type and context
     */
    async rewriteUrl(url, linkType, context) {
        // Run custom URL rewriters
        for (const [type, rewriter] of this.urlRewriters) {
            if (type === linkType || type === '*') {
                const rewritten = await rewriter(url, linkType, context);
                if (rewritten !== undefined) {
                    return rewritten;
                }
            }
        }

        // Default rewriting
        switch (linkType) {
            case 'story':
                return await this.rewriteStoryUrl(url, context);
            case 'asset':
                return await this.rewriteAssetUrl(url, context);
            case 'email':
                return url.startsWith('mailto:') ? url : `mailto:${url}`;
            default:
                return url;
        }
    }

    /**
     * Rewrite internal URLs to Storyblok story references
     */
    async rewriteStoryUrl(url, context) {
        // Extract slug from URL
        const slug = this.extractSlugFromUrl(url, context);

        // Try to find the story in mapped data
        if (context.stories && slug) {
            const story = context.stories.find(s =>
                s.slug === slug || s.full_slug === slug || s.path === slug
            );

            if (story) {
                return story.full_slug || story.slug;
            }
        }

        // Fallback: return cleaned URL
        return this.cleanUrl(url, context);
    }

    /**
     * Rewrite asset URLs to Storyblok asset references
     */
    async rewriteAssetUrl(url, context) {
        // Try to find the asset in mapped data
        if (context.assets) {
            const asset = context.assets.find(a =>
                a.filename === url || a.filename.endsWith(url.split('/').pop())
            );

            if (asset) {
                return asset.filename;
            }
        }

        // Check with asset mapper if available
        if (context.assetMapper) {
            const asset = context.assetMapper.findAssetByUrl(url);
            if (asset) {
                return asset.filename;
            }
        }

        return url;
    }

    /**
     * Add link type specific properties
     */
    async addLinkTypeProperties(linkObject, originalUrl, context) {
        switch (linkObject.linktype) {
            case 'story':
                // Try to resolve story ID
                if (context.stories) {
                    const story = context.stories.find(s =>
                        s.full_slug === linkObject.url || s.slug === linkObject.url
                    );
                    if (story && story.id) {
                        linkObject.id = story.id.toString();
                    }
                }
                break;

            case 'asset':
                // Try to resolve asset ID
                if (context.assets) {
                    const asset = context.assets.find(a => a.filename === linkObject.url);
                    if (asset && asset.id) {
                        linkObject.id = asset.id.toString();
                    }
                }
                break;

            case 'email':
                // Clean up email URL
                linkObject.email = originalUrl.replace('mailto:', '');
                break;
        }
    }

    /**
     * Extract slug from URL
     */
    extractSlugFromUrl(url, context) {
        const siteUrl = context.siteUrl || this.config.siteUrl || '';

        try {
            const urlObj = new URL(url, siteUrl);
            const pathname = urlObj.pathname;

            // Remove leading/trailing slashes and extract slug
            return pathname.replace(/^\/+|\/+$/g, '').split('/').pop() || '';
        } catch {
            // Handle relative URLs
            return url.replace(/^\/+|\/+$/g, '').split('/').pop() || '';
        }
    }

    /**
     * Clean URL for internal use
     */
    cleanUrl(url, context) {
        const siteUrl = context.siteUrl || this.config.siteUrl || '';

        try {
            const urlObj = new URL(url, siteUrl);
            return urlObj.pathname.replace(/^\/+|\/+$/g, '');
        } catch {
            return url.replace(/^\/+|\/+$/g, '');
        }
    }

    /**
     * Register a link type detector
     */
    registerLinkTypeDetector(name, detector) {
        this.linkTypeDetectors.set(name, detector);
        return this;
    }

    /**
     * Register a URL rewriter
     */
    registerUrlRewriter(linkType, rewriter) {
        this.urlRewriters.set(linkType, rewriter);
        return this;
    }

    /**
     * Register default link type detectors
     */
    registerDefaultDetectors() {
        // WordPress admin links
        this.registerLinkTypeDetector('wp-admin', (url) => {
            if (url.includes('/wp-admin/') || url.includes('/wp-login.php')) {
                return 'url'; // Treat as external URL
            }
        });

        // WordPress attachment links
        this.registerLinkTypeDetector('wp-attachment', (url) => {
            if (url.includes('/?attachment_id=') || url.match(/\/(\\d+)\/attachment\//)) {
                return 'asset';
            }
        });

        // WordPress category/tag links
        this.registerLinkTypeDetector('wp-taxonomy', (url, context) => {
            if (url.includes('/category/') || url.includes('/tag/')) {
                // If taxonomies are mapped as pages, treat as story
                const taxonomyAsPages = context.config?.taxonomies?.createPages;
                return taxonomyAsPages ? 'story' : 'url';
            }
        });
    }

    /**
     * Register default URL rewriters
     */
    registerDefaultRewriters() {
        // WordPress attachment ID rewriter
        this.registerUrlRewriter('asset', async (url, linkType, context) => {
            const attachmentMatch = url.match(/\\?attachment_id=(\\d+)/);
            if (attachmentMatch && context.wordpressData?.media) {
                const attachmentId = parseInt(attachmentMatch[1]);
                const media = context.wordpressData.media.find(m => m.id === attachmentId);
                if (media?.source_url) {
                    return media.source_url;
                }
            }
        });

        // Remove WordPress query parameters
        this.registerUrlRewriter('*', (url) => {
            try {
                const urlObj = new URL(url, 'http://example.com');
                // Remove WordPress-specific query parameters
                urlObj.searchParams.delete('p');
                urlObj.searchParams.delete('page_id');
                urlObj.searchParams.delete('attachment_id');
                urlObj.searchParams.delete('preview');
                urlObj.searchParams.delete('preview_id');

                return urlObj.toString().replace('http://example.com', '');
            } catch {
                return url;
            }
        });
    }

    /**
     * Extract all links from content as link objects
     */
    async extractLinksFromContent(html, context = {}) {
        const links = [];

        if (!html?.trim()) {
            return links;
        }

        const $ = cheerio.load(html);

        $('a').each(async (_, element) => {
            const $link = $(element);
            const href = $link.attr('href');
            const text = $link.text();
            const target = $link.attr('target');

            if (href) {
                const linkObject = await this.createLinkObject(href, text, target, context);
                links.push({
                    original: {
                        href,
                        text,
                        target,
                        element: $link.prop('outerHTML')
                    },
                    storyblok: linkObject
                });
            }
        });

        return links;
    }

    /**
     * Validate link object structure
     */
    validateLinkObject(linkObject) {
        const required = ['linktype', 'cached_url'];
        const typeSpecificRequired = {
            'story': ['url'],
            'asset': ['url'],
            'url': ['url'],
            'email': ['email']
        };

        // Check required fields
        for (const field of required) {
            if (!(field in linkObject)) {
                return { valid: false, error: `Missing required field: ${field}` };
            }
        }

        // Check type-specific required fields
        const typeRequired = typeSpecificRequired[linkObject.linktype] || [];
        for (const field of typeRequired) {
            if (!(field in linkObject)) {
                return { valid: false, error: `Missing required field for ${linkObject.linktype}: ${field}` };
            }
        }

        return { valid: true };
    }
}
