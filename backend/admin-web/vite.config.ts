import path from "node:path";

export default {
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      react: path.resolve(__dirname, "../../frontend/node_modules/react"),
      "react-dom": path.resolve(__dirname, "../../frontend/node_modules/react-dom"),
      "react-dom/client": path.resolve(__dirname, "../../frontend/node_modules/react-dom/client.js"),
      "react/jsx-runtime": path.resolve(__dirname, "../../frontend/node_modules/react/jsx-runtime.js"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 3300,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 3300,
  },
  build: {
    sourcemap: true,
    outDir: "dist",
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
        },
      },
    },
  },
};
