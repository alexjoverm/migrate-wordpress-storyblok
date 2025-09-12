import fs from 'fs-extra';
import path from 'path';
import * as cheerio from 'cheerio';
import slugify from 'slugify';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { convertHtmlToRichText, findWorkspaceRoot } from '@migration/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const WORKSPACE_ROOT = findWorkspaceRoot();
const INPUT_DIR = process.env.INPUT_DIR || path.join(WORKSPACE_ROOT, 'exported-data');
const OUTPUT_DIR = process.env.MAPPING_OUTPUT_DIR || path.join(WORKSPACE_ROOT, 'mapped-data');

class WordPressToStoryblokMapper {
    constructor(inputDir, outputDir) {
        this.inputDir = inputDir;
        this.outputDir = outputDir;
        this.wordpressData = { en: {}, es: {} };
    }

    async mapAll() {
        console.log('🔄 Starting WordPress to Storyblok mapping...');

        await fs.ensureDir(this.outputDir);
        await this.loadWordPressData();

        try {
            await this.mapStories();
            await this.mapDatasources();
            await this.mapAssets();

            console.log('✅ Mapping completed successfully!');
        } catch (error) {
            console.error('❌ Mapping failed:', error);
            throw error;
        }
    }

    async loadWordPressData() {
        console.log('📥 Loading WordPress data...');

        const languages = ['en', 'es'];
        for (const lang of languages) {
            const langDir = path.join(this.inputDir, lang);

            if (await fs.pathExists(langDir)) {
                this.wordpressData[lang] = {
                    posts: await this.loadJsonFile(path.join(langDir, 'posts.json')),
                    pages: await this.loadJsonFile(path.join(langDir, 'pages.json')),
                    categories: await this.loadJsonFile(path.join(langDir, 'categories.json')),
                    tags: await this.loadJsonFile(path.join(langDir, 'tags.json')),
                    users: await this.loadJsonFile(path.join(langDir, 'users.json')),
                    media: await this.loadJsonFile(path.join(langDir, 'media.json')),
                };
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

    async mapStories() {
        console.log('📖 Mapping stories...');

        const stories = [];

        // Map posts and pages for both languages
        for (const [lang, data] of Object.entries(this.wordpressData)) {
            if (!data.posts && !data.pages) continue;

            // Map posts to article stories
            for (const post of data.posts || []) {
                const story = await this.mapPostToStory(post, lang);
                stories.push(story);
            }

            // Map pages to page stories  
            for (const page of data.pages || []) {
                const story = await this.mapPageToStory(page, lang);
                stories.push(story);
            }
        }

        await this.saveToFile('stories.json', stories);
    }

    async mapPostToStory(post, lang) {
        const content = this.convertHtmlToRichText(post.content.rendered);
        const excerpt = this.convertHtmlToRichText(post.excerpt.rendered);

        // Find author
        const author = this.wordpressData[lang].users?.find(u => u.id === post.author);

        // Find categories and tags
        const categories = post.categories.map(catId => {
            const cat = this.wordpressData[lang].categories?.find(c => c.id === catId);
            return cat?.name || '';
        }).filter(Boolean);

        // Find featured image
        let featuredImage = null;
        if (post.featured_media) {
            const media = this.wordpressData[lang].media?.find(m => m.id === post.featured_media);
            if (media) {
                featuredImage = {
                    filename: media.source_url,
                    alt: media.alt_text || media.title.rendered,
                    title: media.title.rendered,
                };
            }
        }

        return {
            name: post.title.rendered,
            slug: post.slug,
            content: {
                component: 'article',
                title: post.title.rendered,
                content: content,
                excerpt: excerpt,
                author: author?.name || '',
                featured_image: featuredImage,
                categories: categories,
                published_date: post.date,
                seo_title: post.title.rendered,
                seo_description: this.stripHtml(post.excerpt.rendered),
            },
            default_root: lang === 'es' ? 'es/' : '',
            lang: lang,
            tag_list: categories,
        };
    }

    async mapPageToStory(page, lang) {
        const content = this.convertHtmlToRichText(page.content.rendered);

        return {
            name: page.title.rendered,
            slug: page.slug,
            content: {
                component: 'page',
                title: page.title.rendered,
                content: content,
                seo_title: page.title.rendered,
            },
            default_root: lang === 'es' ? 'es/' : '',
            lang: lang,
        };
    }

    convertHtmlToRichText(html) {
        if (!html?.trim()) {
            return { type: 'doc', content: [] };
        }

        const $ = cheerio.load(html);
        const content = [];

        // Simple conversion - can be enhanced based on your needs
        $('body').children().each((_, element) => {
            const $el = $(element);
            const tagName = element.tagName?.toLowerCase();

            if (tagName === 'p') {
                content.push({
                    type: 'paragraph',
                    content: [{
                        type: 'text',
                        text: $el.text(),
                    }],
                });
            } else if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
                content.push({
                    type: 'heading',
                    attrs: { level: parseInt(tagName[1]) },
                    content: [{
                        type: 'text',
                        text: $el.text(),
                    }],
                });
            } else if (tagName === 'ul') {
                const listItems = [];
                $el.find('li').each((_, li) => {
                    listItems.push({
                        type: 'list_item',
                        content: [{
                            type: 'paragraph',
                            content: [{
                                type: 'text',
                                text: $(li).text(),
                            }],
                        }],
                    });
                });
                content.push({
                    type: 'bullet_list',
                    content: listItems,
                });
            } else if (tagName === 'img') {
                content.push({
                    type: 'image',
                    attrs: {
                        src: $el.attr('src'),
                        alt: $el.attr('alt') || '',
                    },
                });
            }
        });

        return { type: 'doc', content };
    }

    async mapDatasources() {
        console.log('🗂️  Mapping datasources...');

        const datasources = [];

        // Create categories datasource
        const allCategories = new Set();

        for (const [lang, data] of Object.entries(this.wordpressData)) {
            if (data.categories) {
                data.categories.forEach(cat => {
                    allCategories.add(cat.name);
                });
            }
        }

        if (allCategories.size > 0) {
            datasources.push({
                name: 'Categories',
                slug: 'categories',
                datasource_entries: Array.from(allCategories).map(name => ({
                    name,
                    value: slugify(name, { lower: true }),
                })),
            });
        }

        // Create authors datasource
        const allAuthors = new Set();

        for (const [lang, data] of Object.entries(this.wordpressData)) {
            if (data.users) {
                data.users.forEach(user => {
                    allAuthors.add(user.name);
                });
            }
        }

        if (allAuthors.size > 0) {
            datasources.push({
                name: 'Authors',
                slug: 'authors',
                datasource_entries: Array.from(allAuthors).map(name => ({
                    name,
                    value: slugify(name, { lower: true }),
                })),
            });
        }

        await this.saveToFile('datasources.json', datasources);
    }

    async mapAssets() {
        console.log('🖼️  Mapping assets...');

        const assets = [];

        for (const [lang, data] of Object.entries(this.wordpressData)) {
            if (data.media) {
                for (const media of data.media) {
                    assets.push({
                        filename: media.source_url,
                        alt: media.alt_text || media.title.rendered,
                        title: media.title.rendered,
                        original_filename: media.media_details?.file || '',
                        width: media.media_details?.width,
                        height: media.media_details?.height,
                    });
                }
            }
        }

        await this.saveToFile('assets.json', assets);
    }

    stripHtml(html) {
        return cheerio.load(html).text().trim();
    }

    async saveToFile(filename, data) {
        const filePath = path.join(this.outputDir, filename);
        await fs.writeJson(filePath, data, { spaces: 2 });
        console.log(`  ✓ Saved ${Array.isArray(data) ? data.length : Object.keys(data).length} items to ${filename}`);
    }
}

async function main() {
    const mapper = new WordPressToStoryblokMapper(INPUT_DIR, OUTPUT_DIR);
    await mapper.mapAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
