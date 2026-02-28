/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: "/",
        destination: "/sales",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;