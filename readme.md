

# WordPress to Storyblok Migration PoC

This project is a PoC to exemplify a full WordPress 

> [!NOTE]
> Tested with: Wordpress 6.x.x (6.6.2 to be precise)

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
   pnpm i
   ```

2. **Start and seed WordPress:**
   ```bash
   docker compose up -d
   docker compose run --rm --user 33:33 wpcli /scripts/seed.sh
   ```

3. **Run migration:**
   ```bash
   pnpm run export
   pnpm run map
   pnpm run import
   
   # Or in one step
   # pnpm migrate
   ```


## What's covered? Migration flow in depth

### Step 1. Seededing a WordPress instance

Includes most of cases we want to test in a migration:

- 2 languages: EN (default), and ES
- 1 author (John Doe)
- 3 articles with richtext content and featured images 
- 1 category -> 2 articles are linked to the category, 1 remains uncategorized (the Alicante one)
- 1 image is hotlinked from external url (the garden one) while the other 2 are imported into the WP asset manager
- 1 article has internal linking to another (garden post -> coffee post)

It also configures:
- Polylang for i18n
- A custom [wp_block_exporter](/scripts/wp_block_exporter.php) for exporting block schemas

Routes are slug-based, the ones created:
- `/`, `/blog`, 3 articles ones
- `/es/inicio`, `/es/blog-es`, 3 article ones


### Step 2 - Export

When running `pnpm run export`, a structure similar to this will be created:

```
exported-data/
├── assets/             # The downloaded assets
├── media.json          # The metadata for the downloaded assets
├── users.json          # All users
├── block_schemas.json  # All Gutemberg blocks
│ 
└── en/                     # A folder per each i18n language
    ├── pages.json          # All pages (`type: page`)
    ├── posts.json          # All posts (`type: post`)
    └── taxonomies.json     # All taxonomies (`category`, `post_tag`)
```

A few notes:
- Wordpress has 2 main taxonomies: `category` and `post_tag`. While category is more complex and can have hierarchy or translations, post_tag is merely a tag string.
- `pages.json` and `posts.json` also include a `blocks` property, with a Guttermberg block structure representation of the content.

### Step 3 - Mapping

Here's where most of manual work will happen for the users.

There are decisions that need to be taken:
- How to structure the i18n content? Field-based or folder-based translations?
- How to sort taxonomies? As tags? Datasources? Stories? Each will have their own pros and const (for instance: Datasources or Stories will be translatable; Tags not, but they'll benefit from search functionality)
- Richtext content transformed into Markdown or Richtext?
- How exactly to map the Content Types and Blocks?

Additionally, **internal linking** it's a real challenge. How to keep references between posts, pages and assets?



Transforms WordPress data to Storyblok format

- HTML to rich text conversion
- Creates datasources for categories and authors
- Handles featured images and internal links

### Step 4 - Import

Imports the content into Storyblok

- Uses `@storyblok/management-api-client`
- Creates components automatically
- Imports stories, datasources, and assets
- Respects API rate limits












------


## Migration notes

### Exporting components

Wordpress doesn't have a universal and easy way to export Gutemberg components. 

[wordpress-importer](https://github.com/storyblok/wordpress-importer/blob/9658c5d6f154223433b811438c41d02403880d7e/README.md?plain=1#L126) is relying on [rest-api-blocks](https://wordpress.org/plugins/rest-api-blocks/#description), a discontinued plugin not tested in the latest 3 WP majors.

This exporter solution provides a in-Wordpress [wp_block_exporter](/scripts/wp_block_exporter.php) using the native's Wordpress Blocks API to export all core Gutemberg components.

**Is it useful?** I doubt it. Most likely, in Storyblok you will have a very different set of components compared to the ones you have exported from Gutemberg. 

For example, in this exact website example, Gutemberg will structure your schemas like:
- Post: a list of `core/heading`, `core/paragraph`, `core/list`, etc
- Page: a list of `core/cover`, `core/group`, `core/spacer` etc (structural + mark blocks)

While in Storyblok you'll likely want (as an example):
- Post: `title` (text), `content` (richtext or markdown, taken from the post rendered content)
- Pate: `title` (text), `body` (array of bloks) > `hero` (title, image, button), `section` (title, description, grid (custom blok))

### Custom setups

When it comes to exporting, the same CMS can have totally different setups.

As an example, in this project we're using Polylang for i18n in Wordpress, which does its things in its way. For instance, when using Polylang you'll get languages via `http://localhost:8080/wp-json/pll/v1/languages`. But other plugins are going to work differently.

And same with any other single feature of the CMS.

> [!NOTE]
> For this reason, for exporting we can't have a one-for-all-setups working package. Better to provide an exporter script as a starting point, that users can tailor to their needs.






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


## Ideas for Migration Tooling

**1. Exporting tooling**

- `downloadAsset(url)`: should include both the asset and associated metadata

**2. Mapping tooling**




# Comparison with other CMS migration tooling

## Contentful

- The claim to have a Migrations DSL - it's more of a tool to perform programatic _schema migrations_ rather than content migration from other CMS.

### Import command

It's like a `push everything`. Takes care not only about:
- content
- assets
- components

but also about:
- roles
- tags (but only tag references from content. Tags need to exist in the settings for target space)
- locales (even though they must be created in the target space)
- webhooks (but credentials need to be added afterwards in target space)

[More on import command](https://www.contentful.com/developers/docs/tutorials/cli/import-and-export/#import-content)