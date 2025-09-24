#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import { program } from 'commander';
import { findWorkspaceRoot } from '@migration/shared';
import { exportWordPressContent } from './index.js';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

config();

const WORDPRESS_BASE_URL = process.env.WORDPRESS_URL || 'http://localhost:8080';
const WORKSPACE_ROOT = findWorkspaceRoot();
const EXPORT_OUTPUT_DIR = process.env.EXPORT_OUTPUT_DIR || path.join(WORKSPACE_ROOT, 'exported-data');

// WordPress authentication (optional - for draft/private content access)
const WP_USERNAME = process.env.WP_USERNAME || null;
const WP_APP_PASSWORD = process.env.WP_APP_PASSWORD || null;

// Configure Commander.js
program
    .name('wp-export')
    .description('WordPress to Storyblok content exporter')
    .version('1.0.0')
    .option('-l, --languages <codes>', 'comma-separated list of language codes (e.g., "en,es,fr"). If not specified, exports all content regardless of language')
    .option('-m, --multiple-files', 'export each post/page as individual file instead of single JSON', false)
    .option('-s, --status <statuses>', 'comma-separated list of post statuses to export (e.g., "publish,draft,private"). Options: publish, draft, private, pending, future, all. Default: all', 'all')
    .helpOption('-h, --help', 'display help for command')
    .addHelpText('after', `
Examples:
  $ npm run export
  $ npm run export --languages "en,es,fr"
  $ npm run export --multiple-files
  $ npm run export --status "publish,draft"
  $ npm run export --status "draft"
  $ npm run export --languages "en,de" --multiple-files --status "publish"

Environment Variables:
  WORDPRESS_URL        WordPress site URL (default: http://localhost:8080)
  EXPORT_OUTPUT_DIR    Export output directory (default: ./exported-data)
  WP_USERNAME          WordPress username (optional - for draft/private content)
  WP_APP_PASSWORD      WordPress application password (optional - for draft/private content)
`);

async function main() {
    try {
        program.parse();
        const options = program.opts();

        // Parse languages if provided
        let languages = null;
        if (options.languages) {
            languages = options.languages.split(',').map(lang => lang.trim()).join(',');
        }

        const exportOptions = {
            languages,
            multipleFiles: options.multipleFiles,
            status: options.status,
            wordpressUrl: WORDPRESS_BASE_URL,
            outputDir: EXPORT_OUTPUT_DIR
        };

        console.log(`🔧 Configuration:`);
        if (languages) {
            console.log(`   Languages: ${languages}`);
        } else {
            console.log(`   Languages: all (no filtering)`);
        }
        console.log(`   Multiple files: ${exportOptions.multipleFiles ? 'enabled' : 'disabled'}`);
        console.log(`   Content statuses: ${exportOptions.status}`);
        console.log(`   Authentication: ${WP_USERNAME && WP_APP_PASSWORD ? 'enabled (can access drafts)' : 'disabled (published content only)'}`);
        console.log(`   Output directory: ${exportOptions.outputDir}`);
        console.log(`   WordPress URL: ${exportOptions.wordpressUrl}\n`);

        await exportWordPressContent(exportOptions);
    } catch (error) {
        console.error('❌ Export failed:', error.message);
        process.exit(1);
    }
}

main().catch(console.error);
