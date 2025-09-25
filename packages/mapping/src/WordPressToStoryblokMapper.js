import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { ConfigurationLoader } from './config/ConfigurationLoader.js';
import { WordPressDataLoader } from './core/WordPressDataLoader.js';
import { StoryMapper } from './core/StoryMapper.js';
import { AssetMapper } from './core/AssetMapper.js';
import { DatasourceMapper } from './core/DatasourceMapper.js';
import { ComponentMapper } from './core/ComponentMapper.js';
import { HtmlToRichtextTransformer } from './transformers/HtmlToRichtextTransformer.js';
import { LinkTransformer } from './transformers/LinkTransformer.js';
import { AssetTransformer } from './transformers/AssetTransformer.js';
import { FieldTransformer } from './transformers/FieldTransformer.js';
import { AssetExtractor } from './extractors/AssetExtractor.js';
import { defaultComponents } from '../components.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main WordPress to Storyblok mapping orchestrator
 * Coordinates all mappers and transformers based on comprehensive configuration
 */
export class WordPressToStoryblokMapper {
    constructor(configPath, options = {}) {
        this.configPath = configPath;
        this.options = options;
        this.config = null;

        // Initialize mappers
        this.storyMapper = null;
        this.assetMapper = null;
        this.datasourceMapper = null;
        this.componentMapper = null;

        // Initialize transformers
        this.htmlTransformer = null;
        this.linkTransformer = null;
        this.assetTransformer = null;
        this.fieldTransformer = null;

        // Initialize asset extractor
        this.assetExtractor = null;

        // Data storage
        this.wordpressData = {};
        this.mappedData = {
            stories: [],
            assets: [],
            datasources: [],
            components: []
        };

        // Processing stats
        this.stats = {
            startTime: null,
            endTime: null,
            totalProcessed: 0,
            errors: [],
            warnings: []
        };
    }

    /**
     * Initialize the mapper with configuration
     */
    async initialize() {
        console.log('🔧 Initializing WordPress to Storyblok mapper...');
        this.stats.startTime = Date.now();

        // Load configuration
        const configLoader = new ConfigurationLoader();
        this.config = await configLoader.load(this.configPath);

        // Log configuration summary
        this.logConfigurationSummary();

        // Initialize data loader
        this.dataLoader = new WordPressDataLoader(this.config);

        // Initialize mappers with configuration
        this.storyMapper = new StoryMapper(this.config);
        this.assetMapper = new AssetMapper(this.config);
        this.datasourceMapper = new DatasourceMapper(this.config);
        this.componentMapper = new ComponentMapper(this.config);

        // Initialize transformers
        this.htmlTransformer = new HtmlToRichtextTransformer(this.config);
        this.linkTransformer = new LinkTransformer(this.config);
        this.assetTransformer = new AssetTransformer(this.config);
        this.fieldTransformer = new FieldTransformer(this.config);

        // Initialize asset extractor for external assets
        this.assetExtractor = new AssetExtractor({
            ...this.config.assets,
            outputDir: this.config.assets?.downloadPath || './mapped-data/assets'
        });

        // Load existing asset manifest if available
        await this.assetExtractor.loadExistingManifest();

        // Register built-in transformers
        this.registerBuiltInTransformers();

        // Register custom transformers and hooks from configuration
        this.registerCustomTransformers();
        this.registerConfigurationHooks();

        console.log('✅ Mapper initialized successfully');
    }

    /**
     * Log configuration summary
     */
    logConfigurationSummary() {
        const i18n = this.config.i18n || {};
        const stories = this.config.stories || {};
        const contentTypes = Object.keys(this.config.contentTypes || {});

        console.log('📋 Configuration Summary:');
        console.log(`   🌐 i18n Strategy: ${i18n.strategy || 'field_level'}`);
        console.log(`   📖 Story Format: ${stories.format || 'separate'}`);
        console.log(`   📁 Preserve Path: ${stories.preservePath !== false ? 'enabled' : 'disabled'}`);
        console.log(`   📋 Content Types: ${contentTypes.length > 0 ? contentTypes.join(', ') : 'none configured'}`);
        console.log(`   🔧 Transformers: ${Object.keys(this.config.transformers || {}).join(', ') || 'defaults only'}`);
    }

    /**
     * Load WordPress data from exported files
     */
    async loadWordPressData(inputDir) {
        console.log('📥 Loading WordPress data...');

        // Use the flexible data loader
        this.wordpressData = await this.dataLoader.loadData(inputDir);

        console.log(`✅ Loaded WordPress data:`);
        console.log(`   📝 ${this.wordpressData.posts?.length || 0} posts`);
        console.log(`   📄 ${this.wordpressData.pages?.length || 0} pages`);
        console.log(`   🖼️  ${this.wordpressData.media?.length || 0} media items`);
        console.log(`   👥 ${this.wordpressData.users?.length || 0} users`);
        console.log(`   🏷️  ${this.wordpressData.taxonomies?.length || 0} taxonomy items`);

        // Log custom post types and languages
        const contentTypes = Object.keys(this.config.contentTypes || {});
        for (const contentType of contentTypes) {
            const languages = Object.keys(this.wordpressData);
            let totalCount = 0;

            for (const lang of languages) {
                const count = this.wordpressData[lang]?.[contentType]?.length || 0;
                totalCount += count;
                if (count > 0) {
                    console.log(`   📋 ${count} ${contentType} items (${lang})`);
                }
            }

            if (totalCount === 0) {
                const globalCount = this.wordpressData[contentType]?.length || 0;
                if (globalCount > 0) {
                    console.log(`   📋 ${globalCount} ${contentType} items`);
                }
            }
        }

        // Log languages found
        const languages = this.extractLanguages();
        if (languages.length > 1) {
            console.log(`   🌐 Languages found: ${languages.join(', ')}`);
        }

        return this.wordpressData;
    }

    /**
     * Extract available languages from loaded data
     */
    extractLanguages() {
        const configuredLanguages = Object.keys(this.config.i18n?.languages || { en: {} });
        const dataLanguages = Object.keys(this.wordpressData).filter(key =>
            this.wordpressData[key] &&
            typeof this.wordpressData[key] === 'object' &&
            (this.wordpressData[key].posts || this.wordpressData[key].pages)
        );

        // Combine and deduplicate
        const allLanguages = [...new Set([...configuredLanguages, ...dataLanguages])];
        return allLanguages.length > 0 ? allLanguages : ['en'];
    }

    /**
     * Perform the complete mapping process
     */
    async mapAll(inputDir, outputDir) {
        if (!this.config) {
            await this.initialize();
        }

        await this.loadWordPressData(inputDir);

        // Create CLI v4 compatible output structure
        const outputStructure = await this.createOutputStructure(outputDir);

        console.log('🔄 Starting mapping process...');

        try {
            // Map components first (needed for validation)
            await this.mapComponents(outputStructure.components);

            // Map assets (needed for story mapping)
            await this.mapAssets(outputStructure.assets);

            // Map datasources (needed for story mapping)
            await this.mapDatasources(outputStructure.datasources);

            // Map stories with new organization system
            await this.mapStoriesWithOrganization(outputStructure.stories);

            // Save external assets manifest
            await this.assetExtractor.saveManifest();

            // Generate comprehensive summary
            await this.generateMappingSummary(outputDir);

            this.stats.endTime = Date.now();
            console.log('✅ Mapping completed successfully!');
            this.logCompletionStats();

        } catch (error) {
            console.error('❌ Mapping failed:', error);
            this.stats.errors.push(error);
            throw error;
        }
    }

    /**
     * Create CLI v4 compatible output directory structure
     */
    async createOutputStructure(outputDir) {
        await fs.ensureDir(outputDir);

        // Determine space folder structure
        const spaceConfig = this.config.space || {};
        const spaceName = spaceConfig.name;

        let structure = {
            root: outputDir,
            stories: outputDir,
            assets: outputDir,
            components: outputDir,
            datasources: outputDir
        };

        // Create space-specific folder for datasources if configured
        if (spaceConfig.datasources?.folder && spaceName) {
            const spaceFolder = path.join(outputDir, spaceName);
            await fs.ensureDir(spaceFolder);
            structure.datasources = spaceFolder;
        }

        // Ensure all directories exist
        for (const dir of Object.values(structure)) {
            await fs.ensureDir(dir);
        }

        console.log('📁 Output structure created:');
        console.log(`   📖 Stories: ${path.relative(outputDir, structure.stories)}`);
        console.log(`   🖼️  Assets: ${path.relative(outputDir, structure.assets)}`);
        console.log(`   🧩 Components: ${path.relative(outputDir, structure.components)}`);
        console.log(`   🗂️  Datasources: ${path.relative(outputDir, structure.datasources)}`);

        return structure;
    }

    /**
     * Map stories with new organization system
     */
    async mapStoriesWithOrganization(storiesDir) {
        console.log('📖 Mapping stories with organization...');

        const languages = this.extractLanguages();

        for (const language of languages) {
            const langData = this.wordpressData[language] || this.wordpressData;

            if (Object.keys(langData).length === 0) {
                console.log(`  ⚠️  No data found for language: ${language}`);
                continue;
            }

            const stories = await this.storyMapper.mapStories(langData, language);
            console.log(`  ✓ Mapped ${stories.length} stories for ${language}`);
        }

        // Save stories using the new organization system
        await this.storyMapper.saveStories(storiesDir);

        // Get summary for main mapping data
        const summary = this.storyMapper.getSummary();
        this.mappedData.stories = summary;
    }

    /**
     * Log completion statistics
     */
    logCompletionStats() {
        const duration = this.stats.endTime - this.stats.startTime;
        const minutes = Math.floor(duration / 60000);
        const seconds = Math.floor((duration % 60000) / 1000);

        console.log('\n📊 Mapping Statistics:');
        console.log(`   ⏱️  Duration: ${minutes}m ${seconds}s`);
        console.log(`   📖 Stories: ${this.mappedData.stories.totalStories || 0}`);
        console.log(`   🖼️  Assets: ${this.mappedData.assets?.length || 0}`);
        console.log(`   🗂️  Datasources: ${this.mappedData.datasources?.length || 0}`);
        console.log(`   🧩 Components: ${this.mappedData.components?.length || 0}`);

        if (this.stats.warnings.length > 0) {
            console.log(`   ⚠️  Warnings: ${this.stats.warnings.length}`);
        }

        if (this.stats.errors.length > 0) {
            console.log(`   ❌ Errors: ${this.stats.errors.length}`);
        }
    }

    /**
     * Map WordPress media to Storyblok assets
     */
    async mapAssets(outputDir) {
        console.log('🖼️  Mapping assets...');

        const assets = await this.assetMapper.mapAssets(this.wordpressData);

        this.mappedData.assets = assets;
        await this.saveToFile(path.join(outputDir, 'assets.json'), assets);

        console.log(`  ✓ Mapped ${assets.length} WordPress media assets`);

        // Log external assets summary
        const externalSummary = this.assetExtractor.getSummary();
        if (externalSummary.totalAssets > 0) {
            console.log(`  ✓ Extracted ${externalSummary.totalAssets} external assets`);
            console.log(`    📁 Asset types: ${Object.keys(externalSummary.assetsByType).join(', ')}`);
        }
    }

    /**
     * Map WordPress taxonomies to Storyblok datasources
     */
    async mapDatasources(outputDir) {
        console.log('�️  Mapping datasources...');

        const allDatasources = [];
        const languages = this.extractLanguages();
        const spaceConfig = this.config.space || {};

        for (const language of languages) {
            const langData = this.wordpressData[language] || this.wordpressData;
            const datasources = await this.datasourceMapper.mapDatasources(langData, language);

            if (datasources.length > 0) {
                allDatasources.push(...datasources);
                console.log(`  ✓ Mapped ${datasources.length} datasources for ${language}`);
            }
        }

        this.mappedData.datasources = allDatasources;

        // Save datasources based on format configuration
        if (spaceConfig.datasources?.format === 'combined') {
            // Single file with all datasources
            await this.saveToFile(path.join(outputDir, 'datasources.json'), allDatasources);
        } else {
            // Separate files by language (default)
            const datasourcesByLanguage = new Map();

            for (const datasource of allDatasources) {
                const language = datasource.lang || 'en';
                if (!datasourcesByLanguage.has(language)) {
                    datasourcesByLanguage.set(language, []);
                }
                datasourcesByLanguage.get(language).push(datasource);
            }

            for (const [language, datasources] of datasourcesByLanguage.entries()) {
                const langConfig = this.config.i18n?.languages?.[language];
                const suffix = langConfig?.suffix || (language === 'en' ? '' : `_${language}`);
                const filename = `datasources${suffix}.json`;

                await this.saveToFile(path.join(outputDir, filename), datasources);
            }
        }

        console.log(`  ✓ Total datasources mapped: ${allDatasources.length}`);
    }

    /**
     * Generate Storyblok component schemas
     */
    async mapComponents(outputDir) {
        console.log('🧱 Generating component schemas...');

        const blockSchemas = this.wordpressData.block_schemas;
        const components = await this.componentMapper.mapComponents(this.wordpressData, blockSchemas);

        this.mappedData.components = components;
        await this.saveToFile(path.join(outputDir, 'components.json'), components);

        console.log(`  ✓ Generated ${components.length} component schemas`);
    }

    /**
     * Register built-in transformers
     */
    registerBuiltInTransformers() {
        // HTML to richtext transformer
        this.storyMapper.addTransformer('html_to_richtext', async (html, context) => {
            return await this.htmlTransformer.transform(html, {
                ...context,
                assetMapper: this.assetMapper,
                config: this.config
            });
        });

        // Media ID to asset transformer
        this.storyMapper.addTransformer('media_id_to_asset', async (mediaId, context) => {
            return await this.assetTransformer.transformFeaturedImage(
                mediaId,
                context.wordpressData || this.wordpressData,
                context
            );
        });

        // Attachment IDs to assets transformer
        this.storyMapper.addTransformer('attachment_ids_to_assets', async (attachmentIds, context) => {
            return await this.assetTransformer.transformGallery(
                attachmentIds,
                context.wordpressData || this.wordpressData,
                context
            );
        });

        // Author ID to name transformer
        this.storyMapper.addTransformer('author_id_to_name', (authorId, context) => {
            const users = context.wordpressData?.users || this.wordpressData.users || [];
            const user = users.find(u => u.id === authorId);
            return user?.name || user?.display_name || '';
        });

        // Category IDs to names transformer
        this.storyMapper.addTransformer('category_ids_to_names', (categoryIds, context) => {
            const categories = context.wordpressData?.categories || [];
            return categoryIds.map(id => {
                const category = categories.find(c => c.id === id);
                return category?.name || '';
            }).filter(Boolean);
        });

        // Tag IDs to names transformer
        this.storyMapper.addTransformer('tag_ids_to_names', (tagIds, context) => {
            const tags = context.wordpressData?.tags || [];
            return tagIds.map(id => {
                const tag = tags.find(t => t.id === id);
                return tag?.name || '';
            }).filter(Boolean);
        });
    }

    /**
     * Register custom transformers from configuration
     */
    registerCustomTransformers() {
        // Register custom transformers defined in configuration
        // This would be extended based on specific requirements
    }

    /**
     * Register hooks from configuration
     */
    registerConfigurationHooks() {
        const hooks = this.config.hooks || {};

        for (const [event, handlers] of Object.entries(hooks)) {
            if (Array.isArray(handlers)) {
                for (const handler of handlers) {
                    this.storyMapper.addHook(event, handler);
                    this.assetMapper.addHook(event, handler);
                    this.datasourceMapper.addHook(event, handler);
                    this.componentMapper.addHook(event, handler);
                }
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
            console.warn(`⚠️  Could not load ${filePath}:`, error.message);
        }

        return [];
    }

    /**
     * Save data to file
     */
    async saveToFile(filePath, data) {
        await fs.writeJson(filePath, data, { spaces: 2 });
        const itemCount = Array.isArray(data) ? data.length : Object.keys(data).length;
        console.log(`  ✓ Saved ${itemCount} items to ${path.basename(filePath)}`);
    }

    /**
     * Generate comprehensive mapping summary
     */
    async generateMappingSummary(outputDir) {
        console.log('📄 Generating mapping summary...');

        const summary = {
            generatedAt: new Date().toISOString(),
            duration: this.stats.endTime ? this.stats.endTime - this.stats.startTime : null,
            configuration: {
                i18nStrategy: this.config.i18n?.strategy || 'field_level',
                storyFormat: this.config.stories?.format || 'separate',
                preservePath: this.config.stories?.preservePath !== false,
                contentTypes: Object.keys(this.config.contentTypes || {}),
                languages: Object.keys(this.config.i18n?.languages || { en: {} })
            },
            mapping: {
                stories: this.storyMapper?.getSummary() || {},
                assets: {
                    wordpress: this.mappedData.assets?.length || 0,
                    external: this.assetExtractor?.getSummary() || { totalAssets: 0 }
                },
                datasources: this.mappedData.datasources?.length || 0,
                components: this.mappedData.components?.length || 0
            },
            statistics: {
                totalProcessed: this.stats.totalProcessed,
                errors: this.stats.errors.length,
                warnings: this.stats.warnings.length
            },
            files: {
                generated: await this.listGeneratedFiles(outputDir)
            }
        };

        await this.saveToFile(path.join(outputDir, 'mapping-summary.json'), summary);
        console.log('  ✓ Mapping summary saved');

        // Log key metrics
        console.log('\n� Mapping Summary:');
        console.log(`   📖 Stories: ${summary.mapping.stories.totalStories || 0}`);
        console.log(`   🖼️  WordPress Assets: ${summary.mapping.assets.wordpress}`);
        console.log(`   🌐 External Assets: ${summary.mapping.assets.external.totalAssets}`);
        console.log(`   🗂️  Datasources: ${summary.mapping.datasources}`);
        console.log(`   🧩 Components: ${summary.mapping.components}`);

        return summary;
    }

    /**
     * List all generated files in output directory
     */
    async listGeneratedFiles(outputDir) {
        try {
            const files = [];

            async function scanDirectory(dir, relativePath = '') {
                const entries = await fs.readdir(dir, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    const relPath = path.join(relativePath, entry.name);

                    if (entry.isDirectory()) {
                        await scanDirectory(fullPath, relPath);
                    } else if (entry.isFile() && entry.name.endsWith('.json')) {
                        const stats = await fs.stat(fullPath);
                        files.push({
                            path: relPath,
                            size: stats.size,
                            modified: stats.mtime.toISOString()
                        });
                    }
                }
            }

            await scanDirectory(outputDir);
            return files;

        } catch (error) {
            console.warn('Could not list generated files:', error.message);
            return [];
        }
    }
}
