import { BaseMapper } from './BaseMapper.js';
import { FieldTransformer } from '../transformers/FieldTransformer.js';
import slugify from 'slugify';
import fs from 'fs-extra';
import path from 'path';

/**
 * Maps WordPress content to Storyblok stories with comprehensive configuration support
 * Supports story organization, i18n strategies, field transformers, and CLI v4 structure
 */
export class StoryMapper extends BaseMapper {
    constructor(config = {}) {
        super(config);
        this.existingSlugs = new Set();
        this.fieldTransformer = new FieldTransformer(config);

        // Configure i18n strategy
        this.i18nStrategy = config.i18n?.strategy || 'field_level';
        this.defaultLanguage = config.i18n?.defaultLanguage || 'en';
        this.languages = config.i18n?.languages || { en: { name: 'English', prefix: '', suffix: '' } };

        // Configure story organization
        this.storyFormat = config.stories?.format || 'separate';
        this.preservePath = config.stories?.preservePath !== false; // default true
        this.folderMapping = config.stories?.folderMapping || {};

        // Story storage
        this.storyData = {
            separate: new Map(), // language -> stories array
            combined: []         // all stories in single array
        };
    }

    /**
     * Map WordPress posts and pages to Storyblok stories
     */
    async mapStories(wordpressData, language = 'en') {
        const stories = [];
        const contentTypes = this.getConfig('contentTypes', {});

        // Run pre-mapping hooks
        await this.runHooks('beforeStoryMapping', wordpressData, { language });

        // Map authors first (if configured as stories)
        const authorsConfig = this.getConfig('authors', {});
        if (authorsConfig.mapAs === 'stories' && wordpressData.users) {
            const authorStories = await this.mapAuthors(wordpressData.users, wordpressData, language);
            stories.push(...authorStories);
        }

        // Map posts
        if (wordpressData.posts) {
            for (const post of wordpressData.posts) {
                const story = await this.mapPost(post, wordpressData, language);
                if (story) {
                    stories.push(story);
                }
            }
        }

        // Map pages
        if (wordpressData.pages) {
            for (const page of wordpressData.pages) {
                const story = await this.mapPage(page, wordpressData, language);
                if (story) {
                    stories.push(story);
                }
            }
        }

        // Map custom post types if configured
        for (const [postType, typeConfig] of Object.entries(contentTypes)) {
            if (wordpressData[postType]) {
                for (const item of wordpressData[postType]) {
                    const story = await this.mapCustomPostType(item, postType, typeConfig, wordpressData, language);
                    if (story) {
                        stories.push(story);
                    }
                }
            }
        }

        // Process stories for organization
        await this.organizeStories(stories, language);

        // Run post-mapping hooks
        const finalStories = await this.runHooks('afterStoryMapping', stories, { language });

        return finalStories;
    }

    /**
     * Organize stories based on configuration (separate vs combined format)
     */
    async organizeStories(stories, language) {
        if (this.storyFormat === 'separate') {
            // Store stories by language
            if (!this.storyData.separate.has(language)) {
                this.storyData.separate.set(language, []);
            }
            this.storyData.separate.get(language).push(...stories);
        } else {
            // Combined format - add all stories to single collection
            this.storyData.combined.push(...stories);
        }

        // Apply path preservation and folder mapping
        for (const story of stories) {
            this.applyPathConfiguration(story, language);
        }
    }

    /**
     * Apply path configuration based on preservePath and folderMapping settings
     */
    applyPathConfiguration(story, language) {
        // Get original WordPress path if available
        const wpPath = this.extractWordPressPath(story);

        // Apply folder mapping if configured
        let targetFolder = null;
        if (this.folderMapping && wpPath) {
            for (const [wpFolderPattern, storyblokFolder] of Object.entries(this.folderMapping)) {
                if (wpPath.includes(wpFolderPattern)) {
                    targetFolder = storyblokFolder;
                    break;
                }
            }
        }

        // Apply content type folder mapping
        const contentTypeFolder = this.getContentTypeFolder(story);
        if (contentTypeFolder && !targetFolder) {
            targetFolder = contentTypeFolder;
        }

        // Build final path
        if (this.preservePath && wpPath && !targetFolder) {
            // Preserve WordPress folder structure
            story.path = wpPath;
            story.full_slug = wpPath;
        } else if (targetFolder) {
            // Use mapped folder
            const slug = story.slug || slugify(story.name.toLowerCase());
            story.path = `${targetFolder}/${slug}`;
            story.full_slug = `${targetFolder}/${slug}`;
        }

        // Apply language prefix based on i18n strategy
        this.applyLanguagePrefix(story, language);
    }

    /**
     * Apply language prefix based on i18n strategy
     */
    applyLanguagePrefix(story, language) {
        const langConfig = this.languages[language];
        if (!langConfig) return;

        if (this.i18nStrategy === 'folder_level' && langConfig.prefix) {
            // folder_level: prefix the path with language folder
            const currentPath = story.path || story.slug;
            story.path = `${langConfig.prefix}/${currentPath}`;
            story.full_slug = `${langConfig.prefix}/${currentPath}`;
        }
        // field_level: language suffix handled in file naming (not in story path)
    }

    /**
     * Extract WordPress path from story metadata
     */
    extractWordPressPath(story) {
        // Try to get path from original content metadata
        if (story.meta_data?.wordpress_path) {
            return story.meta_data.wordpress_path;
        }

        // Fallback to slug-based path
        return story.slug;
    }

    /**
     * Get content type folder mapping
     */
    getContentTypeFolder(story) {
        const component = story.content?.component;
        if (!component) return null;

        const contentTypes = this.getConfig('contentTypes', {});
        for (const [contentType, config] of Object.entries(contentTypes)) {
            if (config.component === component && config.folder) {
                return config.folder;
            }
        }

        // Check default story configurations
        const storyConfigs = this.getConfig('stories', {});
        if (storyConfigs[component]?.folder) {
            return storyConfigs[component].folder;
        }

        return null;
    }

    /**
     * Save stories based on i18n strategy and format configuration
     */
    async saveStories(outputDir) {
        await fs.ensureDir(outputDir);

        if (this.i18nStrategy === 'field_level') {
            // field_level: language-suffixed files
            await this.saveFieldLevelStories(outputDir);
        } else {
            // folder_level: language subfolders
            await this.saveFolderLevelStories(outputDir);
        }
    }

    /**
     * Save stories with field-level i18n (language-suffixed files)
     */
    async saveFieldLevelStories(outputDir) {
        if (this.storyFormat === 'separate') {
            // Separate files per language with language suffix
            for (const [language, stories] of this.storyData.separate.entries()) {
                const langConfig = this.languages[language] || { suffix: `_${language}` };
                const suffix = langConfig.suffix || (language === this.defaultLanguage ? '' : `_${language}`);
                const filename = `stories${suffix}.json`;
                const filePath = path.join(outputDir, filename);

                await fs.writeJSON(filePath, stories, { spaces: 2 });
                console.log(`  ✓ Saved ${stories.length} stories to ${filename}`);
            }
        } else {
            // Combined format - single file with all languages
            const filename = 'stories.json';
            const filePath = path.join(outputDir, filename);

            await fs.writeJSON(filePath, this.storyData.combined, { spaces: 2 });
            console.log(`  ✓ Saved ${this.storyData.combined.length} combined stories to ${filename}`);
        }
    }

    /**
     * Save stories with folder-level i18n (language subfolders)
     */
    async saveFolderLevelStories(outputDir) {
        if (this.storyFormat === 'separate') {
            // Language subfolders with separate files
            for (const [language, stories] of this.storyData.separate.entries()) {
                const langConfig = this.languages[language];
                const folderName = langConfig?.prefix || language;
                const langDir = path.join(outputDir, folderName);

                await fs.ensureDir(langDir);

                const filename = 'stories.json';
                const filePath = path.join(langDir, filename);

                await fs.writeJSON(filePath, stories, { spaces: 2 });
                console.log(`  ✓ Saved ${stories.length} stories to ${folderName}/${filename}`);
            }
        } else {
            // Combined format with language folders - organize by language in subfolders
            const storiesByLanguage = new Map();

            // Group combined stories by language
            for (const story of this.storyData.combined) {
                const language = story.lang || this.defaultLanguage;
                if (!storiesByLanguage.has(language)) {
                    storiesByLanguage.set(language, []);
                }
                storiesByLanguage.get(language).push(story);
            }

            // Save to language subfolders
            for (const [language, stories] of storiesByLanguage.entries()) {
                const langConfig = this.languages[language];
                const folderName = langConfig?.prefix || language;
                const langDir = path.join(outputDir, folderName);

                await fs.ensureDir(langDir);

                const filename = 'stories.json';
                const filePath = path.join(langDir, filename);

                await fs.writeJSON(filePath, stories, { spaces: 2 });
                console.log(`  ✓ Saved ${stories.length} combined stories to ${folderName}/${filename}`);
            }
        }
    }

    /**
     * Map a WordPress post to a Storyblok story
     */
    async mapPost(post, wordpressData, language) {
        const contentTypeConfig = this.getConfig('contentTypes.articles', {}) || this.getConfig('stories.post', {});
        const component = contentTypeConfig.component || 'article';

        // Generate unique slug
        const slug = this.generateUniqueSlug(post.slug || slugify(post.title.rendered));

        // Build base story structure
        let story = {
            name: post.title.rendered,
            slug: slug,
            content: {
                component: component,
                _uid: this.generateUID(),
            },
            published_at: post.date,
            created_at: post.date,
            lang: language,
            is_startpage: false,
            parent_id: null,
            group_id: null,
            alternates: [],
            translated_slugs: [],

            // Add WordPress metadata for path extraction
            meta_data: {
                wordpress_path: post.link ? new URL(post.link).pathname : null,
                wordpress_id: post.id,
                wordpress_type: 'post'
            }
        };

        // Map content fields using field transformer system
        story.content = await this.mapContentFields(post, story.content, 'articles', wordpressData, language);

        // Apply post-specific transformers
        story = await this.applyTransformer('story.post', story, {
            wordpressData,
            language,
            originalPost: post
        });

        // Run post mapping hooks
        story = await this.runHooks('afterPostMapping', story, {
            wordpressData,
            language,
            originalPost: post
        });

        return story;
    }

    /**
     * Map a WordPress page to a Storyblok story
     */
    async mapPage(page, wordpressData, language) {
        const contentTypeConfig = this.getConfig('contentTypes.pages', {}) || this.getConfig('stories.page', {});
        const component = contentTypeConfig.component || 'page';

        // Generate unique slug
        const slug = this.generateUniqueSlug(page.slug || slugify(page.title.rendered));

        // Build base story structure
        let story = {
            name: page.title.rendered,
            slug: slug,
            content: {
                component: component,
                _uid: this.generateUID(),
            },
            published_at: page.date,
            created_at: page.date,
            lang: language,
            is_startpage: slug === 'home' || page.slug === 'home',
            parent_id: page.parent || null,
            group_id: null,
            alternates: [],
            translated_slugs: [],

            // Add WordPress metadata for path extraction
            meta_data: {
                wordpress_path: page.link ? new URL(page.link).pathname : null,
                wordpress_id: page.id,
                wordpress_type: 'page'
            }
        };

        // Map content fields using field transformer system
        story.content = await this.mapContentFields(page, story.content, 'pages', wordpressData, language);

        // Apply page-specific transformers
        story = await this.applyTransformer('story.page', story, {
            wordpressData,
            language,
            originalPage: page
        });

        // Run page mapping hooks
        story = await this.runHooks('afterPageMapping', story, {
            wordpressData,
            language,
            originalPage: page
        });

        return story;
    }

    /**
     * Map a custom post type to a Storyblok story
     */
    async mapCustomPostType(item, postType, typeConfig, wordpressData, language) {
        const component = typeConfig.component || postType;

        // Generate unique slug
        const slug = this.generateUniqueSlug(item.slug || slugify(item.title?.rendered || item.name || `${postType}-${item.id}`));

        // Build base story structure
        let story = {
            name: item.title?.rendered || item.name || `${postType} ${item.id}`,
            slug: slug,
            content: {
                component: component,
                _uid: this.generateUID(),
            },
            published_at: item.date || new Date().toISOString(),
            created_at: item.date || new Date().toISOString(),
            lang: language,
            is_startpage: false,
            parent_id: item.parent || null,
            group_id: null,
            alternates: [],
            translated_slugs: [],

            // Add WordPress metadata for path extraction
            meta_data: {
                wordpress_path: item.link ? new URL(item.link).pathname : null,
                wordpress_id: item.id,
                wordpress_type: postType
            }
        };

        // Map content fields using field transformer system
        story.content = await this.mapContentFields(item, story.content, postType, wordpressData, language);

        // Apply custom post type transformers
        story = await this.applyTransformer(`story.${postType}`, story, {
            wordpressData,
            language,
            originalItem: item,
            postType
        });

        // Run custom post type mapping hooks
        story = await this.runHooks(`after${postType}Mapping`, story, {
            wordpressData,
            language,
            originalItem: item,
            postType
        });

        return story;
    }

    /**
     * Map content fields based on contentType configuration and field transformers
     */
    async mapContentFields(wpContent, storyblokContent, contentType, wordpressData, language) {
        // Get content type configuration
        const contentTypeConfig = this.getConfig(`contentTypes.${contentType}`, {});
        const fieldsConfig = contentTypeConfig.fields || {};

        // Create transformation context
        const context = {
            post: wpContent,
            wordpressData,
            language,
            contentType,
            originalContent: wpContent
        };

        // Apply default field mappings with transformers
        const defaultMappings = {
            title: { source: 'title.rendered', fallback: wpContent.title || wpContent.name },
            content: { source: 'content.rendered', transformer: 'richtext' },
            excerpt: { source: 'excerpt.rendered', transformer: 'string' },
            date: { source: 'date', transformer: 'datetime' },
            modified: { source: 'modified', transformer: 'datetime' },
            author: { source: 'author', transformer: 'reference' },
            featured_media: { source: 'featured_media', transformer: 'asset' },
            categories: { source: 'categories', transformer: 'references' },
            tags: { source: 'tags', transformer: 'tags' }
        };

        // Apply default mappings
        for (const [storyblokField, mapping] of Object.entries(defaultMappings)) {
            if (!fieldsConfig[storyblokField]) { // Only if not overridden by config
                const value = this.extractValue(wpContent, mapping.source, mapping.fallback);
                if (mapping.transformer) {
                    storyblokContent[storyblokField] = await this.fieldTransformer.transform(
                        value,
                        mapping.transformer,
                        context
                    );
                } else {
                    storyblokContent[storyblokField] = value;
                }
            }
        }

        // Apply configured field mappings
        for (const [storyblokField, fieldConfig] of Object.entries(fieldsConfig)) {
            try {
                let value;

                if (typeof fieldConfig === 'string') {
                    // Simple transformer: "richtext", "asset", etc.
                    const sourceValue = this.extractValue(wpContent, storyblokField); // try same field name first
                    value = await this.fieldTransformer.transform(sourceValue, fieldConfig, context);

                } else if (typeof fieldConfig === 'function') {
                    // Function transformer
                    value = await fieldConfig(wpContent, wordpressData, language);

                } else if (typeof fieldConfig === 'object') {
                    // Object configuration
                    const {
                        source,
                        transformer,
                        default: defaultValue,
                        condition,
                        options = {}
                    } = fieldConfig;

                    // Check condition if present
                    if (condition && !condition(wpContent, wordpressData, language)) {
                        value = defaultValue;
                    } else {
                        // Extract source value
                        const sourceValue = source ? this.extractValue(wpContent, source) : wpContent;

                        // Apply transformer
                        if (transformer) {
                            value = await this.fieldTransformer.transform(sourceValue, transformer, {
                                ...context,
                                options
                            });
                        } else {
                            value = sourceValue;
                        }

                        // Use default if value is null/undefined
                        if (value === null || value === undefined) {
                            value = defaultValue;
                        }
                    }
                } else {
                    // Direct value assignment
                    value = fieldConfig;
                }

                storyblokContent[storyblokField] = value;

            } catch (error) {
                console.error(`Error mapping field ${storyblokField} for ${contentType}:`, error);
                // Set to null on error to maintain field structure
                storyblokContent[storyblokField] = null;
            }
        }

        // Apply meta fields and custom fields
        if (wpContent.acf) {
            storyblokContent.custom_fields = wpContent.acf;
        } else if (wpContent.meta && typeof wpContent.meta === 'object') {
            storyblokContent.custom_fields = wpContent.meta;
        }

        // Run content transformation hooks
        storyblokContent = await this.runHooks('afterContentMapping', storyblokContent, {
            ...context,
            contentType
        });

        return storyblokContent;
    }

    /**
     * Extract value from source object using dot notation or direct property access
     * @param {object} source - Source object
     * @param {string} path - Property path (supports dot notation)
     * @param {any} fallback - Fallback value
     * @returns {any} Extracted value
     */
    extractValue(source, path, fallback = null) {
        if (!source || !path) {
            return fallback;
        }

        // Handle dot notation (e.g., 'title.rendered')
        const keys = path.split('.');
        let value = source;

        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return fallback;
            }
        }

        return value !== undefined && value !== null ? value : fallback;
    }

    /**
     * Map WordPress authors to Storyblok stories
     */
    async mapAuthors(users, wordpressData, language) {
        const authorsConfig = this.getConfig('authors', {});
        const stories = [];

        if (!authorsConfig.stories) {
            console.warn('Authors configured as stories but no story configuration provided');
            return stories;
        }

        const { component, folder } = authorsConfig.stories;
        const fieldsConfig = authorsConfig.fields || {};

        console.log(`  Mapping ${users.length} authors as ${component} stories...`);

        for (const user of users) {
            try {
                const slug = this.generateUniqueSlug(user.slug || slugify(user.name, { lower: true }));

                // Create base story structure
                let story = {
                    name: user.name || user.display_name,
                    slug: slug,
                    content: {
                        component: component,
                        _uid: this.generateUID(),
                    },
                    published_at: user.registered || new Date().toISOString(),
                    created_at: user.registered || new Date().toISOString(),
                    lang: language,
                    is_startpage: false,
                    parent_id: null,
                    group_id: null,
                    alternates: [],
                    translated_slugs: [],

                    // Add WordPress metadata
                    meta_data: {
                        wordpress_path: folder ? `${folder}/${slug}` : slug,
                        wordpress_id: user.id,
                        wordpress_type: 'user'
                    }
                };

                // Map content fields using field transformer system  
                story.content = await this.mapContentFields(user, story.content, 'authors', wordpressData, language);

                // Apply author-specific transformers
                story = await this.applyTransformer('story.author', story, {
                    originalContent: user,
                    wordpressData,
                    language
                });

                // Run hooks
                const finalStory = await this.runHooks('afterAuthorMapping', story, {
                    originalContent: user,
                    language
                });

                stories.push(finalStory);

            } catch (error) {
                console.error(`Failed to map author ${user.name}:`, error);
                if (!this.getConfig('advanced.errorHandling.continueOnError', true)) {
                    throw error;
                }
            }
        }

        return stories;
    }

    /**
     * Generate a unique slug
     */
    generateUniqueSlug(baseSlug) {
        const slug = this.generateSlug(baseSlug, this.existingSlugs);
        this.existingSlugs.add(slug);
        return slug;
    }

    /**
     * Generate a unique ID for Storyblok components
     */
    generateUID() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Generate slug with collision handling
     */
    generateSlug(text, existingSlugs = new Set()) {
        if (!text) {
            return `story-${Date.now()}`;
        }

        let baseSlug = slugify(text.toLowerCase(), {
            remove: /[*+~.()'"!:@]/g,
            lower: true,
            strict: true
        });

        // Ensure slug is valid (not empty, doesn't start with number)
        if (!baseSlug || /^\d/.test(baseSlug)) {
            baseSlug = `story-${baseSlug || Date.now()}`;
        }

        let slug = baseSlug;
        let counter = 1;

        while (existingSlugs.has(slug)) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        return slug;
    }

    /**
     * Get summary of mapped stories
     */
    getSummary() {
        const summary = {
            format: this.storyFormat,
            i18nStrategy: this.i18nStrategy,
            totalStories: 0,
            storiesByLanguage: {},
            storiesByContentType: {},
            organization: {
                preservePath: this.preservePath,
                folderMappings: Object.keys(this.folderMapping).length
            }
        };

        if (this.storyFormat === 'separate') {
            for (const [language, stories] of this.storyData.separate.entries()) {
                summary.storiesByLanguage[language] = stories.length;
                summary.totalStories += stories.length;

                // Count by content type
                for (const story of stories) {
                    const contentType = story.content?.component || 'unknown';
                    summary.storiesByContentType[contentType] = (summary.storiesByContentType[contentType] || 0) + 1;
                }
            }
        } else {
            summary.totalStories = this.storyData.combined.length;

            // Count by language and content type
            for (const story of this.storyData.combined) {
                const language = story.lang || this.defaultLanguage;
                const contentType = story.content?.component || 'unknown';

                summary.storiesByLanguage[language] = (summary.storiesByLanguage[language] || 0) + 1;
                summary.storiesByContentType[contentType] = (summary.storiesByContentType[contentType] || 0) + 1;
            }
        }

        return summary;
    }
}
