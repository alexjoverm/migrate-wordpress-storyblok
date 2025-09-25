import * as cheerio from 'cheerio';
import { htmlToStoryblokRichtext, defaultOptions } from '@storyblok/richtext/html-parser';

/**
 * HTML to Storyblok richtext transformer
 * Uses @storyblok/richtext with minimal WordPress-specific media processing
 */
export class HtmlToRichtextTransformer {
    constructor(config = {}) {
        this.config = config;
    }

    /**
     * Transform HTML to Storyblok richtext format
     */
    async transform(html, context = {}) {
        if (!html?.trim()) {
            return { type: 'doc', content: [] };
        }

        try {
            // Process WordPress media elements before conversion
            const processedHtml = await this.processMediaElements(html, context);

            // Use @storyblok/richtext for the main conversion with default options
            return htmlToStoryblokRichtext(processedHtml, defaultOptions);
        } catch (error) {
            console.warn('HTML to richtext conversion failed, falling back:', error.message);
            return this.createFallbackRichtext(html);
        }
    }

    /**
     * Process WordPress media elements (images, videos, galleries)
     */
    async processMediaElements(html, context) {
        const $ = cheerio.load(html, null, false); // Don't parse as full document

        // Process images
        $('img').each((_, element) => {
            const $img = $(element);
            const src = $img.attr('src');

            if (src) {
                // Only extract external assets (not from WordPress media library)
                if (context.assetExtractor && this.config.extractEmbedded && this.isExternalAsset(src, context)) {
                    const assetInfo = context.assetExtractor.extractAsset(src, {
                        alt: $img.attr('alt') || '',
                        title: $img.attr('title') || ''
                    });

                    if (assetInfo) {
                        // Replace with Storyblok asset format
                        $img.attr('src', assetInfo.filename);
                    }
                }

                // Ensure alt text exists
                if (!$img.attr('alt')) {
                    $img.attr('alt', '');
                }

                // Clean WordPress-specific classes but keep useful ones
                const classList = $img.attr('class')?.split(' ') || [];
                const cleanedClasses = classList.filter(cls =>
                    !cls.startsWith('wp-image-') &&
                    !cls.startsWith('wp-') &&
                    !['alignleft', 'alignright', 'aligncenter', 'alignnone'].includes(cls)
                );

                if (cleanedClasses.length > 0) {
                    $img.attr('class', cleanedClasses.join(' '));
                } else {
                    $img.removeAttr('class');
                }
            }
        });

        // Process WordPress galleries - convert to simple div with images
        $('.wp-block-gallery, .gallery').each((_, element) => {
            const $gallery = $(element);
            const images = $gallery.find('img');

            if (images.length > 0) {
                let galleryHtml = '<div class="gallery">';
                images.each((_, img) => {
                    galleryHtml += $(img).prop('outerHTML');
                });
                galleryHtml += '</div>';

                $gallery.replaceWith(galleryHtml);
            }
        });

        // Process figures with captions - convert to simple image + paragraph
        $('figure').each((_, element) => {
            const $figure = $(element);
            const $img = $figure.find('img');
            const $figcaption = $figure.find('figcaption');

            if ($img.length > 0) {
                let replacement = $img.prop('outerHTML');

                if ($figcaption.length > 0) {
                    const caption = $figcaption.text().trim();
                    if (caption) {
                        replacement += `<p><em>${caption}</em></p>`;
                    }
                }

                $figure.replaceWith(replacement);
            }
        });

        return $.html();
    }

    /**
     * Check if this is an external asset that should be extracted
     * (not from WordPress media library)
     */
    isExternalAsset(src, context) {
        // Skip if not a full URL
        if (!src.startsWith('http://') && !src.startsWith('https://')) {
            return false;
        }

        // Skip if it's from the WordPress uploads directory (already handled by export)
        if (src.includes('/wp-content/uploads/')) {
            return false;
        }

        // Extract if it's an external URL (like Unsplash, CDNs, etc.)
        return true;
    }

    /**
     * Create fallback richtext content when conversion fails
     */
    createFallbackRichtext(html) {
        const $ = cheerio.load(html);
        const text = $.text().trim();

        if (!text) {
            return { type: 'doc', content: [] };
        }

        return {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: text
                }]
            }]
        };
    }
}
