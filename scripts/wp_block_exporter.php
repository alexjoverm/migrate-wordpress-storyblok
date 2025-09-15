<?php

/**
 * WordPress Block Schema and Content Exporter
 * 
 * This script provides endpoints and functions to export:
 * 1. All registered block types with their schemas
 * 2. Parse content blocks from any content using WordPress core functions
 * 
 * Usage:
 * - wp-json/wp/v2/block-schemas - Get all registered block schemas
 * - wp-json/wp/v2/parse-blocks?content=... - Parse blocks from content
 * 
 * This approach uses WordPress core functions (no plugins needed) and provides
 * a clean API for external tools to consume block data.
 */

// Prevent direct access
if (!defined('ABSPATH')) {
    exit;
}

class WP_Block_Exporter
{

    public function __construct()
    {
        add_action('rest_api_init', array($this, 'register_rest_routes'));
    }

    /**
     * Register REST API routes for block export
     */
    public function register_rest_routes()
    {
        // Endpoint to get all registered block schemas
        register_rest_route('wp/v2', '/block-schemas', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_block_schemas'),
            'permission_callback' => '__return_true' // Public endpoint
        ));

        // Endpoint to parse blocks from content
        register_rest_route('wp/v2', '/parse-blocks', array(
            'methods' => 'GET',
            'callback' => array($this, 'parse_content_blocks'),
            'permission_callback' => '__return_true', // Public endpoint
            'args' => array(
                'content' => array(
                    'required' => true,
                    'type' => 'string',
                    'description' => 'The content to parse blocks from'
                )
            )
        ));

        // Endpoint to get enhanced posts with block data
        register_rest_route('wp/v2', '/posts-with-blocks', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_posts_with_blocks'),
            'permission_callback' => '__return_true',
            'args' => array(
                'per_page' => array(
                    'default' => 10,
                    'type' => 'integer'
                ),
                'page' => array(
                    'default' => 1,
                    'type' => 'integer'
                ),
                'lang' => array(
                    'default' => '',
                    'type' => 'string'
                )
            )
        ));

        // Endpoint to get enhanced pages with block data
        register_rest_route('wp/v2', '/pages-with-blocks', array(
            'methods' => 'GET',
            'callback' => array($this, 'get_pages_with_blocks'),
            'permission_callback' => '__return_true',
            'args' => array(
                'per_page' => array(
                    'default' => 10,
                    'type' => 'integer'
                ),
                'page' => array(
                    'default' => 1,
                    'type' => 'integer'
                ),
                'lang' => array(
                    'default' => '',
                    'type' => 'string'
                )
            )
        ));
    }

    /**
     * Get all registered block types and their schemas
     */
    public function get_block_schemas($request)
    {
        $block_types = array();
        $registry = WP_Block_Type_Registry::get_instance();

        foreach ($registry->get_all_registered() as $block_name => $block_type) {
            $block_types[$block_name] = array(
                'name' => $block_name,
                'title' => $block_type->title ?? $block_name,
                'description' => $block_type->description ?? '',
                'category' => $block_type->category ?? 'common',
                'icon' => $block_type->icon ?? '',
                'keywords' => $block_type->keywords ?? array(),
                'supports' => $block_type->supports ?? array(),
                'attributes' => $block_type->attributes ?? array(),
                'example' => $block_type->example ?? null,
                'variations' => $block_type->variations ?? array(),
                'parent' => $block_type->parent ?? null,
                'ancestor' => $block_type->ancestor ?? null,
            );
        }

        return rest_ensure_response(array(
            'timestamp' => current_time('c'),
            'wordpress_version' => get_bloginfo('version'),
            'source' => get_site_url(),
            'total_schemas' => count($block_types),
            'block_types' => $block_types,
            'export_method' => 'wordpress_core_api'
        ));
    }

    /**
     * Parse blocks from content using WordPress core function
     */
    public function parse_content_blocks($request)
    {
        $content = $request->get_param('content');

        if (empty($content)) {
            return new WP_Error('missing_content', 'Content parameter is required', array('status' => 400));
        }

        $parsed_blocks = $this->parse_blocks_from_content($content);

        return rest_ensure_response(array(
            'content_length' => strlen($content),
            'block_count' => count($parsed_blocks),
            'blocks' => $parsed_blocks
        ));
    }

    /**
     * Get posts with enhanced block data
     */
    public function get_posts_with_blocks($request)
    {
        $per_page = $request->get_param('per_page');
        $page = $request->get_param('page');
        $lang = $request->get_param('lang');

        $args = array(
            'post_type' => 'post',
            'post_status' => 'publish',
            'posts_per_page' => $per_page,
            'paged' => $page,
            'orderby' => 'date',
            'order' => 'DESC'
        );

        $posts = get_posts($args);
        $enhanced_posts = array();

        foreach ($posts as $post) {
            $post_data = $this->prepare_post_for_response($post);
            $enhanced_posts[] = $post_data;
        }

        return rest_ensure_response($enhanced_posts);
    }

    /**
     * Get pages with enhanced block data
     */
    public function get_pages_with_blocks($request)
    {
        $per_page = $request->get_param('per_page');
        $page = $request->get_param('page');

        $args = array(
            'post_type' => 'page',
            'post_status' => 'publish',
            'posts_per_page' => $per_page,
            'paged' => $page,
            'orderby' => 'menu_order',
            'order' => 'ASC'
        );

        $posts = get_posts($args);
        $enhanced_pages = array();

        foreach ($posts as $post) {
            $page_data = $this->prepare_post_for_response($post);
            $enhanced_pages[] = $page_data;
        }

        return rest_ensure_response($enhanced_pages);
    }

    /**
     * Prepare a post/page for API response with block data
     */
    private function prepare_post_for_response($post)
    {
        $content = $post->post_content;
        $parsed_blocks = $this->parse_blocks_from_content($content);

        return array(
            'id' => $post->ID,
            'date' => $post->post_date,
            'date_gmt' => $post->post_date_gmt,
            'modified' => $post->post_modified,
            'modified_gmt' => $post->post_modified_gmt,
            'slug' => $post->post_name,
            'status' => $post->post_status,
            'type' => $post->post_type,
            'link' => get_permalink($post->ID),
            'title' => array(
                'rendered' => get_the_title($post->ID),
                'raw' => $post->post_title
            ),
            'content' => array(
                'rendered' => apply_filters('the_content', $content),
                'raw' => $content,
                'protected' => false
            ),
            'excerpt' => array(
                'rendered' => apply_filters('the_excerpt', $post->post_excerpt),
                'raw' => $post->post_excerpt,
                'protected' => false
            ),
            'author' => $post->post_author,
            'featured_media' => get_post_thumbnail_id($post->ID),
            'comment_status' => $post->comment_status,
            'ping_status' => $post->ping_status,
            'sticky' => is_sticky($post->ID),
            'template' => get_page_template_slug($post->ID),
            'format' => get_post_format($post->ID) ?: 'standard',
            // Enhanced block data
            'blocks' => $parsed_blocks,
            'has_blocks' => !empty($parsed_blocks),
            'block_count' => count($parsed_blocks),
            // Additional metadata
            'categories' => wp_get_post_categories($post->ID),
            'tags' => wp_get_post_tags($post->ID, array('fields' => 'ids')),
        );
    }

    /**
     * Parse blocks from content and clean the data
     */
    private function parse_blocks_from_content($content)
    {
        if (empty($content)) {
            return array();
        }

        // Use WordPress's native block parser
        $blocks = parse_blocks($content);

        // Clean and filter blocks
        $parsed_blocks = array_values(array_filter(
            array_map(array($this, 'clean_block_data'), $blocks),
            function ($block) {
                return $block !== null;
            }
        ));

        return $parsed_blocks;
    }

    /**
     * Clean and structure block data for export
     */
    private function clean_block_data($block)
    {
        // Skip empty blocks (like whitespace-only blocks)
        if (empty($block['blockName']) && trim($block['innerHTML'] ?? '') === '') {
            return null;
        }

        $clean_block = array(
            'blockName' => $block['blockName'],
            'attributes' => $block['attrs'] ?? array(),
            'innerContent' => $block['innerContent'] ?? array(),
            'innerHTML' => $block['innerHTML'] ?? '',
        );

        // Recursively clean inner blocks
        if (!empty($block['innerBlocks'])) {
            $clean_inner_blocks = array_values(array_filter(
                array_map(array($this, 'clean_block_data'), $block['innerBlocks']),
                function ($inner_block) {
                    return $inner_block !== null;
                }
            ));
            if (!empty($clean_inner_blocks)) {
                $clean_block['innerBlocks'] = $clean_inner_blocks;
            }
        }

        return $clean_block;
    }
}

// Initialize the block exporter
new WP_Block_Exporter();
