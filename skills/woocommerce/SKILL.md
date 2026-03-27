---
name: woocommerce
description: Manage WooCommerce and WordPress content on liuti.lt — update product categories, pages, posts, products, and orders via the WooCommerce/WordPress REST API. Use when the user asks about their online store, product catalog, site pages, categories, or WooCommerce data. Do NOT use for non-WordPress tasks.
metadata:
  { "openclaw": { "emoji": "🛒", "requires": { "env": ["WOO_KEY", "WOO_SECRET"] } } }
---

# woocommerce

Manage WooCommerce products, categories, pages, posts, and orders on liuti.lt via REST API.

## Authentication

All requests use Basic Auth with WooCommerce consumer key/secret:

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/..."
```

For WordPress core endpoints (pages, posts), use the same auth:

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wp/v2/..."
```

## Product Categories

**List categories:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products/categories?per_page=100"
```

**Get single category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products/categories/42"
```

**Create category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wc/v3/products/categories" \
  -H "Content-Type: application/json" \
  -d '{"name": "Nauja kategorija", "description": "Aprašymas", "parent": 0}'
```

**Update category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X PUT "https://www.liuti.lt/wp-json/wc/v3/products/categories/42" \
  -H "Content-Type: application/json" \
  -d '{"name": "Atnaujintas pavadinimas", "description": "Naujas aprašymas"}'
```

**Delete category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X DELETE "https://www.liuti.lt/wp-json/wc/v3/products/categories/42?force=true"
```

## Pages

**List pages:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wp/v2/pages?per_page=50"
```

**Get page:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wp/v2/pages/123"
```

**Create page:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wp/v2/pages" \
  -H "Content-Type: application/json" \
  -d '{"title": "Puslapis", "content": "<p>Turinys</p>", "status": "publish"}'
```

**Update page:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X PUT "https://www.liuti.lt/wp-json/wp/v2/pages/123" \
  -H "Content-Type: application/json" \
  -d '{"title": "Atnaujintas puslapis", "content": "<p>Naujas turinys</p>"}'
```

## Posts

**List posts:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wp/v2/posts?per_page=20"
```

**Create post:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wp/v2/posts" \
  -H "Content-Type: application/json" \
  -d '{"title": "Įrašas", "content": "<p>Turinys</p>", "status": "publish", "categories": [5]}'
```

**Update post:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X PUT "https://www.liuti.lt/wp-json/wp/v2/posts/456" \
  -H "Content-Type: application/json" \
  -d '{"title": "Atnaujintas įrašas"}'
```

## Products

**List products:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products?per_page=20"
```

**Search products:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products?search=viking&per_page=20"
```

**Get single product:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products/789"
```

**Update product:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X PUT "https://www.liuti.lt/wp-json/wc/v3/products/789" \
  -H "Content-Type: application/json" \
  -d '{"name": "Atnaujintas produktas", "regular_price": "29.99", "description": "<p>Naujas aprašymas</p>"}'
```

**Create product:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wc/v3/products" \
  -H "Content-Type: application/json" \
  -d '{"name": "Naujas produktas", "type": "simple", "regular_price": "19.99", "description": "<p>Aprašymas</p>", "categories": [{"id": 42}]}'
```

**Filter by category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products?category=42&per_page=50"
```

**Batch update products:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wc/v3/products/batch" \
  -H "Content-Type: application/json" \
  -d '{"update": [{"id": 1, "regular_price": "10.00"}, {"id": 2, "regular_price": "20.00"}]}'
```

## Orders

**List recent orders:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/orders?per_page=10&orderby=date&order=desc"
```

**Get order:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/orders/1001"
```

**Update order status:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X PUT "https://www.liuti.lt/wp-json/wc/v3/orders/1001" \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

## Post Categories and Tags

**List post categories:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wp/v2/categories"
```

**Create post category:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wp/v2/categories" \
  -H "Content-Type: application/json" \
  -d '{"name": "Tinklaraščio kategorija", "description": "Aprašymas"}'
```

**List product tags:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/products/tags?per_page=100"
```

## Coupons

**List coupons:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" "https://www.liuti.lt/wp-json/wc/v3/coupons"
```

**Create coupon:**

```bash
curl -s -u "$WOO_KEY:$WOO_SECRET" -X POST "https://www.liuti.lt/wp-json/wc/v3/coupons" \
  -H "Content-Type: application/json" \
  -d '{"code": "NUOLAIDA10", "discount_type": "percent", "amount": "10", "description": "10% nuolaida"}'
```

## Notes

- WooCommerce endpoints: `/wc/v3/` prefix. WordPress core: `/wp/v2/`.
- Auth: Basic Auth with `$WOO_KEY:$WOO_SECRET` env vars.
- Pagination: `per_page` (max 100) and `page` params. Response headers include `X-WP-Total` and `X-WP-TotalPages`.
- Category/tag IDs are integers. Use GET to find IDs before updating.
- `force=true` required for permanent deletes (otherwise items go to trash).
- All content on liuti.lt is in Lithuanian — use Lithuanian text for descriptions and names.
- Pipe output through `| python3 -m json.tool` or `| jq .` for readable formatting.
