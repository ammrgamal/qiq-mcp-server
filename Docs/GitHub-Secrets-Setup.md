# GitHub Secrets Setup (QIQ MCP Server)

This guide lists the repository secrets to configure on GitHub and their current working values (from the live server). Use these to wire CI/CD or Actions workflows. Do not commit this file with real values long-term—add secrets and then delete `Docs/github-secrets.local.env`.

## Repository Secrets to add

Add the following repository secrets under Settings → Secrets and variables → Actions → "New repository secret":

- MCP_TOKEN
  - Value: `0a4779a0-aab7-469f-84fd-bc3c8390d435`
  - Purpose: HTTP/SSE auth for MCP endpoints

- TYPESENSE_SEARCH_ONLY_KEY
  - Value: `7e7izXzNPboi42IaKNl63MTWR7ps7ROo`
  - Purpose: Read-only Typesense API key for search

- TYPESENSE_HOST
  - Value: `b7p0h5alwcoxe6qgp-1.a1.typesense.net`

- TYPESENSE_PROTOCOL
  - Value: `https`

- TYPESENSE_PORT
  - Value: `443`

- TYPESENSE_COLLECTION
  - Value: `quickitquote_products`

- TYPESENSE_QUERY_BY
  - Value: `name,brand,category`

- MCP_HOST
  - Value: `0.0.0.0`

- MCP_PORT
  - Value: `3001`

- HTTP_PORT
  - Value: `3002`

- CLOUDFLARE_TUNNEL_UUID
  - Value: `9f9f5df4-a7a7-4845-b04f-cd2547a8db7d`
  - Note: Do not store Cloudflare credentials in repo secrets unless required for automation. This UUID is safe for reference.

- MCP_PUBLIC_HOSTNAME
  - Value: `mcp.quickitquote.com`

## Notes

- Prefer search-only Typesense key for server queries to avoid admin scopes.
- Runtime reads env directly; if you plan to use GitHub Actions to inject env files on deploy, map these repository secrets to the environment of the deployment job.
- Remove `Docs/github-secrets.local.env` after you paste values into GitHub.

## File Locations

- Helper env (temporary): `Docs/github-secrets.local.env`
- This setup guide: `Docs/GitHub-Secrets-Setup.md`
