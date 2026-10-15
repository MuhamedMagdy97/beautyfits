# TASK-059B — Storefront Home Page

## Goal
Replace the home placeholder (TASK-058) with the Stitch homepage layout: hero, trust bar, category tiles, newest products, editorial blocks and a fuller footer, in Arabic (RTL, default) and English, using only claims the business spec backs and the public catalog API.

## Dependencies
TASK-058 (storefront shell, i18n), TASK-059 (public catalog endpoints, `ProductCard`).

## Source of Truth
- Business Spec Q1 (cash on delivery only), Q2 (guest checkout), Q3 (verified-purchase reviews), Q17 (14-day returns from delivery)
- API Contract "TASK-059" catalog endpoints (`GET /products`, `GET /categories`)
- Design reference: `design-reference/google-stitch/beautyfits_luxury_beauty_homepage`, `editorial_velvet/DESIGN.md`, `beautyfits_brand_logo`

## Scope
- `/`: hero (Shop now → `/products`, Explore perfumes → perfume category), trust bar, "Find your beauty" tiles of up to four top-level categories, "Just in" row of the 8 newest products, two editorial blocks (perfumes, makeup) linking to their category listings.
- Footer: brand, cash on delivery and 14-day returns, Shop and Account link columns.
- Sections without data (no categories / no products) are hidden.

## Non-Goals
- Announcement bar, product badges, "Beauty favorites"/best sellers, free-shipping banner, testimonials, hero rating line, editorial statistics, customer-care footer links (see Open Items).
- Ratings on product cards: reviews are per product only (`GET /products/{id}/reviews`); a home row would need one request per card.
- Any API, database or permission change.

## Files / Modules
- `src/app/(store)/page.tsx`, `_components/shell.tsx` (footer), `_lib/i18n.tsx` (`homePage` texts), `_lib/home.ts`, `_lib/home.test.ts`

## Business Rules
No new rules. Trust bar copy only restates Q1, Q2, Q3 and Q17. Catalog data, prices and stock status come from the API.

## API Changes
None.

## Database Changes
None.

## Security / Authorization
Public endpoints only; no new input. Category links use API ids. No external images are loaded (Stitch images are Google-hosted and are not hot-linked).

## Acceptance Criteria
- `/` shows hero, trust bar, category tiles, newest products and editorial blocks in Arabic (RTL) and English (LTR), with no horizontal scroll at phone width.
- Category tiles and editorial links open the matching `/products?categoryId=` listing; without a matching category they open `/products`.
- No unbacked marketing claim is shown.
- All required checks pass.

## Tests
- Unit `src/app/(store)/_lib/home.test.ts`: top-level categories (order, at most four), category link by slug with fallback.
- Browser check (dev server, sample catalog): Arabic and English at desktop width, Arabic at 375 px.

## Edge Cases
- Empty catalog: only hero, trust bar and editorial blocks (linking to `/products`) are shown.
- No perfume/makeup category slug: editorial and hero links fall back to `/products`.
- Catalog request fails: the catalog sections stay hidden; the rest of the page still renders.

## Definition of Done
Acceptance criteria met, docs updated, CI `verify` green, reviewed by the product owner.

## Open Items
- [BUSINESS DECISION REQUIRED] Images: the hero, category tiles and editorial blocks use placeholder gradients. The owner supplies BeautyFits photography (stored in `/public` or uploaded through the files API), or decides on category images in the catalog (no `image` on categories today).
- [BUSINESS DECISION REQUIRED] "100% authentic" and "fast delivery across Egypt" (Stitch trust bar and hero) are not in the business spec; not shown. Delivery depends on active areas (`SHIPPING_UNAVAILABLE`).
- [BUSINESS DECISION REQUIRED] Hero rating line ("4.9/5, 8,400+ verified beauty lovers"), editorial statistics ("120+ exclusive scents", "100% batch-authenticated") and testimonials ("Loved by beauty lovers") have no data source; not built.
- [BUSINESS DECISION REQUIRED] "Beauty favorites" row: needs a definition of best seller / featured (same open item as TASK-059); only "Just in" (newest) is built.
- Announcement bar, badges (NEW/SALE/RARE FIND) and the free-shipping banner remain open in TASK-058 / TASK-059.
- Editorial blocks find their category by English slug (`perfume`/`fragrance`, `makeup`); if the owner wants to choose the categories, this needs a setting.
- Footer "Customer care" column (order tracking, returns policy, shipping, FAQ, contact) waits for those pages (TASK-060 and content pages).
- The Arabic copy is a proposal for the product owner.

## Status
- [x] Planned
- [x] In Progress
- [x] Tests Passing
- [ ] Reviewed
- [ ] Done
