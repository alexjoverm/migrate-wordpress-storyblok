/**
 * Base Mapper class that provides common functionality for all mappers
 */
export class BaseMapper {
    constructor(config = {}) {
        this.config = config;
        this.transformers = new Map();
        this.hooks = new Map();
    }

    /**
     * Register a transformer for a specific field or content type
     */
    addTransformer(key, transformer) {
        this.transformers.set(key, transformer);
        return this;
    }

    /**
     * Register a hook that runs at specific points in the mapping process
     */
    addHook(event, callback) {
        if (!this.hooks.has(event)) {
            this.hooks.set(event, []);
        }
        this.hooks.get(event).push(callback);
        return this;
    }

    /**
     * Run hooks for a specific event
     */
    async runHooks(event, data, context = {}) {
        const hooks = this.hooks.get(event) || [];
        let result = data;

        for (const hook of hooks) {
            result = await hook(result, context, this.config);
        }

        return result;
    }

    /**
     * Apply a transformer to data
     */
    async applyTransformer(key, data, context = {}) {
        const transformer = this.transformers.get(key);
        if (!transformer) {
            return data;
        }

        return await transformer(data, context, this.config);
    }

    /**
     * Get configuration value with optional default
     */
    getConfig(path, defaultValue = null) {
        const keys = path.split('.');
        let value = this.config;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    /**
     * Safe method to access nested object properties
     */
    safeGet(obj, path, defaultValue = null) {
        const keys = path.split('.');
        let value = obj;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return defaultValue;
            }
        }

        return value;
    }

    /**
     * Generate a unique slug from a string
     */
    generateSlug(text, existingSlugs = new Set()) {
        const baseSlug = text
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');

        let slug = baseSlug;
        let counter = 1;

        while (existingSlugs.has(slug)) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        return slug;
    }
}
