import * as cheerio from 'cheerio';
import { htmlToStoryblokRichtext } from '@storyblok/richtext/html-parser';

/**
 * Converts HTML content to Storyblok rich text format using official converter
 */
export function convertHtmlToRichText(html) {
    if (!html?.trim()) {
        return { type: 'doc', content: [] };
    }

    try {
        // Preprocess WordPress HTML for better conversion
        const cleanedHtml = preprocessWordPressHtml(html);

        // Use the official Storyblok HTML to richtext converter
        return htmlToStoryblokRichtext(cleanedHtml);
    } catch (error) {
        console.warn('Failed to convert HTML to richtext, falling back to plain text:', error.message);
        // Fallback to simple text content if conversion fails
        return {
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{
                    type: 'text',
                    text: stripHtml(html)
                }]
            }]
        };
    }
}

/**
 * Preprocesses WordPress HTML to clean up common issues before conversion
 */
function preprocessWordPressHtml(html) {
    if (!html) return '';

    const $ = cheerio.load(html);

    // Remove WordPress-specific classes and attributes that might interfere
    $('*').each((_, element) => {
        const $el = $(element);

        // Remove common WordPress classes
        $el.removeClass('wp-image wp-caption wp-caption-text alignleft alignright aligncenter');

        // Clean up empty paragraphs
        if ($el.is('p') && !$el.text().trim() && $el.children().length === 0) {
            $el.remove();
        }

        // Convert WordPress gallery shortcodes to simple text (they'll need manual handling)
        if ($el.text().includes('[gallery')) {
            $el.replaceWith(`<p>Gallery: ${$el.text()}</p>`);
        }

        // Clean up WordPress figure captions
        if ($el.is('figcaption')) {
            $el.replaceWith(`<p><em>${$el.text()}</em></p>`);
        }
    });

    // Return the cleaned HTML
    return $.html();
}

/**
 * Strips HTML tags and returns plain text
 */
export function stripHtml(html) {
    if (!html) return '';
    return cheerio.load(html).text().trim();
}

/**
 * Converts WordPress internal links to relative paths
 */
export function convertInternalLinks(html, baseUrl) {
    if (!html) return '';

    const $ = cheerio.load(html);

    $('a[href]').each((_, element) => {
        const $link = $(element);
        const href = $link.attr('href');

        if (href && href.startsWith(baseUrl)) {
            // Convert to relative path
            const relativePath = href.replace(baseUrl, '');
            $link.attr('href', relativePath);
        }
    });

    return $.html();
}

/**
 * Converts WordPress content to Storyblok richtext with internal link processing
 */
export function convertWordPressContentToRichtext(html, baseUrl = '') {
    if (!html?.trim()) {
        return { type: 'doc', content: [] };
    }

    // First convert internal links if baseUrl is provided
    const processedHtml = baseUrl ? convertInternalLinks(html, baseUrl) : html;

    // Then convert to richtext
    return convertHtmlToRichText(processedHtml);
}

/**
 * Extracts and processes WordPress featured image
 */
export function processFeaturedImage(media) {
    if (!media) return null;

    return {
        filename: media.source_url,
        alt: media.alt_text || media.title?.rendered || '',
        title: media.title?.rendered || '',
        width: media.media_details?.width,
        height: media.media_details?.height,
    };
}

/**
 * Creates a slug from a string
 */
export function createSlug(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Rate limiting utility for API calls
 */
export function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
