import { Helmet } from "react-helmet-async";

interface SeoHeadProps {
  title: string;
  description: string;
  canonical?: string;
  image?: string | null;
  type?: string;
}

const DEFAULT_IMAGE = `${window.location.origin}/icon-512x512.png`;

export function SeoHead({ title, description, canonical, image, type = "website" }: SeoHeadProps) {
  const ogImage = image || DEFAULT_IMAGE;
  const url = canonical || window.location.href;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
    </Helmet>
  );
}
