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

Anonymous submissions are validated server-side and use parameterised SQL.
The API allows one comment per 30 seconds and twenty per hour for each
network address. Only a keyed, daily-changing hash is used for these limits;
raw network addresses are not stored. Expired counters are cleaned up daily.
Comment text is rendered as text, so HTML and scripts cannot run in a reader's
browser. There is also an invisible form field to catch simple spam bots.

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
