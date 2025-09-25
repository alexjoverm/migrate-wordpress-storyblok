import { HtmlToRichtextTransformer } from './HtmlToRichtextTransformer.js';
import { AssetTransformer } from './AssetTransformer.js';
import { LinkTransformer } from './LinkTransformer.js';
import slugify from 'slugify';

/**
 * Field transformation system supporting string-based and function-based transformers
 * Handles richtext, asset, reference, tags, datetime, and link transformations
 */
export class FieldTransformer {
    constructor(config = {}) {
        this.config = config;
        this.cache = new Map(); // Cache for expensive operations

        // Initialize specialized transformers
        this.htmlTransformer = new HtmlToRichtextTransformer(config);
        this.assetTransformer = new AssetTransformer(config);
        this.linkTransformer = new LinkTransformer(config);
    }

    /**
     * Transform a field value based on transformer configuration
     * @param {any} value - Original field value
     * @param {string|object|function} transformer - Transformer configuration
     * @param {object} context - Transformation context (post, language, etc.)
     * @returns {Promise<any>} Transformed value
     */
    async transform(value, transformer, context = {}) {
        if (!transformer || value === null || value === undefined) {
            return value;
        }

        try {
            // Handle string-based transformers
            if (typeof transformer === 'string') {
                return await this.applyStringTransformer(value, transformer, context);
            }

            // Handle object-based transformers
            if (typeof transformer === 'object') {
                const transformerType = transformer.transformer;
                const options = { ...transformer };
                delete options.transformer;

                if (typeof transformerType === 'string') {
                    return await this.applyStringTransformer(value, transformerType, context, options);
                } else if (typeof transformerType === 'function') {
                    return await this.applyFunctionTransformer(value, transformerType, context, options);
                }
            }

            // Handle direct function transformers
            if (typeof transformer === 'function') {
                return await this.applyFunctionTransformer(value, transformer, context);
            }

            console.warn('Unknown transformer type:', typeof transformer);
            return value;

        } catch (error) {
            console.error('Field transformation error:', error);
            return value; // Return original value on error
        }
    }

    /**
     * Apply string-based transformer
     * @param {any} value - Field value
     * @param {string} transformerType - Transformer type
     * @param {object} context - Context object
     * @param {object} options - Additional options
     * @returns {Promise<any>} Transformed value
     */
    async applyStringTransformer(value, transformerType, context, options = {}) {
        const transformerConfig = {
            ...this.getGlobalTransformerConfig(transformerType),
            ...options
        };

        switch (transformerType) {
            case 'richtext':
                return await this.transformRichtext(value, transformerConfig, context);

            case 'asset':
                return await this.transformAsset(value, transformerConfig, context);

            case 'reference':
                return await this.transformReference(value, transformerConfig, context);

            case 'references':
                return await this.transformReferences(value, transformerConfig, context);

            case 'tags':
                return await this.transformTags(value, transformerConfig, context);

            case 'datetime':
                return await this.transformDatetime(value, transformerConfig, context);

            case 'link':
                return await this.transformLink(value, transformerConfig, context);

            case 'string':
                return await this.transformString(value, transformerConfig, context);

            default:
                console.warn(`Unknown string transformer: ${transformerType}`);
                return value;
        }
    }

    /**
     * Apply function-based transformer
     * @param {any} value - Field value
     * @param {function} transformerFunction - Transformer function
     * @param {object} context - Context object
     * @param {object} options - Additional options
     * @returns {Promise<any>} Transformed value
     */
    async applyFunctionTransformer(value, transformerFunction, context, options = {}) {
        try {
            const result = await transformerFunction(value, {
                ...context,
                options,
                cache: this.cache,
                utils: this.getTransformerUtils()
            });
            return result;
        } catch (error) {
            console.error('Function transformer error:', error);
            return value;
        }
    }

    /**
     * Transform richtext field
     * @param {string} value - HTML content
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<object>} Richtext document
     */
    async transformRichtext(value, config, context) {
        if (!value || typeof value !== 'string') {
            return { type: 'doc', content: [] };
        }

        return await this.htmlTransformer.transform(value, {
            ...config,
            language: context.language,
            post: context.post
        });
    }

    /**
     * Transform asset field
     * @param {string|object} value - Asset URL or asset object
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<object>} Asset reference
     */
    async transformAsset(value, config, context) {
        if (!value) {
            return null;
        }

        // Handle different input formats
        let assetUrl = value;
        if (typeof value === 'object') {
            assetUrl = value.url || value.src || value.guid;
        }

        if (!assetUrl || typeof assetUrl !== 'string') {
            return null;
        }

        return await this.assetTransformer.transformSingle(assetUrl, config);
    }

    /**
     * Transform single reference field
     * @param {number|string|object} value - Reference ID or object
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<object|null>} Story reference
     */
    async transformReference(value, config, context) {
        if (!value) {
            return null;
        }

        let referenceId = value;
        if (typeof value === 'object') {
            referenceId = value.id || value.ID;
        }

        if (!referenceId) {
            return null;
        }

        // Create story reference
        return {
            id: '',
            uuid: this.generateReferenceUUID(referenceId, context.language),
            cached_url: '',
            linktype: 'story'
        };
    }

    /**
     * Transform multiple references field
     * @param {Array} value - Array of reference IDs or objects
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<Array>} Array of story references
     */
    async transformReferences(value, config, context) {
        if (!Array.isArray(value)) {
            return [];
        }

        const references = [];
        for (const item of value) {
            const reference = await this.transformReference(item, config, context);
            if (reference) {
                references.push(reference);
            }
        }

        return references;
    }

    /**
     * Transform tags field
     * @param {Array|string} value - Tags array or comma-separated string
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<Array>} Array of tag objects or datasource references
     */
    async transformTags(value, config, context) {
        if (!value) {
            return [];
        }

        // Convert to array if string
        let tags = Array.isArray(value) ? value : value.split(',').map(t => t.trim());

        if (config.createDatasource) {
            // Create datasource references
            return tags.map(tag => ({
                id: '',
                uuid: this.generateTagUUID(tag, context.language),
                cached_url: '',
                linktype: 'story'
            }));
        } else {
            // Return simple tag objects
            return tags.map(tag => ({
                name: tag,
                slug: slugify(tag.toLowerCase())
            }));
        }
    }

    /**
     * Transform datetime field
     * @param {string|Date} value - Date value
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<string>} Formatted datetime string
     */
    async transformDatetime(value, config, context) {
        if (!value) {
            return '';
        }

        try {
            const date = new Date(value);
            if (isNaN(date.getTime())) {
                return '';
            }

            // Apply format if specified
            if (config.format) {
                return this.formatDate(date, config.format);
            }

            // Default ISO format
            return date.toISOString();

        } catch (error) {
            console.warn('Date transformation error:', error);
            return '';
        }
    }

    /**
     * Transform link field
     * @param {string|object} value - Link URL or link object
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<object>} Link object
     */
    async transformLink(value, config, context) {
        if (!value) {
            return { linktype: 'url', url: '', cached_url: '' };
        }

        let linkUrl = value;
        if (typeof value === 'object') {
            linkUrl = value.url || value.href || value.link;
        }

        if (!linkUrl || typeof linkUrl !== 'string') {
            return { linktype: 'url', url: '', cached_url: '' };
        }

        return await this.linkTransformer.transform(linkUrl, config);
    }

    /**
     * Transform string field with basic processing
     * @param {any} value - String value
     * @param {object} config - Transformer configuration
     * @param {object} context - Context object
     * @returns {Promise<string>} Processed string
     */
    async transformString(value, config, context) {
        if (value === null || value === undefined) {
            return '';
        }

        let stringValue = String(value);

        // Apply string transformations based on config
        if (config.trim) {
            stringValue = stringValue.trim();
        }

        if (config.stripTags) {
            stringValue = stringValue.replace(/<[^>]*>/g, '');
        }

        if (config.maxLength && stringValue.length > config.maxLength) {
            stringValue = stringValue.substring(0, config.maxLength);
            if (config.appendEllipsis) {
                stringValue += '...';
            }
        }

        return stringValue;
    }

    /**
     * Get global transformer configuration
     * @param {string} transformerType - Type of transformer
     * @returns {object} Global configuration for transformer
     */
    getGlobalTransformerConfig(transformerType) {
        return this.config.transformers?.[transformerType] || {};
    }

    /**
     * Get utility functions for transformers
     * @returns {object} Utility functions
     */
    getTransformerUtils() {
        return {
            slugify: (text) => slugify(text.toLowerCase()),
            generateUID: () => Math.random().toString(36).substring(2, 15),
            stripTags: (html) => html.replace(/<[^>]*>/g, ''),
            formatDate: (date, format) => this.formatDate(date, format),
            isExternalUrl: (url) => /^https?:\/\//.test(url),
            cache: this.cache
        };
    }

    /**
     * Generate UUID for reference
     * @param {string|number} id - Reference ID
     * @param {string} language - Language code
     * @returns {string} Generated UUID
     */
    generateReferenceUUID(id, language = 'en') {
        return `ref-${id}-${language}-${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Generate UUID for tag
     * @param {string} tag - Tag name
     * @param {string} language - Language code
     * @returns {string} Generated UUID
     */
    generateTagUUID(tag, language = 'en') {
        const slug = slugify(tag.toLowerCase());
        return `tag-${slug}-${language}-${Math.random().toString(36).substring(2, 8)}`;
    }

    /**
     * Format date according to format string
     * @param {Date} date - Date object
     * @param {string} format - Format string
     * @returns {string} Formatted date
     */
    formatDate(date, format) {
        // Simple format implementation - can be enhanced with a proper date formatting library
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }
}
