import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import {
  headTags,
  jsonLd,
  llmsFullTxt,
  llmsTxt,
  noscriptBody,
  robotsTxt,
  sitemapXml,
} from './src/data/seo'

// Served from https://imshaikot.github.io/browsentic/ — every asset URL needs that prefix.
// Override with BASE_PATH=/ when serving from a custom domain at the apex.
const base = process.env.BASE_PATH ?? '/browsentic/'
const origin = process.env.SITE_ORIGIN ?? 'https://imshaikot.github.io'
const siteUrl = new URL(base, origin).href

/**
 * The page is client rendered, so without this a crawler that does not run JavaScript
 * reads an empty root div. Head tags, JSON-LD, the no-JS body mirror and the machine
 * files are all generated from src/data/content.ts, the same source the page renders.
 */
function seo(): Plugin {
  return {
    name: 'browsentic-seo',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html
          .replace('<!--seo:head-->', headTags(siteUrl))
          .replace(
            '<!--seo:jsonld-->',
            `<script type="application/ld+json">${jsonLd(siteUrl)}</script>`,
          )
          .replace('<!--seo:body-->', `<noscript>\n      ${noscriptBody(siteUrl)}\n    </noscript>`),
    },
    generateBundle() {
      const lastmod = new Date().toISOString().slice(0, 10)
      const files: Record<string, string> = {
        'llms.txt': llmsTxt(siteUrl),
        'llms-full.txt': llmsFullTxt(siteUrl),
        'sitemap.xml': sitemapXml(siteUrl, lastmod),
        'robots.txt': robotsTxt(siteUrl),
      }
      for (const [fileName, source] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName, source })
      }
    },
  }
}

export default defineConfig({
  base,
  plugins: [react(), tailwindcss(), seo()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
})
