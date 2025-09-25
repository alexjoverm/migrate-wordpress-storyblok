import fs from 'fs-extra';
import path from 'path';
import { validateConfiguration } from './ConfigurationValidator.js';

/**
 * Loads and validates mapping configuration
 * Handles contentTypes (previously postTypes), i18n strategies, transformers, and story organization
 */
export class ConfigurationLoader {
    constructor() {
        this.defaultConfig = {
            // Storyblok space configuration
            space: {
                name: '',
                datasources: {
                    folder: null, // null = root level, 'space-name' = space-specific folder
                    format: 'separate' // 'separate' or 'combined'
                }
            },

            // WordPress data source configuration
            dataFormat: {
                directory: '',
                languages: {
                    default: 'en',
                    available: ['en']
                },
                customPostTypes: {}
            },

            // i18n strategy: 'field_level' or 'folder_level'
            i18n: {
                strategy: 'field_level', // 'field_level' = language-suffixed files, 'folder_level' = language subfolders
                defaultLanguage: 'en',
                languages: {
                    en: { name: 'English', prefix: '', suffix: '' },
                    es: { name: 'Spanish', prefix: 'es', suffix: '_es' }
                }
            },

            // Story organization configuration
            stories: {
                format: 'separate', // 'separate' = individual files, 'combined' = single file
                preservePath: true, // true = maintain WordPress folder structure, false = flatten
                folderMapping: {} // Custom folder mappings: { 'wordpress-path': 'storyblok-folder' }
            },

            // Content type mappings (renamed from postTypes)
            contentTypes: {},

            // Global field transformers
            transformers: {
                // String-based transformers
                richtext: {
                    extractExternal: true, // Extract external assets from richtext
                    convertLinks: true,
                    preserveFormatting: true
                },
                asset: {
                    uploadExternal: true,
                    preserveStructure: true
                },
                reference: {
                    createRelations: true
                },
                references: {
                    createRelations: true
                },
                tags: {
                    createDatasource: true
                },
                datetime: {
                    format: 'YYYY-MM-DD HH:mm:ss'
                },
                link: {
                    convertInternal: true,
                    preserveExternal: true
                }
            },

            // Asset handling configuration
            assets: {
                downloadPath: './mapped-data/assets',
                preserveStructure: false,
                generateManifest: true
            },

            // Component definitions
            components: [],

            // Datasource configuration
            datasources: {
                taxonomies: {
                    enabled: true,
                    mapTo: 'datasource'
                }
            },

            // Hook system for custom transformations
            hooks: {
                beforeMapping: [],
                afterMapping: [],
                beforeStoryMapping: [],
                afterStoryMapping: [],
                beforeAssetMapping: [],
                afterAssetMapping: []
            }
        };
    }

    /**
     * Load configuration from file
     * @param {string} configPath - Path to configuration file
     * @returns {Promise<object>} Loaded and validated configuration
     */
    async load(configPath) {
        try {
            console.log(`🔧 Loading configuration from: ${configPath}`);

            // Check if config file exists
            if (!await fs.pathExists(configPath)) {
                throw new Error(`Configuration file not found: ${configPath}`);
            }

            // Import configuration module
            const configUrl = path.resolve(configPath);
            const { default: userConfig } = await import(`file://${configUrl}`);

            // Merge with defaults
            const config = this.mergeConfigs(this.defaultConfig, userConfig);

            // Validate configuration
            await validateConfiguration(config);

            // Normalize contentTypes (handle legacy postTypes)
            config.contentTypes = config.contentTypes || config.postTypes || {};
            delete config.postTypes; // Remove legacy property

            // Process function transformers
            this.processFunctionTransformers(config);

            console.log('✅ Configuration loaded successfully');
            console.log(`   📋 Content types: ${Object.keys(config.contentTypes).join(', ')}`);
            console.log(`   🌐 i18n strategy: ${config.i18n.strategy}`);
            console.log(`   📖 Story format: ${config.stories.format}`);
            console.log(`   📁 Preserve path: ${config.stories.preservePath}`);

            return config;

        } catch (error) {
            console.error('❌ Failed to load configuration:', error.message);
            throw error;
        }
    }

    /**
     * Deep merge configuration objects
     * @param {object} defaults - Default configuration
     * @param {object} userConfig - User-provided configuration
     * @returns {object} Merged configuration
     */
    mergeConfigs(defaults, userConfig) {
        const merged = { ...defaults };

        for (const [key, value] of Object.entries(userConfig)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                merged[key] = this.mergeConfigs(merged[key] || {}, value);
            } else {
                merged[key] = value;
            }
        }

        return merged;
    }

    /**
     * Process function transformers in configuration
     * Convert function strings to actual functions where needed
     * @param {object} config - Configuration object to process
     */
    processFunctionTransformers(config) {
        // Process contentTypes field transformers
        for (const [contentType, contentConfig] of Object.entries(config.contentTypes || {})) {
            if (contentConfig.fields) {
                for (const [fieldName, fieldConfig] of Object.entries(contentConfig.fields)) {
                    if (typeof fieldConfig === 'object' && fieldConfig.transformer && typeof fieldConfig.transformer === 'function') {
                        // Function transformers are already functions, no processing needed
                        console.log(`   🔧 Function transformer registered for ${contentType}.${fieldName}`);
                    }
                }
            }
        }
    }

    /**
     * Get a nested configuration value with dot notation
     * @param {object} config - Configuration object
     * @param {string} path - Dot-separated path (e.g., 'stories.format')
     * @param {any} defaultValue - Default value if path not found
     * @returns {any} Configuration value
     */
    static getConfigValue(config, path, defaultValue = undefined) {
        const keys = path.split('.');
        let current = config;

        for (const key of keys) {
            if (current && typeof current === 'object' && key in current) {
                current = current[key];
            } else {
                return defaultValue;
            }
        }

        return current;
    }

    /**
     * Set a nested configuration value with dot notation
     * @param {object} config - Configuration object
     * @param {string} path - Dot-separated path (e.g., 'stories.format')
     * @param {any} value - Value to set
     */
    static setConfigValue(config, path, value) {
        const keys = path.split('.');
        let current = config;

        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!current[key] || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }

        current[keys[keys.length - 1]] = value;
    }
}
