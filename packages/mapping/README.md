# WordPress to Storyblok Mapping Library

A comprehensive, production-ready library for transforming exported WordPress content into Storyblok format. This library provides advanced tools for mapping posts, pages, media, taxonomies, and custom content types with full control over the transformation process, internationalization strategies, and field transformations.

## ✨ Features

- **🔧 Comprehensive Configuration**: JavaScript configuration with extensive customization options
- **🌐 Advanced i18n Support**: Field-level and folder-level translation strategies
- **🔄 Field Transformers**: Rich transformation system (richtext, asset, reference, tags, datetime, link)
- **📖 Story Organization**: Flexible output formats (separate/combined) with path preservation
- **🧱 Component Generation**: Use predefined schemas or auto-generate from WordPress blocks
- **🪝 Extensible Hooks**: Custom logic integration at any point in the process
- **📊 Multiple Data Formats**: Support various exported data structures and organizations
- **�️ Smart Asset Handling**: External asset extraction with WordPress DAM integration
- **📋 CLI v4 Compatible**: Output structure ready for Storyblok CLI v4

## 🚀 Quick Start

### 1. Installation

```bash
pnpm install
```

### 2. Configuration

Create your mapping configuration:

```bash
cp mapping.config.js your-project.config.js
```

### 3. Basic Configuration Example

```javascript
export default {
  // Space configuration
  space: {
    name: 'my-project',
    datasources: {
      folder: 'my-project', // CLI v4 space-specific folder
      format: 'separate'     // 'separate' or 'combined'
    }
  },

  // i18n strategy
  i18n: {
    strategy: 'field_level', // 'field_level' or 'folder_level'
    defaultLanguage: 'en',
    languages: {
      en: { name: 'English', prefix: '', suffix: '' },
      es: { name: 'Spanish', prefix: 'es', suffix: '_es' }
    }
  },

  // Story organization
  stories: {
    format: 'separate',    // 'separate' or 'combined'
    preservePath: true,    // Maintain WordPress folder structure
    folderMapping: {
      '/blog/': 'articles',
      '/pages/': 'pages'
    }
  },

  // Content types with field transformers
  contentTypes: {
    articles: {
      component: 'article',
      folder: 'blog',
      fields: {
        title: 'string',
        content: 'richtext',
        excerpt: 'string',
        featured_image: 'asset',
        author: 'reference',
        categories: 'references',
        published_at: 'datetime'
      }
    },
    pages: {
      component: 'page',
      folder: 'pages',
      fields: {
        title: 'string',
        content: 'richtext',
        featured_image: 'asset'
      }
    }
  }
};
```

### 4. Run Mapping

```bash
# Using the mapping script
node examples/map-content.js

# With custom config
CONFIG_PATH=./your-project.config.js pnpm run map
```

## 📋 Configuration Guide

### 🌐 Internationalization Strategies

Choose between two powerful i18n approaches:

#### Field-Level Strategy (Recommended)
Single stories with language-specific field values:

```javascript
i18n: {
  strategy: 'field_level',
  defaultLanguage: 'en',
  languages: {
    en: { name: 'English', suffix: '' },
    es: { name: 'Spanish', suffix: '_es' }
  }
}
```

**Output:** `stories.json`, `stories_es.json`

#### Folder-Level Strategy
Separate folders for each language:

```javascript
i18n: {
  strategy: 'folder_level',
  defaultLanguage: 'en',
  languages: {
    en: { name: 'English', prefix: '' },
    es: { name: 'Spanish', prefix: 'es' }
  }
}
```

**Output:** `en/stories.json`, `es/stories.json`

### 📖 Story Organization

Control how stories are organized and structured:

```javascript
stories: {
  format: 'separate',        // 'separate' = individual files, 'combined' = single file
  preservePath: true,        // Maintain WordPress folder structure
  folderMapping: {           // Custom path mappings
    '/blog/': 'articles',
    '/news/': 'news',
    '/pages/': 'pages'
  }
}
```

### 🔧 Field Transformers

Comprehensive field transformation system:

#### String-Based Transformers
```javascript
fields: {
  content: 'richtext',      // HTML → Storyblok richtext
  image: 'asset',           // URL/ID → Storyblok asset
  author: 'reference',      // ID → Story reference
  categories: 'references', // IDs → Multiple references  
  tags: 'tags',             // Array → Tag objects
  date: 'datetime',         // Date → ISO string
  url: 'link'               // URL → Link object
}
```

#### Object-Based Transformers
```javascript
fields: {
  content: {
    source: 'post_content',     // WordPress field
    transformer: 'richtext',    // Transformation type
    options: {
      extractExternal: true,    // Extract external assets
      convertLinks: true        // Convert to link objects
    }
  },
  custom_field: {
    source: 'acf.custom_field',
    transformer: 'string',
    default: '',
    condition: (post) => post.acf?.custom_field
  }
}
```

#### Function-Based Transformers
```javascript
fields: {
  computed_field: (wpContent, context) => {
    const { language, post } = context;
    return `${language}: ${wpContent.title.rendered}`;
  },
  
  complex_transformation: {
    transformer: (value, context) => {
      const { post, wordpressData, language, options, utils } = context;
      
      // Use utilities
      const slug = utils.slugify(value);
      const uid = utils.generateUID();
      
      return {
        processed_value: slug,
        meta: { uid, language }
      };
    }
  }
}
```

### 🖼️ Asset Handling

Smart asset processing with WordPress DAM integration:

```javascript
// Global transformer configuration
transformers: {
  richtext: {
    extractExternal: true,      // Extract external assets only
    convertLinks: true,
    preserveFormatting: true
  },
  asset: {
    uploadExternal: true,
    preserveStructure: true
  }
},

// Asset extraction settings
assets: {
  downloadPath: './mapped-data/assets',
  preserveStructure: false,
  generateManifest: true
}
```

**Asset Processing Logic:**
- ✅ **External URLs** (CDNs, Unsplash, etc.) → Extracted and processed
- ❌ **WordPress Media Library** → Already handled by export script (avoided duplication)

### 📊 Content Types Configuration

Map WordPress content to Storyblok components:

```javascript
contentTypes: {
  // WordPress posts → Storyblok articles
  articles: {
    component: 'article',
    folder: 'blog',
    fields: {
      // Simple field mappings
      title: 'string',
      excerpt: 'string',
      
      // Complex transformations
      content: {
        source: 'content.rendered',
        transformer: 'richtext',
        options: { extractExternal: true }
      },
      
      // Reference transformations
      author: {
        source: 'author',
        transformer: 'reference'
      },
      
      // Multiple references
      categories: {
        source: 'categories', 
        transformer: 'references'
      },
      
      // Asset transformations
      featured_image: {
        source: 'featured_media',
        transformer: 'asset',
        condition: (post) => post.featured_media > 0
      }
    }
  },
  
  // WordPress pages → Storyblok pages  
  pages: {
    component: 'page',
    folder: 'pages',
    fields: {
      title: 'string',
      content: 'richtext',
      parent: {
        source: 'parent',
        transformer: 'reference'  // Self-reference for hierarchy
      }
    }
  },
  
  // Custom post types
  products: {
    component: 'product',
    folder: 'products',
    fields: {
      name: { source: 'title.rendered', transformer: 'string' },
      description: { source: 'content.rendered', transformer: 'richtext' },
      price: { source: 'acf.price', transformer: 'string' },
      gallery: { source: 'acf.gallery', transformer: 'references' }
    }
  }
}
```

## 🏗️ Output Structure

### CLI v4 Compatible Structure

The library generates output compatible with Storyblok CLI v4:

```
mapped-data/
├── stories.json              # Default language stories
├── stories_es.json           # Spanish stories (field-level i18n)
├── assets.json               # WordPress media assets
├── components.json           # Component schemas
├── datasources.json          # Default language datasources  
├── datasources_es.json       # Spanish datasources
├── my-project/               # Space-specific folder (if configured)
│   ├── datasources.json      # Space datasources
│   └── datasources_es.json   # Space Spanish datasources
├── assets/                   # External assets
│   ├── external-assets-manifest.json
│   ├── images/
│   │   ├── abc123_beach.jpg
│   │   └── def456_coffee.jpg
│   └── videos/
└── mapping-summary.json      # Comprehensive mapping report
```

### Folder-Level i18n Structure

```
mapped-data/
├── en/
│   ├── stories.json
│   └── datasources.json
├── es/
│   ├── stories.json  
│   └── datasources.json
├── assets.json
├── components.json
└── mapping-summary.json
```

## 🧰 Advanced Features

### Component Schema Integration

Define Storyblok components in `components.js`:

```javascript
export const defaultComponents = {
  article: {
    display_name: 'Article',
    is_root: true,
    schema: {
      title: {
        type: 'text',
        translatable: true,
        required: true
      },
      content: {
        type: 'richtext', 
        translatable: true
      },
      author: {
        type: 'option',
        source: 'internal_stories',
        folder_slug: 'authors'
      }
    }
  }
};
```

### Hook System

Add custom logic at key points:

```javascript
hooks: {
  beforeMapping: [
    (data, context) => {
      console.log('Starting mapping process...');
    }
  ],
  afterStoryMapping: [
    (stories, context) => {
      // Custom post-processing
      return stories.map(story => ({
        ...story,
        custom_field: 'processed'
      }));
    }
  ]
}
```

### Custom Transformers

Create custom field transformers:

```javascript
// In configuration
fields: {
  custom_date: {
    transformer: (value, context) => {
      const date = new Date(value);
      return {
        formatted: date.toLocaleDateString(),
        iso: date.toISOString(),
        timestamp: date.getTime()
      };
    }
  }
}
```

## 📊 Migration Reporting

Comprehensive mapping statistics and reporting:

```json
{
  "generatedAt": "2025-09-23T10:30:00Z",
  "duration": 45000,
  "configuration": {
    "i18nStrategy": "field_level",
    "storyFormat": "separate", 
    "preservePath": true,
    "contentTypes": ["articles", "pages"],
    "languages": ["en", "es"]
  },
  "mapping": {
    "stories": {
      "totalStories": 150,
      "storiesByLanguage": { "en": 75, "es": 75 },
      "storiesByContentType": { "articles": 100, "pages": 50 }
    },
    "assets": {
      "wordpress": 200,
      "external": { "totalAssets": 25 }
    },
    "datasources": 15,
    "components": 5
  }
}
```

## 🛠️ API Reference

### Main Mapper Class

```javascript
import { WordPressToStoryblokMapper } from '@migration/mapping';

const mapper = new WordPressToStoryblokMapper('./config.js');

// Complete mapping process
await mapper.mapAll(inputDir, outputDir);

// Individual operations
await mapper.initialize();
await mapper.loadWordPressData(inputDir);
await mapper.mapComponents(outputDir);
await mapper.mapAssets(outputDir);
await mapper.mapDatasources(outputDir);
```

### Individual Mappers

```javascript
import { 
  StoryMapper, 
  AssetMapper, 
  DatasourceMapper,
  FieldTransformer 
} from '@migration/mapping';

// Advanced story mapping
const storyMapper = new StoryMapper(config);
const stories = await storyMapper.mapStories(wpData, 'en');
await storyMapper.saveStories(outputDir);

// Field transformation
const fieldTransformer = new FieldTransformer(config);
const richtext = await fieldTransformer.transform(
  htmlContent, 
  'richtext', 
  context
);
```

## 🚀 Performance & Best Practices

### Configuration Optimization

1. **Choose the Right i18n Strategy**
   - Use `field_level` for content managed in single Storyblok stories
   - Use `folder_level` for traditional multilingual WordPress sites

2. **Optimize Field Transformers**
   - Use string transformers for simple cases
   - Reserve function transformers for complex logic
   - Cache expensive operations

3. **Asset Strategy** 
   - Enable `extractExternal: true` only if you have external assets
   - Configure appropriate `maxFileSize` and `timeout` limits

### Error Handling

```javascript
// Configuration with error handling
export default {
  advanced: {
    errorHandling: {
      continueOnError: true,    // Don't stop on individual item errors
      logErrors: true,          // Log errors for debugging
      maxErrors: 10             // Stop after too many errors
    }
  }
};
```

## 🔧 Troubleshooting

### Common Issues

**HTML not converting to richtext:**
- Verify `@storyblok/richtext` is installed
- Check HTML structure validity
- Enable debug logging

**Missing author references:**
- Ensure users data is loaded
- Check `reference` transformer configuration
- Verify WordPress export includes user data

**External assets not extracting:**
- Confirm `extractExternal: true` in richtext transformer
- Check asset URL patterns (external vs WordPress media)
- Review network connectivity and timeouts

### Debug Mode

```bash
# Enable debug logging
DEBUG=mapping:* CONFIG_PATH=./config.js pnpm run map

# Specific component debugging  
DEBUG=mapping:transformer CONFIG_PATH=./config.js pnpm run map
```

## 🤝 Contributing

The library is designed for extensibility:

1. **Add Transformers**: Create new transformer classes in `src/transformers/`
2. **Extend Mappers**: Add functionality in `src/core/`  
3. **Update Configuration**: Modify schema in `src/config/`
4. **Add Components**: Update `components.js` with new schemas

## 📝 Migration from Legacy Versions

### Key Changes in Current Version

1. **postTypes → contentTypes**: Update configuration property names
2. **Enhanced i18n**: Choose between `field_level` and `folder_level` strategies  
3. **Field Transformers**: New comprehensive transformation system
4. **Story Organization**: Added format and path preservation options
5. **CLI v4 Support**: Updated output structure compatibility

### Migration Steps

```javascript
// Old configuration
export default {
  postTypes: { /* ... */ }  // ❌ Deprecated
};

// New configuration  
export default {
  contentTypes: { /* ... */ }  // ✅ Current
};
```

## 📄 License

MIT License - feel free to use and modify for your projects.

---

## 📚 Additional Resources

- **[Configuration Examples](./docs/configuration-guide.md)** - Comprehensive configuration examples
- **[Asset Extraction Guide](./docs/asset-extraction.md)** - External asset handling details  
- **[All Configuration Options](./docs/all-configuration-options.md)** - Complete reference
