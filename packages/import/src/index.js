import StoryblokClient from '@storyblok/management-api-client';
import fs from 'fs-extra';
import path from 'path';
import pLimit from 'p-limit';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const INPUT_DIR = process.env.MAPPING_OUTPUT_DIR || './mapped-data';
const STORYBLOK_OAUTH_TOKEN = process.env.STORYBLOK_OAUTH_TOKEN;
const STORYBLOK_SPACE_ID = process.env.STORYBLOK_SPACE_ID;

// Rate limiting: MAPI has 6 req/s limit
const limit = pLimit(6);

class StoryblokImporter {
    constructor(inputDir, oauthToken, spaceId) {
        this.inputDir = inputDir;
        this.spaceId = spaceId;
        this.client = new StoryblokClient({
            oauthToken,
        });
        this.importedIds = new Map();
    }

    async importAll() {
        console.log('📤 Starting Storyblok import...');

        if (!STORYBLOK_OAUTH_TOKEN || !STORYBLOK_SPACE_ID) {
            throw new Error('Missing required environment variables: STORYBLOK_OAUTH_TOKEN and STORYBLOK_SPACE_ID');
        }

        try {
            // First, create components if they don't exist
            await this.ensureComponents();

            // Import datasources first (they might be referenced by stories)
            await this.importDatasources();

            // Import stories
            await this.importStories();

            // Import assets (media files)
            await this.importAssets();

            console.log('✅ Import completed successfully!');
        } catch (error) {
            console.error('❌ Import failed:', error);
            throw error;
        }
    }

    async ensureComponents() {
        console.log('🧩 Ensuring required components exist...');

        const components = [
            {
                name: 'article',
                display_name: 'Article',
                schema: {
                    title: {
                        type: 'text',
                        required: true,
                    },
                    content: {
                        type: 'richtext',
                    },
                    excerpt: {
                        type: 'richtext',
                    },
                    author: {
                        type: 'option',
                        source: 'internal_datasource',
                        datasource_slug: 'authors',
                    },
                    featured_image: {
                        type: 'asset',
                        filetypes: ['images'],
                    },
                    categories: {
                        type: 'options',
                        source: 'internal_datasource',
                        datasource_slug: 'categories',
                    },
                    published_date: {
                        type: 'datetime',
                    },
                    seo_title: {
                        type: 'text',
                    },
                    seo_description: {
                        type: 'textarea',
                    },
                },
                is_root: false,
                is_nestable: true,
            },
            {
                name: 'page',
                display_name: 'Page',
                schema: {
                    title: {
                        type: 'text',
                        required: true,
                    },
                    content: {
                        type: 'richtext',
                    },
                    seo_title: {
                        type: 'text',
                    },
                },
                is_root: false,
                is_nestable: true,
            },
        ];

        for (const component of components) {
            try {
                await limit(() =>
                    this.client.post(`spaces/${this.spaceId}/components/`, {
                        component,
                    })
                );
                console.log(`  ✓ Created component: ${component.name}`);
            } catch (error) {
                if (error.response?.data?.error === 'Component with this name already exists.') {
                    console.log(`  ↺ Component already exists: ${component.name}`);
                } else {
                    console.warn(`  ⚠️  Could not create component ${component.name}:`, error.message);
                }
            }
        }
    }

    async importDatasources() {
        console.log('🗂️  Importing datasources...');

        const datasourcesPath = path.join(this.inputDir, 'datasources.json');

        if (!(await fs.pathExists(datasourcesPath))) {
            console.log('  ℹ️  No datasources file found, skipping...');
            return;
        }

        const datasources = await fs.readJson(datasourcesPath);

        for (const datasource of datasources) {
            try {
                await limit(() =>
                    this.client.post(`spaces/${this.spaceId}/datasources/`, {
                        datasource: {
                            name: datasource.name,
                            slug: datasource.slug,
                        },
                    })
                );

                // Import datasource entries
                for (const entry of datasource.datasource_entries) {
                    await limit(() =>
                        this.client.post(`spaces/${this.spaceId}/datasource_entries/`, {
                            datasource_entry: {
                                name: entry.name,
                                value: entry.value,
                                dimension_value: entry.dimension_value,
                                datasource_slug: datasource.slug,
                            },
                        })
                    );
                }

                console.log(`  ✓ Imported datasource: ${datasource.name} (${datasource.datasource_entries.length} entries)`);
            } catch (error) {
                console.warn(`  ⚠️  Could not import datasource ${datasource.name}:`, error.message);
            }
        }
    }

    async importStories() {
        console.log('📖 Importing stories...');

        const storiesPath = path.join(this.inputDir, 'stories.json');

        if (!(await fs.pathExists(storiesPath))) {
            console.log('  ℹ️  No stories file found, skipping...');
            return;
        }

        const stories = await fs.readJson(storiesPath);

        // Group stories by language
        const storiesByLang = stories.reduce((acc, story) => {
            const lang = story.lang || 'en';
            if (!acc[lang]) acc[lang] = [];
            acc[lang].push(story);
            return acc;
        }, {});

        // Import stories for each language
        for (const [lang, langStories] of Object.entries(storiesByLang)) {
            console.log(`  🌍 Importing ${lang.toUpperCase()} stories...`);

            for (const story of langStories) {
                try {
                    const storyData = {
                        name: story.name,
                        slug: story.slug,
                        content: story.content,
                        is_folder: story.is_folder || false,
                        parent_id: story.parent_id,
                        default_root: story.default_root || (lang === 'es' ? 'es/' : ''),
                        path: story.path,
                        tag_list: story.tag_list || [],
                    };

                    // Create the story
                    const response = await limit(() =>
                        this.client.post(`spaces/${this.spaceId}/stories/`, {
                            story: storyData,
                        })
                    );

                    const createdStory = response.data.story;
                    this.importedIds.set(`${lang}-${story.slug}`, createdStory.id);

                    console.log(`    ✓ Imported story: ${story.name} (${lang})`);

                    // Add a small delay to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    console.warn(`    ⚠️  Could not import story ${story.name} (${lang}):`, error.message);
                }
            }
        }
    }

    async importAssets() {
        console.log('🖼️  Importing assets...');

        const assetsPath = path.join(this.inputDir, 'assets.json');

        if (!(await fs.pathExists(assetsPath))) {
            console.log('  ℹ️  No assets file found, skipping...');
            return;
        }

        const assets = await fs.readJson(assetsPath);

        for (const asset of assets) {
            try {
                // For external URLs, we'll import them by URL
                if (asset.filename.startsWith('http')) {
                    const response = await limit(() =>
                        this.client.post(`spaces/${this.spaceId}/assets/`, {
                            filename: asset.filename,
                            alt: asset.alt || '',
                            title: asset.title || '',
                        })
                    );

                    console.log(`  ✓ Imported asset: ${asset.title || asset.filename}`);

                    // Add a small delay
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            } catch (error) {
                console.warn(`  ⚠️  Could not import asset ${asset.filename}:`, error.message);
            }
        }
    }

    async loadJsonFile(filePath) {
        try {
            return await fs.readJson(filePath);
        } catch (error) {
            console.warn(`⚠️  Could not load ${filePath}, using empty array`);
            return [];
        }
    }
}

async function main() {
    if (!STORYBLOK_OAUTH_TOKEN) {
        console.error('❌ STORYBLOK_OAUTH_TOKEN environment variable is required');
        process.exit(1);
    }

    if (!STORYBLOK_SPACE_ID) {
        console.error('❌ STORYBLOK_SPACE_ID environment variable is required');
        process.exit(1);
    }

    const importer = new StoryblokImporter(
        INPUT_DIR,
        STORYBLOK_OAUTH_TOKEN,
        STORYBLOK_SPACE_ID
    );

    await importer.importAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
