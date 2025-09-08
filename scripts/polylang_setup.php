<?php
// Run with: wp eval-file /scripts/polylang_setup.php
if (!class_exists('WP_CLI')) {
    fwrite(STDERR, "WP-CLI required\n");
    exit(1);
}
if (!function_exists('pll_set_post_language')) {
    WP_CLI::error('Polylang not loaded.');
}

function by_slug($slug, $type = 'page')
{
    $p = get_page_by_path($slug, OBJECT, $type);
    return $p ? $p->ID : 0;
}
function link_tr($map)
{
    foreach ($map as $lang => $id) {
        if ($id) pll_set_post_language($id, $lang);
    }
    if (function_exists('pll_save_post_translations')) pll_save_post_translations($map);
}

$pll = PLL();
$ensure = function ($slug, $name, $locale, $flag) use ($pll) {
    if (!term_exists($slug, 'language')) {
        $pll->model->add_language(['slug' => $slug, 'name' => $name, 'locale' => $locale, 'rtl' => 0, 'flag' => $flag, 'term_group' => 0]);
    }
};
$ensure('en', 'English', 'en_US', 'gb');
$ensure('es', 'Español', 'es_ES', 'es');

$opts = (array) get_option('polylang', []);
$opts['default_lang']   = 'en'; // EN default
$opts['force_lang']     = 1;    // directories
$opts['hide_default']   = 1;    // EN visible at "/"
$opts['detect_browser'] = 0;    // no browser redirect
$opts['redirect_home']  = 0;    // don't redirect "/" to last language
update_option('polylang', $opts);

// Pages
$home_en = by_slug('home', 'page');
$home_es = by_slug('inicio', 'page');
$blog_en = by_slug('blog', 'page');
$blog_es = by_slug('blog-es', 'page');

pll_set_post_language($home_en, 'en');
pll_set_post_language($home_es, 'es');
pll_set_post_language($blog_en, 'en');
pll_set_post_language($blog_es, 'es');

link_tr(['en' => $home_en, 'es' => $home_es]);
link_tr(['en' => $blog_en, 'es' => $blog_es]);

// Static front page on EN; DO NOT set page_for_posts (block themes)
update_option('show_on_front', 'page');
update_option('page_on_front', $home_en);
update_option('page_for_posts', 0);

// Link post translations
$pair = function ($en, $es) {
    $e = by_slug($en, 'post');
    $s = by_slug($es, 'post');
    if ($e || $s) link_tr(['en' => $e, 'es' => $s]);
};
$pair('building-a-tiny-garden', 'como-crear-un-mini-jardin');
$pair('how-to-brew-better-coffee', 'como-preparar-mejor-cafe');
$pair('weekend-in-alicante', 'fin-de-semana-en-alicante');

flush_rewrite_rules(true);
WP_CLI::success('Polylang: cookie disabled, EN=/ simple text home, Blog EN=/blog, Blog ES=/es/blog-es; posts linked. Garden uses external inline image only.');
