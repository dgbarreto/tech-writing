// Publishes the article whose filename starts with the tag's number prefix
// (e.g. tag "article-01" -> publishes "01-*.md") to dev.to, then writes the
// returned id/url back into the file's front matter so re-running the same
// tag is a safe no-op.
//
// Requires: DEVTO_API_KEY (repo secret), TAG_NAME (e.g. from
// ${{ github.ref_name }}) as env vars. Node 20+ (built-in fetch).

const fs = require("fs");
const path = require("path");
const matter = require("gray-matter");

function main() {
  const tagName = process.env.TAG_NAME;
  const apiKey = process.env.DEVTO_API_KEY;

  if (!tagName) {
    console.error("Missing TAG_NAME env var.");
    process.exit(1);
  }
  if (!apiKey) {
    console.error(
      "Missing DEVTO_API_KEY env var. Add it as a repo secret (Settings > Secrets and variables > Actions)."
    );
    process.exit(1);
  }

  // "article-01" -> "01"
  const match = tagName.match(/^article-(\d+)$/);
  if (!match) {
    console.error(
      `Tag "${tagName}" doesn't match the expected pattern "article-NN" (e.g. article-01).`
    );
    process.exit(1);
  }
  const num = match[1];

  const root = process.cwd();
  const candidates = fs
    .readdirSync(root)
    .filter((f) => f.startsWith(`${num}-`) && f.endsWith(".md"));

  if (candidates.length === 0) {
    console.error(`No article file found starting with "${num}-" in ${root}.`);
    process.exit(1);
  }
  if (candidates.length > 1) {
    console.error(
      `Ambiguous: multiple files match "${num}-*.md": ${candidates.join(", ")}`
    );
    process.exit(1);
  }

  const filePath = path.join(root, candidates[0]);
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = matter(raw);

  if (parsed.data.id) {
    console.log(
      `"${candidates[0]}" already has id ${parsed.data.id} (${parsed.data.devto_url || "no url stored"}). Skipping — nothing to do.`
    );
    return;
  }

  const tags = String(parsed.data.tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 4); // dev.to allows max 4 tags

  publish({
    apiKey,
    title: parsed.data.title,
    bodyMarkdown: parsed.content,
    tags,
    canonicalUrl: parsed.data.canonical_url || undefined,
  })
    .then((result) => {
      console.log(`Published: ${result.url}`);

      parsed.data.published = true;
      parsed.data.id = result.id;
      parsed.data.devto_url = result.url;

      const updated = matter.stringify(parsed.content, parsed.data);
      fs.writeFileSync(filePath, updated);
    })
    .catch((err) => {
      console.error("Failed to publish to dev.to:", err.message || err);
      process.exit(1);
    });
}

async function publish({ apiKey, title, bodyMarkdown, tags, canonicalUrl }) {
  const res = await fetch("https://dev.to/api/articles", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      article: {
        title,
        body_markdown: bodyMarkdown,
        published: true,
        tags,
        ...(canonicalUrl ? { canonical_url: canonicalUrl } : {}),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dev.to API responded ${res.status}: ${text}`);
  }

  return res.json();
}

main();
