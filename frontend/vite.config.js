import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Plugin de desarrollo local que monta el handler de AWS Lambda en /api/*
function localLambdaApiPlugin() {
  return {
    name: "local-lambda-api-middleware",
    configureServer(server) {
      process.env.LOCAL_DEV = "true";
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith("/api")) {
          return next();
        }

        try {
          const chunks = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          const rawBody = Buffer.concat(chunks).toString("utf8");

          const parsedUrl = new URL(req.url, "http://localhost:5173");
          const queryStringParameters = {};
          for (const [k, v] of parsedUrl.searchParams.entries()) {
            queryStringParameters[k] = v;
          }

          const { handler } = await import("../backend/functions/api/index.mjs");
          const lambdaEvent = {
            httpMethod: req.method,
            path: parsedUrl.pathname,
            queryStringParameters,
            headers: req.headers,
            body: rawBody || null,
          };

          const result = await handler(lambdaEvent);
          res.statusCode = result.statusCode || 200;
          if (result.headers) {
            for (const [k, v] of Object.entries(result.headers)) {
              res.setHeader(k, v);
            }
          }
          res.end(result.body || "");
        } catch (err) {
          console.error("Local API Middleware Error:", err);
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localLambdaApiPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
  },
});

