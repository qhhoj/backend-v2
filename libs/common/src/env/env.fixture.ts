export const validEnv = {
  MONGO_URL: 'mongodb://localhost/qhhoj',
  REDIS_URL: 'redis://localhost:6379',
  ENCRYPTION_KEY: 'ab'.repeat(32),
  TOKEN_SECRET: 'x'.repeat(32),
  SITE_URL: 'http://localhost:3000',
  SMTP_URL: 'smtp://localhost:1025',
  MEDIA_ROOT: '/var/lib/qhhoj/media',
  PROBLEM_DATA_ROOT: '/var/lib/qhhoj/problems',
  PDF_CACHE_ROOT: '/var/lib/qhhoj/pdf-cache',
  PDF_RENDER_TIMEOUT_MS: '30000',
  PDF_MAX_BYTES: '52428800',
  PDF_CONCURRENCY: '2',
};
