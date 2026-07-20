# Custom-domain cutover

1. Obtain church/DNS approval and set `custom_domain_name` plus managed `route53_zone_id` when available. Schedule the change because host-only member and staff cookies do not transfer between the CloudFront hostname and the custom hostname.
2. Apply Terraform to validate the us-east-1 ACM certificate, CloudFront alias, Route 53 record, allowed Origin, and public-base URL used by magic links. Cognito has no browser callback URL in the in-page authentication design.
3. Test in-page staff password/TOTP sign-in, fragment redemption, cookie behavior, CSP/Origin enforcement, email links, logout, and direct-origin rejection at the new hostname.
4. Publish the new URL, allow DNS/cache overlap, and monitor authentication failures. Roll back the alias/base URL together if needed.
5. After the accepted window, remove references to the old hostname. Existing links are short-lived, so do not maintain indefinite host aliases.
