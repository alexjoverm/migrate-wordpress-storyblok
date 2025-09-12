import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const WORDPRESS_BASE_URL = process.env.WORDPRESS_URL || 'http://localhost:8080';
const OUTPUT_DIR = process.env.OUTPUT_DIR || './exported-data';

class WordPressExporter {
    constructor(baseUrl, outputDir) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.outputDir = outputDir;
    }

    async exportAll() {
        console.log('🚀 Starting WordPress export...');

        await fs.ensureDir(this.outputDir);
        const exportSummary = {
            timestamp: new Date().toISOString(),
            source: this.baseUrl,
            languages: {},
            assets: {
                total: 0,
                downloaded: 0,
                skipped: 0,
                errors: 0
            }
        };

        try {
            // Export content for both languages (EN and ES)
            const languages = ['', '/es'];

            for (const lang of languages) {
                const langDir = lang === '' ? 'en' : 'es';
                const langOutputDir = path.join(this.outputDir, langDir);
                await fs.ensureDir(langOutputDir);

                console.log(`📝 Exporting ${langDir.toUpperCase()} content...`);

                const posts = await this.exportPosts(lang, langOutputDir);
                const pages = await this.exportPages(lang, langOutputDir);
                const categories = await this.exportCategories(lang, langOutputDir);
                const tags = await this.exportTags(lang, langOutputDir);

                exportSummary.languages[langDir] = {
                    posts: posts.length,
                    pages: pages.length,
                    categories: categories.length,
                    tags: tags.length
                };

                // Only export users and media once (they're global regarless of language)
                if (lang === '') {
                    const users = await this.exportUsers(langOutputDir);
                    const mediaResult = await this.exportMedia(langOutputDir);

                    exportSummary.users = users.length;
                    exportSummary.assets = mediaResult;
                }
            }

            // Save export summary
            await fs.writeJson(path.join(this.outputDir, 'export-summary.json'), exportSummary, { spaces: 2 });

            console.log('✅ Export completed successfully!');
            console.log(`📊 Summary: ${exportSummary.languages.en?.posts || 0} posts, ${exportSummary.languages.en?.pages || 0} pages, ${exportSummary.assets.downloaded} assets downloaded`);
        } catch (error) {
            console.error('❌ Export failed:', error);
            throw error;
        }
    }

    async exportPosts(lang, outputDir) {
        console.log(`  📄 Exporting posts...`);
        const posts = await this.fetchAllPaginated(`${lang}/wp-json/wp/v2/posts`);
        await this.saveToFile(path.join(outputDir, 'posts.json'), posts);
        return posts;
    }

    async exportPages(lang, outputDir) {
        console.log(`  📋 Exporting pages...`);
        const pages = await this.fetchAllPaginated(`${lang}/wp-json/wp/v2/pages`);
        await this.saveToFile(path.join(outputDir, 'pages.json'), pages);
        return pages;
    }

    async exportCategories(lang, outputDir) {
        console.log(`  🏷️  Exporting categories...`);
        const categories = await this.fetchAllPaginated(`${lang}/wp-json/wp/v2/categories`);
        await this.saveToFile(path.join(outputDir, 'categories.json'), categories);
        return categories;
    }

    async exportTags(lang, outputDir) {
        console.log(`  #️⃣  Exporting tags...`);
        const tags = await this.fetchAllPaginated(`${lang}/wp-json/wp/v2/tags`);
        await this.saveToFile(path.join(outputDir, 'tags.json'), tags);
        return tags;
    }

    async exportUsers(outputDir) {
        console.log(`  👥 Exporting users...`);
        const users = await this.fetchAllPaginated(`/wp-json/wp/v2/users`);
        await this.saveToFile(path.join(outputDir, 'users.json'), users);
        return users;
    }

    async exportMedia(outputDir) {
        console.log(`  🖼️  Exporting media...`);
        const media = await this.fetchAllPaginated(`/wp-json/wp/v2/media`);

        // Save media metadata
        await this.saveToFile(path.join(outputDir, 'media.json'), media);

        const result = {
            total: media.length,
            downloaded: 0,
            skipped: 0,
            errors: 0
        };

        // Download actual media files
        if (media.length > 0) {
            console.log(`    📥 Downloading ${media.length} media files...`);
            const assetsDir = path.join(outputDir, 'assets');
            await fs.ensureDir(assetsDir);

            for (const mediaItem of media) {
                try {
                    await this.downloadMediaFile(mediaItem, assetsDir);
                    result.downloaded++;
                } catch (error) {
                    if (error.message.includes('External URL') || error.message.includes('already exists')) {
                        result.skipped++;
                    } else {
                        console.warn(`    ⚠️  Failed to download ${mediaItem.source_url}: ${error.message}`);
                        result.errors++;
                    }
                }
            }

            // Re-save media with local_path information
            await this.saveToFile(path.join(outputDir, 'media.json'), media);

            console.log(`    ✅ Downloaded ${result.downloaded} files, skipped ${result.skipped}, errors ${result.errors}`);
        }

        return result;
    }

    async downloadMediaFile(mediaItem, assetsDir) {
        const sourceUrl = mediaItem.source_url;

        // Skip if no source URL
        if (!sourceUrl) {
            throw new Error('No source URL');
        }

        // Skip external URLs that we can't/shouldn't download
        if (!sourceUrl.includes(this.baseUrl.replace(/^https?:\/\//, ''))) {
            throw new Error('External URL - skipping');
        }

        // Create filename from URL or use the WordPress filename
        const urlPath = new URL(sourceUrl).pathname;
        let fileName = path.basename(urlPath) || `media-${mediaItem.id}`;

        // Ensure we have an extension
        if (!path.extname(fileName) && mediaItem.mime_type) {
            const mimeToExt = {
                'image/jpeg': '.jpg',
                'image/jpg': '.jpg',
                'image/png': '.png',
                'image/gif': '.gif',
                'image/webp': '.webp',
                'image/svg+xml': '.svg',
                'application/pdf': '.pdf',
                'video/mp4': '.mp4',
                'audio/mpeg': '.mp3'
            };
            const ext = mimeToExt[mediaItem.mime_type];
            if (ext) {
                fileName += ext;
            }
        }

        const filePath = path.join(assetsDir, fileName);

        // Skip if file already exists
        if (await fs.pathExists(filePath)) {
            mediaItem.local_path = path.relative(path.dirname(assetsDir), filePath);
            return;
        }

        try {
            console.log(`      📥 Downloading: ${fileName}`);
            const response = await fetch(sourceUrl, {
                headers: {
                    'User-Agent': 'WordPress-Storyblok-Migration/1.0'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Get the response as buffer
            const buffer = await response.arrayBuffer();

            // Save the file
            await fs.writeFile(filePath, Buffer.from(buffer));

            // Update media item with local path for reference
            mediaItem.local_path = path.relative(path.dirname(assetsDir), filePath);

            // Add file size info
            const stats = await fs.stat(filePath);
            mediaItem.local_size = stats.size;

        } catch (error) {
            throw new Error(`Download failed: ${error.message}`);
        }
    }

    async fetchAllPaginated(endpoint) {
        const results = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            try {
                const url = new URL(`${this.baseUrl}${endpoint}`);
                url.searchParams.set('page', page.toString());
                url.searchParams.set('per_page', '100');

                const response = await fetch(url.toString());

                if (!response.ok) {
                    if (response.status === 400 && page > 1) {
                        // No more pages
                        hasMore = false;
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();
                results.push(...data);

                // Check if there are more pages
                const totalPages = parseInt(response.headers.get('x-wp-totalpages') || '1');
                hasMore = page < totalPages;
                page++;
            } catch (error) {
                if (error.message.includes('400') && page > 1) {
                    // No more pages
                    hasMore = false;
                } else {
                    console.error(`Error fetching ${endpoint} page ${page}:`, error.message);
                    throw error;
                }
            }
        }

        return results;
    }

    async saveToFile(filePath, data) {
        await fs.writeJson(filePath, data, { spaces: 2 });
        console.log(`    ✓ Saved ${data.length} items to ${path.basename(filePath)}`);
    }
}

async function main() {
    const exporter = new WordPressExporter(WORDPRESS_BASE_URL, OUTPUT_DIR);
    await exporter.exportAll();
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
