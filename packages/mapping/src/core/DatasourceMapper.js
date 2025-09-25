import { BaseMapper } from './BaseMapper.js';
import slugify from 'slugify';

/**
 * Maps WordPress taxonomies to Storyblok datasources and tags
 */
export class DatasourceMapper extends BaseMapper {
    constructor(config = {}) {
        super(config);
    }

    /**
     * Map WordPress taxonomies to Storyblok datasources
     */
    async mapDatasources(wordpressData, language = 'en') {
        const datasources = [];

        // Run pre-mapping hooks
        await this.runHooks('beforeDatasourceMapping', wordpressData, { language });

        // Get taxonomy configurations
        const taxonomyConfigs = this.getConfig('datasources.taxonomies', {});

        // Map configured taxonomies
        for (const [taxonomySlug, config] of Object.entries(taxonomyConfigs)) {
            const datasource = await this.mapTaxonomyToDatasource(
                taxonomySlug,
                config,
                wordpressData,
                language
            );
            if (datasource) {
                datasources.push(datasource);
            }
        }

        // Map custom datasources if configured
        const customDatasources = this.getConfig('datasources.custom', {});
        for (const [datasourceName, config] of Object.entries(customDatasources)) {
            const datasource = await this.mapCustomDatasource(
                datasourceName,
                config,
                wordpressData,
                language
            );
            if (datasource) {
                datasources.push(datasource);
            }
        }

        // Run post-mapping hooks
        const finalDatasources = await this.runHooks('afterDatasourceMapping', datasources, { language });

        return finalDatasources;
    }

    /**
     * Map a WordPress taxonomy to a Storyblok datasource
     */
    async mapTaxonomyToDatasource(taxonomySlug, config, wordpressData, language) {
        // Get taxonomy data from various possible sources
        let taxonomyData = null;

        if (wordpressData.taxonomies && wordpressData.taxonomies[taxonomySlug]) {
            taxonomyData = wordpressData.taxonomies[taxonomySlug].terms;
        } else if (wordpressData[taxonomySlug]) {
            taxonomyData = wordpressData[taxonomySlug];
        }

        if (!taxonomyData || !Array.isArray(taxonomyData)) {
            console.warn(`No data found for taxonomy: ${taxonomySlug}`);
            return null;
        }

        // Build datasource structure
        const datasource = {
            name: config.name || this.humanizeName(taxonomySlug),
            slug: config.slug || slugify(taxonomySlug, { lower: true }),
            datasource_entries: []
        };

        // Process taxonomy terms
        for (const term of taxonomyData) {
            const entry = await this.mapTaxonomyTerm(term, config, wordpressData, language);
            if (entry) {
                datasource.datasource_entries.push(entry);
            }
        }

        // Sort entries if configured
        if (config.sort) {
            datasource.datasource_entries.sort(this.getSortFunction(config.sort));
        }

        // Apply transformers
        const processedDatasource = await this.applyTransformer('datasource', datasource, {
            wordpressData,
            language,
            taxonomySlug,
            config
        });

        // Run taxonomy-specific mapping hooks
        const finalDatasource = await this.runHooks(`after${taxonomySlug}Mapping`, processedDatasource, {
            wordpressData,
            language,
            taxonomySlug,
            config
        });

        return finalDatasource;
    }

    /**
     * Map a taxonomy term to a datasource entry
     */
    async mapTaxonomyTerm(term, config, wordpressData, language) {
        const entryConfig = config.entry || {};

        // Build base entry structure
        let entry = {
            name: term.name,
            value: slugify(term.slug || term.name, { lower: true }),
        };

        // Add additional fields if configured
        const fieldMappings = entryConfig.fields || {};
        for (const [entryField, mapping] of Object.entries(fieldMappings)) {
            if (typeof mapping === 'string') {
                entry[entryField] = this.safeGet(term, mapping);
            } else if (typeof mapping === 'function') {
                entry[entryField] = await mapping(term, wordpressData, language);
            }
        }

        // Add hierarchy information if the taxonomy is hierarchical
        if (term.parent && term.parent !== 0 && config.hierarchical !== false) {
            entry.parent = term.parent;
        }

        // Add meta information if configured
        if (config.includeMeta) {
            entry.meta = {
                wordpress_id: term.id,
                count: term.count,
                description: term.description,
                link: term.link,
                taxonomy: term.taxonomy
            };
        }

        // Apply term transformers
        entry = await this.applyTransformer('datasource.entry', entry, {
            wordpressData,
            language,
            originalTerm: term,
            config
        });

        return entry;
    }

    /**
     * Map custom datasource
     */
    async mapCustomDatasource(datasourceName, config, wordpressData, language) {
        const datasource = {
            name: config.name || this.humanizeName(datasourceName),
            slug: config.slug || slugify(datasourceName, { lower: true }),
            datasource_entries: []
        };

        // Get data source
        const sourceData = config.source ? this.safeGet(wordpressData, config.source) : [];

        if (!Array.isArray(sourceData)) {
            console.warn(`Custom datasource ${datasourceName} source is not an array`);
            return null;
        }

        // Process entries
        for (const item of sourceData) {
            const entry = await this.mapCustomDatasourceEntry(item, config, wordpressData, language);
            if (entry) {
                datasource.datasource_entries.push(entry);
            }
        }

        // Apply transformers
        const processedDatasource = await this.applyTransformer(`datasource.${datasourceName}`, datasource, {
            wordpressData,
            language,
            config
        });

        return processedDatasource;
    }

    /**
     * Map custom datasource entry
     */
    async mapCustomDatasourceEntry(item, config, wordpressData, language) {
        const entryConfig = config.entry || {};

        let entry = {
            name: this.safeGet(item, entryConfig.nameField || 'name') || `Item ${item.id}`,
            value: this.safeGet(item, entryConfig.valueField || 'slug') || slugify(item.name || `item-${item.id}`, { lower: true }),
        };

        // Add additional fields
        if (entryConfig.fields) {
            for (const [entryField, mapping] of Object.entries(entryConfig.fields)) {
                if (typeof mapping === 'string') {
                    entry[entryField] = this.safeGet(item, mapping);
                } else if (typeof mapping === 'function') {
                    entry[entryField] = await mapping(item, wordpressData, language);
                }
            }
        }

        return entry;
    }

    /**
     * Generate tags from taxonomies
     */
    async generateTagsFromTaxonomies(wordpressData, language = 'en') {
        const tags = new Set();
        const tagConfigs = this.getConfig('tags.taxonomies', ['category', 'post_tag']);

        for (const taxonomySlug of tagConfigs) {
            let taxonomyData = null;

            if (wordpressData.taxonomies && wordpressData.taxonomies[taxonomySlug]) {
                taxonomyData = wordpressData.taxonomies[taxonomySlug].terms;
            } else if (wordpressData[taxonomySlug]) {
                taxonomyData = wordpressData[taxonomySlug];
            }

            if (taxonomyData && Array.isArray(taxonomyData)) {
                for (const term of taxonomyData) {
                    tags.add(term.name);
                }
            }
        }

        return Array.from(tags);
    }

    /**
     * Create option datasource for single/multi-option fields
     */
    async createOptionDatasource(name, options, config = {}) {
        const datasource = {
            name: config.name || name,
            slug: config.slug || slugify(name, { lower: true }),
            datasource_entries: []
        };

        for (const option of options) {
            let entry;
            if (typeof option === 'string') {
                entry = {
                    name: option,
                    value: slugify(option, { lower: true })
                };
            } else if (option && typeof option === 'object') {
                entry = {
                    name: option.name || option.label || option.value,
                    value: option.value || slugify(option.name || option.label, { lower: true })
                };
            }

            if (entry) {
                datasource.datasource_entries.push(entry);
            }
        }

        return datasource;
    }

    /**
     * Create datasource from WordPress users
     */
    async createUserDatasource(users, config = {}) {
        const datasource = {
            name: config.name || 'Authors',
            slug: config.slug || 'authors',
            datasource_entries: []
        };

        for (const user of users) {
            const entry = {
                name: user.name || user.display_name || `User ${user.id}`,
                value: slugify(user.slug || user.nicename || user.login, { lower: true }),
            };

            // Add additional user fields if configured
            if (config.includeEmail) {
                entry.email = user.email;
            }

            if (config.includeRole) {
                entry.role = user.roles?.[0] || 'subscriber';
            }

            if (config.includeMeta) {
                entry.meta = {
                    wordpress_id: user.id,
                    description: user.description,
                    url: user.url,
                    avatar: user.avatar_urls
                };
            }

            datasource.datasource_entries.push(entry);
        }

        return datasource;
    }

    /**
     * Humanize a name (convert snake_case to Title Case)
     */
    humanizeName(name) {
        return name
            .replace(/_/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Get sort function based on configuration
     */
    getSortFunction(sortConfig) {
        if (typeof sortConfig === 'string') {
            switch (sortConfig) {
                case 'name':
                    return (a, b) => a.name.localeCompare(b.name);
                case 'value':
                    return (a, b) => a.value.localeCompare(b.value);
                case 'count':
                    return (a, b) => (b.meta?.count || 0) - (a.meta?.count || 0);
                default:
                    return null;
            }
        } else if (typeof sortConfig === 'function') {
            return sortConfig;
        }

        return null;
    }
}
