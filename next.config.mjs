/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["mammoth", "nodemailer", "@prisma/client", "pdf-lib", "docxtemplater", "pizzip", "pdfjs-dist"],
    serverActions: { bodySizeLimit: "12mb" },
    // pdfjs-dist is loaded at runtime (webpackIgnore), so file tracing can't see it — include it explicitly so
    // quotation PDFs can be read on serverless hosts (Vercel).
    outputFileTracingIncludes: {
      "/**/*": ["./node_modules/pdfjs-dist/package.json", "./node_modules/pdfjs-dist/legacy/build/**/*", "./node_modules/pdfjs-dist/standard_fonts/**/*"],
    },
  },
};

export default nextConfig;
