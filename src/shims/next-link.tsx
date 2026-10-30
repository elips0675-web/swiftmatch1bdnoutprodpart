import React, { forwardRef, AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router-dom";

interface NextLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
  locale?: string | false;
}

const NextLink = forwardRef<HTMLAnchorElement, NextLinkProps>(
  ({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, locale, ...rest }, ref) => {
    // External links
    if (typeof href === "string" && (/^https?:\/\//.test(href) || href.startsWith("mailto:") || href.startsWith("tel:"))) {
      return <a ref={ref} href={href} {...rest} />;
    }
    return <RouterLink ref={ref} to={href} replace={replace} {...rest} />;
  },
);
NextLink.displayName = "NextLink";

export default NextLink;
