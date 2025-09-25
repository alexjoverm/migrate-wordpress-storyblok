/**
 * Default Storyblok component schemas for WordPress content types
 * These can be customized or extended based on your specific needs
 */

export const defaultComponents = {
    // Article component for blog posts
    article: {
        display_name: 'Article',
        is_root: true,
        is_nestable: false,
        all_presets: [],
        preset_id: null,
        real_name: 'article',
        component_group_uuid: null,
        color: '#1b243f',
        icon: 'block-doc',
        internal_tags_list: [],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: {
            title: {
                type: 'text',
                pos: 0,
                translatable: true,
                required: true,
                display_name: 'Title',
                description: 'Article title'
            },
            content: {
                type: 'richtext',
                pos: 1,
                translatable: true,
                display_name: 'Content',
                description: 'Article content'
            },
            excerpt: {
                type: 'richtext',
                pos: 2,
                translatable: true,
                display_name: 'Excerpt',
                description: 'Article excerpt or summary'
            },
            featured_image: {
                type: 'asset',
                pos: 3,
                filetypes: ['images'],
                display_name: 'Featured Image',
                description: 'Main article image'
            },
            author: {
                type: 'option',
                pos: 4,
                source: 'internal_stories',
                folder_slug: 'authors',
                display_name: 'Author',
                description: 'Article author'
            },
            categories: {
                type: 'options',
                pos: 5,
                source: 'internal',
                datasource_slug: 'categories',
                display_name: 'Categories',
                description: 'Article categories'
            },
            tags: {
                type: 'text',
                pos: 6,
                translatable: true,
                display_name: 'Tags',
                description: 'Comma-separated list of tags'
            },
            published_date: {
                type: 'datetime',
                pos: 7,
                display_name: 'Published Date',
                description: 'When the article was published'
            },
            seo_title: {
                type: 'text',
                pos: 8,
                translatable: true,
                display_name: 'SEO Title',
                description: 'Title for search engines'
            },
            seo_description: {
                type: 'textarea',
                pos: 9,
                translatable: true,
                display_name: 'SEO Description',
                description: 'Description for search engines'
            }
        }
    },

    // Page component for static pages
    page: {
        display_name: 'Page',
        is_root: true,
        is_nestable: false,
        all_presets: [],
        preset_id: null,
        real_name: 'page',
        component_group_uuid: null,
        color: '#1b243f',
        icon: 'block-doc',
        internal_tags_list: [],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: {
            title: {
                type: 'text',
                pos: 0,
                translatable: true,
                required: true,
                display_name: 'Title',
                description: 'Page title'
            },
            content: {
                type: 'richtext',
                pos: 1,
                translatable: true,
                display_name: 'Content',
                description: 'Page content'
            },
            featured_image: {
                type: 'asset',
                pos: 2,
                filetypes: ['images'],
                display_name: 'Featured Image',
                description: 'Main page image'
            },
            seo_title: {
                type: 'text',
                pos: 3,
                translatable: true,
                display_name: 'SEO Title',
                description: 'Title for search engines'
            },
            seo_description: {
                type: 'textarea',
                pos: 4,
                translatable: true,
                display_name: 'SEO Description',
                description: 'Description for search engines'
            }
        }
    },

    // Author component for author profiles
    author: {
        display_name: 'Author',
        is_root: false,
        is_nestable: false,
        all_presets: [],
        preset_id: null,
        real_name: 'author',
        component_group_uuid: null,
        color: '#1b243f',
        icon: 'block-user',
        internal_tags_list: [],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: {
            name: {
                type: 'text',
                pos: 0,
                translatable: true,
                required: true,
                display_name: 'Name',
                description: 'Author full name'
            },
            slug: {
                type: 'text',
                pos: 1,
                required: true,
                display_name: 'Slug',
                description: 'Author URL slug'
            },
            bio: {
                type: 'richtext',
                pos: 2,
                translatable: true,
                display_name: 'Biography',
                description: 'Author biography'
            },
            avatar: {
                type: 'asset',
                pos: 3,
                filetypes: ['images'],
                display_name: 'Avatar',
                description: 'Author profile picture'
            },
            email: {
                type: 'text',
                pos: 4,
                display_name: 'Email',
                description: 'Author email address'
            },
            website: {
                type: 'text',
                pos: 5,
                display_name: 'Website',
                description: 'Author website URL'
            },
            social_links: {
                type: 'bloks',
                pos: 6,
                restrict_components: true,
                component_whitelist: ['social_link'],
                display_name: 'Social Links',
                description: 'Author social media links'
            }
        }
    },

    // Social link component (nested in author)
    social_link: {
        display_name: 'Social Link',
        is_root: false,
        is_nestable: true,
        all_presets: [],
        preset_id: null,
        real_name: 'social_link',
        component_group_uuid: null,
        color: '#1b243f',
        icon: 'block-link',
        internal_tags_list: [],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: {
            platform: {
                type: 'option',
                pos: 0,
                options: [
                    { name: 'Twitter', value: 'twitter' },
                    { name: 'Facebook', value: 'facebook' },
                    { name: 'LinkedIn', value: 'linkedin' },
                    { name: 'Instagram', value: 'instagram' },
                    { name: 'GitHub', value: 'github' },
                    { name: 'YouTube', value: 'youtube' }
                ],
                display_name: 'Platform',
                description: 'Social media platform'
            },
            url: {
                type: 'text',
                pos: 1,
                required: true,
                display_name: 'URL',
                description: 'Social media profile URL'
            }
        }
    }
};

/**
 * Generate component schemas for WordPress custom post types
 * @param {string} postType - WordPress post type slug
 * @param {object} config - Configuration options
 * @returns {object} Component schema
 */
export function generateCustomPostTypeComponent(postType, config = {}) {
    const displayName = config.displayName || postType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
        display_name: displayName,
        is_root: true,
        is_nestable: false,
        all_presets: [],
        preset_id: null,
        real_name: postType,
        component_group_uuid: null,
        color: config.color || '#1b243f',
        icon: config.icon || 'block-doc',
        internal_tags_list: [],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: {
            title: {
                type: 'text',
                pos: 0,
                translatable: true,
                required: true,
                display_name: 'Title',
                description: `${displayName} title`
            },
            content: {
                type: 'richtext',
                pos: 1,
                translatable: true,
                display_name: 'Content',
                description: `${displayName} content`
            },
            ...config.additionalFields || {}
        }
    };
}

/**
 * Generate component schemas for WordPress Gutenberg blocks
 * @param {object} blockData - WordPress block data
 * @returns {object} Component schema
 */
export function generateBlockComponent(blockData) {
    const blockName = blockData.name.replace('core/', '').replace('/', '_');
    const displayName = blockName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
        display_name: `WP ${displayName}`,
        is_root: false,
        is_nestable: true,
        all_presets: [],
        preset_id: null,
        real_name: `wp_${blockName}`,
        component_group_uuid: null,
        color: '#0073aa',
        icon: 'block-component',
        internal_tags_list: ['wordpress', 'block'],
        internal_tag_ids: [],
        content_type_asset_preview: null,
        schema: generateBlockSchema(blockData)
    };
}

/**
 * Generate schema fields for a WordPress block
 * @param {object} blockData - WordPress block data
 * @returns {object} Schema fields
 */
function generateBlockSchema(blockData) {
    const schema = {};

    // Add common fields
    schema.content = {
        type: 'richtext',
        pos: 0,
        translatable: true,
        display_name: 'Content',
        description: 'Block content'
    };

    // Add specific fields based on block type
    if (blockData.attributes) {
        let pos = 1;
        for (const [attrName, attrConfig] of Object.entries(blockData.attributes)) {
            schema[attrName] = generateFieldFromAttribute(attrName, attrConfig, pos++);
        }
    }

    return schema;
}

/**
 * Generate Storyblok field from WordPress block attribute
 * @param {string} name - Attribute name
 * @param {object} config - Attribute configuration
 * @param {number} pos - Field position
 * @returns {object} Storyblok field configuration
 */
function generateFieldFromAttribute(name, config, pos) {
    const field = {
        pos,
        display_name: name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: config.description || `Block ${name} attribute`
    };

    // Map WordPress attribute types to Storyblok field types
    switch (config.type) {
        case 'string':
            field.type = config.multiline ? 'textarea' : 'text';
            field.translatable = true;
            break;
        case 'number':
            field.type = 'number';
            break;
        case 'boolean':
            field.type = 'boolean';
            break;
        case 'array':
            field.type = 'textarea';
            field.description += ' (JSON array)';
            break;
        case 'object':
            field.type = 'textarea';
            field.description += ' (JSON object)';
            break;
        default:
            field.type = 'text';
            field.translatable = true;
    }

    return field;
}
