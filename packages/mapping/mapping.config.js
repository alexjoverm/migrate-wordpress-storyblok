import { defaultComponents } from './components.js';

/**
 * WordPress to Storyblok mapping configuration
 * Simplified configuration focusing on essential settings
 */
export default {
    // Input/Output structure - mirrors exported data organization
    input: {
        // Input structure: 'language_folders' (en/, es/), 'single_language', 'combined'
        structure: 'language_folders',
        baseDir: './exported-data'
    },

    output: {
        // Output structure - mirrors input structure
        structure: 'language_folders',  // Creates en/, es/ folders in output
        baseDir: './mapped-data',
        pretty: true,                   // Pretty-print JSON

        // Stories organization options
        stories: {
            format: 'separate',         // 'separate', 'combined'
            // separate: Individual JSON files matching story paths (e.g., /articles/my-article.json)
            // combined: Single stories.json file with all stories

            // Folder structure for separate files
            preservePath: true,         // Create folder structure based on story paths
            // true: /articles/my-article => articles/my-article.json
            // false: flat structure => my-article.json
        },

        // Folder organization - matches Storyblok CLI v4 structure
        folders: {
            stories: 'stories',         // Story files: ./mapped-data/stories/
            datasources: 'datasources', // Datasource files: ./mapped-data/datasources/
            assets: 'assets',           // Asset files and manifest: ./mapped-data/assets/
            components: 'components'    // Component schemas: ./mapped-data/components/
        }
    },

    // Internationalization - supports both field-level and folder-level strategies
    i18n: {
        strategy: 'field_level',        // 'field_level', 'folder_level'
        defaultLanguage: 'en',
        languages: ['en', 'es']
        // Note: 
        // - field_level: Separate files per language: posts.en.json, posts.es.json
        // - folder_level: Separate stories per language in language folders: en/posts.json, es/posts.json
    },

    // Richtext processing configuration
    richtext: {
        transformFrom: 'html',          // 'html', 'md' (markdown)
        extractExternalAssets: true,    // Extract external URLs from richtext content
        convertLinks: true,             // Convert URLs to Storyblok link objects
        convertAssets: true             // Convert asset URLs to Storyblok asset objects
    },

    // Asset processing - only external assets (WordPress media handled by export)
    assets: {
        outputDir: './mapped-data/assets/files',  // Asset files in subfolder
        manifestFile: './mapped-data/assets/assets-manifest.json',  // Manifest at assets root
        maxFileSize: 10 * 1024 * 1024,  // 10MB
        timeout: 30000                  // 30 seconds
    },

    // Content transformation
    content: {
        preserveSlugs: true             // Keep original WordPress slugs
    },

    // Component schemas
    components: defaultComponents,

    // Content type mapping (was postTypes)
    contentTypes: {
        post: {
            component: 'article',
            folder: 'articles',         // Storyblok folder path: /articles/
            fields: {
                title: 'post_title',
                content: {
                    source: 'post_content',
                    transformer: 'richtext'     // Transform HTML to richtext
                },
                excerpt: 'post_excerpt',
                slug: 'post_name',
                published_at: {
                    source: 'post_date',
                    transformer: 'datetime'     // Transform to ISO datetime
                },
                seo_title: 'meta.yoast_wpseo_title',
                seo_description: 'meta.yoast_wpseo_metadesc',
                featured_image: {
                    source: 'featured_media',
                    transformer: 'asset'        // Transform to Storyblok asset object
                },
                author: {
                    source: 'post_author',
                    transformer: 'reference',   // Transform to datasource reference
                    target: 'authors'
                },
                categories: {
                    source: 'categories',
                    transformer: 'references',  // Transform to multiple references
                    target: 'categories'
                },
                tags: {
                    source: 'post_tag',
                    transformer: 'tags',        // Transform to Storyblok tags array
                    target: 'tags'
                },
                custom_excerpt: {
                    source: 'post_excerpt',
                    transformer: (value, context) => {
                        // Function transformer example: custom processing
                        return value ? value.substring(0, 160) + '...' : '';
                    }
                }
            }
        },

        page: {
            component: 'page',
            folder: 'pages',            // Storyblok folder path: /pages/ 
            fields: {
                title: 'post_title',
                content: {
                    source: 'post_content',
                    transformer: 'richtext'
                },
                slug: 'post_name',
                published_at: {
                    source: 'post_date',
                    transformer: 'datetime'
                },
                featured_image: {
                    source: 'featured_media',
                    transformer: 'asset'
                },
                parent: {
                    source: 'post_parent',
                    transformer: 'reference',
                    target: 'pages'
                }
            }
        }
    },

    // Taxonomy mapping
    taxonomies: {
        category: {
            mapAs: 'datasource',
            name: 'categories'
        },
        post_tag: {
            mapAs: 'tag',
            name: 'tags'
        }
    },

    // Author mapping
    authors: {
        mapAs: 'datasource',            // Simple datasource approach
        name: 'authors'
    },

    // Field transformers - define how different data types are processed
    transformers: {
        richtext: {
            // Convert HTML/Markdown to Storyblok richtext
            from: ['html', 'md'],
            processor: 'richtext'
        },
        asset: {
            // Convert WordPress media ID or URL to Storyblok asset object
            from: ['media_id', 'url'],
            processor: 'asset'
        },
        reference: {
            // Convert ID to datasource reference
            from: ['id'],
            processor: 'reference'
        },
        references: {
            // Convert array of IDs to array of datasource references
            from: ['id_array', 'slug_array'],
            processor: 'references'
        },
        tags: {
            // Convert array of tag names/slugs to Storyblok tags format
            from: ['tag_array', 'slug_array'],
            processor: 'tags'
        },
        datetime: {
            // Convert various date formats to ISO datetime
            from: ['wordpress_date', 'timestamp', 'iso_date'],
            processor: 'datetime'
        },
        link: {
            // Convert URLs to Storyblok link objects
            from: ['url', 'wordpress_link'],
            processor: 'link'
        }
    }
};