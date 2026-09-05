import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

function utf8Plugin(): import('vite').Plugin {
  return {
    name: 'utf8-charset',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const origSetHeader = res.setHeader.bind(res);
        res.setHeader = function(name: string, value: any) {
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

export default defineConfig(({ mode }) => ({
  server: {
    host: "127.0.0.1",
    port: 8081,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3002',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  plugins: [
    react(),
    utf8Plugin(),
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
