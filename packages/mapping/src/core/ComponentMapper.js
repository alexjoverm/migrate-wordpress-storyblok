import { BaseMapper } from './BaseMapper.js';

/**
 * Maps WordPress block schemas to Storyblok component schemas
 */
export class ComponentMapper extends BaseMapper {
    constructor(config = {}) {
        super(config);
    }

    /**
     * Generate Storyblok component schemas from WordPress block schemas and configuration
     */
    async mapComponents(wordpressData, blockSchemas = null) {
        const components = [];

        // Run pre-mapping hooks
        await this.runHooks('beforeComponentMapping', { wordpressData, blockSchemas });

        // Generate components from configuration
        const componentConfigs = this.getConfig('components', {});
        for (const [componentName, config] of Object.entries(componentConfigs)) {
            const component = await this.generateComponent(componentName, config, wordpressData, blockSchemas);
            if (component) {
                components.push(component);
            }
        }

        // Auto-generate components from WordPress blocks if configured
        const autoGenerate = this.getConfig('components.autoGenerate', false);
        if (autoGenerate && blockSchemas) {
            const autoComponents = await this.autoGenerateComponents(blockSchemas, wordpressData);
            components.push(...autoComponents);
        }

        // Run post-mapping hooks
        const finalComponents = await this.runHooks('afterComponentMapping', components);

        return finalComponents;
    }

    /**
     * Generate a single component schema
     */
    async generateComponent(componentName, config, wordpressData, blockSchemas) {
        const component = {
            name: componentName,
            display_name: config.display_name || this.humanizeName(componentName),
            schema: {},
            image: config.image || null,
            preview_field: config.preview_field || null,
            is_root: config.is_root || false,
            is_nestable: config.is_nestable !== false, // default true
            all_presets: config.presets || [],
            preset_id: config.preset_id || null,
            real_name: componentName,
            component_group_uuid: config.group_uuid || null,
            color: config.color || null,
            icon: config.icon || null,
            internal_tags_list: config.internal_tags || [],
            internal_tag_ids: [],
            content_type_asset_preview: config.asset_preview || null
        };

        // Build schema from field definitions
        if (config.fields) {
            for (const [fieldName, fieldConfig] of Object.entries(config.fields)) {
                const field = await this.generateField(fieldName, fieldConfig, wordpressData, blockSchemas);
                if (field) {
                    component.schema[fieldName] = field;
                }
            }
        }

        // Apply component transformers
        const processedComponent = await this.applyTransformer('component', component, {
            wordpressData,
            blockSchemas,
            config
        });

        // Run component-specific mapping hooks
        const finalComponent = await this.runHooks(`after${componentName}ComponentMapping`, processedComponent, {
            wordpressData,
            blockSchemas,
            config
        });

        return finalComponent;
    }

    /**
     * Generate a field schema
     */
    async generateField(fieldName, fieldConfig, wordpressData, blockSchemas) {
        // Handle string shorthand (just field type)
        if (typeof fieldConfig === 'string') {
            fieldConfig = { type: fieldConfig };
        }

        const field = {
            type: fieldConfig.type || 'text',
            pos: fieldConfig.pos || 0,
            display_name: fieldConfig.display_name || this.humanizeName(fieldName),
            required: fieldConfig.required || false,
            description: fieldConfig.description || '',
            default_value: fieldConfig.default_value || this.getDefaultValueForType(fieldConfig.type),
        };

        // Add type-specific properties
        await this.addTypeSpecificProperties(field, fieldConfig, wordpressData);

        // Apply field transformers
        const processedField = await this.applyTransformer('field', field, {
            fieldName,
            fieldConfig,
            wordpressData,
            blockSchemas
        });

        return processedField;
    }

    /**
     * Add type-specific properties to field
     */
    async addTypeSpecificProperties(field, fieldConfig, wordpressData) {
        switch (field.type) {
            case 'option':
                field.options = fieldConfig.options || [];
                field.exclude_empty_option = fieldConfig.exclude_empty_option || false;
                break;

            case 'options':
                field.options = fieldConfig.options || [];
                field.min_options = fieldConfig.min_options || null;
                field.max_options = fieldConfig.max_options || null;
                break;

            case 'asset':
                field.filetypes = fieldConfig.filetypes || ['images', 'videos'];
                field.asset_folder_id = fieldConfig.asset_folder_id || null;
                break;

            case 'multiasset':
                field.filetypes = fieldConfig.filetypes || ['images', 'videos'];
                field.asset_folder_id = fieldConfig.asset_folder_id || null;
                break;

            case 'richtext':
                field.customize_toolbar = fieldConfig.customize_toolbar || false;
                field.toolbar = fieldConfig.toolbar || [];
                field.allow_target_blank = fieldConfig.allow_target_blank !== false;
                field.force_link_protocol = fieldConfig.force_link_protocol || false;
                break;

            case 'markdown':
                field.rich_markdown = fieldConfig.rich_markdown || false;
                break;

            case 'number':
                field.max_value = fieldConfig.max_value || null;
                field.min_value = fieldConfig.min_value || null;
                break;

            case 'datetime':
                field.disable_time = fieldConfig.disable_time || false;
                break;

            case 'link':
                field.restrict_content_types = fieldConfig.restrict_content_types || false;
                field.component_whitelist = fieldConfig.component_whitelist || [];
                field.allow_target_blank = fieldConfig.allow_target_blank !== false;
                field.allow_custom_attributes = fieldConfig.allow_custom_attributes || false;
                field.asset_link_type = fieldConfig.asset_link_type || false;
                break;

            case 'multilink':
                field.restrict_content_types = fieldConfig.restrict_content_types || false;
                field.component_whitelist = fieldConfig.component_whitelist || [];
                field.allow_target_blank = fieldConfig.allow_target_blank !== false;
                field.allow_custom_attributes = fieldConfig.allow_custom_attributes || false;
                field.email_link_type = fieldConfig.email_link_type || false;
                field.asset_link_type = fieldConfig.asset_link_type || false;
                break;

            case 'bloks':
                field.restrict_components = fieldConfig.restrict_components || false;
                field.restrict_type = fieldConfig.restrict_type || '';
                field.component_whitelist = fieldConfig.component_whitelist || [];
                field.maximum = fieldConfig.maximum || null;
                field.minimum = fieldConfig.minimum || null;
                break;

            case 'table':
                field.thead = fieldConfig.thead || [];
                break;

            case 'textarea':
                field.max_length = fieldConfig.max_length || null;
                break;

            case 'text':
                field.max_length = fieldConfig.max_length || null;
                field.regex = fieldConfig.regex || null;
                break;
        }

        // Handle datasource fields
        if (fieldConfig.datasource) {
            if (typeof fieldConfig.datasource === 'string') {
                // Reference to datasource by name
                field.datasource_slug = fieldConfig.datasource;
            } else if (fieldConfig.datasource.slug) {
                // Datasource configuration object
                field.datasource_slug = fieldConfig.datasource.slug;
                field.filter_content_type = fieldConfig.datasource.filter_content_type || [];
            }

            // Set field type if not explicitly set
            if (fieldConfig.type === 'option' && !field.options.length) {
                field.type = 'option';
                field.source = 'external';
            }
        }
    }

    /**
     * Auto-generate components from WordPress block schemas
     */
    async autoGenerateComponents(blockSchemas, wordpressData) {
        const components = [];
        const autoGenerateConfig = this.getConfig('components.autoGenerate', {});

        if (!blockSchemas || !blockSchemas.block_types) {
            return components;
        }

        for (const [blockName, blockSchema] of Object.entries(blockSchemas.block_types)) {
            // Skip blocks that shouldn't be auto-generated
            if (autoGenerateConfig.exclude?.includes(blockName)) {
                continue;
            }

            // Only generate for specific blocks if whitelist is defined
            if (autoGenerateConfig.include && !autoGenerateConfig.include.includes(blockName)) {
                continue;
            }

            const component = await this.generateComponentFromBlock(blockName, blockSchema, wordpressData);
            if (component) {
                components.push(component);
            }
        }

        return components;
    }

    /**
     * Generate a component from a WordPress block schema
     */
    async generateComponentFromBlock(blockName, blockSchema, wordpressData) {
        const componentName = this.blockNameToComponentName(blockName);

        const component = {
            name: componentName,
            display_name: blockSchema.title || this.humanizeName(componentName),
            schema: {},
            image: null,
            preview_field: null,
            is_root: false,
            is_nestable: true,
            all_presets: [],
            preset_id: null,
            real_name: componentName,
            component_group_uuid: null,
            color: null,
            icon: blockSchema.icon || null,
            internal_tags_list: [blockSchema.category || 'wordpress-blocks'],
            internal_tag_ids: [],
            content_type_asset_preview: null
        };

        // Generate fields from block attributes
        if (blockSchema.attributes) {
            let pos = 0;
            for (const [attrName, attrSchema] of Object.entries(blockSchema.attributes)) {
                const field = this.generateFieldFromBlockAttribute(attrName, attrSchema, pos++);
                if (field) {
                    component.schema[attrName] = field;
                }
            }
        }

        return component;
    }

    /**
     * Generate a field from a WordPress block attribute
     */
    generateFieldFromBlockAttribute(attrName, attrSchema, pos = 0) {
        const field = {
            type: this.mapBlockAttributeTypeToStoryblokType(attrSchema.type),
            pos: pos,
            display_name: this.humanizeName(attrName),
            required: false,
            description: '',
            default_value: attrSchema.default || this.getDefaultValueForType(this.mapBlockAttributeTypeToStoryblokType(attrSchema.type))
        };

        // Handle enum values as options
        if (attrSchema.enum) {
            field.type = 'option';
            field.options = attrSchema.enum.map(value => ({
                name: this.humanizeName(value.toString()),
                value: value.toString()
            }));
        }

        return field;
    }

    /**
     * Map WordPress block attribute type to Storyblok field type
     */
    mapBlockAttributeTypeToStoryblokType(blockType) {
        const typeMap = {
            string: 'text',
            boolean: 'boolean',
            number: 'number',
            integer: 'number',
            array: 'table',
            object: 'textarea'
        };

        return typeMap[blockType] || 'text';
    }

    /**
     * Convert WordPress block name to component name
     */
    blockNameToComponentName(blockName) {
        // Remove namespace prefix (e.g., 'core/' -> '')
        const withoutNamespace = blockName.replace(/^[^/]+\//, '');

        // Convert to camelCase
        return withoutNamespace
            .split('-')
            .map((word, index) => index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
            .join('');
    }

    /**
     * Get default value for Storyblok field type
     */
    getDefaultValueForType(type) {
        const defaults = {
            text: '',
            textarea: '',
            richtext: { type: 'doc', content: [] },
            markdown: '',
            number: null,
            datetime: '',
            boolean: false,
            option: '',
            options: [],
            asset: null,
            multiasset: [],
            link: { linktype: 'url' },
            multilink: [],
            email: '',
            bloks: [],
            table: { thead: [], tbody: [] },
            section: [],
            custom: null
        };

        return defaults[type] || null;
    }

    /**
     * Humanize a name (convert snake_case/kebab-case to Title Case)
     */
    humanizeName(name) {
        return name
            .replace(/[-_]/g, ' ')
            .replace(/\b\w/g, l => l.toUpperCase());
    }
}
