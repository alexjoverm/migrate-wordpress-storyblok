

# TL;DR;

The project is created with:
- 2 languages: EN (default), and ES
- 1 author (John Doe)
- 3 articles with richtext content and featured images 
- 1 category -> 2 articles are linked to the category, 1 remains uncategorized (the Alicante one)
- 1 image is hotlinked from external url (the garden one) while the other 2 are imported into the WP asset manager
- 1 article has internal linking to another (garden post -> coffee post)

Routes are slug-based, the ones created:
- `/`, `/blog`, 3 articles ones
- `/es/inicio`, `/es/blog-es`, 3 article ones


To setup and run the project:

```bash
chmod +x scripts/seed.sh
# in case you need to re-run the instance -> docker compose down -v
docker compose up -d  
docker compose run --rm --user 33:33 wpcli /scripts/seed.sh
```

Then, open `http://localhost:8080` (***in a private tab***, as WP polylang tends to mess up and redirect home route)



------


## Migration notes

Wordpress uses API endpoints within the `_links` property to cross-link to the right resources:

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

Depending on the user's intention, you can use `tags` or `stories`. With tags you get some extra search functionality, while you won't get de-facto translation (you could use a datasource tho for that). With stories you'd need to resolve relations.


## Development notes

### 1. Setup Wordpress instance through Docker

- Use `docker-compose.yml` to spin up a wordpress instance

Run:

```bash
docker compose up -d
```

In case you need to _"clean up"_ and start from scratch, use:

```bash
docker compose down -v
```

### 2. Setup and seed content

You can use the docker snapshots of the Wordpress instance (db + content):

```bash
chmod +x scripts/backup.sh scripts/restore.sh
./scripts/restore.sh backups/20250908-143421/
```


For seeding from scratch, follow steps below.

---

Use `seed.sh` to seed the content of the project, configure i18n and minimal layout and theme.

Give permission:

```bash
chmod +x scripts/seed.sh
```

Run this to enable multisite as `root`, and seed all the content using `www-data` user:

```bash
docker compose run --rm --user root wpcli /scripts/seed.sh
```

**Verify**

Pages:

- EN (root): http://localhost:8080/ and http://localhost:8080/blog/
- ES: http://localhost:8080/es/inicio and http://localhost:8080/es/blog-es/

REST API:

- EN posts: http://localhost:8080/wp-json/wp/v2/posts
- ES posts: http://localhost:8080/es/wp-json/wp/v2/posts
- EN pages: http://localhost:8080/wp-json/wp/v2/pages
- ES pages: http://localhost:8080/es/wp-json/wp/v2/pages