# WordPress Content Exporter

A powerful and flexible WordPress content exporter that extracts posts, pages, media, taxonomies, and block schemas for migration to other platforms like Storyblok.

## Features

- 🌐 **Language-agnostic**: Export content for specific languages or all content regardless of language
- 📄 **Multiple export formats**: Single JSON files or individual files per post/page
- 📊 **Content status filtering**: Export published, draft, private, pending, or future content
- 🧱 **Block data support**: Exports Gutenberg block structure when available
- 🖼️ **Media handling**: Downloads and organizes media files with metadata
- 🏷️ **Taxonomy export**: Exports categories, tags, and custom taxonomies
- 👥 **User export**: Exports user data and author information
- 🔐 **Authentication support**: Works with both WordPress admin passwords and Application Passwords

## Installation

This package is part of a workspace. Install dependencies from the workspace root:

```bash
pnpm install
```

### Environment Variables

You can configure the exporter using environment variables:

```bash
# WordPress site URL
WORDPRESS_URL=http://localhost:8080

# Export output directory
EXPORT_OUTPUT_DIR=./my-custom-export

# WordPress authentication (optional - for draft/private content)
WP_USERNAME=your-username
WP_APP_PASSWORD=your-app-password
```

Create a `.env` file in your project root:

```env
WORDPRESS_URL=https://my-wordpress-site.com
EXPORT_OUTPUT_DIR=./exported-content

# Optional: For accessing draft/private content
WP_USERNAME=admin
WP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

### WordPress Authentication Setup

To export draft and private content, you need to provide WordPress credentials. The exporter supports two authentication methods:

**Option 1: Regular Admin Password (Simpler)**
```env
WP_USERNAME=admin
WP_APP_PASSWORD=your_admin_password
```

**Option 2: Application Passwords (Recommended for production)**

1. Go to your WordPress admin → Users → Your Profile
2. Scroll down to "Application Passwords"
3. Enter a name (e.g., "Content Exporter") and click "Add New Application Password"
4. Copy the generated password (format: `xxxx-xxxx-xxxx-xxxx`)
5. Add your username and application password to your `.env` file

Both methods work equally well. Application Passwords are more secure as they can be revoked without changing your main password.


## Usage

### Quick Examples

```bash
# Export all content (if not authenticated, it will export only published content)
pnpm run export

# Export only draft content for Spanish language as individual files (auth needed)
pnpm run export --languages "es" --status "draft" --multiple-files

# Export only published English and German content as individual files (no auth required)
pnpm run export --languages "en,de" --status "publish" --multiple-files
```

> [!NOTE]
> The default behavior exports ALL content regardless of status. If you only want published content and don't have authentication set up, use `--status "publish"`.

### Language-Specific Export

Export content for specific languages:
```bash
# No language separation (it won't create per-language folders like `/en`, etc)
pnpm run export

# Single language
pnpm run export --languages "en"

# Multiple languages
pnpm run export --languages "en,es"
```

### Content Status Export

Export content by publication status:
```bash
# All content regardless of status (default behavior, requires authentication for non-published)
pnpm run export

# Only published content (no authentication required)
pnpm run export --status "publish"

# Only draft content (requires authentication)
pnpm run export --status "draft"

# Published and draft content (requires authentication for drafts)
pnpm run export --status "publish,draft"

# Explicitly specify all content (same as default)
pnpm run export --status "all"
```

### Multiple Files Export

Export each post/page as individual JSON file:
```bash
pnpm run export --multiple-files
```

### All Available Options

```bash
pnpm run export [options]

Options:
  -l, --languages <codes>  comma-separated list of language codes (e.g., "en,es,fr")
                           If not specified, exports all content regardless of language
  -m, --multiple-files     export each post/page as individual file instead of single JSON
  -s, --status <statuses>  comma-separated list of post statuses to export (e.g., "publish,draft,private")
                           Options: publish, draft, private, pending, future, all
                           Default: "all" (exports all content regardless of status)
                           Note: Authentication required for non-published content (draft, private, etc.)
  -h, --help               display help for command
```

## Output Structure

### Default Export (Single Files)

```
exported-data/
├── assets/             # Downloaded media files
│   ├── image1.jpg
│   └── image2.png
├── media.json          # Media metadata
├── users.json          # User data
├── block_schemas.json  # Gutenberg block schemas
│
├── en/                 # English content (when languages specified)
│   ├── pages.json      # All English pages
│   ├── posts.json      # All English posts
│   └── taxonomies.json # English taxonomies
│
└── es/                 # Spanish content (when languages specified)
    ├── pages.json
    ├── posts.json
    └── taxonomies.json
```

### Multiple Files Export

```
exported-data/
├── assets/
├── media.json
├── users.json
├── block_schemas.json
│
├── en/
│   ├── posts/
│   │   ├── my-first-post.json
│   │   └── another-post.json    
│   ├── pages/
│   │   ├── about-us.json
│   │   └── contact.json
│   └── taxonomies.json
│
└── es/
    ├── posts/
    ├── pages/
    └── taxonomies.json
```

### No Language Filtering Export

When no languages are specified, all content is exported to the root directory:

```
exported-data/
├── assets/
├── media.json
├── users.json
├── block_schemas.json
├── posts.json          # All posts from all languages
├── pages.json          # All pages from all languages
└── taxonomies.json     # All taxonomies from all languages
```

## Advanced Usage

### Extending the Exporter

The exporter is designed to be extensible. See the source code in `src/index.js` for implementation details.

### API Integration

The exporter can also be used programmatically:

```javascript
import { WordPressExporter } from './src/index.js';

const exporter = new WordPressExporter('http://localhost:8080', './output', {
    languages: [{ code: 'en', name: 'English' }],
    multipleFiles: true,
    statuses: 'publish,draft'
});

await exporter.exportAll();
```

## WordPress Setup Requirements

### Basic Requirements

- WordPress REST API enabled (default in WordPress 4.7+)
- Accessible WordPress site URL

### Enhanced Block Export (Recommended)

For full Gutenberg block data export, you need to install the provided custom WordPress plugin that exposes block structure data via REST API.

**Installation:**

1. Copy the block exporter plugin to your WordPress installation:

```bash
# Copy the plugin file to your WordPress mu-plugins directory
cp ./scripts/wp_block_exporter.php /path/to/your/wordpress/wp-content/mu-plugins/
```

**What this provides:**
- Enhanced REST API endpoints: `/wp-json/wp/v2/posts-with-blocks` and `/wp-json/wp/v2/pages-with-blocks`  
- Detailed Gutenberg block structure for each post/page
- Block schema definitions via `/wp-json/wp/v2/block-schemas`
- Much richer export data for content migration

**Without the plugin:**
- Exporter falls back to standard WordPress REST API
- You'll see "without block data" warnings in console
- Basic content is still exported, but without detailed block structure

### Multilingual Support

The exporter automatically detects and works with:

- **Polylang**: Detects language from URL structure (`/es/post-slug`)
- **WPML**: Compatible with standard URL structures
- **Custom setups**: Language detection based on URL patterns


## Troubleshooting

### Connection Issues

```bash
# Check if WordPress is accessible
curl http://localhost:8080/wp-json/wp/v2/posts

# Use custom WordPress URL and output directory
WORDPRESS_URL=https://my-custom-site.com pnpm run export

# Custom output location
EXPORT_OUTPUT_DIR=./my-backup pnpm run export
```

### No Block Data

If you see "without block data" warnings:

1. Install the custom block exporter plugin (see Enhanced Block Export section)
2. Ensure the plugin file `wp_block_exporter.php` is in your `wp-content/mu-plugins/` directory
3. Verify WordPress REST API is accessible
4. Check WordPress user permissions for REST API access

### Permission Issues

Ensure your WordPress site allows:
- REST API access
- Media file downloads
- Anonymous access to public content

**For Draft Content Export:**
Draft, private, and pending posts require authentication. The exporter supports both regular admin passwords and Application Passwords:

```bash
# Using admin password (simpler for development)
WP_USERNAME=admin WP_APP_PASSWORD=your_admin_password pnpm run export --status "draft"

# Using application password (recommended for production)
WP_USERNAME=admin WP_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx pnpm run export --status "draft"
```

### Empty Results

If no content is exported:

1. Check language codes match your WordPress setup
2. Verify WordPress REST API is accessible and returns data
3. Check the `--status` parameter matches your content's publication status
4. Try without filtering: `pnpm run export` (exports all content with authentication)


## License

MIT
