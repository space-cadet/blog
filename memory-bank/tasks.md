# Task Registry
*Last Updated: 2026-05-30 13:10 UTC*

## Completed Tasks

### T1: Migrate blog to standalone repo
**Description**: Move Quarto blog source from digitalocean-server to independent repo
**Status**: ✅ COMPLETE
**Priority**: HIGH
**Started**: 2026-05-30
**Completed**: 2026-05-30
**Files**: All blog-quarto content
**Repository**: `space-cadet/blog`

## Active Tasks

### T2: Install Quarto on server
**Description**: Install Quarto CLI on DigitalOcean VPS for server-side rendering
**Status**: 🔄 PENDING
**Priority**: HIGH
**Dependencies**: T1

### T3: Set up automated render/deploy
**Description**: Create deploy script that pulls repo, runs `quarto render`, and syncs to public_html/blog/
**Status**: ⬜ NOT STARTED
**Priority**: HIGH
**Dependencies**: T2

## Historical Tasks (from digitalocean-server)
- T9b: Quarto Blog Migration - 🔄 (local build working, now in standalone repo)
- T9a: Static Blog Site Generation - ⏸️ (superseded by Quarto)
- T9: WordPress Blog Management - ⏸️ (abandoned)
