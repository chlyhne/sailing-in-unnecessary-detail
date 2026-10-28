# Blog comments

The blog owns this API and its Cloudflare D1 database. Readers provide only a
display name and plain-text comment, which are published immediately. There
is no third-party commenting service, reader account, email requirement or
tracking cookie. The blog itself continues to run on GitHub Pages.

Each thread is keyed by its post directory, so `/posts/example/` and
`/posts/example/index.html` share comments. Changing an article title does not
change its thread. The home page displays the newest article's discussion too,
with existing comments followed by the new-comment form.

## Development

Requires Node.js 22 or newer. From this directory:

```sh
npm ci
npm test
npx wrangler d1 migrations apply sailing-blog-comments --local
npm run dev
```

Run `quarto preview --port 4200` from the blog root. Local previews use the
local API on port 8787 and a separate local database. The deployed blog uses
the API address in `_includes/comments.html`.

## Deployment

The D1 binding is in `wrangler.toml`. Sign in with `npx wrangler login` if
needed, then apply migrations and deploy:

```sh
npx wrangler d1 migrations apply sailing-blog-comments --remote
npm run deploy
```

The Worker also needs the `RATE_LIMIT_SALT` secret, set once using
`npx wrangler secret put RATE_LIMIT_SALT` with a random value of at least 32
characters. Do not put the secret into the repository or frontend.

The Worker handles comments and owner sign-in only. Blog pages and draft pages
are served by GitHub Pages. After signing in, **Back to the blog** carries the
session expiry in a URL fragment so the blog can remember its owner-view display
preference. This is not a credential and grants no comment-management access.
Signing out clears the blog preference when returning to the blog.

Anonymous submissions are validated server-side and use parameterised SQL.
The API allows one comment per 30 seconds and twenty per hour for each
network address. Only a keyed, daily-changing hash is used for these limits;
raw network addresses are not stored. Expired counters are cleaned up daily.
Comment text is rendered as text, so HTML and scripts cannot run in a reader's
browser. There is also an invisible form field to catch simple spam bots.

## Owner-only comment management

The blog footer's **Manage comments** link opens the management page on the
comments Worker. Sign in with GitHub, browse comments from all articles, and
use **Delete comment** followed by confirmation. Readers still post without
accounts. Deletions are permanent; export a backup first if you may need it.

Access is restricted server-side to GitHub account ID `198742006` (`chlyhne`),
configured as `ADMIN_GITHUB_ID` in `wrangler.toml`. A matching display name or
username is not enough. Other accounts cannot list management data or delete
comments. Changing this setting immediately invalidates the previous owner's
sessions. There is no development authentication bypass.

### One-time GitHub setup

1. Open [GitHub ? Settings ? Developer settings ? OAuth Apps ? New OAuth App](https://github.com/settings/applications/new).
2. Enter these values:
   - **Application name:** Sailing blog comment management
   - **Homepage URL:** `https://sailinginunnecessarydetail.com/`
   - **Authorization callback URL:** `https://sailing-blog-comments.hummesse.workers.dev/admin/callback`
3. Register the application, then generate a client secret. Keep callback URL
   wildcard matching disabled. Device flow is not needed. Sign-in requests no
   repository or email scopes.
4. From the `comments-api` directory, store the displayed Client ID and client
   secret using the interactive prompts below. Paste the values only into the
   prompts, never into source files, chat, or shell command arguments:

   ```powershell
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   ```

5. Apply the new migration and deploy the Worker:

   ```powershell
   npx wrangler d1 migrations apply sailing-blog-comments --remote
   npm run deploy
   ```

6. Publish the blog's footer change by committing and pushing it. Open
   [Manage comments](https://sailing-blog-comments.hummesse.workers.dev/admin),
   sign in as `chlyhne`, and check that comments appear. Test deletion only on
   a comment you intend to remove.

If Wrangler is not installed yet, first run `npm ci` in `comments-api`.
Use `npx wrangler login` if Cloudflare asks you to authenticate.
The GitHub login cannot be tested end to end until the OAuth app and secrets
exist. Without configuration, management returns an unavailable response;
public commenting continues to work.

### Authentication and recovery

Management uses the Worker's own origin so browser restrictions on third-party
cookies do not interfere. OAuth state is single-use and expires after ten
minutes; the code exchange also uses PKCE. GitHub tokens are used to verify
identity and are not stored. Owner sessions expire after eight hours, use
Secure/HttpOnly/SameSite cookies, and store only a hash of the session token
in D1. Delete and sign-out requests require a matching origin and CSRF token.
The management page has no analytics and renders names and comments as text.
Expired OAuth attempts and sessions are removed by the daily cleanup task.

**Sign out** revokes the current session immediately. To revoke all management
sessions, run:

```powershell
npx wrangler d1 execute sailing-blog-comments --remote --command "DELETE FROM admin_sessions"
```

To rotate the GitHub secret, generate a new one in GitHub, update
`GITHUB_CLIENT_SECRET` with Wrangler, and revoke the old secret in GitHub.
Revoke existing sessions separately if necessary. The D1 console and CLI
remain available for emergency moderation if GitHub sign-in is unavailable.

For an end-to-end local test, register a separate development OAuth app with
callback `https://localhost:8787/admin/callback`, put its credentials in the
ignored `comments-api/.dev.vars`, set `ADMIN_ORIGIN="https://localhost:8787"`
there, apply local migrations, and use
`npx wrangler dev --local --local-protocol https`. Keep the same owner ID;
local management must not grant access to other accounts.

## Manage and back up comments

View comments using the D1 console in Cloudflare, or:

```sh
npx wrangler d1 execute sailing-blog-comments --remote --command "SELECT id, post, name, body, created_at FROM comments ORDER BY id DESC LIMIT 100"
```

To remove a comment, substitute its numeric ID:

```sh
npx wrangler d1 execute sailing-blog-comments --remote --command "DELETE FROM comments WHERE id = 123"
```

Back up all comments to an ignored local directory:

```sh
mkdir -p backups
npx wrangler d1 export sailing-blog-comments --remote --output backups/comments.sql
```

Export or change hosts at any time: the schema is ordinary SQLite SQL.
