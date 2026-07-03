/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pdf-parse'],
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
