import fs from 'fs-extra';
import path from 'path';

/**
 * WordPress data loader that handles different export formats
 * Supports various data structures and file organizations
 */
export class WordPressDataLoader {
    constructor(config) {
        this.config = config;
        this.dataFormat = config.dataFormat || {};
    }

    /**
     * Load WordPress data from input directory based on configuration
     */
    async loadData(inputDir) {
        console.log('📥 Loading WordPress data...');
        console.log(`📁 Structure: ${this.dataFormat.structure || 'language_folders'}`);
        console.log(`📄 File format: ${this.dataFormat.fileStructure || 'combined'}`);

        const data = {
            posts: [],
            pages: [],
            media: [],
            users: [],
            taxonomies: [],
            block_schemas: []
        };

        // Load global data (non-language specific)
        await this.loadGlobalData(inputDir, data);

        // Load content based on structure type
        switch (this.dataFormat.structure) {
            case 'single_language':
                await this.loadSingleLanguageData(inputDir, data);
                break;
            case 'language_folders':
            default:
                await this.loadLanguageFoldersData(inputDir, data);
                break;
        }

        // Load custom post types
        if (this.dataFormat.customPostTypes) {
            await this.loadCustomPostTypes(inputDir, data);
        }

        return data;
    }

    /**
     * Load global data that isn't language-specific
     */
    async loadGlobalData(inputDir, data) {
        console.log('  Loading global data...');

        // Load media
        const mediaPath = path.join(inputDir, 'media.json');
        if (await fs.pathExists(mediaPath)) {
            data.media = await this.loadJsonFile(mediaPath);
            console.log(`    ✓ Loaded ${data.media.length} media items`);
        }

        // Load users
        const usersPath = path.join(inputDir, 'users.json');
        if (await fs.pathExists(usersPath)) {
            data.users = await this.loadJsonFile(usersPath);
            console.log(`    ✓ Loaded ${data.users.length} users`);
        }

        // Load block schemas
        const blockSchemasPath = path.join(inputDir, 'block_schemas.json');
        if (await fs.pathExists(blockSchemasPath)) {
            data.block_schemas = await this.loadJsonFile(blockSchemasPath);
            console.log(`    ✓ Loaded ${data.block_schemas.length} block schemas`);
        }
    }

    /**
     * Load data when all content is in root directory (no language folders)
     */
    async loadSingleLanguageData(inputDir, data) {
        console.log('  Loading single language data...');

        if (this.dataFormat.fileStructure === 'individual') {
            await this.loadIndividualFiles(inputDir, data);
        } else {
            await this.loadCombinedFiles(inputDir, data);
        }
    }

    /**
     * Load data from language-specific folders
     */
    async loadLanguageFoldersData(inputDir, data) {
        const languages = Object.keys(this.config.i18n?.languages || { en: {} });

        for (const lang of languages) {
            console.log(`  Loading ${lang} content...`);
            const langDir = path.join(inputDir, lang);

            if (await fs.pathExists(langDir)) {
                const langData = {
                    posts: [],
                    pages: [],
                    taxonomies: []
                };

                if (this.dataFormat.fileStructure === 'individual') {
                    await this.loadIndividualFiles(langDir, langData);
                } else {
                    await this.loadCombinedFiles(langDir, langData);
                }

                // Merge language-specific data with main data
                // Add language metadata to each item
                langData.posts.forEach(post => {
                    post._language = lang;
                    data.posts.push(post);
                });

                langData.pages.forEach(page => {
                    page._language = lang;
                    data.pages.push(page);
                });

                if (langData.taxonomies.length > 0) {
                    // Merge taxonomies (they might be language-specific)
                    langData.taxonomies.forEach(taxonomy => {
                        taxonomy._language = lang;
                        data.taxonomies.push(taxonomy);
                    });
                }

                console.log(`    ✓ ${lang}: ${langData.posts.length} posts, ${langData.pages.length} pages`);
            }
        }
    }

    /**
     * Load data from combined JSON files (posts.json, pages.json, etc.)
     */
    async loadCombinedFiles(dir, data) {
        const contentTypes = this.dataFormat.contentTypes || ['post', 'page'];

        for (const type of contentTypes) {
            const pluralType = type === 'post' ? 'posts' : type === 'page' ? 'pages' : `${type}s`;
            const filePath = path.join(dir, `${pluralType}.json`);

            if (await fs.pathExists(filePath)) {
                const items = await this.loadJsonFile(filePath);
                data[pluralType] = data[pluralType] || [];
                data[pluralType] = data[pluralType].concat(items);
            }
        }

        // Load taxonomies
        const taxonomiesPath = path.join(dir, 'taxonomies.json');
        if (await fs.pathExists(taxonomiesPath)) {
            const taxonomies = await this.loadJsonFile(taxonomiesPath);
            data.taxonomies = data.taxonomies || [];
            data.taxonomies = data.taxonomies.concat(taxonomies);
        }
    }

    /**
     * Load data from individual JSON files per post/page
     */
    async loadIndividualFiles(dir, data) {
        const contentTypes = this.dataFormat.contentTypes || ['post', 'page'];

        for (const type of contentTypes) {
            const pluralType = type === 'post' ? 'posts' : type === 'page' ? 'pages' : `${type}s`;
            const typeDir = path.join(dir, pluralType);

            if (await fs.pathExists(typeDir)) {
                const files = await fs.readdir(typeDir);
                const jsonFiles = files.filter(file => file.endsWith('.json'));

                data[pluralType] = data[pluralType] || [];

                for (const file of jsonFiles) {
                    const filePath = path.join(typeDir, file);
                    const item = await this.loadJsonFile(filePath);
                    data[pluralType].push(item);
                }

                console.log(`    ✓ Loaded ${jsonFiles.length} ${pluralType} files`);
            }
        }

        // Load taxonomies (usually still combined)
        const taxonomiesPath = path.join(dir, 'taxonomies.json');
        if (await fs.pathExists(taxonomiesPath)) {
            const taxonomies = await this.loadJsonFile(taxonomiesPath);
            data.taxonomies = data.taxonomies || [];
            data.taxonomies = data.taxonomies.concat(taxonomies);
        }
    }

    /**
     * Load custom post types
     */
    async loadCustomPostTypes(inputDir, data) {
        console.log('  Loading custom post types...');

        for (const [postType, config] of Object.entries(this.dataFormat.customPostTypes)) {
            const customData = {
                [postType]: []
            };

            // Try to load based on structure
            if (this.dataFormat.structure === 'language_folders') {
                const languages = Object.keys(this.config.i18n?.languages || { en: {} });

                for (const lang of languages) {
                    const langDir = path.join(inputDir, lang);
                    await this.loadCustomPostTypeFiles(langDir, postType, customData);
                }
            } else {
                await this.loadCustomPostTypeFiles(inputDir, postType, customData);
            }

            // Add to main data
            data[postType] = customData[postType];
            console.log(`    ✓ Loaded ${customData[postType].length} ${postType} items`);
        }
    }

    /**
     * Load files for a specific custom post type
     */
    async loadCustomPostTypeFiles(dir, postType, data) {
        if (this.dataFormat.fileStructure === 'individual') {
            const typeDir = path.join(dir, postType);
            if (await fs.pathExists(typeDir)) {
                const files = await fs.readdir(typeDir);
                const jsonFiles = files.filter(file => file.endsWith('.json'));

                for (const file of jsonFiles) {
                    const filePath = path.join(typeDir, file);
                    const item = await this.loadJsonFile(filePath);
                    data[postType].push(item);
                }
            }
        } else {
            const filePath = path.join(dir, `${postType}.json`);
            if (await fs.pathExists(filePath)) {
                const items = await this.loadJsonFile(filePath);
                data[postType] = data[postType].concat(items);
            }
        }
    }

    /**
     * Load JSON file with error handling
     */
    async loadJsonFile(filePath) {
        try {
            if (await fs.pathExists(filePath)) {
                return await fs.readJson(filePath);
            }
        } catch (error) {
            console.warn(`⚠️  Failed to load ${filePath}:`, error.message);
        }
        return [];
    }
}
