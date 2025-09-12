

# WordPress to Storyblok Migration PoC

This project is a PoC to exemplify a full WordPress 


## 📁 Project Structure
```
packages/
├── export/          # WordPress content exporter
├── mapping/         # Content transformer (WordPress → Storyblok)
├── import/          # Storyblok importer
└── shared/          # Utilities and helpers

docker-compose/      # Docker to setup a clean Wordpress instance
scripts/
├── seed.sh             # Seeds the wordpress instance with content
├── backup.sh           # Creates a dump of the WP SQL database + server content
├── restore.sh          # Restores the dump
└── polylang_setup.php  # Used by seed.sh - configures the i18n lang and routes
```

## Get started

1. **Setup environment:**
   ```bash
   cp .env.example .env # Add your Storyblok credentials

   chmod +x scripts/seed.sh
   ```

2. **Start WordPress:**
   ```bash
   docker compose up -d
   docker compose run --rm --user 33:33 wpcli /scripts/seed.sh
   ```

3. **Run migration:**
   ```bash
   pnpm export && pnpm map && pnpm import
   
   # Or in one step
   # pnpm migrate
   ```


## What's covered

**Seeded WordPress instance:**

Includes most of cases we want to test in a migration:

- 2 languages: EN (default), and ES
- 1 author (John Doe)
- 3 articles with richtext content and featured images 
- 1 category -> 2 articles are linked to the category, 1 remains uncategorized (the Alicante one)
- 1 image is hotlinked from external url (the garden one) while the other 2 are imported into the WP asset manager
- 1 article has internal linking to another (garden post -> coffee post)

Routes are slug-based, the ones created:
- `/`, `/blog`, 3 articles ones
- `/es/inicio`, `/es/blog-es`, 3 article ones


**Export Package:**

Extracts content from WordPress REST API

- Supports multilingual content (EN/ES)
- Fetches posts, pages, categories, tags, users, media

**Mapping Package:**

Transforms WordPress data to Storyblok format

- HTML to rich text conversion
- Creates datasources for categories and authors
- Handles featured images and internal links

**Import Package:**

Imports the content into Storyblok

- Uses `@storyblok/management-api-client`
- Creates components automatically
- Imports stories, datasources, and assets
- Respects API rate limits












------


## Migration notes

### Cross linking

WordPress uses href-based cross linking, pointing directly to the url of the right resource:

```json
"_links": {
    "self": [{
        "href": "http://localhost:8080/wp-json/wp/v2/posts/1",
        "targetHints": {
          "allow": ["GET"]
        }
    }],
    "collection": [{
        "href": "http://localhost:8080/wp-json/wp/v2/posts"
    }],
    "about": [{
        "href": "http://localhost:8080/wp-json/wp/v2/types/post"
    }],
    "author": [{
        "embeddable": true,
        "href": "http://localhost:8080/wp-json/wp/v2/users/1"
    } ]
}
```

### Categories

Depending on the user's intention, you can use `tags`, `datasources` or `stories`. With tags you get some extra search functionality, while you won't get de-facto translation (you could use a datasource tho for that). With stories you'd need to resolve relations.

