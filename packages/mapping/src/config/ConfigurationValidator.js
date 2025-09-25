/**
 * Validates mapping configuration structure and values
 */
export class ConfigurationValidator {
    /**
     * Validate the complete configuration object
     * @param {object} config - Configuration to validate
     * @throws {Error} If validation fails
     */
    static async validate(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('Configuration must be an object');
        }

        this.validateSpaceConfig(config.space);
        this.validateI18nConfig(config.i18n);
        this.validateStoriesConfig(config.stories);
        this.validateContentTypesConfig(config.contentTypes);
        this.validateTransformersConfig(config.transformers);
        this.validateAssetsConfig(config.assets);
        this.validateDataFormatConfig(config.dataFormat);
    }

    /**
     * Validate space configuration
     * @param {object} spaceConfig - Space configuration
     */
    static validateSpaceConfig(spaceConfig) {
        if (!spaceConfig || typeof spaceConfig !== 'object') {
            throw new Error('Space configuration is required');
        }

        if (spaceConfig.datasources) {
            const { format } = spaceConfig.datasources;
            if (format && !['separate', 'combined'].includes(format)) {
                throw new Error('Space datasources format must be "separate" or "combined"');
            }
        }
    }

    /**
     * Validate i18n configuration
     * @param {object} i18nConfig - i18n configuration
     */
    static validateI18nConfig(i18nConfig) {
        if (!i18nConfig || typeof i18nConfig !== 'object') {
            throw new Error('i18n configuration is required');
        }

        const { strategy, defaultLanguage, languages } = i18nConfig;

        // Validate strategy
        if (!['field_level', 'folder_level'].includes(strategy)) {
            throw new Error('i18n strategy must be "field_level" or "folder_level"');
        }

        // Validate default language
        if (!defaultLanguage || typeof defaultLanguage !== 'string') {
            throw new Error('i18n defaultLanguage must be a string');
        }

        // Validate languages object
        if (!languages || typeof languages !== 'object') {
            throw new Error('i18n languages configuration is required');
        }

        // Validate default language exists in languages
        if (!languages[defaultLanguage]) {
            throw new Error(`Default language "${defaultLanguage}" not found in languages configuration`);
        }

        // Validate each language configuration
        for (const [langCode, langConfig] of Object.entries(languages)) {
            if (!langConfig || typeof langConfig !== 'object') {
                throw new Error(`Language configuration for "${langCode}" must be an object`);
            }

            if (!langConfig.name || typeof langConfig.name !== 'string') {
                throw new Error(`Language "${langCode}" must have a name property`);
            }
        }
    }

    /**
     * Validate stories configuration
     * @param {object} storiesConfig - Stories configuration
     */
    static validateStoriesConfig(storiesConfig) {
        if (!storiesConfig || typeof storiesConfig !== 'object') {
            throw new Error('Stories configuration is required');
        }

        const { format, preservePath, folderMapping } = storiesConfig;

        // Validate format
        if (format && !['separate', 'combined'].includes(format)) {
            throw new Error('Stories format must be "separate" or "combined"');
        }

        // Validate preservePath
        if (preservePath !== undefined && typeof preservePath !== 'boolean') {
            throw new Error('Stories preservePath must be a boolean');
        }

        // Validate folderMapping
        if (folderMapping && typeof folderMapping !== 'object') {
            throw new Error('Stories folderMapping must be an object');
        }
    }

    /**
     * Validate contentTypes configuration
     * @param {object} contentTypesConfig - Content types configuration
     */
    static validateContentTypesConfig(contentTypesConfig) {
        if (!contentTypesConfig || typeof contentTypesConfig !== 'object') {
            return; // ContentTypes is optional
        }

        for (const [contentType, config] of Object.entries(contentTypesConfig)) {
            if (!config || typeof config !== 'object') {
                throw new Error(`Content type "${contentType}" configuration must be an object`);
            }

            // Validate component
            if (config.component && typeof config.component !== 'string') {
                throw new Error(`Content type "${contentType}" component must be a string`);
            }

            // Validate folder
            if (config.folder && typeof config.folder !== 'string') {
                throw new Error(`Content type "${contentType}" folder must be a string`);
            }

            // Validate fields
            if (config.fields) {
                this.validateFieldsConfig(config.fields, contentType);
            }
        }
    }

    /**
     * Validate fields configuration
     * @param {object} fieldsConfig - Fields configuration
     * @param {string} contentType - Content type name for error context
     */
    static validateFieldsConfig(fieldsConfig, contentType) {
        if (typeof fieldsConfig !== 'object') {
            throw new Error(`Fields configuration for "${contentType}" must be an object`);
        }

        const validStringTransformers = [
            'richtext', 'asset', 'reference', 'references',
            'tags', 'datetime', 'link', 'string'
        ];

        for (const [fieldName, fieldConfig] of Object.entries(fieldsConfig)) {
            if (typeof fieldConfig === 'string') {
                // String-based transformer
                if (!validStringTransformers.includes(fieldConfig)) {
                    throw new Error(
                        `Invalid transformer "${fieldConfig}" for field "${fieldName}" in "${contentType}". ` +
                        `Valid options: ${validStringTransformers.join(', ')}`
                    );
                }
            } else if (typeof fieldConfig === 'object') {
                // Object-based transformer configuration
                if (fieldConfig.transformer) {
                    if (typeof fieldConfig.transformer === 'string') {
                        if (!validStringTransformers.includes(fieldConfig.transformer)) {
                            throw new Error(
                                `Invalid transformer "${fieldConfig.transformer}" for field "${fieldName}" in "${contentType}". ` +
                                `Valid options: ${validStringTransformers.join(', ')}`
                            );
                        }
                    } else if (typeof fieldConfig.transformer !== 'function') {
                        throw new Error(
                            `Transformer for field "${fieldName}" in "${contentType}" must be a string or function`
                        );
                    }
                }
            } else {
                throw new Error(
                    `Field configuration for "${fieldName}" in "${contentType}" must be a string or object`
                );
            }
        }
    }

    /**
     * Validate transformers configuration
     * @param {object} transformersConfig - Global transformers configuration
     */
    static validateTransformersConfig(transformersConfig) {
        if (!transformersConfig || typeof transformersConfig !== 'object') {
            return; // Transformers is optional
        }

        const validTransformerTypes = [
            'richtext', 'asset', 'reference', 'references',
            'tags', 'datetime', 'link'
        ];

        for (const [transformerType, config] of Object.entries(transformersConfig)) {
            if (!validTransformerTypes.includes(transformerType)) {
                console.warn(`Unknown global transformer type: ${transformerType}`);
            }

            if (config && typeof config !== 'object') {
                throw new Error(`Global transformer "${transformerType}" configuration must be an object`);
            }
        }
    }

    /**
     * Validate assets configuration
     * @param {object} assetsConfig - Assets configuration
     */
    static validateAssetsConfig(assetsConfig) {
        if (!assetsConfig || typeof assetsConfig !== 'object') {
            return; // Assets config is optional
        }

        const { downloadPath, preserveStructure, generateManifest } = assetsConfig;

        if (downloadPath && typeof downloadPath !== 'string') {
            throw new Error('Assets downloadPath must be a string');
        }

        if (preserveStructure !== undefined && typeof preserveStructure !== 'boolean') {
            throw new Error('Assets preserveStructure must be a boolean');
        }

        if (generateManifest !== undefined && typeof generateManifest !== 'boolean') {
            throw new Error('Assets generateManifest must be a boolean');
        }
    }

    /**
     * Validate data format configuration
     * @param {object} dataFormatConfig - Data format configuration
     */
    static validateDataFormatConfig(dataFormatConfig) {
        if (!dataFormatConfig || typeof dataFormatConfig !== 'object') {
            return; // Data format is optional
        }

        const { directory, languages, customPostTypes } = dataFormatConfig;

        if (directory && typeof directory !== 'string') {
            throw new Error('DataFormat directory must be a string');
        }

        if (languages) {
            if (typeof languages !== 'object') {
                throw new Error('DataFormat languages must be an object');
            }

            const { default: defaultLang, available } = languages;

            if (defaultLang && typeof defaultLang !== 'string') {
                throw new Error('DataFormat languages default must be a string');
            }

            if (available && !Array.isArray(available)) {
                throw new Error('DataFormat languages available must be an array');
            }
        }

        if (customPostTypes && typeof customPostTypes !== 'object') {
            throw new Error('DataFormat customPostTypes must be an object');
        }
    }
}

/**
 * Exported validation function for easier use
 * @param {object} config - Configuration to validate
 * @returns {Promise<void>}
 */
export async function validateConfiguration(config) {
    return ConfigurationValidator.validate(config);
}
