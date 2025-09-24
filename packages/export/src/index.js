import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { findWorkspaceRoot } from '@migration/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// WordPress authentication (optional - for draft/private content access)
const WP_USERNAME = process.env.WP_USERNAME || null;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || null;

class WordPressExporter {
    constructor(baseUrl, outputDir, options = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.outputDir = outputDir;
        this.languages = options.languages || null; // null means export all content regardless of language
        this.multipleFiles = options.multipleFiles || false;
        this.statuses = options.statuses || 'all'; // Content statuses to export
    }

    // Helper method to create authenticated headers
    getAuthHeaders() {
        const headers = {
            'User-Agent': 'WordPress-Exporter/1.0'
        };

        // Add authentication if available (for draft/private content access)
        if (WP_USERNAME && WP_APP_PASSWORD) {
            const authString = Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64');
            headers['Authorization'] = `Basic ${authString}`;
        }

        return headers;
    }

    async exportAll() {
        console.log('🚀 Starting WordPress export...');

        await fs.ensureDir(this.outputDir);

        // Variables to track export stats for console summary
        let totalPosts = 0, totalPages = 0, totalUsers = 0;
        let assetsResult = { downloaded: 0 };

        try {
            // Export block schemas (only once, they're global)
            console.log('🧱 Exporting WordPress block schemas...');
            const blockSchemas = await this.exportBlockSchemas(this.outputDir);

            if (this.languages === null) {
                // Export all content without language filtering
                console.log('🌐 Exporting all content (no language filtering)');

                const posts = await this.exportAllPosts(this.outputDir);
                const pages = await this.exportAllPages(this.outputDir);
                const taxonomies = await this.exportAllTaxonomies(this.outputDir);
                const users = await this.exportUsers(this.outputDir);
                const mediaResult = await this.exportMedia(this.outputDir);

                totalPosts = posts.length;
                totalPages = pages.length;
                totalUsers = users.length;
                assetsResult = mediaResult;
            } else {
                // Use dynamic languages instead of hardcoded ones
                console.log(`🌐 Exporting content for languages: ${this.languages.map(l => l.code || l).join(', ')}`);

                for (const language of this.languages) {
                    // Handle both string and object language formats
                    const langCode = typeof language === 'string' ? language : language.code;
                    const langName = typeof language === 'string' ? langCode.toUpperCase() : language.name;

                    const langOutputDir = path.join(this.outputDir, langCode);
                    await fs.ensureDir(langOutputDir);

                    console.log(`📝 Exporting ${langName} content...`);

                    const posts = await this.exportPosts(langCode, langOutputDir);
                    const pages = await this.exportPages(langCode, langOutputDir);
                    const taxonomies = await this.exportTaxonomies(langCode, langOutputDir);

                    // Track totals for summary (using first language as reference)
                    if (this.languages.indexOf(language) === 0) {
                        totalPosts = posts.length;
                        totalPages = pages.length;
                    }

                    // Only export users and media once (they're global regardless of language)
                    if (this.languages.indexOf(language) === 0) {
                        const users = await this.exportUsers(this.outputDir);
                        const mediaResult = await this.exportMedia(this.outputDir);

                        totalUsers = users.length;
                        assetsResult = mediaResult;
                    }
                }
            }

            console.log('✅ Export completed successfully!');
            console.log(`📊 Summary: ${totalPosts} posts, ${totalPages} pages, ${blockSchemas.total || 0} block schemas, ${assetsResult.downloaded} assets downloaded`);
        } catch (error) {
            console.error('❌ Export failed:', error);
            throw error;
        }
    }

    async exportAllPosts(outputDir) {
        console.log(`📄 Exporting all posts with block data...`);

        try {
            // Try to use the enhanced endpoint with block data
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts-with-blocks`);

            await this.saveToFiles(outputDir, 'posts.json', allPosts, this.multipleFiles);
            console.log(`    ✓ Found ${allPosts.length} posts with block data`);
            return allPosts;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced posts endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts`);

            await this.saveToFiles(outputDir, 'posts.json', allPosts, this.multipleFiles);
            console.log(`    ✓ Found ${allPosts.length} posts (without block data)`);
            return allPosts;
        }
    }

    async exportAllPages(outputDir) {
        console.log(`📋 Exporting all pages with block data...`);

        try {
            // Try to use the enhanced endpoint with block data
            const allPages = await this.fetchAllPaginated(`/wp-json/wp/v2/pages-with-blocks`);

            await this.saveToFiles(outputDir, 'pages.json', allPages, this.multipleFiles);
            console.log(`    ✓ Found ${allPages.length} pages with block data`);
            return allPages;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced pages endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPages = await this.fetchAllPaginated(`/wp-json/wp/v2/pages`);

            await this.saveToFiles(outputDir, 'pages.json', allPages, this.multipleFiles);
            console.log(`    ✓ Found ${allPages.length} pages (without block data)`);
            return allPages;
        }
    }

    async exportAllTaxonomies(outputDir) {
        console.log(`🏷️  Exporting all taxonomies...`);

        // First, get all available taxonomies from WordPress
        const taxonomiesResponse = await fetch(`${this.baseUrl}/wp-json/wp/v2/taxonomies`, {
            headers: this.getAuthHeaders()
        });
        const availableTaxonomies = await taxonomiesResponse.json();

        const taxonomiesData = {
            meta: {
                exported_at: new Date().toISOString(),
                available_taxonomies: Object.keys(availableTaxonomies)
            },
            taxonomies: {}
        };

        // Track totals for console output
        let totalTerms = 0;

        // Export terms for each relevant taxonomy
        for (const [taxonomyKey, taxonomyInfo] of Object.entries(availableTaxonomies)) {
            // Skip taxonomies that aren't content-related
            if (['nav_menu', 'wp_pattern_category'].includes(taxonomyKey)) {
                continue;
            }

            console.log(`    📂 Exporting ${taxonomyInfo.name} (${taxonomyKey})...`);

            try {
                // Fetch all terms for this taxonomy
                const endpoint = taxonomyKey === 'category' ? 'categories' :
                    taxonomyKey === 'post_tag' ? 'tags' :
                        `${taxonomyKey}s`; // Fallback for custom taxonomies

                const allTerms = await this.fetchAllPaginated(`/wp-json/wp/v2/${endpoint}`);

                taxonomiesData.taxonomies[taxonomyKey] = {
                    info: {
                        name: taxonomyInfo.name,
                        slug: taxonomyKey,
                        hierarchical: taxonomyInfo.hierarchical,
                        public: taxonomyInfo.public,
                        rest_base: taxonomyInfo.rest_base
                    },
                    terms: allTerms,
                    count: allTerms.length
                };

                totalTerms += allTerms.length;
                console.log(`      ✓ Found ${allTerms.length} terms`);

            } catch (error) {
                console.warn(`      ⚠️  Failed to export ${taxonomyKey}:`, error.message);
                taxonomiesData.taxonomies[taxonomyKey] = {
                    info: {
                        name: taxonomyInfo.name,
                        slug: taxonomyKey,
                        hierarchical: taxonomyInfo.hierarchical,
                        public: taxonomyInfo.public,
                        rest_base: taxonomyInfo.rest_base
                    },
                    terms: [],
                    count: 0,
                    error: error.message
                };
            }
        }

        await this.saveToFile(path.join(outputDir, 'taxonomies.json'), taxonomiesData);
        console.log(`    ✓ Found ${totalTerms} total taxonomy terms`);

        return taxonomiesData;
    }

    async exportPosts(langCode, outputDir) {
        console.log(`  📄 Exporting posts with block data...`);

        try {
            // Try to use the enhanced endpoint with block data
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts-with-blocks`);
            const langPosts = this.filterByLanguage(allPosts, langCode);

            await this.saveToFiles(outputDir, 'posts.json', langPosts, this.multipleFiles);
            console.log(`    ✓ Found ${langPosts.length} posts with block data for ${langCode.toUpperCase()}`);
            return langPosts;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced posts endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPosts = await this.fetchAllPaginated(`/wp-json/wp/v2/posts`);
            const langPosts = this.filterByLanguage(allPosts, langCode);

            await this.saveToFiles(outputDir, 'posts.json', langPosts, this.multipleFiles);
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

            await this.saveToFiles(outputDir, 'pages.json', langPages, this.multipleFiles);
            console.log(`    ✓ Found ${langPages.length} pages with block data for ${langCode.toUpperCase()}`);
            return langPages;

        } catch (error) {
            console.warn(`    ⚠️  Enhanced pages endpoint failed, falling back to standard API`);
            // Fallback to standard REST API
            const allPages = await this.fetchAllPaginated(`/wp-json/wp/v2/pages`);
            const langPages = this.filterByLanguage(allPages, langCode);

            await this.saveToFiles(outputDir, 'pages.json', langPages, this.multipleFiles);
            console.log(`    ✓ Found ${langPages.length} pages for ${langCode.toUpperCase()} (without block data)`);
            return langPages;
        }
    }

    async exportTaxonomies(langCode, outputDir) {
        console.log(`  🏷️  Exporting taxonomies...`);

        // First, get all available taxonomies from WordPress
        const taxonomiesResponse = await fetch(`${this.baseUrl}/wp-json/wp/v2/taxonomies`, {
            headers: this.getAuthHeaders()
        });
        const availableTaxonomies = await taxonomiesResponse.json();

        const taxonomiesData = {
            meta: {
                language: langCode,
                exported_at: new Date().toISOString(),
                available_taxonomies: Object.keys(availableTaxonomies)
            },
            taxonomies: {}
        };

        // Track totals for console output
        let totalTerms = 0;

        // Export terms for each relevant taxonomy
        for (const [taxonomyKey, taxonomyInfo] of Object.entries(availableTaxonomies)) {
            // Skip taxonomies that aren't content-related
            if (['nav_menu', 'wp_pattern_category'].includes(taxonomyKey)) {
                continue;
            }

            console.log(`    📂 Exporting ${taxonomyInfo.name} (${taxonomyKey})...`);

            try {
                // Fetch all terms for this taxonomy
                const endpoint = taxonomyKey === 'category' ? 'categories' :
                    taxonomyKey === 'post_tag' ? 'tags' :
                        `${taxonomyKey}s`; // Fallback for custom taxonomies

                const allTerms = await this.fetchAllPaginated(`/wp-json/wp/v2/${endpoint}`);
                const langTerms = this.filterByLanguage(allTerms, langCode);

                taxonomiesData.taxonomies[taxonomyKey] = {
                    info: {
                        name: taxonomyInfo.name,
                        slug: taxonomyKey,
                        hierarchical: taxonomyInfo.hierarchical,
                        public: taxonomyInfo.public,
                        rest_base: taxonomyInfo.rest_base
                    },
                    terms: langTerms,
                    count: langTerms.length
                };

                totalTerms += langTerms.length;
                console.log(`      ✓ Found ${langTerms.length} terms`);

            } catch (error) {
                console.warn(`      ⚠️  Failed to export ${taxonomyKey}:`, error.message);
                taxonomiesData.taxonomies[taxonomyKey] = {
                    info: {
                        name: taxonomyInfo.name,
                        slug: taxonomyKey,
                        hierarchical: taxonomyInfo.hierarchical,
                        public: taxonomyInfo.public,
                        rest_base: taxonomyInfo.rest_base
                    },
                    terms: [],
                    count: 0,
                    error: error.message
                };
            }
        }

        await this.saveToFile(path.join(outputDir, 'taxonomies.json'), taxonomiesData);
        console.log(`    ✓ Found ${totalTerms} total taxonomy terms for ${langCode.toUpperCase()}`);

        return taxonomiesData;
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
        const maxPerPage = 100; // WordPress REST API maximum

        console.log(`    📄 Fetching paginated data from ${endpoint}...`);

        while (hasMore) {
            try {
                const url = new URL(`${this.baseUrl}${endpoint}`);
                url.searchParams.set('page', page.toString());
                url.searchParams.set('per_page', maxPerPage.toString());

                // Include specified post statuses (requires authentication for draft/private content)
                // Without auth, only published content will be returned by WordPress
                if (endpoint.includes('/posts') || endpoint.includes('/pages')) {
                    let statusesToRequest = this.statuses;

                    // Handle 'all' status option - but restrict based on authentication
                    if (statusesToRequest === 'all') {
                        // If we have authentication, request all statuses, otherwise just published
                        if (WP_USERNAME && WP_APP_PASSWORD) {
                            statusesToRequest = 'publish,draft,private,pending,future';
                        } else {
                            statusesToRequest = 'publish';
                        }
                    }

                    url.searchParams.set('status', statusesToRequest);
                }

                const response = await fetch(url.toString(), {
                    headers: this.getAuthHeaders()
                });

                if (!response.ok) {
                    if (response.status === 400 && page > 1) {
                        // No more pages available
                        hasMore = false;
                        continue;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const data = await response.json();

                // Handle empty responses
                if (!Array.isArray(data) || data.length === 0) {
                    hasMore = false;
                    continue;
                }

                results.push(...data);

                // Check pagination headers (multiple fallback methods)
                const totalPages = parseInt(response.headers.get('x-wp-totalpages')) ||
                    parseInt(response.headers.get('X-WP-TotalPages')) || 1;
                const totalItems = parseInt(response.headers.get('x-wp-total')) ||
                    parseInt(response.headers.get('X-WP-Total')) || 0;

                // Log progress for large datasets
                if (page === 1 && totalItems > 0) {
                    console.log(`      Found ${totalItems} total items across ${totalPages} pages`);
                } else if (page % 10 === 0) {
                    console.log(`      Progress: Page ${page}/${totalPages} (${results.length} items collected)`);
                }

                // Determine if more pages exist
                hasMore = page < totalPages && data.length === maxPerPage;
                page++;

                // Add small delay for very large datasets to be respectful to the server
                if (totalItems > 1000) {
                    await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
                }

            } catch (error) {
                if (error.message.includes('400') && page > 1) {
                    // WordPress returns 400 when no more pages exist
                    hasMore = false;
                } else {
                    console.error(`      ❌ Error fetching ${endpoint} page ${page}:`, error.message);
                    throw error;
                }
            }
        }

        console.log(`    ✓ Collected ${results.length} items from ${page - 1} pages`);
        return results;
    }

    async exportBlockSchemas(outputDir) {
        console.log(`  🧱 Exporting block schemas...`);

        try {
            // Use the custom REST API endpoint provided by our mu-plugin
            const response = await fetch(`${this.baseUrl}/wp-json/wp/v2/block-schemas`, {
                headers: this.getAuthHeaders()
            });

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

    async saveToFiles(outputDir, filename, data, multipleFiles = false) {
        if (!multipleFiles) {
            // Save as single file
            await this.saveToFile(path.join(outputDir, filename), data);
            return;
        }

        // Save as multiple files
        const baseName = path.parse(filename).name;
        const multipleFilesDir = path.join(outputDir, baseName);
        await fs.ensureDir(multipleFilesDir);

        console.log(`    ✓ Saving ${data.length} items as individual files to ${baseName}/`);

        for (const item of data) {
            // Create a safe filename from the item title or slug
            let itemFilename = item.slug ||
                (item.title?.rendered || item.title || 'untitled')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '') ||
                `item-${item.id}`;

            // Ensure filename is not too long and ends with .json
            if (itemFilename.length > 100) {
                itemFilename = itemFilename.substring(0, 100);
            }
            itemFilename += '.json';

            const itemPath = path.join(multipleFilesDir, itemFilename);
            await fs.writeJson(itemPath, item, { spaces: 2 });
        }

        console.log(`    ✓ Individual files saved to ${baseName}/`);
    }
}

// Export the exporter class and a function for programmatic use
export { WordPressExporter };

export async function exportWordPressContent(options = {}) {
    const wordpressUrl = options.wordpressUrl || process.env.WORDPRESS_URL || 'http://localhost:8080';
    const outputDir = options.outputDir || process.env.EXPORT_OUTPUT_DIR || path.join(findWorkspaceRoot(), 'exported-data');

    const exporterOptions = {
        languages: options.languages ? options.languages.split(',').map(l => l.trim()) : null,
        multipleFiles: options.multipleFiles || false,
        statuses: options.status || 'all'
    };

    console.log('🚀 Starting WordPress content export...');
    console.log(`   Languages: ${exporterOptions.languages ? exporterOptions.languages.join(', ') : 'all'}`);
    console.log(`   Multiple files: ${exporterOptions.multipleFiles ? 'enabled' : 'disabled'}`);
    console.log(`   Content statuses: ${exporterOptions.statuses}`);
    console.log(`   Authentication: ${WP_USERNAME && WP_APP_PASSWORD ? 'enabled (can access drafts)' : 'disabled (published content only)'}`);
    console.log(`   Output directory: ${outputDir}`);
    console.log(`   WordPress URL: ${wordpressUrl}\n`);

    const exporter = new WordPressExporter(wordpressUrl, outputDir, exporterOptions);
    await exporter.exportAll();
}
