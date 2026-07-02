/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pdf-parse'],
  turbopack: {
    root: __dirname,
  },
}

module.exports = nextConfig
