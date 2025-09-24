import { exportWordPressContent } from '@migration/export';

export default function createPlugin(context) {
  const { logger } = context;

  return {
    actions: {
      export: async (options) => {
        logger.info('🚀 Starting WordPress export...');

        try {
          await exportWordPressContent({
            languages: options.languages,
            multipleFiles: options.multipleFiles,
            status: options.status,
            outputDir: options.outputDir,
            wordpressUrl: options.wordpressUrl
          });
          logger.info('✅ WordPress export completed successfully!');
        } catch (error) {
          logger.error('❌ Export failed:', error.message);
          throw error;
        }
      }
    }
  };
}
