#!/usr/bin/env bash
set -euo pipefail

echo "==> Waiting for WordPress core files..."
for i in {1..90}; do
  [[ -f wp-includes/version.php && -f wp-admin/install.php ]] && break
  sleep 1
done
[[ -f wp-includes/version.php ]] || { echo "!! WP core not present"; exit 1; }

mkdir -p wp-content/uploads

echo "==> Waiting for MySQL..."
for i in {1..120}; do
  php -r '
    $host=getenv("WORDPRESS_DB_HOST")?: "db:3306";
    [$h,$p]=strpos($host,":")!==false? explode(":",$host,2) : [$host,3306];
    $u=getenv("WORDPRESS_DB_USER")?: "wp";
    $pw=getenv("WORDPRESS_DB_PASSWORD")?: "wp";
    $c=@mysqli_connect($h,$u,$pw,"",(int)$p);
    exit($c?0:1);
  ' && { echo "   MySQL reachable."; break; }
  sleep 2
done

BASE_URL="${BASE_URL:-http://localhost:8080}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@admin.com}"
BLOG_TITLE="${BLOG_TITLE:-Seeded WP}"
AUTHOR_USER="${AUTHOR_USER:-John Doe}"
AUTHOR_PASS="${AUTHOR_PASS:-johndoe}"
AUTHOR_EMAIL="${AUTHOR_EMAIL:-johndoe@example.com}"

# -------------------------
# WordPress install & basics
# -------------------------
if ! wp core is-installed >/dev/null 2>&1; then
  echo "==> Installing WordPress at ${BASE_URL}"
  wp core install --url="$BASE_URL" --title="$BLOG_TITLE" \
    --admin_user="$ADMIN_USER" --admin_password="$ADMIN_PASS" \
    --admin_email="$ADMIN_EMAIL" --skip-email
fi

wp rewrite structure '/%postname%/' --hard
wp rewrite flush --hard

wp plugin install polylang --activate || true

if ! wp user get "${AUTHOR_USER}" >/dev/null 2>&1; then
  wp user create "${AUTHOR_USER}" "${AUTHOR_EMAIL}" --role=author --user_pass="${AUTHOR_PASS}"
fi
AUTHOR_ID="$(wp user get "${AUTHOR_USER}" --field=ID)"
wp user update "${AUTHOR_ID}" --display_name="John Doe" --first_name="John" --last_name="Doe" >/dev/null

# -------------------------
# Disable Polylang cookie (no anchor needed) + ignore stickiness on "/"
# -------------------------
if ! grep -q "define\s*(\s*['\"]PLL_COOKIE['\"]" wp-config.php 2>/dev/null; then
  echo "==> Disabling Polylang cookie in wp-config.php"
  awk 'NR==1 && $0 ~ /^<\?php/ {print; print "define('\''PLL_COOKIE'\'', false);"; next} {print}' wp-config.php > wp-config.php.new \
    && mv wp-config.php.new wp-config.php
fi

mkdir -p wp-content/mu-plugins
# Clear any existing cookie and ignore preferred language on the root URL
cat > wp-content/mu-plugins/pll-cookie-off.php <<'PHP'
<?php
add_action('init', function () {
  if (isset($_COOKIE['pll_language'])) {
    setcookie('pll_language','', time()-YEAR_IN_SECONDS, '/', '', is_ssl(), true);
    unset($_COOKIE['pll_language']);
  }
}, 0);

add_filter('pll_preferred_language', function ($slug) {
  if (isset($_SERVER['REQUEST_URI']) && $_SERVER['REQUEST_URI'] === '/') {
    return false; // fall back to default language at "/"
  }
  return $slug;
}, 20);
PHP

# -------------------------
# External Featured Image (no upload) – MU plugin
# If a post has meta _ext_featured_url, use it wherever the Post Featured Image block appears.
# Also covers classic themes via post_thumbnail_html filter.
# -------------------------
cat > wp-content/mu-plugins/ext-featured-from-url.php <<'PHP'
<?php
/**
 * External Featured Image via _ext_featured_url (no media upload).
 * Works with block "core/post-featured-image" and classic the_post_thumbnail().
 */

// Replace the Post Featured Image block rendering when _ext_featured_url is set.
add_filter('render_block', function ($content, $block) {
  if (($block['blockName'] ?? '') !== 'core/post-featured-image') return $content;
  $post_id = $block['context']['postId'] ?? 0;
  if (! $post_id) return $content;

  $url = get_post_meta($post_id, '_ext_featured_url', true);
  if (! $url) return $content; // default behaviour

  $attrs  = $block['attrs'] ?? [];
  $class  = 'wp-block-post-featured-image';
  if (!empty($attrs['className'])) $class .= ' ' . $attrs['className'];
  if (!empty($attrs['align']))     $class .= ' align' . $attrs['align'];

  $is_link = !empty($attrs['isLink']);
  $img = sprintf('<img src="%s" alt="%s" />', esc_url($url), esc_attr(get_the_title($post_id)));
  $inner = $is_link ? sprintf('<a href="%s">%s</a>', esc_url(get_permalink($post_id)), $img) : $img;

  return sprintf('<figure class="%s">%s</figure>', esc_attr($class), $inner);
}, 10, 2);

// Classic/themes fallback: if no thumbnail but external URL exists, return an <img>.
add_filter('post_thumbnail_html', function ($html, $post_id, $thumb_id, $size, $attr) {
  $url = get_post_meta($post_id, '_ext_featured_url', true);
  if (! $url) return $html;

  // If core already produced HTML (because a real thumbnail exists), keep it.
  if (! empty($html)) return $html;

  $size_name = is_string($size) ? $size : 'full';
  $classes = 'attachment-' . esc_attr($size_name) . ' size-' . esc_attr($size_name);
  return sprintf('<img src="%s" alt="%s" class="%s" />', esc_url($url), esc_attr(get_the_title($post_id)), $classes);
}, 10, 5);
PHP

# -------------------------
# Helpers
# -------------------------
get_or_create_page () {
  local slug="$1" title="$2" content="${3:-}"
  local id
  id="$(wp post list --post_type=page --name="$slug" --field=ID --posts_per_page=1)"
  if [[ -z "$id" ]]; then
    id="$(wp post create --post_type=page --post_status=publish --post_title="$title" --post_name="$slug" ${content:+--post_content="$content"} --porcelain)"
  else
    if [[ -n "${content}" ]]; then
      wp post update "$id" --post_title="$title" --post_content="$content" >/dev/null
    else
      wp post update "$id" --post_title="$title" >/dev/null
    fi
  fi
  echo "$id"
}

# Blog Query Loop (shows featured image block which our MU plugin can override)
BLOG_LOOP='<!-- wp:query {"queryId":1,"query":{"perPage":9,"pages":0,"offset":0,"postType":"post","order":"desc","orderBy":"date"}} -->
<div class="wp-block-query"><!-- wp:post-template -->
<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:post-title {"isLink":true} /-->
<!-- wp:post-featured-image {"isLink":true,"sizeSlug":"large"} /-->
<!-- wp:post-excerpt /--></div>
<!-- /wp:group -->
<!-- /wp:post-template -->
<!-- wp:query-pagination -->
<!-- wp:query-pagination-previous /-->
<!-- wp:query-pagination-numbers /-->
<!-- wp:query-pagination-next /-->
<!-- /wp:query-pagination --></div>
<!-- /wp:query -->'

# Home pages: landing page content with hero and grid sections
HOME_EN_CONTENT='<!-- wp:cover {"url":"https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80","dimRatio":40,"overlayColor":"black","minHeight":60,"contentPosition":"center center","align":"full"} -->
<div class="wp-block-cover alignfull" style="min-height:60vh"><span aria-hidden="true" class="wp-block-cover__background has-black-background-color has-background-dim-40 has-background-dim"></span><img class="wp-block-cover__image-background" alt="" src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80" data-object-fit="cover"/><div class="wp-block-cover__inner-container"><!-- wp:group {"layout":{"type":"constrained","contentSize":"800px"}} -->
<div class="wp-block-group"><!-- wp:heading {"textAlign":"center","level":1,"style":{"typography":{"fontSize":"3.5rem","fontWeight":"700"}},"textColor":"white"} -->
<h1 class="wp-block-heading has-text-align-center has-white-color has-text-color" style="font-size:3.5rem;font-weight:700">Discover Your Next Adventure</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"1.25rem"}},"textColor":"white"} -->
<p class="has-text-align-center has-white-color has-text-color" style="font-size:1.25rem">Explore amazing destinations, discover hidden gems, and create unforgettable memories with our curated travel guides and lifestyle tips.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"primary","style":{"border":{"radius":"25px"},"spacing":{"padding":{"left":"2rem","right":"2rem","top":"0.75rem","bottom":"0.75rem"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-primary-background-color has-background wp-element-button" href="/blog" style="border-radius:25px;padding-top:0.75rem;padding-right:2rem;padding-bottom:0.75rem;padding-left:2rem">Start Exploring</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div></div>
<!-- /wp:cover -->

<!-- wp:spacer {"height":"4rem"} -->
<div style="height:4rem" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->

<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading {"textAlign":"center","level":2,"style":{"typography":{"fontSize":"2.5rem","fontWeight":"600"},"spacing":{"margin":{"bottom":"1rem"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="margin-bottom:1rem;font-size:2.5rem;font-weight:600">Why Choose Us</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"1.1rem"},"spacing":{"margin":{"bottom":"3rem"}}}} -->
<p class="has-text-align-center" style="margin-bottom:3rem;font-size:1.1rem">Everything you need for your perfect getaway</p>
<!-- /wp:paragraph -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=160&h=160&q=80" alt="Mountain landscape" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Expert Guides</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Curated by travel experts with years of experience exploring the world''s most beautiful destinations.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=160&h=160&q=80" alt="Compass on map" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Hidden Gems</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Discover off-the-beaten-path locations and authentic experiences that most tourists never find.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=160&h=160&q=80" alt="Heart hands at sunset" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Lifestyle Tips</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Practical advice for living well while traveling, from local cuisine to cultural etiquette and wellness.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

<!-- wp:spacer {"height":"2rem"} -->
<div style="height:2rem" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->'

HOME_ES_CONTENT='<!-- wp:cover {"url":"https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80","dimRatio":40,"overlayColor":"black","minHeight":60,"contentPosition":"center center","align":"full"} -->
<div class="wp-block-cover alignfull" style="min-height:60vh"><span aria-hidden="true" class="wp-block-cover__background has-black-background-color has-background-dim-40 has-background-dim"></span><img class="wp-block-cover__image-background" alt="" src="https://images.unsplash.com/photo-1488646953014-85cb44e25828?auto=format&fit=crop&w=1600&q=80" data-object-fit="cover"/><div class="wp-block-cover__inner-container"><!-- wp:group {"layout":{"type":"constrained","contentSize":"800px"}} -->
<div class="wp-block-group"><!-- wp:heading {"textAlign":"center","level":1,"style":{"typography":{"fontSize":"3.5rem","fontWeight":"700"}},"textColor":"white"} -->
<h1 class="wp-block-heading has-text-align-center has-white-color has-text-color" style="font-size:3.5rem;font-weight:700">Descubre Tu Próxima Aventura</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"1.25rem"}},"textColor":"white"} -->
<p class="has-text-align-center has-white-color has-text-color" style="font-size:1.25rem">Explora destinos increíbles, descubre joyas ocultas y crea recuerdos inolvidables con nuestras guías de viaje y consejos de estilo de vida.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"layout":{"type":"flex","justifyContent":"center"}} -->
<div class="wp-block-buttons"><!-- wp:button {"backgroundColor":"primary","style":{"border":{"radius":"25px"},"spacing":{"padding":{"left":"2rem","right":"2rem","top":"0.75rem","bottom":"0.75rem"}}}} -->
<div class="wp-block-button"><a class="wp-block-button__link has-primary-background-color has-background wp-element-button" href="/es/blog-es" style="border-radius:25px;padding-top:0.75rem;padding-right:2rem;padding-bottom:0.75rem;padding-left:2rem">Empezar a Explorar</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:group --></div></div>
<!-- /wp:cover -->

<!-- wp:spacer {"height":"4rem"} -->
<div style="height:4rem" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->

<!-- wp:group {"layout":{"type":"constrained"}} -->
<div class="wp-block-group"><!-- wp:heading {"textAlign":"center","level":2,"style":{"typography":{"fontSize":"2.5rem","fontWeight":"600"},"spacing":{"margin":{"bottom":"1rem"}}}} -->
<h2 class="wp-block-heading has-text-align-center" style="margin-bottom:1rem;font-size:2.5rem;font-weight:600">¿Por Qué Elegirnos?</h2>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"fontSize":"1.1rem"},"spacing":{"margin":{"bottom":"3rem"}}}} -->
<p class="has-text-align-center" style="margin-bottom:3rem;font-size:1.1rem">Todo lo que necesitas para tu escapada perfecta</p>
<!-- /wp:paragraph -->

<!-- wp:columns {"align":"wide"} -->
<div class="wp-block-columns alignwide"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=160&h=160&q=80" alt="Paisaje de montaña" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Guías Expertas</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Creadas por expertos en viajes con años de experiencia explorando los destinos más hermosos del mundo.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=160&h=160&q=80" alt="Brújula en mapa" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Joyas Ocultas</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Descubre lugares fuera de los caminos trillados y experiencias auténticas que la mayoría de turistas nunca encuentran.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:group {"style":{"spacing":{"padding":{"top":"2rem","bottom":"2rem","left":"1.5rem","right":"1.5rem"}},"border":{"radius":"12px"}},"backgroundColor":"light-gray","layout":{"type":"constrained"}} -->
<div class="wp-block-group has-light-gray-background-color has-background" style="border-radius:12px;padding-top:2rem;padding-right:1.5rem;padding-bottom:2rem;padding-left:1.5rem"><!-- wp:image {"align":"center","width":"80px","height":"80px","sizeSlug":"full","linkDestination":"none","style":{"border":{"radius":"50%"}}} -->
<figure class="wp-block-image aligncenter size-full is-resized" style="border-radius:50%"><img src="https://images.unsplash.com/photo-1544551763-46a013bb70d5?auto=format&fit=crop&w=160&h=160&q=80" alt="Manos formando corazón al atardecer" style="border-radius:50%;width:80px;height:80px"/></figure>
<!-- /wp:image -->

<!-- wp:heading {"textAlign":"center","level":3,"style":{"spacing":{"margin":{"top":"1rem","bottom":"1rem"}}}} -->
<h3 class="wp-block-heading has-text-align-center" style="margin-top:1rem;margin-bottom:1rem">Consejos de Estilo</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"align":"center","style":{"typography":{"lineHeight":"1.6"}}} -->
<p class="has-text-align-center" style="line-height:1.6">Consejos prácticos para vivir bien mientras viajas, desde gastronomía local hasta etiqueta cultural y bienestar.</p>
<!-- /wp:paragraph --></div>
<!-- /wp:group --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group -->

<!-- wp:spacer {"height":"2rem"} -->
<div style="height:2rem" aria-hidden="true" class="wp-block-spacer"></div>
<!-- /wp:spacer -->'

HOME_EN_ID="$(get_or_create_page home 'Home' "$HOME_EN_CONTENT")"
BLOG_EN_ID="$(get_or_create_page blog 'Blog' "$BLOG_LOOP")"
HOME_ES_ID="$(get_or_create_page inicio 'Inicio' "$HOME_ES_CONTENT")"
BLOG_ES_ID="$(get_or_create_page blog-es 'Blog' "$BLOG_LOOP")"   # keep Spanish blog at /es/blog-es

# -------------------------
# Media – upload ONLY the two local featured images (coffee & beach).
# Garden stays external-only.
# -------------------------
mkdir -p seeds
download_if_missing () { [[ -f "$1" ]] || curl -L --fail --silent --show-error "$2" -o "$1"; }

IMG_GARDEN_EXT="https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=70"
IMG_COFFEE_URL="https://images.unsplash.com/photo-1528909514045-2fa4ac7a08ba?auto=format&fit=crop&w=1600&q=70"
IMG_BEACH_URL="https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=1600&q=70"

download_if_missing seeds/coffee.jpg "$IMG_COFFEE_URL"
download_if_missing seeds/beach.jpg  "$IMG_BEACH_URL"

get_or_import_media () { # $1=title, $2=local path
  local id
  id="$(wp post list --post_type=attachment --s="$1" --field=ID --posts_per_page=1 | head -n1 || true)"
  [[ -n "$id" ]] || id="$(wp media import "$2" --title="$1" --porcelain)"
  echo "$id"
}

# Ensure uploads directory exists with current year/month
CURRENT_YEAR=$(date +%Y)
CURRENT_MONTH=$(date +%m)
UPLOAD_PATH="wp-content/uploads/${CURRENT_YEAR}/${CURRENT_MONTH}"
mkdir -p "$UPLOAD_PATH"

MEDIA_COFFEE_ID="$(get_or_import_media 'Coffee Large' seeds/coffee.jpg)"
MEDIA_BEACH_ID="$(get_or_import_media  'Beach Large'  seeds/beach.jpg)"

# Copy the actual files to where WordPress expects them (for file system access)
# This ensures the files are accessible via HTTP and can be downloaded by export scripts
cp seeds/coffee.jpg "${UPLOAD_PATH}/coffee-2.jpg" 2>/dev/null || true
cp seeds/beach.jpg "${UPLOAD_PATH}/beach-2.jpg" 2>/dev/null || true

# -------------------------
# Posts – rich text only (no inline images)
# Garden uses external FEATURED via _ext_featured_url (not uploaded).
# -------------------------
create_post_if_missing () {
  local slug="$1" title="$2" content="$3"
  local id
  id="$(wp post list --post_type=post --name="$slug" --field=ID --posts_per_page=1)"
  if [[ -z "$id" ]]; then
    id="$(wp post create --post_type=post --post_status=publish \
      --post_title="$title" --post_name="$slug" \
      --post_content="$content" --post_author="${AUTHOR_ID}" --porcelain)"
  else
    wp post update "$id" --post_title="$title" --post_content="$content" --post_author="${AUTHOR_ID}" >/dev/null
  fi
  echo "$id"
}


# EN contents
P1_EN_CONTENT='<!-- wp:heading --><h2>Start Small, Grow Joy</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Building a balcony garden is easier than it looks. With a few planters and a sunny spot, you can grow herbs, lettuce, and even small tomatoes.</p><!-- /wp:paragraph -->
<!-- wp:list --><ul><li>Pick 3–4 low-maintenance plants.</li><li>Use breathable fabric pots.</li><li>Water in the morning.</li></ul><!-- /wp:list -->
<!-- wp:paragraph --><p>While you water, read <a href="/how-to-brew-better-coffee/">How to Brew Better Coffee</a>.</p><!-- /wp:paragraph -->'
P2_EN_CONTENT='<!-- wp:heading --><h2>Dial In Your Daily Cup</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Good coffee is consistency: grind size, water temperature, and brew time. Start with a 1:16 ratio and adjust taste by taste.</p><!-- /wp:paragraph -->
<!-- wp:quote --><blockquote class="wp-block-quote"><p>Grind finer to increase extraction; coarser to reduce bitterness.</p><cite>Barista rule of thumb</cite></blockquote><!-- /wp:quote -->
<!-- wp:list --><ul><li>Grind: medium-fine</li><li>Water: 92–96°C</li><li>Bloom: 30–45s</li><li>Total: 2:30–3:00</li></ul><!-- /wp:list -->'
P3_EN_CONTENT='<!-- wp:heading --><h2>Sun, Sea, and Strolls</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Alicante shines on weekends: morning beach walk, lunch in the old town, and sunset at the castle.</p><!-- /wp:paragraph -->
<!-- wp:list --><ul><li>Postiguet beach early.</li><li>Mercado Central tapas.</li><li>Castillo de Santa Bárbara views.</li></ul><!-- /wp:list -->'

P1_EN_ID="$(create_post_if_missing building-a-tiny-garden "Building a Tiny Garden" "$P1_EN_CONTENT")"
P2_EN_ID="$(create_post_if_missing how-to-brew-better-coffee "How to Brew Better Coffee" "$P2_EN_CONTENT")"
P3_EN_ID="$(create_post_if_missing weekend-in-alicante "Weekend in Alicante" "$P3_EN_CONTENT")"

# ES contents
P1_ES_CONTENT='<!-- wp:heading --><h2>Empieza en pequeño, crece feliz</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Crear un mini jardín en el balcón es más fácil de lo que parece. Con unas macetas y un lugar soleado puedes cultivar hierbas y hortalizas.</p><!-- /wp:paragraph -->
<!-- wp:list --><ul><li>Elige 3–4 plantas fáciles.</li><li>Usa macetas de tela.</li><li>Riega por la mañana.</li></ul><!-- /wp:list -->
<!-- wp:paragraph --><p>Mientras riegas, lee <a href="/es/como-preparar-mejor-cafe/">Cómo preparar mejor café</a>.</p><!-- /wp:paragraph -->'
P2_ES_CONTENT='<!-- wp:heading --><h2>Clava tu taza diaria</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>El buen café es consistencia: molienda, temperatura del agua y tiempo de extracción. Empieza con ratio 1:16 y ajusta al gusto.</p><!-- /wp:paragraph -->
<!-- wp:quote --><blockquote class="wp-block-quote"><p>Muele más fino para extraer más; más grueso para reducir amargor.</p><cite>Regla barista</cite></blockquote><!-- /wp:quote -->
<!-- wp:list --><ul><li>Molienda: media-fina</li><li>Agua: 92–96°C</li><li>Bloom: 30–45s</li><li>Total: 2:30–3:00</li></ul><!-- /wp:list -->'
P3_ES_CONTENT='<!-- wp:heading --><h2>Sol, mar y paseos</h2><!-- /wp:heading -->
<!-- wp:paragraph --><p>Alicante brilla el finde: paseo mañanero por la playa, comer en el centro y atardecer en el castillo.</p><!-- /wp:paragraph -->
<!-- wp:list --><ul><li>Postiguet temprano.</li><li>Tapas en el Mercado Central.</li><li>Vistas desde Santa Bárbara.</li></ul><!-- /wp:list -->'

P1_ES_ID="$(create_post_if_missing como-crear-un-mini-jardin "Cómo crear un mini jardín" "$P1_ES_CONTENT")"
P2_ES_ID="$(create_post_if_missing como-preparar-mejor-cafe "Cómo preparar mejor café" "$P2_ES_CONTENT")"
P3_ES_ID="$(create_post_if_missing fin-de-semana-en-alicante "Fin de semana en Alicante" "$P3_ES_CONTENT")"

# Featured images:
# - Garden: external featured (no _thumbnail_id)
# - Coffee & Alicante: uploaded featured images
wp post meta delete "$P1_EN_ID" _thumbnail_id >/dev/null 2>&1 || true
wp post meta delete "$P1_ES_ID" _thumbnail_id >/dev/null 2>&1 || true
wp post meta update "$P1_EN_ID" _ext_featured_url "$IMG_GARDEN_EXT" >/dev/null 2>&1 || true
wp post meta update "$P1_ES_ID" _ext_featured_url "$IMG_GARDEN_EXT" >/dev/null 2>&1 || true

wp post meta update "$P2_EN_ID" _thumbnail_id "$MEDIA_COFFEE_ID"  >/dev/null 2>&1 || true
wp post meta update "$P3_EN_ID" _thumbnail_id "$MEDIA_BEACH_ID"   >/dev/null 2>&1 || true
wp post meta update "$P2_ES_ID" _thumbnail_id "$MEDIA_COFFEE_ID"  >/dev/null 2>&1 || true
wp post meta update "$P3_ES_ID" _thumbnail_id "$MEDIA_BEACH_ID"   >/dev/null 2>&1 || true

# -------------------------
# Polylang config & linking
# -------------------------
wp eval-file /scripts/polylang_setup.php

# ---- Category: Guides / Guías (EN/ES) + assign to 2 articles ----

# Create or get EN category (slug: guides)
GUIDES_EN_ID="$(wp term list category --slug=guides --field=term_id | head -n1 || true)"
if [ -z "$GUIDES_EN_ID" ]; then
  GUIDES_EN_ID="$(wp term create category 'Guides' --slug=guides --porcelain)"
fi

# Create or get ES category (slug: guias)
GUIDES_ES_ID="$(wp term list category --slug=guias --field=term_id | head -n1 || true)"
if [ -z "$GUIDES_ES_ID" ]; then
  GUIDES_ES_ID="$(wp term create category 'Guías' --slug=guias --porcelain)"
fi

# Link the two categories as Polylang translations
cat > /tmp/link_term_translations.php <<'PHP'
<?php
if (function_exists('pll_set_term_language')) {
  $en = (int) getenv('GUIDES_EN_ID');
  $es = (int) getenv('GUIDES_ES_ID');
  if ($en) pll_set_term_language($en,'en');
  if ($es) pll_set_term_language($es,'es');
  if ($en && $es && function_exists('pll_save_term_translations')) {
    pll_save_term_translations(['en'=>$en,'es'=>$es]);
  }
}
PHP
GUIDES_EN_ID="$GUIDES_EN_ID" GUIDES_ES_ID="$GUIDES_ES_ID" wp eval-file /tmp/link_term_translations.php
rm -f /tmp/link_term_translations.php

# Assign category to two articles (Garden + Coffee) in both languages
wp post update "$P1_EN_ID" --post_category="$GUIDES_EN_ID" >/dev/null
wp post update "$P2_EN_ID" --post_category="$GUIDES_EN_ID" >/dev/null
wp post update "$P1_ES_ID" --post_category="$GUIDES_ES_ID" >/dev/null
wp post update "$P2_ES_ID" --post_category="$GUIDES_ES_ID" >/dev/null


# -------------------------
# Install Block Exporter
# -------------------------
echo "==> Installing WordPress Block Exporter..."

# Ensure mu-plugins directory exists
mkdir -p /var/www/html/wp-content/mu-plugins

# Copy the block exporter plugin
if cp /scripts/wp_block_exporter.php /var/www/html/wp-content/mu-plugins/; then
    chmod 644 /var/www/html/wp-content/mu-plugins/wp_block_exporter.php
    echo "   ✓ Block exporter file copied successfully"
else
    echo "   ⚠️  Failed to copy block exporter file"
    echo "   ℹ️  Make sure the scripts directory is properly mounted"
    exit 1
fi

# Test block exporter endpoints (using the wordpress service name for internal communication)
echo "   Testing block exporter endpoints..."
sleep 3  # Give WordPress time to load the mu-plugin

# Try to access the endpoint from within the container network
BLOCK_TEST=$(curl -s "http://wordpress/wp-json/wp/v2/block-schemas" 2>/dev/null || echo "")
if [[ $BLOCK_TEST == *"total_schemas"* ]] || [[ $BLOCK_TEST == *"block_types"* ]]; then
    echo "   ✓ Block exporter installed and working correctly"
else
    echo "   ⚠️  Block exporter endpoints not responding as expected"
    echo "   ℹ️  This might be normal if WordPress is still initializing"
    echo "   ℹ️  You can test manually: curl http://localhost:8080/wp-json/wp/v2/block-schemas"
fi

# -------------------------
# Final flush
# -------------------------
wp rewrite flush --hard
echo "==> Done!"
