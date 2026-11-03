import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "path";

function utf8Plugin(): import('vite').Plugin {
  return {
    name: 'utf8-charset',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = function(name: string, value: number | string | readonly string[]) {
          if (typeof name === 'string' && name.toLowerCase() === 'content-type' && value === 'text/html') {
            return origSetHeader(name, 'text/html; charset=utf-8');
          }
          return origSetHeader(name, value);
        };
        next();
      });
    },
  };
}

const API_TARGET = process.env.VITE_PROXY_TARGET || 'http://localhost:3002';

const COPYRIGHT_NOTICE = `/*! SwiftMatch — проприетарное (платное) ПО. © 2026 SwiftMatch. Все права защищены.
 * Лицензия: LICENSE — использование только по оплаченному договору; удаление этого уведомления запрещено.
 * Лицензиат: ${process.env.SMARTMATCH_LICENSEE || 'не указан'} */`;

function copyrightPlugin(): import('vite').Plugin {
  let outDir = path.resolve(__dirname, 'dist');
  const stamp = `${COPYRIGHT_NOTICE}\n`;
  const collect = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const abs = path.join(dir, entry.name);
      return entry.isDirectory() ? collect(abs) : [abs];
    });
  return {
    name: 'copyright-notice',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    transformIndexHtml(html: string) {
      return html.replace(
        '<!doctype html>',
        '<!doctype html>\n    <!-- SwiftMatch — проприетарное (платное) ПО. © 2026 SwiftMatch. Условия использования: LICENSE -->'
      );
    },
    closeBundle() {
      for (const file of collect(outDir)) {
        if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
        const code = readFileSync(file, 'utf8');
        if (code.startsWith('/*! SwiftMatch')) continue;
        writeFileSync(file, stamp + code, 'utf8');
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 8081,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/socket.io': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 8081,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/socket.io': {
        target: API_TARGET,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  plugins: [
    react(),
    utf8Plugin(),
    copyrightPlugin(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    target: "es2020",
    minify: "esbuild",
    sourcemap: mode === "development",
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      external: ['@capacitor-community/admob', '@capacitor/push-notifications', '@capacitor/geolocation'],
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/") || id.includes("node_modules/react-router") || id.includes("node_modules/recharts") || id.includes("node_modules/date-fns")) return "vendor";
          if (id.includes("node_modules/@radix-ui")) return "ui";
          if (id.includes("node_modules/framer-motion")) return "animations";
          if (id.includes("node_modules/@supabase")) return "supabase";
        },
      },
    },
  },
}));
