/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: ["mammoth", "nodemailer", "@prisma/client", "pdf-lib", "docxtemplater", "pizzip", "pdfjs-dist"],
    serverActions: { bodySizeLimit: "12mb" },
  },
};

export default nextConfig;
