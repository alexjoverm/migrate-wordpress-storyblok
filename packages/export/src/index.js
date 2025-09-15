import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { findWorkspaceRoot } from '@migration/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const WORDPRESS_BASE_URL = process.env.WORDPRESS_URL || 'http://localhost:8080';
const WORKSPACE_ROOT = findWorkspaceRoot();
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(WORKSPACE_ROOT, 'exported-data');

class WordPressExporter {
    constructor(baseUrl, outputDir) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.outputDir = outputDir;
    }

    async exportAll() {
        console.log('🚀 Starting WordPress export...');

        await fs.ensureDir(this.outputDir);

        // Variables to track export stats for console summary
        let totalPosts = 0, totalPages = 0, totalUsers = 0;
        let assetsResult = { downloaded: 0 };

        try {
            // Export content for both languages (EN and ES)
            const languages = [
                { code: 'en', name: 'English' },
                { code: 'es', name: 'Español' }
            ];

            // Export block schemas (only once, they're global)
            console.log('🧱 Exporting WordPress block schemas...');
            const blockSchemas = await this.exportBlockSchemas(this.outputDir);

            for (const language of languages) {
                const langOutputDir = path.join(this.outputDir, language.code);
                await fs.ensureDir(langOutputDir);

                console.log(`📝 Exporting ${language.name} content...`);

                const posts = await this.exportPosts(language.code, langOutputDir);
                const pages = await this.exportPages(language.code, langOutputDir);
                const categories = await this.exportCategories(language.code, langOutputDir);
                const tags = await this.exportTags(language.code, langOutputDir);

                // Track totals for summary (using EN as reference)
                if (language.code === 'en') {
                    totalPosts = posts.length;
                    totalPages = pages.length;
                }

                // Only export users and media once (they're global regardless of language)
                if (language.code === 'en') {
                    const users = await this.exportUsers(this.outputDir);
                    const mediaResult = await this.exportMedia(this.outputDir);

                    totalUsers = users.length;
                    assetsResult = mediaResult;
                }
            }

            console.log('✅ Export completed successfully!');
            console.log(`📊 Summary: ${totalPosts} posts, ${totalPages} pages, ${blockSchemas.total || 0} block schemas, ${assetsResult.downloaded} assets downloaded`);
        } catch (error) {
            console.error('❌ Export failed:', error);
            throw error;
        }
    }

    async exportPosts(langCode, outputDir) {
        console.log(`  📄 Exporting posts with block data...`);

        try {
            // Try to use the enhanced endpoint with block data
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts-with-blocks`);
            const langPosts = this.filterByLanguage(allPosts, langCode);

            await this.saveToFile(path.join(outputDir, 'posts.json'), langPosts);
            console.log(`    ✓ Found ${langPosts.length} posts with block data for ${langCode.toUpperCase()}`);
            return langPosts;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced posts endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts`);
            const langPosts = this.filterByLanguage(allPosts, langCode);

            await this.saveToFile(path.join(outputDir, 'posts.json'), langPosts);
            console.log(`    ✓ Found ${langPosts.length} posts for ${langCode.toUpperCase()} (without block data)`);
            return langPosts;
        }
    }

    async exportPages(langCode, outputDir) {
        console.log(`  📋 Exporting pages with block data...`);

        try {
            // Try to use the enhanced endpoint with block data
            const allPages = await this.fetchAllPaginated(`/wp-json/wp/v2/pages-with-blocks`);
            const langPages = this.filterByLanguage(allPages, langCode);

            await this.saveToFile(path.join(outputDir, 'pages.json'), langPages);
            console.log(`    ✓ Found ${langPages.length} pages with block data for ${langCode.toUpperCase()}`);
            return langPages;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced pages endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPages = await this.fetchAllPaginated(`/wp-json/wp/v2/pages`);
            const langPages = this.filterByLanguage(allPages, langCode);

            await this.saveToFile(path.join(outputDir, 'pages.json'), langPages);
            console.log(`    ✓ Found ${langPages.length} pages for ${langCode.toUpperCase()} (without block data)`);
            return langPages;
        }
    }

    async exportCategories(langCode, outputDir) {
        console.log(`  🏷️  Exporting categories...`);
        const allCategories = await this.fetchAllPaginated(`/wp-json/wp/v2/categories`);
        const langCategories = this.filterByLanguage(allCategories, langCode);
        await this.saveToFile(path.join(outputDir, 'categories.json'), langCategories);
        console.log(`    ✓ Found ${langCategories.length} categories for ${langCode.toUpperCase()}`);
        return langCategories;
    }

    async exportTags(langCode, outputDir) {
        console.log(`  🔖 Exporting tags...`);
        const allTags = await this.fetchAllPaginated(`/wp-json/wp/v2/tags`);
        const langTags = this.filterByLanguage(allTags, langCode);
        await this.saveToFile(path.join(outputDir, 'tags.json'), langTags);
        console.log(`    ✓ Found ${langTags.length} tags for ${langCode.toUpperCase()}`);
        return langTags;
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

    async exportBlockSchemas(outputDir) {
        console.log(`  🧱 Exporting block schemas...`);

        try {
            // Use the custom REST API endpoint provided by our mu-plugin
            const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/block-schemas`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const blockData = await response.json();

            // Save block schemas to file
            await fs.writeJson(path.join(outputDir, 'block_schemas.json'), blockData, { spaces: 2 });

            console.log(`    ✓ Exported ${blockData.total_schemas || Object.keys(blockData.block_types || {}).length} block type schemas`);

            return {
                total: blockData.total_schemas || Object.keys(blockData.block_types || {}).length,
                data: blockData
            };

        } catch (error) {
            console.error('    ⚠️  Failed to export block schemas:', error.message);
            console.log('    ℹ️  Block exporter mu-plugin may not be installed. Run seed.sh to set it up.');
            return { total: 0, data: null };
        }
    }



    // Filter content by language based on the link URL
    filterByLanguage(items, langCode) {
        return items.filter(item => {
            if (!item.link) return false;

            // Spanish content has links starting with /es/
            const isSpanish = item.link.includes('/es/');

            if (langCode === 'es') {
                return isSpanish;
            } else if (langCode === 'en') {
                return !isSpanish;
            }

            return false;
        });
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
