import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from '@rsbuild/core'
import { pluginReact } from '@rsbuild/plugin-react'
import { pluginTailwindcss } from '@rsbuild/plugin-tailwindcss'
import { tanstackRouter } from '@tanstack/router-plugin/rspack'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ envMode }) => {
  const env = loadEnv({ mode: envMode, prefixes: ['VITE_'] })
  const serverUrl =
    process.env.VITE_REACT_APP_SERVER_URL ||
    env.rawPublicVars.VITE_REACT_APP_SERVER_URL ||
    'http://localhost:3000'

  const isProd = envMode === 'production'
  const portal = process.env.NEW_API_WEB_SURFACE === 'portal'
  const devProxy = Object.fromEntries(
    (['/api', '/v1', '/mj', '/pg'] as const).map((key) => [
      key,
      { target: serverUrl, changeOrigin: true },
    ])
  ) as Record<string, { target: string; changeOrigin: boolean }>

  return {
    plugins: [pluginReact(), pluginTailwindcss({ optimize: false })],
    // Rsbuild 2: replaces deprecated `performance.chunkSplit` (RSPack 2 aligned)
    splitChunks: {
      preset: 'default',
      cacheGroups: {
        'vendor-react': {
          test: /node_modules[\\/](react|react-dom)[\\/]/,
          name: 'vendor-react',
          chunks: 'all',
          priority: 0,
          enforce: true,
        },
        'vendor-ui-primitives': {
          test: /node_modules[\\/](@base-ui|@radix-ui)[\\/]/,
          name: 'vendor-ui-primitives',
          chunks: 'all',
          priority: 0,
          enforce: true,
        },
        'vendor-tanstack': {
          test: /node_modules[\\/]@tanstack[\\/]/,
          name: 'vendor-tanstack',
          chunks: 'all',
          priority: 0,
          enforce: true,
        },
      },
    },
    source: {
      define: { 'import.meta.env.PORTAL_ONLY': JSON.stringify(portal) },
      entry: {
        index: './src/main.tsx',
      },
    },
    resolve: {
      aliasStrategy: 'prefer-alias',
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@app-route-tree': path.resolve(
          __dirname,
          portal ? './src/routeTree.portal.gen.js' : './src/routeTree.gen.ts'
        ),
      },
    },
    html: {
      template: './index.html',
      favicon: './public/favicon.ico',
      meta: { 'new-api-surface': portal ? 'portal' : 'full' },
    },
    server: {
      host: '0.0.0.0',
      strictPort: false,
      proxy: devProxy,
    },
    output: {
      // Production optimizations
      minify: isProd,
      target: 'web',
      distPath: {
        root: portal ? 'dist-portal' : 'dist',
      },
      // Rely on Rsbuild default legalComments ("linked" → per-chunk *.LICENSE.txt) in all modes.
      // Do not set "none" in production: that strips minifier-preserved third-party notices and
      // extracted license files, which some distributions require for open-source compliance.
    },
    performance: {
      // Remove console in production
      removeConsole: isProd ? ['log'] : false,
      buildCache: false,
    },
    tools: {
      rspack: {
        plugins: [
          tanstackRouter({
            target: 'react',
            ...(portal
              ? {
                  generatedRouteTree: './src/routeTree.portal.gen.ts',
                  disableTypes: true,
                  routeFileIgnorePattern:
                    '^(?!(?:__root\\.tsx|index\\.tsx|route\\.tsx|_authenticated|\\(auth\\)|\\(errors\\)|dashboard|playground|chat|chat2link\\.tsx|\\$chatId\\.tsx|keys|usage\\-logs|wallet|profile|security|pricing|\\$modelId|about|rankings|oauth|user|privacy\\-policy\\.tsx|user\\-agreement\\.tsx|forgot\\-password\\.tsx|oauth\\.tsx|otp\\.tsx|register\\.tsx|reset\\.tsx|sign\\-in\\.tsx|sign\\-up\\.tsx|401\\.tsx|403\\.tsx|404\\.tsx|500\\.tsx|503\\.tsx|\\$section\\.tsx|\\$provider\\.tsx|audit\\.tsx|errors|\\$error\\.tsx)$)',
                }
              : {}),
            // Dev: avoid per-route async chunks (reduces white flash on navigation + faster HMR feedback).
            // Prod: keep route-based code splitting.
            autoCodeSplitting: isProd,
          }),
        ],
      },
    },
  }
})
