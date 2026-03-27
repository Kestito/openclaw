---
name: seo
description: Full-suite SEO toolkit — technical site audits (251 rules via seomator CLI with real Core Web Vitals), on-page and domain audits with CITE/CORE-EEAT scoring, keyword research, Schema.org generation, meta optimization, Lithuanian SEO content writing with WooCommerce product images and WordPress auto-publish, content rewriting, performance reports, and monitoring alerts. Use when the user asks about SEO, site health, keywords, content optimization, or search visibility.
metadata:
  {
    "openclaw": {
      "emoji": "🔍",
      "requires": { "bins": ["seomator"] },
      "install": [
        {
          "id": "node",
          "kind": "node",
          "package": "@seomator/seo-audit",
          "bins": ["seomator"],
          "label": "Install SEO Audit CLI (npm)"
        }
      ]
    }
  }
---

# SEO

Full-suite SEO toolkit combining real technical crawling (seomator CLI, 251 rules, Core Web Vitals) with AI-driven content strategy, keyword research, and Lithuanian content writing with WooCommerce integration.

## Modes

| Mode | What It Does | Key Tool |
|------|-------------|----------|
| `technical-audit` | Crawl site, measure real CWV, check 251 rules | seomator CLI |
| `audit-page` | On-page SEO + CORE-EEAT content quality (80 items) | seomator + AI analysis |
| `audit-domain` | CITE domain authority (40 items) + veto checks | seomator crawl + AI scoring |
| `keyword-research` | Discover keywords, intent, difficulty, strategy | AI analysis |
| `write-content` | Lithuanian SEO content + WooCommerce images + WordPress publish | AI + WooCommerce API |
| `rewrite` | Optimize existing content for search | AI analysis |
| `optimize-meta` | Title tags, descriptions, OG/Twitter tags | AI generation |
| `generate-schema` | Schema.org JSON-LD structured data | AI generation |
| `report` | Comprehensive SEO/GEO performance report | seomator data + AI |
| `setup-alert` | Configure SEO metric monitoring | AI + playbooks |

Ask for the **mode** if not obvious from context. Default to `technical-audit` for URLs and `keyword-research` for topics.

---

## Mode 1: Technical Audit (seomator CLI)

Real crawling with 251 deterministic rules. Measures actual Core Web Vitals via browser.

### Quick Start

```bash
# Single page audit
seomator audit https://example.com --format llm

# Full site crawl (up to 50 pages)
seomator audit https://example.com --crawl -m 50 --format json -o audit.json --save -v

# Fast check without browser (skip CWV)
seomator audit https://example.com --no-cwv -c "core,technical-seo,security,crawlability" --format json

# Specific categories only
seomator audit https://example.com -c "structured-data,opengraph,images" --format llm
```

### CLI Reference: `seomator audit <url>`

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--format` | `-f` | Output: `console`, `json`, `html`, `markdown`, `llm` | `console` |
| `--output` | `-o` | Save to file path | stdout |
| `--categories` | `-c` | Comma-separated categories | all |
| `--crawl` | | Multi-page crawl mode | off |
| `--max-pages` | `-m` | Max pages to crawl | 10 |
| `--concurrency` | | Parallel requests | 3 |
| `--timeout` | | Request timeout (ms) | 30000 |
| `--no-cwv` | | Skip Core Web Vitals | false |
| `--verbose` | `-v` | Show progress | false |
| `--refresh` | `-r` | Ignore cache, fetch fresh | false |
| `--save` | | Save to `.seomator/reports/` | false |

### Other seomator Commands

```bash
seomator init                # Create seomator.toml config
seomator crawl <url>         # Crawl only (no analysis)
seomator analyze [crawl-id]  # Run rules on stored crawl data
seomator report [query]      # View past reports
seomator self doctor         # Check system setup
```

### 20 Audit Categories

`core`, `performance`, `links`, `images`, `security`, `technical-seo`, `crawlability`, `structured-data`, `javascript-rendering`, `mobile`, `accessibility`, `content`, `social`, `internationalization`, `canonical`, `redirects`, `http-headers`, `robots`, `sitemap`, `opengraph`.

### Exit Codes

- **0** — Passed (score >= 70)
- **1** — Failed (score < 70)
- **2** — Error

### Notes

- CWV requires Chrome/Chromium/Edge. Use `--no-cwv` in Docker/CI.
- Results cached in SQLite; use `--refresh` for fresh data.
- Always use `--format llm` or `--format json` when processing results.

---

## Mode 2: Audit Page (On-Page SEO + CORE-EEAT)

Combines seomator technical data with AI-driven content quality assessment.

### Workflow

1. **Run seomator** on the target URL: `seomator audit <url> --format json`
2. **AI Analysis** — Score 8 on-page areas:
   - Title Tag (length 50-60 chars, keyword placement, CTR appeal)
   - Meta Description (length 150-160 chars, keyword, CTA)
   - Headers (H1-H6 hierarchy, keyword usage)
   - Content (depth, keyword density 1-2%, readability)
   - Keywords (primary, secondary, LSI usage)
   - Links (internal, external, anchor text)
   - Images (alt text, file names, compression)
   - Technical (URL structure, canonical, schema)
3. **CORE-EEAT Assessment** — 80-item content quality audit:
   - **C** (Content Quality) — Depth, accuracy, freshness
   - **O** (Organization) — Structure, navigation, readability
   - **R** (References) — Citations, data, evidence
   - **E** (Engagement) — Multimedia, interactivity, UX
   - **E-E-A-T**: Experience, Expertise, Authoritativeness, Trustworthiness
4. **Compile** — Merge seomator findings + AI scores, prioritize by impact

### Output

```
ON-PAGE SEO + CORE-EEAT AUDIT
==============================
URL: [url]
TARGET KEYWORD: [keyword]
OVERALL SCORE: XX/100

TECHNICAL (seomator): XX/100 [251 rules]
SECTION SCORES: Title / Meta / Headers / Content / Keywords / Links / Images / Technical
CORE-EEAT SCORES: GEO Score (CORE) XX/100 | SEO Score (EEAT) XX/100

PRIORITY ACTIONS: CRITICAL > IMPORTANT > MINOR
DETAILED FINDINGS: [per-section with specific recommendations]
```

---

## Mode 3: Audit Domain (CITE Authority)

Full CITE 40-item domain authority audit with veto checks.

### CITE Dimension Weights by Domain Type

| Dim | Default | Content | Product | E-commerce | Community | Tool | Authority |
|-----|:-------:|:-------:|:-------:|:----------:|:---------:|:----:|:---------:|
| C (Citation) | 35% | 40% | 25% | 20% | 35% | 25% | 45% |
| I (Identity) | 20% | 15% | 30% | 20% | 10% | 30% | 20% |
| T (Trust) | 25% | 20% | 25% | 35% | 25% | 25% | 20% |
| E (Eminence) | 20% | 25% | 20% | 25% | 30% | 20% | 15% |

### Workflow

1. **Run seomator crawl**: `seomator audit <domain> --crawl -m 30 --format json`
2. **Classify domain type**, apply weights
3. **Veto check** — T03, T05, T09 failures cap score at 39
4. **Score all 40 items**, calculate weighted CITE Score
5. **Top 5 improvements** by weighted impact

### Output

```
CITE DOMAIN AUTHORITY AUDIT: [Domain]
DOMAIN TYPE: [type] | CITE SCORE: X/100 | VETO STATUS: Pass/ALERT
Dimension scores: C / I / T / E with weights
TOP 5 IMPROVEMENTS | ACTION PLAN | DETAILED 40-ITEM TABLE
```

---

## Mode 4: Keyword Research

Discover high-value keywords with intent classification and strategic prioritization.

### Workflow

1. **Expand seed** into clusters: head terms, long-tail, questions, semantic
2. **Classify intent**: informational, navigational, commercial, transactional
3. **Score difficulty**: easy, medium, hard
4. **Estimate volume**: high, medium, low
5. **Competitive gap analysis** (if competitors provided)
6. **Prioritize**: Quick wins > Growth opportunities > Long-term targets

### Output

```
KEYWORD RESEARCH REPORT
SEED: [keyword] | TOTAL DISCOVERED: X

QUICK WINS (low difficulty): | Keyword | Intent | Difficulty | Volume | Priority |
GROWTH OPPORTUNITIES (medium): [same table]
LONG-TERM TARGETS (high): [same table]

TOPIC CLUSTERS: [pillar + cluster keywords by theme]
CONTENT CALENDAR: [prioritized content pieces with keyword targets]
COMPETITIVE GAPS: [keywords competitors rank for that you don't]
```

---

## Mode 5: Write Content (Lithuanian + WooCommerce + WordPress)

Write SEO-optimized content in perfect Lithuanian with real product images from WooCommerce, auto-publish to WordPress as draft with Rank Math SEO metadata.

**All content MUST be in perfect Lithuanian.** Diacritics are mandatory everywhere (ą, č, ę, ė, į, š, ų, ū, ž). Tonas: draugiškas, bet profesionalus — kaip patyręs kolega. Vidinės nuorodos privalomos (min. 3-5).

### Workflow

1. **Research** — Search liuti.lt for existing content (avoid duplication), search product catalog for related products
2. **Fetch WooCommerce products**: `curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products?search={name}&per_page=20"` — extract `images[0].src`, `permalink`, `name`, `price`
3. **Write SEO content**:
   - Title under 60 chars with primary keyword
   - Meta description 140-160 chars with CTA in Lithuanian
   - H1 > H2 > H3 hierarchy, keyword density 1-2%
   - Comparison tables where relevant
   - FAQ section (min 5 questions) for featured snippets
   - Internal links to liuti.lt products (min 3-5)
   - External links to authority sources (min 2-3) with `target="_blank" rel="noopener"`
4. **Embed product images** with links back to liuti.lt:
   ```html
   <!-- wp:image {"align":"center","sizeSlug":"medium"} -->
   <figure class="wp-block-image aligncenter size-medium">
     <a href="{product_url}">
       <img src="{image_url}" alt="{product_name} - {keyword} lietuviškas alt tekstas" />
     </a>
   </figure>
   <!-- /wp:image -->
   ```
5. **Publish to WordPress as DRAFT**:
   - Dedup check (no existing post with same slug)
   - Upload featured image via `wp/v2/media`
   - Create post via `wp/v2/posts` with `status: "draft"`, Gutenberg block HTML, SEO-friendly Lithuanian slug
   - Set tags from keyword cluster, resolve "Blog" category
6. **Set Rank Math SEO meta** (MANDATORY separate API call):
   ```
   POST /wp-json/rankmath/v1/updateMeta
   {"objectType":"post","objectID":<id>,"meta":{"rank_math_title":"...","rank_math_description":"...","rank_math_focus_keyword":"...","rank_math_robots":["index","follow"]}}
   ```
7. **Verify**: Title diacritics, image links, alt text diacritics, Rank Math 200 response, featured image set, external links present

### Gutenberg Block Format

All content uses WordPress block comments: `<!-- wp:paragraph -->`, `<!-- wp:heading {"level":2} -->`, `<!-- wp:list -->`, `<!-- wp:table -->`, `<!-- wp:image -->`, `<!-- wp:quote -->`, `<!-- wp:separator -->`.

### WordPress API Credentials

- `WOO_KEY` + `WOO_SECRET` for WooCommerce product API
- Same credentials for WordPress REST API (Basic Auth)
- Base URL: `https://www.liuti.lt`

### Content Types

Blog post (default), how-to guide, comparison, listicle, landing page, ultimate guide.

---

## Mode 6: Rewrite (Optimize Existing Content)

Take existing pages and produce SEO-optimized versions preserving original meaning.

### Workflow

1. Read original content, extract metadata and structure
2. Score current SEO, identify weaknesses
3. Rewrite: optimize structure, weave keywords naturally, improve readability, refresh meta
4. Generate change summary with rationale for each modification
5. Compare before/after SEO scores
6. Write artifacts to `.local/seo/rewrites/`:
   - `<slug>-rewrite.md` — optimized content
   - `<slug>-diff.md` — change summary
   - `<slug>-scores.json` — before/after scores
7. Apply to source only with explicit user approval

---

## Mode 7: Optimize Meta

Analyze and enhance title tags, meta descriptions, and social tags to maximize CTR.

### Workflow

1. Analyze current tags for length, keyword placement, CTR appeal
2. Generate 3-5 title variants + 3-5 description variants with scoring
3. Generate OG and Twitter Card tags

### Output

```
META TAG OPTIMIZATION
PAGE: [url] | TARGET KEYWORD: [keyword]

CURRENT: Title X/10 | Description X/10 | Social X/10

RECOMMENDED TITLE: [title] (X chars, score X/10)
Variants 2-3 with scores

RECOMMENDED DESCRIPTION: [desc] (X chars, score X/10)
Variants 2 with scores

IMPLEMENTATION CODE: [copy-paste HTML for title, meta, OG, Twitter tags]
```

### Tips

- Front-load keyword in first half of title
- Include CTA in every meta description
- Add year to titles for recurring topics (+3-8% CTR)

---

## Mode 8: Generate Schema

Generate valid Schema.org JSON-LD structured data for rich results.

### Supported Types

FAQ, HowTo, Article, Product, LocalBusiness, Organization, Breadcrumb, Review, Event, Video.

### Workflow

1. Identify type, fetch URL if provided, determine secondary types (e.g., Article + FAQ)
2. Collect required + recommended properties
3. Generate JSON-LD, validate against Google requirements

### Output

```
SCHEMA TYPE: [type] | RICH RESULT ELIGIBLE: Yes/No

GENERATED MARKUP: [complete JSON-LD ready to copy]

VALIDATION: JSON Syntax Pass/Fail | Required Properties Pass/Fail | Google Requirements Pass/Fail

IMPLEMENTATION:
1. Add to <head> in <script type="application/ld+json">
2. Test: https://search.google.com/test/rich-results
3. Submit in GSC; allow 2-4 weeks
```

---

## Mode 9: Report

Comprehensive SEO and GEO performance report with trends.

### Workflow

1. Run seomator crawl for current snapshot: `seomator audit <domain> --crawl -m 30 --format json --save`
2. Compare with previous saved reports if available
3. AI analysis across: organic traffic, keyword rankings, CITE score, backlink health, technical SEO, GEO performance, content performance

### Output

```
SEO & GEO PERFORMANCE REPORT
DOMAIN: [domain] | PERIOD: [range]

EXECUTIVE SUMMARY: Snapshot | Wins | Concerns | Recommendations

DETAILED: Traffic | Rankings | CITE Score | Backlinks | Technical | GEO | Content

ACTION PLAN: P0 CRITICAL > P1 HIGH > P2 MEDIUM > P3 LOW
```

---

## Mode 10: Setup Alert

Configure proactive monitoring alerts for SEO/GEO metrics.

### Alert Types

`ranking-drop`, `traffic-change`, `indexing-issue`, `backlink-change`, `geo-visibility`, `core-web-vitals`, `technical-error`, `conversion-rate`, `all-critical`.

### Output

Alert configuration with thresholds, severity, notification frequency, and response playbooks (immediate actions, investigation steps, recovery plan, escalation path).

---

## Recommended Workflows

### Full site health check

```bash
seomator audit https://www.liuti.lt --crawl -m 50 --format json -o audit.json --save -v
```
Then request `audit-domain` mode for CITE scoring on top of the data.

### Content creation pipeline

1. `keyword-research` — find target keywords
2. `write-content` — create Lithuanian content with WooCommerce products
3. `audit-page` — verify published draft scores well
4. `optimize-meta` — fine-tune title/description if needed

### Pre/post optimization comparison

1. `audit-page` on current URL (save baseline)
2. Make changes
3. `audit-page` again with `--refresh` to compare

---

## Safety

- **Audit/technical modes are read-only.** Never modify source files during audits.
- **Write/rewrite artifacts go to `.local/seo/` first.** Apply to source only after explicit approval.
- Do not fabricate keyword volume data — state when estimates are directional.
- Do not make ranking guarantees.
- Respect robots.txt when analyzing external URLs.
- Written content must be original. Do not copy from external sources.
- All user-facing content in Lithuanian with correct diacritics. JSON keys stay English.
- Tonas visada draugiškas, bet profesionalus.
- Kiekviename turinyje būtinos vidinės nuorodos (min. 3-5).
